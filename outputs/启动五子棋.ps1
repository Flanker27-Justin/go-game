# ============================================================
#  五子棋 · 一键启动
#  ------------------------------------------------------------
#  做四件事：① 检查 Node.js  ② 启动 gomoku-server.js
#            ③ 打印本机与局域网访问地址  ④ 打开浏览器
#  关闭本窗口即停止服务器。
#
#  可直接双击 启动五子棋.bat（推荐），或手动执行：
#     powershell -ExecutionPolicy Bypass -File 启动五子棋.ps1
#
#  参数：
#     -Port 8123     指定端口（默认 8123）
#     -NoBrowser     不自动打开浏览器
# ============================================================
[CmdletBinding()]
param(
  [int]$Port = 0,
  [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
$OutputEncoding = [System.Text.Encoding]::UTF8
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$server = Join-Path $here 'gomoku-server.js'
$logDir = Join-Path $here 'logs'
$logFile = Join-Path $logDir 'server.log'

function Write-Head($text) { Write-Host ''; Write-Host "  $text" -ForegroundColor Cyan }
function Write-Ok($text)   { Write-Host "  [OK]   " -NoNewline -ForegroundColor Green; Write-Host $text }
function Write-Warn2($text){ Write-Host "  [提示] " -NoNewline -ForegroundColor Yellow; Write-Host $text }
function Write-Err2($text) { Write-Host "  [错误] " -NoNewline -ForegroundColor Red;   Write-Host $text }
function Pause-IfNeeded { if ($Host.Name -eq 'ConsoleHost') { Write-Host ''; Write-Host '  按回车键退出…' -NoNewline; [void](Read-Host) } }

Write-Host ''
Write-Host '  ============================================' -ForegroundColor DarkCyan
Write-Host '            五子棋 · 一键启动' -ForegroundColor White
Write-Host '  ============================================' -ForegroundColor DarkCyan

# ---------- 1. 检查文件 ----------
if (-not (Test-Path $server)) {
  Write-Err2 "找不到服务器文件: $server"
  Write-Host "         请确保 本脚本 与 gomoku-server.js 在同一个目录（outputs/）。"
  Pause-IfNeeded; exit 1
}

# ---------- 2. 检查 Node.js ----------
Write-Head '检查运行环境'
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
  Write-Err2 '未检测到 Node.js。'
  Write-Host '         本游戏需要 Node.js 才能启动服务器（任意 LTS 版本即可）。'
  Write-Host ''
  Write-Host '         安装方式（任选其一）：' -ForegroundColor Yellow
  Write-Host '           · 官网下载： https://nodejs.org/'
  Write-Host '           · 或执行：   winget install OpenJS.NodeJS.LTS'
  Write-Host ''
  Write-Host '         装完后重新双击本脚本即可。' -ForegroundColor Yellow
  Pause-IfNeeded; exit 1
}
$nodeVer = (& node --version) 2>$null
Write-Ok "Node.js $nodeVer"

# ---------- 3. 选择端口（被占用则自动顺延） ----------
Write-Head '准备端口'
if ($Port -le 0) { $Port = 8123 }
function Test-PortBusy([int]$p) {
  try {
    $c = New-Object System.Net.Sockets.TcpClient
    $c.Connect('127.0.0.1', $p); $c.Close(); return $true
  } catch { return $false }
}
$tries = 0
while ((Test-PortBusy $Port) -and $tries -lt 10) {
  Write-Warn2 "端口 $Port 已被占用，尝试 $(($Port + 1))"
  $Port++; $tries++
}
if (Test-PortBusy $Port) { Write-Err2 "端口 $Port 起仍被占用，请先用 -Port 指定其它端口"; Pause-IfNeeded; exit 1 }
Write-Ok "使用端口 $Port"

# ---------- 4. 启动服务器（后台进程 + 日志） ----------
Write-Head '启动服务器'
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }
$env:PORT = "$Port"
$proc = $null
try {
  $proc = Start-Process -FilePath 'node' -ArgumentList @($server) -WorkingDirectory $here `
    -RedirectStandardOutput $logFile -RedirectStandardError "$logFile.err" -PassThru -WindowStyle Hidden
} catch {
  Write-Err2 "启动 node 进程失败：$($_.Exception.Message)"
  Write-Host '         若提示“拒绝访问/权限不足”，可能是安全软件拦截了子进程；'
  Write-Host '         也可改为手动启动：在本目录执行  node gomoku-server.js'
  Pause-IfNeeded; exit 1
}

# 等待端口进入监听：最多 15 秒。既看端口也看进程，便于区分“还在启动”与“已崩溃”
$ready = $false
$deadline = (Get-Date).AddSeconds(15)
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Milliseconds 300
  if (Test-PortBusy $Port) { $ready = $true; break }
  if ($proc.HasExited) { break }
}
if (-not $ready) {
  if ($proc.HasExited) { Write-Err2 "服务器进程已退出（退出码 $($proc.ExitCode)）。" }
  else { Write-Warn2 '等待 15 秒后端口仍未进入监听，可能有防火墙/安全软件拦截。' }
  if (Test-Path "$logFile.err") {
    $el = Get-Content "$logFile.err" -Raw -ErrorAction SilentlyContinue
    if ($el) { Write-Host '         stderr:'; $el.Trim().Split("`n") | Select-Object -First 10 | ForEach-Object { Write-Host "           $_" -ForegroundColor DarkYellow } }
  }
  if (Test-Path $logFile) {
    $ol = Get-Content $logFile -Raw -ErrorAction SilentlyContinue
    if ($ol) { Write-Host '         日志尾部:'; $ol.Trim().Split("`n") | Select-Object -Last 10 | ForEach-Object { Write-Host "           $_" } }
  }
  Write-Host ''
  Write-Host '         可尝试：换一个端口重跑（-Port 9000），或先手动执行 node gomoku-server.js 看完整报错。' -ForegroundColor Yellow
  Pause-IfNeeded; exit 1
}
Write-Ok "服务器已启动（进程 $($proc.Id)）"

# 双保险：用一次真实 HTTP 请求确认页面可访问（端口在监听不等于能正常响应）
try {
  $resp = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/" -UseBasicParsing -TimeoutSec 8
  Write-Ok "页面可访问（HTTP $($resp.StatusCode)，$([Math]::Round($resp.RawContentLength / 1KB, 1)) KB）"
} catch {
  Write-Warn2 "端口已监听但页面请求失败：$($_.Exception.Message)"
  Write-Host '         若浏览器能打开则可忽略；否则请查看日志。' -ForegroundColor DarkGray
}

# ---------- 5. 收集访问地址 ----------
$lan = @()
try {
  $lan = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop |
    Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' -and $_.PrefixOrigin -ne 'WellKnown' } |
    Select-Object -ExpandProperty IPAddress -Unique
} catch {
  try {
    $lan = (ipconfig | Select-String 'IPv4' | ForEach-Object {
      ($_ -split ':', 2)[1].Trim()
    } | Where-Object { $_ -notlike '127.*' -and $_ -notlike '169.254.*' } | Select-Object -Unique)
  } catch { $lan = @() }
}

$localUrl = "http://127.0.0.1:$Port/"
Write-Host ''
Write-Host '  ------------------------------------------------------------' -ForegroundColor DarkGray
Write-Host '   本机打开（自己玩）：' -ForegroundColor White
Write-Host "     $localUrl" -ForegroundColor Green
if ($lan.Count -gt 0) {
  Write-Host ''
  Write-Host '   手机 / 同 WiFi 的朋友打开：' -ForegroundColor White
  foreach ($ip in $lan) { Write-Host "     http://${ip}:$Port/" -ForegroundColor Green }
} else {
  Write-Warn2 '未识别到局域网 IP；如需手机联机，请确认已连接 WiFi/网线。'
}
Write-Host ''
Write-Host '   联机玩法：本机页面点【在线对战】→ 选好棋盘格数 → 【创建房间】，' -ForegroundColor DarkGray
Write-Host '             再用【复制链接】或【扫码入局】把链接发给对方。' -ForegroundColor DarkGray
Write-Host '  ------------------------------------------------------------' -ForegroundColor DarkGray
Write-Host ''
Write-Host '  关闭本窗口即停止服务器。' -ForegroundColor Yellow
Write-Host "  运行日志：$logFile" -ForegroundColor DarkGray

# ---------- 6. 打开浏览器 ----------
if (-not $NoBrowser) {
  try { Start-Process $localUrl | Out-Null; Write-Ok '已打开浏览器' }
  catch { Write-Warn2 "无法自动打开浏览器，请手动访问 $localUrl" }
}

# ---------- 7. 保持运行；Ctrl+C 或关窗口时结束服务器 ----------
try {
  while (-not $proc.HasExited) { Start-Sleep -Milliseconds 500 }
  Write-Warn2 '服务器进程已退出。'
} finally {
  if ($proc -and -not $proc.HasExited) {
    Write-Host ''
    Write-Host '  正在停止服务器…' -ForegroundColor Yellow
    try { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue } catch { }
  }
}
Pause-IfNeeded

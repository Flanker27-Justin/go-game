# ============================================================
#  五子棋 · 异地联机一键启动
#  ------------------------------------------------------------
#  本游戏的使用场景是「两个人异地各用一台设备对战」，所以这个脚本
#  不是"架个局域网服务器"，而是"把服务发布到公网，让对方用链接进来"：
#
#    ① 检查 Node.js
#    ② 检查内网穿透工具 cpolar（异地联机的关键；局域网 IP 出了 WiFi 就不可达）
#    ③ 启动游戏服务器（本机端口）
#    ④ 启动 cpolar 隧道 → 取得公网 https 地址
#    ⑤ 打印公网地址 + 二维码（对方扫码即入）
#    ⑥ 打开浏览器；关闭窗口即停止服务器与隧道
#
#  用法：双击 启动异地联机.bat
#  也可手动：powershell -ExecutionPolicy Bypass -File 启动异地联机.ps1 [-Port 8123] [-Tunnel gomoku] [-NoBrowser]
# ============================================================
[CmdletBinding()]
param(
  [int]$Port = 0,
  [string]$Tunnel = 'gomoku',
  [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$server = Join-Path $here 'gomoku-server.js'
$qrScript = Join-Path $here '..\work\qr.js'
$logDir = Join-Path $here 'logs'
$logFile = Join-Path $logDir 'server.log'
$cpolarLog = Join-Path $logDir 'cpolar.log'

function Say($t)   { Write-Host "  $t" }
function Ok($t)    { Write-Host "  [OK]   " -NoNewline -ForegroundColor Green;   Write-Host $t }
function Warn2($t) { Write-Host "  [提示] " -NoNewline -ForegroundColor Yellow;  Write-Host $t }
function Err2($t)  { Write-Host "  [错误] " -NoNewline -ForegroundColor Red;     Write-Host $t }
function Head($t)  { Write-Host ''; Write-Host "  $t" -ForegroundColor Cyan }
function Pause-End { if ($Host.Name -eq 'ConsoleHost') { Write-Host ''; Write-Host '  按回车键退出…' -NoNewline; [void](Read-Host) } }

function Test-PortBusy([int]$p) {
  try { $c = New-Object System.Net.Sockets.TcpClient; $c.Connect('127.0.0.1', $p); $c.Close(); return $true }
  catch { return $false }
}

Write-Host ''
Write-Host '  ==================================================' -ForegroundColor DarkCyan
Write-Host '        五子棋 · 异地联机一键启动' -ForegroundColor White
Write-Host '   （把服务发布到公网，对方异地扫码或点链接进房）' -ForegroundColor DarkGray
Write-Host '  ==================================================' -ForegroundColor DarkCyan

# ---------- ① 检查 Node.js ----------
Head '① 检查运行环境'
if (-not (Test-Path $server)) { Err2 "找不到 $server（请让本脚本与 gomoku-server.js 放在同一目录）"; Pause-End; exit 1 }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Err2 '未检测到 Node.js（游戏服务器需要它）。'
  Say '         安装： https://nodejs.org/   或   winget install OpenJS.NodeJS.LTS'
  Pause-End; exit 1
}
Ok "Node.js $((& node --version) 2>$null)"

# ---------- ② 检查 cpolar（异地联机的关键） ----------
Head '② 检查内网穿透工具 cpolar'
$cpolar = $null
$cpolarCmd = Get-Command cpolar -ErrorAction SilentlyContinue
if ($cpolarCmd) { $cpolar = $cpolarCmd.Source }
else {
  foreach ($p in @('D:\APP\cpolar\cpolar.exe', "$env:ProgramFiles\cpolar\cpolar.exe", "$env:LOCALAPPDATA\cpolar\cpolar.exe")) {
    if (Test-Path $p) { $cpolar = $p; break }
  }
}
if (-not $cpolar) {
  Err2 '未找到 cpolar，无法把服务发布到公网（异地对战就玩不了）。'
  Say '         说明：两台设备不在同一个网络时，必须有人把服务"打通"到公网。'
  Say '         做法之一（免费可用）：'
  Say '           1) 到 https://www.cpolar.com/ 注册并下载安装'
  Say '           2) 安装后在命令行执行： cpolar authtoken <你的token>'
  Say '           3) 重新双击本脚本'
  Pause-End; exit 1
}
Ok "cpolar: $cpolar"

$cfgPath = Join-Path $env:USERPROFILE '.cpolar\cpolar.yml'
if (-not (Test-Path $cfgPath)) {
  Err2 "cpolar 尚未登录（找不到 $cfgPath）。"
  Say '         请先执行： cpolar authtoken <你的token>（token 在 cpolar 后台可查）'
  Pause-End; exit 1
}
$cfg = Get-Content $cfgPath -Raw
if ($cfg -notmatch '(?m)^\s*authtoken\s*:\s*\S+') {
  Err2 'cpolar 配置里没有 authtoken，说明还没登录。'
  Say '         请先执行： cpolar authtoken <你的token>'
  Pause-End; exit 1
}
Ok 'cpolar 已登录'

# 决定用「已配置的命名隧道」还是「临时隧道」
$hasNamedTunnel = $cfg -match "(?m)^\s{2,}$([regex]::Escape($Tunnel))\s*:"
$tunnelPort = 0
if ($hasNamedTunnel) {
  # ★ 关键：命名隧道在 cpolar.yml 里写死了转发到哪个本地端口（这里是 addr: "8123"）。
  #   我们的游戏服务器必须监听**同一个端口**，否则隧道会把请求转到一个空端口，
  #   表现就是"公网地址打不开"。因此这里从配置里读出该端口并对齐。
  if ($cfg -match "(?ms)^\s{2,}$([regex]::Escape($Tunnel))\s*:\s*\n((?:\s+\w+:.*\n?)+)") {
    $block = $Matches[2]
    if ($block -match 'addr:\s*"?(\d+)"?') { $tunnelPort = [int]$Matches[1] }
  }
  if ($tunnelPort -gt 0) {
    Ok "使用已配置的隧道：$Tunnel（绑定本机端口 $tunnelPort）"
    if ($Port -le 0 -or $Port -ne $tunnelPort) {
      if ($Port -gt 0 -and $Port -ne $tunnelPort) { Warn2 "你指定了端口 $Port，但隧道 $Tunnel 绑定的是 $tunnelPort，将改用 $tunnelPort" }
      $Port = $tunnelPort
    }
  } else {
    Warn2 "隧道 $Tunnel 的配置里没读到 addr，将按默认端口处理"
  }
} else {
  Warn2 "配置里没有名为 $Tunnel 的隧道，将改用临时隧道（每次地址都会变，但同样可用于异地联机）"
  $Tunnel = ''
}

# ---------- ③ 启动游戏服务器 ----------
Head '③ 启动游戏服务器'
if ($Port -le 0) { $Port = 8123 }
if (Test-PortBusy $Port) {
  $tries = 0
  while ((Test-PortBusy $Port) -and $tries -lt 10) { Warn2 "端口 $Port 被占用，改用 $($Port + 1)"; $Port++; $tries++ }
  if (Test-PortBusy $Port) { Err2 "端口 $Port 起仍被占用，请用 -Port 指定其它端口"; Pause-End; exit 1 }
}
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }
$env:PORT = "$Port"
$srv = $null
try {
  $srv = Start-Process -FilePath 'node' -ArgumentList @($server) -WorkingDirectory $here `
    -RedirectStandardOutput $logFile -RedirectStandardError "$logFile.err" -PassThru -WindowStyle Hidden
} catch {
  Err2 "启动 node 失败：$($_.Exception.Message)"
  Say '         可手动在 outputs 目录执行： node gomoku-server.js'
  Pause-End; exit 1
}
# 端口就绪 + 真实 HTTP 确认（只查端口会误报）
$ok = $false
$deadline = (Get-Date).AddSeconds(15)
while ((Get-Date) -lt $deadline -and -not $ok) {
  Start-Sleep -Milliseconds 300
  if (Test-PortBusy $Port) {
    foreach ($i in 1..3) {
      try { if ((Invoke-WebRequest "http://127.0.0.1:$Port/" -UseBasicParsing -TimeoutSec 6).StatusCode -eq 200) { $ok = $true; break } }
      catch { Start-Sleep -Milliseconds 400 }
    }
  }
  if ($srv.HasExited) { break }
}
if (-not $ok) {
  Err2 '服务器没能正常提供页面。'
  foreach ($f in @("$logFile.err", $logFile)) {
    if (Test-Path $f) { $t = Get-Content $f -Raw -ErrorAction SilentlyContinue; if ($t) { Say "日志($([IO.Path]::GetFileName($f)))："; $t.Trim().Split("`n") | Select-Object -Last 8 | ForEach-Object { Say "  $_" } } }
  }
  if ($srv -and -not $srv.HasExited) { try { Stop-Process -Id $srv.Id -Force -ErrorAction SilentlyContinue } catch { } }
  Pause-End; exit 1
}
Ok "服务器已启动并确认可访问（端口 $Port，进程 $($srv.Id)）"

# ---------- ④ 启动 cpolar 隧道，抓取公网地址 ----------
Head '④ 建立公网隧道（对方就是通过这个地址连进来）'
if (Test-Path $cpolarLog) { Remove-Item $cpolarLog -Force -ErrorAction SilentlyContinue }
$cpArgs = if ($Tunnel) { @('start', $Tunnel) } else { @('http', "$Port") }
$cpArgs += @('-log=stdout', '-log-level=info')
Say "执行: $cpolar $($cpArgs -join ' ')"
$cp = $null
try {
  $cp = Start-Process -FilePath $cpolar -ArgumentList $cpArgs -WorkingDirectory $here `
    -RedirectStandardOutput $cpolarLog -RedirectStandardError "$cpolarLog.err" -PassThru -WindowStyle Hidden
} catch {
  Err2 "启动 cpolar 失败：$($_.Exception.Message)"
  if ($srv -and -not $srv.HasExited) { try { Stop-Process -Id $srv.Id -Force -ErrorAction SilentlyContinue } catch { } }
  Pause-End; exit 1
}

# 轮询 cpolar 输出里的 “Tunnel established at <url>”
$publicUrl = $null
$deadline = (Get-Date).AddSeconds(40)
while ((Get-Date) -lt $deadline -and -not $publicUrl) {
  Start-Sleep -Milliseconds 500
  if (Test-Path $cpolarLog) {
    $t = Get-Content $cpolarLog -Raw -ErrorAction SilentlyContinue
    if ($t) {
      # cpolar 的输出形如： msg="... Tunnel established at https://xxx.cpolar.top"
      # 注意末尾的引号也属于日志内容，必须排除，否则会生成带引号的坏链接（曾踩到）。
      $m = [regex]::Matches($t, 'Tunnel established at (https?://[^\s"''<>]+)')
      if ($m.Count -gt 0) {
        # 优先 https（异地的语音/视频通话要求安全上下文）
        $https = $m | ForEach-Object { $_.Groups[1].Value } | Where-Object { $_ -like 'https://*' } | Select-Object -First 1
        $publicUrl = if ($https) { $https } else { $m[0].Groups[1].Value }
      }
    }
  }
  if ($cp -and $cp.HasExited -and -not $publicUrl) { break }
}
if (-not $publicUrl) {
  Err2 '未能取得公网地址（cpolar 可能未连上或额度受限）。'
  foreach ($f in @($cpolarLog, "$cpolarLog.err")) {
    if (Test-Path $f) { $t = Get-Content $f -Raw -ErrorAction SilentlyContinue; if ($t) { Say "cpolar 输出($([IO.Path]::GetFileName($f)))："; $t.Trim().Split("`n") | Select-Object -Last 10 | ForEach-Object { Say "  $_" } } }
  }
  Say '         可手动重试： cpolar http ' + $Port
  if ($cp -and -not $cp.HasExited) { try { Stop-Process -Id $cp.Id -Force -ErrorAction SilentlyContinue } catch { } }
  if ($srv -and -not $srv.HasExited) { try { Stop-Process -Id $srv.Id -Force -ErrorAction SilentlyContinue } catch { } }
  Pause-End; exit 1
}
$publicUrl = $publicUrl.TrimEnd('/').TrimEnd('"').TrimEnd("'")   # 双保险：去掉可能的尾部引号
if ($publicUrl -notmatch '^https?://[^\s"''<>]+$') {
  Err2 "取到的公网地址不合法：$publicUrl"
  Pause-End; exit 1
}
Ok "公网地址已就绪：$publicUrl"

# 端到端确认：公网地址真的能取到页面
Head '⑤ 验证公网地址可访问'
$publicOk = $false
foreach ($i in 1..3) {
  try {
    $r = Invoke-WebRequest "$publicUrl/" -UseBasicParsing -TimeoutSec 20
    if ($r.StatusCode -eq 200) { $publicOk = $true; break }
  } catch { Start-Sleep -Milliseconds 800 }
}
if ($publicOk) { Ok '公网地址可正常访问（对方打开就能玩）' }
else { Warn2 '公网地址暂时未能确认可访问（可能刚建立，稍等片刻再让对方打开）' }

# ---------- ⑥ 展示地址与二维码 ----------
function Show-Qr([string]$text) {
  if (-not (Test-Path $qrScript)) { return }
  try { & node $qrScript $text 2>$null | ForEach-Object { Write-Host $_ } } catch { }
}

Write-Host ''
Write-Host '  ============================================================' -ForegroundColor DarkGray
Write-Host '   把这个地址（或二维码）发给异地的朋友：' -ForegroundColor White
Write-Host "      $publicUrl/" -ForegroundColor Green
Write-Host ''
Show-Qr "$publicUrl/"
Write-Host ''
Write-Host '   双方怎么开始：' -ForegroundColor White
Write-Host '     1) 你（本机）用下面这个地址打开页面（用它才能拿到公网邀请链接）：' -ForegroundColor Gray
Write-Host "          $publicUrl/" -ForegroundColor DarkGreen
Write-Host '     2) 点【在线对战】→ 选棋盘格数 → 【创建房间】' -ForegroundColor Gray
Write-Host '     3) 页面会生成【房间二维码】并自动复制邀请链接，把它发给对方' -ForegroundColor Gray
Write-Host '     4) 对方扫码或点链接即自动入局，无需输入房间号' -ForegroundColor Gray
Write-Host ''
Write-Host '   为什么必须用公网地址建房：' -ForegroundColor White
Write-Host '     · 用 127.0.0.1 打开时，复制出的邀请链接是"你本机地址"，异地打不开' -ForegroundColor Gray
Write-Host '     · 用公网地址打开，链接才会带公网域名，对方才能进' -ForegroundColor Gray
Write-Host ''
Write-Host '   注意事项：' -ForegroundColor White
Write-Host '     · 免费版 cpolar 的地址每次重启都会变，每次开局请重新发送最新链接' -ForegroundColor Gray
Write-Host '     · 公网为 https，因此【语音/视频通话】在异地也能正常使用' -ForegroundColor Gray
Write-Host '     · 对方若刷新或短暂断网，60 秒内会自动重连并恢复局面' -ForegroundColor Gray
Write-Host '  ============================================================' -ForegroundColor DarkGray
Write-Host ''
Write-Host '  关闭本窗口即停止游戏服务器与隧道。' -ForegroundColor Yellow
Write-Host "  日志：$logFile  /  $cpolarLog" -ForegroundColor DarkGray

# ---------- ⑦ 打开浏览器（用公网地址，保证邀请链接是公网的） ----------
if (-not $NoBrowser) {
  try { Start-Process "$publicUrl/" | Out-Null; Ok '已用公网地址打开浏览器' } catch { Warn2 "请手动打开 $publicUrl/" }
}

try {
  while (-not $srv.HasExited) { Start-Sleep -Milliseconds 500 }
  Warn2 '服务器进程已退出。'
} finally {
  foreach ($p in @($cp, $srv)) {
    if ($p -and -not $p.HasExited) { try { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue } catch { } }
  }
  Write-Host ''
  Write-Host '  ---- 原理速览（异地联机为什么这么设计）----' -ForegroundColor Cyan
  Write-Host '   · 为什么不能只靠局域网：两台设备不在同一个 WiFi 时，' -ForegroundColor Gray
  Write-Host '     你的 192.168.x.x 在对方那里根本不可达，必须有人做公网映射。' -ForegroundColor Gray
  Write-Host '   · cpolar 做了什么：在本机与它的公网服务器之间建一条隧道，' -ForegroundColor Gray
  Write-Host '     把 https://xxx.cpolar.top 的请求转发到你本机的 8123 端口，' -ForegroundColor Gray
  Write-Host '     于是对方访问这个域名就等于访问你的电脑（WebSocket 也一样被转发）。' -ForegroundColor Gray
  Write-Host '   · 为什么一定要用公网地址建房：邀请链接是"当前页面地址 + ?room=房间号"，' -ForegroundColor Gray
  Write-Host '     用 127.0.0.1 打开时生成的是本机链接，发给异地对方打不开。' -ForegroundColor Gray
  Write-Host '   · 连接怎么建立：页面读到链接里的 ?room=XXXXX 后，用 WebSocket 连上' -ForegroundColor Gray
  Write-Host '     同一域名的 /ws，服务器按房间号把两个连接配对。' -ForegroundColor Gray
  Write-Host '   · 谁说了算：落子是否轮到你、坐标是否合法、是否连五，都由服务器判定，' -ForegroundColor Gray
  Write-Host '     改客户端也无法作弊；断线重连用一次性 token 恢复局面。' -ForegroundColor Gray
  Write-Host '   · 语音/视频：WebRTC 需要安全上下文，cpolar 给的是 https，因此可用。' -ForegroundColor Gray
}
Pause-End

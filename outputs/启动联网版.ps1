# ============================================================
#  五子棋 · 联网版一键启动
#  ------------------------------------------------------------
#  这个脚本把一个"本机小游戏"变成"同一 WiFi 下别人也能进来玩"的联网服务。
#  它按顺序做这几件事（每一步的原理见文末说明）：
#    ① 检查 Node.js          ② 找一张可用的网卡并确定局域网 IP
#    ③ 选择端口（被占用自动顺延）
#    ④ 放行 Windows 防火墙（关键！否则手机连不上，会自动请求管理员权限）
#    ⑤ 启动服务器（监听 0.0.0.0，即所有网卡）
#    ⑥ 打印本机/局域网地址 + 终端二维码（手机扫码直接进）
#    ⑦ 打开浏览器；关闭窗口即停止服务器
#
#  用法：双击 启动联网版.bat
#  也可手动：powershell -ExecutionPolicy Bypass -File 启动联网版.ps1 [-Port 8123] [-NoBrowser] [-NoFirewall]
# ============================================================
[CmdletBinding()]
param(
  [int]$Port = 0,
  [switch]$NoBrowser,
  [switch]$NoFirewall
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$server = Join-Path $here 'gomoku-server.js'
$qrScript = Join-Path $here '..\work\qr.js'
$logDir = Join-Path $here 'logs'
$logFile = Join-Path $logDir 'server.log'

function Say($t)      { Write-Host "  $t" }
function Ok($t)       { Write-Host "  [OK]   " -NoNewline -ForegroundColor Green;   Write-Host $t }
function Warn2($t)    { Write-Host "  [提示] " -NoNewline -ForegroundColor Yellow;  Write-Host $t }
function Err2($t)     { Write-Host "  [错误] " -NoNewline -ForegroundColor Red;     Write-Host $t }
function Head($t)     { Write-Host ''; Write-Host "  $t" -ForegroundColor Cyan }
function Pause-End { if ($Host.Name -eq 'ConsoleHost') { Write-Host ''; Write-Host '  按回车键退出…' -NoNewline; [void](Read-Host) } }

function Test-PortBusy([int]$p) {
  try { $c = New-Object System.Net.Sockets.TcpClient; $c.Connect('127.0.0.1', $p); $c.Close(); return $true }
  catch { return $false }
}

Write-Host ''
Write-Host '  ==============================================' -ForegroundColor DarkCyan
Write-Host '        五子棋 · 联网版一键启动' -ForegroundColor White
Write-Host '   （同一 WiFi 下的手机/电脑都能进来一起玩）' -ForegroundColor DarkGray
Write-Host '  ==============================================' -ForegroundColor DarkCyan

# ---------- ① 检查文件与 Node ----------
Head '① 检查运行环境'
if (-not (Test-Path $server)) { Err2 "找不到 $server（请让本脚本与 gomoku-server.js 放在同一目录）"; Pause-End; exit 1 }
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
  Err2 '未检测到 Node.js。'
  Say '         安装方式（任选其一）：'
  Say '           · 官网下载 https://nodejs.org/'
  Say '           · 或执行   winget install OpenJS.NodeJS.LTS'
  Pause-End; exit 1
}
Ok "Node.js $((& node --version) 2>$null)"

# ---------- ② 找局域网 IP ----------
Head '② 识别局域网地址'
$candidates = @()
try {
  $candidates = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop |
    Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' -and $_.PrefixOrigin -ne 'WellKnown' } |
    Select-Object -ExpandProperty IPAddress -Unique
} catch {
  try {
    $candidates = (ipconfig | Select-String 'IPv4' | ForEach-Object { ($_ -split ':', 2)[1].Trim() } |
      Where-Object { $_ -notlike '127.*' -and $_ -notlike '169.254.*' } | Select-Object -Unique)
  } catch { $candidates = @() }
}

# 给每个候选地址打分，挑最可能是“真实局域网网卡”的那个。
# 教训：本机曾把 198.18.0.1（虚拟网卡/基准测试保留段）排在第一位，
#       而二维码是拿第一个地址生成的 → 手机会扫到连不上的地址。
# 打分规则（越高越优先）：
#   · 192.168.x.x  → 100（家庭/单位路由器最常见）
#   · 10.x.x.x     → 90
#   · 172.16~31.x  → 80
#   · 其它私网/全球可路由 → 40
#   · 198.18/198.19（RFC 2544 基准测试保留段，常见于虚拟网卡）→ 0，直接排除
#   · 形如 x.x.x.1 的常见网关地址降权（那通常是路由器，不是你电脑）
function Get-IpScore([string]$ip) {
  $p = $ip.Split('.')
  $a = [int]$p[0]; $b = [int]$p[1]
  if ($a -eq 198 -and ($b -eq 18 -or $b -eq 19)) { return 0 }     # 虚拟/保留段
  if ($a -eq 192 -and $b -eq 168)  { $s = 100 }
  elseif ($a -eq 10)               { $s = 90 }
  elseif ($a -eq 172 -and $b -ge 16 -and $b -le 31) { $s = 80 }
  else                             { $s = 40 }
  if ($ip.EndsWith('.1')) { $s -= 30 }                            # 多为网关
  return $s
}
$scored = $candidates | ForEach-Object { [pscustomobject]@{ Ip = $_; Score = (Get-IpScore $_) } } |
  Where-Object { $_.Score -gt 0 } | Sort-Object -Property Score -Descending
$lanIps = @($scored | Select-Object -ExpandProperty Ip)

if ($lanIps.Count -eq 0) {
  Warn2 '没有找到可用的局域网 IP（可能没连 WiFi/网线，或只有虚拟网卡）。联机功能将无法使用，单机仍可玩。'
} else {
  Ok "局域网 IP（按可用性排序）: $($lanIps -join ', ')"
  if ($candidates.Count -gt $lanIps.Count) {
    Warn2 ("已排除虚拟/保留段地址: " + (($candidates | Where-Object { $lanIps -notcontains $_ }) -join ', '))
  }
}

# ---------- ③ 端口 ----------
Head '③ 选择端口'
if ($Port -le 0) { $Port = 8123 }
$tries = 0
while ((Test-PortBusy $Port) -and $tries -lt 10) { Warn2 "端口 $Port 被占用，改用 $($Port + 1)"; $Port++; $tries++ }
if (Test-PortBusy $Port) { Err2 "端口 $Port 起仍被占用，请用 -Port 指定其它端口"; Pause-End; exit 1 }
Ok "使用端口 $Port"

# ---------- ④ 防火墙放行（联网的关键） ----------
Head '④ 检查防火墙（手机能否连上，取决于这一步）'
$ruleName = "Gomoku $Port"
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
$existing = $null
try { $existing = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue } catch { }

if ($existing) {
  Ok "防火墙规则已存在（$ruleName）"
} elseif ($NoFirewall) {
  Warn2 "已按 -NoFirewall 跳过；若手机连不上，请手动放行 TCP $Port（命令见下方原理说明）"
} elseif (-not $isAdmin) {
  Warn2 '需要管理员权限才能添加防火墙入站规则。'
  Say "         现在会弹出 UAC 授权窗口；若点了“否”，可稍后手动执行："
  Write-Host "           netsh advfirewall firewall add rule name=`"$ruleName`" dir=in action=allow protocol=TCP localport=$Port" -ForegroundColor DarkGray
  try {
    $p = Start-Process -FilePath 'powershell' -Verb RunAs -WindowStyle Hidden -PassThru -ArgumentList @(
      '-NoProfile', '-Command',
      "New-NetFirewallRule -DisplayName '$ruleName' -Direction Inbound -Action Allow -Protocol TCP -LocalPort $Port -Profile Any | Out-Null"
    )
    $p.WaitForExit()
    Start-Sleep -Milliseconds 500
    $existing = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
    if ($existing) { Ok "防火墙已放行 TCP $Port（管理员授权成功）" }
    else { Warn2 '未确认到防火墙规则（可能取消了授权）。手机可能连不上。' }
  } catch {
    Warn2 "添加防火墙规则失败：$($_.Exception.Message)"
  }
} else {
  try {
    New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Action Allow -Protocol TCP -LocalPort $Port -Profile Any | Out-Null
    Ok "防火墙已放行 TCP $Port"
  } catch { Warn2 "添加防火墙规则失败：$($_.Exception.Message)" }
}

# ---------- ⑤ 启动服务器 ----------
Head '⑤ 启动服务器（监听 0.0.0.0，即所有网卡）'
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }
$env:PORT = "$Port"
$proc = $null
try {
  $proc = Start-Process -FilePath 'node' -ArgumentList @($server) -WorkingDirectory $here `
    -RedirectStandardOutput $logFile -RedirectStandardError "$logFile.err" -PassThru -WindowStyle Hidden
} catch {
  Err2 "启动 node 失败：$($_.Exception.Message)"
  Say '         可在本目录手动执行： node gomoku-server.js'
  Pause-End; exit 1
}
$ready = $false
$deadline = (Get-Date).AddSeconds(15)
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Milliseconds 300
  if (Test-PortBusy $Port) { $ready = $true; break }
  if ($proc.HasExited) { break }
}
# 端口在监听 ≠ 页面真的能访问，再用一次真实 HTTP 请求确认（端到端）。
$httpOk = $false
if ($ready) {
  foreach ($try in 1..3) {
    try {
      $resp = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/" -UseBasicParsing -TimeoutSec 6
      if ($resp.StatusCode -eq 200) { $httpOk = $true; break }
    } catch { Start-Sleep -Milliseconds 500 }
  }
}
if (-not $httpOk) {
  Err2 '服务器没能正常提供页面。'
  if ($proc.HasExited) { Say "         node 进程已退出（退出码 $($proc.ExitCode)）。" }
  else { Say '         端口可能被安全软件/沙箱拦截，或进程启动后被终止。' }
  foreach ($f in @("$logFile.err", $logFile)) {
    if (Test-Path $f) { $t = Get-Content $f -Raw -ErrorAction SilentlyContinue; if ($t) { Say "日志($([IO.Path]::GetFileName($f)))："; $t.Trim().Split("`n") | Select-Object -Last 8 | ForEach-Object { Say "  $_" } } }
  }
  Say '         可手动排查：在本目录执行  node gomoku-server.js  看完整输出。'
  if ($proc -and -not $proc.HasExited) { try { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue } catch { } }
  Pause-End; exit 1
}
Ok "服务器已启动并已确认页面可访问（进程 $($proc.Id)）"

# ---------- ⑥ 打印地址 + 二维码 ----------
$localUrl = "http://127.0.0.1:$Port/"
function Show-Qr([string]$text) {
  if (-not (Test-Path $qrScript)) { return }
  try {
    $out = & node $qrScript $text 2>$null
    if ($out) { $out | ForEach-Object { Write-Host $_ } }
  } catch { }
}

Write-Host ''
Write-Host '  ============================================================' -ForegroundColor DarkGray
Write-Host '   ① 本机自己玩' -ForegroundColor White
Write-Host "      $localUrl" -ForegroundColor Green
Write-Host ''
if ($lanIps.Count -gt 0) {
  $lanUrl = "http://$($lanIps[0]):$Port/"
  Write-Host '   ② 手机 / 同 WiFi 的朋友（扫码或输网址）' -ForegroundColor White
  Write-Host "      $lanUrl" -ForegroundColor Green
  foreach ($ip in ($lanIps | Select-Object -Skip 1)) { Write-Host "      http://${ip}:$Port/" -ForegroundColor DarkGreen }
  Write-Host ''
  Show-Qr $lanUrl
} else {
  Warn2 '未找到局域网 IP，无法生成联机二维码。'
}
Write-Host ''
Write-Host '   联机怎么玩：' -ForegroundColor White
Write-Host '     1) 本机页面点【在线对战】→ 选好棋盘格数 → 【创建房间】' -ForegroundColor Gray
Write-Host '     2) 页面会自动复制邀请链接，右侧也会显示【房间二维码】' -ForegroundColor Gray
Write-Host '     3) 把那个二维码或链接发给对方，他打开即自动入局（无需输房间号）' -ForegroundColor Gray
Write-Host ''
Write-Host '   异地朋友（不在同一 WiFi）？' -ForegroundColor White
Write-Host '     需要内网穿透。若已装 cpolar，另开一个窗口执行：' -ForegroundColor Gray
Write-Host "       cpolar http $Port" -ForegroundColor DarkGray
Write-Host '     然后把 cpolar 给的 https 公网地址（形如 https://xxx.r1.cpolar.cn）发给对方；' -ForegroundColor Gray
Write-Host '     在自己页面里点【复制链接】时，请用那个公网地址打开页面再建房，链接才会带公网域名。' -ForegroundColor Gray
Write-Host '  ============================================================' -ForegroundColor DarkGray
Write-Host ''
Write-Host '  关闭本窗口即停止服务器。' -ForegroundColor Yellow
Write-Host "  运行日志：$logFile" -ForegroundColor DarkGray

# ---------- ⑦ 打开浏览器 ----------
if (-not $NoBrowser) {
  try { Start-Process $localUrl | Out-Null; Ok '已打开浏览器' } catch { Warn2 "请手动打开 $localUrl" }
}

try {
  while (-not $proc.HasExited) { Start-Sleep -Milliseconds 500 }
  Warn2 '服务器进程已退出。'
} finally {
  if ($proc -and -not $proc.HasExited) {
    Say '正在停止服务器…'
    try { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue } catch { }
  }
  Write-Host ''
  Write-Host '  ---- 原理速览（这个脚本为什么这么做）----' -ForegroundColor Cyan
  Write-Host '   · 服务器监听 0.0.0.0：bind 到"所有网卡"，而不只是本机回环，' -ForegroundColor Gray
  Write-Host '     这样同一局域网里的手机才能通过你的内网 IP 连上来。' -ForegroundColor Gray
  Write-Host '   · 必须放行防火墙：Windows 默认拦截外部主动连入的端口，' -ForegroundColor Gray
  Write-Host '     没有入站规则时，本机能打开但手机一定连不上（最常见的坑）。' -ForegroundColor Gray
  Write-Host '   · 局域网 IP：手机要访问的是你电脑在这张网里的地址（192.168.x.x），' -ForegroundColor Gray
  Write-Host '     不是 127.0.0.1（那个只代表手机自己）。' -ForegroundColor Gray
  Write-Host '   · 房间机制：服务器进程内存里维护"房间号 → 两个连接"，' -ForegroundColor Gray
  Write-Host '     链接里的 ?room=XXXXX 会被页面读出来自动加入，所以对方不用手输房间号。' -ForegroundColor Gray
  Write-Host '   · 实时同步：浏览器与服务之间是 WebSocket 长连接，落子即时双向推送；' -ForegroundColor Gray
  Write-Host '     服务端是权威（校验回合、坐标、连五），客户端无法作弊。' -ForegroundColor Gray
  Write-Host '   · 异地玩法：局域网 IP 出了这个网就不可达，所以要 cpolar 之类的内网穿透' -ForegroundColor Gray
  Write-Host '     把本机端口映射成公网 https 地址，再用那个地址建房发链接。' -ForegroundColor Gray
}
Pause-End

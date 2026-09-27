<#
Start the analyzer plus a Cloudflare tunnel so it is reachable over HTTPS from anywhere
(phones need HTTPS for the camera, and the member portal's Analyze tab proxies to it).

  .\start-remote.ps1              start (or restart) both, print the private link
  .\start-remote.ps1 -NewKey      same, with a fresh access key (old links stop working;
                                  also update the portal secret, see README "Member portal")
  .\start-remote.ps1 -Quick       use a temporary trycloudflare.com quick tunnel instead
  .\stop-remote.ps1               stop both

Tunnel modes:
  * Named tunnel (default when .tunnel-token exists): the separate "sio-analyzer-origin"
    Cloudflare Tunnel, always at https://analyzer-origin.stickitoutdrums.com. Its ingress
    (set in Cloudflare) forwards to http://127.0.0.1:8800, so the server must use port 8800.
    This is the origin the member portal (member.stickitoutdrums.com/analyze) uses.
  * Quick tunnel (-Quick, or no .tunnel-token): a new random trycloudflare.com address on
    every start. No Cloudflare account needed. The portal tab does not follow it.

Both processes run detached and keep running after this window closes. The link only
works while this PC is on, awake and online. The server keeps the PC from sleeping while
it runs (the screen can still turn off). The key stays the same unless you pass -NewKey.
This script never touches any other cloudflared on this PC (for example the separate
tunnel service): it only starts and stops processes whose command line is provably ours.
#>
param(
    [int]$Port = 8800,
    [int]$MaxUploadMB = 1024,   # slow motion is 200 to 300 MB; files over 80 MB go up in 64 MB pieces (Cloudflare caps one request at 100 MB)
    [switch]$NewKey,
    [switch]$Quick,
    [string]$StableHost = 'analyzer-origin.stickitoutdrums.com'
)
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$logs = Join-Path $root 'logs'
$tokenFile = Join-Path $root '.remote-token'
$tunnelTokenFile = Join-Path $root '.tunnel-token'
$named = (-not $Quick) -and (Test-Path $tunnelTokenFile)
$NamedPort = 8800   # must match the tunnel's ingress in Cloudflare
New-Item -ItemType Directory -Force -Path $logs | Out-Null

if ($named -and $Port -ne $NamedPort) {
    throw "The named tunnel forwards to port $NamedPort. Run without -Port, or use -Quick for another port."
}

& (Join-Path $root 'stop-remote.ps1') -Port $Port -Quiet

if ($NewKey -or -not (Test-Path $tokenFile)) {
    $bytes = New-Object byte[] 24
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $token = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
    Set-Content -Path $tokenFile -Value $token -NoNewline -Encoding ascii
    if ($named) {
        Write-Host 'New access key: the member portal needs it too. Run from the Stickitout folder:' -ForegroundColor Yellow
        Write-Host '  Get-Content -Raw ..\Stickitout-analyzer\.remote-token | npx wrangler secret put ANALYZER_TOKEN --config workers/app/wrangler.jsonc'
    }
}
$token = (Get-Content -Raw $tokenFile).Trim()

function Find-Cloudflared {
    $cmd = Get-Command cloudflared -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    $candidates = @(
        "$env:LOCALAPPDATA\Microsoft\WinGet\Links\cloudflared.exe",
        "${env:ProgramFiles(x86)}\cloudflared\cloudflared.exe",
        "$env:ProgramFiles\cloudflared\cloudflared.exe"
    )
    $found = $candidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
    if ($found) { return $found }
    $pkg = Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages" -Filter cloudflared*.exe -Recurse -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if ($pkg) { return $pkg.FullName }
    return $null
}

$cloudflared = Find-Cloudflared
if (-not $cloudflared) {
    Write-Host 'cloudflared not found, installing it with winget...'
    winget install --id Cloudflare.cloudflared -e --silent --accept-source-agreements --accept-package-agreements | Out-Host
    $cloudflared = Find-Cloudflared
    if (-not $cloudflared) { throw 'cloudflared is still missing after winget install. Open a new PowerShell window and try again.' }
}

# Win32_Process.Create starts processes outside this shell's job, so they outlive it.
function Start-Detached([string]$commandLine) {
    $r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
        CommandLine = $commandLine; CurrentDirectory = $root }
    if ($r.ReturnValue -ne 0) { throw "Could not start: $commandLine (code $($r.ReturnValue))" }
    return [int]$r.ProcessId
}

$serve = Join-Path $root 'scripts\serve-remote.ps1'
$serverPid = Start-Detached "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$serve`" -Port $Port -MaxUploadMB $MaxUploadMB"

$healthy = $false
for ($i = 0; $i -lt 60 -and -not $healthy; $i++) {
    Start-Sleep -Seconds 1
    try { $healthy = (Invoke-RestMethod "http://127.0.0.1:$Port/healthz" -TimeoutSec 2).ok } catch { }
}
if (-not $healthy) { throw "The analyzer did not start. See $logs\server.log" }

# A free local port for cloudflared's metrics endpoint (the default 20241 may belong to
# another cloudflared already running on this PC, e.g. a named tunnel service).
$probe = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
$probe.Start(); $metricsPort = $probe.LocalEndpoint.Port; $probe.Stop()

$tunnelLog = Join-Path $logs 'tunnel.log'
Remove-Item $tunnelLog -ErrorAction SilentlyContinue

if ($named) {
    # The token is read from .tunnel-token (gitignored), so it never appears on a command line.
    $tunnelPid = Start-Detached "`"$cloudflared`" tunnel --no-autoupdate --metrics 127.0.0.1:$metricsPort --logfile `"$tunnelLog`" run --token-file `"$tunnelTokenFile`""
    $ready = $false
    for ($i = 0; $i -lt 45 -and -not $ready; $i++) {
        Start-Sleep -Seconds 1
        try { $ready = (Invoke-WebRequest "http://127.0.0.1:$metricsPort/ready" -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200 } catch { }
    }
    if (-not $ready -or -not (Get-Process -Id $tunnelPid -ErrorAction SilentlyContinue)) {
        throw "The named tunnel did not connect. See $tunnelLog"
    }
    $hostname = $StableHost
    $mode = 'named'
} else {
    $tunnelPid = Start-Detached "`"$cloudflared`" tunnel --no-autoupdate --metrics 127.0.0.1:$metricsPort --logfile `"$tunnelLog`" --url http://127.0.0.1:$Port"
    $hostname = $null
    for ($i = 0; $i -lt 60 -and -not $hostname; $i++) {
        Start-Sleep -Seconds 1
        try { $hostname = (Invoke-RestMethod "http://127.0.0.1:$metricsPort/quicktunnel" -TimeoutSec 2).hostname } catch { }
        if (-not $hostname -and (Test-Path $tunnelLog)) {
            $m = Select-String -Path $tunnelLog -Pattern 'https://([a-z0-9-]+\.trycloudflare\.com)' | Select-Object -First 1
            if ($m) { $hostname = $m.Matches[0].Groups[1].Value }
        }
    }
    Start-Sleep -Seconds 3
    if (-not $hostname -or -not (Get-Process -Id $tunnelPid -ErrorAction SilentlyContinue)) {
        throw "The tunnel did not start. See $tunnelLog"
    }
    $mode = 'quick'
}

$link = "https://$hostname/?key=$token"
@{ server = $serverPid; tunnel = $tunnelPid; port = $Port; mode = $mode; started = (Get-Date).ToString('s') } |
    ConvertTo-Json | Set-Content (Join-Path $logs 'remote.pids.json')
Set-Content -Path (Join-Path $root 'remote-url.txt') -Value $link

Write-Host ''
Write-Host "Analyzer is live ($mode tunnel):" -ForegroundColor Green
Write-Host "  $link"
if ($named) {
    Write-Host '  Stable address, same after every restart. Members use it through https://member.stickitoutdrums.com/analyze'
} else {
    Write-Host '  (it can take up to a minute before the address resolves; the portal Analyze tab does not use quick tunnels)'
}
Write-Host "  Saved to remote-url.txt. Stop with .\stop-remote.ps1   Logs: $logs"

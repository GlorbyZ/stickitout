<#
Start the analyzer plus a Cloudflare quick tunnel so it is reachable over HTTPS from
anywhere (phones need HTTPS for the camera). No Cloudflare account is needed.

  .\start-remote.ps1              start (or restart) both, print the private link
  .\start-remote.ps1 -NewKey      same, with a fresh access key (old links stop working)
  .\stop-remote.ps1               stop both

Both run detached in the background and keep running after this window closes.
The link only works while this PC is on, awake and online. The server keeps the PC
from sleeping while it runs (the screen can still turn off); a closed laptop lid may
still sleep depending on power settings. Every restart gives a new trycloudflare.com
address; the key stays the same unless you pass -NewKey.
#>
param(
    [int]$Port = 8800,
    [int]$MaxUploadMB = 95,   # Cloudflare rejects request bodies over 100 MB
    [switch]$NewKey
)
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$logs = Join-Path $root 'logs'
$tokenFile = Join-Path $root '.remote-token'
New-Item -ItemType Directory -Force -Path $logs | Out-Null

& (Join-Path $root 'stop-remote.ps1') -Port $Port -Quiet

if ($NewKey -or -not (Test-Path $tokenFile)) {
    $bytes = New-Object byte[] 24
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $token = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
    Set-Content -Path $tokenFile -Value $token -NoNewline -Encoding ascii
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

$link = "https://$hostname/?key=$token"
@{ server = $serverPid; tunnel = $tunnelPid; port = $Port; started = (Get-Date).ToString('s') } |
    ConvertTo-Json | Set-Content (Join-Path $logs 'remote.pids.json')
Set-Content -Path (Join-Path $root 'remote-url.txt') -Value $link

Write-Host ''
Write-Host 'Analyzer is live:' -ForegroundColor Green
Write-Host "  $link"
Write-Host "  (saved to remote-url.txt; it can take up to a minute before the address resolves)"
Write-Host "  Stop with .\stop-remote.ps1   Logs: $logs"

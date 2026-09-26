<#
Restart only the analyzer server started by start-remote.ps1 (for example after a code
change). The Cloudflare tunnel (named analyzer-origin.stickitoutdrums.com, or a quick tunnel)
keeps running, so the link and the
key in remote-url.txt stay the same.

  .\restart-server.ps1

If no tunnel from start-remote.ps1 is running, use .\start-remote.ps1 instead.
Only processes that are provably the analyzer server (checked by command line) are
stopped; cloudflared processes are never touched.
#>
param(
    [int]$Port = 8800,
    [int]$MaxUploadMB = 95   # same default as start-remote.ps1 (Cloudflare caps bodies at 100 MB)
)
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$pidFile = Join-Path $root 'logs\remote.pids.json'

function Test-Server($proc) {
    $cmd = [string]$proc.CommandLine
    ($cmd -like '*serve-remote.ps1*' -and $cmd -like "*-Port $Port*") -or
    ($proc.Name -like 'python*' -and $cmd -like '*uvicorn app.main:app*' -and $cmd -like "*--port $Port*")
}

$saved = if (Test-Path $pidFile) { Get-Content -Raw $pidFile | ConvertFrom-Json } else { $null }
$ids = @()
if ($saved) { $ids += @($saved.server) }
$ids += @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess)
$ids += @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
    Where-Object { [string]$_.CommandLine -like '*serve-remote.ps1*' } | Select-Object -ExpandProperty ProcessId)

$stopped = 0
foreach ($id in ($ids | Where-Object { $_ } | Sort-Object -Unique)) {
    $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$id" -ErrorAction SilentlyContinue
    if ($proc -and (Test-Server $proc)) {
        & taskkill.exe /PID $id /T /F *> $null
        $stopped++
    }
}
for ($i = 0; $i -lt 20 -and (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue); $i++) {
    Start-Sleep -Milliseconds 500
}
if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) {
    throw "Port $Port is still in use by another program, so the analyzer was not restarted."
}

$serve = Join-Path $root 'scripts\serve-remote.ps1'
$r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
    CommandLine = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$serve`" -Port $Port -MaxUploadMB $MaxUploadMB"
    CurrentDirectory = $root }
if ($r.ReturnValue -ne 0) { throw "Could not start the server (code $($r.ReturnValue))" }
$serverPid = [int]$r.ProcessId

$healthy = $false
for ($i = 0; $i -lt 60 -and -not $healthy; $i++) {
    Start-Sleep -Seconds 1
    try { $healthy = (Invoke-RestMethod "http://127.0.0.1:$Port/healthz" -TimeoutSec 2).ok } catch { }
}
if (-not $healthy) { throw "The analyzer did not start. See $root\logs\server.log" }

$tunnelPid = if ($saved) { $saved.tunnel } else { $null }
@{ server = $serverPid; tunnel = $tunnelPid; port = $Port; started = (Get-Date).ToString('s') } |
    ConvertTo-Json | Set-Content $pidFile

Write-Host "Stopped $stopped server process(es); analyzer restarted (pid $serverPid)." -ForegroundColor Green
$tunnelAlive = $tunnelPid -and (Get-Process -Id $tunnelPid -ErrorAction SilentlyContinue)
$urlFile = Join-Path $root 'remote-url.txt'
if ($tunnelAlive -and (Test-Path $urlFile)) {
    Write-Host "  Tunnel untouched, link unchanged: $((Get-Content -Raw $urlFile).Trim())"
} else {
    Write-Host '  No tunnel from start-remote.ps1 is running; run .\start-remote.ps1 for a public link.' -ForegroundColor Yellow
}

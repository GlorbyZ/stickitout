# Stop the analyzer server and the Cloudflare tunnel started by start-remote.ps1 (named or quick).
# Only processes that are provably ours are stopped (checked by command line), so a reused
# process id or another cloudflared on this PC (e.g. the separate tunnel service that runs with
# its own --token) is never touched:
#   * the server wrapper (scripts\serve-remote.ps1) and its uvicorn on this port
#   * cloudflared reading this folder's .tunnel-token (named tunnel)
#   * cloudflared quick tunnel to this port that logs into this folder's logs\
param([int]$Port = 8800, [switch]$Quiet)
$root = $PSScriptRoot
$pidFile = Join-Path $root 'logs\remote.pids.json'
$tunnelTokenFile = Join-Path $root '.tunnel-token'
$logDir = Join-Path $root 'logs'

function Test-Ours($proc) {
    $cmd = [string]$proc.CommandLine
    ($cmd -like '*serve-remote.ps1*') -or
    ($proc.Name -eq 'cloudflared.exe' -and $cmd -like "*--token-file*" -and $cmd -like "*$tunnelTokenFile*") -or
    ($proc.Name -eq 'cloudflared.exe' -and $cmd -like "*--url http://127.0.0.1:$Port*" -and $cmd -like "*$logDir*") -or
    ($proc.Name -like 'python*' -and $cmd -like '*uvicorn app.main:app*' -and $cmd -like "*--port $Port*")
}

$ids = @()
if (Test-Path $pidFile) {
    $saved = Get-Content -Raw $pidFile | ConvertFrom-Json
    $ids += @($saved.server, $saved.tunnel)
}
$ids += @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess)
$ids += @(Get-CimInstance Win32_Process -Filter "Name='cloudflared.exe'" -ErrorAction SilentlyContinue | Select-Object -ExpandProperty ProcessId)
$ids += @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
    Where-Object { [string]$_.CommandLine -like '*serve-remote.ps1*' } | Select-Object -ExpandProperty ProcessId)

$stopped = 0
foreach ($id in ($ids | Where-Object { $_ } | Sort-Object -Unique)) {
    $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$id" -ErrorAction SilentlyContinue
    if ($proc -and (Test-Ours $proc)) {
        & taskkill.exe /PID $id /T /F *> $null
        $stopped++
    }
}
Remove-Item $pidFile -ErrorAction SilentlyContinue
Remove-Item (Join-Path $root 'remote-url.txt') -ErrorAction SilentlyContinue
if (-not $Quiet) { Write-Host "Stopped $stopped process(es). The portal Analyze tab now shows its offline message." }

# Stop the analyzer server and Cloudflare tunnel started by start-remote.ps1.
# Only processes that are provably ours are stopped (checked by command line), so a
# reused process id or another cloudflared on this PC (e.g. a named tunnel service)
# is never touched.
param([int]$Port = 8800, [switch]$Quiet)
$root = $PSScriptRoot
$pidFile = Join-Path $root 'logs\remote.pids.json'

function Test-Ours($proc) {
    $cmd = [string]$proc.CommandLine
    ($cmd -like '*serve-remote.ps1*') -or
    ($proc.Name -eq 'cloudflared.exe' -and $cmd -like "*--url http://127.0.0.1:$Port*") -or
    ($proc.Name -like 'python*' -and $cmd -like '*uvicorn app.main:app*' -and $cmd -like "*--port $Port*")
}

$ids = @()
if (Test-Path $pidFile) {
    $saved = Get-Content -Raw $pidFile | ConvertFrom-Json
    $ids += @($saved.server, $saved.tunnel)
}
$ids += @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess)
$ids += @(Get-CimInstance Win32_Process -Filter "Name='cloudflared.exe'" -ErrorAction SilentlyContinue | Select-Object -ExpandProperty ProcessId)

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
if (-not $Quiet) { Write-Host "Stopped $stopped process(es)." }

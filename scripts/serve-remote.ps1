# Server half of start-remote.ps1 (runs hidden): loads the access key, keeps the PC
# awake while the server runs, and runs uvicorn with its output in logs\server.log.
param([Parameter(Mandatory = $true)][int]$Port, [Parameter(Mandatory = $true)][int]$MaxUploadMB)
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$env:ACCESS_TOKEN = (Get-Content -Raw (Join-Path $root '.remote-token')).Trim()
$env:PORT = "$Port"
$env:MAX_UPLOAD_MB = "$MaxUploadMB"
if (Test-Path (Join-Path $root 'tuning.temp.json')) { $env:SIO_TEMP_TRAINING = '1' }
Add-Type -Namespace SIO -Name Power -MemberDefinition '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint esFlags);'
[void][SIO.Power]::SetThreadExecutionState([uint32]2147483649)  # ES_CONTINUOUS | ES_SYSTEM_REQUIRED
$python = Join-Path $root '.venv\Scripts\python.exe'
& cmd.exe /c "`"$python`" -m uvicorn app.main:app --host 127.0.0.1 --port $Port --proxy-headers > logs\server.log 2>&1"

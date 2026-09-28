# Run the analyzer on this computer only (foreground). Open http://127.0.0.1:8800/
# Ctrl+C stops it. For a phone or remote link use start-remote.ps1 instead.
# Set CLIP_SHARE to a shared-drive folder before starting. Finished videos there are
# copied into DATASET_DIR. You do not move the files yourself.
param([int]$Port = 8800)
$root = $PSScriptRoot
Set-Location $root
$env:PORT = "$Port"
& "$root\.venv\Scripts\python.exe" -m uvicorn app.main:app --host 127.0.0.1 --port $Port

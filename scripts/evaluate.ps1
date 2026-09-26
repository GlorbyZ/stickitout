<#
Measure analyzer accuracy on the labeled training clips (wrapper for scripts\evaluate.py).
Uses the project's .venv Python and passes every option through unchanged.

  .\scripts\evaluate.ps1                                   all clips marked Done
  .\scripts\evaluate.ps1 --include-drafts                  also clips still being labeled
  .\scripts\evaluate.ps1 --set onset_threshold=0.25        try one setting
  .\scripts\evaluate.ps1 --grid onset_threshold=0.2,0.3,0.4 --grid min_ioi_ms=30,40
  .\scripts\evaluate.ps1 --compare-to reports\eval-20260926-150000
  .\scripts\evaluate.ps1 --compare reports\eval-A reports\eval-B
  .\scripts\evaluate.ps1 -Open                             open report.html when done

Reports go to reports\eval-<timestamp>\ (report.md, report.html, clips.csv, summary.json).
The dataset folder is DATASET_DIR, by default data\jobs\dataset. This script only reads the
dataset and writes reports; it never restarts the server or touches the tunnel.
#>
param(
    [switch]$Open,
    [Parameter(ValueFromRemainingArguments = $true)][object[]]$Rest
)
$ErrorActionPreference = 'Stop'
# PowerShell turns an unquoted list such as onset_threshold=0.2,0.3 into an array; join it back.
$pass = @(foreach ($a in $Rest) { if ($a -is [array]) { ($a | ForEach-Object { "$_" }) -join ',' } else { "$a" } })
$root = Split-Path -Parent $PSScriptRoot
$python = Join-Path $root '.venv\Scripts\python.exe'
if (-not (Test-Path $python)) { $python = 'python' }
$env:PYTHONIOENCODING = 'utf-8'
$before = @(Get-ChildItem (Join-Path $root 'reports') -Directory -ErrorAction SilentlyContinue | Select-Object -ExpandProperty FullName)
Push-Location $root
$ErrorActionPreference = 'Continue'   # MediaPipe logs to stderr; that is not a failure
try {
    & $python (Join-Path $root 'scripts\evaluate.py') @pass
    $code = $LASTEXITCODE
} finally {
    Pop-Location
}
if ($Open -and $code -eq 0) {
    $new = Get-ChildItem (Join-Path $root 'reports') -Directory -ErrorAction SilentlyContinue |
        Where-Object { $before -notcontains $_.FullName } | Sort-Object LastWriteTime | Select-Object -Last 1
    if ($new) {
        $html = Get-ChildItem $new.FullName -Recurse -Filter report.html | Select-Object -First 1
        if ($html) { Start-Process $html.FullName } else { Start-Process $new.FullName }
    }
}
exit $code

$ErrorActionPreference = 'Stop'
$pythonPath = Join-Path $PSScriptRoot '.venv\Scripts\python.exe'
$envPath = Join-Path $PSScriptRoot '.env'

if (-not (Test-Path -LiteralPath $pythonPath)) {
    throw 'Missing .venv. Run setup-windows.ps1 first.'
}
if (-not (Test-Path -LiteralPath $envPath)) {
    throw 'Missing .env. Configure it using .env.example first.'
}

Push-Location $PSScriptRoot
$previousPythonPath = $env:PYTHONPATH
if ($previousPythonPath) {
    $env:PYTHONPATH = "$(Split-Path -Parent $PSScriptRoot);$previousPythonPath"
} else {
    $env:PYTHONPATH = Split-Path -Parent $PSScriptRoot
}
try {
    & $pythonPath -m uvicorn archive_worker:app --env-file $envPath --host 127.0.0.1 --port 8089 --workers 1 --no-access-log
    if ($LASTEXITCODE -ne 0) { throw 'Archive worker stopped with an error.' }
} finally {
    $env:PYTHONPATH = $previousPythonPath
    Pop-Location
}

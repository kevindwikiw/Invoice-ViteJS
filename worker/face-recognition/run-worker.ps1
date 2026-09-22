$ErrorActionPreference = 'Stop'

$workerRoot = $PSScriptRoot
$pythonPath = Join-Path $workerRoot '.venv-ml\Scripts\python.exe'
$envPath = Join-Path $workerRoot '.env'

if (-not (Test-Path -LiteralPath $pythonPath)) {
    Write-Error 'Missing .venv-ml. Run setup-windows.ps1 first.'
}
if (-not (Test-Path -LiteralPath $envPath)) {
    Write-Error 'Missing worker .env. Copy .env.example and configure matching server tokens first.'
}

Push-Location $workerRoot
try {
    & $pythonPath -m uvicorn main:app --env-file $envPath --host 127.0.0.1 --port 8088 --workers 1
    if ($LASTEXITCODE -ne 0) { throw 'Face worker stopped with an error.' }
} finally {
    Pop-Location
}

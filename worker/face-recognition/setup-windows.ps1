param([string]$Python = 'python')
$ErrorActionPreference = 'Stop'

Push-Location $PSScriptRoot
try {
    & $Python -c "import sys,struct; assert (3,11) <= sys.version_info[:2] <= (3,13) and struct.calcsize('P') == 8, 'Use Python 3.11-3.13 x64'"
    if ($LASTEXITCODE -ne 0) { throw 'Unsupported Python interpreter.' }
    if (-not (Test-Path -LiteralPath '.venv-ml\Scripts\python.exe')) {
        & $Python -m venv .venv-ml
        if ($LASTEXITCODE -ne 0) { throw 'Could not create .venv-ml.' }
    }
    & .\.venv-ml\Scripts\python.exe -m pip install --only-binary=:all: -r requirements.txt
    if ($LASTEXITCODE -ne 0) { throw 'Wheel installation failed. No source compilation was attempted.' }
    & .\.venv-ml\Scripts\python.exe model_assets.py
    if ($LASTEXITCODE -ne 0) { throw 'Model download or checksum verification failed.' }
    & .\check-worker.ps1
} finally {
    Pop-Location
}

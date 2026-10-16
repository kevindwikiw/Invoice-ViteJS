param([string]$Python = 'python')
$ErrorActionPreference = 'Stop'

Push-Location $PSScriptRoot
try {
    if (-not (Test-Path -LiteralPath '.venv\Scripts\python.exe')) {
        & $Python -m venv .venv
        if ($LASTEXITCODE -ne 0) { throw 'Could not create the archive worker virtual environment.' }
    }
    & .\.venv\Scripts\python.exe -m pip install --only-binary=:all: -r requirements.txt
    if ($LASTEXITCODE -ne 0) { throw 'Archive dependency installation failed.' }
} finally {
    Pop-Location
}

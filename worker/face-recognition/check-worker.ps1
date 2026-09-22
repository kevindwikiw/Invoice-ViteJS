$ErrorActionPreference = 'Stop'

$workerRoot = $PSScriptRoot
$pythonPath = Join-Path $workerRoot '.venv-ml\Scripts\python.exe'

if (-not (Test-Path -LiteralPath $pythonPath)) {
    Write-Error 'Missing .venv-ml. Run setup-windows.ps1 first (Python 3.11-3.13 x64).'
}

@'
import importlib
import sys
from pathlib import Path

required = ("fastapi", "httpx", "cv2", "numpy", "PIL", "uvicorn", "dotenv", "python_multipart")
missing = []
for name in required:
    try:
        importlib.import_module(name)
    except ImportError:
        missing.append(name)
print(f"Python: {sys.version.split()[0]}")
print("Face worker dependencies: " + ("ready" if not missing else "missing " + ", ".join(missing)))
raise SystemExit(1 if missing else 0)
'@ | & $pythonPath -
if ($LASTEXITCODE -ne 0) { throw 'Worker dependency check failed.' }
Push-Location $workerRoot
try {
    & $pythonPath -c "from dotenv import load_dotenv; load_dotenv(); from main import load_face_app_sync; load_face_app_sync(); print('Model checksum and warm-up: ready')"
    if ($LASTEXITCODE -ne 0) { throw 'Worker model check failed.' }
} finally {
    Pop-Location
}

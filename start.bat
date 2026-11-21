@echo off
setlocal
rem Run uv from the repo root so it does not try to inspect the blocked backend\.venv
cd /d "%~dp0"
rem An activated venv in the calling shell would make uv use the blocked interpreter
set "VIRTUAL_ENV="

rem Backend runs on the uv-managed Python directly, because Application Control
rem blocks backend\.venv\Scripts\python.exe. Packages live in backend\.venv\Lib\site-packages.
for /f "delims=" %%P in ('uv python find 3.12') do set "PY=%%P"
if not defined PY (
  echo Python 3.12 not found. Run: uv python install 3.12
  exit /b 1
)

if not exist "%~dp0backend\.venv\Lib\site-packages\uvicorn" (
  echo Installing backend dependencies...
  uv pip install --python "%PY%" --target "%~dp0backend\.venv\Lib\site-packages" -r "%~dp0backend\pyproject.toml"
)

start "backend" cmd /k "cd /d %~dp0backend && set PYTHONPATH=.venv\Lib\site-packages;. && "%PY%" -m uvicorn src.main:app --reload --port 8000"
start "frontend" cmd /k "cd /d %~dp0frontend && npm run dev"

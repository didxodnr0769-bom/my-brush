@echo off
setlocal
cd /d "%~dp0"

if exist ".venv\Scripts\python.exe" goto dependencies

py -3.12 -c "import sys; raise SystemExit(sys.version_info < (3, 10))" >nul 2>&1
if not errorlevel 1 (
    py -3.12 -m venv .venv
    if errorlevel 1 goto failure
    goto dependencies
)

py -3 -c "import sys; raise SystemExit(sys.version_info < (3, 10))" >nul 2>&1
if not errorlevel 1 (
    py -3 -m venv .venv
    if errorlevel 1 goto failure
    goto dependencies
)

python -c "import sys; raise SystemExit(sys.version_info < (3, 10))" >nul 2>&1
if errorlevel 1 (
    echo Python 3.10 or later is required. Python 3.12 is recommended.
    goto failure
)
python -m venv .venv
if errorlevel 1 goto failure

:dependencies
".venv\Scripts\python.exe" -c "from importlib.metadata import version; import PySide6.QtWidgets; assert version('PySide6-Essentials') == '6.12.0'" >nul 2>&1
if not errorlevel 1 goto launch
".venv\Scripts\python.exe" -m pip install -r requirements.txt
if errorlevel 1 goto failure

:launch
".venv\Scripts\python.exe" desktop_main.py
if errorlevel 1 goto failure
exit /b 0

:failure
echo My Brush could not start. Review the message above.
pause
exit /b 1

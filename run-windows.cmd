@echo off
setlocal
cd /d "%~dp0"
node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a<22||(a===22&&b<12)?1:0)" >nul 2>&1
if errorlevel 1 (
    echo Node.js 22.12 or later is required. Node.js 24 LTS is recommended.
    goto failure
)
if not exist "node_modules\electron\dist\electron.exe" (
    call npm ci
    if errorlevel 1 goto failure
)
call npm start -- %*
if errorlevel 1 goto failure
exit /b 0
:failure
pause
exit /b 1

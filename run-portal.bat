@echo off
setlocal EnableExtensions
cd /d "%~dp0"

title 09Test Portal
echo.
echo ========================================
echo             09Test Portal
echo ========================================
echo.

where node >nul 2>nul
if errorlevel 1 (
    echo ERROR: Node.js 20 or newer is not installed or is not available in PATH.
    goto :failed
)

where npm >nul 2>nul
if errorlevel 1 (
    echo ERROR: npm is not available in PATH.
    goto :failed
)

if not exist ".env" (
    echo First-run configuration
    echo.
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\scripts\initialize_env.ps1"
    if errorlevel 1 goto :failed
)

if not exist "node_modules\express\package.json" (
    echo Installing portal dependencies...
    call npm install
    if errorlevel 1 goto :failed
)

where python >nul 2>nul
if errorlevel 1 (
    echo ERROR: Python 3 is not installed or is not available in PATH.
    goto :failed
)

if not exist ".venv\Scripts\python.exe" (
    echo Creating the portal Python environment...
    python -m venv ".venv"
    if errorlevel 1 goto :failed
)

".venv\Scripts\python.exe" -c "import requests" >nul 2>nul
if errorlevel 1 (
    echo Installing mk2 deployment dependencies...
    call :install_python_dependencies
    if errorlevel 1 goto :failed
)

echo Starting 09Test Portal at http://localhost:24247
echo Close this window or press Ctrl+C to stop the portal.
echo.

start "" /b powershell.exe -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 2; Start-Process 'http://localhost:24247'"
call npm start
if errorlevel 1 goto :failed
goto :finished

:install_python_dependencies
".venv\Scripts\python.exe" -m pip install "requests~=2.32.3"
if not errorlevel 1 exit /b 0
echo Download failed. Retrying in 15 seconds; press Ctrl+C to cancel.
timeout /t 15 /nobreak >nul
goto :install_python_dependencies

:failed
echo.
echo 09Test Portal could not start. Review the error above.
pause
exit /b 1

:finished
echo.
echo 09Test Portal has stopped.
pause
exit /b 0

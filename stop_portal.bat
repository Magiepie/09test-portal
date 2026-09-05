@echo off
setlocal EnableExtensions
cd /d "%~dp0"

title Stop 09Test Server
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\scripts\stop_server.ps1"
if errorlevel 1 (
    echo.
    echo The server could not be stopped. Review the message above.
    pause
    exit /b 1
)

echo.
echo 09Test Portal and its game server are stopped.
timeout /t 3 /nobreak >nul
exit /b 0

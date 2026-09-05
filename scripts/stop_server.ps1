[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$portalRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$serverPidFile = Join-Path $portalRoot 'data/server.pid'
$portalPidFile = Join-Path $portalRoot 'data/portal.pid'

function Stop-VerifiedProcessTree([int]$ProcessId, [string]$ExpectedCommand, [string]$Label) {
    $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction SilentlyContinue
    if (-not $processInfo) {
        Write-Host "$Label was already stopped."
        return
    }
    if ($processInfo.CommandLine -notlike "*$ExpectedCommand*") {
        throw "Refusing to terminate PID $ProcessId because it is not the expected $Label process."
    }
    Write-Host "Stopping $Label process tree (PID $ProcessId)..."
    & taskkill.exe /PID $ProcessId /T /F
    if ($LASTEXITCODE -ne 0) { throw "taskkill failed for $Label with exit code $LASTEXITCODE." }
}

if (Test-Path $serverPidFile) {
    $serverPidText = (Get-Content -Raw $serverPidFile).Trim()
    $serverPid = 0
    if (-not [int]::TryParse($serverPidText, [ref]$serverPid) -or $serverPid -lt 1) {
        throw "The server PID file is invalid: $serverPidFile"
    }
    Stop-VerifiedProcessTree $serverPid 'run-server.bat' 'game server'
    Remove-Item -LiteralPath $serverPidFile -Force -ErrorAction SilentlyContinue
} else {
    Write-Host 'No portal-managed game server is recorded.'
}

$portalPid = 0
if (Test-Path $portalPidFile) {
    $portalPidText = (Get-Content -Raw $portalPidFile).Trim()
    if (-not [int]::TryParse($portalPidText, [ref]$portalPid) -or $portalPid -lt 1) {
        throw "The portal PID file is invalid: $portalPidFile"
    }
} else {
    $listener = Get-NetTCPConnection -LocalPort 24247 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($listener) { $portalPid = $listener.OwningProcess }
}

if ($portalPid -gt 0) {
    Stop-VerifiedProcessTree $portalPid 'src/server.js' '09Test Portal'
    Remove-Item -LiteralPath $portalPidFile -Force -ErrorAction SilentlyContinue
} else {
    Write-Host '09Test Portal is not listening on port 24247.'
}

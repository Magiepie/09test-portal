[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$portalRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$defaultServerRoot = (Resolve-Path (Join-Path $portalRoot '..')).Path
$defaultClassicToolsRoot = Join-Path $defaultServerRoot 'servertools-ryan-legacy'
$defaultMk2ToolsRoot = Join-Path $defaultServerRoot 'servertools'

$serverInput = Read-Host "2009Scape checkout [$defaultServerRoot]"
$serverRoot = if ([string]::IsNullOrWhiteSpace($serverInput)) { $defaultServerRoot } else { $serverInput.Trim() }
if (-not (Test-Path (Join-Path $serverRoot 'Server/mvnw.cmd'))) {
    throw "That folder does not contain the 2009Scape server source: $serverRoot"
}

$classicToolsInput = Read-Host "Classic servertools checkout [$defaultClassicToolsRoot]"
$classicToolsRoot = if ([string]::IsNullOrWhiteSpace($classicToolsInput)) { $defaultClassicToolsRoot } else { $classicToolsInput.Trim() }
if (-not (Test-Path (Join-Path $classicToolsRoot 'devops scripts/deploy_MRs_for_test.py'))) {
    throw "That folder does not contain the classic MR deployer: $classicToolsRoot"
}

$mk2ToolsInput = Read-Host "Optional real_damighty mk2 checkout (leave blank to skip)"
$mk2ToolsRoot = if ([string]::IsNullOrWhiteSpace($mk2ToolsInput)) { '' } else { $mk2ToolsInput.Trim() }
if ($mk2ToolsRoot -and -not (Test-Path (Join-Path $mk2ToolsRoot 'devops scripts/deploy_MRs_for_test.py'))) {
    throw "That folder does not contain real_damighty's mk2 MR deployer: $mk2ToolsRoot"
}

do {
    $securePassword = Read-Host 'Choose an emergency local administrator password' -AsSecureString
    $passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
    try {
        $adminPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
    } finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
    }
    if ($adminPassword.Length -lt 12) {
        Write-Warning 'Use at least 12 characters.'
    }
} while ($adminPassword.Length -lt 12)

$secretBytes = New-Object byte[] 48
$rng = [Security.Cryptography.RandomNumberGenerator]::Create()
try { $rng.GetBytes($secretBytes) } finally { $rng.Dispose() }
$sessionSecret = [Convert]::ToBase64String($secretBytes)

function Quote-EnvValue([string]$value) {
    return '"' + $value.Replace('"', '\"') + '"'
}

$lines = @(
    'PORT=24247',
    "SESSION_SECRET=$(Quote-EnvValue $sessionSecret)",
    "SERVER_ROOT=$(Quote-EnvValue ([IO.Path]::GetFullPath($serverRoot)))",
    'DEPLOY_MODE=classic',
    "CLASSIC_SERVERTOOLS_ROOT=$(Quote-EnvValue ([IO.Path]::GetFullPath($classicToolsRoot)))",
    "MK2_SERVERTOOLS_ROOT=$(Quote-EnvValue $(if ($mk2ToolsRoot) { [IO.Path]::GetFullPath($mk2ToolsRoot) } else { '' }))",
    'PYTHON_COMMAND=python',
    "ADMIN_PASSWORD=$(Quote-EnvValue $adminPassword)",
    '',
    'DISCORD_CLIENT_ID=',
    'DISCORD_CLIENT_SECRET=',
    'DISCORD_CALLBACK_URL=http://localhost:24247/auth/discord/callback',
    'DISCORD_GUILD_ID=',
    'DISCORD_ADMIN_ROLE_IDS='
)

$envPath = Join-Path $portalRoot '.env'
[IO.File]::WriteAllLines($envPath, $lines, [Text.UTF8Encoding]::new($false))
Write-Host "Created private configuration: $envPath"
Write-Host 'Discord login can be configured later by editing that file.'

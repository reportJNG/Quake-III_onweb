[CmdletBinding()]
param([string]$Destination)
$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
if (-not $Destination) { $Destination = Join-Path $ProjectRoot 'vendor\emsdk' }
$Version = '4.0.19'
if (-not (Test-Path (Join-Path $Destination 'emsdk.bat'))) {
    & git clone https://github.com/emscripten-core/emsdk.git $Destination
    if ($LASTEXITCODE -ne 0) { throw 'Could not clone emsdk.' }
}
& (Join-Path $Destination 'emsdk.bat') install $Version
if ($LASTEXITCODE -ne 0) { throw "Could not install Emscripten $Version." }
& (Join-Path $Destination 'emsdk.bat') activate $Version
if ($LASTEXITCODE -ne 0) { throw "Could not activate Emscripten $Version." }
Write-Host "Emscripten $Version is ready. In this PowerShell session run:"
Write-Host "  `$env:EMSDK='$Destination'"
Write-Host "  & '$Destination\emsdk_env.ps1'"

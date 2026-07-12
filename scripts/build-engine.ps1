[CmdletBinding()]
param(
    [string]$EmsdkRoot = $env:EMSDK,
    [switch]$Clean
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$SourceDir = Join-Path $ProjectRoot 'vendor\ioq3'
$BuildDir = Join-Path $ProjectRoot '.cache\ioq3-wasm'
$OutputDir = Join-Path $ProjectRoot 'public\engine'
$ExpectedCommit = 'a66ff00250ec3834421c6af7340cda311bc1cbb4'

if (-not $EmsdkRoot) {
    $LocalEmsdk = Join-Path $ProjectRoot 'vendor\emsdk'
    if (Test-Path (Join-Path $LocalEmsdk 'emsdk_env.ps1')) { $EmsdkRoot = $LocalEmsdk }
}
$LocalCMake = Get-ChildItem -LiteralPath (Join-Path $ProjectRoot 'vendor') -Directory -Filter 'cmake-*-windows-x86_64' -ErrorAction SilentlyContinue |
    Sort-Object Name -Descending | Select-Object -First 1
$ToolPaths = @()
if ($LocalCMake) { $ToolPaths += Join-Path $LocalCMake.FullName 'bin' }
if (Test-Path (Join-Path $ProjectRoot 'vendor\ninja\ninja.exe')) { $ToolPaths += Join-Path $ProjectRoot 'vendor\ninja' }
if ($ToolPaths.Count) { $env:PATH = ($ToolPaths -join [IO.Path]::PathSeparator) + [IO.Path]::PathSeparator + $env:PATH }

if (-not (Test-Path (Join-Path $SourceDir 'CMakeLists.txt'))) { throw 'Pinned ioquake3 source is missing from vendor/ioq3.' }
if (Test-Path (Join-Path $SourceDir '.git')) {
    $ActualCommit = (& git -C $SourceDir rev-parse HEAD).Trim()
    if ($ActualCommit -ne $ExpectedCommit) { throw "Unexpected ioquake3 revision $ActualCommit; expected $ExpectedCommit." }
}
if (-not $EmsdkRoot) { throw 'Set EMSDK to an activated Emscripten SDK 4.0.19 directory. See README.md.' }
$Emcmake = Join-Path $EmsdkRoot 'upstream\emscripten\emcmake.bat'
if (-not (Test-Path $Emcmake)) { throw "emcmake.bat was not found under EMSDK: $EmsdkRoot" }
if (-not (Get-Command cmake -ErrorAction SilentlyContinue)) { throw 'CMake is required and must be on PATH or installed under vendor/cmake-*-windows-x86_64.' }
if (-not (Get-Command ninja -ErrorAction SilentlyContinue)) { throw 'Ninja is required and must be on PATH or installed under vendor/ninja.' }
if ($Clean -and (Test-Path $BuildDir)) {
    $resolved = (Resolve-Path $BuildDir).Path
    if (-not $resolved.StartsWith((Resolve-Path $ProjectRoot).Path)) { throw 'Unsafe build path.' }
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
New-Item -ItemType Directory -Force $BuildDir, $OutputDir | Out-Null

& $Emcmake cmake -S $SourceDir -B $BuildDir -G Ninja -DCMAKE_BUILD_TYPE=Release -DBUILD_CLIENT=ON -DBUILD_SERVER=OFF -DBUILD_GAME_LIBRARIES=OFF -DBUILD_GAME_QVMS=OFF -DUSE_OPENAL=OFF -DUSE_VOIP=OFF -DUSE_MUMBLE=OFF -DUSE_CODEC_OPUS=OFF
if ($LASTEXITCODE -ne 0) { throw 'ioquake3 CMake configuration failed.' }
& cmake --build $BuildDir --config Release --parallel
if ($LASTEXITCODE -ne 0) { throw 'ioquake3 WebAssembly build failed.' }

$Artifacts = Get-ChildItem -LiteralPath $BuildDir -Recurse -File |
    Where-Object { $_.Name -in @('ioquake3.js', 'ioquake3.wasm') } |
    Group-Object Name | ForEach-Object { $_.Group | Select-Object -First 1 }
foreach ($name in @('ioquake3.js', 'ioquake3.wasm')) {
    $artifact = $Artifacts | Where-Object Name -eq $name
    if (-not $artifact) { throw "Build succeeded but $name was not found." }
    Copy-Item -LiteralPath $artifact.FullName -Destination (Join-Path $OutputDir $name) -Force
}
Write-Host 'Engine artifacts copied to public/engine.'

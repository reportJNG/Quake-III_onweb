[CmdletBinding()]
param(
    [string]$EmsdkRoot = $env:EMSDK,
    [switch]$Clean
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$VendorSourceDir = Join-Path $ProjectRoot 'vendor\ioq3'
$SourceDir = Join-Path $ProjectRoot '.cache\ioq3-source'
$BuildDir = Join-Path $ProjectRoot '.cache\ioq3-wasm'
$OutputDir = Join-Path $ProjectRoot 'public\engine'
$PatchPath = Join-Path $ProjectRoot 'patches\ioq3-web-mouse.patch'
$ExpectedCommit = 'a66ff00250ec3834421c6af7340cda311bc1cbb4'

function Remove-ProjectDirectory([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) { return }
    $resolved = (Resolve-Path -LiteralPath $Path).Path
    $root = (Resolve-Path -LiteralPath $ProjectRoot).Path.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
    if (-not $resolved.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) { throw "Unsafe cleanup path: $resolved" }
    Remove-Item -LiteralPath $resolved -Recurse -Force
}

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

if (-not (Test-Path (Join-Path $VendorSourceDir 'CMakeLists.txt'))) { throw 'Pinned ioquake3 source is missing. Run git submodule update --init.' }
$ActualCommit = (& git -C $VendorSourceDir rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $ActualCommit -ne $ExpectedCommit) { throw "Unexpected ioquake3 revision $ActualCommit; expected $ExpectedCommit." }
$VendorChanges = @(& git -C $VendorSourceDir status --porcelain)
if ($LASTEXITCODE -ne 0 -or $VendorChanges.Count -ne 0) { throw 'vendor/ioq3 has local changes. The tracked web patch is applied to a cached source copy instead.' }
if (-not (Test-Path -LiteralPath $PatchPath)) { throw "Native mouse patch is missing: $PatchPath" }

$PatchHash = (Get-FileHash -LiteralPath $PatchPath -Algorithm SHA256).Hash.ToLowerInvariant()
$SourceVersion = "$ExpectedCommit`:$PatchHash"
$VersionPath = Join-Path $SourceDir '.openarena-web-source'
$CurrentSourceVersion = if (Test-Path -LiteralPath $VersionPath) { (Get-Content -LiteralPath $VersionPath -Raw).Trim() } else { '' }
$PatchedInput = Join-Path $SourceDir 'code\sdl\sdl_input.c'
$SourceReady = $CurrentSourceVersion -eq $SourceVersion -and
    (Test-Path -LiteralPath $PatchedInput) -and
    (Select-String -LiteralPath $PatchedInput -SimpleMatch 'IN_WebSetPointerLock' -Quiet)
if ($Clean -or -not $SourceReady) {
    Remove-ProjectDirectory $SourceDir
    $SourceArchive = Join-Path $ProjectRoot '.cache\ioq3-source.zip'
    New-Item -ItemType Directory -Force (Split-Path $SourceArchive) | Out-Null
    Remove-Item -LiteralPath $SourceArchive -Force -ErrorAction SilentlyContinue
    & git -C $VendorSourceDir archive --format=zip --output=$SourceArchive $ExpectedCommit
    if ($LASTEXITCODE -ne 0) { throw 'Could not export the pinned ioquake3 source.' }
    Expand-Archive -LiteralPath $SourceArchive -DestinationPath $SourceDir
    Remove-Item -LiteralPath $SourceArchive -Force
    & git -C $ProjectRoot apply --check --directory='.cache/ioq3-source' $PatchPath
    if ($LASTEXITCODE -ne 0) { throw 'The native mouse patch does not apply to the pinned ioquake3 source.' }
    & git -C $ProjectRoot apply --directory='.cache/ioq3-source' $PatchPath
    if ($LASTEXITCODE -ne 0) { throw 'Could not apply the native mouse patch.' }
    if (-not (Select-String -LiteralPath $PatchedInput -SimpleMatch 'IN_WebSetPointerLock' -Quiet)) {
        throw 'The native mouse patch completed without producing its required source exports.'
    }
    Set-Content -LiteralPath $VersionPath -Value $SourceVersion -Encoding ascii
}
if (-not $EmsdkRoot) { throw 'Set EMSDK to an activated Emscripten SDK 4.0.19 directory. See README.md.' }
$Emcmake = Join-Path $EmsdkRoot 'upstream\emscripten\emcmake.bat'
if (-not (Test-Path $Emcmake)) { throw "emcmake.bat was not found under EMSDK: $EmsdkRoot" }
if (-not (Get-Command cmake -ErrorAction SilentlyContinue)) { throw 'CMake is required and must be on PATH or installed under vendor/cmake-*-windows-x86_64.' }
if (-not (Get-Command ninja -ErrorAction SilentlyContinue)) { throw 'Ninja is required and must be on PATH or installed under vendor/ninja.' }
if ($Clean) { Remove-ProjectDirectory $BuildDir }
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
$EngineJs = Join-Path $OutputDir 'ioquake3.js'
foreach ($export in @('_IN_WebSetPointerLock', '_IN_WebInjectMouseMove', '_IN_WebInjectMouseButton', '_IN_WebInjectMouseWheel')) {
    if (-not (Select-String -LiteralPath $EngineJs -SimpleMatch $export -Quiet)) {
        throw "Engine artifact is missing required mouse export: $export"
    }
}
Write-Host 'Engine artifacts copied to public/engine.'

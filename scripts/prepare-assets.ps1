[CmdletBinding()]
param(
    [string]$Archive,
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$CacheDir = Join-Path $ProjectRoot '.cache'
$ArchivePath = if ($Archive) { [IO.Path]::GetFullPath($Archive) } else { Join-Path $CacheDir 'openarena-0.8.8.zip' }
$ExtractDir = Join-Path $CacheDir 'openarena-0.8.8'
$OutputDir = Join-Path $ProjectRoot 'public\baseoa'
$ManifestPath = Join-Path $ProjectRoot 'public\engine\ioquake3-config.json'
$Url = 'https://master.dl.sourceforge.net/project/oarena/openarena-0.8.8.zip?viasf=1'
$ExpectedSha1 = '37ab41990b37459822ce8c2fe590607616e1f6d1'

New-Item -ItemType Directory -Force $CacheDir, $OutputDir, (Split-Path $ManifestPath) | Out-Null

if (-not (Test-Path -LiteralPath $ArchivePath)) {
    Write-Host "Downloading OpenArena 0.8.8 (approximately 426 MiB)..."
    Invoke-WebRequest -Uri $Url -OutFile $ArchivePath -UseBasicParsing
}

$ArchiveInfo = Get-Item -LiteralPath $ArchivePath
if ($ArchiveInfo.Length -lt 400MB -and -not $Archive) {
    Write-Warning "Cached OpenArena archive is too small to be valid. Re-downloading '$ArchivePath'."
    Remove-Item -LiteralPath $ArchivePath -Force
    Invoke-WebRequest -Uri $Url -OutFile $ArchivePath -UseBasicParsing
}

$ActualSha1 = (Get-FileHash -LiteralPath $ArchivePath -Algorithm SHA1).Hash.ToLowerInvariant()
if ($ActualSha1 -ne $ExpectedSha1 -and -not $Archive) {
    Write-Warning "Cached OpenArena archive checksum mismatch. Re-downloading '$ArchivePath'."
    Remove-Item -LiteralPath $ArchivePath -Force
    Invoke-WebRequest -Uri $Url -OutFile $ArchivePath -UseBasicParsing
    $ActualSha1 = (Get-FileHash -LiteralPath $ArchivePath -Algorithm SHA1).Hash.ToLowerInvariant()
}
if ($ActualSha1 -ne $ExpectedSha1) {
    throw "OpenArena archive checksum mismatch. Expected $ExpectedSha1, received $ActualSha1. Delete '$ArchivePath' and retry."
}
Write-Host "Verified OpenArena archive: $ActualSha1"

if ($Force -and (Test-Path -LiteralPath $ExtractDir)) {
    $resolved = (Resolve-Path -LiteralPath $ExtractDir).Path
    if (-not $resolved.StartsWith((Resolve-Path -LiteralPath $CacheDir).Path)) { throw 'Unsafe extraction path.' }
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
if (-not (Test-Path -LiteralPath $ExtractDir)) {
    Expand-Archive -LiteralPath $ArchivePath -DestinationPath $ExtractDir
}

$Baseoa = Get-ChildItem -LiteralPath $ExtractDir -Directory -Recurse |
    Where-Object Name -eq 'baseoa' |
    Select-Object -First 1
if (-not $Baseoa) { throw 'The verified archive does not contain a baseoa directory.' }

$Pk3Files = Get-ChildItem -LiteralPath $Baseoa.FullName -File -Filter '*.pk3' | Sort-Object Name
if ($Pk3Files.Count -eq 0) { throw 'No OpenArena PK3 files were found.' }
Get-ChildItem -LiteralPath $OutputDir -File -Filter '*.pk3' | Remove-Item -Force
foreach ($file in $Pk3Files) {
    Copy-Item -LiteralPath $file.FullName -Destination (Join-Path $OutputDir $file.Name) -Force
}
& node (Join-Path $PSScriptRoot 'write-manifest.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Could not write the game-data manifest.' }
Write-Host "Prepared $($Pk3Files.Count) PK3 files."

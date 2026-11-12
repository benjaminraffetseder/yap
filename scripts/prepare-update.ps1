# Run after building and signing the Windows executable. This copies the final
# bytes without rebuilding or changing their Authenticode signature.
param(
    [string]$Executable = (Join-Path $PSScriptRoot '..\build\bin\yap.exe'),
    [string]$OutputDirectory = (Join-Path $PSScriptRoot '..\build\bin')
)

$ErrorActionPreference = 'Stop'
$metadata = Get-Content -LiteralPath (Join-Path $PSScriptRoot '..\build\windows\info.json') -Raw | ConvertFrom-Json
$version = $metadata.fixed.product_version
if ($version -notmatch '^\d+\.\d+\.\d+$') { throw 'Expected a stable release version in build/windows/info.json' }
$source = Get-Item -LiteralPath $Executable
if ($source.VersionInfo.ProductVersion -ne $version) {
    throw "The executable version does not match $version. Build the current release first."
}
$buildInfo = (& go version -m $source.FullName) -join "`n"
if ($LASTEXITCODE -ne 0 -or ($buildInfo -notmatch 'GOOS=windows') -or ($buildInfo -notmatch 'GOARCH=amd64') -or ($buildInfo -notmatch '-tags=production')) {
    throw 'Expected a Windows amd64 production build from wails3 build.'
}
$output = New-Item -ItemType Directory -Path $OutputDirectory -Force
$asset = Join-Path $output.FullName "yap-$version-windows-amd64.exe"
if ($source.FullName -ne $asset) { Copy-Item -LiteralPath $source.FullName -Destination $asset -Force }

# Include other artifacts for this version already copied into the same folder.
# If platforms are built separately, combine their checksum lines before upload.
$pattern = '^yap-' + [regex]::Escape($version) + '-(windows-amd64(-setup)?\.exe|macos-(universal|arm64|amd64)\.zip)$'
$lines = Get-ChildItem -LiteralPath $output.FullName -File |
    Where-Object { $_.Name -match $pattern } |
    Sort-Object Name |
    ForEach-Object { (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant() + '  ' + $_.Name }
$checksums = Join-Path $output.FullName 'SHA256SUMS'
[System.IO.File]::WriteAllText($checksums, ($lines -join "`n") + "`n", [System.Text.UTF8Encoding]::new($false))
Write-Output "Update asset: $asset"
Write-Output "Checksums: $checksums"

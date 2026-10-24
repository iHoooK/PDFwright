# Собирает portable-архив из release/win-unpacked и считает SHA-256 обоих артефактов.
# Запускается из scripts/build-release.sh после electron-builder.
$ErrorActionPreference = 'Stop'
$projectDirectory = Split-Path -Parent $PSScriptRoot
$releaseDirectory = Join-Path $projectDirectory 'release'
$unpackedDirectory = Join-Path $releaseDirectory 'win-unpacked'
$portableDirectory = Join-Path $releaseDirectory 'PDFwright-Portable'
$archivePath = Join-Path $releaseDirectory 'PDFwright-Portable-x64.zip'
$setupPath = Join-Path $releaseDirectory 'PDFwright-Setup-x64.exe'

if (!(Test-Path -LiteralPath $setupPath -PathType Leaf)) { throw 'Сначала соберите установщик (electron-builder --win nsis).' }
if (!(Test-Path -LiteralPath $unpackedDirectory -PathType Container)) { throw 'Папка release/win-unpacked не найдена.' }

# Portable — та же распакованная программа плюс файл-маркер, по которому она
# понимает, что не установлена через установщик (обновления только ссылкой).
if (Test-Path -LiteralPath $portableDirectory) { Remove-Item -LiteralPath $portableDirectory -Recurse -Force }
Copy-Item -LiteralPath $unpackedDirectory -Destination $portableDirectory -Recurse
Set-Content -LiteralPath (Join-Path $portableDirectory 'PDFwright.portable') -Value 'portable' -Encoding ASCII
if (Test-Path -LiteralPath $archivePath) { Remove-Item -LiteralPath $archivePath -Force }
Compress-Archive -LiteralPath $portableDirectory -DestinationPath $archivePath -CompressionLevel Optimal

$checksums = @($setupPath, $archivePath) | ForEach-Object {
    $inputStream = [System.IO.File]::OpenRead($_)
    $algorithm = [System.Security.Cryptography.SHA256]::Create()
    try {
        $hash = [System.BitConverter]::ToString($algorithm.ComputeHash($inputStream)).Replace('-', '').ToLowerInvariant()
        '{0}  {1}' -f $hash, (Split-Path -Leaf $_)
    }
    finally { $inputStream.Dispose(); $algorithm.Dispose() }
}
[System.IO.File]::WriteAllLines((Join-Path $releaseDirectory 'SHA256SUMS.txt'), $checksums, [System.Text.Encoding]::ASCII)
Write-Output "Portable: $archivePath"
Write-Output "SHA256SUMS: $(Join-Path $releaseDirectory 'SHA256SUMS.txt')"

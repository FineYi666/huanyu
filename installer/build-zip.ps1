param(
  [Parameter(Mandatory = $true)][string]$SourceDirectory,
  [Parameter(Mandatory = $true)][string]$DestinationPath
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
if (Test-Path -LiteralPath $DestinationPath) {
  Remove-Item -LiteralPath $DestinationPath
}
[IO.Compression.ZipFile]::CreateFromDirectory(
  (Resolve-Path -LiteralPath $SourceDirectory).Path,
  [IO.Path]::GetFullPath($DestinationPath),
  [IO.Compression.CompressionLevel]::Optimal,
  $false
)
$archive = [IO.Compression.ZipFile]::OpenRead($DestinationPath)
try {
  $privateFiles = @($archive.Entries | Where-Object {
    $_.FullName -match '(^|[\\/])data[\\/]|(^|[\\/])(quark|deepseek)\.key$|(^|[\\/])library\.json$'
  })
  if ($privateFiles.Count -gt 0) { throw 'Private data found in portable archive.' }
  if (-not ($archive.Entries | Where-Object { $_.FullName -match '^node_modules[\\/]mp4box[\\/]package\.json$' })) {
    throw 'Missing mp4box dependency in portable archive.'
  }
  Write-Output "Validated ZIP: $($archive.Entries.Count) files, no private data."
} finally {
  $archive.Dispose()
}

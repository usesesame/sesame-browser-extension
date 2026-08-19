[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$hostName = 'app.usesesame.browser'
$manifestFolder = Join-Path $env:LOCALAPPDATA 'Sesame\native-messaging'
$manifestPath = Join-Path $manifestFolder "$hostName.json"
$firefoxManifestPath = Join-Path $manifestFolder "$hostName.firefox.json"

@(
  "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$hostName",
  "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\$hostName",
  "HKCU:\Software\Mozilla\NativeMessagingHosts\$hostName"
) | ForEach-Object {
  if (Test-Path -LiteralPath $_) { Remove-Item -LiteralPath $_ -Force }
}
@($manifestPath, $firefoxManifestPath) | ForEach-Object {
  if (Test-Path -LiteralPath $_) { Remove-Item -LiteralPath $_ -Force }
}

Write-Host 'Sesame native-host registration removed.'

[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$hostName = 'app.usesesame.browser'
$manifestPath = Join-Path $env:LOCALAPPDATA "Sesame\native-messaging\$hostName.json"

@(
  "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$hostName",
  "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\$hostName"
) | ForEach-Object {
  if (Test-Path -LiteralPath $_) { Remove-Item -LiteralPath $_ -Force }
}
if (Test-Path -LiteralPath $manifestPath) {
  Remove-Item -LiteralPath $manifestPath -Force
}

Write-Host 'Sesame native-host registration removed.'

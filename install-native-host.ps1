[CmdletBinding()]
param(
  [ValidateSet('Chrome', 'Edge', 'Firefox', 'Both', 'All')]
  [string]$Browser = 'All',

  [string]$HostPath,

  [switch]$AllowDebugHost
)

$ErrorActionPreference = 'Stop'
$identityPath = Join-Path $PSScriptRoot 'contracts\native-host.json'
$identity = Get-Content -LiteralPath $identityPath -Raw | ConvertFrom-Json
$ExtensionId = [string]$identity.official_extension_id
$FirefoxExtensionId = [string]$identity.firefox_extension_id
$hostName = [string]$identity.host_name
if (-not $HostPath) {
  throw 'Pass -HostPath for a desktop-owned browser host executable.'
}
$resolvedHost = (Resolve-Path -LiteralPath $HostPath -ErrorAction Stop).Path
if (-not $AllowDebugHost -and $resolvedHost -match '[\\/]debug[\\/]') {
  throw 'Refusing to register a debug browser host. Use a staged development host or pass -AllowDebugHost explicitly.'
}

$manifestFolder = Join-Path $env:LOCALAPPDATA 'Sesame\native-messaging'
$manifestPath = Join-Path $manifestFolder "$hostName.json"
$firefoxManifestPath = Join-Path $manifestFolder "$hostName.firefox.json"
New-Item -ItemType Directory -Force -Path $manifestFolder | Out-Null
$manifest = [ordered]@{
  name = $hostName
  description = 'Sesame native messaging host'
  path = $resolvedHost
  type = 'stdio'
  allowed_origins = @("chrome-extension://$ExtensionId/")
}
[IO.File]::WriteAllText(
  $manifestPath,
  ($manifest | ConvertTo-Json -Depth 3),
  [Text.UTF8Encoding]::new($false)
)

# Firefox pins the extension id rather than an origin, so its manifest differs.
$firefoxManifest = [ordered]@{
  name = $hostName
  description = 'Sesame native messaging host'
  path = $resolvedHost
  type = 'stdio'
  allowed_extensions = @($FirefoxExtensionId)
}
[IO.File]::WriteAllText(
  $firefoxManifestPath,
  ($firefoxManifest | ConvertTo-Json -Depth 3),
  [Text.UTF8Encoding]::new($false)
)

$registrations = @()
if ($Browser -in @('Chrome', 'Both', 'All')) {
  $registrations += @{ Path = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$hostName"; Manifest = $manifestPath }
}
if ($Browser -in @('Edge', 'Both', 'All')) {
  $registrations += @{ Path = "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\$hostName"; Manifest = $manifestPath }
}
if ($Browser -in @('Firefox', 'All')) {
  $registrations += @{ Path = "HKCU:\Software\Mozilla\NativeMessagingHosts\$hostName"; Manifest = $firefoxManifestPath }
}
foreach ($registration in $registrations) {
  New-Item -Force -Path $registration.Path | Out-Null
  Set-Item -LiteralPath $registration.Path -Value $registration.Manifest
}

Write-Host "Sesame native host registered for $Browser and pinned extension $ExtensionId."

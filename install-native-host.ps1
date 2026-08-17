[CmdletBinding()]
param(
  [ValidateSet('Chrome', 'Edge', 'Both')]
  [string]$Browser = 'Both',

  [string]$HostPath,

  [switch]$AllowDebugHost
)

$ErrorActionPreference = 'Stop'
$identityPath = Join-Path $PSScriptRoot 'contracts\native-host.json'
$identity = Get-Content -LiteralPath $identityPath -Raw | ConvertFrom-Json
$ExtensionId = [string]$identity.official_extension_id
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

$registryPaths = @()
if ($Browser -in @('Chrome', 'Both')) {
  $registryPaths += "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$hostName"
}
if ($Browser -in @('Edge', 'Both')) {
  $registryPaths += "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\$hostName"
}
foreach ($registryPath in $registryPaths) {
  New-Item -Force -Path $registryPath | Out-Null
  Set-Item -LiteralPath $registryPath -Value $manifestPath
}

Write-Host "Sesame native host registered for $Browser and pinned extension $ExtensionId."

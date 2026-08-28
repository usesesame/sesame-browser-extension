[CmdletBinding()]
param(
  [string]$HostPath
)

$ErrorActionPreference = 'Stop'
if (-not $HostPath) {
  throw 'Pass -HostPath for a desktop-owned browser host executable.'
}
$resolvedHost = (Resolve-Path -LiteralPath $HostPath -ErrorAction Stop).Path

& $resolvedHost unregister
if ($LASTEXITCODE -ne 0) {
  throw 'The browser host could not remove its registration.'
}

Write-Host 'Sesame native-host registration removed.'

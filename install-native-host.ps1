[CmdletBinding()]
param(
  [string]$HostPath,

  [switch]$AllowDebugHost
)

$ErrorActionPreference = 'Stop'
if (-not $HostPath) {
  throw 'Pass -HostPath for a desktop-owned browser host executable.'
}
$resolvedHost = (Resolve-Path -LiteralPath $HostPath -ErrorAction Stop).Path
if (-not $AllowDebugHost -and $resolvedHost -match '[\\/]debug[\\/]') {
  throw 'Refusing to register a debug browser host. Use a staged development host or pass -AllowDebugHost explicitly.'
}
$desktopPath = Join-Path (Split-Path -Parent $resolvedHost) 'sesame.exe'
if (-not (Test-Path -LiteralPath $desktopPath -PathType Leaf)) {
  throw 'The browser host must be beside sesame.exe so it can authenticate the desktop broker.'
}

& $resolvedHost register
if ($LASTEXITCODE -ne 0) {
  throw 'The browser host could not register itself.'
}

Write-Host 'Sesame native host registered for every browser the desktop supports.'

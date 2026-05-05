param(
  [switch]$SkipPhone,
  [switch]$SkipDesktop
)

$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")

if (-not $SkipPhone) {
  Push-Location (Join-Path $root "phone-app")
  try {
    npm run typecheck
    npm run test:logic
  } finally {
    Pop-Location
  }
}

if (-not $SkipDesktop) {
  Push-Location (Join-Path $root "desktop-server")
  try {
    py -3 -m unittest discover -s tests
  } finally {
    Pop-Location
  }
}

Write-Host "Verification complete."

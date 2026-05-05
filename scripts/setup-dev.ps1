param(
  [switch]$SkipPhone,
  [switch]$SkipDesktop
)

$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")

if (-not $SkipDesktop) {
  Push-Location (Join-Path $root "desktop-server")
  try {
    py -3 -m pip install -r requirements.txt
  } finally {
    Pop-Location
  }
}

if (-not $SkipPhone) {
  Push-Location (Join-Path $root "phone-app")
  try {
    npm install
  } finally {
    Pop-Location
  }
}

Write-Host "Setup complete."

param(
  [string]$DeviceSerial = $env:ANDROID_SERIAL,
  [int]$BackendPort = 8010,
  [int]$MetroPort = 8081
)

$ErrorActionPreference = "Stop"

if (-not $env:ANDROID_HOME) {
  $defaultSdk = Join-Path $env:LOCALAPPDATA "Android\Sdk"
  if (Test-Path -LiteralPath $defaultSdk) {
    $env:ANDROID_HOME = $defaultSdk
  }
}

$adb = if ($env:ANDROID_HOME) {
  Join-Path $env:ANDROID_HOME "platform-tools\adb.exe"
} else {
  "adb"
}

if (-not (Get-Command $adb -ErrorAction SilentlyContinue)) {
  throw "adb was not found. Set ANDROID_HOME or add platform-tools to PATH."
}

$targetArgs = @()
if ($DeviceSerial) {
  $targetArgs = @("-s", $DeviceSerial)
}

& $adb @targetArgs reverse "tcp:$BackendPort" "tcp:$BackendPort" | Out-Null
if ($MetroPort -gt 0) {
  & $adb @targetArgs reverse "tcp:$MetroPort" "tcp:$MetroPort" | Out-Null
}

Write-Host "ADB reverse configured: backend tcp:$BackendPort"
if ($MetroPort -gt 0) {
  Write-Host "ADB reverse configured: Metro tcp:$MetroPort"
}

param(
  [string]$DeviceSerial = $env:ANDROID_SERIAL,
  [string]$Variant = "debug",
  [int]$BackendPort = 8010,
  [int]$MetroPort = 8081,
  [switch]$UseProjectGradleCache
)

$ErrorActionPreference = "Stop"

$projectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
if ($UseProjectGradleCache) {
  $gradleHome = Join-Path $projectRoot ".gradle-cache"
  New-Item -ItemType Directory -Path $gradleHome -Force | Out-Null
  $env:GRADLE_USER_HOME = $gradleHome
}

if (-not $env:JAVA_HOME) {
  $jdkCandidates = @(
    "C:\Program Files\Java\jdk-21",
    "C:\Program Files\Java\jdk-17",
    "C:\Program Files\Eclipse Adoptium\jdk-21*",
    "C:\Program Files\Eclipse Adoptium\jdk-17*"
  )

  foreach ($candidate in $jdkCandidates) {
    $match = Get-Item -Path $candidate -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($match) {
      $env:JAVA_HOME = $match.FullName
      break
    }
  }
}

if ($env:JAVA_HOME) {
  $env:Path = "$env:JAVA_HOME\bin;$env:Path"
}

if (-not $env:ANDROID_HOME) {
  $defaultSdk = Join-Path $env:LOCALAPPDATA "Android\Sdk"
  if (Test-Path -LiteralPath $defaultSdk) {
    $env:ANDROID_HOME = $defaultSdk
  }
}

if ($env:ANDROID_HOME) {
  $env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
  $env:Path = "$env:ANDROID_HOME\platform-tools;$env:Path"
}

if ($DeviceSerial) {
  $env:ANDROID_SERIAL = $DeviceSerial
}

& (Join-Path $PSScriptRoot "configure-android-local.ps1") `
  -DeviceSerial $DeviceSerial `
  -BackendPort $BackendPort `
  -MetroPort $MetroPort

npx expo run:android --variant $Variant

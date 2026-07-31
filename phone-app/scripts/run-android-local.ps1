param(
  [string]$DeviceSerial = $env:ANDROID_SERIAL,
  [string]$Variant = "debug",
  [int]$RemotePort = 8765,
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

function Test-JavaHomeSupportsAndroidBuild {
  param([string]$JavaHome)

  if (-not $JavaHome) {
    return $false
  }

  $releaseFile = Join-Path $JavaHome "release"
  if (-not (Test-Path -LiteralPath $releaseFile)) {
    return $false
  }

  $versionLine = Get-Content -LiteralPath $releaseFile | Where-Object { $_ -like "JAVA_VERSION=*" } | Select-Object -First 1
  if (-not $versionLine) {
    return $false
  }

  $version = ($versionLine -replace '^JAVA_VERSION="([^"]+)".*$', '$1')
  $majorText = if ($version -like "1.*") { ($version -split "\.")[1] } else { ($version -split "\.")[0] }
  $major = 0
  if (-not [int]::TryParse($majorText, [ref]$major)) {
    return $false
  }

  return $major -ge 17
}

if (-not (Test-JavaHomeSupportsAndroidBuild $env:JAVA_HOME)) {
  $jdkCandidates = @(
    "C:\Program Files\Java\jdk-21",
    "C:\Program Files\Java\jdk-17",
    "C:\Program Files\Eclipse Adoptium\jdk-21*",
    "C:\Program Files\Eclipse Adoptium\jdk-17*"
  )

  foreach ($candidate in $jdkCandidates) {
    $match = Get-Item -Path $candidate -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($match -and (Test-JavaHomeSupportsAndroidBuild $match.FullName)) {
      $env:JAVA_HOME = $match.FullName
      break
    }
  }
}

if (-not (Test-JavaHomeSupportsAndroidBuild $env:JAVA_HOME)) {
  throw "Java 17 or newer is required for Android builds. Set JAVA_HOME to a JDK 17+ install."
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
  -RemotePort $RemotePort `
  -MetroPort $MetroPort

npx expo run:android --variant $Variant

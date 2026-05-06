param(
  [ValidateSet("cloudflared", "ngrok")]
  [string]$Provider = "cloudflared",
  [int]$BackendPort = 8010,
  [string]$SharedToken = "codex-dev",
  [switch]$Start
)

$ErrorActionPreference = "Stop"

$targetUrl = "http://127.0.0.1:$BackendPort"
$commandArgsByProvider = @{
  cloudflared = @("tunnel", "--url", $targetUrl)
  ngrok = @("http", "$BackendPort")
}

$commandArgs = $commandArgsByProvider[$Provider]
$commandText = "$Provider $($commandArgs -join ' ')"

Write-Host "Desktop server target: $targetUrl"
Write-Host "Shared token expected by phone app: $SharedToken"
Write-Host ""
Write-Host "Tunnel command:"
Write-Host "  $commandText"
Write-Host ""
Write-Host "Paste the resulting HTTPS tunnel URL into the phone app Backend URL."
Write-Host "Or start Expo with EXPO_PUBLIC_CODEX_TUNNEL_URL set to that HTTPS URL."

if (-not $Start) {
  return
}

$executable = Get-Command $Provider -ErrorAction SilentlyContinue
if (-not $executable) {
  throw "$Provider was not found on PATH. Install it or run the printed command where it is available."
}

& $executable.Source @commandArgs

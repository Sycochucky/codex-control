param(
  [ValidateSet("cloudflared", "ngrok")]
  [string]$Provider = "cloudflared",
  [int]$RemotePort = 8765,
  [switch]$Start
)

$ErrorActionPreference = "Stop"

$targetUrl = "http://127.0.0.1:$RemotePort"
$commandArgsByProvider = @{
  cloudflared = @("tunnel", "--url", $targetUrl)
  ngrok = @("http", "$RemotePort")
}

$commandArgs = $commandArgsByProvider[$Provider]
$commandText = "$Provider $($commandArgs -join ' ')"

Write-Host "Codex App Server target: $targetUrl"
Write-Host ""
Write-Host "Tunnel command:"
Write-Host "  $commandText"
Write-Host ""
Write-Host "Paste the resulting HTTPS tunnel URL into the phone app Codex App Server URL."
Write-Host "Or start Expo with EXPO_PUBLIC_CODEX_REMOTE_URL set to that HTTPS URL."
Write-Host "Start Codex first with: codex remote-control"

if (-not $Start) {
  return
}

$executable = Get-Command $Provider -ErrorAction SilentlyContinue
if (-not $executable) {
  throw "$Provider was not found on PATH. Install it or run the printed command where it is available."
}

& $executable.Source @commandArgs

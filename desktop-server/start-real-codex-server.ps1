param(
    [string]$HostAddress = "0.0.0.0",
    [int]$Port = 8010,
    [string]$WorkspaceRoot = "D:\DevProjects\codex-app-syco",
    [string]$Model = "gpt-5.4",
    [string]$Sandbox = "workspace-write",
    [string]$SharedToken = "codex-dev",
    [switch]$PersistentSession,
    [switch]$Reload
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command codex -ErrorAction SilentlyContinue)) {
    throw "Codex CLI was not found on PATH. Install Codex and run 'codex login --device-auth' first."
}

cmd /c "codex login status >nul 2>nul"
if ($LASTEXITCODE -ne 0) {
    throw "Codex CLI is not logged in. Run 'codex login --device-auth' first."
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptDir

$env:CODEX_PROVIDER = "real-codex"
$env:CODEX_WORKSPACE_ROOT = $WorkspaceRoot
$env:CODEX_CLI_SANDBOX = $Sandbox
$env:CODEX_CLI_EPHEMERAL = if ($PersistentSession) { "false" } else { "true" }
$env:CODEX_MODEL = $Model
$env:CODEX_CONTROL_SHARED_TOKEN = $SharedToken

Write-Host "Starting Codex Control desktop server with local Codex CLI integration..." -ForegroundColor Cyan
Write-Host "Workspace: $WorkspaceRoot"
Write-Host "Model: $Model"
Write-Host "Sandbox: $Sandbox"
Write-Host "Host: $HostAddress`:$Port"
if ($Reload) {
    Write-Warning "Reload mode on Windows can break Codex App Server subprocess startup. Use only for backend-only edits."
}

if ($Reload) {
    py -3 -m uvicorn app.main:app --reload --host $HostAddress --port $Port
} else {
    py -3 -m uvicorn app.main:app --host $HostAddress --port $Port
}

param(
    [ValidateSet("list", "status", "start", "stop", "restart", "log")]
    [string]$Action = "list",
    [ValidateSet("backend", "expo", "apk-local", "eas-cloud")]
    [string]$Target = "backend",
    [string]$BindHost = "0.0.0.0",
    [int]$Port = 8010,
    [string]$SharedToken = "codex-dev",
    [string]$Profile = "preview",
    [int]$Tail = 120
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$desktopServerDir = Resolve-Path (Join-Path $scriptDir "..")
$projectRoot = Resolve-Path (Join-Path $desktopServerDir "..")
$phoneAppDir = Join-Path $projectRoot "phone-app"
$runtimeDir = Join-Path $desktopServerDir "runtime\\gui-control"
$managedBy = "control_panel_ps1"

New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null

function Get-ManifestPath([string]$Name) {
    return Join-Path $runtimeDir "$Name.json"
}

function Get-LogPath([string]$Name) {
    return Join-Path $runtimeDir "$Name.log"
}

function Get-StderrLogPath([string]$Name) {
    return Join-Path $runtimeDir "$Name.stderr.log"
}

function Read-Manifest([string]$Name) {
    $path = Get-ManifestPath $Name
    if (-not (Test-Path $path)) {
        return $null
    }

    return Get-Content $path -Raw | ConvertFrom-Json
}

function Write-Manifest([string]$Name, [hashtable]$Manifest) {
    $path = Get-ManifestPath $Name
    $Manifest | ConvertTo-Json -Depth 8 | Set-Content -Path $path
}

function Remove-Manifest([string]$Name) {
    $path = Get-ManifestPath $Name
    if (Test-Path $path) {
        Remove-Item $path -Force
    }
}

function Get-TargetConfig([string]$Name) {
    $logPath = Get-LogPath $Name
    $stderrPath = Get-StderrLogPath $Name
    $easCommand = "npx --yes eas-cli@latest"
    switch ($Name) {
        "backend" {
            return @{
                name = $Name
                cwd = $desktopServerDir
                logPath = $logPath
                stderrPath = $stderrPath
                filePath = "powershell.exe"
                args = @(
                    "-NoProfile",
                    "-ExecutionPolicy",
                    "Bypass",
                    "-File",
                    (Join-Path $desktopServerDir "start-real-codex-server.ps1"),
                    "-HostAddress",
                    $BindHost,
                    "-Port",
                    "$Port",
                    "-SharedToken",
                    $SharedToken
                )
                url = "http://$BindHost`:$Port"
                port = $Port
                mode = "service"
            }
        }
        "expo" {
            return @{
                name = $Name
                cwd = $phoneAppDir
                logPath = $logPath
                stderrPath = $stderrPath
                filePath = "cmd.exe"
                args = @(
                    "/c",
                    "cd /d `"$phoneAppDir`" && npx expo start -c --port $Port --host lan"
                )
                url = "http://127.0.0.1:$Port"
                port = $Port
                mode = "service"
            }
        }
        "apk-local" {
            return @{
                name = $Name
                cwd = $phoneAppDir
                logPath = $logPath
                stderrPath = $stderrPath
                filePath = "cmd.exe"
                args = @(
                    "/c",
                    "cd /d `"$phoneAppDir`" && $easCommand build --platform android --local --profile $Profile --non-interactive"
                )
                url = $null
                port = $null
                mode = "job"
            }
        }
        "eas-cloud" {
            return @{
                name = $Name
                cwd = $phoneAppDir
                logPath = $logPath
                stderrPath = $stderrPath
                filePath = "cmd.exe"
                args = @(
                    "/c",
                    "cd /d `"$phoneAppDir`" && $easCommand build --platform android --profile $Profile --non-interactive"
                )
                url = $null
                port = $null
                mode = "job"
            }
        }
    }
}

function Get-ProcessState([string]$Name) {
    $manifest = Read-Manifest $Name
    $logPath = if ($manifest -and $manifest.log_path) { $manifest.log_path } elseif ($manifest -and $manifest.logPath) { $manifest.logPath } else { Get-LogPath $Name }
    $stderrPath = if ($manifest -and $manifest.stderr_path) { $manifest.stderr_path } elseif ($manifest -and $manifest.stderrPath) { $manifest.stderrPath } else { Get-StderrLogPath $Name }
    $running = $false
    $processId = $null

    if ($manifest -and $manifest.pid) {
        $processId = [int]$manifest.pid
        $running = $null -ne (Get-Process -Id $processId -ErrorAction SilentlyContinue)
    }

    return @{
        name = $Name
        running = $running
        pid = $processId
        port = if ($manifest) { $manifest.port } else { $null }
        url = if ($manifest) { $manifest.url } else { $null }
        profile = if ($manifest) { $manifest.profile } else { $null }
        startedAt = if ($manifest -and $manifest.started_at) { $manifest.started_at } elseif ($manifest) { $manifest.startedAt } else { $null }
        logPath = $logPath
        logTail = if (Test-Path $logPath) {
            @(
                (Get-Content $logPath -Tail $Tail -ErrorAction SilentlyContinue)
                (Get-Content $stderrPath -Tail $Tail -ErrorAction SilentlyContinue)
            ) -join "`n"
        } else {
            ""
        }
        managed = $null -ne $manifest
    }
}

function Start-Target([string]$Name) {
    $config = Get-TargetConfig $Name
    $existing = Get-ProcessState $Name
    if ($existing.running) {
        return $existing
    }

    $logPath = $config.logPath
    $stderrPath = $config.stderrPath
    $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $logPath = Join-Path $runtimeDir "$Name-$timestamp.log"
    $stderrPath = Join-Path $runtimeDir "$Name-$timestamp.stderr.log"
    New-Item -ItemType File -Path $logPath | Out-Null
    New-Item -ItemType File -Path $stderrPath | Out-Null

    $process = Start-Process `
        -FilePath $config.filePath `
        -ArgumentList $config.args `
        -WorkingDirectory $config.cwd `
        -RedirectStandardOutput $logPath `
        -RedirectStandardError $stderrPath `
        -WindowStyle Hidden `
        -PassThru

    $manifest = @{
        pid = $process.Id
        port = $config.port
        url = $config.url
        profile = $Profile
        host = $BindHost
        shared_token = $SharedToken
        started_at = (Get-Date).ToString("o")
        cwd = $config.cwd
        mode = $config.mode
        log_path = $logPath
        stderr_path = $stderrPath
        managed_by = $managedBy
        target = $Name
    }
    Write-Manifest $Name $manifest

    return @{
        name = $Name
        running = $true
        pid = $process.Id
        port = $config.port
        url = $config.url
        profile = $Profile
        startedAt = $manifest.started_at
        logPath = $logPath
        logTail = ""
        managed = $true
    }
}

function Stop-Target([string]$Name) {
    $manifest = Read-Manifest $Name
    if ($manifest -and $manifest.pid) {
        $process = Get-Process -Id ([int]$manifest.pid) -ErrorAction SilentlyContinue
        if ($process) {
            Stop-Process -Id $process.Id -Force
        }
    }

    Remove-Manifest $Name
    return Get-ProcessState $Name
}

function Restart-Target([string]$Name) {
    Stop-Target $Name | Out-Null
    return Start-Target $Name
}

function Get-LogState([string]$Name) {
    $state = Get-ProcessState $Name
    return @{
        name = $state.name
        running = $state.running
        pid = $state.pid
        logPath = $state.logPath
        logTail = $state.logTail
    }
}

switch ($Action) {
    "list" {
        $targets = @("backend", "expo", "apk-local", "eas-cloud")
        @{ targets = @($targets | ForEach-Object { Get-ProcessState $_ }) } | ConvertTo-Json -Depth 8
    }
    "status" {
        Get-ProcessState $Target | ConvertTo-Json -Depth 8
    }
    "start" {
        Start-Target $Target | ConvertTo-Json -Depth 8
    }
    "stop" {
        Stop-Target $Target | ConvertTo-Json -Depth 8
    }
    "restart" {
        Restart-Target $Target | ConvertTo-Json -Depth 8
    }
    "log" {
        Get-LogState $Target | ConvertTo-Json -Depth 8
    }
}

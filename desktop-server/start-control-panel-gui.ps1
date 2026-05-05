$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptDir

$scriptPath = Join-Path $scriptDir "scripts\control_panel_gui.py"
$candidates = @(
    @{ Name = "py"; Args = @("-3") },
    @{ Name = "python"; Args = @() },
    @{ Name = "python3"; Args = @() }
)
$launchErrors = @()

foreach ($candidate in $candidates) {
    $command = Get-Command $candidate.Name -ErrorAction SilentlyContinue
    if (-not $command) {
        continue
    }

    try {
        & $command.Source @($candidate.Args + @("-c", "import sys")) *> $null
        & $command.Source @($candidate.Args + @($scriptPath))
        exit $LASTEXITCODE
    }
    catch {
        $launchErrors += "$($candidate.Name): $($_.Exception.Message)"
    }
}

$details = if ($launchErrors.Count -gt 0) {
    " Tried: $($launchErrors -join '; ')"
} else {
    ""
}

throw "Python 3 could not be launched for the control panel.$details"

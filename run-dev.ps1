param(
    [int]$BackendPort = 8000,
    [int]$FrontendPort = 8080,
    [string]$VenvPath = ".venv",
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

function Escape-SingleQuotes {
    param([string]$Text)
    return $Text -replace "'", "''"
}

function Stop-PortProcess {
    param([int]$Port)

    $listeners = @(
        Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
            Select-Object -ExpandProperty OwningProcess -Unique
    )

    # Fallback for edge cases where Get-NetTCPConnection returns stale/partial ownership data.
    $netstatPids = @(
        netstat -ano -p tcp | Select-String ":$Port\s" | ForEach-Object {
            $parts = ($_ -split "\s+").Where({ $_ -ne "" })
            if ($parts.Count -ge 5) {
                $parts[-1]
            }
        }
    )

    $allPids = @($listeners + $netstatPids) |
        Where-Object { $_ -match "^\d+$" } |
        ForEach-Object { [int]$_ } |
        Where-Object { $_ -gt 0 -and $_ -ne $PID } |
        Select-Object -Unique

    if (-not $allPids) {
        Write-Host "Port $Port is free."
        return
    }

    foreach ($owningPid in $allPids) {
        $proc = Get-Process -Id $owningPid -ErrorAction SilentlyContinue
        $procName = if ($proc) { $proc.ProcessName } else { "unknown" }

        Write-Host "Stopping PID $owningPid ($procName) on port $Port..."
        Stop-Process -Id $owningPid -Force -ErrorAction SilentlyContinue
        taskkill /PID $owningPid /F | Out-Null
    }

    for ($i = 0; $i -lt 12; $i++) {
        $stillBusy = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
        if (-not $stillBusy) {
            break
        }
        Start-Sleep -Milliseconds 300
    }

    $finalCheck = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    if ($finalCheck) {
        Write-Warning "Port $Port is still busy after cleanup attempt."
    } else {
        Write-Host "Port $Port is now free."
    }
}

function Resolve-ActivateScript {
    param([string]$Preferred)

    $fromEnv = if ($env:VIRTUAL_ENV) {
        Join-Path -Path $env:VIRTUAL_ENV -ChildPath "Scripts/Activate.ps1"
    }

    $candidates = @(
        $fromEnv,
        $Preferred,
        ".venv",
        "../.venv",
        "backend/.venv",
        "venv",
        "backend/venv"
    ) | Select-Object -Unique

    foreach ($candidate in $candidates) {
        if (-not $candidate) { continue }
        if ($candidate -like "*Activate.ps1") {
            if (Test-Path -Path $candidate) {
                return (Resolve-Path $candidate).Path
            }
            continue
        }

        $activate = Join-Path -Path $PSScriptRoot -ChildPath "$candidate/Scripts/Activate.ps1"
        if (Test-Path -Path $activate) {
            return (Resolve-Path $activate).Path
        }
    }

    throw "No virtual environment found. Checked active VIRTUAL_ENV, .venv, ../.venv, backend/.venv, venv, backend/venv."
}

$activateScript = Resolve-ActivateScript -Preferred $VenvPath
Write-Host "Using venv activation script: $activateScript"

$rootEsc = Escape-SingleQuotes -Text $PSScriptRoot
$actEsc = Escape-SingleQuotes -Text $activateScript

$pathRefresh = "`$env:Path = [System.Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path', 'User')"
$backendCmd = "$pathRefresh; Set-Location '$rootEsc'; & '$actEsc'; npm run dev:backend"
$frontendCmd = "$pathRefresh; Set-Location '$rootEsc'; & '$actEsc'; npm run dev"

if ($DryRun) {
    Write-Host "Dry run only. Commands that would be launched:"
    Write-Host "Would clean ports: $BackendPort and $FrontendPort"
    Write-Host "Backend: $backendCmd"
    Write-Host "Frontend: $frontendCmd"
    exit 0
}

Stop-PortProcess -Port $BackendPort
Stop-PortProcess -Port $FrontendPort

$pwshPath = (Get-Command pwsh -ErrorAction SilentlyContinue).Source
if (-not $pwshPath) {
    $pwshPath = (Get-Command powershell -ErrorAction SilentlyContinue).Source
}
if (-not $pwshPath) {
    throw "Neither pwsh nor powershell was found on PATH."
}

Start-Process -FilePath $pwshPath -ArgumentList "-NoExit", "-Command", $backendCmd | Out-Null
Start-Process -FilePath $pwshPath -ArgumentList "-NoExit", "-Command", $frontendCmd | Out-Null

Write-Host "Started backend on port $BackendPort and frontend on port $FrontendPort in new terminals."

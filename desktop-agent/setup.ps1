# PrintDrop Desktop Agent — Windows Setup
# Usage: powershell -ExecutionPolicy Bypass -c "irm https://raw.githubusercontent.com/Rishi-choudhary/printdrop/main/desktop-agent/setup.ps1 | iex"

$ErrorActionPreference = "Stop"
$AgentDir = "$env:USERPROFILE\printdrop-desktop-agent"

Write-Host ""
Write-Host "  ╔══════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "  ║     PrintDrop Desktop Agent  Setup       ║" -ForegroundColor Cyan
Write-Host "  ╚══════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

# ── 1. Node.js ────────────────────────────────────────────────────────────
$nodeOk = $null
try { $nodeOk = node -v 2>$null } catch {}

if (-not $nodeOk) {
    Write-Host "  [1/3] Node.js not found — downloading installer..." -ForegroundColor Yellow
    $installer = "$env:TEMP\node-installer.msi"
    Invoke-WebRequest "https://nodejs.org/dist/v20.17.0/node-v20.17.0-x64.msi" -OutFile $installer
    Start-Process msiexec.exe -Wait -ArgumentList "/i `"$installer`" /quiet ADDLOCAL=ALL"
    Remove-Item $installer -Force
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
    Write-Host "  [1/3] Node.js installed." -ForegroundColor Green
} else {
    Write-Host "  [1/3] Node.js $nodeOk — OK" -ForegroundColor Green
}

# ── 2. Download ───────────────────────────────────────────────────────────
Write-Host "  [2/3] Downloading desktop agent..." -ForegroundColor Yellow

$gitOk = $null
try { $gitOk = git --version 2>$null } catch {}

if ($gitOk) {
    if (Test-Path "$AgentDir\.git") {
        Set-Location $AgentDir
        git pull origin main --quiet 2>$null
    } else {
        git clone --depth 1 --filter=blob:none --sparse https://github.com/Rishi-choudhary/printdrop.git $AgentDir --quiet
        Set-Location $AgentDir
        git sparse-checkout set desktop-agent
    }
    Set-Location "$AgentDir\desktop-agent"
} else {
    $zip = "$env:TEMP\printdrop.zip"
    Invoke-WebRequest "https://github.com/Rishi-choudhary/printdrop/archive/refs/heads/main.zip" -OutFile $zip
    Expand-Archive $zip "$env:TEMP\printdrop-src" -Force
    Remove-Item $zip -Force
    if (Test-Path $AgentDir) { Remove-Item $AgentDir -Recurse -Force }
    Move-Item "$env:TEMP\printdrop-src\printdrop-main\desktop-agent" $AgentDir
    Remove-Item "$env:TEMP\printdrop-src" -Recurse -Force -ErrorAction SilentlyContinue
    Set-Location $AgentDir
}

Write-Host "  [2/3] Downloaded." -ForegroundColor Green

# ── 3. Install dependencies ───────────────────────────────────────────────
Write-Host "  [3/3] Installing dependencies (Electron included, may take ~1 min)..." -ForegroundColor Yellow
npm install --silent
Write-Host "  [3/3] Done." -ForegroundColor Green

# ── Create start.bat ──────────────────────────────────────────────────────
$startBat = @"
@echo off
title PrintDrop Desktop Agent
cd /d "%~dp0"
npm start
"@
$startBat | Out-File -FilePath ".\start.bat" -Encoding ascii

Write-Host ""
Write-Host "  ✓  Setup complete!" -ForegroundColor Green
Write-Host "  → To relaunch later: double-click start.bat in $AgentDir" -ForegroundColor DarkGray
Write-Host ""
Write-Host "  Launching desktop agent..." -ForegroundColor Cyan
Write-Host ""

npm start

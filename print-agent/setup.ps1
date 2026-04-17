# PrintDrop Print Agent — Windows Setup
# Usage: powershell -ExecutionPolicy Bypass -c "irm https://raw.githubusercontent.com/Rishi-choudhary/printdrop/main/print-agent/setup.ps1 | iex"

$ErrorActionPreference = "Stop"
$AgentDir = "$env:USERPROFILE\printdrop-print-agent"

Write-Host ""
Write-Host "  ╔══════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "  ║     PrintDrop Print Agent  Setup         ║" -ForegroundColor Cyan
Write-Host "  ╚══════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

# ── 1. Node.js ─────────────────────────────────────────────────────────────
$nodeOk = $null
try { $nodeOk = node -v 2>$null } catch {}

if (-not $nodeOk) {
    Write-Host "  [1/4] Node.js not found — downloading installer..." -ForegroundColor Yellow
    $installer = "$env:TEMP\node-installer.msi"
    Invoke-WebRequest "https://nodejs.org/dist/v20.17.0/node-v20.17.0-x64.msi" -OutFile $installer
    Start-Process msiexec.exe -Wait -ArgumentList "/i `"$installer`" /quiet ADDLOCAL=ALL"
    Remove-Item $installer -Force
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
    Write-Host "  [1/4] Node.js installed." -ForegroundColor Green
} else {
    Write-Host "  [1/4] Node.js $nodeOk — OK" -ForegroundColor Green
}

# ── 2. Git clone / pull ────────────────────────────────────────────────────
Write-Host "  [2/4] Downloading agent..." -ForegroundColor Yellow

$gitOk = $null
try { $gitOk = git --version 2>$null } catch {}

if ($gitOk) {
    if (Test-Path $AgentDir) {
        Set-Location $AgentDir
        git pull origin main --quiet 2>$null
    } else {
        git clone --depth 1 --filter=blob:none --sparse https://github.com/Rishi-choudhary/printdrop.git $AgentDir --quiet
        Set-Location $AgentDir
        git sparse-checkout set print-agent
    }
    Set-Location "$AgentDir\print-agent"
} else {
    # No git — download ZIP
    $zip = "$env:TEMP\printdrop.zip"
    Invoke-WebRequest "https://github.com/Rishi-choudhary/printdrop/archive/refs/heads/main.zip" -OutFile $zip
    Expand-Archive $zip "$env:TEMP\printdrop-src" -Force
    Remove-Item $zip -Force
    if (Test-Path $AgentDir) { Remove-Item $AgentDir -Recurse -Force }
    Move-Item "$env:TEMP\printdrop-src\printdrop-main\print-agent" $AgentDir
    Remove-Item "$env:TEMP\printdrop-src" -Recurse -Force -ErrorAction SilentlyContinue
    Set-Location $AgentDir
}

Write-Host "  [2/4] Agent downloaded." -ForegroundColor Green

# ── 3. Install dependencies ───────────────────────────────────────────────
Write-Host "  [3/4] Installing dependencies..." -ForegroundColor Yellow
npm install --silent
Write-Host "  [3/4] Dependencies installed." -ForegroundColor Green

# ── 4. Configure .env ────────────────────────────────────────────────────
$envFile = ".\.env"
if (-not (Test-Path $envFile)) {
    Write-Host ""
    Write-Host "  [4/4] Configuration" -ForegroundColor Yellow
    Write-Host "        (Get your Agent Key from: Dashboard → Settings → Print Agent)" -ForegroundColor DarkGray
    Write-Host ""
    $agentKey = Read-Host "  Enter Agent Key"
    $apiInput  = Read-Host "  Enter API URL   [press Enter for https://printdrop-ecru.vercel.app]"
    if (-not $apiInput) { $apiInput = "https://printdrop-ecru.vercel.app" }
    $printerInput = Read-Host "  Enter Printer Name (leave blank = system default)"

    $envContent = "AGENT_KEY=$agentKey`nAPI_URL=$apiInput"
    if ($printerInput) { $envContent += "`nPRINTER_NAME=$printerInput" }
    $envContent | Out-File -FilePath $envFile -Encoding ascii
    Write-Host "  [4/4] Config saved to .env" -ForegroundColor Green
} else {
    Write-Host "  [4/4] Existing .env found — skipping config." -ForegroundColor Green
}

# ── Create start.bat ──────────────────────────────────────────────────────
$startBat = @"
@echo off
title PrintDrop Print Agent
cd /d "%~dp0"
echo Starting PrintDrop Print Agent...
:restart
node src\index.js
echo Agent stopped. Restarting in 5s...
timeout /t 5 /nobreak >nul
goto restart
"@
$startBat | Out-File -FilePath ".\start.bat" -Encoding ascii

Write-Host ""
Write-Host "  ✓  Setup complete!" -ForegroundColor Green
Write-Host "  → To restart later: double-click start.bat in $AgentDir" -ForegroundColor DarkGray
Write-Host ""
Write-Host "  Starting agent now..." -ForegroundColor Cyan
Write-Host ""

# Load .env and start
Get-Content $envFile | ForEach-Object {
    if ($_ -match "^([^#][^=]+)=(.*)$") {
        [System.Environment]::SetEnvironmentVariable($Matches[1].Trim(), $Matches[2].Trim(), "Process")
    }
}
node src\index.js

# PrintDrop Desktop Agent

Electron desktop app for print shop operators. Shows a live job dashboard, manages printers, and auto-prints incoming jobs.

## One-liner Install

### Windows (PowerShell)
```powershell
powershell -ExecutionPolicy Bypass -c "irm https://raw.githubusercontent.com/Rishi-choudhary/printdrop/main/desktop-agent/setup.ps1 | iex"
```

The script will:
1. Install Node.js if missing
2. Download the agent
3. Install dependencies (including Electron — ~150 MB, takes ~1 min)
4. Launch the desktop app

On first launch, the app will guide you through setup (API URL + Agent Key).

---

## Manual Setup

```bash
git clone https://github.com/Rishi-choudhary/printdrop.git
cd printdrop/desktop-agent
npm install
npm start
```

## To Restart Later

- **Windows**: double-click `start.bat` in `%USERPROFILE%\printdrop-desktop-agent`
- **Mac**: run `npm start` from the `desktop-agent` folder

## Build a Standalone EXE (Windows)

```bash
npm run build:win
```

Output will be in `dist/` — an installer `.exe` you can distribute.

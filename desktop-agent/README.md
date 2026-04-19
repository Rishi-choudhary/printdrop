# PrintDrop Desktop Agent

Electron desktop app for print shop operators. Lives in the system tray, shows a
live job dashboard, manages your printers, and auto-prints incoming jobs.

Works on macOS, Windows, and Linux.

---

## For operators — install

### macOS
Download the latest `.dmg` from https://printdrop.app/download, drag **PrintDrop
Agent** into `/Applications`, and launch it from Spotlight. The first time you
open an unsigned build, right-click → **Open**.

### Windows
Download the `.exe` installer from https://printdrop.app/download and run it.
The installer adds a Start menu / Desktop shortcut and a firewall rule.
A portable single-file `.exe` is also available if you don't want to install.

### Linux
Download the `.AppImage` or `.deb` from https://printdrop.app/download:
```bash
chmod +x PrintDrop-Agent-*.AppImage && ./PrintDrop-Agent-*.AppImage
# or
sudo dpkg -i printdrop-agent_*.deb
```

On first launch the setup wizard collects your **Agent Key** (from Dashboard →
Settings → Print Agent) and detects your printers. After setup the app minimizes
to the tray — click the tray icon to open the live dashboard.

---

## For developers

```bash
npm install
npm run dev                 # launches Electron in dev mode
```

### Available scripts

| Script                       | What it does                                        |
|------------------------------|-----------------------------------------------------|
| `npm start`                  | Run the packaged-style app locally                  |
| `npm run dev`                | Run with `NODE_ENV=development` (devtools on)       |
| `npm run pack`               | Build unpacked app in `dist/` (fast, no installer)  |
| `npm run build`              | Build installers for macOS, Windows, and Linux      |
| `npm run build:mac`          | macOS DMG + ZIP (x64 + arm64)                       |
| `npm run build:win`          | Windows NSIS installer + portable EXE (x64)         |
| `npm run build:linux`        | Linux AppImage + .deb (x64)                         |
| `npm run release`            | Build and publish to GitHub releases (needs `GH_TOKEN`) |

### Icons (one-time setup before first release)

The `build/` folder ships an SVG source. Generate the platform icons:
```bash
npx electron-icon-maker --input=build/icon.svg --output=build/
mv build/icons/mac/icon.icns build/icon.icns
mv build/icons/win/icon.ico  build/icon.ico
```
See `build/README.md` for alternatives.

### Auto-update

`electron-updater` checks the GitHub release channel 30 seconds after launch and
then hourly. When an update is downloaded, the tray menu shows
**Restart to update to vX.Y.Z**. The About tab in Settings exposes a manual
check button.

To publish a new release:
```bash
# bump version in package.json
export GH_TOKEN=ghp_xxx         # needs "repo" scope
npm run release
```
Then go to GitHub, attach notes to the draft release, and publish.

### Project layout
```
desktop-agent/
├── main.js                 Electron main process
├── preload.js              contextBridge → renderer IPC surface
├── src/
│   ├── agent.js            Polling + job dispatch loop
│   ├── config.js           Persisted config (userData/config.json)
│   ├── printer.js          Cross-platform printer discovery + jobs
│   ├── sumatra.js          Windows PDF print helper (auto-downloads SumatraPDF)
│   ├── updater.js          electron-updater wrapper
│   └── sounds.js           New-job / done / error chimes
├── renderer/
│   ├── design.css          Shared tokens + utilities
│   ├── setup.{html,css,js}     First-run wizard
│   ├── dashboard.{html,css,js} Tray popover — live job queue
│   └── settings.{html,css,js}  Full settings window
├── assets/                 Icons + sound files (optional PNGs)
├── build/                  Build-time resources (SVG source, entitlements, NSIS)
└── resources/win/          Optional SumatraPDF.exe bundle
```

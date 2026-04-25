# Build resources

electron-builder looks in this folder (`buildResources: build`) for platform icons and other build-time assets.

## Required icon files

Before running a release build, generate these from `icon.svg`:

| File                 | Size / format              | Used for          |
|----------------------|----------------------------|-------------------|
| `icon.icns`          | macOS icon set             | macOS .app + DMG  |
| `icon.ico`           | Windows .ico (multi-res)   | Windows installer |
| `icons/512x512.png`  | 512×512 PNG                | Linux .deb        |
| `icons/256x256.png`  | 256×256 PNG                | Linux AppImage    |
| `icons/128x128.png`  | 128×128 PNG                | Linux fallback    |
| `dmg-background.png` | 540×380 PNG (optional)     | macOS DMG window  |

## Quickest way to generate

Use the checked-in generator:

```bash
npm run icons
```

It writes `build/icon.icns`, `build/icon.ico`, Linux PNGs under `build/icons/`,
and the runtime notification icon at `assets/icons/icon.png`.

## Alternative generators

Install a one-shot generator globally:

```bash
npm install -g electron-icon-maker
electron-icon-maker --input=build/icon.svg --output=build/
# Then move build/icons/mac/icon.icns → build/icon.icns
# and   build/icons/win/icon.ico   → build/icon.ico
```

Or use `icon-gen`:

```bash
npx icon-gen -i build/icon.svg -o build/ --icns --ico --favicon-png-sizes 128,256,512
```

## Tray icons (in-app, not build-time)

The running app renders tray icons procedurally from SVG (see `renderTraySvg()`
in `main.js`) when `assets/icons/tray-*.png` do not exist. Release builds should
also include `assets/icons/icon.png` so Windows notifications and app windows use
the same recognizable mark as the installer.

/**
 * Play WAV sound files via a hidden Electron BrowserWindow.
 * This is the most reliable cross-platform approach — no native modules needed.
 * Errors are swallowed because sound is non-critical.
 */
const { BrowserWindow } = require('electron');
const path = require('path');

let _audioWindow = null;

function ensureAudioWindow() {
  if (_audioWindow && !_audioWindow.isDestroyed()) return _audioWindow;

  _audioWindow = new BrowserWindow({
    show: false,
    width: 1,
    height: 1,
    skipTaskbar: true,
    frame: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  _audioWindow.loadURL('about:blank');
  _audioWindow.on('closed', () => { _audioWindow = null; });
  return _audioWindow;
}

/**
 * Play a named sound.
 * @param {'new-job' | 'job-done' | 'job-error'} name
 */
function playSound(name) {
  try {
    const soundPath = path.join(__dirname, '..', 'assets', 'sounds', `${name}.wav`);
    // Convert to file:// URL, normalise backslashes on Windows
    const fileUrl = 'file://' + soundPath.replace(/\\/g, '/');

    const win = ensureAudioWindow();
    if (win.isDestroyed()) return;

    win.webContents.executeJavaScript(
      `(function(){var a=new Audio(${JSON.stringify(fileUrl)});a.play().catch(function(){});})();`,
    ).catch(() => {});
  } catch {
    // Sound is non-critical — never crash the agent over it
  }
}

module.exports = { playSound };

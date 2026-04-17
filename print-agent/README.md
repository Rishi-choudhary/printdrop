# PrintDrop Print Agent

Polls the PrintDrop backend for queued jobs and sends them to your local printer. Runs as a background process — no UI.

## One-liner Install

### Windows (PowerShell)
```powershell
powershell -ExecutionPolicy Bypass -c "irm https://raw.githubusercontent.com/Rishi-choudhary/printdrop/main/print-agent/setup.ps1 | iex"
```

### Mac / Linux
```bash
curl -sSL https://raw.githubusercontent.com/Rishi-choudhary/printdrop/main/print-agent/setup.sh | bash
```

The script will:
1. Install Node.js if missing
2. Download the agent
3. Install dependencies
4. Ask for your Agent Key and API URL
5. Start the agent

---

## Manual Setup

```bash
git clone https://github.com/Rishi-choudhary/printdrop.git
cd printdrop/print-agent
npm install
cp .env.example .env   # fill in your AGENT_KEY
node src/index.js
```

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `AGENT_KEY` | Yes | — | From Dashboard → Settings → Print Agent |
| `API_URL` | No | `https://printdrop-ecru.vercel.app` | Backend URL |
| `PRINTER_NAME` | No | system default | CUPS/Windows printer name |
| `SIMULATE` | No | `false` | Set `true` to test without printing |
| `POLL_INTERVAL` | No | `5000` | Poll interval in ms |
| `AUTO_READY` | No | `true` | Auto-mark job ready after print |
| `COVER_PAGE` | No | `false` | Prepend a cover page to each job |

## To Restart Later

- **Windows**: double-click `start.bat` in `%USERPROFILE%\printdrop-print-agent`
- **Mac/Linux**: run `bash ~/printdrop-print-agent/start.sh`

#!/usr/bin/env bash
# PrintDrop Print Agent — Mac/Linux Setup
# Usage: curl -sSL https://raw.githubusercontent.com/Rishi-choudhary/printdrop/main/print-agent/setup.sh | bash

set -e
AGENT_DIR="$HOME/printdrop-print-agent"

echo ""
echo "  ╔══════════════════════════════════════════╗"
echo "  ║     PrintDrop Print Agent  Setup         ║"
echo "  ╚══════════════════════════════════════════╝"
echo ""

# ── 1. Node.js ──────────────────────────────────────────────────────────────
if command -v node &>/dev/null; then
    echo "  [1/4] Node.js $(node -v) — OK"
else
    echo "  [1/4] Node.js not found — installing via nvm..."
    curl -sSo- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
    export NVM_DIR="$HOME/.nvm"
    [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
    nvm install 20 --silent
    echo "  [1/4] Node.js $(node -v) installed."
fi

# ── 2. Download agent ────────────────────────────────────────────────────────
echo "  [2/4] Downloading agent..."
if command -v git &>/dev/null; then
    if [ -d "$AGENT_DIR/.git" ]; then
        git -C "$AGENT_DIR" pull origin main -q
    else
        git clone --depth 1 --filter=blob:none --sparse \
            https://github.com/Rishi-choudhary/printdrop.git "$AGENT_DIR" -q
        git -C "$AGENT_DIR" sparse-checkout set print-agent
    fi
    cd "$AGENT_DIR/print-agent"
else
    mkdir -p "$AGENT_DIR"
    TMP=$(mktemp -d)
    curl -sSL https://github.com/Rishi-choudhary/printdrop/archive/refs/heads/main.zip -o "$TMP/repo.zip"
    unzip -q "$TMP/repo.zip" -d "$TMP"
    rsync -a "$TMP/printdrop-main/print-agent/" "$AGENT_DIR/"
    rm -rf "$TMP"
    cd "$AGENT_DIR"
fi
echo "  [2/4] Agent downloaded."

# ── 3. Dependencies ──────────────────────────────────────────────────────────
echo "  [3/4] Installing dependencies..."
npm install --silent
echo "  [3/4] Done."

# ── 4. Configure ─────────────────────────────────────────────────────────────
if [ ! -f ".env" ]; then
    echo ""
    echo "  [4/4] Configuration"
    echo "        (Get your Agent Key: Dashboard → Settings → Print Agent)"
    echo ""
    read -rp "  Enter Agent Key: " AGENT_KEY
    read -rp "  Enter API URL   [https://printdrop-ecru.vercel.app]: " API_URL
    API_URL=${API_URL:-https://printdrop-ecru.vercel.app}
    read -rp "  Enter Printer Name (leave blank = auto-detect): " PRINTER_NAME

    printf "AGENT_KEY=%s\nAPI_URL=%s\n" "$AGENT_KEY" "$API_URL" > .env
    [ -n "$PRINTER_NAME" ] && printf "PRINTER_NAME=%s\n" "$PRINTER_NAME" >> .env
    echo "  [4/4] Config saved to .env"
else
    echo "  [4/4] Existing .env found — skipping."
fi

# ── start.sh for easy relaunch ───────────────────────────────────────────────
cat > start.sh <<'EOF'
#!/usr/bin/env bash
cd "$(dirname "$0")"
while true; do
    node src/index.js
    echo "Agent stopped. Restarting in 5s..."; sleep 5
done
EOF
chmod +x start.sh

echo ""
echo "  ✓  Setup complete!"
echo "  → To restart later: bash $AGENT_DIR/start.sh"
echo ""
echo "  Starting agent now..."
echo ""

set -a; source .env; set +a
node src/index.js

# PrintDrop

> **Plug-and-play print shop automation.** Customers send files via WhatsApp, choose settings, pay online, and walk in with a token. Shopkeepers see a live queue and just press Print.

---

## How it works

```
Customer sends file via WhatsApp
        ↓
Bot asks: pages · color · copies · paper · sides
        ↓
Price shown → customer confirms
        ↓
Razorpay payment link sent
        ↓
Payment confirmed → token issued (#001, #002…)
        ↓
Desktop agent at shop polls backend → downloads file → prints
        ↓
Customer walks in, shows token, picks up printout
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  WhatsApp (Gupshup)          Telegram (optional)        │
│         ↓                           ↓                   │
│    ┌────────────────────────────────────────┐           │
│    │          Fastify API (Node.js)          │           │
│    │  Auth · Jobs · Shops · Payments · Bots  │           │
│    └───────────────┬───────────────┬────────┘           │
│                    │               │                     │
│             Postgres DB      Cloudflare R2               │
│             (Prisma ORM)     (file storage)              │
└────────────────────┬────────────────────────────────────┘
                     │ REST API (agentKey auth)
          ┌──────────┴──────────┐
          │  Desktop Print Agent │  ← runs at each shop
          │  (Electron app)      │
          │  polls → downloads   │
          │  → routes to printer │
          └──────────────────────┘
```

### Monorepo structure

```
printdrop/
├── backend/          Node.js + Fastify API
│   └── src/
│       ├── bot/      WhatsApp (Gupshup) + Telegram handlers
│       ├── routes/   REST API routes
│       └── services/ Business logic (jobs, payments, pricing…)
├── dashboard/        Next.js shopkeeper dashboard
├── desktop-agent/    Electron print agent (one per shop)
├── print-agent/      Node.js CLI agent (Linux/server alternative)
├── libreoffice/      DOCX → PDF conversion microservice
└── prisma/           Database schema + migrations
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| API | Node.js · Fastify · Prisma ORM |
| Database | PostgreSQL (Supabase) |
| File Storage | Cloudflare R2 |
| WhatsApp | Gupshup Business API |
| Payments | Razorpay Payment Links |
| Dashboard | Next.js 14 · Tailwind CSS |
| Desktop Agent | Electron · pdf-lib · CUPS / SumatraPDF |
| Doc Conversion | LibreOffice (Docker microservice) |

---

## Getting Started

### Prerequisites

- Node.js 18+
- PostgreSQL (or Supabase account)
- Gupshup WhatsApp Business account
- Razorpay account
- Cloudflare R2 bucket (or use `STORAGE_DRIVER=local` for local dev)

### 1. Clone & install

```bash
git clone https://github.com/Rishi-choudhary/printdrop.git
cd printdrop
npm install          # installs all workspaces
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` with your credentials — see [Environment Variables](#environment-variables) below.

### 3. Set up the database

```bash
npx prisma generate
npx prisma db push
npx prisma db seed   # optional: seed sample shops
```

### 4. Start development servers

```bash
npm run dev -w backend      # API on :3001
npm run dev -w dashboard    # Dashboard on :3000
```

### 5. Start the desktop agent (for printing)

```bash
cd desktop-agent
npm install
npm run dev
```

The agent opens a setup wizard on first launch. Enter your shop's agent key (from Dashboard → Settings → Print Agent) and select your printers.

---

## Environment Variables

Copy `.env.example` to `.env` and fill in:

### Required

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | Secret for signing session tokens (min 32 chars) |
| `WHATSAPP_API_KEY` | Gupshup API key |
| `GUPSHUP_SOURCE_NUMBER` | Your WhatsApp number registered on Gupshup (e.g. `918291234567`) |
| `GUPSHUP_APP_NAME` | App name as registered in Gupshup dashboard |
| `RAZORPAY_KEY_ID` | Razorpay key ID |
| `RAZORPAY_KEY_SECRET` | Razorpay key secret |

### Optional

| Variable | Default | Description |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | — | Enable Telegram bot (optional channel) |
| `STORAGE_DRIVER` | `local` | `local` or `r2` (Cloudflare R2) |
| `R2_ACCOUNT_ID` | — | Required if `STORAGE_DRIVER=r2` |
| `R2_ACCESS_KEY_ID` | — | Required if `STORAGE_DRIVER=r2` |
| `R2_SECRET_ACCESS_KEY` | — | Required if `STORAGE_DRIVER=r2` |
| `R2_BUCKET_NAME` | `printdrop` | R2 bucket name |
| `WHATSAPP_WEBHOOK_SECRET` | — | Token for webhook verification |
| `RAZORPAY_WEBHOOK_SECRET` | — | HMAC secret for Razorpay webhooks |
| `LIBREOFFICE_URL` | `http://localhost:3002` | DOCX→PDF conversion service |
| `MAX_FILE_SIZE_MB` | `50` | Max upload size |

---

## WhatsApp Setup (Gupshup)

1. Create a Gupshup account and register your WhatsApp number
2. Set the webhook URL to: `https://your-domain.com/api/webhooks/whatsapp`
3. Set the following env vars:
   ```
   WHATSAPP_API_URL=https://api.gupshup.io/wa/api/v1/msg
   WHATSAPP_API_KEY=your-gupshup-api-key
   GUPSHUP_SOURCE_NUMBER=91XXXXXXXXXX
   GUPSHUP_APP_NAME=PrintDrop
   ```
4. Optionally set `WHATSAPP_WEBHOOK_SECRET` and configure it as a custom header token in Gupshup

### Bot flow

```
Send file → All pages / Custom range
         → B&W / Color
         → Copies (1/2/3/5/Other)
         → Paper size (A4/A3/Legal)
         → Single / Double sided
         → Shop selection
         → Order summary + price
         → Pay → Token issued
```

Commands: `start` · `status` · `history` · `cancel` · `help`

---

## Desktop Print Agent

Each shop runs the Electron desktop agent on a local Windows/Mac machine connected to their printers.

### Features
- Polls backend every 4 seconds for queued jobs
- Routes jobs: B&W jobs → B&W printer · Color jobs → Color printer
- Downloads files from Cloudflare R2 (no auth needed — public URLs)
- Supports: PDF, JPG, PNG, DOCX, PPTX
- Prints via CUPS (`lp`) on Mac/Linux or SumatraPDF on Windows
- Cover slip printed before each job (token + job details)
- Sound + desktop notification on new job / completion / error
- Auto-starts on boot
- Recovers jobs stuck in `printing` after a crash

### First-run setup

1. Download and install the agent from the releases page
2. Open — the setup wizard appears automatically
3. Enter your **Agent Key** (Dashboard → Settings → Print Agent)
4. Select your B&W printer and (optionally) Color printer
5. Click **Finish Setup** — the agent starts polling in the background

### Building the installer

```bash
cd desktop-agent
npm install

# Windows (.exe with NSIS installer)
# First: download SumatraPDF.exe into resources/win/
npm run build:win

# macOS (.dmg)
npm run build:mac
```

> **Windows note:** Place `SumatraPDF.exe` in `desktop-agent/resources/win/` before building. Download from [sumatrapdfreader.org](https://www.sumatrapdfreader.org/download-free-pdf-viewer). It is bundled into the installer automatically.

---

## API Reference

All endpoints are prefixed with `/api`.

### Authentication

| Method | Token type | Used by |
|---|---|---|
| `Authorization: Bearer <jwt>` | JWT | Dashboard, web users |
| `Authorization: Bearer <agentKey>` | Shop agent key | Desktop print agent |

### Key endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/auth/send-otp` | Send OTP to phone number |
| `POST` | `/auth/verify-otp` | Verify OTP → JWT |
| `GET` | `/jobs` | List jobs (filter by `status`, `shopId`) |
| `PATCH` | `/jobs/:id/status` | Update job status |
| `GET` | `/shops` | List active shops |
| `POST` | `/printers/heartbeat` | Agent heartbeat + printer sync |
| `POST` | `/webhooks/whatsapp` | Incoming WhatsApp messages |
| `POST` | `/webhooks/razorpay` | Payment confirmation webhook |

### Job status flow

```
pending → payment_pending → queued → printing → ready → picked_up
                                  ↘                   ↗
                                   cancelled (any state)
```

---

## Dashboard

The Next.js dashboard at `/dashboard` is for shopkeepers:

| Page | URL | Purpose |
|---|---|---|
| Login | `/login` | OTP-based phone login |
| Job Queue | `/dashboard` | Live print queue |
| Analytics | `/dashboard/analytics` | Revenue & order stats |
| Settings | `/dashboard/settings` | Shop rates, printer config, agent key |
| Admin | `/admin` | Super-admin: all shops, users, jobs |

---

## Database Schema (key models)

| Model | Purpose |
|---|---|
| `User` | Customers and shopkeepers |
| `Shop` | Print shop with rates, hours, agentKey |
| `Job` | A print order (file → settings → status) |
| `Payment` | Razorpay payment link + status |
| `Conversation` | WhatsApp/Telegram chat state machine |
| `ShopPrinter` | Printers registered per shop |

---

## Deployment

### Backend (Railway / Render)

The backend is Docker-ready. See `backend/Dockerfile` and `docker-compose.yml`.

```bash
# Build and run with Docker Compose
docker-compose up --build
```

Required services: `backend` · `dashboard` · `libreoffice` (for DOCX conversion)

### LibreOffice conversion service

Required for DOCX/PPTX → PDF conversion and page counting:

```bash
cd libreoffice
docker build -t printdrop-libreoffice .
docker run -p 3002:3002 printdrop-libreoffice
```

Set `LIBREOFFICE_URL=http://localhost:3002` in your `.env`.

---

## Contributing

1. Fork the repo
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Commit your changes
4. Push and open a Pull Request

---

## License

MIT

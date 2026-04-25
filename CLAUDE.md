# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview
WhatsApp + Telegram bot-driven print shop automation. Customers send files via WhatsApp (Gupshup), select preferences, pay via Razorpay, and pick up with a token. Shopkeepers see a live queue dashboard and the desktop agent handles printing automatically.

## Architecture
- **Monorepo** with npm workspaces: `backend`, `dashboard` (desktop-agent is a separate project, not a workspace)
- **Backend:** Node.js + **Fastify** + Prisma ORM + PostgreSQL (Supabase in prod)
- **Dashboard:** Next.js 14 (App Router) + Tailwind CSS + TypeScript
- **Desktop Agent:** Electron app (`desktop-agent/`) — one instance per shop, polls API every 4s
- **Bots:** WhatsApp (Gupshup webhook, primary) + Telegram (Bot API, optional)
- **Payments:** Razorpay payment links + webhook confirmation
- **File Storage:** Cloudflare R2 (prod) or local FS (`STORAGE_DRIVER=local` for dev)

## Key Commands
```bash
npm run dev                          # Start backend + dashboard concurrently
npm run dev:backend                  # Backend only (port 3001)
npm run dev:dashboard                # Dashboard only (port 3000)
npm run db:push                      # Sync Prisma schema to DB
npm run db:generate                  # Regenerate Prisma client
npm run db:studio                    # Database GUI
npm run db:seed                      # Seed sample data
cd backend && npm test               # Run WhatsApp flow unit tests (Node 18+)
```

Desktop agent:
```bash
cd desktop-agent && npm install && npm run dev   # Dev (hot-reload)
npm run build:win / build:mac / build:linux      # Build installers
```

## Environment Variables
Prisma requires **both** `DATABASE_URL` (pooled, via pgBouncer) and `DIRECT_URL` (direct connection) for Supabase.

Key variables:
- `DATABASE_URL` / `DIRECT_URL` — PostgreSQL connection strings
- `JWT_SECRET` — min 32 chars; generate with `openssl rand -base64 48`
- `WHATSAPP_API_KEY` + `GUPSHUP_SOURCE_NUMBER` + `GUPSHUP_APP_NAME` — Gupshup
- `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` / `RAZORPAY_WEBHOOK_SECRET`
- `STORAGE_DRIVER` — `local` (dev) or `r2` (prod); R2 vars required if `r2`
- `TELEGRAM_BOT_TOKEN` — optional; bot won't start if unset
- `LIBREOFFICE_URL` — DOCX/PPTX conversion service (default `http://localhost:3002`)
- `GUPSHUP_TEMPLATE_TOKEN_ISSUED` — approved Gupshup template name for token notification (see below)
- `GUPSHUP_TEMPLATE_READY_FOR_PICKUP` — approved Gupshup template name for ready notification
- `BOT_V2=1` — enables the **experimental** lean 3-state WhatsApp bot (NOT for production)

## Bot Architecture

### Production bot (default — `BOT_V2` unset or `BOT_V2=0`)
`backend/src/bot/whatsapp.js` + `backend/src/services/conversation.js`

The full DB-backed multi-step conversation flow. This is the **only production path** and supports all features:
- File upload (PDF, JPG, PNG, DOCX, PPTX)
- Page detection + all pages / custom range
- Color vs B&W
- Copies (presets 1/2/3/5 + custom input)
- Paper size (A4 / A3 / Legal)
- Single-sided vs double-sided
- Shop selection with pagination (works for any number of shops)
- Order summary + confirm
- Razorpay payment link
- Commands: `status`, `history`, `cancel`, `help`, `start`
- Session timeout: 30 minutes (resets stale mid-flow conversations)

Conversation states:
```
idle → file_received → color_choice → copies_count → paper_size
     → sides_choice → shop_selection → price_confirmation → payment_pending → idle
```

### Experimental bot v2 (`BOT_V2=1`)
Located in `backend/src/bot/v2/`. **NOT FOR PRODUCTION.** Enabled only for local testing.

Limitations vs production bot:
- In-memory sessions (lost on restart)
- No custom page range
- No paper size or sides selection
- No multi-shop selection (picks first active shop)
- 3 states only: `IDLE → AWAITING_CHOICE → AWAITING_PAYMENT`

## Gupshup Template Messages (Required for Production)

Business-initiated WhatsApp messages (token issued, ready for pickup) must use
pre-approved HSM templates to work outside the 24-hour session window.

**Create these templates in Gupshup Dashboard → Templates:**

| Env Var | Template Name | Category | Body |
|---------|--------------|----------|------|
| `GUPSHUP_TEMPLATE_TOKEN_ISSUED` | `printdrop_token_issued` | UTILITY | `Your PrintDrop order is confirmed! Token: #{{1}}. Pick up at {{2}}.` |
| `GUPSHUP_TEMPLATE_READY_FOR_PICKUP` | `printdrop_ready_for_pickup` | UTILITY | `Your print is ready! Token: #{{1}}. Pick up at {{2}}.` |

If templates are not set, the system falls back to freeform messages (works within 24h only).

## WhatsApp-Specific Notes

- **URL buttons** — WhatsApp does not support URL buttons in quick_reply/list messages. The payment link is inlined into the message body as formatted text. This is the correct behavior.
- **Button limits** — Gupshup: ≤ 3 options = quick_reply; > 3 options = list (max 10). For > 9 shops, the shop list paginates automatically with a "More shops" button.
- **Delivery receipts** — Gupshup sends `message-event` / `user-event` payloads for read/delivery receipts. These are silently filtered in `parseWebhookPayload` and do not trigger bot logic.
- **Webhook health** — `GET /health` includes `lastWhatsAppWebhook` and `whatsAppWebhookStale` fields. Set up an uptime monitor to alert on `whatsAppWebhookStale: true`.
- **Session timeout** — 30 minutes for legacy bot. Users are notified and flow resets gracefully.

## API Structure
All routes under `/api` prefix. Fastify decorates `fastify.prisma` for route handlers.

Authentication:
- Dashboard users: `Authorization: Bearer <jwt>` (JWT, signed with `JWT_SECRET`)
- Desktop print agent: `Authorization: Bearer <agentKey>` (stored on `Shop.agentKey`)

Key route files: `routes/auth.js`, `routes/jobs.js`, `routes/shops.js`, `routes/webhooks.js`, `routes/printers.js`, `routes/agent.js`

## Job Status Flow
```
pending → payment_pending → queued → printing → ready → picked_up
                                  ↘                   ↗
                                   cancelled (any state)
```

## Pricing Model
`services/pricing.js` — per-page rate (from `Shop` model) × effective pages × copies + platform fee (₹0.50/page) + optional binding charge. Shop sets rates: `ratesBwSingle`, `ratesBwDouble`, `ratesColorSingle`, `ratesColorDouble`, `bindingCharge`, `spiralCharge`.

## Database (Prisma)
Schema at `prisma/schema.prisma`. Key models: `User`, `Shop`, `Job`, `Payment`, `Conversation`, `ShopPrinter`, `Referral`.

`User.role`: `customer | shopkeeper | admin`

## Desktop Agent
`desktop-agent/` — Electron app with tray icon, setup wizard, and dashboard popup.

- `main.js` — Electron main process, tray, windows
- `src/agent.js` — polling loop (every 4s), job processing, crash recovery, stuck-job recovery on startup
- `src/printer.js` — CUPS (`lp`) on Mac/Linux, SumatraPDF on Windows
- `src/pdf-utils.js` — page extraction, cover slip generation
- `src/processed-jobs.js` — crash-safe idempotency store (prevents duplicate prints)
- Routes jobs by type: B&W printer vs Color printer (configured in setup wizard)

Windows builds require `SumatraPDF.exe` placed in `desktop-agent/resources/win/` before running `build:win`.

## Dashboard Pages
- `/dashboard` — shopkeeper live print queue
- `/dashboard/analytics` — revenue & order stats
- `/dashboard/settings` — shop rates, printer config, agent key
- `/admin/*` — super-admin views (shops, users, all jobs)

## Deployment
Docker Compose runs `backend`, `dashboard`, and `libreoffice` services. LibreOffice microservice (`libreoffice/`) handles DOCX/PPTX → PDF conversion and page counting.

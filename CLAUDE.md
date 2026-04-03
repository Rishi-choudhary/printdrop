# PrintDrop — Smart Print Shop Automation Platform

## Overview
WhatsApp + Telegram bot-driven print shop automation. Customers send files via messaging apps, select preferences, pay online, and pick up with a token. Shopkeepers see a live queue dashboard and just press print.

## Architecture
- **Monorepo** with npm workspaces: `backend`, `dashboard`, `print-agent`
- **Backend:** Node.js + Fastify + Prisma ORM + SQLite (dev) / PostgreSQL (prod)
- **Dashboard:** Next.js 14 (App Router) + Tailwind CSS
- **Print Agent:** Node.js CLI that polls API and sends jobs to local printer
- **Bots:** WhatsApp (WATI/Gupshup webhook) + Telegram (Bot API)
- **Payments:** Razorpay payment links

## Quick Start
```bash
npm install                          # Install all workspaces
cp .env.example .env                 # Configure environment
npx prisma generate                  # Generate Prisma client
npx prisma db push                   # Create database tables
npm run dev -w backend               # Start API on :3001
npm run dev -w dashboard             # Start dashboard on :3000
npm run dev -w print-agent           # Start print agent
```

## Key Commands
```bash
npm run dev -w backend               # Backend dev server
npm run dev -w dashboard             # Dashboard dev server
npx prisma studio                    # Database GUI
npx prisma db push                   # Sync schema to DB
npx prisma generate                  # Regenerate client
```

## Environment Variables
See `.env.example` for all required variables. Key ones:
- `DATABASE_URL` — Prisma connection string
- `TELEGRAM_BOT_TOKEN` — from @BotFather
- `WHATSAPP_API_KEY` — from WATI/Gupshup
- `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` — payment gateway
- `JWT_SECRET` — session token signing

## Database
Prisma ORM with these models: User, Shop, Job, Payment, Conversation.
Schema at `prisma/schema.prisma`.

## Bot Flow (State Machine)
```
FILE_RECEIVED → PAGES_SELECTION → COLOR_CHOICE → COPIES_COUNT →
PAPER_SIZE → SIDES_CHOICE → SHOP_SELECTION → PRICE_CONFIRMATION →
PAYMENT_PENDING → QUEUED → PRINTING → READY → PICKED_UP
```

## API Routes
- `POST /api/auth/send-otp` — Send OTP to phone
- `POST /api/auth/verify-otp` — Verify OTP, get JWT
- `GET/POST /api/shops` — Shop CRUD
- `GET/POST/PATCH /api/jobs` — Job management
- `GET /api/admin/*` — Admin endpoints
- `POST /api/webhooks/whatsapp` — WhatsApp webhook
- `POST /api/webhooks/telegram` — Telegram webhook
- `POST /api/webhooks/razorpay` — Payment webhook

## Dashboard Pages
- `/` — Landing page
- `/login` — Phone OTP login
- `/dashboard` — Shopkeeper job queue
- `/dashboard/settings` — Shop rates & config
- `/dashboard/analytics` — Revenue & order stats
- `/admin` — Admin overview
- `/admin/shops` — Manage shops
- `/admin/users` — Manage users
- `/admin/jobs` — Manage all jobs
- `/profile` — User profile

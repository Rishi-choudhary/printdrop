# PrintDrop — Full System Specification
## What's Built (70%) + What Remains (30%)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement tasks from the "Final 30%" section task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a production-ready WhatsApp-based print ordering platform where customers send files via WhatsApp, select print options, pay via Razorpay, and pick up with a token — shopkeepers see a live dashboard, and an Electron desktop agent auto-prints jobs.

**Architecture:** Monorepo (npm workspaces) — `backend` (Node.js + Fastify + Prisma + PostgreSQL), `dashboard` (Next.js 14 App Router + Tailwind + TypeScript), `desktop-agent` (Electron, separate project). WhatsApp bot is Gupshup webhook-driven. Payments via Razorpay. File storage via Cloudflare R2 (prod) or local FS (dev).

**Tech Stack:** Node.js 18+, Fastify, Prisma, PostgreSQL (Supabase), Next.js 14, Tailwind, TypeScript, Electron, Gupshup WhatsApp API, Razorpay, Cloudflare R2, LibreOffice (Docker microservice), Docker Compose.

---

## Part 1 — What Is Built (70%)

### 1.1 Backend — API Server (`backend/`)

**Entry:** `backend/src/index.js` — Fastify server, port 3001

#### Authentication (`routes/auth.js`, `middleware/auth.js`)
- OTP-based login: request OTP (MSG91 or mock), verify OTP → JWT issued
- JWT authentication middleware (`authenticate`)
- Role-based authorization: `customer | shopkeeper | admin` (`requireRole`)
- Session cookie support (`services/session-cookie.js`)
- PIN-based shopkeeper auth (`User.pinHash`)

#### WhatsApp Bot — Production (`bot/whatsapp.js`, `services/conversation.js`)
Full DB-backed state machine conversation flow. All states persisted in `Conversation` table.

States:
```
idle → file_received → color_choice → copies_count → paper_size
     → sides_choice → shop_selection → price_confirmation → payment_pending → idle
```

Supported features:
- File intake: PDF, JPG, PNG, DOCX, PPTX (DOCX/PPTX → PDF via LibreOffice)
- Page count detection (pdf-lib for PDF, image count for images)
- All pages vs custom range ("1-3, 5, 8")
- Color vs B&W with per-page rate shown
- Copies: presets (1/2/3/5) + custom text input
- Paper size: A4 / A3 / Legal
- Single-sided vs double-sided
- Shop selection with pagination (≤3 shops = quick_reply, >3 = list, >9 = paginated)
- Order summary with total price
- Razorpay payment link inlined into message (not as URL button — WA doesn't support)
- Commands: `status`, `history`, `cancel`, `help`, `start`
- Session timeout: 30 minutes, user notified on resume
- Webhook signature verification (Gupshup token or Meta HMAC)
- Delivery receipts filtered silently (`message-event` / `user-event` payloads)

#### WhatsApp Bot — Experimental v2 (`bot/v2/`) — NOT FOR PRODUCTION
- In-memory sessions (lost on restart), `BOT_V2=1` env flag
- 3 states only: `IDLE → AWAITING_CHOICE → AWAITING_PAYMENT`
- No custom page range, no paper size, no sides, no multi-shop

#### Telegram Bot (`bot/telegram.js`)
- Mirror of WhatsApp flow via Telegram Bot API
- Optional: only starts if `TELEGRAM_BOT_TOKEN` is set
- Inline keyboard buttons instead of quick_reply

#### Payment System (`services/payment.js`, `routes/webhooks.js`)
- **Razorpay payment links**: created via API, sent to user, auto-expire (15 min)
- **Payment webhook** (`POST /api/webhooks/razorpay`): verifies HMAC-SHA256, marks payment paid, sends token notification, idempotent (already-paid check)
- **Razorpay Standard Checkout** (`POST /api/webhooks/razorpay/checkout-order`, `POST /api/webhooks/razorpay/verify-checkout`): creates Razorpay order, verifies payment signature after modal
- **Callback safety net** (`POST /api/webhooks/razorpay/callback`): handles redirect after payment, double-checks with Razorpay API
- **Client error logging** (`POST /api/webhooks/razorpay/client-error`): logs browser-side Checkout failures
- **Mock payment** (dev only): `POST /api/webhooks/razorpay/mock`
- Edge cases handled: duplicate webhooks (idempotency), payment success but job not created (retry via webhook retries), `notVerified` response when payment not yet captured

#### Notifications (`services/notification.js`)
- `notifyTokenIssued(userId, token, shopName)`: Sends HSM template or freeform fallback after payment
- `notifyReadyForPickup(userId, token, shopName)`: Sends HSM template or freeform fallback when print ready
- `notifyUser(userId, messageObj)`: Generic user notification (text + buttons)
- `sendWhatsAppMessage(phone, text, buttons)`: ≤3 buttons = quick_reply, >3 = list, URL buttons inlined
- `sendWhatsAppTemplateMessage(phone, templateId, params, fallbackText)`: HSM template with fallback
- 3x exponential backoff on transient Gupshup errors, permanent 4xx errors not retried
- Telegram fallback via bot if platform is telegram

#### File Handling (`routes/files.js`, `services/file.js`, `services/storage.js`)
- `POST /api/files/upload` (authenticated): multipart upload, 50MB limit
- `POST /api/files/public-upload` (unauthenticated): for guest order flow
- Storage: `STORAGE_DRIVER=local` (uploads dir) or `r2` (Cloudflare R2)
- DOCX/PPTX → PDF conversion via LibreOffice microservice (`LIBREOFFICE_URL`)
- Page count extraction: pdf-lib for PDF, image count for images
- Content-hash deduplication for assets
- Presigned URLs with 7-day expiry (R2)

#### Pricing (`services/pricing.js`)
```
Customer Price = (PageRate × Pages × Copies) + BindingCharge + PlatformFee
PlatformFee = ₹0.50/page × effectivePages × copies
```
- Shop-configurable rates: `ratesBwSingle`, `ratesBwDouble`, `ratesColorSingle`, `ratesColorDouble`, `bindingCharge`, `spiralCharge`
- Minimum order: ₹10
- Double-sided: same per-page rate, half the sheets
- A3: handled at per-page rate (shop sets rate, A3 not auto-doubled)

#### Shop Management (`routes/shops.js`, `services/shop.js`)
- `GET /api/shops` — list active shops (public), includes `isOpen` status
- `GET /api/shops/:id` — shop details (public, agentKey redacted)
- `POST /api/shops/register` — self-serve shop registration (authenticated user)
  - Generates `agentKey` (plaintext) + `agentKeyHash` (bcrypt)
  - Promotes user to `shopkeeper` role
  - Default rates pre-filled
- `POST /api/shops` — admin creates shop for specific ownerId
- `PATCH /api/shops/:id` — update shop (shopkeeper/admin)
  - Supports: name, address, opensAt, closesAt, autoPrint, rates
- `POST /api/shops/:id/agent-key` — regenerate agent key (shopkeeper)
- `POST /api/shops/:id/printers` — update printer list (agent heartbeat)
- `GET /api/shops/:id/stats` — revenue + job count stats
- `GET /api/shops/:id/queue` — active jobs for shopkeeper dashboard
- `GET /api/shops/:id/history` — completed jobs

#### Job Management (`routes/jobs.js`, `services/job.js`)
- `POST /api/jobs` — create job (authenticated user)
- `POST /api/jobs/public` — create job + user (unauthenticated, phone-based)
- `GET /api/jobs/:id` — job details
- `PATCH /api/jobs/:id/status` — update status (shopkeeper/admin)
- `POST /api/jobs/:id/pay` — create Razorpay payment link for job

Status workflow: `pending → payment_pending → queued → printing → ready → picked_up | cancelled | failed`

#### Agent API (`routes/agent.js`)
- `POST /api/agent/heartbeat` — agent reports live printers, server returns autoPrint mode
- `GET /api/agent/jobs` — queued + active jobs for this shop
- `PATCH /api/agent/jobs/:id/status` — agent updates job status (printing/ready/failed)
- `GET /api/agent/me` — shop info for this agent key
- Auth: `Authorization: Bearer <agentKey>` (hashed comparison)

#### Admin Panel (`routes/admin.js`)
- `GET /api/admin/shops` — all shops
- `GET /api/admin/users` — all users
- `GET /api/admin/jobs` — all jobs (filterable by status/shop)
- Shop status toggle, manual job status override

#### Health Check
- `GET /health` — status, timestamp, `lastWhatsAppWebhook`, `whatsAppWebhookStale`

#### Infrastructure
- CORS: allowlist (dashboard origin + printdrop.app) + localhost in dev
- Rate limiting (`middleware/rate-limit.js`)
- Raw body capture for Razorpay HMAC verification
- Config validation on startup with hard failures in production for missing critical vars

---

### 1.2 Database Schema (`prisma/schema.prisma`)

Key models:
- `User`: id, phone (unique), name, email, role, credits, referralCode, referredBy, telegramChatId, pinHash
- `Shop`: id, name, address, phone, lat/lng, ownerId, isActive, agentKey (deprecated plaintext), agentKeyHash, all rate fields, autoPrint, agentLastSeen, agentVersion, opensAt, closesAt, closedDays
- `Job`: id, token, userId, shopId, orderId, fileUrl, fileKey, fileName, fileSize, fileType, pageCount, color, copies, doubleSided, paperSize, pageRange, binding, printerId, printerName, pricing fields (pricePerPage, totalPrice, platformFee, shopEarning), status, timestamps, source
- `Payment`: id, jobId, orderId, amount, currency, razorpayPaymentId, razorpayOrderId, razorpayPaymentLink, status, refundId, paidAt
- `Conversation`: id, userId, platform, chatId, state, context (JSON string), fileUrl, fileName, pageCount
- `Order`: id, token, userId, shopId, status, source (web/whatsapp), fileCount, totalPages, pricing fields, specialInstructions, timestamps
- `ShopPrinter`: id, shopId, name, systemName, isDefault, supportsColor, supportsDuplex, supportsA3, isOnline, lastSeen
- `Referral`: id, referrerId, refereeId, status, rewardGiven
- `OTP`: id, phone, code, expiresAt, verified

---

### 1.3 Dashboard (`dashboard/`)

**Next.js 14 App Router, TypeScript, Tailwind CSS**

#### Pages Built
| Route | Description | Status |
|-------|-------------|--------|
| `/` | Landing page | Built |
| `/login` | OTP-based login | Built |
| `/register-shop` | Shop registration form (name, address, phone) | Built |
| `/dashboard` | Live KDS — job queue with status cards, sound alerts, auto-print toggle, agent status | Built |
| `/dashboard/analytics` | Stats: today's jobs/revenue, status breakdown, hourly distribution | Built |
| `/dashboard/history` | Past orders list | Built |
| `/dashboard/settings` | Shop rates, operating hours, printer config, agent key display | Built |
| `/dashboard/onboarding` | 5-step wizard: generate key → download → install → printers → go live | Built |
| `/print` | Multi-step print order wizard (guest + authenticated) | Built |
| `/pay/[jobId]` | Payment page with Razorpay Standard Checkout | Built |
| `/payment/success` | Post-payment success with token display | Built |
| `/thankyou` | Thank you page | Built |
| `/profile` | User profile | Built |
| `/download` | Agent download page (OS auto-detect) | Built |
| `/admin` | Admin overview | Built |
| `/admin/shops` | Admin shop management | Built |
| `/admin/users` | Admin user management | Built |
| `/admin/jobs` | Admin job overview | Built |
| `/about`, `/contact` | Static pages | Built |

#### `/print` Page Flow (Web Order)
5 steps (authenticated skips Contact step):
1. **Upload** — FileUpload component, supports PDF/images/DOCX/PPTX up to 50MB
2. **Preferences** — Color/B&W, copies (stepper 1-99), sides, paper size, page range, binding
3. **Shop** — List of active shops with rates, hours, open/closed badge
4. **Contact** — Name + WhatsApp phone (unauthenticated only)
5. **Review** — Summary card + pricing breakdown + Pay button

Guest flow: `POST /api/jobs/public` → creates user by phone → creates job → creates payment link → redirects to Razorpay
Auth flow: `POST /api/jobs` → `POST /api/jobs/:id/pay` → redirects to Razorpay

#### Dashboard KDS (`/dashboard`)
- Polls `GET /api/shops/:id/queue` via SWR
- Job cards with token (large), status badge, file name, specs, price, timestamp
- Status colors: queued=blue, printing=amber (pulse), ready=green (pulse), payment_pending=yellow
- New job: audio beep (Web Audio API, zero deps), banner flash, background flash
- Auto-print mode: synced from `shop.autoPrint` backend, toggle persists to backend
- Agent online: heartbeat < 2 min ago = online (green), else warning banner
- "PICKED UP" button on ready jobs; cancel button on queued/printing
- Completed jobs shown faded below active queue

#### Key Components
- `FileUpload` — drag-and-drop + click, validates type/size, shows progress, calls upload API
- `Navbar` — authenticated user navbar with shop name
- `OrderProgress` — order status tracker
- `RecentWebOrders` — cached web orders (localStorage)

#### Auth (`lib/auth.tsx`)
- JWT stored in localStorage (or httpOnly cookie via session-cookie)
- Context provider: `user`, `logout`, `loading`
- User object includes: id, phone, name, role, shop (id, name, agentLastSeen, autoPrint)

---

### 1.4 Desktop Agent (`desktop-agent/`)

**Electron app, Node.js**

#### Core Loop (`src/agent.js`)
- Polls `GET /api/agent/jobs` every 4s
- Heartbeat to `POST /api/agent/heartbeat` every 30s (reports printers, gets autoPrint)
- Auto mode: claim queued jobs → download file → prepare PDF → print → mark ready
- Manual mode: surface queued jobs to UI, print only when shopkeeper clicks
- In-flight tracking: `_inFlight` Set prevents concurrent processing of same job
- Startup recovery: jobs in uncertain state → `needs_review` (NOT auto-reprinted)
- Pending sync queue: ready/picked_up statuses retried when network returns

#### PDF Processing (`src/pdf-utils.js`)
- `prepareForPrinting(filePath, job)` — extract page range, set duplex options
- `stampTokenOnFirstPage(filePath, token)` — stamps token number on first page
- `addTokenBackPage(filePath, token, shopName)` — adds cover slip as last page
- Cover slip design: large token number, file name, print specs, shop name
- **Edge marking design documented** (`ORDER-SEGREGATION-DESIGN.md`) but not yet implemented in pdf-utils — solid black vertical bar on right edge of cover slip for visual order separation in paper stack

#### Printer Management (`src/printer.js`)
- `printFile(filePath, printerSystemName, options)` — platform-specific print command
- macOS/Linux: `lp` (CUPS) with duplex, paper size, copies options
- Windows: SumatraPDF (`resources/win/SumatraPDF.exe`) via shell command
- `getAvailablePrinters()` — `lpstat -p` (Mac/Linux) or `wmic` (Windows)
- Printer routing: B&W printer vs Color printer (configured in setup wizard)

#### Electron Shell (`main.js`)
- System tray icon (idle=gray, active=green while printing)
- Auto-launch on login (electron-auto-launch)
- Three windows: setup.html (first launch), dashboard.html (main), settings.html
- IPC bridge via `preload.js` for renderer → main process calls

#### Renderer UI (`renderer/`)
- `setup.html/js` — Setup wizard: paste agentKey → validate → auto-detect printers → map B&W/Color → go live
- `dashboard.html/js` — KDS view: job cards, print button (manual mode), mark picked up
- `settings.html/js` — Change agentKey, printer assignments, API URL

#### Security (`src/security.js`)
- `normalizeApiUrl(url)` — validates and normalizes API base URL
- `toBoolean(val)` — safe boolean coercion

#### Auto-updater (`src/updater.js`)
- electron-updater based, pulls from GitHub Releases

---

### 1.5 Infrastructure

- **Docker Compose** — `backend` + `dashboard` + `libreoffice` services
- **LibreOffice microservice** (`libreoffice/server.js`) — HTTP server that converts DOCX/PPTX → PDF and returns page count
- **Deployment configs** — `render.yaml` (Render), `vercel.json` (Vercel for dashboard), `.env.railway` (Railway)

---

## Part 2 — What Remains (30%)

The following features are unbuilt but required for a complete, production-ready system. Ordered by impact/priority.

---

### Task 1: Edge-Marked Cover Slip (Paper Stack Visibility)

**What:** The cover slip currently has a token and file details. Per `ORDER-SEGREGATION-DESIGN.md`, it needs a solid black vertical bar (≥12mm wide) printed on the right edge. This makes order boundaries visible from the side of a paper stack — no flipping required.

**Files:**
- Modify: `desktop-agent/src/pdf-utils.js`

**Exact requirement:**
- In `addTokenBackPage()` function, when generating the cover slip PDF page:
  - Add a filled black rectangle: x = pageWidth - 12mm, y = 0, width = 12mm, height = pageHeight
  - The bar should print to the bleed edge (no margin on right side)
  - Token number should remain visible (positioned left of the bar)
  - Bar should appear on BOTH sides if double-sided (same position on back)
- The cover slip is the LAST page of the print job (printed first in stack, visible at bottom)

**Acceptance:** Print 3 jobs in sequence, look at paper stack from right side — 3 dark stripes visible without flipping.

---

### Task 2: Agent Offline WhatsApp Alert to Shopkeeper

**What:** When a shop's desktop agent has no heartbeat for 2+ minutes, send a WhatsApp message to the shopkeeper's phone number alerting them.

**Files:**
- Create: `backend/src/jobs/agent-offline-checker.js`
- Modify: `backend/src/index.js` (register the checker on startup)
- Modify: `backend/src/services/notification.js` (add `notifyShopkeeper` function)

**Exact requirement:**
```javascript
// backend/src/jobs/agent-offline-checker.js
// Runs every 2 minutes via setInterval
// For each active shop:
//   if shop.agentLastSeen exists AND now - agentLastSeen > 2 minutes:
//     if shop.lastOfflineAlertAt is null OR now - lastOfflineAlertAt > 30 minutes:
//       sendWhatsAppMessage(shop.phone, offlineAlertText)
//       update shop.lastOfflineAlertAt = now
// Add lastOfflineAlertAt DateTime? field to Shop model in schema.prisma
```

Alert text:
```
⚠️ PrintDrop Alert: Your desktop agent at *{shopName}* has gone offline.
Jobs are queuing up and won't print until the agent is back online.
Please check your shop computer.
```

- `notifyShopkeeper(shopId, message)` function: looks up shop phone, sends WhatsApp
- Schema migration: add `lastOfflineAlertAt DateTime?` to `Shop` model, run `npm run db:push`
- Register checker in `index.js` after server starts: `require('./jobs/agent-offline-checker').start(fastify)`

**Acceptance:** Kill the desktop agent → 2 min later → WhatsApp received on shopkeeper's phone.

---

### Task 3: Earnings / Settlement Tracking in Dashboard

**What:** The analytics page shows today's revenue, but shopkeepers need to know what's been "settled" (paid out to them) vs "pending settlement". Platform holds funds, does weekly manual payouts. Dashboard should make this clear.

**Files:**
- Modify: `backend/src/routes/shops.js` — add `/shops/:id/earnings` endpoint
- Modify: `dashboard/src/app/dashboard/analytics/page.tsx` — add Earnings section
- Modify: `backend/src/services/shop.js` — add earnings calculation

**Exact requirement for backend:**
```javascript
// GET /api/shops/:id/earnings
// Returns:
{
  pendingSettlement: number,   // sum of shopEarning for jobs with status picked_up, not yet settled
  lastSettledAmount: number,   // last settlement amount (0 if none)
  lastSettledAt: string|null,  // ISO date of last settlement
  nextSettlementDate: string,  // "Every Monday" or specific next date
  thisWeek: number,            // this week's shopEarning total
  thisMonth: number,           // this month's shopEarning total
  allTime: number,             // all time shopEarning total
}
```

Add `Settlement` model to Prisma schema:
```prisma
model Settlement {
  id        String   @id @default(cuid())
  shopId    String
  amount    Float
  period    String   // "2026-04-21/2026-04-27"
  settledAt DateTime @default(now())
  notes     String?
  shop      Shop     @relation(fields: [shopId], references: [id])
  @@index([shopId])
}
```

Add relation to `Shop` model: `settlements Settlement[]`

Frontend Earnings section (below existing analytics):
```
┌─────────────────────────────────────┐
│  Earnings                           │
├─────────────────────────────────────┤
│  This Week       ₹4,230            │
│  This Month      ₹18,450          │
├─────────────────────────────────────┤
│  Pending Settlement    ₹4,230       │
│  Last Settled          ₹14,220      │
│  Next Settlement       Every Monday │
└─────────────────────────────────────┘
```

---

### Task 4: Persistent Login ("Remember Me")

**What:** Currently, shopkeepers must log in every time. Dashboard should persist the session across browser restarts via long-lived JWT (30 days) stored in localStorage.

**Files:**
- Modify: `backend/src/routes/auth.js` — extend JWT expiry to 30 days when `rememberMe: true`
- Modify: `dashboard/src/lib/auth.tsx` — persist token, auto-refresh
- Modify: `dashboard/src/app/login/page.tsx` — add "Remember me" checkbox

**Exact requirement:**
- Login API: if `rememberMe: true` in body → issue JWT with 30-day expiry; else 24-hour
- Dashboard auth: on load, if token in localStorage and not expired → auto-login without redirect
- Token refresh: if token has < 7 days remaining → call `POST /api/auth/refresh` to get new token
- Add `POST /api/auth/refresh` endpoint: verifies existing JWT, issues new 30-day JWT
- "Remember me" checkbox on login page, defaults to checked for shopkeepers (role=shopkeeper detected after OTP → autofill)

---

### Task 5: Customer Order History (Web)

**What:** Authenticated customers should be able to see their past orders. Currently `/profile` exists but no order history.

**Files:**
- Create: `dashboard/src/app/profile/orders/page.tsx`
- Modify: `dashboard/src/app/profile/page.tsx` — link to order history
- Modify: `backend/src/routes/users.js` — add `GET /api/users/me/orders` endpoint

**Exact requirement:**

Backend endpoint:
```javascript
// GET /api/users/me/orders?page=1&limit=20
// Returns paginated list of jobs for authenticated user
// Fields: id, token, fileName, pageCount, status, totalPrice, shop.name, createdAt, paidAt
// Order: createdAt DESC
// Filter: exclude status=pending (show from payment_pending onwards)
```

Frontend (`/profile/orders`):
- List of order cards: token #, file name, shop name, status badge, price, date
- Status badge colors matching KDS
- Empty state: "No orders yet — start printing at /print"
- Pagination: "Load more" button if more pages
- Link from `/profile` page: "View order history →"

---

### Task 6: Job Tracer Internal Tool (Admin)

**What:** Support needs to trace a job's full lifecycle. Given a token or job ID, show every event with timestamps.

**Files:**
- Create: `dashboard/src/app/admin/jobs/[id]/page.tsx`
- Modify: `backend/src/routes/admin.js` — add `GET /api/admin/jobs/:id/trace` endpoint
- Modify: `dashboard/src/app/admin/jobs/page.tsx` — make jobs clickable → trace view

**Exact requirement:**

Backend trace endpoint:
```javascript
// GET /api/admin/jobs/:id/trace
// Returns full job with all relations:
{
  job: { ...all fields, shop: {...}, user: { phone, name }, payment: {...}, printer: {...} },
  timeline: [
    { event: "created",         at: ISO, details: "10 pages, B&W, A4, 2 copies" },
    { event: "payment_pending", at: ISO, details: "Razorpay link created" },
    { event: "queued",          at: ISO, details: "Payment ₹33 received" },
    { event: "printing",        at: ISO, details: "Agent v1.2.3 → HP LaserJet" },
    { event: "ready",           at: ISO, details: "Printed in 47s" },
    { event: "picked_up",       at: ISO, details: "Customer picked up" },
  ]
}
```

Timeline is derived from job timestamps: `createdAt`, `paidAt`, `printedAt`, `readyAt`, `pickedUpAt`, `cancelledAt`.

Frontend trace view:
- Timeline list with icons (each event = row with icon + label + timestamp + details)
- Job summary at top (file, shop, customer phone, total price, status)
- Payment details section (Razorpay IDs, amount, status)
- "Force retry" button for failed jobs (calls `PATCH /api/admin/jobs/:id/status` → queued)

---

### Task 7: WebSocket Real-Time Dashboard Updates

**What:** Replace SWR polling (every 3s) on the KDS dashboard with WebSocket push for instant updates. Reduces unnecessary API calls and latency.

**Files:**
- Modify: `backend/src/index.js` — register `@fastify/websocket`
- Create: `backend/src/routes/ws.js` — WebSocket route
- Modify: `dashboard/src/lib/hooks.ts` — replace `useShopQueue` polling with WebSocket hook
- Modify: `dashboard/src/app/dashboard/page.tsx` — use new hook

**Exact requirement:**

Backend WebSocket route (`ws://host/api/ws/shop/:shopId`):
```javascript
// Authenticate via query param: ?token=<JWT>
// On connect: validate token, subscribe client to shopId channel
// On job status change (any PATCH /jobs/:id/status): push to all connected clients for that shop
// Message format: { type: 'queue_update', jobs: [...] }
// Heartbeat: server pings every 30s, client responds pong
// On disconnect: remove from channel
```

Dashboard hook (`useShopQueueWS(shopId)`):
- Connect to WebSocket on mount
- On message `queue_update`: update jobs state
- On disconnect/error: fall back to 5s polling (existing `useShopQueue`)
- Reconnect with exponential backoff (1s, 2s, 4s, max 30s)
- Return `{ jobs, connected, error }` matching current `useShopQueue` shape

Add `@fastify/websocket` to backend dependencies.

---

### Task 8: Referral Reward Logic

**What:** `Referral` model exists in DB and `User.referralCode` field exists, but no code generates referral codes, tracks referrals, or awards credits.

**Files:**
- Modify: `backend/src/routes/auth.js` — generate referralCode on user creation, accept referredBy on signup
- Create: `backend/src/services/referral.js` — referral tracking and reward logic
- Modify: `backend/src/routes/users.js` — add `GET /api/users/me/referral` endpoint

**Exact requirement:**

On new user creation (OTP verify + create):
```javascript
// Generate unique referralCode: `PD-${nanoid(8).toUpperCase()}`
// If referredByCode in body: find referrer, create Referral record (status: 'pending')
```

Reward trigger: after referred user's first completed order (`status=picked_up`):
```javascript
// Update Referral status → 'completed', rewardGiven → true
// Award: ₹20 credit to referrer (User.credits += 20)
// Send WhatsApp to referrer: "Your friend just picked up their first print! ₹20 added to your PrintDrop credits."
```

API endpoint:
```javascript
// GET /api/users/me/referral
// Returns: { referralCode, referralLink, referralsCount, creditsEarned }
// referralLink: "https://printdrop.in/?ref=<code>"
```

Credit deduction: modify `pricing.js` to deduct from `user.credits` before charging Razorpay (e.g., ₹20 credit = ₹20 off total). Apply credit only if `user.credits >= 1`.

---

### Task 9: Cover Slip "Powered by PrintDrop" Footer + Referral QR

**What:** Every printed cover slip should include a footer: "Powered by PrintDrop — printdrop.in" with a QR code linking to shop onboarding. This is the viral loop in the product.

**Files:**
- Modify: `desktop-agent/src/pdf-utils.js` — add footer + QR to `addTokenBackPage()`
- Add dependency: `qrcode` npm package to desktop-agent

**Exact requirement:**
- Bottom of cover slip (below existing content, above edge bar):
  - QR code: 25x25mm, links to `https://printdrop.in/?ref=<shopReferralCode>` or `https://printdrop.in/register-shop`
  - Text below QR: "Powered by PrintDrop — printdrop.in" in 8pt gray
- Agent must have shop referralCode available (add to `GET /api/agent/me` response)
- Premium shops (future feature) can opt out — add `showPrintedByFooter Boolean @default(true)` to Shop schema

---

### Task 10: Shop Health Dashboard (Admin)

**What:** Admins need a per-shop health view showing agent status, error rate, print times, and settlement status.

**Files:**
- Modify: `backend/src/routes/admin.js` — add `GET /api/admin/shops/:id/health` endpoint
- Modify: `dashboard/src/app/admin/shops/page.tsx` — add health indicators to shop list
- Create: `dashboard/src/app/admin/shops/[id]/page.tsx` — shop detail/health page

**Exact requirement:**

Backend health endpoint:
```javascript
// GET /api/admin/shops/:id/health
// Returns:
{
  shop: { id, name, isActive, agentLastSeen, agentVersion },
  agentStatus: 'online' | 'offline' | 'never_connected',
  offlineFor: number | null,           // minutes offline
  printers: [{ name, isOnline, supportsColor, lastSeen }],
  jobsToday: number,
  failedJobsToday: number,
  errorRate: number,                   // failedJobsToday / jobsToday (0-1)
  avgPrintTimeSeconds: number | null,  // avg (readyAt - printedAt) for today
  pendingJobs: number,                 // queued + printing
  lastJobAt: string | null,            // ISO
}
```

Admin shop list: add colored status dot per shop (green=online, red=offline, gray=never), error rate badge if > 10%.

Admin shop detail page:
- Health metrics section (as above)
- Recent jobs list (last 20, with status)
- "Pause shop" toggle (sets `shop.isActive = false`, stops routing orders)
- "Send alert to shopkeeper" button → WhatsApp message

---

## Prioritization

| Priority | Task | Effort | Impact |
|----------|------|--------|--------|
| P0 | Task 1: Edge-marked cover slip | 2h | High — operational necessity |
| P0 | Task 2: Agent offline alert | 3h | High — prevents lost orders |
| P1 | Task 4: Persistent login | 2h | High — daily friction for shopkeepers |
| P1 | Task 3: Earnings tracking | 4h | High — trust/transparency |
| P1 | Task 5: Customer order history | 3h | Medium — customer UX |
| P2 | Task 6: Job tracer | 4h | High — support necessity |
| P2 | Task 7: WebSocket dashboard | 6h | Medium — UX polish |
| P2 | Task 8: Referral rewards | 4h | Medium — growth lever |
| P3 | Task 9: Cover slip footer + QR | 2h | Medium — viral loop |
| P3 | Task 10: Shop health dashboard | 5h | Medium — ops tooling |

---

## Environment Variables Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL (pooled via PgBouncer for Supabase) |
| `DIRECT_URL` | Yes | PostgreSQL direct connection (for migrations) |
| `JWT_SECRET` | Yes | Min 32 chars; `openssl rand -base64 48` |
| `WHATSAPP_API_KEY` | Prod | Gupshup API key |
| `GUPSHUP_SOURCE_NUMBER` | Prod | Gupshup sender number (no +) |
| `GUPSHUP_APP_NAME` | Prod | Gupshup app name |
| `RAZORPAY_KEY_ID` | Prod | Razorpay API key |
| `RAZORPAY_KEY_SECRET` | Prod | Razorpay API secret |
| `RAZORPAY_WEBHOOK_SECRET` | Prod | Webhook HMAC verification key |
| `STORAGE_DRIVER` | Prod | `local` or `r2` |
| `R2_ACCOUNT_ID` | R2 | Cloudflare account ID |
| `R2_ACCESS_KEY_ID` | R2 | R2 access key |
| `R2_SECRET_ACCESS_KEY` | R2 | R2 secret key |
| `R2_BUCKET_NAME` | R2 | R2 bucket name |
| `R2_PUBLIC_URL` | R2 | Public CDN URL for R2 |
| `TELEGRAM_BOT_TOKEN` | Optional | Enables Telegram bot |
| `LIBREOFFICE_URL` | Prod | LibreOffice microservice URL |
| `GUPSHUP_TEMPLATE_TOKEN_ISSUED` | Prod | HSM template name for token notification |
| `GUPSHUP_TEMPLATE_READY_FOR_PICKUP` | Prod | HSM template name for pickup notification |
| `BOT_V2` | Dev | `1` = enable experimental in-memory bot |
| `FRONTEND_URL` | Prod | Dashboard URL for CORS |

---

## Key Invariants (Do Not Break)

1. **Webhook idempotency**: Razorpay webhook calls `handlePaymentSuccess` which checks `payment.status === 'paid'` before processing. Never remove this check.
2. **Agent key security**: `agentKey` is stored as bcrypt hash in `agentKeyHash`. The plaintext is only returned once (on creation/rotation). Old plaintext `agentKey` field is deprecated — only new agents use `agentKeyHash`.
3. **WhatsApp URL buttons**: Never send Razorpay links as WhatsApp URL buttons — WhatsApp blocks them. Always inline into message body. See `sendWhatsAppMessage()` in `notification.js`.
4. **Button limits**: ≤3 callback buttons = `quick_reply`, >3 = `list` (max 10). Never exceed.
5. **Agent idempotency**: `processed-jobs.js` persists processed job IDs across restarts. Never remove this — prevents duplicate prints on agent restart.
6. **DB schema**: Always run `npm run db:generate` after changing `schema.prisma`. In prod, use `db:push` (not `migrate dev`) for schema changes.
7. **Raw body for Razorpay**: HMAC verification uses `request.rawBody` (captured in `addContentTypeParser`). Do not change the JSON body parser in `index.js`.

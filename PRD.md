# PrintDrop — Product Requirements Document (PRD)
## WhatsApp-Based Print Ordering Platform

---

## 1. System Overview

### End-to-End Architecture

```
User (WhatsApp)
    │
    ▼
Gupshup Webhook ──▶ Fastify API ──▶ PostgreSQL (Supabase)
    │                    │                    │
    │                    ├── Cloudflare R2    │
    │                    │   (file storage)   │
    │                    │                    │
    │                    ├── Razorpay         │
    │                    │   (payments)       │
    │                    │                    │
    │                    ▼                    │
    │              Dashboard (Next.js) ◀─────┘
    │                    │
    │                    ▼
    │              Print Agent (Electron)
    │                    │
    │                    ▼
    │                 Printer
    │                    │
    ◀────────────────────┘
  (Confirmation via WhatsApp)
```

### Component Responsibilities

| Component | Tech | Responsibilities | Status |
|-----------|------|-----------------|--------|
| **API Server** | Node.js + Fastify | Auth, webhooks, job CRUD, file handling, pricing | Built |
| **WhatsApp Bot** | Gupshup API | Conversation state machine, file intake, payment flow | Built |
| **Telegram Bot** | Telegram Bot API | Mirror of WhatsApp flow (optional channel) | Built |
| **Database** | PostgreSQL (Supabase) | Users, shops, jobs, payments, conversations, printers | Built |
| **File Storage** | Cloudflare R2 | File upload/download, presigned URLs (7-day expiry) | Built |
| **Payments** | Razorpay | Payment links, webhook verification, status tracking | Built |
| **Dashboard** | Next.js 14 + TypeScript | Shopkeeper queue, analytics, settings, admin panel | Built |
| **Print Agent (CLI)** | Node.js | Polling, multi-printer routing, crash recovery | Built |
| **Print Agent (Desktop)** | Electron | Tray app, setup wizard, auto-start, sounds | Built |
| **Doc Converter** | LibreOffice + Docker | DOCX/PPTX to PDF conversion | Built |
| **OTP/SMS** | MSG91 | Phone-based authentication | Built |

### Data Flow (Order Lifecycle)

```
1. User sends file via WhatsApp
2. Gupshup webhook → API parses message
3. File downloaded + stored in R2
4. Bot walks user through: pages → color → copies → paper → sides → shop
5. Pricing calculated (per-page + platform fee)
6. Razorpay payment link sent via WhatsApp
7. User pays → Razorpay webhook → job status → "queued"
8. Token (pickup code) sent to user via WhatsApp
9. Print Agent polls API, picks up job
10. Agent downloads file, extracts pages, generates cover slip
11. Agent routes to correct printer (B&W/Color/Duplex/A3)
12. Job status → "printing" → "ready"
13. User picks up print, shows token
```

### Key Tech Decisions (Already Made)

- **Webhook-first**: WhatsApp + Razorpay + Telegram all webhook-driven — no server-side polling
- **Agent polling**: Print agents poll every 5s — avoids firewall/NAT complexity vs WebSocket
- **State machine conversations**: Persisted in DB, survives server restarts
- **Dual storage**: Local FS for dev, R2 for prod
- **Crash-safe agents**: Idempotency tracking + stuck-job recovery on startup
- **Single central WhatsApp number**: All shops share one Gupshup number (see Section 2)

---

## 2. Shop Onboarding Strategy

### Decision: Single Central WhatsApp Number (RECOMMENDED)

**Recommendation: One central WhatsApp number for all shops.**

| Factor | Central Number | Shop-Owned Numbers |
|--------|---------------|-------------------|
| Onboarding time | < 2 min (just install agent) | 2-5 days (Meta verification per shop) |
| Cost | 1 Gupshup account (~₹0.50/conversation) | N accounts, N verifications, N monthly fees |
| Ops complexity | Zero per-shop WhatsApp config | Every shop needs WABA setup, template approval |
| Scalability | Linear — add shop to DB, done | Bottlenecked by Meta approval queue |
| Brand perception | "PrintDrop" as the brand | Shop's own identity (nice but not MVP) |
| Multi-shop routing | Handled by shop selection in conversation flow | Not needed — each number is one shop |

**Why central wins for MVP → 1000 shops:**
- Meta WABA verification takes 2-5 business days per number. At 1000 shops, that's a full-time job.
- Gupshup charges per conversation, not per number — no cost difference.
- Shop selection is already built in the conversation flow.
- Future: offer shop-branded numbers as a premium feature.

### Onboarding Flow (Target: < 3 minutes)

```
Step 1: Shopkeeper visits printdrop.in/setup (or scans QR code)
        └── Enters phone number → receives OTP → logged in
        
Step 2: Basic shop details auto-form
        └── Shop name, address, operating hours
        └── Smart defaults: 9 AM - 9 PM, Mon-Sat
        
Step 3: Dashboard generates unique agentKey
        └── 24-char alphanumeric key (e.g., "PD-ABCD-1234-EFGH-5678")
        └── Displayed on screen + sent via WhatsApp to shopkeeper
        
Step 4: Download Print Agent (one-click)
        └── Auto-detects OS (Windows .exe / macOS .dmg / Linux .AppImage)
        └── Single download button — no choices
        
Step 5: Install + paste agentKey
        └── Electron setup wizard opens on first launch
        └── Paste agentKey → agent auto-registers with backend
        └── Auto-detects all connected printers
        └── Maps printers: B&W vs Color, Duplex, A3 (auto-detect capabilities)
        └── Agent starts polling — shop is LIVE
```

**What happens behind the scenes:**
- `agentKey` is generated via `crypto.randomBytes(16).toString('hex')` and stored on the `Shop` record
- Agent sends heartbeat with printer list → backend creates `ShopPrinter` records
- Shop status flips to `active` on first successful heartbeat
- First queued job triggers a WhatsApp notification to shopkeeper: "Your first order is here!"

### Self-Serve Design Principles
- **No manual approval**: Shop goes live the moment agent connects
- **No pricing setup required**: Default rates apply (₹1.50/page B&W, ₹7/page color) — shopkeeper can customize later
- **No bank details needed for MVP**: Platform collects all payments, settles manually (see Section 5)
- **No training**: Agent auto-starts, auto-detects, auto-prints

### MVP vs Future

| Feature | MVP | Future |
|---------|-----|--------|
| Onboarding | Web form + agent install | WhatsApp-based onboarding ("send HI to start") |
| Verification | None — anyone can create a shop | KYC via Aadhaar/PAN for payouts |
| Agent key | Manual paste | QR code scan from dashboard |
| Pricing | Platform defaults | Per-shop rate card builder |
| Territory | No restrictions | Geo-fencing, exclusive zones |

---

## 3. WhatsApp Setup Strategy

### API Provider: Gupshup (Current, Recommended to Continue)

**Why Gupshup over Meta Cloud API direct:**
- Gupshup handles template approvals, number verification, and compliance
- Better support for Indian businesses (local team, INR billing)
- Simpler API (form-encoded POST vs Meta's nested JSON)
- Fallback: migrate to Meta Cloud API later if Gupshup costs rise — the abstraction layer (`notification.js`) makes this a 1-day swap

**Current Setup:**
- Endpoint: `https://api.gupshup.io/wa/api/v1/msg`
- Auth: `apikey: <KEY>` header
- Body: `application/x-www-form-urlencoded`
- Buttons: quick_reply (max 3), list (4-10 items)

### Message Flow Architecture

```
                    Gupshup Cloud
                         │
User sends              │              API Server
file on WhatsApp ──────▶│──────▶ POST /api/webhooks/whatsapp
                        │              │
                        │              ├── Parse message (text/file/button)
                        │              ├── Create/resume conversation
                        │              ├── State machine processes input
                        │              ├── Generate response
                        │              │
                        │◀─────────────┘ POST to Gupshup send API
                        │
User receives ◀─────────┘
reply + options
```

### Cost Optimization Strategy

**Current pricing (Gupshup, India):**
- Business-initiated conversation: ~₹0.47/conversation (24-hour window)
- User-initiated conversation: ~₹0.35/conversation (24-hour window)
- Utility conversations (order updates): ~₹0.17/conversation

**Optimization tactics:**

1. **Session reuse**: A WhatsApp "conversation" window lasts 24 hours. All messages within 24h of the first message = 1 conversation charge. Our flow (file → options → payment → confirmation) typically completes in < 10 minutes, so it's always 1 conversation.

2. **Batch notifications**: If sending order-ready + pickup-reminder, combine into 1 message within the window.

3. **User-initiated preference**: Since users always message first (sending a file), we're always in user-initiated territory (cheaper). Only proactive notifications (marketing, reminders) trigger business-initiated charges.

4. **Template message optimization**: Use utility templates for order confirmations (₹0.17 vs ₹0.47 for marketing templates). Register templates as `UTILITY` category.

5. **Avoid re-engagement spam**: No "come back" messages. Only send messages when the user has an active order.

**Projected cost at scale:**
- Average order = 1 user-initiated conversation (₹0.35) + 1 utility notification (₹0.17) = ₹0.52/order
- At 1000 shops x 20 orders/day = 20,000 orders/day x ₹0.52 = ₹10,400/day (~$125/day)
- This is covered by the 10% platform fee on a ₹15 average order = ₹1.50/order x 20,000 = ₹30,000/day

### Multi-Shop Routing (Single Number)

The conversation flow already handles this:
1. User sends file
2. After selecting print options, system shows nearby shops (by location or default)
3. User picks a shop → job is assigned to that shop's queue
4. That shop's agent picks it up

**Future: Auto-routing**
- Detect user location via WhatsApp location sharing
- Auto-assign to nearest shop with agent online
- Fallback: show list if multiple shops equidistant

---

## 4. Print Agent Setup Guide

### One-Click Installer Design

**Current state**: Electron app with `electron-builder` producing platform-specific installers.

**Distribution strategy:**

| Platform | Format | Auto-update | Notes |
|----------|--------|-------------|-------|
| Windows | `.exe` (NSIS) | electron-updater | 90%+ of Indian print shops |
| macOS | `.dmg` | electron-updater | Rare but supported |
| Linux | `.AppImage` | Manual | Server/kiosk setups |

**Download flow:**
```
printdrop.in/download
    │
    ├── Auto-detect OS via User-Agent
    ├── Show single "Download PrintDrop Agent" button
    ├── Fallback: manual OS selector below
    │
    └── File hosted on: GitHub Releases (free, CDN-backed, versioned)
```

### Auto-Configuration Flow

```
First Launch → Setup Wizard
    │
    Step 1: "Paste your Agent Key"
    │       └── Validates against API → shows shop name
    │
    Step 2: "We found these printers"
    │       └── Lists all OS-detected printers
    │       └── Auto-tags: B&W, Color, Duplex, A3 (via driver capabilities)
    │       └── Shopkeeper confirms or adjusts
    │
    Step 3: "You're live!"
    │       └── Agent starts polling
    │       └── Test print option: prints a sample cover slip
    │
    └── Minimize to system tray → runs in background
```

**Auto-detection details (already built):**
- Windows: `wmic printer list brief` → parses name, status, port
- macOS/Linux: `lpstat -p -d` → CUPS printer enumeration
- Color detection: checks driver name for "Color" keyword; defaults to B&W if ambiguous
- Duplex: checks PPD options for `Duplex` capability
- A3: checks for media size options > A4

### UX for Non-Technical Shopkeepers

- **Language**: All UI text in simple English (Hindi localization = Future)
- **No settings to configure**: Defaults work out of the box
- **Sound alerts**: Beep on new job (already implemented with WAV files)
- **Visual cues**: Tray icon changes color when printing (idle=gray, active=green)
- **Error messages in plain language**: "Printer not responding — check if it's turned on and has paper"

### Troubleshooting Guide

| Problem | Detection | Auto-Fix | User Message |
|---------|-----------|----------|-------------|
| **Printer not found** | `lpstat` returns empty | Retry every 30s | "No printer detected. Make sure your printer is connected and turned on." |
| **Agent offline** | No heartbeat for 2 min | Auto-restart via OS service | Dashboard shows "Agent Offline" badge. WhatsApp alert to shopkeeper. |
| **Failed print job** | OS print command returns error | Retry 3x with 10s backoff | "Print failed. Trying again..." → "Still failing. Check printer for paper jam or ink." |
| **File corrupt** | PDF parse error | Skip, mark job as "failed" | WhatsApp to user: "Your file couldn't be printed. Please send it again." |
| **Agent key invalid** | API returns 401 | Show setup wizard again | "Agent key not recognized. Please check and re-enter." |
| **No internet** | API call timeout | Retry with exponential backoff | "No internet connection. Will retry automatically." |

---

## 5. Payment System Design

### Razorpay Integration (Already Built)

**Current flow:**
```
1. Price confirmed by user in WhatsApp
2. Backend calls Razorpay: create payment link
   └── Amount, customer phone, job notes, callback URL
3. Payment link sent to user via WhatsApp (inline in message text)
4. User clicks → Razorpay checkout (UPI/Card/Wallet)
5. Payment success → Razorpay webhook → POST /api/webhooks/razorpay
   └── Verify HMAC-SHA256 signature
   └── Mark payment as "paid"
   └── Update job status → "queued"
   └── Generate pickup token
   └── Send token to user via WhatsApp
6. Payment failure → notify user, allow retry
```

**Razorpay payment link advantages:**
- No app integration needed — works in any browser
- Supports UPI, cards, wallets, net banking
- Auto-generates UPI intent for one-tap payment on mobile
- Razorpay handles PCI compliance

### Edge Cases & Reliability

| Edge Case | Handling | Implementation |
|-----------|----------|---------------|
| **Payment success but webhook delayed** | Razorpay retries webhooks for 24h. Callback URL also triggers status check. | Double-safety: webhook + redirect callback in `webhooks.js` |
| **Payment success but job not created** | Webhook handler checks if job exists. If payment has `notes.jobId` but job is missing, create it from stored conversation context. | `payment.js:handlePaymentSuccess()` |
| **Duplicate webhook events** | Idempotency check: if payment already marked "paid", skip. Return 200 OK always. | Check `payment.status === 'paid'` before processing |
| **Payment link expired** | Razorpay links expire in 15 min (configurable). Bot detects expired link, generates new one. | Conversation timeout handling in `conversation.js` |
| **Partial payment / underpaid** | Razorpay doesn't allow partial on payment links. Not applicable. | N/A |
| **Refund needed** | MVP: Manual via Razorpay dashboard. Future: API-driven refunds. | Manual process |
| **UPI timeout** | User's UPI app times out. Razorpay shows retry. Bot sends "Payment pending — tap the link to try again." | Status check on conversation resume |

### Settlement Strategy

**MVP (Current):**
- Platform collects 100% of payment via Razorpay
- Manual settlement to shops: weekly bank transfer
- Track earnings per shop in dashboard analytics
- Simple spreadsheet reconciliation

**Phase 2 (10-100 shops):**
- Razorpay Route (split payments):
  - Customer pays ₹15 → ₹13.50 to shop's linked account, ₹1.50 to platform
  - Requires shop to add bank details during onboarding
  - Auto-settlement: T+2 business days
  - Razorpay charges: 2% on Route transfers

**Phase 3 (100+ shops):**
- Razorpay Route with marketplace model
- Instant settlements for premium shops (additional fee)
- Dashboard shows: earned, pending, settled, deducted (platform fee + payment gateway fee)

### Direct UPI vs Gateway

| Factor | Direct UPI (own QR) | Razorpay Payment Links |
|--------|---------------------|----------------------|
| Cost | 0% (UPI is free for merchants) | 2% per transaction |
| Verification | Manual — can't auto-verify payment | Automatic via webhook |
| UX | User scans QR, sends screenshot — terrible | One-tap payment, auto-confirmation |
| Reconciliation | Impossible to automate | Full API access |
| Refunds | Manual bank transfer | API or dashboard |
| **Verdict** | **Avoid** — kills automation | **Use this** — worth the 2% |

**Recommendation: Razorpay payment links for all transactions.** The 2% cost is covered by the 10% platform fee. Automation > savings.

---

## 6. Pricing Strategy

### Base Pricing Model

```
Customer Price = (Page Rate x Pages x Copies) + Binding Charge + Platform Fee + Payment Fee

Where:
  Page Rate     = Shop's rate (default: ₹1.50/page B&W, ₹7/page Color)
  Platform Fee  = 10% of subtotal
  Payment Fee   = Absorbed into platform fee (not shown to customer)
  Binding Charge = ₹20-50 depending on type (spiral, tape, staple)
```

### Pricing Breakdown Example

```
User sends: 10-page PDF, B&W, 2 copies, single-sided, A4

Subtotal:     ₹1.50 x 10 pages x 2 copies = ₹30.00
Platform Fee: ₹30.00 x 10%                 = ₹ 3.00
Total:                                      = ₹33.00

Razorpay takes 2% of ₹33.00                = ₹ 0.66
Platform net revenue:    ₹3.00 - ₹0.66     = ₹ 2.34
Shop receives:           ₹30.00            = ₹30.00
```

### Pricing Rules

| Rule | Logic | Rationale |
|------|-------|-----------|
| **Minimum order value** | ₹10 (enforced) | Below ₹10, payment gateway fees eat the margin |
| **Rounding** | Round up to nearest ₹1 | Clean numbers for UPI; avoids paise confusion |
| **Small order surcharge** | If subtotal < ₹10, charge flat ₹10 | Covers fixed costs (paper loading, agent time) |
| **Color detection** | Auto-detect color pages in PDF (future) | Charge B&W rate for B&W pages, color rate for color pages |
| **Bulk discount** | 10%+ off for 50+ pages (shop-configurable) | Incentivize large orders |
| **Duplex pricing** | Same per-page rate, but half the sheets | Customer pays per page, not per sheet |

### Shop Rate Customization (Already Built)

Shops can set custom rates via dashboard settings:
- B&W single-sided: default ₹1.50
- B&W double-sided: default ₹1.00/page
- Color single-sided: default ₹7.00
- Color double-sided: default ₹5.00/page
- A3 multiplier: 2x base rate
- Binding charges: per-type pricing

### Revenue Model

```
Platform Revenue = Platform Fee (10%) - Payment Gateway Fee (2% of total)
                 = ~8% net margin on GMV

At scale (1000 shops x 20 orders/day x ₹25 avg order):
  Daily GMV:     ₹5,00,000
  Daily Revenue: ₹40,000 (~$480)
  Monthly Revenue: ₹12,00,000 (~$14,400)
  
  Minus: Gupshup WhatsApp costs = ~₹3,00,000/month
  Minus: Infrastructure         = ~₹50,000/month
  Net:                          = ~₹8,50,000/month (~$10,200)
```

---

## 7. User Flow (WhatsApp UX)

### Step-by-Step Flow (Already Implemented)

```
USER                              BOT
─────                             ─────

📎 Sends PDF/Image/DOCX           
                                  "Got your file! 📄 report.pdf (10 pages)
                                   Which pages do you want to print?
                                   [All Pages] [Custom Range]"

Taps "All Pages"                  
                                  "Print in color or black & white?
                                   [B&W - ₹1.50/pg] [Color - ₹7/pg]"

Taps "B&W"                       
                                  "How many copies?
                                   [1] [2] [3] [5] [Other]"

Taps "2"                         
                                  "Paper size?
                                   [A4] [A3] [Legal]"

Taps "A4"                        
                                  "Single or double sided?
                                   [Single Side] [Double Side]"

Taps "Single Side"               
                                  "Select a shop:
                                   1. QuickPrint - MG Road (0.5 km)
                                   2. CopyCenter - Brigade (1.2 km)
                                   [1] [2]"

Taps "1"                         
                                  "Order Summary:
                                   📄 report.pdf
                                   📝 10 pages x 2 copies = 20 pages
                                   🖨 B&W, Single Side, A4
                                   🏪 QuickPrint - MG Road
                                   
                                   💰 Total: ₹33
                                   
                                   [Pay ₹33] [Cancel]"

Taps "Pay ₹33"                   
                                  "Pay here: https://rzp.io/l/abc123
                                   
                                   Tap the link to pay via UPI, card, 
                                   or wallet."

(Pays via Razorpay)              
                                  "✅ Payment received!
                                   
                                   Your token: #A7X2
                                   🏪 QuickPrint - MG Road
                                   
                                   Show this token when you pick up.
                                   We'll notify you when it's ready!"

(Agent prints the job)           
                                  "🖨 Your print is ready!
                                   Pick up at QuickPrint - MG Road
                                   Token: #A7X2"
```

### UX Optimization Principles

1. **Smart defaults**: A4, single-sided, 1 copy — skip steps when possible
2. **Auto-detection**:
   - Page count: extracted from PDF metadata / image count
   - File type: MIME detection, auto-convert DOCX/PPTX
   - Color pages: (Future) scan PDF for color content
3. **Minimum taps**: 6 taps from file send to payment (best case)
4. **No typing required**: All options via quick-reply buttons
5. **Price visibility**: Show per-page rate alongside each option
6. **Instant feedback**: "Got your file!" response < 2 seconds
7. **Session resilience**: 30-min timeout; user can resume where they left off

### Conversion Optimization

| Friction Point | Current Handling | Improvement (Future) |
|---------------|-----------------|---------------------|
| Too many steps | 6-7 taps | Smart defaults → skip to confirmation in 2 taps |
| Payment drop-off | Link in chat | UPI intent deep-link (auto-opens UPI app) |
| Shop selection confusion | List of shops | Auto-select nearest based on location |
| Large file upload slow | Wait for upload | "Processing..." indicator message |
| User sends wrong file | Must restart | "Send another file or type CANCEL" |

---

## 8. Dashboard (Shopkeeper View)

### Real-Time Queue (Kitchen Screen Model)

**URL:** `printdrop.in/dashboard`

```
┌─────────────────────────────────────────────────────────────────┐
│  PrintDrop Dashboard          QuickPrint - MG Road    🟢 Online │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  QUEUE (3)              PRINTING (1)           READY (5)        │
│  ┌──────────────┐      ┌──────────────┐      ┌──────────────┐  │
│  │ #A7X2        │      │ #B3K9        │      │ #C1M4        │  │
│  │ report.pdf   │      │ thesis.pdf   │      │ notes.pdf    │  │
│  │ 10pg B&W x2  │      │ 45pg Color   │      │ 5pg B&W      │  │
│  │ ₹33          │      │ ₹315         │      │ ₹10          │  │
│  │ 2 min ago    │      │ Printing...  │      │ Done ✓       │  │
│  └──────────────┘      └──────────────┘      └──────────────┘  │
│  ┌──────────────┐                            ┌──────────────┐  │
│  │ #D5P1        │                            │ #E8R3        │  │
│  │ poster.jpg   │                            │ invoice.pdf  │  │
│  │ 1pg Color    │                            │ 3pg B&W      │  │
│  │ ₹10          │                            │ ₹10          │  │
│  │ 5 min ago    │                            │ Done ✓       │  │
│  └──────────────┘                            └──────────────┘  │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│  Today: 12 orders │ ₹892 earned │ Agent: 🟢 Online │ 🖨 2     │
└─────────────────────────────────────────────────────────────────┘
```

### Job States

```
pending ──▶ payment_pending ──▶ queued ──▶ printing ──▶ ready ──▶ picked_up
                │                                        │
                └──▶ cancelled                           └──▶ failed
```

| State | Trigger | Dashboard Display | Agent Action |
|-------|---------|-------------------|-------------|
| `pending` | File received, options being selected | Not shown | — |
| `payment_pending` | Price confirmed, link sent | Not shown | — |
| `queued` | Payment received | Yellow card in QUEUE column | Picks up job |
| `printing` | Agent starts printing | Blue card in PRINTING column | Sending to printer |
| `ready` | Agent confirms print complete | Green card in READY column | — |
| `picked_up` | Shopkeeper marks picked up | Moves to history | — |
| `failed` | Print error after retries | Red card with retry button | Reports error |
| `cancelled` | User or admin cancels | Moves to history (strikethrough) | — |

### Earnings View

```
┌─────────────────────────────────────────┐
│  Earnings                               │
├─────────────────────────────────────────┤
│  Today          ₹892    (12 orders)     │
│  This Week      ₹4,230  (58 orders)    │
│  This Month     ₹18,450 (241 orders)   │
├─────────────────────────────────────────┤
│  Pending Settlement    ₹4,230           │
│  Last Settled          ₹14,220 (Apr 3)  │
│  Next Settlement       ~Apr 10          │
└─────────────────────────────────────────┘
```

### MVP vs Future Dashboard

| Feature | MVP (Built) | Future |
|---------|-------------|--------|
| Job queue | Polling-based list | WebSocket real-time updates |
| Earnings | Basic totals | Charts, trends, daily breakdown |
| Printer status | Heartbeat indicator | Per-printer queue depth, ink levels |
| Customer info | Phone number only | Order history, repeat customer flag |
| Analytics | Order count + revenue | Conversion rates, peak hours, popular file types |

---

## 9. Reliability & Edge Cases

### Critical Failure Scenarios

#### Scenario 1: Payment Success but Job Not Created
```
Root cause: Webhook arrives but job creation fails (DB error, timeout)

Prevention:
  1. Razorpay webhook includes jobId in payment notes
  2. Webhook handler wraps job update in DB transaction
  3. If transaction fails → log error + retry queue (BullMQ)
  4. Razorpay retries webhook every 15 min for 24 hours

Recovery:
  - Cron job every 5 min: find payments with status=paid but job.status≠queued
  - Auto-fix: update job status to queued, send token to user
  - Alert to admin if auto-fix fails
```

#### Scenario 2: Duplicate Webhook Events
```
Prevention:
  - Check payment.status before processing
  - If already "paid" → return 200 OK, skip processing
  - Razorpay payment_id is unique — use as idempotency key
  
Implementation: Already handled in payment.js:handlePaymentSuccess()
```

#### Scenario 3: Agent Offline
```
Detection:
  - No heartbeat for 2+ minutes → shop marked "offline" in DB
  - Dashboard shows red indicator
  
Impact:
  - Jobs remain in "queued" state — no data loss
  - Users can still place orders (jobs queue up)
  
Mitigation:
  - WhatsApp alert to shopkeeper: "Your PrintDrop agent is offline. 
    Jobs are waiting. Please check your computer."
  - Auto-recovery: agent reconnects on restart, picks up queued jobs
  - Dashboard shows offline duration + pending job count
  
Future:
  - Auto-reassign to nearby shop if offline > 30 minutes
```

#### Scenario 4: Printer Failure Mid-Job
```
Detection:
  - OS print command returns non-zero exit code
  - Or: printer status check shows error state
  
Handling (already built):
  1. Retry 3x with 10-second backoff
  2. If still failing → mark job as "failed"
  3. Try alternate printer if available
  4. Notify shopkeeper via dashboard + sound alert
  5. Notify user via WhatsApp: "There's an issue printing your file. 
     The shop is working on it."
     
Recovery:
  - Shopkeeper can retry from dashboard
  - Or reassign to different printer
```

#### Scenario 5: Corrupt/Unprintable Files
```
Detection:
  - PDF parse error (pdf-lib throws)
  - Zero pages detected
  - File size = 0 bytes
  
Handling:
  1. During upload: validate file before entering pricing flow
  2. If invalid: "Sorry, we couldn't read your file. 
     Please try converting it to PDF and sending again."
  3. If corrupt detected at print time: mark job failed, 
     notify user to resend
     
Supported formats: PDF, JPG, PNG, DOCX, PPTX
Unsupported: XLS, ZIP, EXE, etc. → "We can only print PDF, images, 
  and Word/PowerPoint files."
```

### Retry & Fallback Strategy

| Component | Retry Logic | Fallback |
|-----------|------------|----------|
| Gupshup API (send message) | 3x exponential backoff | Log + admin alert |
| Razorpay (create payment link) | 3x with 2s delay | Show manual UPI option (future) |
| File download (agent) | 3x with presigned URL refresh on 403 | Mark job failed, alert user |
| Print command | 3x with 10s delay | Try alternate printer → mark failed |
| DB operations | Prisma auto-retry on connection errors | 500 error → user retry |

---

## 10. Scaling Strategy

### Growth Phases

#### Phase 1: 1-10 Shops (Current → Month 3)

```
Architecture: Single server, single DB
Bottleneck: None (well within capacity)
Focus: Product-market fit, onboarding flow polish

Infra:
  - 1x Railway/Render instance (API)
  - 1x Supabase (Postgres)
  - 1x R2 bucket
  - 1x Gupshup account
  
Cost: ~₹5,000/month ($60)
```

#### Phase 2: 10-100 Shops (Month 3-6)

```
Architecture: Single server, connection pooling
Bottleneck: DB connections, file storage
Focus: Self-serve onboarding, automated settlements

Changes:
  - Enable Supabase connection pooling (PgBouncer)
  - Add Redis for session caching + rate limiting
  - Implement Razorpay Route for auto-settlements
  - Add basic monitoring (Sentry errors, uptime checks)
  
Cost: ~₹25,000/month ($300)
```

#### Phase 3: 100-1000 Shops (Month 6-12)

```
Architecture: Horizontally scaled API, read replicas
Bottleneck: API throughput, WhatsApp rate limits
Focus: Reliability, operational tooling, cost optimization

Changes:
  - Multiple API instances behind load balancer
  - DB read replicas for dashboard queries
  - BullMQ job queue for async processing (file conversion, notifications)
  - CDN for static assets (agent downloads, dashboard)
  - Gupshup enterprise plan (higher throughput, lower per-message cost)
  - Automated monitoring + alerting (PagerDuty/OpsGenie)
  
Cost: ~₹1,50,000/month ($1,800)
```

#### Phase 4: 1000+ Shops (Year 2)

```
Architecture: Microservices, multi-region
Bottleneck: Everything needs to be distributed
Focus: Platform reliability, enterprise features

Changes:
  - Split into services: Auth, Orders, Payments, Notifications, Files
  - Multi-region deployment (Mumbai + Delhi/Bangalore)
  - Dedicated Gupshup enterprise setup
  - Real-time dashboard via WebSocket
  - Mobile app for shopkeepers
  - API for third-party integrations
  
Cost: ~₹5,00,000/month ($6,000)
```

### Self-Onboarding Automation

```
Current (manual):
  Shopkeeper → contacts us → we set up → they install agent

Target (fully automated):
  Shopkeeper → visits site → fills 3 fields → downloads agent → live in 3 min
  
Remaining work:
  1. Public signup page (no invite required)
  2. Auto-generate agentKey on signup
  3. WhatsApp notification with agent download link
  4. Auto-verify shop on first successful print
```

### Viral/Referral Loops

1. **Customer → Shop**: "Printed at QuickPrint via PrintDrop" on cover slip footer. QR code links to shop onboarding.

2. **Shop → Shop**: Referral code in dashboard. Referring shop gets ₹500 credit after referred shop completes 50 orders.

3. **Customer → Customer**: Share receipt message includes "Send your files to +91-XXXXX to print anywhere" footer.

4. **Cover slip as ad**: Every printed page has a tiny footer: "Powered by PrintDrop — printdrop.in" (opt-out for premium shops).

---

## 11. Support & Operations

### Shop Support System

**Tier 1 — Self-Serve (Target: 80% of issues)**
- Dashboard FAQ/help section
- Agent auto-troubleshooting (shows specific error + fix steps)
- WhatsApp bot for shopkeepers: "Type HELP for support"

**Tier 2 — WhatsApp Support (Target: 15% of issues)**
- Shopkeeper messages support number
- Internal tool shows: shop status, agent status, recent jobs, error logs
- Response time: < 30 minutes during business hours

**Tier 3 — Remote Assistance (Target: 5% of issues)**
- TeamViewer/AnyDesk for agent setup issues
- Direct phone call
- Priority for high-volume shops

### Internal Tools

**Job Tracer**
```
Input: Job ID or Token
Output:
  - Full lifecycle timeline (created → paid → queued → printed → ready)
  - Each step: timestamp, duration, errors
  - File details, payment details, agent details
  - WhatsApp message log for this conversation
```

**Shop Health Dashboard**
```
Per shop:
  - Agent status (online/offline, last heartbeat)
  - Printer status (each printer's last successful print)
  - Order volume (today, trend)
  - Error rate (failed jobs / total)
  - Average print time
  - Settlement status
```

**Debug Console**
```
  - Live webhook log (Gupshup + Razorpay)
  - Conversation state inspector (current state, context JSON)
  - Force-retry failed jobs
  - Manual payment reconciliation
  - User/shop impersonation for testing
```

### Escalation Workflow

```
Agent offline > 30 min
  └── Auto WhatsApp to shopkeeper (1x)
  └── If still offline > 2 hours → Slack alert to ops team
  └── If offline > 24 hours → mark shop as "paused", stop routing orders

Failed jobs > 3 in 1 hour (same shop)
  └── Auto WhatsApp to shopkeeper
  └── Slack alert to ops team
  └── Auto-pause shop if > 10 consecutive failures

Payment reconciliation mismatch
  └── Daily cron: paid payments without queued jobs
  └── Auto-fix where possible
  └── Slack alert for manual review
```

---

## 12. Simplification Strategy

### Design Philosophy: Zero-Decision Onboarding

**Principle: Every decision a shopkeeper must make is a drop-off point. Eliminate decisions.**

### Current Decisions Required vs Target

| Decision | Current | Target |
|----------|---------|--------|
| Choose pricing | Set rates manually | Pre-filled defaults (adjust later) |
| Configure printers | Select and tag printers | Auto-detect + auto-tag |
| Set operating hours | Enter hours | Default: 9 AM - 9 PM Mon-Sat |
| Enter bank details | Required for settlement | Not needed for MVP (manual settlement) |
| Choose paper sizes | Manual selection | Auto-detect from printer capabilities |
| Agent key entry | Copy-paste from dashboard | QR scan (future) |
| OS selection for download | Manual | Auto-detect from browser |

### Plug-and-Play Checklist

```
Already plug-and-play:
  - Agent auto-detects printers on startup
  - Agent auto-starts on boot (auto-launch)
  - Agent auto-recovers from crashes (idempotency tracking)
  - Pricing uses sensible defaults
  - Conversation flow requires zero setup from shopkeeper
  - Payment webhook auto-processes orders

Still needs work:
  - Onboarding flow not public-facing yet (admin creates shops)
  - Agent key still requires manual copy-paste
  - No auto-detection of printer color capability (uses name heuristic)
  - No location-based auto shop assignment for users
  - Dashboard requires login each time (no remember-me / auto-login)
```

### Auto-Detection Features

| Feature | Method | Status |
|---------|--------|--------|
| Page count | pdf-lib metadata / image count | Built |
| File type | MIME detection | Built |
| Printer list | OS commands (lpstat/wmic) | Built |
| Printer color support | Driver name parsing | Built (heuristic) |
| Printer duplex support | PPD options | Built |
| User's nearest shop | WhatsApp location sharing | Future |
| Color vs B&W pages | PDF content analysis | Future |
| Document orientation | PDF page dimensions | Future |

### The "Mom Test"

> Can a non-technical shopkeeper in a Tier 2 city install this and start receiving orders without calling anyone?

**Current answer: Almost.** The agent install + setup wizard gets them 90% there. Remaining friction:
1. They need to discover PrintDrop (marketing problem, not product)
2. They need to sign up on the website (needs public signup page)
3. They need to copy-paste the agent key (needs QR scan alternative)

**Target: Yes, fully.** After building public signup + QR-based agent linking.

---

## Appendix: Implementation Priority

### MVP (What's Built)
- [x] WhatsApp bot with full conversation flow
- [x] Razorpay payment integration
- [x] Print Agent (CLI + Electron desktop)
- [x] Dashboard with job queue
- [x] Multi-printer routing
- [x] File conversion (DOCX/PPTX → PDF)
- [x] Crash recovery + idempotency

### Next Sprint (High Impact, Low Effort)
- [ ] Public shop signup page (self-serve onboarding)
- [ ] Auto-settlement tracking in dashboard
- [ ] Agent offline WhatsApp alerts to shopkeeper
- [ ] Job tracer internal tool
- [ ] Dashboard "remember me" (persistent login)

### Near-Term (Month 2-3)
- [ ] Location-based shop auto-assignment
- [ ] Razorpay Route for auto-settlements
- [ ] WebSocket for real-time dashboard updates
- [ ] QR-based agent key linking
- [ ] Hindi language support in bot

### Medium-Term (Month 4-6)
- [ ] Color page auto-detection in PDFs
- [ ] Shop referral program
- [ ] Customer order history
- [ ] Mobile app for shopkeepers
- [ ] Bulk/enterprise pricing

### Long-Term (Month 7-12)
- [ ] Multi-city expansion automation
- [ ] Shop analytics + insights
- [ ] Auto-reassign orders on agent offline
- [ ] White-label for franchises
- [ ] API for third-party integrations

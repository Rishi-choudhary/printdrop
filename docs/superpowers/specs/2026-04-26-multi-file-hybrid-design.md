# Multi-File Orders + Hybrid WhatsApp/Web Design

**Date:** 2026-04-26
**Status:** Approved

---

## Summary

PrintDrop supports two ordering channels:

- **WhatsApp** — single file only, fast, reliable, zero friction
- **Web (`/print`)** — multi-file cart with per-file settings, one payment, one token

Both channels feed the same job queue. The desktop agent and shopkeeper KDS are unchanged. Pricing is unchanged.

---

## 1. WhatsApp Changes

**Scope:** One line added to the file-received message. Nothing else changes.

**File:** `backend/src/bot/messages.js`

Find the message shown after a user uploads a file (`fileReceived` or equivalent). Append one line at the bottom:

```
📎 Got your file! report.pdf (10 pages)

Which pages do you want to print?
[All Pages] [Custom Range]

💡 Need to print multiple files? Visit printdrop.app
```

The URL `printdrop.app` is inlined as plain text (not a button — WhatsApp URL buttons are blocked by the platform).

No state machine changes. No new bot states. No changes to `services/conversation.js`.

---

## 2. Web Flow — `/print` Page

### Step Structure (changed)

| Step | Key | Label | Change |
|------|-----|-------|--------|
| 1 | `upload` | Upload | Now accepts multiple files |
| 2 | `configure` | Configure | New — replaces single Preferences step |
| 3 | `shop` | Shop | Unchanged |
| 4 | `contact` | Contact | Unchanged (guest only) |
| 5 | `review` | Review | Shows per-file lines + combined total |

### Step 1 — Upload

- Drag-and-drop zone OR click-to-browse, both accept multiple files simultaneously
- Each uploaded file appears as a card: `[icon] filename.pdf — 10 pages — 240 KB [✕]`
- Files upload to `POST /api/files/upload` individually, in parallel, as they are added
- Upload progress indicator per file card
- "Add more files" button stays visible; disappears after 10 files (hard cap)
- Continue button disabled until: at least 1 file uploaded AND all in-progress uploads complete
- ✕ button removes a file card and its uploaded data before proceeding

### Step 2 — Configure (new)

Replaces the single Preferences step. One accordion per uploaded file.

**Accordion collapsed state:**
```
▶  report.pdf                    B&W · 1 copy · A4 · Single · All pages
```

**Accordion expanded state:**
Shows full settings panel identical to the current Preferences step:
- Color / B&W toggle
- Copies stepper (1–99)
- Sides toggle (Single / Double)
- Paper size (A4 / A3 / Letter / Legal)
- Page range (All pages / custom input e.g. `1-3, 5`)
- Binding (None / Staple / Spiral)

**Behaviour:**
- First file auto-expands when arriving at this step
- Only one accordion open at a time (opening one closes others)
- "Copy settings to all files" button at the top — takes the currently open file's settings and applies to every file in the list. Useful when all files need the same options.
- Continue enabled once all files have valid settings (`copies >= 1` for each)

### Step 3 — Shop

Unchanged. Single shop selection applies to all files in the order.

### Step 4 — Contact (guest only)

Unchanged. Name + WhatsApp phone number.

### Step 5 — Review

**File summary cards** (one per file):
```
report.pdf
10 pages · B&W · 2 copies · A4 · Single
₹1.50 × 10 × 2 = ₹30.00
```

**Combined pricing table:**
```
report.pdf (10pg × 2)          ₹30.00
thesis.pdf (45pg × 1)          ₹67.50
notes.pdf  (5pg × 1)           ₹7.50
─────────────────────────────────────
Subtotal                       ₹105.00
Platform fee (₹0.50/pg)        ₹30.00
─────────────────────────────────────
Total                          ₹135.00
```

**Pay button:** `Pay ₹135.00 →`

On submit:
- Authenticated: `POST /api/orders` → `POST /api/orders/:id/pay` → redirect to Razorpay
- Guest: `POST /api/orders/public` → redirect to Razorpay

---

## 3. Backend

### New Endpoints

#### `POST /api/orders` (authenticated)

```js
// Request body
{
  shopId: string,
  files: [
    {
      fileUrl: string,
      fileKey: string,
      fileName: string,
      fileSize: number,
      fileType: string,
      pageCount: number,
      color: boolean,
      copies: number,
      doubleSided: boolean,
      paperSize: string,      // "A4" | "A3" | "Letter" | "Legal"
      pageRange: string,      // "all" | "1-3, 5"
      binding: string,        // "none" | "staple" | "spiral"
    }
  ]
}

// Response
{
  order: {
    id: string,
    token: number,
    totalPrice: number,
    fileCount: number,
    jobs: [{ id, fileName, totalPrice, status }]
  }
}
```

**Implementation:**
- Validate: `shopId` exists and is active, `files` array has 1–10 items, each file has required fields
- Run in `prisma.$transaction`:
  1. Generate `order.token` (same logic as `job.token` — random 3-digit int unique to shop)
  2. Create `Order` record: `{ userId, shopId, token, fileCount: files.length, source: 'web', status: 'pending' }`
  3. For each file: run `pricing.calculatePrice(file, shop)` → create `Job` record with `orderId` set
  4. Update `Order`: `{ totalPrice: sum, totalPages: sum, platformFee: sum, shopEarning: sum }`
- Return order with jobs

#### `POST /api/orders/public` (unauthenticated)

Same as above but also accepts `customerName` and `customerPhone`. Creates or finds a `User` by phone (same pattern as `POST /api/jobs/public`), then creates the order.

#### `POST /api/orders/:id/pay` (authenticated)

```js
// Response
{ paymentLink: string, razorpayOrderId: string }
```

Creates a single Razorpay payment link for `order.totalPrice`. Stores result in `Payment` record linked to `orderId`. Uses existing `services/payment.js` — add an `createOrderPaymentLink(orderId)` function mirroring the existing `createJobPaymentLink`.

### Modified Endpoints

#### `PATCH /api/agent/jobs/:id/status` — Order ready aggregation

After marking a job `ready`, check if all sibling jobs are also ready:

```js
if (status === 'ready' && job.orderId) {
  const siblings = await prisma.job.findMany({
    where: { orderId: job.orderId }
  });
  const allReady = siblings.every(j => j.status === 'ready');
  if (allReady) {
    await prisma.order.update({
      where: { id: job.orderId },
      data: { status: 'ready' }
    });
    const order = await prisma.order.findUnique({
      where: { id: job.orderId },
      include: { jobs: { take: 1, include: { shop: true } } }
    });
    notifyReadyForPickup(order.userId, order.token, order.jobs[0].shop.name);
  }
}
```

### Unchanged

- `services/payment.js` webhook handler — already handles `payment.orderId` path (lines 116–127 of `webhooks.js`)
- `services/pricing.js` — pricing logic unchanged, called per-job as today
- Desktop agent — polls individual jobs, processes them one by one. Multi-file order jobs appear as separate cards in the queue, all with the same Order token.
- Dashboard KDS — no changes. Jobs from multi-file orders show as separate cards with the same token number.

---

## 4. Data Model

No schema changes required. The existing `Order` and `Job` models already support this:

- `Order.fileCount` — number of files
- `Order.totalPages` — sum of all job page counts
- `Order.totalPrice` / `platformFee` / `shopEarning` — aggregated from jobs
- `Job.orderId` — foreign key linking job to order
- `Order.token` — the single pickup token shown to customer and shopkeeper
- `Payment.orderId` — payment linked to order (not individual jobs)

---

## 5. Pricing

**Unchanged.** Shopkeeper configures rates in dashboard settings:
- B&W single: default ₹2.00/page
- B&W double: configurable
- Color single: configurable
- Color double: configurable

Platform fee: ₹0.50/page added on top of shopkeeper rate per job. Calculated per-job using existing `services/pricing.js`. Order total = sum of all job totals.

---

## 6. Key Constraints

- **Max 10 files per order** — enforced in frontend (UI) and backend (validation)
- **50MB per file** — existing limit, unchanged
- **Single shop per order** — all files go to the same shop
- **WhatsApp = single file only** — bot flow unchanged; web app link added to greeting
- **One token per order** — customer shows one token, picks up all files at once
- **Order is ready only when ALL jobs are ready** — agent marks jobs individually; backend aggregates

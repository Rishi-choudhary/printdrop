# Multi-File Orders + Hybrid WhatsApp/Web Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add multi-file cart ordering on the web (per-file settings, one payment, one token) and update the WhatsApp greeting to point users to the web app for multi-file jobs.

**Architecture:** `services/order.js` already exists but uses shared prefs for all files — we extend it for per-file prefs. A new `routes/orders.js` exposes the HTTP layer. The `/print` dashboard page is rewritten as a multi-file cart. The agent route gets order-ready aggregation. WhatsApp gets one line added to the file-received message.

**Tech Stack:** Node.js + Fastify + Prisma (backend), Next.js 14 App Router + Tailwind + TypeScript (dashboard).

---

## File Map

| Action | Path | What changes |
|--------|------|--------------|
| Modify | `backend/src/bot/messages.js` | Add printdrop.app link to `fileReceivedMessage` |
| Modify | `backend/src/services/order.js` | Per-file prefs in `computeBatchPricing` + `createOrder` |
| Create | `backend/src/routes/orders.js` | `POST /orders`, `POST /orders/public`, `POST /orders/:id/pay` |
| Modify | `backend/src/index.js` | Register orders route |
| Modify | `backend/src/routes/agent.js` | Call `recomputeOrderStatus` + notify on ready |
| Create | `dashboard/src/components/multi-file-cart.tsx` | CartFile types, accordion settings, copy-to-all |
| Modify | `dashboard/src/app/print/page.tsx` | Multi-file cart flow (upload + configure + review) |
| Modify | `dashboard/src/lib/web-orders.ts` | Add `upsertCachedOrder` for order-level caching |

---

### Task 1: WhatsApp Greeting Update

**Files:**
- Modify: `backend/src/bot/messages.js:20-31`

- [ ] **Step 1: Update `fileReceivedMessage` to include web app link**

Open `backend/src/bot/messages.js`. Replace the `fileReceivedMessage` function (currently lines 20–31) with:

```javascript
function fileReceivedMessage(pageCount, fileName) {
  return {
    text:
      `Got *${escapeText(fileName)}*\n` +
      `${pageCount} page${pageCount !== 1 ? 's' : ''} detected.\n\n` +
      `Which pages do you want to print?\n\n` +
      `💡 Need to print *multiple files*? Visit printdrop.app`,
    buttons: [
      { text: 'All Pages', callback_data: 'pages_all' },
      { text: 'Custom Range', callback_data: 'pages_custom' },
    ],
  };
}
```

- [ ] **Step 2: Verify no tests break**

```bash
cd backend && npm test
```

Expected: all existing tests pass (the message content change does not affect state machine tests).

- [ ] **Step 3: Commit**

```bash
git -C printdrop add backend/src/bot/messages.js
git -C printdrop commit -m "feat(whatsapp): add printdrop.app link to file-received message"
```

---

### Task 2: Extend `services/order.js` for Per-File Prefs

Currently `createOrder` takes a single shared `prefs` object applied to every file. We need each file in the `files` array to carry its own prefs (`color`, `copies`, `doubleSided`, `paperSize`, `pageRange`, `binding`).

**Files:**
- Modify: `backend/src/services/order.js`

- [ ] **Step 1: Replace `computeBatchPricing` to use per-file prefs**

In `backend/src/services/order.js`, replace the `computeBatchPricing` function (lines 27–62) with:

```javascript
/**
 * Compute per-file pricing using each file's own prefs.
 * files: [{ pageCount, color, copies, doubleSided, paperSize, pageRange, binding, ...rest }]
 */
function computeBatchPricing({ shop, files }) {
  const childPricings = files.map((file) =>
    calculatePrice({
      shop,
      pageCount: file.pageCount,
      pageRange: file.pageRange || 'all',
      color: !!file.color,
      doubleSided: !!file.doubleSided,
      copies: file.copies || 1,
      binding: file.binding || 'none',
    })
  );

  const totals = childPricings.reduce(
    (acc, p) => {
      acc.subtotal    += p.subtotal;
      acc.platformFee += p.platformFee;
      acc.shopEarning += p.shopEarning;
      acc.total       += p.total;
      acc.totalPages  += p.effectivePages;
      return acc;
    },
    { subtotal: 0, platformFee: 0, shopEarning: 0, total: 0, totalPages: 0 },
  );

  return {
    childPricings,
    totals: {
      subtotal:    round2(totals.subtotal),
      platformFee: round2(totals.platformFee),
      shopEarning: round2(totals.shopEarning),
      total:       round2(totals.total),
      totalPages:  totals.totalPages,
    },
  };
}
```

- [ ] **Step 2: Update `createOrder` signature — remove shared `prefs`, use per-file prefs**

Replace the `createOrder` function signature and body. The full updated function (replace lines 70–179):

```javascript
/**
 * Create one Order with N child Jobs. Each file carries its own print prefs.
 *
 * files: [{
 *   fileUrl, fileKey, fileName, fileSize, fileType, pageCount,
 *   color, copies, doubleSided, paperSize, pageRange, binding
 * }]
 */
async function createOrder({ userId, shopId, files, source, specialInstructions }) {
  if (!Array.isArray(files) || files.length === 0 || files.length > 10) {
    throw new Error('files must be an array of 1–10 items');
  }

  const shop = await prisma.shop.findUnique({ where: { id: shopId } });
  if (!shop) throw new Error('Shop not found');

  const safeFiles = files.map((f) => ({
    fileUrl:     f.fileUrl,
    fileKey:     f.fileKey     || null,
    fileName:    f.fileName,
    fileSize:    f.fileSize    || 0,
    fileType:    (f.fileType   || 'pdf').toLowerCase(),
    pageCount:   f.pageCount,
    color:       !!f.color,
    copies:      f.copies      || 1,
    doubleSided: !!f.doubleSided,
    paperSize:   f.paperSize   || 'A4',
    pageRange:   f.pageRange   || 'all',
    binding:     f.binding     || 'none',
  }));

  const { childPricings, totals } = computeBatchPricing({ shop, files: safeFiles });

  for (let attempt = 0; attempt < MAX_TOKEN_RETRIES; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);

        const [lastJob, lastOrder] = await Promise.all([
          tx.job.findFirst({
            where: { shopId, createdAt: { gte: todayStart } },
            orderBy: { token: 'desc' },
            select: { token: true },
          }),
          tx.order.findFirst({
            where: { shopId, createdAt: { gte: todayStart } },
            orderBy: { token: 'desc' },
            select: { token: true },
          }),
        ]);

        const lastToken = Math.max(lastJob?.token || 0, lastOrder?.token || 0);
        const token = lastToken + 1;

        const order = await tx.order.create({
          data: {
            token,
            userId,
            shopId,
            status:              'pending',
            source:              source || 'web',
            fileCount:           safeFiles.length,
            totalPages:          totals.totalPages,
            totalPrice:          totals.total,
            platformFee:         totals.platformFee,
            shopEarning:         totals.shopEarning,
            specialInstructions: specialInstructions || null,
          },
        });

        for (let i = 0; i < safeFiles.length; i++) {
          const f = files[i];
          const p = childPricings[i];
          await tx.job.create({
            data: {
              orderId:     order.id,
              token,
              userId,
              shopId,
              fileUrl:     f.fileUrl,
              fileKey:     f.fileKey     || null,
              fileName:    f.fileName,
              fileSize:    f.fileSize    || 0,
              fileType:    (f.fileType   || 'pdf').toLowerCase(),
              pageCount:   f.pageCount,
              color:       !!f.color,
              copies:      f.copies      || 1,
              doubleSided: !!f.doubleSided,
              paperSize:   f.paperSize   || 'A4',
              pageRange:   f.pageRange   || 'all',
              binding:     f.binding     || 'none',
              pricePerPage: p.pricePerPage,
              totalPrice:   p.total,
              platformFee:  p.platformFee,
              shopEarning:  p.shopEarning,
              status:       'pending',
              source:       source || 'web',
            },
          });
        }

        const fullOrder = await tx.order.findUnique({
          where: { id: order.id },
          include: { jobs: true, shop: true, user: true },
        });

        return { order: fullOrder, totals, childPricings };
      }, { isolationLevel: 'Serializable' });
    } catch (err) {
      if ((err.code === 'P2034' || err.code === 'P2002') && attempt < MAX_TOKEN_RETRIES - 1) {
        continue;
      }
      throw err;
    }
  }
}
```

- [ ] **Step 3: Commit**

```bash
git -C printdrop add backend/src/services/order.js
git -C printdrop commit -m "feat(orders): per-file prefs in createOrder and computeBatchPricing"
```

---

### Task 3: Create `routes/orders.js`

**Files:**
- Create: `backend/src/routes/orders.js`

- [ ] **Step 1: Create the orders route file**

Create `backend/src/routes/orders.js` with the following content:

```javascript
'use strict';

const { authenticate } = require('../middleware/auth');
const orderService     = require('../services/order');

async function orderRoutes(fastify) {

  // ── POST /orders — create multi-file order (authenticated) ───────────────
  fastify.post('/', {
    preHandler: [authenticate],
  }, async (request, reply) => {
    const { shopId, files, specialInstructions } = request.body || {};

    if (!shopId)                             return reply.code(400).send({ error: 'shopId is required' });
    if (!Array.isArray(files) || !files.length) return reply.code(400).send({ error: 'files array is required' });
    if (files.length > 10)                   return reply.code(400).send({ error: 'Maximum 10 files per order' });

    for (const f of files) {
      if (!f.fileUrl || !f.fileName || !f.pageCount) {
        return reply.code(400).send({ error: 'Each file needs fileUrl, fileName, and pageCount' });
      }
    }

    const shop = await fastify.prisma.shop.findUnique({ where: { id: shopId } });
    if (!shop || !shop.isActive) return reply.code(404).send({ error: 'Shop not found or inactive' });

    try {
      const result = await orderService.createOrder({
        userId:             request.user.id,
        shopId,
        files,
        source:             'web',
        specialInstructions,
      });

      return reply.code(201).send({
        order: {
          id:         result.order.id,
          token:      result.order.token,
          totalPrice: result.order.totalPrice,
          fileCount:  result.order.fileCount,
          status:     result.order.status,
          jobs:       result.order.jobs.map((j) => ({
            id:         j.id,
            fileName:   j.fileName,
            totalPrice: j.totalPrice,
            status:     j.status,
          })),
        },
      });
    } catch (err) {
      fastify.log.error(err, 'createOrder failed');
      return reply.code(500).send({ error: err.message || 'Failed to create order' });
    }
  });

  // ── POST /orders/public — create order for unauthenticated guest ─────────
  fastify.post('/public', async (request, reply) => {
    const { shopId, files, customerName, customerPhone, specialInstructions } = request.body || {};

    if (!shopId)                             return reply.code(400).send({ error: 'shopId is required' });
    if (!Array.isArray(files) || !files.length) return reply.code(400).send({ error: 'files array is required' });
    if (files.length > 10)                   return reply.code(400).send({ error: 'Maximum 10 files per order' });
    if (!customerPhone)                      return reply.code(400).send({ error: 'customerPhone is required' });

    for (const f of files) {
      if (!f.fileUrl || !f.fileName || !f.pageCount) {
        return reply.code(400).send({ error: 'Each file needs fileUrl, fileName, and pageCount' });
      }
    }

    const shop = await fastify.prisma.shop.findUnique({ where: { id: shopId } });
    if (!shop || !shop.isActive) return reply.code(404).send({ error: 'Shop not found or inactive' });

    // Find or create guest user by phone
    const normalizedPhone = customerPhone.replace(/\s+/g, '');
    let user = await fastify.prisma.user.findUnique({ where: { phone: normalizedPhone } });
    if (!user) {
      user = await fastify.prisma.user.create({
        data: { phone: normalizedPhone, name: customerName?.trim() || null, role: 'customer' },
      });
    }

    try {
      const result = await orderService.createOrder({
        userId:             user.id,
        shopId,
        files,
        source:             'web',
        specialInstructions,
      });

      // Create payment link immediately for guests (no separate /pay step needed)
      const payment = await orderService.createOrderPaymentLink(result.order.id);

      return reply.code(201).send({
        order: {
          id:         result.order.id,
          token:      result.order.token,
          totalPrice: result.order.totalPrice,
          fileCount:  result.order.fileCount,
          status:     result.order.status,
          shop:       { name: shop.name },
        },
        paymentLink: payment.paymentLink,
      });
    } catch (err) {
      fastify.log.error(err, 'createOrder (public) failed');
      return reply.code(500).send({ error: err.message || 'Failed to create order' });
    }
  });

  // ── POST /orders/:id/pay — create Razorpay payment link for order ────────
  fastify.post('/:id/pay', {
    preHandler: [authenticate],
  }, async (request, reply) => {
    const order = await fastify.prisma.order.findUnique({
      where: { id: request.params.id },
    });
    if (!order)                          return reply.code(404).send({ error: 'Order not found' });
    if (order.userId !== request.user.id) return reply.code(403).send({ error: 'Not authorized' });
    if (!['pending', 'payment_pending'].includes(order.status)) {
      return reply.code(409).send({ error: `Order is already ${order.status}` });
    }

    try {
      const payment = await orderService.createOrderPaymentLink(order.id);

      // Flip order to payment_pending
      await fastify.prisma.order.update({
        where: { id: order.id },
        data:  { status: 'payment_pending' },
      });
      await fastify.prisma.job.updateMany({
        where: { orderId: order.id, status: 'pending' },
        data:  { status: 'payment_pending' },
      });

      return { paymentLink: payment.paymentLink, orderId: order.id };
    } catch (err) {
      fastify.log.error(err, 'createOrderPaymentLink failed');
      return reply.code(500).send({ error: err.message || 'Failed to create payment link' });
    }
  });

}

module.exports = orderRoutes;
```

- [ ] **Step 2: Commit**

```bash
git -C printdrop add backend/src/routes/orders.js
git -C printdrop commit -m "feat(orders): add POST /orders, /orders/public, /orders/:id/pay routes"
```

---

### Task 4: Register Orders Route + Agent Order-Ready Aggregation

**Files:**
- Modify: `backend/src/index.js:91-101`
- Modify: `backend/src/routes/agent.js:153-200`

- [ ] **Step 1: Register the orders route in `index.js`**

In `backend/src/index.js`, find the block that registers routes (around line 91):

```javascript
  await fastify.register(async function apiRoutes(api) {
    api.register(require('./routes/auth'),     { prefix: '/auth' });
    api.register(require('./routes/files'),    { prefix: '/files' });
    api.register(require('./routes/shops'),    { prefix: '/shops' });
    api.register(require('./routes/jobs'),     { prefix: '/jobs' });
    api.register(require('./routes/users'),    { prefix: '/users' });
    api.register(require('./routes/admin'),    { prefix: '/admin' });
    api.register(require('./routes/webhooks'), { prefix: '/webhooks' });
    api.register(require('./routes/printers'), { prefix: '/printers' });
    api.register(require('./routes/agent'),    { prefix: '/agent' });
  }, { prefix: '/api' });
```

Add the orders route registration after `/jobs`:

```javascript
  await fastify.register(async function apiRoutes(api) {
    api.register(require('./routes/auth'),     { prefix: '/auth' });
    api.register(require('./routes/files'),    { prefix: '/files' });
    api.register(require('./routes/shops'),    { prefix: '/shops' });
    api.register(require('./routes/jobs'),     { prefix: '/jobs' });
    api.register(require('./routes/orders'),   { prefix: '/orders' });
    api.register(require('./routes/users'),    { prefix: '/users' });
    api.register(require('./routes/admin'),    { prefix: '/admin' });
    api.register(require('./routes/webhooks'), { prefix: '/webhooks' });
    api.register(require('./routes/printers'), { prefix: '/printers' });
    api.register(require('./routes/agent'),    { prefix: '/agent' });
  }, { prefix: '/api' });
```

- [ ] **Step 2: Add order-ready aggregation to agent status update**

In `backend/src/routes/agent.js`, add two imports at the top of the file after the existing requires:

```javascript
const { recomputeOrderStatus } = require('../services/order');
const { notifyReadyForPickup } = require('../services/notification');
```

Then find the `PATCH /agent/jobs/:id/status` handler. After the line `await notifyUser(updated.userId, messages.statusUpdateMessage(status, updated.token));`, add the order aggregation block. The full try block inside the handler should look like:

```javascript
    try {
      const updated = await jobService.updateJobStatus(request.params.id, status, { printerName, printerId });

      try {
        await notifyUser(updated.userId, messages.statusUpdateMessage(status, updated.token));
      } catch {}

      // If this job belongs to a multi-file order, recompute order status.
      // When all sibling jobs reach 'ready', notify customer once for the whole order.
      if (updated.orderId) {
        try {
          const newOrderStatus = await recomputeOrderStatus(updated.orderId);
          if (newOrderStatus === 'ready') {
            const order = await fastify.prisma.order.findUnique({
              where:   { id: updated.orderId },
              include: { jobs: { take: 1, include: { shop: true } } },
            });
            if (order && order.jobs[0]) {
              notifyReadyForPickup(order.userId, order.token, order.jobs[0].shop.name).catch(() => {});
            }
          }
        } catch (err) {
          fastify.log.warn({ err }, 'recomputeOrderStatus failed — non-fatal');
        }
      }

      return { ok: true, job: updated };
    } catch (err) {
      fastify.log.error(err, 'agent status update failed');
      return reply.status(500).send({ error: err.message });
    }
```

- [ ] **Step 3: Start the backend and verify it boots without errors**

```bash
cd printdrop && npm run dev:backend
```

Expected: server starts on port 3001, no route registration errors, `/health` returns `{ status: 'ok' }`.

- [ ] **Step 4: Commit**

```bash
git -C printdrop add backend/src/index.js backend/src/routes/agent.js
git -C printdrop commit -m "feat(orders): register orders route; agent notifies on order-ready"
```

---

### Task 5: Create `multi-file-cart.tsx` Component

This component handles the file list with per-file accordion settings. It is used only in the Configure step of `/print`.

**Files:**
- Create: `dashboard/src/components/multi-file-cart.tsx`

- [ ] **Step 1: Create the component file**

Create `dashboard/src/components/multi-file-cart.tsx`:

```typescript
'use client';

import { useState, useCallback } from 'react';
import { ChevronDown, ChevronRight, FileText, X, Copy, Palette,
         Layers, Maximize, Scissors, BookOpen } from 'lucide-react';
import { UploadedFileMeta } from './file-upload';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface FilePref {
  color:       boolean;
  copies:      number;
  doubleSided: boolean;
  paperSize:   string;
  pageRange:   string;
  binding:     string;
}

export interface CartFile {
  id:   string;        // stable local key (use crypto.randomUUID())
  meta: UploadedFileMeta;
  pref: FilePref;
}

export const DEFAULT_PREF: FilePref = {
  color:       false,
  copies:      1,
  doubleSided: false,
  paperSize:   'A4',
  pageRange:   'all',
  binding:     'none',
};

// ── CartFileList ───────────────────────────────────────────────────────────────

interface CartFileListProps {
  files:    CartFile[];
  onChange: (id: string, pref: FilePref) => void;
}

export function CartFileList({ files, onChange }: CartFileListProps) {
  const [openId, setOpenId] = useState<string | null>(files[0]?.id ?? null);

  const toggle = (id: string) => setOpenId((prev) => (prev === id ? null : id));

  const copyToAll = (sourcePref: FilePref) => {
    files.forEach((f) => onChange(f.id, { ...sourcePref }));
  };

  return (
    <div className="space-y-2">
      {files.map((file) => (
        <FileAccordion
          key={file.id}
          file={file}
          isOpen={openId === file.id}
          onToggle={() => toggle(file.id)}
          onChange={(pref) => onChange(file.id, pref)}
          onCopyToAll={() => copyToAll(file.pref)}
          showCopyAll={files.length > 1}
        />
      ))}
    </div>
  );
}

// ── FileAccordion ──────────────────────────────────────────────────────────────

interface FileAccordionProps {
  file:        CartFile;
  isOpen:      boolean;
  onToggle:    () => void;
  onChange:    (pref: FilePref) => void;
  onCopyToAll: () => void;
  showCopyAll: boolean;
}

function FileAccordion({ file, isOpen, onToggle, onChange, onCopyToAll, showCopyAll }: FileAccordionProps) {
  const { meta, pref } = file;
  const summary = prefSummary(pref);

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      {/* Header row */}
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors"
      >
        <FileText className="w-4 h-4 text-gray-400 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-800 truncate">{meta.fileName}</p>
          <p className="text-[11px] text-gray-400 mt-0.5">
            {meta.pageCount} page{meta.pageCount !== 1 ? 's' : ''} · {summary}
          </p>
        </div>
        {isOpen
          ? <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />
          : <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" />
        }
      </button>

      {/* Expanded settings */}
      {isOpen && (
        <div className="border-t border-gray-100 px-4 py-4 space-y-4">

          {/* Copy to all */}
          {showCopyAll && (
            <button
              onClick={onCopyToAll}
              className="flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:text-blue-700"
            >
              <Copy className="w-3.5 h-3.5" />
              Copy these settings to all files
            </button>
          )}

          {/* Color */}
          <ToggleRow
            icon={<Palette className="w-4 h-4" />}
            label="Print type"
            options={[
              { value: false, label: 'B&W',   desc: 'Grayscale' },
              { value: true,  label: 'Color', desc: 'Full color' },
            ]}
            selected={pref.color}
            onChange={(v) => onChange({ ...pref, color: v as boolean })}
          />

          {/* Copies */}
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-sm font-medium text-gray-700">
              <Copy className="w-4 h-4 text-gray-400" />
              Copies
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => onChange({ ...pref, copies: Math.max(1, pref.copies - 1) })}
                className="w-8 h-8 rounded-lg border border-gray-200 flex items-center justify-center text-gray-600 hover:bg-gray-50 text-lg font-bold"
              >−</button>
              <span className="w-8 text-center font-bold text-base">{pref.copies}</span>
              <button
                onClick={() => onChange({ ...pref, copies: Math.min(99, pref.copies + 1) })}
                className="w-8 h-8 rounded-lg border border-gray-200 flex items-center justify-center text-gray-600 hover:bg-gray-50 text-lg font-bold"
              >+</button>
            </div>
          </div>

          {/* Sides */}
          <ToggleRow
            icon={<Layers className="w-4 h-4" />}
            label="Sides"
            options={[
              { value: false, label: 'Single', desc: 'One-sided' },
              { value: true,  label: 'Double', desc: 'Both sides' },
            ]}
            selected={pref.doubleSided}
            onChange={(v) => onChange({ ...pref, doubleSided: v as boolean })}
          />

          {/* Paper size */}
          <ToggleRow
            icon={<Maximize className="w-4 h-4" />}
            label="Paper size"
            options={[
              { value: 'A4',     label: 'A4',     desc: 'Standard' },
              { value: 'A3',     label: 'A3',     desc: 'Large' },
              { value: 'Letter', label: 'Letter', desc: 'US Letter' },
              { value: 'Legal',  label: 'Legal',  desc: 'US Legal' },
            ]}
            selected={pref.paperSize}
            onChange={(v) => onChange({ ...pref, paperSize: v as string })}
          />

          {/* Page range */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Scissors className="w-4 h-4 text-gray-400" />
              <span className="text-sm font-medium text-gray-700">Pages</span>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => onChange({ ...pref, pageRange: 'all' })}
                className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium border transition-all ${
                  pref.pageRange === 'all'
                    ? 'bg-blue-50 border-blue-300 text-blue-700'
                    : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                }`}
              >All pages</button>
              <input
                type="text"
                placeholder="e.g. 1-3, 5"
                value={pref.pageRange === 'all' ? '' : pref.pageRange}
                onChange={(e) => onChange({ ...pref, pageRange: e.target.value || 'all' })}
                onFocus={() => { if (pref.pageRange === 'all') onChange({ ...pref, pageRange: '' }); }}
                className="flex-1 px-3 py-2 rounded-lg text-sm border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          </div>

          {/* Binding */}
          <ToggleRow
            icon={<BookOpen className="w-4 h-4" />}
            label="Binding"
            options={[
              { value: 'none',   label: 'None',   desc: 'Loose' },
              { value: 'staple', label: 'Staple', desc: 'Corner' },
              { value: 'spiral', label: 'Spiral', desc: 'Bound' },
            ]}
            selected={pref.binding}
            onChange={(v) => onChange({ ...pref, binding: v as string })}
          />

        </div>
      )}
    </div>
  );
}

// ── ToggleRow ─────────────────────────────────────────────────────────────────

function ToggleRow<T extends string | boolean>({
  icon, label, options, selected, onChange,
}: {
  icon:     React.ReactNode;
  label:    string;
  options:  { value: T; label: string; desc: string }[];
  selected: T;
  onChange: (v: T) => void;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-gray-400">{icon}</span>
        <span className="text-sm font-medium text-gray-700">{label}</span>
      </div>
      <div className="flex gap-2">
        {options.map((opt) => (
          <button
            key={String(opt.value)}
            onClick={() => onChange(opt.value)}
            className={`flex-1 px-2 py-2 rounded-lg text-center border transition-all ${
              selected === opt.value
                ? 'bg-blue-50 border-blue-300 text-blue-700'
                : 'border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
          >
            <p className="text-sm font-medium">{opt.label}</p>
            <p className="text-[10px] text-gray-400">{opt.desc}</p>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function prefSummary(p: FilePref): string {
  const parts = [
    p.color ? 'Color' : 'B&W',
    `${p.copies} cop${p.copies === 1 ? 'y' : 'ies'}`,
    p.paperSize,
    p.doubleSided ? '2-sided' : '1-sided',
  ];
  if (p.pageRange !== 'all') parts.push(`pg ${p.pageRange}`);
  if (p.binding !== 'none')  parts.push(p.binding);
  return parts.join(' · ');
}
```

- [ ] **Step 2: Commit**

```bash
git -C printdrop add dashboard/src/components/multi-file-cart.tsx
git -C printdrop commit -m "feat(dashboard): add multi-file cart accordion component"
```

---

### Task 6: Rewrite `/print` Page — Upload + Configure Steps

**Files:**
- Modify: `dashboard/src/app/print/page.tsx`
- Modify: `dashboard/src/lib/web-orders.ts`

- [ ] **Step 1: Add `upsertCachedOrder` to `web-orders.ts`**

Open `dashboard/src/lib/web-orders.ts`. Add the following at the end of the file (keep existing exports):

```typescript
export interface CachedOrder {
  orderId:   string;
  token:     number;
  shopName:  string;
  fileCount: number;
  status:    string;
  updatedAt: number;
}

const ORDER_CACHE_KEY = 'printdrop_orders';
const ORDER_CACHE_MAX = 10;

export function upsertCachedOrder(order: CachedOrder): void {
  try {
    const raw  = localStorage.getItem(ORDER_CACHE_KEY);
    const list: CachedOrder[] = raw ? JSON.parse(raw) : [];
    const idx  = list.findIndex((o) => o.orderId === order.orderId);
    if (idx >= 0) {
      list[idx] = { ...order, updatedAt: Date.now() };
    } else {
      list.unshift({ ...order, updatedAt: Date.now() });
      if (list.length > ORDER_CACHE_MAX) list.pop();
    }
    localStorage.setItem(ORDER_CACHE_KEY, JSON.stringify(list));
  } catch {}
}
```

- [ ] **Step 2: Rewrite `/print/page.tsx`**

Replace the entire content of `dashboard/src/app/print/page.tsx` with:

```typescript
'use client';

import { useState, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import { useShops } from '@/lib/hooks';
import { api } from '@/lib/api';
import { encodePathSegment, getSafeExternalUrl, getSafePaymentUrl } from '@/lib/security';
import { Navbar } from '@/components/navbar';
import { FileUpload, UploadedFileMeta } from '@/components/file-upload';
import { CartFile, CartFileList, DEFAULT_PREF, FilePref } from '@/components/multi-file-cart';
import { Card, CardBody } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { upsertCachedOrder } from '@/lib/web-orders';
import {
  Printer, FileText, MapPin, Clock, IndianRupee, ChevronRight,
  Loader2, Check, ArrowLeft, MessageCircle, Home, Plus, Trash2,
  Phone, UserRound,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Shop {
  id: string;
  name: string;
  address?: string;
  phone: string;
  opensAt: string;
  closesAt: string;
  ratesBwSingle: number;
  ratesColorSingle: number;
  isOpen: boolean;
}

interface CustomerDetails {
  name: string;
  phone: string;
}

type Step = 'upload' | 'configure' | 'shop' | 'contact' | 'review';

const ALL_STEPS: { key: Step; label: string }[] = [
  { key: 'upload',    label: 'Upload'    },
  { key: 'configure', label: 'Configure' },
  { key: 'shop',      label: 'Shop'      },
  { key: 'contact',   label: 'Contact'   },
  { key: 'review',    label: 'Review'    },
];

const MAX_FILES = 10;

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function PrintPage() {
  const { user, loading: authLoading } = useAuth();
  const router   = useRouter();
  const { data: shops } = useShops();

  const steps = useMemo(
    () => user ? ALL_STEPS.filter((s) => s.key !== 'contact') : ALL_STEPS,
    [user],
  );

  const [step,         setStep]         = useState<Step>('upload');
  const [cartFiles,    setCartFiles]    = useState<CartFile[]>([]);
  const [selectedShop, setSelectedShop] = useState<Shop | null>(null);
  const [customer,     setCustomer]     = useState<CustomerDetails>({ name: '', phone: '' });
  const [submitting,   setSubmitting]   = useState(false);
  const [error,        setError]        = useState('');

  const shopList: Shop[] = Array.isArray(shops) ? shops : [];

  // ── File cart helpers ────────────────────────────────────────────────────────

  const addFile = useCallback((meta: UploadedFileMeta) => {
    setCartFiles((prev) => {
      if (prev.length >= MAX_FILES) return prev;
      return [...prev, { id: crypto.randomUUID(), meta, pref: { ...DEFAULT_PREF } }];
    });
  }, []);

  const removeFile = useCallback((id: string) => {
    setCartFiles((prev) => prev.filter((f) => f.id !== id));
  }, []);

  const updatePref = useCallback((id: string, pref: FilePref) => {
    setCartFiles((prev) => prev.map((f) => f.id === id ? { ...f, pref } : f));
  }, []);

  // ── Price estimate ────────────────────────────────────────────────────────────

  const priceBreakdown = useMemo(() => {
    if (!selectedShop || cartFiles.length === 0) return null;
    const s = selectedShop;

    return cartFiles.map(({ meta, pref }) => {
      const pages   = pref.pageRange === 'all' ? meta.pageCount : estimatePageCount(pref.pageRange, meta.pageCount);
      const rate    = pref.color ? s.ratesColorSingle : s.ratesBwSingle;
      const sub     = rate * pages * pref.copies;
      const fee     = Math.round(0.50 * pages * pref.copies * 100) / 100;
      return { fileName: meta.fileName, rate, pages, copies: pref.copies, subtotal: sub, fee, total: Math.round((sub + fee) * 100) / 100 };
    });
  }, [cartFiles, selectedShop]);

  const grandTotal = priceBreakdown ? priceBreakdown.reduce((acc, r) => acc + r.total, 0) : 0;

  // ── Submit ────────────────────────────────────────────────────────────────────

  const submit = async () => {
    if (cartFiles.length === 0 || !selectedShop) return;
    setSubmitting(true);
    setError('');
    try {
      const files = cartFiles.map(({ meta, pref }) => ({
        fileUrl:     meta.fileUrl,
        fileKey:     meta.fileKey,
        fileName:    meta.fileName,
        fileSize:    meta.fileSize,
        fileType:    meta.fileType,
        pageCount:   meta.pageCount,
        color:       pref.color,
        copies:      pref.copies,
        doubleSided: pref.doubleSided,
        paperSize:   pref.paperSize,
        pageRange:   pref.pageRange,
        binding:     pref.binding,
      }));

      let orderId = '';
      let paymentLink: unknown = '';

      if (user) {
        const { order } = await api.post('/orders', { shopId: selectedShop.id, files });
        orderId = order.id;
        upsertCachedOrder({
          orderId,
          token:     order.token,
          shopName:  selectedShop.name,
          fileCount: order.fileCount,
          status:    order.status,
          updatedAt: Date.now(),
        });
        const payment = await api.post(`/orders/${encodePathSegment(orderId)}/pay`, {});
        paymentLink = payment.paymentLink;
      } else {
        const result = await api.post('/orders/public', {
          shopId:        selectedShop.id,
          files,
          customerName:  customer.name,
          customerPhone: customer.phone,
        });
        orderId = result.order.id;
        paymentLink = result.paymentLink;
        upsertCachedOrder({
          orderId,
          token:     result.order.token,
          shopName:  result.order.shop?.name || selectedShop.name,
          fileCount: result.order.fileCount,
          status:    result.order.status,
          updatedAt: Date.now(),
        });
      }

      const safe = getSafePaymentUrl(paymentLink);
      if (safe) {
        window.location.assign(safe);
      } else {
        router.push(`/pay/${encodePathSegment(orderId)}`);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to create order');
      setSubmitting(false);
    }
  };

  // ── Navigation ───────────────────────────────────────────────────────────────

  const canNext = (): boolean => {
    if (step === 'upload')    return cartFiles.length > 0;
    if (step === 'configure') return cartFiles.every((f) => f.pref.copies >= 1);
    if (step === 'shop')      return !!selectedShop;
    if (step === 'contact')   return isValidPhone(customer.phone);
    return true;
  };

  const next = () => {
    const idx = steps.findIndex((s) => s.key === step);
    if (idx < steps.length - 1) setStep(steps[idx + 1].key);
  };
  const back = () => {
    const idx = steps.findIndex((s) => s.key === step);
    if (idx > 0) setStep(steps[idx - 1].key);
  };

  if (authLoading) return <div className="min-h-screen flex items-center justify-center text-gray-400">Loading...</div>;

  return (
    <div className="min-h-screen bg-gray-50">
      {user ? <Navbar /> : <PublicPrintHeader />}

      <div className="max-w-2xl mx-auto px-4 py-6 pb-28">
        <StepBar steps={steps} current={step} />

        {/* ── Step 1: Upload ── */}
        {step === 'upload' && (
          <section className="mt-6 space-y-4">
            <div>
              <h2 className="text-xl font-bold">Upload your files</h2>
              <p className="text-sm text-gray-500 mt-1">
                PDF, images, or documents — up to 50 MB each, max {MAX_FILES} files
              </p>
            </div>

            {cartFiles.length < MAX_FILES && (
              <FileUpload
                onUploaded={addFile}
                uploadUrl={user ? '/api/files/upload' : '/api/files/public-upload'}
              />
            )}

            {cartFiles.map((f) => (
              <Card key={f.id}>
                <CardBody className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-blue-50 flex items-center justify-center shrink-0">
                    <FileText className="w-4 h-4 text-blue-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">{f.meta.fileName}</p>
                    <p className="text-xs text-gray-500">
                      {f.meta.pageCount} page{f.meta.pageCount !== 1 ? 's' : ''} · {(f.meta.fileSize / 1024).toFixed(0)} KB
                    </p>
                  </div>
                  <Check className="w-4 h-4 text-green-500 shrink-0" />
                  <button
                    onClick={() => removeFile(f.id)}
                    className="p-1 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </CardBody>
              </Card>
            ))}

            {cartFiles.length > 0 && cartFiles.length < MAX_FILES && (
              <p className="text-xs text-center text-gray-400">
                {MAX_FILES - cartFiles.length} more file{MAX_FILES - cartFiles.length !== 1 ? 's' : ''} can be added
              </p>
            )}
          </section>
        )}

        {/* ── Step 2: Configure ── */}
        {step === 'configure' && (
          <section className="mt-6 space-y-4">
            <div>
              <h2 className="text-xl font-bold">Print settings</h2>
              <p className="text-sm text-gray-500 mt-1">
                Configure each file individually
              </p>
            </div>
            <CartFileList files={cartFiles} onChange={updatePref} />
          </section>
        )}

        {/* ── Step 3: Shop ── */}
        {step === 'shop' && (
          <section className="mt-6 space-y-4">
            <div>
              <h2 className="text-xl font-bold">Choose a shop</h2>
              <p className="text-sm text-gray-500 mt-1">All {cartFiles.length} file{cartFiles.length !== 1 ? 's' : ''} will be printed here</p>
            </div>
            {shopList.length === 0 ? (
              <div className="text-center py-12 text-gray-400">
                <MapPin className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No shops available yet</p>
              </div>
            ) : (
              <div className="space-y-2">
                {shopList.map((shop) => (
                  <button
                    key={shop.id}
                    onClick={() => setSelectedShop(shop)}
                    className={`w-full text-left rounded-xl border-2 p-4 transition-all ${
                      selectedShop?.id === shop.id
                        ? 'border-blue-500 bg-blue-50/50 ring-1 ring-blue-500'
                        : 'border-gray-200 bg-white hover:border-gray-300'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-semibold text-sm">{shop.name}</p>
                          <Badge status={shop.isOpen ? 'active' : 'inactive'} />
                        </div>
                        {shop.address && <p className="text-xs text-gray-500 mt-0.5 truncate">{shop.address}</p>}
                        <div className="flex items-center gap-3 mt-1.5 text-xs text-gray-400">
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />{shop.opensAt} – {shop.closesAt}
                          </span>
                          <span className="flex items-center gap-1">
                            <IndianRupee className="w-3 h-3" />
                            ₹{shop.ratesBwSingle}/pg BW · ₹{shop.ratesColorSingle}/pg Color
                          </span>
                        </div>
                      </div>
                      {selectedShop?.id === shop.id && <Check className="w-5 h-5 text-blue-600 shrink-0 mt-1" />}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </section>
        )}

        {/* ── Step 4: Contact (guest only) ── */}
        {step === 'contact' && !user && (
          <section className="mt-6 space-y-4">
            <div>
              <h2 className="text-xl font-bold">Where should we send your token?</h2>
              <p className="text-sm text-gray-500 mt-1">Use your WhatsApp number so we can notify you when ready.</p>
            </div>
            <Card>
              <CardBody className="space-y-4">
                <label className="block">
                  <span className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-1.5">
                    <UserRound className="w-4 h-4 text-gray-400" />
                    Name
                  </span>
                  <input
                    type="text"
                    value={customer.name}
                    onChange={(e) => setCustomer((c) => ({ ...c, name: e.target.value }))}
                    placeholder="Your name"
                    maxLength={80}
                    className="w-full rounded-xl border border-gray-200 px-3 py-3 text-base focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
                  />
                </label>
                <label className="block">
                  <span className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-1.5">
                    <Phone className="w-4 h-4 text-gray-400" />
                    WhatsApp number
                  </span>
                  <input
                    type="tel"
                    value={customer.phone}
                    onChange={(e) => setCustomer((c) => ({ ...c, phone: e.target.value }))}
                    placeholder="+91 98765 43210"
                    className="w-full rounded-xl border border-gray-200 px-3 py-3 text-base focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
                  />
                  <p className="text-xs text-gray-400 mt-1.5">Include country code if outside India.</p>
                </label>
              </CardBody>
            </Card>
          </section>
        )}

        {/* ── Step 5: Review ── */}
        {step === 'review' && selectedShop && priceBreakdown && (
          <section className="mt-6 space-y-4">
            <div>
              <h2 className="text-xl font-bold">Review your order</h2>
              <p className="text-sm text-gray-500 mt-1">{cartFiles.length} file{cartFiles.length !== 1 ? 's' : ''} · {selectedShop.name}</p>
            </div>

            {/* Per-file cards */}
            {priceBreakdown.map((row, i) => (
              <Card key={i}>
                <CardBody className="space-y-2">
                  <div className="flex items-center gap-2">
                    <FileText className="w-4 h-4 text-blue-600 shrink-0" />
                    <p className="font-medium text-sm truncate">{row.fileName}</p>
                  </div>
                  <div className="flex justify-between text-xs text-gray-500">
                    <span>₹{row.rate}/pg × {row.pages} pg × {row.copies} cop{row.copies === 1 ? 'y' : 'ies'}</span>
                    <span>₹{row.subtotal.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-xs text-gray-500">
                    <span>Platform fee</span>
                    <span>₹{row.fee.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-sm font-semibold border-t border-gray-100 pt-1.5">
                    <span>File total</span>
                    <span>₹{row.total.toFixed(2)}</span>
                  </div>
                </CardBody>
              </Card>
            ))}

            {/* Grand total */}
            <Card>
              <CardBody>
                <div className="flex justify-between text-base font-black">
                  <span>Total</span>
                  <span className="text-blue-600 flex items-center gap-0.5">
                    <IndianRupee className="w-4 h-4" />
                    {grandTotal.toFixed(2)}
                  </span>
                </div>
              </CardBody>
            </Card>

            {!user && (
              <Card>
                <CardBody className="flex items-center gap-3">
                  <MessageCircle className="w-5 h-5 text-amber-600 shrink-0" />
                  <div>
                    <p className="font-medium text-sm">{customer.name.trim() || 'Customer'}</p>
                    <p className="text-xs text-gray-500">{customer.phone}</p>
                  </div>
                </CardBody>
              </Card>
            )}

            {error && (
              <div className="bg-red-50 text-red-700 text-sm px-4 py-3 rounded-xl">{error}</div>
            )}
          </section>
        )}
      </div>

      {/* ── Sticky bottom bar ── */}
      <div className="fixed bottom-0 inset-x-0 bg-white border-t border-gray-200 px-4 py-3 z-30">
        <div className="max-w-2xl mx-auto flex gap-3">
          {step !== 'upload' && (
            <Button variant="secondary" onClick={back} className="rounded-xl px-5">
              <ArrowLeft className="w-4 h-4 mr-1.5" />Back
            </Button>
          )}
          {step !== steps[steps.length - 1].key ? (
            <Button onClick={next} disabled={!canNext()} className="flex-1 rounded-xl py-3 text-base" size="lg">
              Continue<ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          ) : (
            <Button onClick={submit} disabled={submitting} className="flex-1 rounded-xl py-3 text-base" size="lg">
              {submitting
                ? <span className="flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />Creating order…</span>
                : <>Pay ₹{grandTotal.toFixed(2)}<ChevronRight className="w-4 h-4 ml-1" /></>
              }
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function PublicPrintHeader() {
  const whatsappUrl = getSafeExternalUrl(process.env.NEXT_PUBLIC_WHATSAPP_ORDER_URL);
  return (
    <header className="sticky top-0 z-40 bg-white/90 backdrop-blur border-b border-gray-200">
      <div className="max-w-2xl mx-auto px-4 h-14 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2 font-semibold text-[15px]">
          <span className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center">
            <Printer className="w-4 h-4 text-white" />
          </span>
          PrintDrop
        </Link>
        <div className="flex items-center gap-2">
          {whatsappUrl && (
            <a href={whatsappUrl} target="_blank" rel="noopener noreferrer"
              className="hidden sm:flex items-center gap-1.5 text-xs font-medium text-green-700 bg-green-50 border border-green-100 rounded-lg px-3 py-2 hover:bg-green-100">
              <MessageCircle className="w-3.5 h-3.5" />WhatsApp
            </a>
          )}
          <Link href="/" className="flex items-center gap-1.5 text-xs font-medium text-gray-600 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 hover:bg-gray-100">
            <Home className="w-3.5 h-3.5" />Home
          </Link>
        </div>
      </div>
    </header>
  );
}

function StepBar({ steps, current }: { steps: typeof ALL_STEPS; current: Step }) {
  const currentIdx = steps.findIndex((s) => s.key === current);
  return (
    <div className="flex items-center gap-1">
      {steps.map((s, i) => (
        <div key={s.key} className="flex-1 flex flex-col items-center gap-1.5">
          <div className={`h-1 w-full rounded-full transition-all ${i <= currentIdx ? 'bg-blue-500' : 'bg-gray-200'}`} />
          <span className={`text-[11px] font-medium transition-colors ${i === currentIdx ? 'text-blue-600' : i < currentIdx ? 'text-gray-500' : 'text-gray-300'}`}>
            {s.label}
          </span>
        </div>
      ))}
    </div>
  );
}

function isValidPhone(value: string): boolean {
  const cleaned = value.replace(/[^\d+]/g, '');
  const digits  = cleaned.startsWith('+') ? cleaned.slice(1) : cleaned;
  return /^\d{10,15}$/.test(digits);
}

function estimatePageCount(range: string, total: number): number {
  if (!range || range === 'all') return total;
  const pages = new Set<number>();
  for (const part of range.split(',').map((s) => s.trim()).filter(Boolean)) {
    const match = part.match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!match) return total;
    const start = Number(match[1]);
    const end   = match[2] ? Number(match[2]) : start;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) return total;
    for (let i = start; i <= Math.min(end, total); i++) pages.add(i);
  }
  return pages.size || total;
}
```

- [ ] **Step 3: Start the dashboard dev server and verify the `/print` page loads**

```bash
cd printdrop && npm run dev:dashboard
```

Open `http://localhost:3000/print`. Expected: Step 1 "Upload your files" renders, FileUpload component is visible, no TypeScript errors in terminal.

- [ ] **Step 4: Test the flow manually**

1. Upload a PDF → file card appears with filename, page count, and trash icon
2. Click Continue → Step 2 "Configure" with accordion per file
3. Expand accordion → settings panel shows (color, copies, sides, paper, page range, binding)
4. With 2 files: "Copy these settings to all files" button appears
5. Click Continue → Step 3 Shop selection
6. Select shop → Step 4/5 Review → price breakdown shows per-file rows + grand total
7. (Guest flow) Contact step appears between shop and review

- [ ] **Step 5: Commit**

```bash
git -C printdrop add dashboard/src/app/print/page.tsx dashboard/src/lib/web-orders.ts
git -C printdrop commit -m "feat(dashboard): multi-file cart /print page with per-file settings"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task |
|-----------------|------|
| WhatsApp greeting → web app link | Task 1 |
| Per-file prefs in `createOrder` | Task 2 |
| `POST /orders` authenticated | Task 3 |
| `POST /orders/public` guest | Task 3 |
| `POST /orders/:id/pay` | Task 3 |
| Register orders route | Task 4 |
| Agent order-ready aggregation + notify | Task 4 |
| CartFileList with per-file accordion | Task 5 |
| Upload step: multi-file, add/remove, cap 10 | Task 6 |
| Configure step: accordion, copy-to-all | Task 6 |
| Shop step: unchanged | Task 6 |
| Contact step: unchanged (guest only) | Task 6 |
| Review: per-file pricing + grand total | Task 6 |
| Submit: calls `/orders` not `/jobs` | Task 6 |

**Placeholder scan:** No TBDs, all code blocks complete.

**Type consistency:** `CartFile.pref: FilePref` defined in Task 5, used identically in Task 6. `upsertCachedOrder` defined in Task 6 step 1, called in Task 6 step 2.

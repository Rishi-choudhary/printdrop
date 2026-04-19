'use strict';

/**
 * In-memory idempotency tracker for webhook message IDs.
 *
 * Drops duplicate deliveries (Gupshup / Razorpay both retry on non-2xx). Keys
 * TTL after 5 min; older entries are swept in-place on each write. Capacity is
 * bounded at MAX_ENTRIES to bound memory if upstream spams us.
 */

const TTL_MS = 5 * 60 * 1000;
const MAX_ENTRIES = 20_000;

const seen = new Map();

function key(source, id) {
  return `${source}:${id}`;
}

function wasSeen(source, id) {
  if (!id) return false;
  const k = key(source, id);
  const now = Date.now();

  const hit = seen.get(k);
  if (hit && hit > now) return true;

  // Opportunistic eviction — if we're at capacity, sweep TTL'd entries first.
  if (seen.size >= MAX_ENTRIES) {
    for (const [kk, exp] of seen) {
      if (exp <= now) seen.delete(kk);
      if (seen.size < MAX_ENTRIES) break;
    }
    // Still full? Drop oldest insertion order entries until under cap.
    if (seen.size >= MAX_ENTRIES) {
      const drop = Math.ceil(MAX_ENTRIES * 0.1);
      let i = 0;
      for (const kk of seen.keys()) {
        seen.delete(kk);
        if (++i >= drop) break;
      }
    }
  }

  seen.set(k, now + TTL_MS);
  return false;
}

module.exports = { wasSeen };

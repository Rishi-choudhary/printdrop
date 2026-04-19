'use strict';

/**
 * In-memory WhatsApp session store for bot v2.
 *
 * One active session per phone. Each session tracks the current state in the
 * 3-state FSM plus the Job id currently being authored. Sessions auto-expire
 * after SESSION_TTL_MS of inactivity and are swept periodically.
 *
 * Keeping this in-process is deliberate for the MVP: no migrations, no Redis
 * dependency, and session loss on restart is harmless because any unpaid job
 * naturally falls back to `idle` on the next inbound message.
 */

const STATES = Object.freeze({
  IDLE:              'idle',
  AWAITING_CHOICE:   'awaiting_choice',
  AWAITING_PAYMENT:  'awaiting_payment',
});

const SESSION_TTL_MS = 15 * 60 * 1000;     // 15 min
const SWEEP_INTERVAL_MS = 2 * 60 * 1000;   // 2 min

const sessions = new Map();
let sweeper = null;

function ensureSweeper() {
  if (sweeper) return;
  sweeper = setInterval(() => {
    const now = Date.now();
    for (const [phone, s] of sessions) {
      if (s.expiresAt <= now) sessions.delete(phone);
    }
  }, SWEEP_INTERVAL_MS);
  if (sweeper.unref) sweeper.unref();
}

function getSession(phone) {
  ensureSweeper();
  const now = Date.now();
  const existing = sessions.get(phone);
  if (existing && existing.expiresAt > now) return existing;

  const fresh = {
    phone,
    state:        STATES.IDLE,
    pendingJobId: null,
    createdAt:    now,
    expiresAt:    now + SESSION_TTL_MS,
  };
  sessions.set(phone, fresh);
  return fresh;
}

function setState(phone, state, patch = {}) {
  const s = getSession(phone);
  s.state     = state;
  s.expiresAt = Date.now() + SESSION_TTL_MS;
  Object.assign(s, patch);
  sessions.set(phone, s);
  return s;
}

function clearSession(phone) {
  sessions.delete(phone);
}

function touch(phone) {
  const s = sessions.get(phone);
  if (s) s.expiresAt = Date.now() + SESSION_TTL_MS;
}

function stats() {
  return { size: sessions.size };
}

module.exports = { STATES, getSession, setState, clearSession, touch, stats };

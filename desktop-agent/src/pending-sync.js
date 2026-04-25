/**
 * Pending sync queue — persisted at userData/pending_sync.json.
 *
 * When a print job succeeds but the backend status update fails (offline,
 * transient network error), we enqueue a pending action here instead of
 * losing it.  The agent drains this queue on every successful poll cycle.
 *
 * Supported actions: 'ready' | 'picked_up'
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

let _queue = null;

function _filePath() {
  return path.join(app.getPath('userData'), 'pending_sync.json');
}

function _load() {
  if (_queue) return _queue;
  try {
    const raw = fs.readFileSync(_filePath(), 'utf8');
    _queue = JSON.parse(raw).queue || [];
  } catch {
    _queue = [];
  }
  return _queue;
}

function _persist() {
  const fp = _filePath();
  const dir = path.dirname(fp);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = `${fp}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ version: 1, queue: _queue }, null, 2), {
    encoding: 'utf8',
    mode: 0o600,
  });
  fs.renameSync(tmp, fp);
  try { fs.chmodSync(fp, 0o600); } catch {}
}

function enqueue(jobId, action, extra = {}) {
  _load();
  const idx = _queue.findIndex((e) => e.jobId === jobId && e.action === action);
  const entry = { jobId, action, ...extra, queuedAt: new Date().toISOString(), attempts: 0 };
  if (idx !== -1) {
    _queue[idx] = entry;
  } else {
    _queue.push(entry);
  }
  _persist();
}

function remove(jobId, action) {
  _load();
  const before = _queue.length;
  _queue = _queue.filter((e) => !(e.jobId === jobId && e.action === action));
  if (_queue.length !== before) _persist();
}

function getAll() {
  return [..._load()];
}

function isEmpty() {
  return _load().length === 0;
}

function incrementAttempts(jobId, action) {
  _load();
  const entry = _queue.find((e) => e.jobId === jobId && e.action === action);
  if (entry) {
    entry.attempts = (entry.attempts || 0) + 1;
    _persist();
  }
}

module.exports = { enqueue, remove, getAll, isEmpty, incrementAttempts };

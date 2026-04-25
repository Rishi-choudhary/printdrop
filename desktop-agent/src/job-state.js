/**
 * Rich local job state store — persisted at userData/job_state.json.
 *
 * localStatus values:
 *   downloading | claimed | printing | print_done
 *   ready_synced | picked_up_synced | picked_up_pending
 *   needs_review | failed | cancelled
 *
 * Only jobs whose localStatus is in TERMINAL_STATUSES are considered "done"
 * and will be skipped by the poll loop (same role as processed-jobs.js but
 * richer).  Non-terminal statuses (downloading, claimed, printing) indicate
 * a crash happened mid-flight and the job should be shown as needs_review.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const crypto = require('crypto');

const PRUNE_AFTER_DAYS = 14;
const TERMINAL_STATUSES = new Set([
  'ready_synced', 'picked_up_synced', 'failed', 'cancelled', 'needs_review',
]);

let _jobs = null;

function _filePath() {
  return path.join(app.getPath('userData'), 'job_state.json');
}

function _load() {
  if (_jobs) return _jobs;
  try {
    const raw = fs.readFileSync(_filePath(), 'utf8');
    _jobs = JSON.parse(raw).jobs || {};
  } catch {
    _jobs = {};
  }
  _pruneOld();
  return _jobs;
}

function _pruneOld() {
  const cutoff = Date.now() - PRUNE_AFTER_DAYS * 24 * 60 * 60 * 1000;
  let changed = false;
  for (const [id, job] of Object.entries(_jobs)) {
    const ts = job.pickedUpSyncedAt || job.readySyncedAt || job.printCompletedAt || job.claimedAt;
    if (ts && new Date(ts).getTime() < cutoff) {
      delete _jobs[id];
      changed = true;
    }
  }
  if (changed) _persist();
}

function _persist() {
  const fp = _filePath();
  const dir = path.dirname(fp);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = `${fp}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ version: 1, jobs: _jobs, savedAt: new Date().toISOString() }, null, 2), {
    encoding: 'utf8',
    mode: 0o600,
  });
  fs.renameSync(tmp, fp);
  try { fs.chmodSync(fp, 0o600); } catch {}
}

function get(jobId) {
  return _load()[jobId] || null;
}

/** Returns true if this job was fully processed and should not be re-queued. */
function isTerminal(jobId) {
  const j = get(jobId);
  return j ? TERMINAL_STATUSES.has(j.localStatus) : false;
}

function upsert(jobId, fields) {
  _load();
  const existing = _jobs[jobId] || { jobId, retryCount: 0 };
  _jobs[jobId] = { ...existing, ...fields };
  _persist();
  return _jobs[jobId];
}

function getAll() {
  return Object.values(_load());
}

/** Jobs where print completed locally but ready-sync hasn't been confirmed. */
function getPendingReadySync() {
  return getAll().filter((j) => j.localStatus === 'print_done' && !j.readySyncedAt);
}

function newAttemptId() {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

module.exports = { get, isTerminal, upsert, getAll, getPendingReadySync, newAttemptId };

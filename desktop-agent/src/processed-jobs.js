/**
 * Persistent idempotency store for processed job IDs.
 * Stored at userData/processed_jobs.json as a date-keyed map.
 * Entries older than 7 days are pruned on startup.
 */
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const PRUNE_AFTER_DAYS = 7;

let _jobs = null; // { [jobId]: isoTimestamp }

function getFilePath() {
  return path.join(app.getPath('userData'), 'processed_jobs.json');
}

function load() {
  if (_jobs) return _jobs;
  try {
    const raw = fs.readFileSync(getFilePath(), 'utf8');
    const parsed = JSON.parse(raw);
    _jobs = parsed.jobs || {};
  } catch {
    _jobs = {};
  }
  _pruneOld();
  return _jobs;
}

function _pruneOld() {
  const cutoff = Date.now() - PRUNE_AFTER_DAYS * 24 * 60 * 60 * 1000;
  let changed = false;
  for (const [id, ts] of Object.entries(_jobs)) {
    if (new Date(ts).getTime() < cutoff) {
      delete _jobs[id];
      changed = true;
    }
  }
  if (changed) _persist();
}

function _persist() {
  const fp = getFilePath();
  const dir = path.dirname(fp);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = `${fp}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ version: 1, jobs: _jobs, lastPrunedAt: new Date().toISOString() }, null, 2), {
    encoding: 'utf8',
    mode: 0o600,
  });
  fs.renameSync(tmp, fp);
  try { fs.chmodSync(fp, 0o600); } catch {}
}

function has(jobId) {
  const jobs = load();
  return jobId in jobs;
}

function add(jobId) {
  load(); // ensure _jobs is initialised
  _jobs[jobId] = new Date().toISOString();
  _persist(); // synchronous write — crash-safe
}

function remove(jobId) {
  load();
  if (jobId in _jobs) {
    delete _jobs[jobId];
    _persist();
  }
}

module.exports = { has, add, remove, load };

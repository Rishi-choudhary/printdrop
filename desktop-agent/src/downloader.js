/**
 * Download a file from a URL to a local temp path.
 *
 * R2 public URLs need no auth. Only the backend API URL gets the agentKey header.
 * Handles two recovery paths:
 *   1. Missing / malformed fileUrl → go straight to presign refresh via fileKey
 *   2. Presigned URL expired (401/403) → refresh via backend, retry once
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { assertPublicHttpUrl } = require('./security');

const DOWNLOAD_TIMEOUT_MS = 120_000; // 2 minutes per attempt
const MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024;

function isValidUrl(u) {
  if (!u || typeof u !== 'string') return false;
  try {
    new URL(u);
    return true;
  } catch {
    return false;
  }
}

async function downloadFile(fileUrl, fileName, { agentKey, apiUrl, fileKey } = {}) {
  const destDir = path.join(os.tmpdir(), 'printdrop-downloads');
  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

  const safeName = path.basename(fileName || 'file').replace(/[^a-zA-Z0-9._-]/g, '_');
  const destPath = path.join(destDir, `${Date.now()}_${crypto.randomUUID()}_${safeName}`);

  async function fetchWithTimeout(url, headers = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
    try {
      return await fetch(url, { headers, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  function headersFor(url) {
    // Only add auth for calls to our own API server, not R2 CDN
    try {
      if (apiUrl && new URL(url).origin === new URL(apiUrl).origin) {
        return { Authorization: `Bearer ${agentKey}` };
      }
    } catch {
      return {};
    }
    return {};
  }

  async function refreshViaPresign() {
    if (!fileKey || !agentKey || !apiUrl) {
      throw new Error('No fileKey available to refresh URL');
    }
    const presignUrl = `${apiUrl}/api/files/presign?key=${encodeURIComponent(fileKey)}`;
    const presignRes = await fetchWithTimeout(presignUrl, {
      Authorization: `Bearer ${agentKey}`,
    });
    if (!presignRes.ok) {
      throw new Error(`URL refresh failed: HTTP ${presignRes.status}`);
    }
    const { url: freshUrl } = await presignRes.json();
    if (!isValidUrl(freshUrl)) {
      throw new Error('Presign returned invalid URL');
    }
    await assertPublicHttpUrl(freshUrl, {
      allowHttp: process.env.NODE_ENV === 'development',
      allowPrivate: process.env.NODE_ENV === 'development',
    });
    return freshUrl;
  }

  let res;

  if (!isValidUrl(fileUrl)) {
    // No usable URL on the job record — refresh from scratch via fileKey.
    if (!fileKey) {
      throw new Error('Job has no fileUrl and no fileKey — cannot download');
    }
    const fresh = await refreshViaPresign();
    res = await fetchWithTimeout(fresh, headersFor(fresh));
  } else {
    await assertPublicHttpUrl(fileUrl, {
      allowHttp: process.env.NODE_ENV === 'development',
      allowPrivate: process.env.NODE_ENV === 'development',
    });
    res = await fetchWithTimeout(fileUrl, headersFor(fileUrl));

    // Presigned URL expired — refresh it
    if ((res.status === 403 || res.status === 401) && fileKey && agentKey && apiUrl) {
      const fresh = await refreshViaPresign();
      res = await fetchWithTimeout(fresh, headersFor(fresh));
    }
  }

  if (!res.ok) {
    throw new Error(`Download failed: HTTP ${res.status}`);
  }

  const contentLength = Number.parseInt(res.headers.get('content-length') || '0', 10);
  if (contentLength > MAX_DOWNLOAD_BYTES) {
    throw new Error(`Downloaded file is too large (${contentLength} bytes)`);
  }

  const tmpPath = `${destPath}.part`;
  let bytes = 0;
  const out = fs.createWriteStream(tmpPath, { flags: 'wx' });
  try {
    for await (const chunk of res.body) {
      bytes += chunk.length;
      if (bytes > MAX_DOWNLOAD_BYTES) {
        throw new Error(`Downloaded file exceeds ${MAX_DOWNLOAD_BYTES} bytes`);
      }
      if (!out.write(chunk)) {
        await new Promise((resolve) => out.once('drain', resolve));
      }
    }
    await new Promise((resolve, reject) => out.end((err) => (err ? reject(err) : resolve())));
    if (bytes === 0) {
      throw new Error('Downloaded file is empty (0 bytes)');
    }
    fs.renameSync(tmpPath, destPath);
  } catch (err) {
    try { out.destroy(); } catch {}
    try { fs.unlinkSync(tmpPath); } catch {}
    throw err;
  }
  return destPath;
}

module.exports = { downloadFile };

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

const DOWNLOAD_TIMEOUT_MS = 120_000; // 2 minutes per attempt

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
  const destPath = path.join(destDir, `${Date.now()}_${safeName}`);

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
    if (apiUrl && url.startsWith(apiUrl)) {
      return { Authorization: `Bearer ${agentKey}` };
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

  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length === 0) {
    throw new Error('Downloaded file is empty (0 bytes)');
  }
  fs.writeFileSync(destPath, buffer);
  return destPath;
}

module.exports = { downloadFile };

/**
 * Download a file from a URL to a local temp path.
 *
 * R2 public URLs need no auth. Only the backend API URL gets the agentKey header.
 * If a presigned URL has expired (403/401), it is refreshed via the backend.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const DOWNLOAD_TIMEOUT_MS = 120_000; // 2 minutes per attempt

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

  let res = await fetchWithTimeout(fileUrl, headersFor(fileUrl));

  // Presigned URL expired — refresh it
  if ((res.status === 403 || res.status === 401) && fileKey && agentKey && apiUrl) {
    const presignUrl = `${apiUrl}/api/files/presign?key=${encodeURIComponent(fileKey)}`;
    const presignRes = await fetchWithTimeout(presignUrl, { Authorization: `Bearer ${agentKey}` });
    if (!presignRes.ok) {
      throw new Error(`URL refresh failed: HTTP ${presignRes.status}`);
    }
    const { url: freshUrl } = await presignRes.json();
    res = await fetchWithTimeout(freshUrl, headersFor(freshUrl));
  }

  if (!res.ok) {
    throw new Error(`Download failed: HTTP ${res.status} for ${fileUrl}`);
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(destPath, buffer);
  return destPath;
}

module.exports = { downloadFile };

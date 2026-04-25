const fs = require('fs');
const path = require('path');
const { PDFDocument } = require('pdf-lib');
const config = require('../config');
const storage = require('./storage');

const ALLOWED_EXTENSIONS = config.upload.allowedFileTypes || [
  'pdf', 'jpg', 'jpeg', 'png', 'doc', 'docx', 'ppt', 'pptx',
];
const MAX_SIZE = (config.upload.maxFileSizeMb || 50) * 1024 * 1024;

// Extensions that need LibreOffice conversion to PDF
const CONVERTIBLE_EXTENSIONS = ['doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx', 'odt', 'odp'];

function validateFile(fileName, fileSize) {
  const ext = path.extname(fileName).toLowerCase().replace('.', '');
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return { valid: false, error: 'unsupported_type' };
  }
  if (fileSize > MAX_SIZE) {
    return { valid: false, error: 'file_too_large' };
  }
  return { valid: true, error: null };
}

function getFileExtension(fileName) {
  return path.extname(fileName).toLowerCase().replace('.', '');
}

function getMimeType(ext) {
  const map = {
    pdf: 'application/pdf',
    jpg: 'image/jpeg', jpeg: 'image/jpeg',
    png: 'image/png', gif: 'image/gif', webp: 'image/webp',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  };
  return map[ext] || 'application/octet-stream';
}

/**
 * Save file buffer via storage driver (local or R2).
 * Returns { key, url, size }.
 */
async function saveUploadedFile(fileBuffer, originalName) {
  const ext = getFileExtension(originalName);
  const contentType = getMimeType(ext);
  const result = await storage.upload(fileBuffer, originalName, contentType);

  // If convertible doc, also convert to PDF for page counting
  let convertedPdfBuffer = null;
  if (CONVERTIBLE_EXTENSIONS.includes(ext)) {
    convertedPdfBuffer = await convertToPdf(fileBuffer, originalName);
  }

  return {
    ...result,
    fileUrl: result.url,
    fileName: path.basename(result.key),
    fileSize: result.size,
    convertedPdfBuffer,
  };
}

/**
 * Convert DOCX/PPTX to PDF via LibreOffice service.
 * Returns PDF buffer or null if conversion fails/unavailable.
 */
async function convertToPdf(fileBuffer, fileName) {
  try {
    const url = `${config.libreoffice.url}/convert`;
    const formData = new FormData();
    formData.append('file', new Blob([fileBuffer]), fileName);

    const res = await fetch(url, { method: 'POST', body: formData, signal: AbortSignal.timeout(30000) });
    if (!res.ok) {
      console.warn(`LibreOffice conversion failed: ${res.status}`);
      return null;
    }
    return Buffer.from(await res.arrayBuffer());
  } catch (err) {
    console.warn(`LibreOffice service unavailable: ${err.message}`);
    return null;
  }
}

async function getPageCount(filePathOrBuffer, fileType) {
  const ext = (fileType || '').toLowerCase().replace('.', '');

  if (ext === 'pdf') {
    try {
      const buffer = Buffer.isBuffer(filePathOrBuffer)
        ? filePathOrBuffer
        : fs.readFileSync(filePathOrBuffer);
      const pdf = await PDFDocument.load(buffer, { ignoreEncryption: true });
      return pdf.getPageCount();
    } catch {
      return 1;
    }
  }

  // Images are 1 page
  if (['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp'].includes(ext)) {
    return 1;
  }

  // DOCX, PPTX — estimate 1 page (unless we have a converted PDF)
  return 1;
}

/**
 * Get page count with optional PDF conversion for office docs.
 */
async function getPageCountSmart(fileBuffer, fileName) {
  const ext = getFileExtension(fileName);

  if (ext === 'pdf') {
    return getPageCount(fileBuffer, 'pdf');
  }

  if (['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp'].includes(ext)) {
    return 1;
  }

  // Try converting to PDF for accurate page count
  const pdfBuffer = await convertToPdf(fileBuffer, fileName);
  if (pdfBuffer) {
    return getPageCount(pdfBuffer, 'pdf');
  }

  return 1; // fallback
}

/**
 * Download a file from a URL and store it via the storage driver.
 * @param {string} url  - The URL to fetch.
 * @param {Object} headers - Optional HTTP headers (e.g. Authorization).
 * @param {string} [hintFileName] - Preferred filename (e.g. from the WhatsApp payload).
 *   When provided and it has a valid extension, it takes priority over the URL path.
 */
async function downloadFile(url, headers = {}, hintFileName) {
  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`Failed to download file: ${response.status}`);
  }

  // Check Content-Length header before downloading (when available)
  const contentLength = parseInt(response.headers.get('content-length') || '0', 10);
  if (contentLength > MAX_SIZE) {
    throw new Error(`File too large: ${(contentLength / 1024 / 1024).toFixed(1)}MB (max ${config.upload.maxFileSizeMb}MB)`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());

  // Double-check actual size for chunked transfers where Content-Length may be absent
  if (buffer.length > MAX_SIZE) {
    throw new Error(`File too large: ${(buffer.length / 1024 / 1024).toFixed(1)}MB (max ${config.upload.maxFileSizeMb}MB)`);
  }

  // 1. Prefer a caller-supplied filename (from Gupshup payload).
  if (hintFileName && path.extname(hintFileName)) {
    return saveUploadedFile(buffer, hintFileName);
  }

  // 2. Infer a filename from the URL path (ignore query strings).
  //    Use a try/catch in case the URL has unusual characters.
  let originalName = 'download.pdf';
  try {
    const urlPath = new URL(url).pathname;
    const base = path.basename(urlPath);
    if (base && base !== '/') originalName = base;
  } catch {
    // Malformed URL — fall back to safe default
  }

  return saveUploadedFile(buffer, originalName);
}

module.exports = {
  validateFile,
  saveUploadedFile,
  getPageCount,
  getPageCountSmart,
  downloadFile,
  getFileExtension,
  getMimeType,
  convertToPdf,
};

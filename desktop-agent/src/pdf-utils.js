/**
 * PDF utilities for the print agent.
 * Handles page range parsing and extraction before sending to printer.
 */
const { PDFDocument } = require('pdf-lib');
const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Parse a page range string (e.g. "1-5,8,10-12") into a sorted array of page numbers.
 * Returns null if rangeStr is 'all' or empty (meaning print everything).
 */
function parsePageRange(rangeStr, totalPages) {
  if (!rangeStr || rangeStr === 'all') return null;

  const pages = new Set();
  for (const part of rangeStr.split(',').map((s) => s.trim())) {
    if (part.includes('-')) {
      const [s, e] = part.split('-').map(Number);
      for (let i = s; i <= Math.min(e, totalPages); i++) pages.add(i);
    } else {
      const p = parseInt(part, 10);
      if (p >= 1 && p <= totalPages) pages.add(p);
    }
  }

  return Array.from(pages).sort((a, b) => a - b);
}

/**
 * Extract specific pages from a PDF file.
 * Returns the path to a new temporary PDF with only those pages.
 * Caller is responsible for deleting the temp file after use.
 */
async function extractPages(inputPath, pageNumbers) {
  const buffer = fs.readFileSync(inputPath);
  const srcDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });
  const destDoc = await PDFDocument.create();

  // Convert 1-indexed page numbers to 0-indexed, filter out of range
  const indices = pageNumbers
    .map((n) => n - 1)
    .filter((i) => i >= 0 && i < srcDoc.getPageCount());

  if (indices.length === 0) {
    throw new Error(`No valid pages in range. Document has ${srcDoc.getPageCount()} pages.`);
  }

  const copiedPages = await destDoc.copyPages(srcDoc, indices);
  for (const page of copiedPages) destDoc.addPage(page);

  const pdfBytes = await destDoc.save();
  const tmpPath = path.join(os.tmpdir(), `printdrop_${Date.now()}.pdf`);
  fs.writeFileSync(tmpPath, pdfBytes);
  return tmpPath;
}

/**
 * Prepare a file for printing — extract page range if needed.
 * Returns { printPath, isTmp } where isTmp=true means caller must delete it.
 */
async function prepareForPrinting(filePath, pageRange, totalPages) {
  const pages = parsePageRange(pageRange, totalPages);
  if (!pages) {
    return { printPath: filePath, isTmp: false };
  }

  console.log(`    Extracting pages [${pages.join(', ')}] from ${totalPages}-page document...`);
  const tmpPath = await extractPages(filePath, pages);
  console.log(`    Extracted ${pages.length} page(s) → temp file`);
  return { printPath: tmpPath, isTmp: true };
}

/**
 * Generate a cover page PDF for a print job.
 * Returns the path to a temporary PDF file.
 */
async function generateCoverPage(job, printerName) {
  const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');

  const doc = await PDFDocument.create();
  const page = doc.addPage([595.28, 841.89]); // A4

  const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);
  const regularFont = await doc.embedFont(StandardFonts.Helvetica);

  const { width, height } = page.getSize();
  const margin = 50;
  let y = height - margin;

  // ── Header: "PrintDrop" ──
  page.drawText('PrintDrop', {
    x: margin,
    y,
    size: 11,
    font: regularFont,
    color: rgb(0.5, 0.5, 0.5),
  });
  y -= 60;

  // ── Token number ──
  const tokenStr = `#${String(job.token).padStart(3, '0')}`;
  const tokenSize = 72;
  const tokenWidth = boldFont.widthOfTextAtSize(tokenStr, tokenSize);
  page.drawText(tokenStr, {
    x: (width - tokenWidth) / 2,
    y,
    size: tokenSize,
    font: boldFont,
    color: rgb(0.05, 0.05, 0.05),
  });
  y -= 20;

  // ── Divider ──
  page.drawLine({
    start: { x: margin, y },
    end: { x: width - margin, y },
    thickness: 1,
    color: rgb(0.8, 0.8, 0.8),
  });
  y -= 30;

  // ── Details grid ──
  const labelX = margin;
  const valueX = margin + 120;
  const lineH = 26;
  const labelSize = 11;
  const valueSize = 11;
  const labelColor = rgb(0.45, 0.45, 0.45);
  const valueColor = rgb(0.1, 0.1, 0.1);

  const details = [
    ['File', job.fileName || '—'],
    ['Pages', `${job.pageCount} page${job.pageCount !== 1 ? 's' : ''}${job.pageRange && job.pageRange !== 'all' ? ` (${job.pageRange})` : ''}`],
    ['Mode', `${job.color ? 'Color' : 'B&W'}  |  ${job.doubleSided ? 'Double-sided' : 'Single-sided'}`],
    ['Copies', String(job.copies)],
    ['Paper', job.paperSize || 'A4'],
  ];

  if (job.binding && job.binding !== 'none') {
    details.push(['Binding', job.binding]);
  }

  for (const [label, value] of details) {
    page.drawText(`${label}:`, {
      x: labelX,
      y,
      size: labelSize,
      font: regularFont,
      color: labelColor,
    });
    // Truncate long file names so they don't overflow
    const maxLen = 55;
    const displayValue = value.length > maxLen ? value.slice(0, maxLen - 3) + '...' : value;
    page.drawText(displayValue, {
      x: valueX,
      y,
      size: valueSize,
      font: boldFont,
      color: valueColor,
    });
    y -= lineH;
  }

  // ── Second divider ──
  y -= 10;
  page.drawLine({
    start: { x: margin, y },
    end: { x: width - margin, y },
    thickness: 1,
    color: rgb(0.8, 0.8, 0.8),
  });
  y -= 24;

  // ── Footer: Printer + Time ──
  const now = new Date();
  const timeStr = now.toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true,
  });

  page.drawText(`Printer:`, { x: labelX, y, size: 10, font: regularFont, color: labelColor });
  page.drawText(printerName || 'Default', { x: valueX, y, size: 10, font: boldFont, color: valueColor });
  y -= 20;
  page.drawText(`Time:`, { x: labelX, y, size: 10, font: regularFont, color: labelColor });
  page.drawText(timeStr, { x: valueX, y, size: 10, font: boldFont, color: valueColor });

  // ── Dashed cut line with scissors at bottom ──
  const cutY = margin + 20;
  const dashLen = 6;
  const gapLen = 4;
  let cx = margin + 20;
  while (cx < width - margin - 20) {
    page.drawLine({
      start: { x: cx, y: cutY },
      end: { x: Math.min(cx + dashLen, width - margin - 20), y: cutY },
      thickness: 0.75,
      color: rgb(0.6, 0.6, 0.6),
    });
    cx += dashLen + gapLen;
  }
  page.drawText('✂', {
    x: margin,
    y: cutY - 7,
    size: 14,
    font: regularFont,
    color: rgb(0.5, 0.5, 0.5),
  });

  const pdfBytes = await doc.save();
  const tmpPath = path.join(os.tmpdir(), `printdrop_cover_${Date.now()}.pdf`);
  fs.writeFileSync(tmpPath, pdfBytes);
  return tmpPath;
}

/**
 * Merge a cover page PDF with the document PDF into a new temp file.
 * Returns the path to the merged PDF (caller must delete it).
 */
async function prependCoverPage(coverPath, documentPath) {
  const { PDFDocument } = require('pdf-lib');

  const [coverBytes, docBytes] = await Promise.all([
    fs.promises.readFile(coverPath),
    fs.promises.readFile(documentPath),
  ]);

  const coverDoc = await PDFDocument.load(coverBytes, { ignoreEncryption: true });
  const srcDoc = await PDFDocument.load(docBytes, { ignoreEncryption: true });
  const merged = await PDFDocument.create();

  const [coverPage] = await merged.copyPages(coverDoc, [0]);
  merged.addPage(coverPage);

  const docPages = await merged.copyPages(srcDoc, srcDoc.getPageIndices());
  for (const p of docPages) merged.addPage(p);

  const pdfBytes = await merged.save();
  const tmpPath = path.join(os.tmpdir(), `printdrop_merged_${Date.now()}.pdf`);
  fs.writeFileSync(tmpPath, pdfBytes);
  return tmpPath;
}

module.exports = { parsePageRange, extractPages, prepareForPrinting, generateCoverPage, prependCoverPage };

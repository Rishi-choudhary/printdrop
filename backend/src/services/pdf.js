/**
 * PDF processing utilities — pdf-lib based.
 * Handles page counting, metadata extraction, page range validation.
 */
const { PDFDocument } = require('pdf-lib');

/**
 * Get detailed PDF info: page count, dimensions, metadata.
 */
async function getPdfInfo(buffer) {
  const pdf = await PDFDocument.load(buffer, { ignoreEncryption: true });
  const pages = pdf.getPages();

  const pageDetails = pages.map((page, i) => {
    const { width, height } = page.getSize();
    return {
      number: i + 1,
      width: Math.round(width * 100) / 100,
      height: Math.round(height * 100) / 100,
      // Standard sizes detection
      size: detectPaperSize(width, height),
      orientation: width > height ? 'landscape' : 'portrait',
    };
  });

  return {
    pageCount: pdf.getPageCount(),
    title: pdf.getTitle() || null,
    author: pdf.getAuthor() || null,
    subject: pdf.getSubject() || null,
    creator: pdf.getCreator() || null,
    producer: pdf.getProducer() || null,
    creationDate: pdf.getCreationDate() || null,
    pages: pageDetails,
  };
}

/**
 * Detect standard paper size from PDF point dimensions.
 */
function detectPaperSize(width, height) {
  // Normalize to portrait
  const w = Math.min(width, height);
  const h = Math.max(width, height);

  const sizes = {
    A4: { w: 595, h: 842 },
    A3: { w: 842, h: 1191 },
    Letter: { w: 612, h: 792 },
    Legal: { w: 612, h: 1008 },
    A5: { w: 420, h: 595 },
  };

  for (const [name, s] of Object.entries(sizes)) {
    if (Math.abs(w - s.w) < 10 && Math.abs(h - s.h) < 10) return name;
  }
  return 'Custom';
}

/**
 * Extract specific pages from a PDF.
 * Returns a new PDF buffer with only the specified pages.
 */
async function extractPages(buffer, pageNumbers) {
  const srcDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });
  const destDoc = await PDFDocument.create();

  // Convert 1-indexed to 0-indexed
  const indices = pageNumbers.map(n => n - 1).filter(i => i >= 0 && i < srcDoc.getPageCount());
  const copiedPages = await destDoc.copyPages(srcDoc, indices);

  for (const page of copiedPages) {
    destDoc.addPage(page);
  }

  return Buffer.from(await destDoc.save());
}

/**
 * Get first page as a separate PDF (for preview/thumbnail generation).
 */
async function getFirstPage(buffer) {
  return extractPages(buffer, [1]);
}

module.exports = {
  getPdfInfo,
  extractPages,
  getFirstPage,
  detectPaperSize,
};

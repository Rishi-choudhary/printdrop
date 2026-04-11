/**
 * Wrap a JPG or PNG image into a single A4-sized PDF using pdf-lib.
 * The image is centered on the page with a 20pt margin, maintaining aspect ratio.
 * Returns the path to the temporary PDF file.
 */
const { PDFDocument } = require('pdf-lib');
const fs = require('fs');
const path = require('path');
const os = require('os');

const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;
const MARGIN = 20;

async function wrapImageAsPdf(imagePath) {
  const imageBytes = fs.readFileSync(imagePath);
  const ext = path.extname(imagePath).toLowerCase();

  const pdfDoc = await PDFDocument.create();
  let image;

  if (ext === '.jpg' || ext === '.jpeg') {
    image = await pdfDoc.embedJpg(imageBytes);
  } else if (ext === '.png') {
    image = await pdfDoc.embedPng(imageBytes);
  } else {
    throw new Error(`Cannot convert image to PDF: unsupported type "${ext}"`);
  }

  const maxW = A4_WIDTH - MARGIN * 2;
  const maxH = A4_HEIGHT - MARGIN * 2;
  const scale = Math.min(maxW / image.width, maxH / image.height);
  const scaledW = image.width * scale;
  const scaledH = image.height * scale;

  const page = pdfDoc.addPage([A4_WIDTH, A4_HEIGHT]);
  page.drawImage(image, {
    x: (A4_WIDTH - scaledW) / 2,
    y: (A4_HEIGHT - scaledH) / 2,
    width: scaledW,
    height: scaledH,
  });

  const pdfBytes = await pdfDoc.save();
  const tmpPath = path.join(os.tmpdir(), `printdrop_img_${Date.now()}.pdf`);
  fs.writeFileSync(tmpPath, pdfBytes);
  return tmpPath;
}

module.exports = { wrapImageAsPdf };

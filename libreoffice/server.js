/**
 * LibreOffice Headless — HTTP conversion service.
 * POST /convert  (multipart file) → returns PDF buffer
 * GET  /health   → { status: "ok" }
 */
const express = require('express');
const multer = require('multer');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const app = express();
const upload = multer({ dest: os.tmpdir(), limits: { fileSize: 100 * 1024 * 1024 } });
const PORT = process.env.PORT || 3002;

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'libreoffice-converter' });
});

app.post('/convert', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file provided' });

  const inputPath = req.file.path;
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lo-'));

  try {
    // Run LibreOffice headless conversion
    execSync(
      `libreoffice --headless --convert-to pdf --outdir "${outDir}" "${inputPath}"`,
      { timeout: 60000, stdio: 'pipe' }
    );

    // Find the output PDF
    const files = fs.readdirSync(outDir).filter(f => f.endsWith('.pdf'));
    if (files.length === 0) {
      throw new Error('Conversion produced no PDF output');
    }

    const pdfPath = path.join(outDir, files[0]);
    const pdfBuffer = fs.readFileSync(pdfPath);

    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `attachment; filename="${path.parse(req.file.originalname).name}.pdf"`);
    res.send(pdfBuffer);

    // Cleanup
    fs.unlinkSync(pdfPath);
  } catch (err) {
    console.error('Conversion error:', err.message);
    res.status(500).json({ error: 'Conversion failed', details: err.message });
  } finally {
    // Cleanup input
    try { fs.unlinkSync(inputPath); } catch {}
    try { fs.rmSync(outDir, { recursive: true }); } catch {}
  }
});

app.listen(PORT, () => {
  console.log(`LibreOffice converter listening on :${PORT}`);
});

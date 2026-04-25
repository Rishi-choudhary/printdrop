'use strict';

const fs = require('fs');
const path = require('path');
const { app, nativeImage } = require('electron');

const ROOT = path.resolve(__dirname, '..');
const BUILD_DIR = path.join(ROOT, 'build');
const ASSETS_DIR = path.join(ROOT, 'assets', 'icons');
const ICONSET_DIR = path.join(BUILD_DIR, 'PrintDrop.iconset');
const SOURCE_SVG = path.join(BUILD_DIR, 'icon.svg');
const SOURCE_PNG = path.join(ASSETS_DIR, 'icon.png');

const PNG_TARGETS = [
  { size: 16, file: 'icon_16x16.png' },
  { size: 32, file: 'icon_16x16@2x.png' },
  { size: 32, file: 'icon_32x32.png' },
  { size: 64, file: 'icon_32x32@2x.png' },
  { size: 128, file: 'icon_128x128.png' },
  { size: 256, file: 'icon_128x128@2x.png' },
  { size: 256, file: 'icon_256x256.png' },
  { size: 512, file: 'icon_256x256@2x.png' },
  { size: 512, file: 'icon_512x512.png' },
  { size: 1024, file: 'icon_512x512@2x.png' },
];

const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];
const ICNS_TYPES = new Map([
  [16, 'icp4'],
  [32, 'icp5'],
  [64, 'icp6'],
  [128, 'ic07'],
  [256, 'ic08'],
  [512, 'ic09'],
  [1024, 'ic10'],
]);

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readSourceImage() {
  const svg = fs.readFileSync(SOURCE_SVG, 'utf8');
  const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
  const svgImage = nativeImage.createFromDataURL(dataUrl);
  if (!svgImage.isEmpty()) return svgImage;

  const pngImage = nativeImage.createFromPath(SOURCE_PNG);
  if (!pngImage.isEmpty()) return pngImage;

  throw new Error(`Could not render ${SOURCE_SVG}; ${SOURCE_PNG} is also missing or invalid`);
}

function pngBuffer(image, size) {
  return image.resize({ width: size, height: size, quality: 'best' }).toPNG();
}

function writeIco(entries, targetPath) {
  const headerSize = 6;
  const directorySize = entries.length * 16;
  let offset = headerSize + directorySize;

  const header = Buffer.alloc(headerSize);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);

  const directories = [];
  for (const entry of entries) {
    const dir = Buffer.alloc(16);
    dir.writeUInt8(entry.size >= 256 ? 0 : entry.size, 0);
    dir.writeUInt8(entry.size >= 256 ? 0 : entry.size, 1);
    dir.writeUInt8(0, 2);
    dir.writeUInt8(0, 3);
    dir.writeUInt16LE(1, 4);
    dir.writeUInt16LE(32, 6);
    dir.writeUInt32LE(entry.buffer.length, 8);
    dir.writeUInt32LE(offset, 12);
    directories.push(dir);
    offset += entry.buffer.length;
  }

  fs.writeFileSync(targetPath, Buffer.concat([header, ...directories, ...entries.map((e) => e.buffer)]));
}

function writeIcns(entries, targetPath) {
  const chunks = entries.map((entry) => {
    const type = ICNS_TYPES.get(entry.size);
    const header = Buffer.alloc(8);
    header.write(type, 0, 4, 'ascii');
    header.writeUInt32BE(entry.buffer.length + 8, 4);
    return Buffer.concat([header, entry.buffer]);
  });

  const fileHeader = Buffer.alloc(8);
  fileHeader.write('icns', 0, 4, 'ascii');
  fileHeader.writeUInt32BE(chunks.reduce((sum, chunk) => sum + chunk.length, 8), 4);
  fs.writeFileSync(targetPath, Buffer.concat([fileHeader, ...chunks]));
}

app.whenReady().then(() => {
  ensureDir(BUILD_DIR);
  ensureDir(ASSETS_DIR);
  ensureDir(path.join(BUILD_DIR, 'icons'));
  ensureDir(ICONSET_DIR);

  const image = readSourceImage();

  const appPng = pngBuffer(image, 1024);
  fs.writeFileSync(path.join(ASSETS_DIR, 'icon.png'), appPng);

  for (const target of PNG_TARGETS) {
    fs.writeFileSync(path.join(ICONSET_DIR, target.file), pngBuffer(image, target.size));
  }

  fs.writeFileSync(path.join(BUILD_DIR, 'icons', '512x512.png'), pngBuffer(image, 512));
  fs.writeFileSync(path.join(BUILD_DIR, 'icons', '256x256.png'), pngBuffer(image, 256));
  fs.writeFileSync(path.join(BUILD_DIR, 'icons', '128x128.png'), pngBuffer(image, 128));

  writeIco(
    ICO_SIZES.map((size) => ({ size, buffer: pngBuffer(image, size) })),
    path.join(BUILD_DIR, 'icon.ico')
  );

  writeIcns(
    Array.from(ICNS_TYPES.keys()).map((size) => ({ size, buffer: pngBuffer(image, size) })),
    path.join(BUILD_DIR, 'icon.icns')
  );

  app.quit();
}).catch((err) => {
  console.error(err.stack || err.message);
  app.exit(1);
});

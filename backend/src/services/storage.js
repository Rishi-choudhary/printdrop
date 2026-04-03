/**
 * Storage service — abstracts local filesystem vs Cloudflare R2.
 * STORAGE_DRIVER=local  → saves to ./uploads (dev)
 * STORAGE_DRIVER=r2     → uploads to Cloudflare R2 (prod)
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('../config');

let s3Client = null;

function getS3Client() {
  if (s3Client) return s3Client;
  const { S3Client } = require('@aws-sdk/client-s3');
  s3Client = new S3Client({
    region: 'auto',
    endpoint: `https://${config.storage.r2.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: config.storage.r2.accessKeyId,
      secretAccessKey: config.storage.r2.secretAccessKey,
    },
  });
  return s3Client;
}

function generateKey(originalName) {
  const ext = path.extname(originalName);
  const base = path.basename(originalName, ext).replace(/[^a-zA-Z0-9_-]/g, '_');
  const hash = crypto.randomBytes(8).toString('hex');
  return `uploads/${base}_${hash}${ext}`;
}

// ---- Local Driver ----

async function localUpload(buffer, originalName) {
  const uploadsDir = config.upload.dir;
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

  const key = generateKey(originalName);
  const fileName = path.basename(key);
  const filePath = path.join(uploadsDir, fileName);
  fs.writeFileSync(filePath, buffer);

  return {
    key,
    url: `${config.apiUrl}/uploads/${fileName}`,
    size: buffer.length,
  };
}

async function localDownload(key) {
  const fileName = path.basename(key);
  const filePath = path.join(config.upload.dir, fileName);
  return fs.readFileSync(filePath);
}

async function localDelete(key) {
  const fileName = path.basename(key);
  const filePath = path.join(config.upload.dir, fileName);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

async function localGetSignedUrl(key) {
  return `${config.apiUrl}/uploads/${path.basename(key)}`;
}

// ---- R2 Driver ----

async function r2Upload(buffer, originalName, contentType) {
  const { PutObjectCommand } = require('@aws-sdk/client-s3');
  const key = generateKey(originalName);

  await getS3Client().send(new PutObjectCommand({
    Bucket: config.storage.r2.bucketName,
    Key: key,
    Body: buffer,
    ContentType: contentType || 'application/octet-stream',
  }));

  // If a public custom domain is configured (R2 public bucket), use a
  // permanent URL. Otherwise sign for 7 days — the print agent and dashboard
  // can call GET /api/files/presign?key=… to refresh before expiry.
  let url;
  if (config.storage.r2.publicUrl) {
    url = `${config.storage.r2.publicUrl}/${key}`;
  } else {
    url = await r2GetSignedUrl(key, 7 * 24 * 3600); // 7 days
  }

  return { key, url, size: buffer.length };
}

async function r2Download(key) {
  const { GetObjectCommand } = require('@aws-sdk/client-s3');
  const res = await getS3Client().send(new GetObjectCommand({
    Bucket: config.storage.r2.bucketName,
    Key: key,
  }));
  const chunks = [];
  for await (const chunk of res.Body) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function r2Delete(key) {
  const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
  await getS3Client().send(new DeleteObjectCommand({
    Bucket: config.storage.r2.bucketName,
    Key: key,
  }));
}

async function r2GetSignedUrl(key, expiresIn = 3600) {
  const { GetObjectCommand } = require('@aws-sdk/client-s3');
  const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
  const command = new GetObjectCommand({
    Bucket: config.storage.r2.bucketName,
    Key: key,
  });
  return getSignedUrl(getS3Client(), command, { expiresIn });
}

// ---- Unified API ----

const isR2 = () => config.storage.driver === 'r2';

module.exports = {
  /**
   * Upload a file buffer. Returns { key, url, size }.
   */
  async upload(buffer, originalName, contentType) {
    return isR2()
      ? r2Upload(buffer, originalName, contentType)
      : localUpload(buffer, originalName);
  },

  /**
   * Download a file by key. Returns Buffer.
   */
  async download(key) {
    return isR2() ? r2Download(key) : localDownload(key);
  },

  /**
   * Delete a file by key.
   */
  async remove(key) {
    return isR2() ? r2Delete(key) : localDelete(key);
  },

  /**
   * Get a public or presigned URL for a key.
   */
  async getUrl(key) {
    return isR2() ? r2GetSignedUrl(key) : localGetSignedUrl(key);
  },

  /** Check which driver is active */
  get driver() { return config.storage.driver; },
};

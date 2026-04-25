/**
 * File upload route — POST /api/files/upload
 *
 * Accepts a multipart file, validates it, uploads to Cloudflare R2 (or local
 * in dev), and returns structured metadata ready to create a Job.
 *
 * Also exposes:
 *  GET  /api/files/presign?key=…   — refresh a short-lived signed URL
 *  DELETE /api/files/:key          — delete a file (admin/shopkeeper only)
 */

const path = require('path');
const fileService = require('../services/file');
const storage     = require('../services/storage');
const { authenticate, requireRole } = require('../middleware/auth');
const { isAuthorizedForJob, isValidStorageKey } = require('../utils/request');

const ERROR_MESSAGES = {
  unsupported_type: 'File type not allowed. Accepted: PDF, JPG, PNG, DOCX, PPTX.',
  file_too_large:   `File exceeds the maximum allowed size.`,
  no_file:          'No file was attached to the request.',
};

async function fileRoutes(fastify) {
  async function findAuthorizedJobByKey(key, user) {
    if (!isValidStorageKey(key)) return { error: 'Invalid storage key', status: 400 };

    const job = await fastify.prisma.job.findFirst({
      where: { fileKey: key },
      select: { id: true, userId: true, shopId: true },
    });

    if (!job) return { error: 'File is not attached to a known job', status: 404 };
    if (!isAuthorizedForJob(user, job)) return { error: 'Not authorized for this file', status: 403 };
    return { job };
  }

  async function handleUpload(request, reply) {
    // Pull the first part from the multipart stream
    let data;
    try {
      data = await request.file();
    } catch {
      return reply.code(400).send({ error: ERROR_MESSAGES.no_file });
    }

    if (!data) {
      return reply.code(400).send({ error: ERROR_MESSAGES.no_file });
    }

    const originalName = data.filename || 'upload';
    const mimeType     = data.mimetype  || 'application/octet-stream';

    // Read entire stream into a buffer (multipart plugin streams by default)
    const chunks = [];
    for await (const chunk of data.file) chunks.push(chunk);
    const fileBuffer = Buffer.concat(chunks);

    // Validate type & size
    const validation = fileService.validateFile(originalName, fileBuffer.length);
    if (!validation.valid) {
      return reply.code(400).send({
        error: ERROR_MESSAGES[validation.error] || 'Invalid file.',
        code:  validation.error,
      });
    }

    // Upload to R2 (or local in dev)
    let uploadResult;
    try {
      uploadResult = await storage.upload(fileBuffer, originalName, mimeType);
    } catch (err) {
      fastify.log.error('Storage upload error:', err);
      return reply.code(500).send({ error: 'Failed to upload file. Please try again.' });
    }

    // Get page count (async, non-blocking for non-PDF)
    const ext       = fileService.getFileExtension(originalName);
    let pageCount   = 1;
    try {
      pageCount = await fileService.getPageCountSmart(fileBuffer, originalName);
    } catch {
      // Fallback — page count best-effort
    }

    return reply.code(201).send({
      key:       uploadResult.key,
      fileKey:   uploadResult.key,  // alias — used by print agent for URL refresh
      fileUrl:   uploadResult.url,
      fileName:  originalName,
      fileSize:  fileBuffer.length,
      fileType:  ext,
      mimeType,
      pageCount,
      driver:    storage.driver,   // "r2" or "local" — useful for debugging
    });
  }

  /**
   * POST /api/files/upload
   * Auth: any logged-in user
   * Body: multipart/form-data  field name = "file"
   * Returns: { fileUrl, fileName, fileSize, fileType, pageCount, key, driver }
   */
  fastify.post('/upload', {
    preHandler: [authenticate],
    config: { rateLimit: { max: 20, timeWindow: '1m' } },
  }, handleUpload);

  /**
   * POST /api/files/public-upload
   * Auth: public web checkout.
   * The uploaded key must still be attached to a paid job before shops/agents
   * can retrieve a refreshed signed URL.
   */
  fastify.post('/public-upload', {
    config: { rateLimit: { max: 10, timeWindow: '1m' } },
  }, handleUpload);

  /**
   * GET /api/files/presign?key=uploads/foo_abc123.pdf
   * Refreshes a 1-hour signed URL for an R2 object.
   * Useful when a stored URL has expired (print agent, dashboard preview).
   */
  fastify.get('/presign', {
    preHandler: [authenticate],
  }, async (request, reply) => {
    const { key } = request.query;
    if (!key) return reply.code(400).send({ error: 'key query param is required' });

    const authorization = await findAuthorizedJobByKey(key, request.user);
    if (authorization.error) {
      return reply.code(authorization.status).send({ error: authorization.error });
    }

    try {
      const url = await storage.getUrl(key);
      return { url, expiresIn: 3600 };
    } catch (err) {
      fastify.log.error('Presign error:', err);
      return reply.code(500).send({ error: 'Could not generate signed URL.' });
    }
  });

  /**
   * DELETE /api/files
   * Body: { key: string }
   * Deletes a file from storage. Restricted to shopkeeper/admin.
   */
  fastify.delete('/', {
    preHandler: [authenticate, requireRole(['shopkeeper', 'admin'])],
  }, async (request, reply) => {
    const { key } = request.body || {};
    if (!key) return reply.code(400).send({ error: 'key is required' });

    const authorization = await findAuthorizedJobByKey(key, request.user);
    if (authorization.error) {
      return reply.code(authorization.status).send({ error: authorization.error });
    }

    try {
      await storage.remove(key);
      return { success: true };
    } catch (err) {
      fastify.log.error('Storage delete error:', err);
      return reply.code(500).send({ error: 'Could not delete file.' });
    }
  });
}

module.exports = fileRoutes;

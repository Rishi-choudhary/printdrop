'use strict';

/**
 * IDLE state handler.
 *
 * Entry conditions (from dispatcher):
 *   - Fresh session, or session expired
 *   - User sent a /start or greeting
 *   - User sent a text without an in-flight job
 *
 * Happy path: user sent a file → download, detect pages, create draft Job,
 * transition to AWAITING_CHOICE.
 */

const path = require('path');
const fileService = require('../../../services/file');
const storage = require('../../../services/storage');
const shopService = require('../../../services/shop');
const prisma = require('../../../services/prisma');
const { setState, STATES } = require('../session');
const { send } = require('../send');
const M = require('../messages');
const config = require('../../../config');

async function handle(msg, user /*, session */) {
  if (msg.type === 'text') {
    return send(user.phone, user.name ? M.sendPdfPlease : M.welcome);
  }

  if (msg.type !== 'document' && msg.type !== 'image') {
    return send(user.phone, M.sendPdfPlease);
  }

  // ── Download + page count ────────────────────────────────────────────────
  let saved, pageCount;
  try {
    const headers = msg.metaFormat
      ? { Authorization: `Bearer ${config.whatsapp.apiKey}` }
      : {};

    if (msg.fileUrl) {
      // Pass inferred filename as hint so storage uses the correct extension
      saved = await fileService.downloadFile(msg.fileUrl, headers, msg.fileName);
    } else if (msg.fileId) {
      const resp = await fetch(`${config.whatsapp.apiUrl}/${msg.fileId}`, {
        headers: { Authorization: `Bearer ${config.whatsapp.apiKey}` },
      });
      const data = await resp.json();
      saved = await fileService.downloadFile(data.url, {
        Authorization: `Bearer ${config.whatsapp.apiKey}`,
      }, msg.fileName);
    } else {
      throw new Error('no file url or id');
    }

    pageCount = await resolvePageCount(saved, msg.fileName);
  } catch (err) {
    console.error('[bot-v2] file download failed', err.message);
    return send(user.phone, M.fileTooLargeOrInvalid);
  }

  // ── Pick a shop ──────────────────────────────────────────────────────────
  // MVP: first active shop. Multi-shop selection can land later as an extra
  // state or a reply like "pay at shop 2".
  const shop = await pickShop();
  if (!shop) return send(user.phone, M.shopUnavailable);

  // ── Create draft job ─────────────────────────────────────────────────────
  const job = await prisma.job.create({
    data: {
      userId: user.id,
      shopId: shop.id,
      fileUrl: saved.fileUrl || saved.url,
      fileKey: saved.key || null,
      fileName: msg.fileName,
      fileSize: saved.size || 0,
      fileType: fileService.getFileExtension(msg.fileName || ''),
      pageCount,
      token: 0,                          // assigned on payment
      pricePerPage: shop.ratesBwSingle ?? 2,
      totalPrice: 0,
      platformFee: 0,
      shopEarning: 0,
      status: 'pending',
      source: 'whatsapp',
    },
  });

  setState(user.phone, STATES.AWAITING_CHOICE, { pendingJobId: job.id });

  const prompt = user.name ? M.askChoice(msg.fileName, pageCount) : M.firstTimeGreeting(msg.fileName, pageCount);
  return send(user.phone, prompt, M.CHOICE_BUTTONS);
}

// ── helpers ─────────────────────────────────────────────────────────────────

async function resolvePageCount(saved, fileName) {
  const ext = fileService.getFileExtension(fileName || '');
  if (['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp'].includes(ext)) return 1;

  try {
    if (ext === 'pdf') {
      const localPath = path.join(config.upload.dir, path.basename(saved.key || ''));
      if (saved.key && require('fs').existsSync(localPath)) {
        return await fileService.getPageCount(localPath, 'pdf');
      }
      const buffer = await storage.download(saved.key);
      return await fileService.getPageCount(buffer, 'pdf');
    }
    if (['doc', 'docx', 'ppt', 'pptx'].includes(ext)) {
      const buffer = await storage.download(saved.key);
      return await fileService.getPageCountSmart(buffer, fileName);
    }
  } catch {
    // non-fatal — fall through to default
  }
  return 1;
}

async function pickShop() {
  const shops = await shopService.getActiveShops();
  if (!shops.length) return null;
  // Honor DEFAULT_SHOP_ID override if set
  if (process.env.DEFAULT_SHOP_ID) {
    const pinned = shops.find((s) => s.id === process.env.DEFAULT_SHOP_ID);
    if (pinned) return pinned;
  }
  return shops[0];
}

module.exports = { handle };

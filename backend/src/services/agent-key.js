'use strict';

const crypto = require('crypto');

function generateAgentKey() {
  return `agent_${crypto.randomBytes(32).toString('hex')}`;
}

function hashAgentKey(agentKey) {
  return crypto.createHash('sha256').update(String(agentKey || ''), 'utf8').digest('hex');
}

function hasAgentKey(shop) {
  return Boolean(shop?.agentKeyHash || shop?.agentKey);
}

function redactAgentKeyFields(shop) {
  if (!shop || typeof shop !== 'object') return shop;
  const { agentKey, agentKeyHash, ...safeShop } = shop;
  return { ...safeShop, hasAgentKey: Boolean(agentKeyHash || agentKey) };
}

function redactUserShop(user) {
  if (!user || typeof user !== 'object') return user;
  const { pinHash, ...safeUser } = user;
  if (!safeUser.shop) return safeUser;
  return { ...safeUser, shop: redactAgentKeyFields(safeUser.shop) };
}

async function findShopByAgentKey(prisma, agentKey, options = {}) {
  if (!agentKey) return null;

  const agentKeyHash = hashAgentKey(agentKey);
  const include = options.include;

  const shop = await prisma.shop.findUnique({
    where: { agentKeyHash },
    ...(include ? { include } : {}),
  });
  if (shop) return shop;

  // One-time compatibility path for old plaintext agent keys. On first use,
  // replace the plaintext key with its hash so future auth is hash-only.
  const legacyShop = await prisma.shop.findFirst({
    where: { agentKey },
    ...(include ? { include } : {}),
  });
  if (!legacyShop) return null;

  await prisma.shop.update({
    where: { id: legacyShop.id },
    data: { agentKey: null, agentKeyHash },
  });

  return { ...legacyShop, agentKey: null, agentKeyHash };
}

module.exports = {
  findShopByAgentKey,
  generateAgentKey,
  hashAgentKey,
  hasAgentKey,
  redactAgentKeyFields,
  redactUserShop,
};

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { hashAgentKey } = require('../../backend/src/services/agent-key');

const LEGACY_DEMO_AGENT_KEY = 'agent_demo_key_12345';

function normalizePhone(phone) {
  const value = String(phone || '').trim();
  return value.startsWith('+') ? value : `+${value}`;
}

function validatePin(name, pin) {
  if (!/^\d{6}$/.test(pin)) {
    throw new Error(`${name} must be exactly 6 digits`);
  }
}

function randomPin() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

function randomAgentKey() {
  return `agent_${crypto.randomBytes(32).toString('hex')}`;
}

async function upsertSeedUser(prisma, { phone, name, role, referralCode, pin, forcePinUpdate = false }) {
  const existing = await prisma.user.findUnique({ where: { phone } });
  const update = { role };
  const createdOrUpdatedCredentials = {};

  if (pin && (!existing?.pinHash || forcePinUpdate)) {
    update.pinHash = await bcrypt.hash(pin, 12);
    if (!forcePinUpdate) createdOrUpdatedCredentials.pin = pin;
  }

  const user = await prisma.user.upsert({
    where: { phone },
    update,
    create: {
      phone,
      name,
      role,
      referralCode,
      pinHash: pin ? await bcrypt.hash(pin, 12) : undefined,
    },
  });

  return { user, credentials: createdOrUpdatedCredentials };
}

async function seedDemoData(prisma, options = {}) {
  const adminPhone = normalizePhone(process.env.PRINTDROP_ADMIN_PHONE || '+919999999999');
  const shopkeeperPhone = normalizePhone(process.env.PRINTDROP_DEMO_SHOPKEEPER_PHONE || '+919876543210');
  const customerPhone = normalizePhone(process.env.PRINTDROP_DEMO_CUSTOMER_PHONE || '+919123456789');

  const adminPinFromEnv = Boolean(process.env.PRINTDROP_ADMIN_PIN);
  const shopkeeperPinFromEnv = Boolean(process.env.PRINTDROP_DEMO_SHOPKEEPER_PIN);
  const adminPin = process.env.PRINTDROP_ADMIN_PIN || options.generatedAdminPin || randomPin();
  const shopkeeperPin = process.env.PRINTDROP_DEMO_SHOPKEEPER_PIN || options.generatedShopkeeperPin || randomPin();

  validatePin('PRINTDROP_ADMIN_PIN', adminPin);
  validatePin('PRINTDROP_DEMO_SHOPKEEPER_PIN', shopkeeperPin);

  const { user: admin, credentials: adminCredentials } = await upsertSeedUser(prisma, {
    phone: adminPhone,
    name: 'Admin',
    role: 'admin',
    referralCode: 'ADMIN001',
    pin: adminPin,
    forcePinUpdate: adminPinFromEnv,
  });

  const { user: shopkeeper, credentials: shopkeeperCredentials } = await upsertSeedUser(prisma, {
    phone: shopkeeperPhone,
    name: 'Sharma Ji',
    role: 'shopkeeper',
    referralCode: 'SHARMA01',
    pin: shopkeeperPin,
    forcePinUpdate: shopkeeperPinFromEnv,
  });

  const existingShop = await prisma.shop.findUnique({ where: { phone: shopkeeperPhone } });
  const shouldRotateAgentKey =
    !existingShop?.agentKeyHash || existingShop.agentKey === LEGACY_DEMO_AGENT_KEY;
  const agentKey = shouldRotateAgentKey ? randomAgentKey() : null;

  const shop = await prisma.shop.upsert({
    where: { phone: shopkeeperPhone },
    update: shouldRotateAgentKey ? { agentKey: null, agentKeyHash: hashAgentKey(agentKey) } : {},
    create: {
      name: 'Sharma Print & Xerox',
      address: 'Shop #12, Near IIT Gate, Hauz Khas, New Delhi',
      phone: shopkeeperPhone,
      ownerId: shopkeeper.id,
      latitude: 28.5494,
      longitude: 77.2001,
      ratesBwSingle: 2,
      ratesBwDouble: 1.5,
      ratesColorSingle: 5,
      ratesColorDouble: 4,
      bindingCharge: 20,
      spiralCharge: 30,
      agentKeyHash: hashAgentKey(agentKey || randomAgentKey()),
      opensAt: '00:00',
      closesAt: '23:59',
    },
  });

  const customer = await prisma.user.upsert({
    where: { phone: customerPhone },
    update: { role: 'customer' },
    create: {
      phone: customerPhone,
      name: 'Rahul Student',
      role: 'customer',
      referralCode: 'RAHUL001',
    },
  });

  return {
    admin,
    shopkeeper,
    shop,
    customer,
    credentials: {
      adminPin: adminCredentials.pin || null,
      shopkeeperPin: shopkeeperCredentials.pin || null,
      agentKey: shouldRotateAgentKey ? agentKey : null,
    },
  };
}

module.exports = {
  LEGACY_DEMO_AGENT_KEY,
  normalizePhone,
  randomAgentKey,
  randomPin,
  seedDemoData,
  validatePin,
};

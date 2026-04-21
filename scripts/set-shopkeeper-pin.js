#!/usr/bin/env node
/**
 * Manually set (or reset) a shopkeeper's PIN.
 *
 * Usage:
 *   node scripts/set-shopkeeper-pin.js --phone +91XXXXXXXXXX --pin 123456
 *   node scripts/set-shopkeeper-pin.js --phone +91XXXXXXXXXX --pin 123456 --name "Ravi Stores"
 *
 * Options:
 *   --phone   Required. Phone in E.164 format (+91XXXXXXXXXX or 91XXXXXXXXXX).
 *   --pin     Required. Exactly 6 digits. Will be hashed before saving.
 *   --name    Optional. Sets/updates the user's display name.
 *   --force   Optional. If the user's role is currently 'customer', promote to 'shopkeeper'.
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

function parseArgs() {
  const args = process.argv.slice(2);
  const result = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      result[key] = args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : true;
    }
  }
  return result;
}

async function main() {
  const { phone, pin, name, force } = parseArgs();

  if (!phone || !pin) {
    console.error('Usage: node scripts/set-shopkeeper-pin.js --phone +91XXXXXXXXXX --pin 123456');
    process.exit(1);
  }

  if (!/^\d{6}$/.test(pin)) {
    console.error('Error: PIN must be exactly 6 digits.');
    process.exit(1);
  }

  const normalizedPhone = phone.startsWith('+') ? phone : `+${phone}`;

  const user = await prisma.user.findUnique({ where: { phone: normalizedPhone } });

  if (!user) {
    console.error(`Error: No user found with phone ${normalizedPhone}.`);
    console.error('Create the user first or check the phone number.');
    process.exit(1);
  }

  if (user.role === 'customer' && !force) {
    console.error(`Error: User ${normalizedPhone} has role 'customer'.`);
    console.error("Pass --force to promote them to 'shopkeeper' and set their PIN.");
    process.exit(1);
  }

  const pinHash = await bcrypt.hash(pin, 12);

  const updateData = { pinHash };
  if (name) updateData.name = name;
  if (user.role === 'customer' && force) updateData.role = 'shopkeeper';

  await prisma.user.update({
    where: { phone: normalizedPhone },
    data: updateData,
  });

  console.log(`✓ PIN set for ${normalizedPhone} (role: ${updateData.role || user.role})`);
  if (name) console.log(`  Name updated to: ${name}`);
  console.log('  PIN has been hashed and saved. Do not share it.');
}

main()
  .catch((err) => {
    console.error('Error:', err.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

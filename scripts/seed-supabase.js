#!/usr/bin/env node
/**
 * Seed Supabase database with admin user, demo shopkeeper, and demo shop.
 * Safe to run multiple times (uses upsert).
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const { PrismaClient } = require('@prisma/client');
const { seedDemoData } = require('./lib/demo-seed');
const prisma = new PrismaClient();

async function main() {
  console.log('  Seeding Supabase database...');

  const { admin, shopkeeper, shop, customer, credentials } = await seedDemoData(prisma);

  console.log(`  → Admin user: ${admin.id} (${admin.phone})`);
  console.log(`  → Shopkeeper: ${shopkeeper.id} (${shopkeeper.name})`);
  console.log(`  → Shop: ${shop.id} (${shop.name})`);
  console.log(`  → Customer: ${customer.id} (${customer.name})`);
  const showCredentials = process.env.PRINTDROP_SHOW_SEED_CREDENTIALS === '1';
  if (showCredentials) {
    if (credentials.adminPin) console.log(`  → Generated admin PIN: ${credentials.adminPin}`);
    if (credentials.shopkeeperPin) console.log(`  → Generated shopkeeper PIN: ${credentials.shopkeeperPin}`);
    if (credentials.agentKey) console.log(`  → Generated agent key: ${credentials.agentKey}`);
  } else if (credentials.adminPin || credentials.shopkeeperPin || credentials.agentKey) {
    console.log('  → Generated demo credentials; not printing secrets. Set explicit PIN env vars to rotate demo logins if needed.');
  }

  console.log('  Seed complete!');
}

main()
  .catch((e) => {
    console.error('  Seed error:', e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

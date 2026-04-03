#!/usr/bin/env node
/**
 * Seed Supabase database with admin user, demo shopkeeper, and demo shop.
 * Safe to run multiple times (uses upsert).
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('  Seeding Supabase database...');

  // 1. Admin user
  const admin = await prisma.user.upsert({
    where: { phone: '+919999999999' },
    update: { role: 'admin' },
    create: {
      phone: '+919999999999',
      name: 'Admin',
      role: 'admin',
      referralCode: 'ADMIN001',
    },
  });
  console.log(`  → Admin user: ${admin.id} (${admin.phone})`);

  // 2. Shopkeeper user
  const shopkeeper = await prisma.user.upsert({
    where: { phone: '+919876543210' },
    update: { role: 'shopkeeper' },
    create: {
      phone: '+919876543210',
      name: 'Sharma Ji',
      role: 'shopkeeper',
      referralCode: 'SHARMA01',
    },
  });
  console.log(`  → Shopkeeper: ${shopkeeper.id} (${shopkeeper.name})`);

  // 3. Demo shop
  const shop = await prisma.shop.upsert({
    where: { phone: '+919876543210' },
    update: {},
    create: {
      name: 'Sharma Print & Xerox',
      address: 'Shop #12, Near IIT Gate, Hauz Khas, New Delhi',
      phone: '+919876543210',
      ownerId: shopkeeper.id,
      latitude: 28.5494,
      longitude: 77.2001,
      ratesBwSingle: 2,
      ratesBwDouble: 1.5,
      ratesColorSingle: 5,
      ratesColorDouble: 4,
      bindingCharge: 20,
      spiralCharge: 30,
      agentKey: 'agent_demo_key_12345',
      opensAt: '00:00',
      closesAt: '23:59',
    },
  });
  console.log(`  → Shop: ${shop.id} (${shop.name})`);

  // 4. Demo customer
  const customer = await prisma.user.upsert({
    where: { phone: '+919123456789' },
    update: {},
    create: {
      phone: '+919123456789',
      name: 'Rahul Student',
      role: 'customer',
      referralCode: 'RAHUL001',
    },
  });
  console.log(`  → Customer: ${customer.id} (${customer.name})`);

  console.log('  Seed complete!');
}

main()
  .catch((e) => {
    console.error('  Seed error:', e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  // Create admin user
  const admin = await prisma.user.upsert({
    where: { phone: '+919999999999' },
    update: {},
    create: {
      phone: '+919999999999',
      name: 'Admin',
      role: 'admin',
      referralCode: 'ADMIN001',
    },
  });

  // Create demo shopkeeper
  const shopkeeper = await prisma.user.upsert({
    where: { phone: '+919876543210' },
    update: {},
    create: {
      phone: '+919876543210',
      name: 'Sharma Ji',
      role: 'shopkeeper',
      referralCode: 'SHARMA01',
    },
  });

  // Create demo shop
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
    },
  });

  // Create demo customer
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

  console.log('Seeded:', { admin, shopkeeper, shop, customer });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

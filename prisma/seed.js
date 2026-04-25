const { PrismaClient } = require('@prisma/client');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const { seedDemoData } = require('../scripts/lib/demo-seed');
const prisma = new PrismaClient();

async function main() {
  const { admin, shopkeeper, shop, customer, credentials } = await seedDemoData(prisma);

  console.log('Seeded demo data:', {
    admin: { id: admin.id, phone: admin.phone, role: admin.role },
    shopkeeper: { id: shopkeeper.id, phone: shopkeeper.phone, role: shopkeeper.role },
    shop: { id: shop.id, phone: shop.phone, name: shop.name },
    customer: { id: customer.id, phone: customer.phone, role: customer.role },
  });

  const showCredentials = process.env.PRINTDROP_SHOW_SEED_CREDENTIALS === '1';
  if (showCredentials) {
    if (credentials.adminPin) console.log(`Generated admin PIN: ${credentials.adminPin}`);
    if (credentials.shopkeeperPin) console.log(`Generated shopkeeper PIN: ${credentials.shopkeeperPin}`);
    if (credentials.agentKey) console.log(`Generated agent key: ${credentials.agentKey}`);
  } else if (credentials.adminPin || credentials.shopkeeperPin || credentials.agentKey) {
    console.log('Generated demo credentials; not printing secrets. Set explicit PIN env vars to rotate demo logins if needed.');
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

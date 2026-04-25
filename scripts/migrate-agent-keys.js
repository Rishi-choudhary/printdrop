#!/usr/bin/env node
'use strict';

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const { PrismaClient } = require('@prisma/client');
const { hashAgentKey } = require('../backend/src/services/agent-key');

const prisma = new PrismaClient();

async function main() {
  const shops = await prisma.shop.findMany({
    where: {
      agentKey: { not: null },
    },
    select: { id: true, agentKey: true, agentKeyHash: true },
  });

  let migrated = 0;
  for (const shop of shops) {
    if (!shop.agentKey) continue;
    await prisma.shop.update({
      where: { id: shop.id },
      data: {
        agentKey: null,
        agentKeyHash: shop.agentKeyHash || hashAgentKey(shop.agentKey),
      },
    });
    migrated++;
  }

  console.log(`Migrated ${migrated} plaintext agent key(s) to hashes.`);
}

main()
  .catch((err) => {
    console.error('Agent key migration failed:', err.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

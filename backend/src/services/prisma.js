const { PrismaClient } = require('@prisma/client');

// Generous transaction windows: Prisma's defaults (maxWait 2s, timeout 5s) are
// too tight through Supabase's transaction pooler and cause P2028
// "Transaction not found" on cold/contended connections.
const prisma = new PrismaClient({
  transactionOptions: {
    maxWait: 10000,
    timeout: 20000,
  },
});

module.exports = prisma;

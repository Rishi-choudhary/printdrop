const prisma = require('./prisma');
const { calculatePrice } = require('./pricing');

const STATUS_TRANSITIONS = {
  pending: ['payment_pending', 'cancelled'],
  payment_pending: ['queued', 'cancelled'],
  queued: ['printing', 'cancelled'],
  printing: ['ready', 'cancelled'],
  ready: ['picked_up'],
  picked_up: [],
  cancelled: ['queued'],
};

const STATUS_TIMESTAMP_MAP = {
  queued: 'paidAt',
  printing: 'printedAt',
  ready: 'readyAt',
  picked_up: 'pickedUpAt',
  cancelled: 'cancelledAt',
};

const MAX_TOKEN_RETRIES = 3;

async function createJob({
  userId, shopId, fileUrl, fileKey, fileName, fileSize, fileType,
  pageCount, color, copies, doubleSided, paperSize,
  pageRange, binding, source,
}) {
  const shop = await prisma.shop.findUnique({ where: { id: shopId } });
  if (!shop) throw new Error('Shop not found');

  const pricing = calculatePrice({
    shop,
    pageCount,
    pageRange,
    color,
    doubleSided,
    copies,
    binding,
  });

  // Use serializable transaction to prevent duplicate tokens
  for (let attempt = 0; attempt < MAX_TOKEN_RETRIES; attempt++) {
    try {
      const job = await prisma.$transaction(async (tx) => {
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);

        const lastJob = await tx.job.findFirst({
          where: { shopId, createdAt: { gte: todayStart } },
          orderBy: { token: 'desc' },
        });

        const token = (lastJob?.token || 0) + 1;

        return tx.job.create({
          data: {
            token,
            userId,
            shopId,
            fileUrl,
            fileKey: fileKey || null,
            fileName,
            fileSize: fileSize || 0,
            fileType: fileType || 'pdf',
            pageCount,
            color: color || false,
            copies: copies || 1,
            doubleSided: doubleSided || false,
            paperSize: paperSize || 'A4',
            pageRange: pageRange || 'all',
            binding: binding || 'none',
            pricePerPage: pricing.pricePerPage,
            totalPrice: pricing.total,
            platformFee: pricing.platformFee,
            shopEarning: pricing.shopEarning,
            status: 'pending',
            source: source || 'web',
          },
          include: { shop: true, user: true },
        });
      }, { isolationLevel: 'Serializable' });

      return { job, pricing };
    } catch (err) {
      // Retry on serialization failure (P2034) or unique constraint (P2002)
      if ((err.code === 'P2034' || err.code === 'P2002') && attempt < MAX_TOKEN_RETRIES - 1) {
        continue;
      }
      throw err;
    }
  }
}

async function updateJobStatus(jobId, newStatus, { printerId, printerName } = {}) {
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job) throw new Error('Job not found');

  const allowed = STATUS_TRANSITIONS[job.status];
  if (!allowed || !allowed.includes(newStatus)) {
    throw new Error(`Cannot transition from ${job.status} to ${newStatus}`);
  }

  const updateData = { status: newStatus };
  const tsField = STATUS_TIMESTAMP_MAP[newStatus];
  if (tsField) {
    updateData[tsField] = new Date();
  }

  // Record printer assignment when moving to printing
  if (newStatus === 'printing') {
    if (printerId) updateData.printerId = printerId;
    if (printerName) updateData.printerName = printerName;
  }

  return prisma.job.update({
    where: { id: jobId },
    data: updateData,
    include: { shop: true, user: true },
  });
}

async function getShopQueue(shopId, date) {
  const targetDate = date || new Date();
  const dayStart = new Date(targetDate);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(targetDate);
  dayEnd.setHours(23, 59, 59, 999);

  return prisma.job.findMany({
    where: {
      shopId,
      createdAt: { gte: dayStart, lte: dayEnd },
    },
    include: { user: true, payment: true },
    orderBy: { token: 'asc' },
  });
}

async function getJobsByUser(userId, limit = 20, offset = 0) {
  const [jobs, total] = await Promise.all([
    prisma.job.findMany({
      where: { userId },
      include: { shop: true, payment: true },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    }),
    prisma.job.count({ where: { userId } }),
  ]);

  return { jobs, total };
}

async function getJobByToken(shopId, token) {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  return prisma.job.findFirst({
    where: {
      shopId,
      token,
      createdAt: { gte: todayStart },
    },
    include: { user: true, payment: true },
  });
}

module.exports = {
  createJob,
  updateJobStatus,
  getShopQueue,
  getJobsByUser,
  getJobByToken,
};

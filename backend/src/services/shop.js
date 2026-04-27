const prisma = require('./prisma');
const { generateAgentKey, hashAgentKey } = require('./agent-key');

async function getActiveShops() {
  return prisma.shop.findMany({
    where: { isActive: true },
    include: { owner: { select: { id: true, name: true, phone: true } } },
    orderBy: { name: 'asc' },
  });
}

async function getShopById(shopId) {
  return prisma.shop.findUnique({
    where: { id: shopId },
    include: { owner: { select: { id: true, name: true, phone: true } } },
  });
}

function isShopOpen(shop) {
  const now = new Date();
  const currentDay = now.getDay(); // 0=Sunday

  let closedDays = [];
  try {
    closedDays = JSON.parse(shop.closedDays || '[]');
  } catch {
    closedDays = [];
  }

  if (closedDays.includes(currentDay)) return false;

  const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  return currentTime >= shop.opensAt && currentTime <= shop.closesAt;
}

async function createShop(data) {
  const agentKey = data.agentKey || generateAgentKey();
  return prisma.shop.create({
    data: {
      name: data.name,
      address: data.address,
      phone: data.phone,
      latitude: data.latitude,
      longitude: data.longitude,
      ownerId: data.ownerId,
      agentKeyHash: hashAgentKey(agentKey),
    },
    include: { owner: { select: { id: true, name: true, phone: true } } },
  });
}

async function updateShop(shopId, data) {
  return prisma.shop.update({
    where: { id: shopId },
    data,
    include: { owner: { select: { id: true, name: true, phone: true } } },
  });
}

async function updateShopRates(shopId, rates) {
  const allowed = [
    'ratesBwSingle', 'ratesBwDouble', 'ratesColorSingle',
    'ratesColorDouble', 'bindingCharge', 'spiralCharge',
  ];
  const updateData = {};
  for (const key of allowed) {
    if (rates[key] !== undefined) updateData[key] = parseFloat(rates[key]);
  }
  return prisma.shop.update({ where: { id: shopId }, data: updateData });
}

async function getAllShops() {
  return prisma.shop.findMany({
    include: { owner: { select: { id: true, name: true, phone: true } } },
    orderBy: { createdAt: 'desc' },
  });
}

async function getShopEarnings(shopId) {
  const now = new Date();

  // Time boundaries
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - now.getDay()); // Sunday
  startOfWeek.setHours(0, 0, 0, 0);

  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  // Aggregate shopEarning for picked_up jobs (actually earned)
  const [pickedUpJobs, lastSettlement] = await Promise.all([
    prisma.job.findMany({
      where: { shopId, status: 'picked_up' },
      select: { shopEarning: true, pickedUpAt: true },
    }),
    prisma.settlement.findFirst({
      where: { shopId },
      orderBy: { settledAt: 'desc' },
    }),
  ]);

  // Settled = jobs whose pickedUpAt is before the last settlement date
  const lastSettledAt = lastSettlement?.settledAt || null;
  const pendingJobs = lastSettledAt
    ? pickedUpJobs.filter((j) => !j.pickedUpAt || new Date(j.pickedUpAt) > lastSettledAt)
    : pickedUpJobs;

  const pendingSettlement = pendingJobs.reduce((s, j) => s + j.shopEarning, 0);
  const thisWeek = pickedUpJobs.filter((j) => j.pickedUpAt && new Date(j.pickedUpAt) >= startOfWeek).reduce((s, j) => s + j.shopEarning, 0);
  const thisMonth = pickedUpJobs.filter((j) => j.pickedUpAt && new Date(j.pickedUpAt) >= startOfMonth).reduce((s, j) => s + j.shopEarning, 0);
  const allTime = pickedUpJobs.reduce((s, j) => s + j.shopEarning, 0);

  // Next settlement is every Monday
  const nextMonday = new Date(now);
  const daysUntilMonday = (8 - now.getDay()) % 7 || 7;
  nextMonday.setDate(now.getDate() + daysUntilMonday);
  nextMonday.setHours(0, 0, 0, 0);

  return {
    pendingSettlement: Math.round(pendingSettlement * 100) / 100,
    lastSettledAmount: lastSettlement?.amount || 0,
    lastSettledAt: lastSettledAt?.toISOString() || null,
    nextSettlementDate: 'Every Monday',
    thisWeek: Math.round(thisWeek * 100) / 100,
    thisMonth: Math.round(thisMonth * 100) / 100,
    allTime: Math.round(allTime * 100) / 100,
  };
}

module.exports = {
  getActiveShops,
  getShopById,
  isShopOpen,
  createShop,
  updateShop,
  updateShopRates,
  getAllShops,
  getShopEarnings,
};

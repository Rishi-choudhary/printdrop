const prisma = require('./prisma');

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
  return prisma.shop.create({
    data: {
      name: data.name,
      address: data.address,
      phone: data.phone,
      latitude: data.latitude,
      longitude: data.longitude,
      ownerId: data.ownerId,
      agentKey: `agent_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`,
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

module.exports = {
  getActiveShops,
  getShopById,
  isShopOpen,
  createShop,
  updateShop,
  updateShopRates,
  getAllShops,
};

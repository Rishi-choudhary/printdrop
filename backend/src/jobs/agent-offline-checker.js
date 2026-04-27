const prisma = require('../services/prisma');
const { sendWhatsAppMessage } = require('../services/notification');

const CHECK_INTERVAL_MS = 2 * 60 * 1000;      // 2 minutes
const OFFLINE_THRESHOLD_MS = 2 * 60 * 1000;    // agent offline if no heartbeat for 2+ min
const ALERT_COOLDOWN_MS = 30 * 60 * 1000;       // don't re-alert within 30 min

function buildOfflineAlertText(shopName) {
  return `⚠️ PrintDrop Alert: Your desktop agent at *${shopName}* has gone offline.\nJobs are queuing up and won't print until the agent is back online.\nPlease check your shop computer.`;
}

async function checkAgents() {
  const now = new Date();
  const offlineThreshold = new Date(now - OFFLINE_THRESHOLD_MS);
  const cooldownThreshold = new Date(now - ALERT_COOLDOWN_MS);

  try {
    const shops = await prisma.shop.findMany({
      where: {
        isActive: true,
        agentLastSeen: { not: null, lt: offlineThreshold },
        OR: [
          { lastOfflineAlertAt: null },
          { lastOfflineAlertAt: { lt: cooldownThreshold } },
        ],
      },
    });

    for (const shop of shops) {
      try {
        const alertText = buildOfflineAlertText(shop.name);
        await sendWhatsAppMessage(shop.phone, alertText);
        await prisma.shop.update({
          where: { id: shop.id },
          data: { lastOfflineAlertAt: now },
        });
        console.log(`[agent-checker] Offline alert sent for shop: ${shop.name}`);
      } catch (err) {
        console.error(`[agent-checker] Failed to alert shop ${shop.id}:`, err.message);
      }
    }
  } catch (err) {
    console.error('[agent-checker] Check failed:', err.message);
  }
}

let _interval = null;

function start(logger) {
  _interval = setInterval(checkAgents, CHECK_INTERVAL_MS);
  _interval.unref();
  if (logger) logger.info('[agent-checker] Agent offline checker started (2-minute interval)');
}

function stop() {
  if (_interval) { clearInterval(_interval); _interval = null; }
}

module.exports = { start, stop, checkAgents };

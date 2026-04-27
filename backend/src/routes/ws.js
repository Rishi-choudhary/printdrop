const jwt = require('jsonwebtoken');
const config = require('../config');
const { parseCookies } = require('../services/session-cookie');

// shopId → Set<WebSocket>
const shopChannels = new Map();

function broadcastQueueUpdate(shopId) {
  const clients = shopChannels.get(shopId);
  if (!clients || clients.size === 0) return;
  const msg = JSON.stringify({ type: 'queue_update', shopId, ts: Date.now() });
  for (const ws of clients) {
    if (ws.readyState === 1 /* OPEN */) {
      try { ws.send(msg); } catch (_) {}
    }
  }
}

async function wsRoutes(fastify) {
  fastify.get('/ws/shop/:shopId', { websocket: true }, async (socket, request) => {
    const { shopId } = request.params;

    const cookies = parseCookies(request.headers.cookie);
    const token = cookies['pd_session'];
    if (!token) {
      socket.close(4001, 'Unauthorized');
      return;
    }

    let payload;
    try {
      payload = jwt.verify(token, config.jwtSecret);
    } catch {
      socket.close(4001, 'Unauthorized');
      return;
    }

    const user = await fastify.prisma.user.findUnique({
      where: { id: payload.userId },
      include: { shop: true },
    });

    if (!user || (user.role !== 'admin' && user.shop?.id !== shopId)) {
      socket.close(4003, 'Forbidden');
      return;
    }

    if (!shopChannels.has(shopId)) shopChannels.set(shopId, new Set());
    const clients = shopChannels.get(shopId);
    clients.add(socket);

    try { socket.send(JSON.stringify({ type: 'connected', shopId })); } catch (_) {}

    socket.on('close', () => {
      clients.delete(socket);
      if (clients.size === 0) shopChannels.delete(shopId);
    });
  });
}

module.exports = { wsRoutes, broadcastQueueUpdate };

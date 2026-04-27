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
  // @fastify/websocket v8 (Fastify v4): handler receives (connection, request)
  // connection.socket is the underlying WebSocket
  fastify.get('/ws/shop/:shopId', { websocket: true }, async (connection, request) => {
    const ws = connection.socket;
    const { shopId } = request.params;

    const cookies = parseCookies(request.headers.cookie);
    const token = cookies['pd_session'];
    if (!token) {
      ws.close(4001, 'Unauthorized');
      return;
    }

    let payload;
    try {
      payload = jwt.verify(token, config.jwtSecret);
    } catch {
      ws.close(4001, 'Unauthorized');
      return;
    }

    const user = await fastify.prisma.user.findUnique({
      where: { id: payload.userId },
      include: { shop: true },
    });

    if (!user || (user.role !== 'admin' && user.shop?.id !== shopId)) {
      ws.close(4003, 'Forbidden');
      return;
    }

    if (!shopChannels.has(shopId)) shopChannels.set(shopId, new Set());
    const clients = shopChannels.get(shopId);
    clients.add(ws);

    try { ws.send(JSON.stringify({ type: 'connected', shopId })); } catch (_) {}

    ws.on('close', () => {
      clients.delete(ws);
      if (clients.size === 0) shopChannels.delete(shopId);
    });
  });
}

module.exports = { wsRoutes, broadcastQueueUpdate };

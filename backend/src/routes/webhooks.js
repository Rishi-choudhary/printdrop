const crypto = require('crypto');
const paymentService = require('../services/payment');
const { handleWebhook: handleWhatsAppWebhook, verifyWebhookSignature: verifyWhatsApp } = require('../bot/whatsapp');
const botV2 = require('../bot/v2');
const { notifyUser, notifyTokenIssued } = require('../services/notification');
const messages = require('../bot/messages');
const config = require('../config');

// Track last WhatsApp webhook receipt time — used by /health endpoint to detect
// silent webhook outages (Gupshup stops delivering without any error).
let lastWhatsAppWebhookAt = null;

function getWebhookHealth() {
  const staleThresholdMs = 60 * 60 * 1000; // 1 hour with no webhook = stale
  return {
    lastWhatsAppWebhook: lastWhatsAppWebhookAt
      ? new Date(lastWhatsAppWebhookAt).toISOString()
      : null,
    whatsAppWebhookStale: lastWhatsAppWebhookAt
      ? Date.now() - lastWhatsAppWebhookAt > staleThresholdMs
      : true,
  };
}

async function webhookRoutes(fastify) {
  // POST /webhooks/whatsapp — WhatsApp incoming messages (Gupshup / Meta Cloud API)
  // Gupshup does not send HMAC signatures; verification relies on a secret URL token
  // or IP whitelisting configured in the Gupshup dashboard.
  fastify.post('/whatsapp', async (request, reply) => {
    // Accept token from any of the common header names
    const signature =
      request.headers['x-gupshup-token'] ||
      request.headers['x-hub-signature-256'] ||
      request.headers['x-hub-signature'] ||
      request.headers['x-wati-signature'] || '';

    if (!verifyWhatsApp(request.body, signature)) {
      return reply.code(401).send({ error: 'Invalid signature' });
    }

    // Record receipt time for health monitoring
    lastWhatsAppWebhookAt = Date.now();

    // Process asynchronously so Gupshup gets a fast 200 OK
    handleWhatsAppWebhook(request.body).catch((err) => {
      console.error('WhatsApp webhook processing error:', err);
    });

    return { status: 'ok' };
  });

  // GET /webhooks/whatsapp — webhook verification (Meta requires this)
  fastify.get('/whatsapp', async (request, reply) => {
    const mode = request.query['hub.mode'];
    const token = request.query['hub.verify_token'];
    const challenge = request.query['hub.challenge'];

    if (mode === 'subscribe' && token === config.whatsapp.webhookSecret) {
      return reply.code(200).send(challenge);
    }
    return reply.code(403).send({ error: 'Forbidden' });
  });

  // POST /webhooks/razorpay — payment confirmation via server-side webhook
  // Fastify parses the JSON body by default. We need the raw body bytes for
  // HMAC-SHA256 signature verification. We store the raw body in addContentTypeParser
  // via rawBody set during parsing (registered in index.js via addRawBody plugin or
  // alternatively we verify against the stringified parsed body when no raw body is
  // available, which is acceptable since Fastify does not mutate JSON fields).
  fastify.post('/razorpay', {
    config: { rawBody: true },
  }, async (request, reply) => {
    const signature = request.headers['x-razorpay-signature'] || '';

    // Use raw body string for HMAC verification if available (added via rawBody config),
    // otherwise fall back to deterministic JSON.stringify of the parsed body.
    const rawBody = request.rawBody
      || (typeof request.body === 'string' ? request.body : JSON.stringify(request.body));

    if (!paymentService.verifyWebhookSignature(rawBody, signature)) {
      return reply.code(401).send({ error: 'Invalid signature' });
    }

    const event = request.body.event;
    const payload = request.body.payload || {};

    try {
      if (event === 'payment_link.paid' || event === 'payment.captured') {
        const razorpayPaymentId = payload.payment?.entity?.id;
        // For payment_link.paid the link id lives in payload.payment_link.entity.id
        // For payment.captured the link id may appear in payment entity notes or be absent
        const razorpayPaymentLinkId =
          payload.payment_link?.entity?.id ||
          payload.payment?.entity?.payment_link_id ||
          null;

        const { payment, justPaid } = await paymentService.handlePaymentSuccess(
          razorpayPaymentId,
          razorpayPaymentLinkId,
        );

        // Only notify if this call actually marked it paid (avoid double-notifying)
        if (payment && justPaid) {
          const job = await fastify.prisma.job.findUnique({
            where: { id: payment.jobId },
            include: { shop: true },
          });

          if (job) {
            // Use template-aware notification so this works even outside the 24h session window
            notifyTokenIssued(job.userId, job.token, job.shop.name).catch(
              (err) => console.error('[webhook] notifyTokenIssued failed:', err.message),
            );
            if (botV2.isEnabled()) botV2.clearSessionForJob(job.id).catch(() => {});
          }
        }
      } else if (event === 'payment.failed' || event === 'payment_link.expired' || event === 'payment_link.cancelled') {
        const razorpayPaymentId = payload.payment?.entity?.id;
        // Include payment link id so handlePaymentFailed can find the record even
        // when razorpayPaymentId is not yet stored (link-based flow).
        const razorpayPaymentLinkId =
          payload.payment_link?.entity?.id ||
          payload.payment?.entity?.payment_link_id ||
          null;

        const payment = await paymentService.handlePaymentFailed(razorpayPaymentId, razorpayPaymentLinkId);

        if (payment) {
          const failMsg = event === 'payment_link.expired'
            ? { text: 'Your payment link expired. Send /start to create a new order.' }
            : messages.errorMessage('payment_failed');
          notifyUser(payment.userId, failMsg).catch(
            (err) => console.error('[webhook] notifyUser (failed) error:', err.message),
          );
        }
      }
    } catch (err) {
      // Return 200 to prevent Razorpay retry storms for deterministic errors
      // (e.g. missing DB record, bad jobId). The error is logged; investigate manually.
      console.error('Razorpay webhook error:', { event, error: err.message, stack: err.stack });
      return { status: 'error_logged', message: err.message };
    }

    return { status: 'ok' };
  });

  // POST /webhooks/razorpay/callback — called by frontend after Razorpay redirects user
  // This is a safety net: if the webhook fires before the redirect, justPaid=false and
  // no duplicate notification is sent. If the webhook hasn't fired yet, this processes it.
  fastify.post('/razorpay/callback', async (request, reply) => {
    const {
      razorpay_payment_id,
      razorpay_payment_link_id,
      razorpay_payment_link_reference_id,
      razorpay_payment_link_status,
      razorpay_signature,
      job_id,
    } = request.body;

    // Verify Razorpay callback signature
    // Signature = HMAC-SHA256 of "{link_id}|{ref_id}|{status}|{payment_id}" with key_secret
    if (!razorpay_signature || !config.razorpay.keySecret) {
      return reply.code(400).send({ error: 'Missing payment signature configuration' });
    }

    if (razorpay_payment_link_status !== 'paid') {
      return reply.code(400).send({ error: 'Payment is not marked paid' });
    }

    if (razorpay_signature && config.razorpay.keySecret) {
      const body = `${razorpay_payment_link_id}|${razorpay_payment_link_reference_id}|${razorpay_payment_link_status}|${razorpay_payment_id}`;
      const expected = crypto
        .createHmac('sha256', config.razorpay.keySecret)
        .update(body)
        .digest('hex');

      const expectedBuffer = Buffer.from(expected, 'hex');
      const actualBuffer = Buffer.from(razorpay_signature, 'hex');
      if (expectedBuffer.length !== actualBuffer.length || !crypto.timingSafeEqual(expectedBuffer, actualBuffer)) {
        return reply.code(400).send({ error: 'Invalid payment signature' });
      }
    }

    try {
      const { payment, justPaid } = await paymentService.handlePaymentSuccess(
        razorpay_payment_id,
        razorpay_payment_link_id,
      );

      const job = await fastify.prisma.job.findUnique({
        where: { id: payment.jobId },
        include: { shop: true },
      });

      // Send notification only if not already sent by the webhook
      if (job && justPaid) {
        await notifyTokenIssued(job.userId, job.token, job.shop.name).catch(
          (err) => console.error('Notification error:', err),
        );
        if (botV2.isEnabled()) botV2.clearSessionForJob(job.id).catch(() => {});
      }

      return {
        ok: true,
        token: job?.token,
        shopName: job?.shop?.name,
        fileName: job?.fileName,
        status: job?.status,
      };
    } catch (err) {
      console.error('Razorpay callback error:', err);
      return reply.code(500).send({ error: err.message });
    }
  });

  // GET /webhooks/razorpay/job/:jobId — public: get job + payment details (no auth needed)
  // Used by the payment page to show order info and payment link, and by the success page for the token
  fastify.get('/razorpay/job/:jobId', async (request, reply) => {
    const job = await fastify.prisma.job.findUnique({
      where: { id: request.params.jobId },
      select: {
        id: true,
        token: true,
        status: true,
        fileName: true,
        pageCount: true,
        copies: true,
        color: true,
        doubleSided: true,
        paperSize: true,
        totalPrice: true,
        shop: { select: { name: true } },
        payment: { select: { razorpayPaymentLink: true, status: true } },
      },
    });

    if (!job) return reply.code(404).send({ error: 'Job not found' });

    return job;
  });

  // POST /webhooks/razorpay/checkout-order — create a Razorpay order for Standard Checkout
  // Called by the frontend /pay/[jobId] page before opening the checkout.js modal.
  fastify.post('/razorpay/checkout-order', async (request, reply) => {
    const { job_id, order_id } = request.body || {};

    if (!job_id && !order_id) {
      return reply.code(400).send({ error: 'job_id or order_id is required' });
    }

    try {
      const result = await paymentService.createCheckoutOrder({
        jobId: job_id,
        orderId: order_id,
      });
      return result;
    } catch (err) {
      if (err.message.includes('not found')) return reply.code(404).send({ error: err.message });
      if (err.message.includes('not configured')) return reply.code(503).send({ error: err.message });
      if (err.message.includes('already completed') || err.message.includes('Cannot create')) {
        return reply.code(409).send({ error: err.message });
      }
      console.error('[checkout-order] error:', err);
      return reply.code(500).send({ error: 'Failed to create payment order' });
    }
  });

  // POST /webhooks/razorpay/verify-checkout — verify Standard Checkout payment signature
  // Called by the frontend after Razorpay modal fires handler(response).
  // Verifies HMAC-SHA256(order_id + "|" + payment_id, KEY_SECRET), then marks payment paid.
  fastify.post('/razorpay/verify-checkout', async (request, reply) => {
    const {
      razorpay_payment_id,
      razorpay_order_id,
      razorpay_signature,
    } = request.body || {};

    if (!razorpay_payment_id || !razorpay_order_id || !razorpay_signature) {
      return reply.code(400).send({ error: 'Missing required payment fields' });
    }

    if (!config.razorpay.keySecret) {
      return reply.code(500).send({ error: 'Payment verification not configured' });
    }

    const message = `${razorpay_order_id}|${razorpay_payment_id}`;
    const expected = crypto
      .createHmac('sha256', config.razorpay.keySecret)
      .update(message)
      .digest('hex');

    const expectedBuf = Buffer.from(expected, 'hex');
    let actualBuf;
    try {
      actualBuf = Buffer.from(razorpay_signature, 'hex');
    } catch {
      return reply.code(400).send({ error: 'Invalid signature format' });
    }

    if (
      expectedBuf.length !== actualBuf.length ||
      !crypto.timingSafeEqual(expectedBuf, actualBuf)
    ) {
      return reply.code(400).send({ error: 'Payment signature verification failed' });
    }

    try {
      const { payment, justPaid } = await paymentService.handlePaymentSuccess(
        razorpay_payment_id,
        razorpay_order_id,
      );

      let token, shopName, fileName, status;

      if (payment.jobId) {
        const job = await fastify.prisma.job.findUnique({
          where: { id: payment.jobId },
          include: { shop: true },
        });
        if (job) {
          token = job.token;
          shopName = job.shop?.name;
          fileName = job.fileName;
          status = job.status;
          if (justPaid) {
            notifyTokenIssued(job.userId, job.token, job.shop.name).catch(
              (err) => console.error('[verify-checkout] notifyTokenIssued failed:', err.message),
            );
            if (botV2.isEnabled()) botV2.clearSessionForJob(job.id).catch(() => {});
          }
        }
      } else if (payment.orderId) {
        const order = await fastify.prisma.order.findUnique({
          where: { id: payment.orderId },
          include: { jobs: { take: 1, include: { shop: true } } },
        });
        if (order) {
          token = order.token;
          shopName = order.jobs[0]?.shop?.name;
          status = order.status;
        }
      }

      return { ok: true, token, shopName, fileName, status };
    } catch (err) {
      console.error('[verify-checkout] error:', err);
      return reply.code(500).send({ error: err.message });
    }
  });

  // POST /webhooks/razorpay/mock — dev-only: simulate payment success
  if (process.env.NODE_ENV !== 'production') {
    fastify.post('/razorpay/mock', async (request, reply) => {
      const { jobId } = request.body;

      const payment = await fastify.prisma.payment.findFirst({
        where: { jobId },
      });

      if (!payment) return reply.code(404).send({ error: 'Payment not found' });

      const { payment: result, justPaid } = await paymentService.handlePaymentSuccess(
        `mock_pay_${Date.now()}`,
        payment.razorpayOrderId,
      );

      const job = await fastify.prisma.job.findUnique({
        where: { id: jobId },
        include: { shop: true },
      });

      if (job && justPaid) {
        try {
          await notifyTokenIssued(job.userId, job.token, job.shop.name);
        } catch (err) {
          console.error('Notification error:', err);
        }
      }

      return { status: 'ok', token: job?.token, shopName: job?.shop?.name };
    });
  }
}

module.exports = webhookRoutes;
module.exports.getWebhookHealth = getWebhookHealth;

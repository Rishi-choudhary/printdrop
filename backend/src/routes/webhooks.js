const crypto = require('crypto');
const paymentService = require('../services/payment');
const { handleWebhook: handleWhatsAppWebhook, verifyWebhookSignature: verifyWhatsApp } = require('../bot/whatsapp');
const { notifyUser } = require('../services/notification');
const messages = require('../bot/messages');
const config = require('../config');

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
  fastify.post('/razorpay', async (request, reply) => {
    const signature = request.headers['x-razorpay-signature'] || '';

    const rawBody = typeof request.body === 'string' ? request.body : JSON.stringify(request.body);
    if (!paymentService.verifyWebhookSignature(rawBody, signature)) {
      return reply.code(401).send({ error: 'Invalid signature' });
    }

    const event = request.body.event;
    const payload = request.body.payload;

    try {
      if (event === 'payment_link.paid' || event === 'payment.captured') {
        const paymentEntity = payload.payment?.entity || payload.payment_link?.entity;
        const razorpayPaymentId = paymentEntity?.id || payload.payment?.entity?.id;
        const razorpayPaymentLinkId = payload.payment_link?.entity?.id;

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
            await notifyUser(job.userId, messages.tokenMessage(job.token, job.shop.name, 10));
          }
        }
      } else if (event === 'payment.failed') {
        const razorpayPaymentId = payload.payment?.entity?.id;
        const payment = await paymentService.handlePaymentFailed(razorpayPaymentId);

        if (payment) {
          await notifyUser(payment.userId, messages.errorMessage('payment_failed'));
        }
      }
    } catch (err) {
      console.error('Razorpay webhook error:', err);
      return reply.code(500).send({ error: 'Processing error' });
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
    if (razorpay_signature && config.razorpay.keySecret) {
      const body = `${razorpay_payment_link_id}|${razorpay_payment_link_reference_id}|${razorpay_payment_link_status}|${razorpay_payment_id}`;
      const expected = crypto
        .createHmac('sha256', config.razorpay.keySecret)
        .update(body)
        .digest('hex');

      if (expected !== razorpay_signature) {
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

      // Send Telegram notification only if not already sent by the webhook
      if (job && justPaid) {
        await notifyUser(job.userId, messages.tokenMessage(job.token, job.shop.name, 10)).catch(
          (err) => console.error('Notification error:', err),
        );
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
          await notifyUser(job.userId, messages.tokenMessage(job.token, job.shop.name, 10));
        } catch (err) {
          console.error('Notification error:', err);
        }
      }

      return { status: 'ok', token: job?.token, shopName: job?.shop?.name };
    });
  }
}

module.exports = webhookRoutes;

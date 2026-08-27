const router = require('express').Router();
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const asyncHandler = require('../utils/asyncHandler');
const { refs } = require('../config/firebase');
const { reportError } = require('../utils/reportError');

router.use('/auth',     require('./auth.routes'));
router.use('/tokens',   require('./token.routes'));
router.use('/patients', require('./patient.routes'));
router.use('/admin',    require('./admin.routes'));
router.use('/staff',    require('./staff.routes'));
router.use('/assistant', require('./assistant.routes'));
router.use(require('./messaging.routes')); // /conversations, /directory (per-route auth)
router.use(require('./share.routes'));     // /shares (auth), /share/:id (public capability)
router.use(require('./upload.routes'));    // /uploads (auth) — RTDB-backed shared files

router.post('/feedback', asyncHandler(require('../controllers/feedback.controller').submitFeedback));

// Public: browser error beacon (global handler + ErrorBoundary post here).
const clientErrorLimiter = rateLimit({
  windowMs: 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
});
router.post('/client-error', clientErrorLimiter, (req, res) => {
  const { message, stack, url, componentStack } = req.body || {};
  reportError({
    source: 'frontend',
    message: String(message || 'client error').slice(0, 500),
    stack: [stack, componentStack].filter(Boolean).join('\n---\n'),
    context: { url: String(url || '').slice(0, 300), ua: String(req.get('user-agent') || '').slice(0, 200) },
  });
  res.status(204).end();
});

router.get('/config', asyncHandler(async (req, res) => {
  const queueAdminService = require('../services/queueAdmin.service');
  const analyticsService = require('../services/analytics.service');
  const config = require('../config/env');
  const [snap, activeQueues, stats] = await Promise.all([
    refs.appConfig().once('value'),
    queueAdminService.getActiveQueues().catch(() => []),
    analyticsService.getTrafficStats().catch(() => ({})),
  ]);
  const cfg = snap.val() || { industry: 'general', orgName: 'QueueLess' };
  // Live average service time (observed waits when available, configured
  // default otherwise) so customer-facing wait previews are never static.
  const avgServiceSeconds = Math.round(
    (stats.avgWaitSeconds > 0 ? stats.avgWaitSeconds : config.queue.avgServiceTimeSeconds) || 180
  );
  // Custom queues (admin-defined) take precedence over the static industry
  // profile on the frontend; empty array means "fall back to industry defaults".
  res.json({ ...cfg, queues: activeQueues, avgServiceSeconds });
}));

// Public: live announcement (used by display board + customer pages)
router.get('/announcement', asyncHandler(async (req, res) => {
  const snap = await refs.announcement().once('value');
  res.json(snap.val() || null);
}));

// Public: book appointment
router.post('/appointments', asyncHandler(async (req, res) => {
  const { name, service, date, timeSlot, phone, email } = req.body;
  if (!name?.trim() || !service || !date || !timeSlot) {
    return res.status(400).json({ error: 'name, service, date, and timeSlot are required.' });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'date must be in YYYY-MM-DD format.' });
  }
  if (!/^\d{2}:\d{2}$/.test(timeSlot)) {
    return res.status(400).json({ error: 'timeSlot must be in HH:MM format.' });
  }
  const id = crypto.randomUUID();
  const record = {
    id, name: name.trim(), service, date, timeSlot,
    phone: phone?.trim() || null,
    email: email?.trim() || null,
    bookedAt: Date.now(),
    status: 'pending',
    note: null,
  };
  await refs.appointment(id).set(record);
  res.status(201).json(record);
}));

router.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'queueless-backend', timestamp: new Date().toISOString() });
});

module.exports = router;

const router = require('express').Router();
const Joi = require('joi');
const { refs } = require('../config/firebase');
const { requireStaff } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { isAdminTier } = require('../config/roles');
const asyncHandler = require('../utils/asyncHandler');
const { publicToken } = require('../utils/publicToken');

async function snapshot(user) {
  const [state, tokens, announcement] = await Promise.all([
    refs.queueState().once('value'), refs.tokens().once('value'), refs.announcement().once('value'),
  ]);
  const rows = Object.entries(tokens.val() || {}).map(([id, token]) => [id,
    user && (isAdminTier(user.role) || token.service === user.service) ? token : publicToken(token),
  ]);
  return { state: state.val(), tokens: Object.fromEntries(rows), announcement: announcement.val() };
}

router.get('/queue/public', asyncHandler(async (_req, res) => res.json(await snapshot(null))));
router.get('/queue/live', requireStaff, asyncHandler(async (req, res) => res.json(await snapshot(req.user))));
router.post('/presence', requireStaff, validate(Joi.object({ online: Joi.boolean().required() })),
  asyncHandler(async (req, res) => {
    await refs.presenceMember(req.user.sub).set({
      username: req.user.sub, service: req.user.service || 'admin',
      online: req.body.online, lastSeen: Date.now(),
    });
    res.status(204).end();
  }));

module.exports = router;

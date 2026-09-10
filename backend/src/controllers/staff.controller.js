const staffService = require('../services/staff.service');
const queueService = require('../services/queue.service');
const { refs } = require('../config/firebase');
const { isAdminTier } = require('../config/roles');
const { publicToken } = require('../utils/publicToken');

async function checkTokenAccess(req) {
  const token = (await refs.token(req.params.tokenId).once('value')).val();
  if (!token) throw Object.assign(new Error('Token not found.'), { statusCode: 404 });
  if (!isAdminTier(req.user.role) && token.service !== req.user.service) {
    throw Object.assign(new Error('Token belongs to another department.'), { statusCode: 403 });
  }
}


async function login(req, res) {
  const { username, password } = req.body;
  const result = await staffService.loginStaff(username, password);
  res.json(result);
}

async function loginPin(req, res) {
  const { pin } = req.body;
  const result = await staffService.loginByPin(pin);
  res.json(result);
}

async function getQueue(req, res) {
  const data = await queueService.getActiveQueue();
  if (!isAdminTier(req.user.role)) {
    const visible = token => token.service === req.user.service ? token : publicToken(token);
    data.waiting = data.waiting.map(visible);
    data.nowServing = Object.fromEntries(Object.entries(data.nowServing).map(([key, token]) => [key, visible(token)]));
  }
  res.json(data);
}

async function callNext(req, res) {
  const service = req.user.service;
  if (!service) {
    return res.status(400).json({ error: 'No service assigned to this account.' });
  }
  // OPD doctors each run a room and are served their own assigned patients.
  const assignedTo = service === 'opd' ? req.user.sub : null;
  const result = await queueService.callNextToken(service, req.user.sub, { assignedTo });
  res.json(result);
}

async function getProfile(req, res) {
  const profile = await staffService.getStaffProfile(req.user.sub);
  res.json(profile);
}

async function updateProfile(req, res) {
  const result = await staffService.updateStaffProfile(req.user.sub, req.body);
  res.json({ message: 'Profile updated.', ...result });
}

async function changePassword(req, res) {
  const { currentPassword, newPassword } = req.body;
  await staffService.changeStaffPassword(req.user.sub, currentPassword, newPassword);
  res.json({ message: 'Password updated successfully.' });
}

async function referToken(req, res) {
  await checkTokenAccess(req);
  const { tokenId } = req.params;
  const { toService, reason } = req.body || {};
  const result = await queueService.referToken(tokenId, {
    toService,
    reason: reason || null,
    byStaff: req.user.sub,
  });
  res.json({ message: `Token #${result.referred.number} referred to "${result.to}".`, ...result });
}

async function setTokenNote(req, res) {
  await checkTokenAccess(req);
  const { tokenId } = req.params;
  const { note } = req.body;
  const snap = await refs.token(tokenId).once('value');
  if (!snap.exists()) throw Object.assign(new Error('Token not found.'), { statusCode: 404 });
  await refs.token(tokenId).update({ note: note?.trim() || null });
  res.json({ message: 'Note saved.' });
}

module.exports = { login, loginPin, getQueue, callNext, getProfile, updateProfile, changePassword, setTokenNote, referToken };

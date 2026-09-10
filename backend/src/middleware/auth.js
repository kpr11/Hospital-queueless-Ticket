const authService = require('../services/auth.service');
const { refs } = require('../config/firebase');
const asyncHandler = require('../utils/asyncHandler');
const { isAdminTier, atLeast } = require('../config/roles');

async function extractPayload(req, res) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    res.status(401).json({ error: 'Missing or malformed Authorization header. Expected: Bearer <token>.' });
    return null;
  }

  try {
    const payload = authService.verifyToken(token);
    const accountRef = payload.role === 'staff' ? refs.staffMember(payload.sub) : refs.admin(payload.sub);
    const account = (await accountRef.once('value')).val();
    if (!account || (payload.sessionVersion || 0) !== (account.passwordResetAt || 0)) {
      res.status(401).json({ error: 'Session revoked. Please sign in again.' });
      return null;
    }
    return { ...payload, role: payload.role === 'staff' ? 'staff' :
      (atLeast(account.role || 'admin', payload.role) ? payload.role : account.role || 'admin'),
      service: account.service, displayName: account.displayName || payload.sub };
  } catch (err) {
    const reason = err.name === 'TokenExpiredError' ? 'Token expired.' : 'Invalid token.';
    res.status(401).json({ error: reason });
    return null;
  }
}

// Admin area: any admin-tier role (superadmin / admin / manager).
const requireAdmin = asyncHandler(async (req, res, next) => {
  const payload = await extractPayload(req, res);
  if (!payload) return;
  if (!isAdminTier(payload.role)) return res.status(403).json({ error: 'Forbidden - admin access required.' });
  req.user = payload;
  next();
});

// Admin-tier OR staff (used for shared features like messaging).
const requireStaff = asyncHandler(async (req, res, next) => {
  const payload = await extractPayload(req, res);
  if (!payload) return;
  if (!(isAdminTier(payload.role) || payload.role === 'staff')) return res.status(403).json({ error: 'Forbidden.' });
  req.user = payload;
  next();
});

// Require a minimum admin-tier role (e.g. 'admin' for account management,
// 'superadmin' for role changes).
function requireRole(minRole) {
  return asyncHandler(async (req, res, next) => {
    const payload = await extractPayload(req, res);
    if (!payload) return;
    if (!isAdminTier(payload.role) || !atLeast(payload.role, minRole)) {
      return res.status(403).json({ error: `Forbidden - ${minRole} role or higher required.` });
    }
    req.user = payload;
    next();
  });
}

module.exports = { requireAdmin, requireStaff, requireRole };

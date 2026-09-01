const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const config = require('../config/env');
const { refs } = require('../config/firebase');
const { ROLES } = require('../config/roles');

const BCRYPT_ROUNDS = 10;

async function bootstrapAdmin() {
  const { username, password, resetOnBoot } = config.bootstrapAdmin;
  const snap = await refs.admin(username).once('value');
  if (snap.exists()) {
    const patch = {};
    // Ensure the env-configured owner account is always a superadmin.
    if (snap.val().role !== ROLES.SUPERADMIN) patch.role = ROLES.SUPERADMIN;
    // Break-glass password recovery (ADMIN_RESET_ON_BOOT=true).
    if (resetOnBoot) {
      patch.passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
      console.warn(`[auth] ADMIN_RESET_ON_BOOT is set — password for "${username}" reset to ADMIN_PASSWORD. Turn this off and redeploy.`);
    }
    if (Object.keys(patch).length > 0) {
      await refs.admin(username).update(patch);
      if (patch.role) console.log(`[auth] Promoted bootstrap admin "${username}" to superadmin.`);
    } else {
      console.log(`[auth] Admin "${username}" already exists - skipping bootstrap.`);
    }
    return;
  }
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  await refs.admin(username).set({
    username,
    passwordHash,
    createdAt: Date.now(),
    role: ROLES.SUPERADMIN,
  });
  console.log(`[auth] Bootstrapped superadmin account "${username}".`);
}

async function login(username, password) {
  const snap = await refs.admin(username).once('value');
  const account = snap.val();

  // Run bcrypt.compare against a dummy hash even when the username doesn't exist
  // so response time is constant — prevents user enumeration via timing.
  const dummyHash = '$2a$10$abcdefghijklmnopqrstuuW2j7n5p9LK0L1PZmQDqfyV5bKzN6eLm';
  const hash = account?.passwordHash || dummyHash;
  const ok = await bcrypt.compare(password, hash);

  if (!account || !ok) {
    const err = new Error('Invalid username or password.');
    err.statusCode = 401;
    throw err;
  }

  const token = jwt.sign(
    { sub: username, role: account.role || 'admin', displayName: account.displayName || username },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn }
  );

  return {
    token,
    expiresIn: config.jwt.expiresIn,
    user: { username, role: account.role || 'admin', displayName: account.displayName || username },
  };
}

async function changePassword(username, currentPassword, newPassword) {
  const snap = await refs.admin(username).once('value');
  const account = snap.val();
  if (!account) throw Object.assign(new Error('Account not found.'), { statusCode: 404 });

  const ok = await bcrypt.compare(currentPassword, account.passwordHash);
  if (!ok) throw Object.assign(new Error('Current password is incorrect.'), { statusCode: 401 });

  if (newPassword.length < 8) throw Object.assign(new Error('New password must be at least 8 characters.'), { statusCode: 400 });

  const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  await refs.admin(username).update({ passwordHash });
}

/**
 * Superadmin-forced password reset for another admin account — no knowledge of
 * the current password. If `newPassword` is omitted, a strong one is generated
 * and returned once (the caller must relay it out-of-band).
 */
async function resetPassword(targetUsername, newPassword = null) {
  const snap = await refs.admin(targetUsername).once('value');
  if (!snap.exists()) throw Object.assign(new Error('Account not found.'), { statusCode: 404 });

  let generated = null;
  let pw = newPassword;
  if (!pw) {
    generated = require('crypto').randomBytes(9).toString('base64url'); // ~12 chars
    pw = generated;
  }
  if (pw.length < 8) throw Object.assign(new Error('New password must be at least 8 characters.'), { statusCode: 400 });

  const passwordHash = await bcrypt.hash(pw, BCRYPT_ROUNDS);
  await refs.admin(targetUsername).update({ passwordHash, passwordResetAt: Date.now() });
  return { username: targetUsername, generatedPassword: generated };
}

async function getAdminProfile(username) {
  const snap = await refs.admin(username).once('value');
  const a = snap.val();
  if (!a) throw Object.assign(new Error('Account not found.'), { statusCode: 404 });
  return { username: a.username, displayName: a.displayName || a.username, role: a.role || 'admin', createdAt: a.createdAt };
}

async function updateAdminProfile(username, { displayName }) {
  if (!displayName || !displayName.trim()) throw Object.assign(new Error('Display name is required.'), { statusCode: 400 });
  if (displayName.trim().length > 50) throw Object.assign(new Error('Display name must be 50 characters or less.'), { statusCode: 400 });
  await refs.admin(username).update({ displayName: displayName.trim() });
  return { displayName: displayName.trim() };
}

function verifyToken(token) {
  return jwt.verify(token, config.jwt.secret);
}

/**
 * Re-check an admin's own password — used to re-authorise a sensitive action
 * (e.g. creating a staff account) even though the request already carries a
 * valid JWT. Throws 401 on mismatch.
 */
async function verifyAdminPassword(username, password) {
  const snap = await refs.admin(username).once('value');
  const account = snap.val();
  const dummyHash = '$2a$10$abcdefghijklmnopqrstuuW2j7n5p9LK0L1PZmQDqfyV5bKzN6eLm';
  const ok = await bcrypt.compare(password || '', account?.passwordHash || dummyHash);
  if (!account || !ok) {
    throw Object.assign(new Error('Incorrect admin password.'), { statusCode: 401 });
  }
}

module.exports = { bootstrapAdmin, login, verifyToken, verifyAdminPassword, changePassword, resetPassword, getAdminProfile, updateAdminProfile };

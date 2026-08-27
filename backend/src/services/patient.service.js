/**
 * Hospital patient registry + Aadhaar-verified token issuance.
 *
 * Flow:
 *   1. registerPatient()      — entry point (self-service QR or reception desk).
 *                               Creates a patient record. Does NOT issue a token.
 *   2. verifyAndIssueToken()  — department desk (e.g. OPD). Confirms the Aadhaar
 *                               number matches the stored registration for that
 *                               department, then issues a queue token.
 *
 * Only a salted HMAC of the Aadhaar number is stored (plus the last 4 digits for
 * display). The raw number never touches RTDB and is never returned to a client.
 */
const crypto = require('crypto');
const { refs } = require('../config/firebase');
const config = require('../config/env');
const { normaliseAadhaar, isValidAadhaar, last4 } = require('../utils/aadhaar');
const queueService = require('./queue.service');
const analytics = require('./analytics.service');
const { emit, EVENTS } = require('../events/bus');

const GENDERS = ['male', 'female', 'other'];
const STATUS = Object.freeze({
  REGISTERED: 'registered',
  TOKEN_ISSUED: 'tokenIssued',
  CANCELLED: 'cancelled',
  EXPIRED: 'expired',
});
const EDITABLE_FIELDS = ['name', 'age', 'gender', 'mobile', 'address', 'department'];

function bad(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode });
}

function hashAadhaar(rawOrNormalised) {
  const normalised = normaliseAadhaar(rawOrNormalised);
  const keyMaterial = config.aadhaarSalt || config.jwt.secret;
  return crypto.createHmac('sha256', keyMaterial).update(normalised).digest('hex');
}

/** Strip server-only fields before a record leaves the API. */
function sanitise(patient) {
  if (!patient) return null;
  const { aadhaarHash: _omit, ...safe } = patient;
  return safe;
}

async function allPatients() {
  const snap = await refs.patients().once('value');
  return Object.values(snap.val() || {});
}

function validateDemographics({ name, age, gender, mobile, address, department }) {
  const cleanName = String(name || '').trim();
  if (cleanName.length < 2 || cleanName.length > 100) throw bad('name must be 2-100 characters.');

  const numericAge = Number(age);
  if (!Number.isInteger(numericAge) || numericAge < 0 || numericAge > 120) {
    throw bad('age must be a whole number between 0 and 120.');
  }

  if (!GENDERS.includes(gender)) throw bad(`gender must be one of: ${GENDERS.join(', ')}.`);

  const cleanMobile = String(mobile || '').replace(/[\s-]/g, '');
  if (!/^[6-9]\d{9}$/.test(cleanMobile)) throw bad('mobile must be a valid 10-digit Indian number.');

  const cleanAddress = String(address || '').trim();
  if (cleanAddress.length < 1 || cleanAddress.length > 300) throw bad('address must be 1-300 characters.');

  const cleanDept = String(department || '').trim();
  if (!cleanDept || cleanDept.length > 50) throw bad('department is required.');

  return { name: cleanName, age: numericAge, gender, mobile: cleanMobile, address: cleanAddress, department: cleanDept };
}

async function registerPatient({
  name, age, gender, mobile, address, aadhaar, department,
  consent, website,
  source = 'self', registeredBy = null,
} = {}) {
  // Honeypot: a real form leaves `website` empty; bots fill every field.
  if (website !== undefined && String(website).trim() !== '') {
    throw bad('Registration could not be processed.');
  }
  // Explicit consent is required for storing identity data.
  if (consent !== true && consent !== 'true') {
    throw bad('Consent to store your details is required to register.');
  }

  const { name: cleanName, age: numericAge, gender: cleanGender, mobile: cleanMobile, address: cleanAddress, department: cleanDept } =
    validateDemographics({ name, age, gender, mobile, address, department });

  if (!isValidAadhaar(aadhaar)) {
    throw bad('Aadhaar number is not valid (must be 12 digits with a correct checksum).');
  }

  const normalisedAadhaar = normaliseAadhaar(aadhaar);
  const aadhaarHash = hashAadhaar(normalisedAadhaar);

  // Duplicate guard: one pending registration per (Aadhaar, department) and per
  // (mobile, department) so a repeat submit or double-tap can't stack tokens.
  const existing = await allPatients();
  const dupe = existing.find(
    p => p.status === STATUS.REGISTERED &&
         p.department === cleanDept &&
         (p.aadhaarHash === aadhaarHash || p.mobile === cleanMobile)
  );
  if (dupe) {
    throw bad('This patient is already registered for that department and waiting for a token.', 409);
  }

  const id = crypto.randomUUID();
  const now = Date.now();
  const record = {
    id,
    name: cleanName,
    age: numericAge,
    gender: cleanGender,
    mobile: cleanMobile,
    address: cleanAddress,
    aadhaarHash,
    aadhaarLast4: last4(normalisedAadhaar),
    department: cleanDept,
    source: source === 'reception' ? 'reception' : 'self',
    registeredBy: registeredBy || null,
    registeredAt: now,
    updatedAt: now,
    consentAt: now,
    status: STATUS.REGISTERED,
    tokenId: null,
    tokenNumber: null,
    tokenIssuedAt: null,
    tokenIssuedBy: null,
  };
  await refs.patient(id).set(record);

  analytics.logEvent({
    event_type: 'patient_registered',
    service: cleanDept,
    timestamp: now,
  }).catch(err => console.error('[analytics]', err.message));

  emit(EVENTS.PATIENT_REGISTERED, { name: cleanName, department: cleanDept, source: record.source });

  return sanitise(record);
}

async function listPendingRegistrations(department) {
  const dept = String(department || '').trim();
  const all = await allPatients();
  return all
    .filter(p => p.status === STATUS.REGISTERED && (!dept || p.department === dept))
    .sort((a, b) => a.registeredAt - b.registeredAt)
    .map(sanitise);
}

async function getPatient(patientId) {
  const snap = await refs.patient(patientId).once('value');
  if (!snap.exists()) throw bad('Patient not found.', 404);
  return sanitise(snap.val());
}

/** Admin view of registrations, newest first, optionally filtered. */
async function listRegistrations({ status = null, department = null, limit = 200 } = {}) {
  const all = await allPatients();
  return all
    .filter(p => (!status || p.status === status) && (!department || p.department === department))
    .sort((a, b) => b.registeredAt - a.registeredAt)
    .slice(0, Math.max(1, Math.min(1000, limit)))
    .map(sanitise);
}

/** Edit demographics on a registration that has not yet been issued a token. */
async function updatePatient(patientId, patch = {}) {
  const snap = await refs.patient(patientId).once('value');
  if (!snap.exists()) throw bad('Patient not found.', 404);
  const current = snap.val();
  if (current.status !== STATUS.REGISTERED) {
    throw bad(`Cannot edit a registration that is "${current.status}".`, 409);
  }

  const next = { ...current };
  for (const f of EDITABLE_FIELDS) {
    if (patch[f] !== undefined) next[f] = patch[f];
  }
  const clean = validateDemographics(next);
  const updates = {
    name: clean.name, age: clean.age, gender: clean.gender,
    mobile: clean.mobile, address: clean.address, department: clean.department,
    updatedAt: Date.now(),
  };
  await refs.patient(patientId).update(updates);
  return sanitise({ ...current, ...updates });
}

/** Cancel a pending registration (e.g. patient left without being seen). */
async function cancelRegistration(patientId, byUser = null) {
  const snap = await refs.patient(patientId).once('value');
  if (!snap.exists()) throw bad('Patient not found.', 404);
  const current = snap.val();
  if (current.status !== STATUS.REGISTERED) {
    throw bad(`Only a pending registration can be cancelled (this one is "${current.status}").`, 409);
  }
  const now = Date.now();
  await refs.patient(patientId).update({ status: STATUS.CANCELLED, cancelledAt: now, cancelledBy: byUser || null, updatedAt: now });
  return sanitise({ ...current, status: STATUS.CANCELLED, cancelledAt: now });
}

/**
 * Sweep stale registrations: mark any `registered` record older than
 * `ttlHours` as `expired` so the desk's pending list stays meaningful.
 * Mirrors expiry.service.js for tokens.
 */
async function expireStaleRegistrations(ttlHours) {
  const cutoff = Date.now() - ttlHours * 3600 * 1000;
  const all = await allPatients();
  const stale = all.filter(p => p.status === STATUS.REGISTERED && p.registeredAt < cutoff);
  const now = Date.now();
  await Promise.all(stale.map(p =>
    refs.patient(p.id).update({ status: STATUS.EXPIRED, expiredAt: now, updatedAt: now })
  ));
  return { expired: stale.length };
}

/**
 * Department desk check-in: match the Aadhaar number against the stored
 * registration for `department`, then issue a queue token for that department.
 */
async function verifyAndIssueToken({ patientId = null, aadhaar, department, issuedBy = null } = {}) {
  const dept = String(department || '').trim();
  if (!dept) throw bad('department is required.');
  if (!isValidAadhaar(aadhaar)) {
    throw bad('Aadhaar number is not valid.');
  }
  const providedHash = hashAadhaar(aadhaar);

  let patientRecord;
  if (patientId) {
    const snap = await refs.patient(patientId).once('value');
    if (!snap.exists()) throw bad('Patient not found.', 404);
    patientRecord = snap.val();
  } else {
    const all = await allPatients();
    const forThisAadhaarAndDept = all.filter(
      p => p.aadhaarHash === providedHash && p.department === dept
    );
    patientRecord = forThisAadhaarAndDept.find(p => p.status === STATUS.REGISTERED);
    if (!patientRecord) {
      const alreadyIssued = forThisAadhaarAndDept.find(p => p.status === STATUS.TOKEN_ISSUED);
      if (alreadyIssued) {
        throw bad(`A token (#${alreadyIssued.tokenNumber}) has already been issued to this patient.`, 409);
      }
      throw bad('No pending registration found for this Aadhaar number at this department.', 404);
    }
  }

  if (providedHash !== patientRecord.aadhaarHash) {
    throw bad('Aadhaar does not match the registered record.', 422);
  }
  if (patientRecord.department !== dept) {
    throw bad(`This patient registered for "${patientRecord.department}", not "${dept}".`, 409);
  }
  if (patientRecord.status === STATUS.TOKEN_ISSUED) {
    throw bad(`A token (#${patientRecord.tokenNumber}) has already been issued to this patient.`, 409);
  }

  const token = await queueService.issueToken({
    service: dept,
    patientName: patientRecord.name,
    priority: 'normal',
    patientId: patientRecord.id,
  });

  const now = Date.now();
  await refs.patient(patientRecord.id).update({
    status: STATUS.TOKEN_ISSUED,
    tokenId: token.id,
    tokenNumber: token.number,
    tokenIssuedAt: now,
    tokenIssuedBy: issuedBy || null,
  });

  analytics.logEvent({
    event_type: 'patient_verified',
    token_id: token.id,
    token_number: token.number,
    service: dept,
    timestamp: now,
  }).catch(err => console.error('[analytics]', err.message));

  return {
    token,
    patient: sanitise({
      ...patientRecord,
      status: STATUS.TOKEN_ISSUED,
      tokenId: token.id,
      tokenNumber: token.number,
      tokenIssuedAt: now,
      tokenIssuedBy: issuedBy || null,
    }),
  };
}

module.exports = {
  STATUS,
  hashAadhaar,
  registerPatient,
  listPendingRegistrations,
  listRegistrations,
  getPatient,
  updatePatient,
  cancelRegistration,
  expireStaleRegistrations,
  verifyAndIssueToken,
};

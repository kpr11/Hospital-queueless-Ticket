/**
 * Consultation records — a permanent, per-patient clinical note history.
 *
 * A record is opened when an OPD doctor first opens a called patient, updated as
 * they write their diagnosis / notes and order lab work, and closed when they
 * mark the consultation done. Lab orders are auto-routed: a fresh (referred)
 * token is issued in the target department's queue for the same patient.
 *
 * RTDB: hospital/consultations/{id}
 */
const crypto = require('crypto');
const { refs } = require('../config/firebase');
const queueService = require('./queue.service');

const STATUS = Object.freeze({ OPEN: 'open', COMPLETED: 'completed' });

// Which department queue each orderable test routes to. Falls back to 'lab'.
const LAB_TESTS = Object.freeze({
  ct:         { label: 'CT scan',    department: 'radiology' },
  mri:        { label: 'MRI',        department: 'radiology' },
  xray:       { label: 'X-Ray',      department: 'radiology' },
  ultrasound: { label: 'Ultrasound', department: 'radiology' },
  ecg:        { label: 'ECG',        department: 'cardiology' },
  blood:      { label: 'Blood test', department: 'lab' },
  urine:      { label: 'Urine test', department: 'lab' },
});

function bad(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode });
}

async function allConsultations() {
  const snap = await refs.consultations().once('value');
  return Object.values(snap.val() || {});
}

async function getById(id) {
  const snap = await refs.consultation(id).once('value');
  return snap.exists() ? snap.val() : null;
}

/** The open consultation for a token, creating one if the doctor owns that call. */
async function openForToken({ tokenId, doctorUsername, doctorName }) {
  if (!tokenId) throw bad('tokenId is required.');
  const tokenSnap = await refs.token(tokenId).once('value');
  if (!tokenSnap.exists()) throw bad('Token not found.', 404);
  const token = tokenSnap.val();

  const existing = (await allConsultations()).find(c => c.tokenId === tokenId);
  if (existing) return existing;

  if (token.assignedTo && token.assignedTo !== doctorUsername) {
    throw bad('This patient is assigned to another room.', 403);
  }

  const now = Date.now();
  const record = {
    id: crypto.randomUUID(),
    patientId: token.patientId || null,
    tokenId,
    tokenNumber: token.number,
    department: token.service,
    room: token.room || null,
    doctorUsername,
    doctorName: doctorName || doctorUsername,
    status: STATUS.OPEN,
    diagnosis: '',
    notes: '',
    labOrders: [],
    startedAt: now,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  await refs.consultation(record.id).set(record);
  return record;
}

/** Past consultations for a patient, newest first (excludes the given id). */
async function historyForPatient(patientId, excludeId = null) {
  if (!patientId) return [];
  return (await allConsultations())
    .filter(c => c.patientId === patientId && c.id !== excludeId)
    .sort((a, b) => b.createdAt - a.createdAt);
}

async function update(id, { diagnosis, notes }, doctorUsername) {
  const c = await getById(id);
  if (!c) throw bad('Consultation not found.', 404);
  if (c.doctorUsername !== doctorUsername) throw bad('Not your consultation.', 403);
  if (c.status === STATUS.COMPLETED) throw bad('This consultation is already closed.', 409);

  const patch = { updatedAt: Date.now() };
  if (typeof diagnosis === 'string') patch.diagnosis = diagnosis.slice(0, 4000);
  if (typeof notes === 'string') patch.notes = notes.slice(0, 8000);
  await refs.consultation(id).update(patch);
  return { ...c, ...patch };
}

/** Order one or more tests — issues a referred token in each target queue. */
async function addLabOrders(id, tests, doctorUsername) {
  const c = await getById(id);
  if (!c) throw bad('Consultation not found.', 404);
  if (c.doctorUsername !== doctorUsername) throw bad('Not your consultation.', 403);
  if (c.status === STATUS.COMPLETED) throw bad('This consultation is already closed.', 409);

  const wanted = [...new Set((Array.isArray(tests) ? tests : []).filter(t => LAB_TESTS[t]))];
  if (wanted.length === 0) throw bad('Pick at least one valid test.');

  let patientName = null;
  if (c.patientId) {
    const pSnap = await refs.patient(c.patientId).once('value');
    patientName = pSnap.val()?.name || null;
  }

  const existing = Array.isArray(c.labOrders) ? c.labOrders : [];
  const added = [];
  for (const key of wanted) {
    const test = LAB_TESTS[key];
    const token = await queueService.issueToken({
      service: test.department,
      patientName,
      patientId: c.patientId || null,
      priority: 'normal',
      referred: true,
      note: `${test.label} — ordered by ${c.doctorName} (OPD #${c.tokenNumber})`,
    });
    added.push({
      test: key,
      label: test.label,
      department: test.department,
      tokenId: token.id,
      tokenNumber: token.number,
      orderedAt: Date.now(),
    });
  }

  const labOrders = [...existing, ...added];
  await refs.consultation(id).update({ labOrders, updatedAt: Date.now() });
  return { ...c, labOrders };
}

/**
 * Close the consultation and advance the doctor's room: the current called
 * token is served and the next assigned patient is called.
 */
async function complete(id, { diagnosis, notes }, doctorUsername) {
  let c = await getById(id);
  if (!c) throw bad('Consultation not found.', 404);
  if (c.doctorUsername !== doctorUsername) throw bad('Not your consultation.', 403);

  if (typeof diagnosis === 'string' || typeof notes === 'string') {
    c = await update(id, { diagnosis, notes }, doctorUsername).catch(() => c);
  }

  const now = Date.now();
  await refs.consultation(id).update({ status: STATUS.COMPLETED, completedAt: now, updatedAt: now });

  const advance = await queueService
    .callNextToken(c.department, doctorUsername, { assignedTo: doctorUsername })
    .catch(() => ({ called: null }));

  return { consultation: { ...c, status: STATUS.COMPLETED, completedAt: now }, advance };
}

module.exports = { STATUS, LAB_TESTS, openForToken, getById, historyForPatient, update, addLabOrders, complete };

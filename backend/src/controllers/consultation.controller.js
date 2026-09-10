const consultationService = require('../services/consultation.service');
const { refs } = require('../config/firebase');
const { isAdminTier } = require('../config/roles');

async function requirePatientHistoryAccess(user, patientId) {
  if (isAdminTier(user.role)) return;
  const tokens = Object.values((await refs.tokens().once('value')).val() || {});
  const assigned = tokens.some(token => token.patientId === patientId && token.assignedTo === user.sub);
  const history = await consultationService.historyForPatient(patientId);
  if (!assigned && !history.some(record => record.doctorUsername === user.sub)) {
    throw Object.assign(new Error('Patient is not assigned to this doctor.'), { statusCode: 403 });
  }
}

// GET /consultations/lab-tests — the orderable test catalogue for the doctor UI.
async function labTests(req, res) {
  res.json({
    tests: Object.entries(consultationService.LAB_TESTS).map(([id, t]) => ({ id, ...t })),
  });
}

// GET /consultations?tokenId=... — open (or fetch) the record for a called patient.
// GET /consultations?patientId=...&excludeId=... — that patient's past visits.
async function get(req, res) {
  const { tokenId, patientId, excludeId } = req.query;
  if (tokenId) {
    const token = (await refs.token(tokenId).once('value')).val();
    if (!token) return res.status(404).json({ error: 'Token not found.' });
    if (!isAdminTier(req.user.role) && token.assignedTo !== req.user.sub) {
      return res.status(403).json({ error: 'Patient is not assigned to this doctor.' });
    }
    const consultation = await consultationService.openForToken({
      tokenId,
      doctorUsername: req.user.sub,
      doctorName: req.user.displayName || req.user.sub,
    });
    const history = await consultationService.historyForPatient(consultation.patientId, consultation.id);
    return res.json({ consultation, history });
  }
  if (patientId) {
    await requirePatientHistoryAccess(req.user, patientId);
    return res.json({ history: await consultationService.historyForPatient(patientId, excludeId || null) });
  }
  res.status(400).json({ error: 'tokenId or patientId is required.' });
}

// PUT /consultations/:id — save diagnosis / notes.
async function update(req, res) {
  const c = await consultationService.update(req.params.id, req.body || {}, req.user.sub);
  res.json({ consultation: c });
}

// POST /consultations/:id/lab-orders — order tests { tests: ['ct', 'blood'] }.
async function addLabOrders(req, res) {
  const c = await consultationService.addLabOrders(req.params.id, req.body?.tests, req.user.sub);
  res.json({ message: 'Tests ordered.', consultation: c });
}

// POST /consultations/:id/complete — close and advance the room.
async function complete(req, res) {
  const result = await consultationService.complete(req.params.id, req.body || {}, req.user.sub);
  res.json({ message: 'Consultation completed.', ...result });
}

module.exports = { labTests, get, update, addLabOrders, complete };

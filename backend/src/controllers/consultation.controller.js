const consultationService = require('../services/consultation.service');

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
    const consultation = await consultationService.openForToken({
      tokenId,
      doctorUsername: req.user.sub,
      doctorName: req.user.displayName || req.user.sub,
    });
    const history = await consultationService.historyForPatient(consultation.patientId, consultation.id);
    return res.json({ consultation, history });
  }
  if (patientId) {
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

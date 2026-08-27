const patientService = require('../services/patient.service');
const { isAdminTier } = require('../config/roles');

/**
 * Resolve which department a desk operator is acting for.
 * Admin-tier users may act for any department (passed explicitly); a plain staff
 * member is locked to the counter their account is assigned to.
 */
function resolveDepartment(req, requested) {
  if (isAdminTier(req.user.role)) return String(requested || '').trim();
  return req.user.service || '';
}

// PUBLIC — self-service registration (reached via the home-page QR).
async function register(req, res) {
  const patient = await patientService.registerPatient({
    ...req.body,
    source: 'self',
    registeredBy: null,
  });
  res.status(201).json({ message: 'Registered. Proceed to the department desk with your Aadhaar number.', patient });
}

// requireStaff — reception desk registering a walk-in on the patient's behalf.
async function receptionRegister(req, res) {
  const patient = await patientService.registerPatient({
    ...req.body,
    source: 'reception',
    registeredBy: req.user.sub,
  });
  res.status(201).json({ message: 'Patient registered.', patient });
}

// requireStaff — pending registrations for a department.
async function listPending(req, res) {
  const department = resolveDepartment(req, req.query.department);
  if (!department) {
    return res.status(400).json({ error: 'department is required.' });
  }
  const patients = await patientService.listPendingRegistrations(department);
  res.json({ department, patients });
}

// requireStaff — all registrations (admin overview). Staff see only their counter.
async function listRegistrations(req, res) {
  const { isAdminTier } = require('../config/roles');
  const department = isAdminTier(req.user.role)
    ? (req.query.department || null)
    : req.user.service;
  const status = req.query.status || null;
  const limit = req.query.limit ? parseInt(req.query.limit, 10) : 200;
  const patients = await patientService.listRegistrations({ status, department, limit });
  res.json({ patients });
}

// requireStaff — edit demographics on a pending registration.
async function update(req, res) {
  const patient = await patientService.updatePatient(req.params.id, req.body);
  res.json({ message: 'Registration updated.', patient });
}

// requireStaff — cancel a pending registration.
async function cancel(req, res) {
  const patient = await patientService.cancelRegistration(req.params.id, req.user.sub);
  res.json({ message: 'Registration cancelled.', patient });
}

// requireStaff — the department check-in: verify Aadhaar, issue a token.
async function verifyAndIssue(req, res) {
  const department = resolveDepartment(req, req.body.department);
  if (!department) {
    return res.status(400).json({ error: 'department is required.' });
  }
  const result = await patientService.verifyAndIssueToken({
    patientId: req.body.patientId || null,
    aadhaar: req.body.aadhaar,
    department,
    issuedBy: req.user.sub,
  });
  res.status(201).json({
    message: `Token #${result.token.number} issued for ${department}.`,
    ...result,
  });
}

// requireStaff — single patient lookup (e.g. after scanning the confirmation QR).
async function getOne(req, res) {
  const patient = await patientService.getPatient(req.params.id);
  res.json({ patient });
}

module.exports = {
  register, receptionRegister,
  listPending, listRegistrations, getOne,
  update, cancel,
  verifyAndIssue,
};

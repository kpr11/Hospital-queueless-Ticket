import { api } from './client.js';

/**
 * Hospital patient registration + Aadhaar-verified token issuance.
 *
 * `apiRegisterPatient` is public (self-service QR). The rest require an
 * admin/staff JWT — the request interceptor attaches it automatically.
 */

const buildPayload = (form) => ({
  name: form.name?.trim(),
  age: Number(form.age),
  gender: form.gender,
  mobile: String(form.mobile || '').replace(/[\s-]/g, ''),
  address: form.address?.trim(),
  aadhaar: String(form.aadhaar || '').replace(/[\s-]/g, ''),
  department: form.department,
  priorityRequested: form.priorityRequested === true,
  priorityReason: form.priorityReason || undefined,
  consent: form.consent === true,
  website: form.website || '',
});

// Public — self-service registration (home-page QR).
export const apiRegisterPatient = (form) =>
  api.post('/patients/register', buildPayload(form)).then(r => r.data);

// Reception desk — register a walk-in on the patient's behalf.
export const apiReceptionRegisterPatient = (form) =>
  api.post('/patients/reception/register', buildPayload(form)).then(r => r.data);

// Department desk — pending registrations for a department.
export const apiPendingRegistrations = (department) =>
  api.get('/patients/pending', { params: department ? { department } : {} }).then(r => r.data);

// Department desk — verify Aadhaar and issue a token.
export const apiVerifyAndIssueToken = ({ patientId, aadhaar, department }) =>
  api.post('/patients/verify-issue', {
    patientId: patientId || undefined,
    aadhaar: String(aadhaar || '').replace(/[\s-]/g, ''),
    department: department || undefined,
  }).then(r => r.data);

export const apiGetPatient = (id) =>
  api.get(`/patients/${id}`).then(r => r.data);

// Public — a patient checking their own registration (confirmation QR).
export const apiRegistrationStatus = (id) =>
  api.get(`/patients/${id}/status`).then(r => r.data);

// Desk header — today's registration counts.
export const apiRegistrationSummary = (department) =>
  api.get('/patients/summary', { params: department ? { department } : {} }).then(r => r.data);

// Admin overview — all registrations, optionally filtered by status/department.
export const apiListRegistrations = (params = {}) =>
  api.get('/patients/registrations', { params }).then(r => r.data);

// Edit demographics on a pending registration.
export const apiUpdateRegistration = (id, patch) =>
  api.put(`/patients/${id}`, patch).then(r => r.data);

// Cancel a pending registration.
export const apiCancelRegistration = (id) =>
  api.post(`/patients/${id}/cancel`).then(r => r.data);

// Admin — seed an industry's default queues/departments.
export const apiSeedQueueDefaults = (industry) =>
  api.post('/admin/queues/seed-defaults', industry ? { industry } : {}).then(r => r.data);

import { api } from './client.js';

// Consultation records (OPD doctor). A record opens when the doctor first loads
// a called patient; it's updated as they write notes and order tests.
//
// Every call is identity-sensitive — the backend keys the record to the
// caller's username and enforces ownership — so force the staff JWT even
// though these routes are not under the /staff/ prefix.
const S = { staffAuth: true };

export const apiConsultationForToken = (tokenId) =>
  api.get('/consultations', { params: { tokenId }, ...S }).then(r => r.data);

export const apiPatientConsultations = (patientId, excludeId) =>
  api.get('/consultations', { params: { patientId, excludeId }, ...S }).then(r => r.data);

export const apiLabTests = () =>
  api.get('/consultations/lab-tests', S).then(r => r.data);

export const apiUpdateConsultation = (id, data) =>
  api.put(`/consultations/${id}`, data, S).then(r => r.data);

export const apiOrderLabTests = (id, tests) =>
  api.post(`/consultations/${id}/lab-orders`, { tests }, S).then(r => r.data);

export const apiCompleteConsultation = (id, data) =>
  api.post(`/consultations/${id}/complete`, data, S).then(r => r.data);

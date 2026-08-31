import { api } from './client.js';

// Consultation records (OPD doctor). A record opens when the doctor first loads
// a called patient; it's updated as they write notes and order tests.
export const apiConsultationForToken = (tokenId) =>
  api.get('/consultations', { params: { tokenId } }).then(r => r.data);

export const apiPatientConsultations = (patientId, excludeId) =>
  api.get('/consultations', { params: { patientId, excludeId } }).then(r => r.data);

export const apiLabTests = () =>
  api.get('/consultations/lab-tests').then(r => r.data);

export const apiUpdateConsultation = (id, data) =>
  api.put(`/consultations/${id}`, data).then(r => r.data);

export const apiOrderLabTests = (id, tests) =>
  api.post(`/consultations/${id}/lab-orders`, { tests }).then(r => r.data);

export const apiCompleteConsultation = (id, data) =>
  api.post(`/consultations/${id}/complete`, data).then(r => r.data);

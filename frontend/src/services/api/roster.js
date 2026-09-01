import { api } from './client.js';

// Daily doctor roster (OPD). `department` defaults to 'opd' server-side.
export const apiGetRoster         = (department = 'opd') =>
  api.get('/roster', { params: { department } }).then(r => r.data);

// Public, PII-free room list for the display board (no auth).
export const apiGetRosterPublic   = (department = 'opd') =>
  api.get('/roster/public', { params: { department } }).then(r => r.data);

export const apiAddRosterDoctor   = ({ username, name, room, department = 'opd' }) =>
  api.post('/roster/doctors', { username, name, room, department }).then(r => r.data);

export const apiRemoveRosterDoctor = (username, department = 'opd') =>
  api.delete(`/roster/doctors/${encodeURIComponent(username)}`, { params: { department } }).then(r => r.data);

// A doctor flips their own availability for today: 'available' | 'off'.
// Identity-sensitive (keyed by the caller's username) — force the staff JWT.
export const apiSetAvailability   = (status, department = 'opd') =>
  api.post('/roster/availability', { status, department }, { staffAuth: true }).then(r => r.data);

// Admin — move a doctor's (or 'unassigned') waiting patients to available doctors.
export const apiReassignRoster    = (from, department = 'opd') =>
  api.post('/roster/reassign', { from, department }).then(r => r.data);

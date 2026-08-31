import { api } from './client.js';

// Daily doctor roster (OPD). `department` defaults to 'opd' server-side.
export const apiGetRoster         = (department = 'opd') =>
  api.get('/roster', { params: { department } }).then(r => r.data);

export const apiAddRosterDoctor   = ({ username, name, room, department = 'opd' }) =>
  api.post('/roster/doctors', { username, name, room, department }).then(r => r.data);

export const apiRemoveRosterDoctor = (username, department = 'opd') =>
  api.delete(`/roster/doctors/${encodeURIComponent(username)}`, { params: { department } }).then(r => r.data);

// A doctor flips their own availability for today: 'available' | 'off'.
export const apiSetAvailability   = (status, department = 'opd') =>
  api.post('/roster/availability', { status, department }).then(r => r.data);

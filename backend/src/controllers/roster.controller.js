const rosterService = require('../services/roster.service');

// The multi-room roster is OPD-only for now; the service layer is dept-generic.
function deptOf(req) {
  return String(req.query.department || req.body.department || 'opd').trim() || 'opd';
}

// requireStaff — anyone signed in can read today's roster (doctors, reception).
async function get(req, res) {
  res.json(await rosterService.getRoster(deptOf(req)));
}

// Public — the display board needs room + doctor name (no usernames, no PII).
async function getPublic(req, res) {
  const { date, department, doctors } = await rosterService.getRoster(deptOf(req));
  res.json({
    date,
    department,
    rooms: doctors.map(d => ({ room: d.room, doctor: d.name, status: d.status, waiting: d.waiting || 0 })),
  });
}

// requireAdmin — put a doctor on today's roster with a room number.
async function addDoctor(req, res) {
  const { username, name, room } = req.body || {};
  const roster = await rosterService.addDoctor(deptOf(req), {
    username, name, room, addedBy: req.user.sub,
  });
  res.status(201).json({ message: `${username} added to today’s roster.`, roster });
}

// requireAdmin — take a doctor off today's roster.
async function removeDoctor(req, res) {
  const roster = await rosterService.removeDoctor(deptOf(req), req.params.username);
  res.json({ message: 'Removed from today’s roster.', roster });
}

// requireStaff — a doctor flips their own availability for today.
async function setAvailability(req, res) {
  const roster = await rosterService.setAvailability(deptOf(req), req.user.sub, req.body?.status);
  res.json({ message: 'Availability updated.', roster });
}

// requireAdmin — redistribute a doctor's waiting patients. body: { from: '<username>' | 'unassigned' }
async function reassign(req, res) {
  const from = String(req.body?.from || '').trim();
  if (!from) return res.status(400).json({ error: 'from is required.' });
  const result = await rosterService.reassign(deptOf(req), from);
  const roster = await rosterService.getRoster(deptOf(req));
  res.json({
    message: result.moved || result.toNone
      ? `Moved ${result.moved} patient(s)${result.toNone ? `, ${result.toNone} left unassigned (no available doctor)` : ''}.`
      : 'No waiting patients to move.',
    ...result,
    roster,
  });
}

module.exports = { get, getPublic, addDoctor, removeDoctor, setAvailability, reassign };

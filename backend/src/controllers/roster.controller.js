const rosterService = require('../services/roster.service');

// The multi-room roster is OPD-only for now; the service layer is dept-generic.
function deptOf(req) {
  return String(req.query.department || req.body.department || 'opd').trim() || 'opd';
}

// requireStaff — anyone signed in can read today's roster (doctors, reception).
async function get(req, res) {
  res.json(await rosterService.getRoster(deptOf(req)));
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

module.exports = { get, addDoctor, removeDoctor, setAvailability };

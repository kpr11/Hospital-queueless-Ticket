/**
 * Daily doctor roster for a department (OPD today; the model is department-generic).
 *
 * Each morning an admin adds the doctors on duty and their room numbers. A doctor
 * then logs in and flips their own status to "available". New tokens for the
 * department are handed out to the available doctors round-robin (assignRoom).
 *
 * RTDB shape:
 *   hospital/roster/{YYYY-MM-DD}/{dept}/
 *     doctors/{username}/ { room, name, status, addedBy, addedAt, updatedAt }
 *     cursor: <int>                       // round-robin pointer
 */
const { refs } = require('../config/firebase');

const STATUS = Object.freeze({ OFF: 'off', AVAILABLE: 'available' });

/** Waiting (not yet called) tokens for a department, grouped by assigned doctor. */
async function waitingByDoctor(dept) {
  const snap = await refs.tokens().once('value');
  const waiting = Object.values(snap.val() || {}).filter(
    (t) => t.status === 'waiting' && t.service === dept
  );
  const byDoctor = {};
  let unassigned = 0;
  for (const t of waiting) {
    if (t.assignedTo) byDoctor[t.assignedTo] = (byDoctor[t.assignedTo] || 0) + 1;
    else unassigned += 1;
  }
  return { byDoctor, unassigned, waiting };
}

function bad(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode });
}

/** Today's date in IST (this is an India deployment), as YYYY-MM-DD. */
function todayKey() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

function sortByRoom(a, b) {
  const na = Number(a.room);
  const nb = Number(b.room);
  if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  return String(a.room).localeCompare(String(b.room));
}

async function getRoster(dept, date = todayKey()) {
  const [snap, { byDoctor, unassigned }] = await Promise.all([
    refs.roster(date, dept).once('value'),
    waitingByDoctor(dept),
  ]);
  const val = snap.val() || {};
  const doctors = Object.entries(val.doctors || {})
    .map(([username, d]) => ({ username, ...d, waiting: byDoctor[username] || 0 }))
    .sort(sortByRoom);
  return {
    date,
    department: dept,
    doctors,
    unassignedWaiting: unassigned,
    available: doctors.filter((d) => d.status === STATUS.AVAILABLE),
  };
}

async function addDoctor(dept, { username, name, room, addedBy = null }) {
  const u = String(username || '').trim();
  const r = String(room || '').trim();
  if (!u) throw bad('A staff username is required.');
  if (!r) throw bad('A room number is required.');

  const staffSnap = await refs.staffMember(u).once('value');
  if (!staffSnap.exists()) throw bad(`No staff account "${u}".`, 404);
  const staff = staffSnap.val();
  if (staff.service !== dept) {
    throw bad(`"${u}" is assigned to "${staff.service}", not "${dept}".`, 409);
  }

  const date = todayKey();
  const now = Date.now();
  const existing = (await refs.rosterDoctor(date, dept, u).once('value')).val();
  await refs.rosterDoctor(date, dept, u).update({
    room: r,
    name: name || staff.displayName || u,
    status: existing?.status || STATUS.OFF,
    addedBy: existing?.addedBy || addedBy,
    addedAt: existing?.addedAt || now,
    updatedAt: now,
  });
  return getRoster(dept, date);
}

async function removeDoctor(dept, username) {
  const u = String(username || '').trim();
  // Don't strand patients: hand any still-waiting ones to the other doctors first.
  await reassign(dept, u).catch(() => {});
  await refs.rosterDoctor(todayKey(), dept, u).remove();
  return getRoster(dept);
}

async function setAvailability(dept, username, status) {
  const u = String(username || '').trim();
  const s = status === STATUS.AVAILABLE ? STATUS.AVAILABLE : STATUS.OFF;
  const date = todayKey();
  const ref = refs.rosterDoctor(date, dept, u);
  const snap = await ref.once('value');
  if (!snap.exists()) {
    throw bad('You are not on today’s roster. Ask reception to add you.', 409);
  }
  await ref.update({ status: s, updatedAt: Date.now() });
  return getRoster(dept, date);
}

/**
 * Pick the next available doctor/room for a fresh token, round-robin.
 * Returns { username, room, name } or null when nobody is available.
 */
async function assignRoom(dept) {
  const date = todayKey();
  const { available } = await getRoster(dept, date);
  if (available.length === 0) return null;

  const tx = await refs.rosterCursor(date, dept).transaction((c) => (Number.isFinite(c) ? c + 1 : 1));
  const cursor = tx.committed ? tx.snapshot.val() : 0;
  const pick = available[(cursor - 1 + available.length * 1000) % available.length];
  return { username: pick.username, room: pick.room, name: pick.name };
}

/**
 * Redistribute a doctor's still-waiting patients across the other available
 * doctors, round-robin. `from` may be a username or 'unassigned'. Patients who
 * have already been called are left alone. Returns { moved, toNone }.
 */
async function reassign(dept, from) {
  const date = todayKey();
  const { doctors } = await getRoster(dept, date);
  const targets = doctors.filter(d => d.status === STATUS.AVAILABLE && d.username !== from);

  const { waiting } = await waitingByDoctor(dept);
  const toMove = waiting.filter(t =>
    from === 'unassigned' ? !t.assignedTo : t.assignedTo === from
  );
  if (toMove.length === 0) return { moved: 0, toNone: 0, targets: targets.length };

  let moved = 0;
  let toNone = 0;
  for (let i = 0; i < toMove.length; i++) {
    const token = toMove[i];
    const target = targets.length ? targets[i % targets.length] : null;
    await refs.token(token.id).update({
      assignedTo: target ? target.username : null,
      room: target ? target.room : null,
    });
    if (token.patientId) {
      await refs.patient(token.patientId).update({
        room: target ? target.room : null,
        assignedDoctor: target ? target.name : null,
      }).catch(() => {});
    }
    if (target) moved += 1; else toNone += 1;
  }
  return { moved, toNone, targets: targets.length };
}

module.exports = { STATUS, todayKey, getRoster, addDoctor, removeDoctor, setAvailability, assignRoom, reassign };

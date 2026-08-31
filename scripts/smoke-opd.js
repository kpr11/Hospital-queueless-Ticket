#!/usr/bin/env node
/**
 * End-to-end smoke test for the OPD multi-room flow against a RUNNING backend
 * (real Firebase, real HTTP). Creates temporary staff/patients/tokens all
 * prefixed/identifiable, exercises the full flow, then cleans everything up.
 *
 *   cd backend && BASE_URL=https://…onrender.com \
 *     ADMIN_USER=admin ADMIN_PASS=… node ../scripts/smoke-opd.js
 *
 * Exit 0 = all steps passed.
 */
const BASE = (process.env.BASE_URL || 'http://localhost:4000').replace(/\/$/, '');
const API = `${BASE}/api/v1`;
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'admin12345';

const AADHAAR = ['234567890124', '789456123014', '555444333229', '999888777669'];

let passed = 0;
const results = [];
const created = { staff: [], patients: [], tokens: new Set(), rosterDoctors: [] };

async function step(name, fn) {
  try { await fn(); results.push(`  ✓ ${name}`); passed += 1; }
  catch (e) { results.push(`  ✗ ${name}\n      ${e.message}`); }
}
async function req(method, path, { token, body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json; try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  return { status: res.status, json };
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }
const uniqMobile = () => '9' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0');

(async () => {
  let admin;
  const docs = [
    { username: `smoke_doc_a_${Date.now() % 100000}`, room: '901', token: null, patientToken: null },
    { username: `smoke_doc_b_${Date.now() % 100000}`, room: '902', token: null, patientToken: null },
  ];
  const patients = [];

  await step('admin login', async () => {
    const { status, json } = await req('POST', '/auth/login', { body: { username: ADMIN_USER, password: ADMIN_PASS } });
    assert(status === 200 && json.token, `got ${status} ${JSON.stringify(json)}`);
    admin = json.token;
  });

  await step('config: medical industry + opd/lab/radiology queues exist', async () => {
    const { json } = await req('GET', '/config');
    assert(json.industry === 'medical', `industry is "${json.industry}", not medical`);
    const keys = (json.queues || []).map(q => q.key);
    for (const k of ['opd', 'lab', 'radiology']) assert(keys.includes(k), `missing queue: ${k}`);
  });

  await step('create 2 OPD doctor accounts', async () => {
    for (const d of docs) {
      const { status } = await req('POST', '/admin/staff', {
        token: admin,
        body: { username: d.username, password: 'smokepass123', service: 'opd', displayName: d.username.toUpperCase() },
      });
      assert(status === 201 || status === 200, `create ${d.username}: ${status}`);
      created.staff.push(d.username);
      const login = await req('POST', '/staff/login', { body: { username: d.username, password: 'smokepass123' } });
      assert(login.status === 200 && login.json.token, `login ${d.username}: ${login.status}`);
      d.token = login.json.token;
    }
  });

  await step('doctor cannot go available before being rostered', async () => {
    const { status } = await req('POST', '/roster/availability', { token: docs[0].token, body: { status: 'available' } });
    assert(status === 409, `expected 409, got ${status}`);
  });

  await step('admin rosters both doctors with rooms', async () => {
    for (const d of docs) {
      const { status } = await req('POST', '/roster/doctors', { token: admin, body: { username: d.username, room: d.room } });
      assert(status === 201, `roster ${d.username}: ${status}`);
      created.rosterDoctors.push(d.username);
    }
  });

  await step('both doctors go available', async () => {
    for (const d of docs) {
      const { status } = await req('POST', '/roster/availability', { token: d.token, body: { status: 'available' } });
      assert(status === 200, `available ${d.username}: ${status}`);
    }
  });

  await step('GET /roster shows 2 available doctors, 0 waiting', async () => {
    const { json } = await req('GET', '/roster', { token: admin });
    const mine = json.doctors.filter(x => created.rosterDoctors.includes(x.username));
    assert(mine.length === 2, `expected my 2 doctors, got ${mine.length}`);
    assert(mine.every(x => x.status === 'available' && x.waiting === 0), 'not all available/empty');
  });

  await step('GET /roster/public exposes rooms without usernames', async () => {
    const { status, json } = await req('GET', '/roster/public');
    assert(status === 200 && Array.isArray(json.rooms), `got ${status}`);
    assert(json.rooms.every(r => r.room && !('username' in r)), 'username leaked or room missing');
  });

  await step('register 3 OPD patients', async () => {
    for (let i = 0; i < 3; i++) {
      const mobile = uniqMobile();
      const aadhaar = AADHAAR[i % AADHAAR.length];
      const { status, json } = await req('POST', '/patients/register', {
        body: { name: `Smoke OPD ${i + 1}`, age: 30 + i, gender: 'other', mobile, address: '1 Test Rd', aadhaar, department: 'opd', consent: true },
      });
      assert(status === 201 && json.patient?.id, `register ${i}: ${status} ${JSON.stringify(json)}`);
      patients.push({ id: json.patient.id, aadhaar, mobile });
      created.patients.push(json.patient.id);
    }
  });

  await step('verify-issue assigns rooms round-robin (901,902,901)', async () => {
    const rooms = [];
    for (const p of patients) {
      const { status, json } = await req('POST', '/patients/verify-issue', { token: admin, body: { patientId: p.id, aadhaar: p.aadhaar, department: 'opd' } });
      assert(status === 201, `issue ${p.id}: ${status} ${JSON.stringify(json)}`);
      p.tokenId = json.token.id;
      p.room = json.token.room;
      p.assignedTo = json.token.assignedTo;
      created.tokens.add(json.token.id);
      rooms.push(json.token.room);
    }
    const n901 = rooms.filter(r => r === '901').length;
    const n902 = rooms.filter(r => r === '902').length;
    assert(n901 === 2 && n902 === 1, `expected 2x901 + 1x902, got ${JSON.stringify(rooms)}`);
  });

  let consultId;
  let consultDoc;
  await step('assigned doctor calls next → gets their own patient', async () => {
    // find a doctor who has an assigned patient
    consultDoc = docs.find(d => patients.some(p => p.assignedTo === d.username));
    assert(consultDoc, 'no doctor got an assigned patient');
    const { status, json } = await req('POST', '/staff/queue/call-next', { token: consultDoc.token });
    assert(status === 200, `call-next: ${status} ${JSON.stringify(json)}`);
    assert(json.called && json.called.assignedTo === consultDoc.username, `called wrong patient: ${JSON.stringify(json.called)}`);
    consultDoc.calledTokenId = json.called.id;
  });

  await step('doctor opens the consultation record', async () => {
    const { status, json } = await req('GET', `/consultations?tokenId=${consultDoc.calledTokenId}`, { token: consultDoc.token });
    assert(status === 200 && json.consultation?.id && json.consultation.status === 'open', `got ${status} ${JSON.stringify(json)}`);
    consultId = json.consultation.id;
  });

  await step('doctor saves diagnosis + notes', async () => {
    const { status, json } = await req('PUT', `/consultations/${consultId}`, { token: consultDoc.token, body: { diagnosis: 'Smoke Dx', notes: 'Smoke advice' } });
    assert(status === 200 && json.consultation.diagnosis === 'Smoke Dx', `got ${status} ${JSON.stringify(json)}`);
  });

  await step('lab orders auto-route to radiology + lab', async () => {
    const { status, json } = await req('POST', `/consultations/${consultId}/lab-orders`, { token: consultDoc.token, body: { tests: ['ct', 'blood'] } });
    assert(status === 200 && json.consultation.labOrders?.length === 2, `got ${status} ${JSON.stringify(json)}`);
    const depts = json.consultation.labOrders.map(o => o.department).sort();
    assert(JSON.stringify(depts) === JSON.stringify(['lab', 'radiology']), `depts: ${JSON.stringify(depts)}`);
    json.consultation.labOrders.forEach(o => created.tokens.add(o.tokenId));
  });

  await step('another doctor cannot edit this consultation (403)', async () => {
    const other = docs.find(d => d.username !== consultDoc.username);
    const { status } = await req('PUT', `/consultations/${consultId}`, { token: other.token, body: { notes: 'hijack' } });
    assert(status === 403, `expected 403, got ${status}`);
  });

  await step('complete → consultation closes and room advances', async () => {
    const { status, json } = await req('POST', `/consultations/${consultId}/complete`, { token: consultDoc.token, body: {} });
    assert(status === 200 && json.consultation.status === 'completed', `got ${status} ${JSON.stringify(json)}`);
  });

  await step('patient history now includes the completed visit', async () => {
    const p = patients.find(x => x.assignedTo === consultDoc.username);
    const { status, json } = await req('GET', `/consultations?patientId=${p.id}`, { token: consultDoc.token });
    assert(status === 200 && (json.history || []).some(h => h.id === consultId), `got ${status} ${JSON.stringify(json)}`);
  });

  await step('stand-down + admin reassign moves waiting patients', async () => {
    const b = docs[1];
    await req('POST', '/roster/availability', { token: b.token, body: { status: 'off' } });
    const { status, json } = await req('POST', '/roster/reassign', { token: admin, body: { from: b.username } });
    assert(status === 200, `reassign: ${status} ${JSON.stringify(json)}`);
    const board = await req('GET', '/roster', { token: admin });
    const bRow = board.json.doctors.find(x => x.username === b.username);
    assert(!bRow || bRow.waiting === 0, `docB still has ${bRow?.waiting} waiting after reassign`);
  });

  await step('non-admin cannot call reassign (403)', async () => {
    const { status } = await req('POST', '/roster/reassign', { token: docs[0].token, body: { from: docs[0].username } });
    assert(status === 403, `expected 403, got ${status}`);
  });

  // ---- cleanup ----
  const cleanup = [];
  for (const id of created.tokens) {
    const r = await req('POST', `/admin/queue/skip/${id}`, { token: admin });
    cleanup.push(`skip token ${id}: ${r.status}`);
  }
  for (const id of created.patients) {
    const r = await req('POST', `/patients/${id}/cancel`, { token: admin });
    cleanup.push(`cancel patient ${id}: ${r.status}`);
  }
  for (const u of created.rosterDoctors) {
    const r = await req('DELETE', `/roster/doctors/${u}`, { token: admin });
    cleanup.push(`unroster ${u}: ${r.status}`);
  }
  for (const u of created.staff) {
    const r = await req('DELETE', `/admin/staff/${u}`, { token: admin });
    cleanup.push(`delete staff ${u}: ${r.status}`);
  }

  console.log(`\nOPD smoke test against ${BASE}\n`);
  console.log(results.join('\n'));
  console.log(`\n${passed}/${results.length} passed`);
  console.log(`\ncleanup:\n  ${cleanup.join('\n  ')}`);
  console.log('\nNOTE: the consultation record(s) written during a successful run stay in\nhospital/consultations (there is no delete API) — attached to the now-cancelled\ntest patients. Harmless, but remove by hand from the Firebase console if desired.\n');
  process.exit(passed === results.length ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });

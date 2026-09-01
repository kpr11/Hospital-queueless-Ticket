#!/usr/bin/env node
/**
 * End-to-end smoke test against a RUNNING backend (real Firebase, real HTTP).
 * Unlike the Jest suite (which mocks Firebase), this exercises the full stack.
 *
 *   BASE_URL=http://localhost:4000 ADMIN_USER=admin ADMIN_PASS=admin12345 \
 *     node scripts/smoke.js
 *
 * Exit 0 = all steps passed. Use as a post-deploy check (CI) or locally.
 * The full run creates one patient + token (test data — reset the queue after).
 * Pass --readonly (or SMOKE_READONLY=1) for CI: health + login + config only,
 * no data written.
 */
const BASE = (process.env.BASE_URL || 'http://localhost:4000').replace(/\/$/, '');
const API = `${BASE}/api/v1`;
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'admin12345';


let passed = 0;
const results = [];

async function step(name, fn) {
  try {
    await fn();
    results.push(`  ✓ ${name}`);
    passed += 1;
  } catch (e) {
    results.push(`  ✗ ${name}\n      ${e.message}`);
  }
}

async function req(method, path, { token, body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  return { status: res.status, json };
}

function assert(cond, msg) { if (!cond) throw new Error(msg); }

(async () => {
  let token;
  const mobile = '9' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0');
  let patientId;

  await step('GET /health returns ok', async () => {
    const { status, json } = await req('GET', '/health');
    assert(status === 200 && json.status === 'ok', `got ${status} ${JSON.stringify(json)}`);
  });

  await step('admin login returns a JWT', async () => {
    const { status, json } = await req('POST', '/auth/login', { body: { username: ADMIN_USER, password: ADMIN_PASS } });
    assert(status === 200 && json.token, `got ${status} ${JSON.stringify(json)}`);
    token = json.token;
  });

  await step('GET /config responds', async () => {
    const { status, json } = await req('GET', '/config');
    assert(status === 200 && json.industry, `got ${status} ${JSON.stringify(json)}`);
  });

  await step('GET /admin/queue (authenticated) responds', async () => {
    const { status } = await req('GET', '/admin/queue', { token });
    assert(status === 200, `got ${status}`);
  });

  if (process.argv.includes('--readonly') || process.env.SMOKE_READONLY === '1') {
    console.log(`\nSmoke test (read-only) against ${BASE}\n`);
    console.log(results.join('\n'));
    console.log(`\n${passed}/${results.length} passed\n`);
    process.exit(passed === results.length ? 0 : 1);
  }

  await step('industry can be set to medical', async () => {
    const { status } = await req('PUT', '/admin/config', { token, body: { industry: 'medical', orgName: 'Smoke Test Hospital' } });
    assert(status === 200, `got ${status}`);
  });

  await step('public patient registration', async () => {
    const { status, json } = await req('POST', '/patients/register', {
      body: {
        name: 'Smoke Test', age: 40, gender: 'other', mobile,
        address: '1 Test Rd', department: 'opd', consent: true,
      },
    });
    assert(status === 201 && json.patient?.id, `got ${status} ${JSON.stringify(json)}`);
    assert(json.patient.aadhaarHash === undefined, 'aadhaarHash present on new record');
    patientId = json.patient.id;
  });

  await step('public status endpoint (minimal, no address)', async () => {
    const { status, json } = await req('GET', `/patients/${patientId}/status`);
    assert(status === 200 && json.status === 'registered', `got ${status} ${JSON.stringify(json)}`);
    assert(json.address === undefined, 'status endpoint leaked the address');
  });

  await step('department desk issues a token by mobile number', async () => {
    const { status, json } = await req('POST', '/patients/verify-issue', {
      token, body: { mobile, department: 'opd' },
    });
    assert(status === 201 && json.token?.number > 0 && json.token.service === 'opd', `got ${status} ${JSON.stringify(json)}`);
  });

  await step('the issued token appears in the live queue', async () => {
    const { status, json } = await req('GET', '/admin/queue', { token });
    assert(status === 200, `got ${status}`);
    const all = [...(json.waiting || []), ...Object.values(json.nowServing || {})];
    assert(all.some(t => t.patientId === patientId), 'issued token not found in queue');
  });

  await step('an unknown mobile is rejected', async () => {
    const { status } = await req('POST', '/patients/verify-issue', { token, body: { mobile: '9000000000', department: 'opd' } });
    assert(status === 404 || status === 409, `expected 404/409, got ${status}`);
  });

  await step('patient endpoints reject anonymous access', async () => {
    const { status } = await req('GET', '/patients/registrations');
    assert(status === 401, `expected 401, got ${status}`);
  });

  console.log(`\nSmoke test against ${BASE}\n`);
  console.log(results.join('\n'));
  console.log(`\n${passed}/${results.length} passed\n`);
  process.exit(passed === results.length ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });

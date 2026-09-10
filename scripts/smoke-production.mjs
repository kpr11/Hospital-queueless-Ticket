import assert from 'node:assert/strict';
const base = process.argv[2];
if (!base?.startsWith('https://')) throw new Error('Supply the deployed HTTPS origin.');
const get = (path) => fetch(`${base}${path}`, { signal: AbortSignal.timeout(20000) });
for (const route of ['/', '/admin/login', '/staff/login', '/display']) {
  const response = await get(route);
  assert.equal(response.status, 200, route);
  assert.match(response.headers.get('content-type'), /text\/html/);
}
const health = await get('/api/v1/health');
assert.equal(health.status, 200);
assert.equal((await health.json()).status, 'ok');
assert.match(health.headers.get('cache-control'), /no-store/);
const queue = await get('/api/v1/queue/public');
assert.equal(queue.status, 200);
for (const token of Object.values((await queue.json()).tokens)) {
  for (const field of ['patientName', 'patientId', 'note', 'referralReason', 'referralHistory']) {
    assert.equal(field in token, false, `Public token leaks ${field}`);
  }
}
for (const route of ['/api/v1/queue/live', '/api/v1/admin/queue', '/api/v1/patients/registrations']) {
  assert.equal((await get(route)).status, 401, route);
}
console.log('Production smoke passed: SPA routes, API rewrite, health, private cache headers and access boundaries.');

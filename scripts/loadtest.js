#!/usr/bin/env node
/**
 * Dependency-free load test for the reception + display read path.
 *
 *   BASE_URL=http://localhost:4000 DURATION=20 CONCURRENCY=25 \
 *     node scripts/loadtest.js
 *
 * Hammers the endpoints a busy lobby actually hits: /config and /announcement
 * (customer + display polling), /health, and GET /admin/queue (dashboard).
 * Read-only — it does NOT issue tokens. Reports throughput + latency percentiles.
 */
const BASE = (process.env.BASE_URL || 'http://localhost:4000').replace(/\/$/, '');
const API = `${BASE}/api/v1`;
const DURATION = Number(process.env.DURATION || 15) * 1000;
const CONCURRENCY = Number(process.env.CONCURRENCY || 20);
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'admin12345';

const latencies = [];
let ok = 0;
let failed = 0;
let stop = false;

async function login() {
  try {
    const res = await fetch(`${API}/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: ADMIN_USER, password: ADMIN_PASS }),
    });
    return (await res.json()).token;
  } catch { return null; }
}

async function hit(url, token) {
  const t0 = performance.now();
  try {
    const res = await fetch(url, token ? { headers: { Authorization: `Bearer ${token}` } } : undefined);
    await res.text();
    latencies.push(performance.now() - t0);
    if (res.ok) ok += 1; else failed += 1;
  } catch {
    failed += 1;
  }
}

async function worker(token) {
  const endpoints = [
    `${API}/config`,
    `${API}/announcement`,
    `${API}/health`,
    `${API}/admin/queue`,
  ];
  let i = 0;
  while (!stop) {
    const url = endpoints[i % endpoints.length];
    await hit(url, url.includes('/admin/') ? token : undefined);
    i += 1;
  }
}

function pct(sorted, p) {
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

(async () => {
  const token = await login();
  console.log(`\nLoad test: ${BASE}  ·  ${CONCURRENCY} workers  ·  ${DURATION / 1000}s\n`);
  const start = performance.now();
  const workers = Array.from({ length: CONCURRENCY }, () => worker(token));
  setTimeout(() => { stop = true; }, DURATION);
  await Promise.all(workers);
  const elapsed = (performance.now() - start) / 1000;

  latencies.sort((a, b) => a - b);
  const total = ok + failed;
  console.log(`  requests     ${total}  (${(total / elapsed).toFixed(0)}/s)`);
  console.log(`  ok / failed  ${ok} / ${failed}`);
  console.log(`  latency ms   p50 ${pct(latencies, 50).toFixed(0)}  ·  p95 ${pct(latencies, 95).toFixed(0)}  ·  p99 ${pct(latencies, 99).toFixed(0)}  ·  max ${latencies[latencies.length - 1].toFixed(0)}`);
  console.log('');
  process.exit(failed / Math.max(1, total) > 0.01 ? 1 : 0);
})();

#!/usr/bin/env node
/**
 * Verify the DEPLOYED database rules do what we expect — run this after
 * `node firebase/deploy-rules.js`.
 *
 *   node firebase/verify-rules.js
 *
 * Connects as an unauthenticated client (like a browser visitor) using the
 * web config in frontend/.env.local and checks the allow/deny matrix.
 */
const fs = require('fs');
const path = require('path');

const FRONTEND = path.join(__dirname, '..', 'frontend');
const { initializeApp } = require(path.join(FRONTEND, 'node_modules', 'firebase', 'app'));
const { getDatabase, ref, get } = require(path.join(FRONTEND, 'node_modules', 'firebase', 'database'));

function webConfig() {
  const env = fs.readFileSync(path.join(FRONTEND, '.env.local'), 'utf8');
  const v = (k) => (env.match(new RegExp(`^${k}=(.+)$`, 'm')) || [])[1]?.trim();
  return {
    apiKey: v('VITE_FIREBASE_API_KEY'),
    authDomain: v('VITE_FIREBASE_AUTH_DOMAIN'),
    databaseURL: v('VITE_FIREBASE_DATABASE_URL'),
    projectId: v('VITE_FIREBASE_PROJECT_ID'),
  };
}

const EXPECT = [
  ['queue/state', 'allow'],
  ['queue/tokens', 'allow'],
  ['queue/announcement', 'allow'],
  ['presence', 'allow'],
  ['hospital/patients', 'deny'],
  ['queue/counter', 'deny'],
  ['admins', 'deny'],
  ['conversations', 'deny'],
];

(async () => {
  const db = getDatabase(initializeApp(webConfig()));
  let bad = 0;
  for (const [p, want] of EXPECT) {
    let got;
    try { await get(ref(db, p)); got = 'allow'; }
    catch { got = 'deny'; }
    const ok = got === want;
    if (!ok) bad += 1;
    console.log(`  ${ok ? '✓' : '✗'}  ${p.padEnd(22)} expected ${want}, got ${got}`);
  }
  console.log(bad === 0 ? '\nRules verified.\n' : `\n${bad} mismatch(es) — rules are NOT as expected.\n`);
  process.exit(bad === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });

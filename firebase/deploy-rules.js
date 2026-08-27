#!/usr/bin/env node
/**
 * Deploy database.rules.json to the RTDB using the backend service account.
 *
 *   node firebase/deploy-rules.js            # deploy the locked rules
 *   node firebase/deploy-rules.js --open     # revert to test-mode (open) rules
 *
 * Uses the RTDB REST API (`PUT /.settings/rules.json`) with an OAuth token
 * minted from backend/serviceAccount.json — no `firebase login` needed.
 * `firebase deploy --only database` (with GOOGLE_APPLICATION_CREDENTIALS) does
 * the same thing; this is a dependency-free fallback.
 */
const fs = require('fs');
const path = require('path');
const admin = require(path.join(__dirname, '..', 'backend', 'node_modules', 'firebase-admin'));

const SA_PATH = path.join(__dirname, '..', 'backend', 'serviceAccount.json');
const RULES_PATH = path.join(__dirname, 'database.rules.json');

function dbUrlFromEnv(projectId) {
  const envPath = path.join(__dirname, '..', 'backend', '.env');
  if (fs.existsSync(envPath)) {
    const m = fs.readFileSync(envPath, 'utf8').match(/^FIREBASE_DATABASE_URL=(.+)$/m);
    if (m) return m[1].trim().replace(/^["']|["']$/g, '');
  }
  return `https://${projectId}-default-rtdb.firebaseio.com`;
}

async function main() {
  const open = process.argv.includes('--open');
  const sa = JSON.parse(fs.readFileSync(SA_PATH, 'utf8'));
  const dbURL = dbUrlFromEnv(sa.project_id);

  const rules = open
    ? JSON.stringify({ rules: { '.read': true, '.write': true } }, null, 2)
    : fs.readFileSync(RULES_PATH, 'utf8');

  const credential = admin.cert(sa);
  const app = admin.initializeApp({ credential, databaseURL: dbURL });
  const { access_token } = await credential.getAccessToken();

  const res = await fetch(`${dbURL}/.settings/rules.json?access_token=${access_token}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: rules,
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(`[deploy-rules] FAILED ${res.status}: ${text}`);
    process.exit(1);
  }
  console.log(`[deploy-rules] ${open ? 'OPEN (test-mode)' : 'locked'} rules deployed to ${new URL(dbURL).host}`);
  await app.delete();
}

main().catch((e) => { console.error(e); process.exit(1); });

#!/usr/bin/env node
/**
 * Full RTDB backup → a timestamped JSON file.
 *
 *   node firebase/backup.js [outDir]     # default outDir: ./backups
 *
 * Uses the service account (backend/serviceAccount.json, or
 * GOOGLE_APPLICATION_CREDENTIALS in CI). Run on a schedule — see
 * .github/workflows/backup.yml.
 */
const fs = require('fs');
const path = require('path');
const admin = require(path.join(__dirname, '..', 'backend', 'node_modules', 'firebase-admin'));

const SA_PATH = process.env.GOOGLE_APPLICATION_CREDENTIALS
  || path.join(__dirname, '..', 'backend', 'serviceAccount.json');

function dbUrl(projectId) {
  const envPath = path.join(__dirname, '..', 'backend', '.env');
  if (fs.existsSync(envPath)) {
    const m = fs.readFileSync(envPath, 'utf8').match(/^FIREBASE_DATABASE_URL=(.+)$/m);
    if (m) return m[1].trim().replace(/^["']|["']$/g, '');
  }
  if (process.env.FIREBASE_DATABASE_URL) return process.env.FIREBASE_DATABASE_URL;
  return `https://${projectId}-default-rtdb.firebaseio.com`;
}

async function main() {
  const outDir = process.argv[2] || path.join(__dirname, '..', 'backups');
  fs.mkdirSync(outDir, { recursive: true });

  const sa = JSON.parse(fs.readFileSync(SA_PATH, 'utf8'));
  const url = dbUrl(sa.project_id);
  const credential = admin.cert(sa);
  const app = admin.initializeApp({ credential, databaseURL: url });
  const { access_token } = await credential.getAccessToken();

  const res = await fetch(`${url}/.json?access_token=${access_token}&format=export`);
  if (!res.ok) { console.error(`[backup] FAILED ${res.status}: ${await res.text()}`); process.exit(1); }
  const data = await res.text();

  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(outDir, `rtdb-${ts}.json`);
  fs.writeFileSync(file, data);
  console.log(`[backup] ${(data.length / 1024).toFixed(1)} KB → ${file}`);

  // Keep only the newest 14 local backups.
  const kept = fs.readdirSync(outDir).filter(f => f.startsWith('rtdb-')).sort().reverse();
  kept.slice(14).forEach(f => fs.unlinkSync(path.join(outDir, f)));

  await app.delete();
}

main().catch((e) => { console.error(e); process.exit(1); });

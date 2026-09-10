// Generates private deployment inputs outside the repository. Never prints values.
const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('../backend/node_modules/dotenv');
const output = process.argv[2];
if (!output) throw new Error('Usage: node scripts/prepare-gcp-env.cjs PRIVATE_TEMP_DIRECTORY');
const env = dotenv.parse(fs.readFileSync(path.join(__dirname, '../backend/.env.production')));
const project = process.env.GCP_PROJECT_ID || 'hospital-queueless-prod-kpr11';
const frontend = dotenv.parse(fs.readFileSync(path.join(__dirname, '../frontend/.env.production')));
if (frontend.VITE_FIREBASE_PROJECT_ID !== project || frontend.VITE_FIREBASE_DATABASE_URL !== env.FIREBASE_DATABASE_URL) {
  throw new Error('Frontend and backend must use the same production Firebase project and database.');
}
if (env.FIREBASE_PROJECT_ID !== project) throw new Error('Backend Firebase project does not match deployment target.');
if (!env.JWT_SECRET || env.JWT_SECRET.length < 32 || !env.ADMIN_PASSWORD || env.ADMIN_PASSWORD.length < 8) {
  throw new Error('Production needs a JWT secret of at least 32 characters and an admin password of at least 8 characters. Update backend/.env.production privately.');
}
fs.mkdirSync(output, { recursive: true, mode: 0o700 });
for (const key of ['JWT_SECRET', 'ADMIN_PASSWORD']) {
  fs.writeFileSync(path.join(output, key), env[key], { mode: 0o600 });
}
const settings = {
  NODE_ENV: 'production', TZ: 'Asia/Kolkata',
  FIREBASE_PROJECT_ID: project, FIREBASE_DATABASE_URL: env.FIREBASE_DATABASE_URL,
  CORS_ORIGIN: `https://${project}.web.app,https://${project}.firebaseapp.com`,
  FRONTEND_URL: `https://${project}.web.app`,
  ADMIN_USERNAME: env.ADMIN_USERNAME, ADMIN_RESET_ON_BOOT: 'false',
  INITIAL_INDUSTRY: 'medical', INITIAL_ORG_NAME: 'QueueLess Hospital',
  JWT_EXPIRES_IN: env.JWT_EXPIRES_IN || '8h', ANALYTICS_SINK: 'firebase',
};
for (const key of ['AVG_SERVICE_TIME_SECONDS', 'TOKEN_EXPIRY_SECONDS', 'PATIENT_REGISTRATION_TTL_HOURS']) {
  if (env[key]) settings[key] = env[key];
}
fs.writeFileSync(path.join(output, 'runtime.json'), JSON.stringify(settings), { mode: 0o600 });
console.log('Validated production settings; private deployment inputs prepared.');

// Run after creating the GCP project, linking billing and adding Firebase.
// Uses ADC; creates only the production database/web app and local private env.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { GoogleAuth } = require('../backend/node_modules/google-auth-library');

(async () => {
  const project = process.env.GCP_PROJECT_ID;
  if (!project || project === 'hospital-queueless-dev') throw new Error('Set GCP_PROJECT_ID to the fresh production project.');
  const client = await new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] }).getClient();
  const request = async (url, method = 'GET', data) => (await client.request({ url, method, data })).data;
  const dbBase = `https://firebasedatabase.googleapis.com/v1beta/projects/${project}/locations/asia-southeast1/instances`;
  const instances = await request(dbBase);
  let database = (instances.instances || [])[0];
  if (!database) {
    database = await request(`${dbBase}?databaseId=${project}-default-rtdb`, 'POST', { type: 'DEFAULT_DATABASE' });
  }
  const databaseUrl = database.databaseUrl;
  if (!databaseUrl) throw new Error('Database was not provisioned.');
  const appBase = `https://firebase.googleapis.com/v1beta1/projects/${project}/webApps`;
  let app = (await request(appBase)).apps?.[0];
  if (!app) {
    let operation = await request(appBase, 'POST', { displayName: 'QueueLess Production' });
    while (!operation.done) {
      await new Promise(resolve => setTimeout(resolve, 2000));
      operation = await request(`https://firebase.googleapis.com/v1beta1/${operation.name}`);
    }
    if (operation.error) throw new Error(operation.error.message);
    app = operation.response;
  }
  const web = await request(`${appBase}/${app.appId}/config`);
  const root = path.join(__dirname, '..');
  const frontend = {
    VITE_API_BASE_URL: '/api/v1', VITE_FIREBASE_API_KEY: web.apiKey,
    VITE_FIREBASE_AUTH_DOMAIN: web.authDomain, VITE_FIREBASE_PROJECT_ID: project,
    VITE_FIREBASE_DATABASE_URL: databaseUrl, VITE_FIREBASE_APP_ID: web.appId,
    VITE_FIREBASE_MESSAGING_SENDER_ID: web.messagingSenderId,
    VITE_FIREBASE_STORAGE_BUCKET: web.storageBucket || '',
    // Explicit blanks prevent Vite inheriting the development analytics ID.
    VITE_FIREBASE_MEASUREMENT_ID: '',
  };
  fs.writeFileSync(path.join(root, 'frontend/.env.production'), Object.entries(frontend)
    .map(([key, value]) => `${key}=${value || ''}`).join('\n') + '\n', { mode: 0o600 });
  const backendFile = path.join(root, 'backend/.env.production');
  if (!fs.existsSync(backendFile)) {
    const backend = {
      FIREBASE_PROJECT_ID: project, FIREBASE_DATABASE_URL: databaseUrl,
      JWT_SECRET: crypto.randomBytes(48).toString('base64url'),
      ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: crypto.randomBytes(24).toString('base64url'),
    };
    fs.writeFileSync(backendFile, Object.entries(backend).map(([key, value]) => `${key}=${value}`).join('\n') + '\n', { mode: 0o600 });
  }
  console.log(`Production Firebase provisioned: ${project}. Private environment files generated; credentials were not printed.`);
})().catch(error => { console.error(error.message); process.exitCode = 1; });

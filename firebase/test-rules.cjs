const fs = require('node:fs');
const path = require('node:path');
const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');

(async () => {
  const environment = await initializeTestEnvironment({
    projectId: 'demo-queueless',
    database: { host: '127.0.0.1', port: 9000, rules: fs.readFileSync(path.join(__dirname, 'database.rules.json'), 'utf8') },
  });
  try {
    await environment.withSecurityRulesDisabled(async context => {
      await context.database().ref().set({
        queue: { state: { status: 'running' }, tokens: { privateToken: { patientName: 'Test Patient', note: 'private' } } },
        hospital: { patients: { privatePatient: { mobile: '9000000000' } } },
      });
    });
    for (const context of [environment.unauthenticatedContext(), environment.authenticatedContext('untrusted-user')]) {
      const db = context.database();
      for (const location of ['/', 'queue', 'queue/tokens', 'queue/tokens/privateToken', 'hospital', 'hospital/patients', 'admins', 'staff', 'analytics/events', 'conversations', 'uploads']) {
        await assertFails(db.ref(location).once('value'));
      }
      await assertSucceeds(db.ref('queue/state').once('value'));
      await assertSucceeds(db.ref('queue/announcement').once('value'));
      await assertFails(db.ref('queue/state').set({ status: 'paused' }));
      await assertFails(db.ref('presence/victim').set({ username: 'victim', online: true, lastSeen: Date.now(), service: 'opd' }));
      await assertFails(db.ref('queue/tokens/privateToken').remove());
    }
    console.log('Database rules passed: anonymous and untrusted authenticated clients cannot access patient/token content or mutate presence.');
    // Exercise actual RTDB retry semantics, beyond the backend's in-memory mock.
    const crypto = require('node:crypto');
    Object.assign(process.env, {
      NODE_ENV: 'test', CORS_ORIGIN: 'http://localhost',
      JWT_SECRET: 'emulator-only-secret-longer-than-thirty-two-characters',
      ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: 'emulator-password',
      FIREBASE_PROJECT_ID: 'demo-queueless',
      FIREBASE_DATABASE_URL: 'https://demo-queueless.firebaseio.com',
      FIREBASE_DATABASE_EMULATOR_HOST: '127.0.0.1:9000',
      FIREBASE_CLIENT_EMAIL: 'emulator@demo-queueless.iam.gserviceaccount.com',
      FIREBASE_PRIVATE_KEY: crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }),
      ANALYTICS_SINK: 'firebase',
    });
    const queue = require('../backend/src/services/queue.service');
    const { db: adminDb, admin } = require('../backend/src/config/firebase');
    try {
      await queue.ensureInitialized();
      await queue.resetQueue();
      await queue.issueToken({ service: 'opd' });
      await queue.issueToken({ service: 'opd' });
      const results = await Promise.all([queue.callNextToken('opd'), queue.callNextToken('opd')]);
      require('node:assert/strict').equal(new Set(results.map(result => result.called.id)).size, 2);
      const records = Object.values((await adminDb.ref('queue/tokens').once('value')).val());
      require('node:assert/strict').equal(records.filter(record => record.status === 'called').length, 1);
      console.log('Real RTDB transactions passed: concurrent calls selected distinct tokens.');
    } finally {
      await Promise.all(admin.getApps().map(app => app.delete()));
    }
  } finally {
    await environment.cleanup();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

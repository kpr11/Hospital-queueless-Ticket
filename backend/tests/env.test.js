const { spawnSync } = require('node:child_process');
const path = require('node:path');

const base = {
  PATH: process.env.PATH,
  NODE_ENV: 'production', CORS_ORIGIN: 'https://example.web.app',
  JWT_SECRET: 'test-secret-that-is-longer-than-thirty-two-characters',
  ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: 'test-password-123',
  FIREBASE_PROJECT_ID: 'test-project', FIREBASE_DATABASE_URL: 'https://test.firebaseio.com',
};
function check(extra) {
  return spawnSync(process.execPath, ['-e', `require(${JSON.stringify(path.resolve(__dirname, '../src/config/env.js'))})`],
    { env: { ...base, ...extra }, cwd: '/tmp', encoding: 'utf8' });
}
test('production supports ambient Cloud Run credentials and Firebase analytics', () => {
  expect(check({ ANALYTICS_SINK: 'firebase' }).status).toBe(0);
});
test('rejects incomplete explicit Firebase credentials', () => {
  expect(check({ FIREBASE_CLIENT_EMAIL: 'test@test.iam.gserviceaccount.com' }).status).toBe(1);
});
test('rejects malformed explicit private keys', () => {
  expect(check({ FIREBASE_CLIENT_EMAIL: 'test@test.iam.gserviceaccount.com', FIREBASE_PRIVATE_KEY: 'bad' }).status).toBe(1);
});

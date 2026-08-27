require('dotenv').config();
const Joi = require('joi');

const envSchema = Joi.object({
  PORT: Joi.number().default(4000),
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
  CORS_ORIGIN: Joi.string().required(),

  JWT_SECRET: Joi.string().min(32).required(),
  JWT_EXPIRES_IN: Joi.string().default('8h'),

  ADMIN_USERNAME: Joi.string().required(),
  ADMIN_PASSWORD: Joi.string().min(8).required(),
  // Break-glass: when true, the bootstrap admin's password is reset to
  // ADMIN_PASSWORD on every boot (even if the account already exists). Use it
  // to recover a locked-out account, then set it back to false and redeploy.
  ADMIN_RESET_ON_BOOT: Joi.boolean().truthy('true').falsy('false').default(false),

  // Optional: POST 5xx errors as JSON to this URL (Slack/Discord webhook, a
  // log collector, or a Sentry proxy). Left blank = console logging only.
  ERROR_WEBHOOK_URL: Joi.string().uri().allow('').optional(),

  FIREBASE_PROJECT_ID: Joi.string().required(),
  FIREBASE_CLIENT_EMAIL: Joi.string().email().required(),
  FIREBASE_PRIVATE_KEY: Joi.string().required(),
  FIREBASE_DATABASE_URL: Joi.string().uri().required(),

  AVG_SERVICE_TIME_SECONDS: Joi.number().integer().positive().default(180),
  TOKEN_EXPIRY_SECONDS: Joi.number().integer().positive().default(3600),

  // Hospital patient registrations that never check in at a department desk are
  // marked "expired" after this many hours.
  PATIENT_REGISTRATION_TTL_HOURS: Joi.number().integer().positive().default(12),

  ANALYTICS_SINK: Joi.string().valid('csv', 'mongo').default('csv'),
  ANALYTICS_CSV_PATH: Joi.string().default('../analytics/data/queue_events.csv'),
  ANALYTICS_MODEL_PATH: Joi.string().default('../analytics/models/predictions.json'),

  MONGO_URI: Joi.string().when('ANALYTICS_SINK', {
    is: 'mongo', then: Joi.required(), otherwise: Joi.optional()
  }),
  MONGO_DB: Joi.string().default('queueless'),
  MONGO_COLLECTION: Joi.string().default('queue_events'),
  MONGO_TOKENS_COLLECTION: Joi.string().default('tokens'),

  // Email (optional - if omitted, token emails are silently skipped)
  SMTP_HOST: Joi.string().optional(),
  SMTP_PORT: Joi.number().integer().default(587),
  SMTP_USER: Joi.string().optional(),
  SMTP_PASS: Joi.string().optional(),
  SMTP_FROM: Joi.string().default('noreply@queueless.app'),

  // Frontend URL used to generate token tracking links in emails
  FRONTEND_URL: Joi.string().uri().default('http://localhost:5173'),

  // AI assistant (all optional; defaults to the zero-config grounded provider).
  AI_PROVIDER: Joi.string().valid('grounded', 'openai', 'groq', 'openrouter', 'ollama', 'gemini').default('grounded'),
  AI_API_KEY: Joi.string().allow('').optional(),
  AI_MODEL: Joi.string().allow('').optional(),
  AI_BASE_URL: Joi.string().allow('').optional(),

  // Keying material for hashing Aadhaar numbers (HMAC-SHA256). Optional — falls
  // back to JWT_SECRET. Set a dedicated value so rotating the JWT secret does
  // not orphan every stored patient record.
  AADHAAR_SALT: Joi.string().allow('').optional(),
}).unknown(true);

const { value: env, error } = envSchema.validate(process.env, { abortEarly: false });

if (error) {
  console.error('[env] Configuration validation failed:');
  error.details.forEach(d => console.error(`  - ${d.message}`));
  process.exit(1);
}

// Normalise the Firebase private key. Different hosts / paste habits produce
// different shapes; accept them all:
//  - surrounding single or double quotes (common when pasting from JSON)
//  - literal "\n" two-char sequences (dotenv / most dashboards)
//  - real newlines (Render/Heroku multi-line values) — left as-is
//  - stray \r from Windows clipboards
const firebasePrivateKey = env.FIREBASE_PRIVATE_KEY
  .trim()
  .replace(/^["']|["']$/g, '')
  .replace(/\\n/g, '\n')
  .replace(/\r/g, '');

if (!/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]+-----END [A-Z ]*PRIVATE KEY-----/.test(firebasePrivateKey)) {
  console.error('[env] FIREBASE_PRIVATE_KEY does not look like a PEM key. Paste the value of "private_key" from the service-account JSON, keeping the \\n sequences, without the surrounding quotes.');
  process.exit(1);
}

module.exports = {
  port: env.PORT,
  nodeEnv: env.NODE_ENV,
  isProduction: env.NODE_ENV === 'production',
  corsOrigin: env.CORS_ORIGIN,

  jwt: {
    secret: env.JWT_SECRET,
    expiresIn: env.JWT_EXPIRES_IN,
  },

  bootstrapAdmin: {
    username: env.ADMIN_USERNAME,
    password: env.ADMIN_PASSWORD,
    resetOnBoot: env.ADMIN_RESET_ON_BOOT,
  },

  errorWebhookUrl: env.ERROR_WEBHOOK_URL || null,

  firebase: {
    projectId: env.FIREBASE_PROJECT_ID,
    clientEmail: env.FIREBASE_CLIENT_EMAIL,
    privateKey: firebasePrivateKey,
    databaseURL: env.FIREBASE_DATABASE_URL,
  },

  queue: {
    avgServiceTimeSeconds: env.AVG_SERVICE_TIME_SECONDS,
    tokenExpirySeconds: env.TOKEN_EXPIRY_SECONDS,
  },

  patient: {
    registrationTtlHours: env.PATIENT_REGISTRATION_TTL_HOURS,
  },

  analytics: {
    sink: env.ANALYTICS_SINK,
    csvPath: env.ANALYTICS_CSV_PATH,
    modelPath: env.ANALYTICS_MODEL_PATH,
    mongo: {
      uri: env.MONGO_URI,
      db: env.MONGO_DB,
      collection: env.MONGO_COLLECTION,
      tokensCollection: env.MONGO_TOKENS_COLLECTION,
    },
  },

  email: {
    host: env.SMTP_HOST || null,
    port: env.SMTP_PORT,
    user: env.SMTP_USER || null,
    pass: env.SMTP_PASS || null,
    from: env.SMTP_FROM,
  },

  frontendUrl: env.FRONTEND_URL,

  aadhaarSalt: env.AADHAAR_SALT || null,

  ai: {
    provider: env.AI_PROVIDER,
    apiKey: env.AI_API_KEY || null,
    model: env.AI_MODEL || null,
    baseUrl: env.AI_BASE_URL || null,
  },
};

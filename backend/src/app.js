const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const { version } = require('../package.json');

const config = require('./config/env');
const routes = require('./routes');
const { errorHandler, notFound } = require('./middleware/errorHandler');

function buildApp() {
  const app = express();

  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(helmet());
  // Never let Hosting/CDN or browser caches retain patient/API responses.
  app.use('/api', (_req, res, next) => {
    res.set('Cache-Control', 'private, no-store');
    next();
  });
  app.use(cors({
    origin: config.corsOrigin.split(',').map(s => s.trim()),
    credentials: false,
  }));
  // Messaging endpoints accept small inline attachments, so they get a larger
  // JSON limit; everything else stays tight at 10kb. This scoped parser runs
  // first for /conversations, so the global 10kb parser skips those paths.
  app.use('/api/v1/conversations', express.json({ limit: '512kb' }));
  app.use('/api/v1/uploads', express.json({ limit: '4mb' })); // 2MB file ≈ 2.7MB base64
  app.use(express.json({ limit: '10kb' }));
  app.use(express.urlencoded({ extended: false, limit: '10kb' }));

  if (config.nodeEnv === 'development') app.use(morgan('dev'));
  else if (config.isProduction) app.use(morgan(':method :status :response-time ms'));

  // Brute-force protection for the login endpoint.
  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many login attempts. Please retry in 15 minutes.' },
  });
  app.use('/api/v1/auth/login', loginLimiter);

  const takeTokenLimiter = rateLimit({
    skip: req => req.method !== 'POST',
    windowMs: 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Slow down - too many token requests from this address.' },
  });
  app.use('/api/v1/tokens', takeTokenLimiter);

  app.get('/', (req, res) => {
    res.json({
      message: 'Welcome to the QueueLess API server.',
      version,
      status: 'active',
    });
  });

  app.use('/api/v1', routes);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}

module.exports = buildApp;

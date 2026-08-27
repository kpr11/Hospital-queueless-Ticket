const config = require('../config/env');
const { reportError } = require('../utils/reportError');

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const status = err.statusCode || 500;

  if (status >= 500) {
    reportError({
      source: 'backend',
      message: `${req.method} ${req.originalUrl} -> ${status}: ${err.message}`,
      stack: err.stack,
      context: { method: req.method, path: req.originalUrl, status, user: req.user?.sub || null },
    });
  } else if (!config.isProduction) {
    console.error(`[error] ${req.method} ${req.originalUrl} -> ${status}: ${err.message}`);
  }

  const payload = { error: err.message || 'Internal server error.' };
  if (!config.isProduction && status >= 500) payload.stack = err.stack;
  res.status(status).json(payload);
}

function notFound(req, res) {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.originalUrl}` });
}

module.exports = { errorHandler, notFound };

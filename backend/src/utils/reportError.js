/**
 * Minimal error reporting. Logs structured JSON (so Render / any log collector
 * can parse it) and, if ERROR_WEBHOOK_URL is set, POSTs the event there
 * (Slack/Discord incoming webhooks, a log endpoint, or a Sentry proxy all work).
 *
 * Deliberately dependency-free. To use Sentry directly, swap the fetch call
 * below for `Sentry.captureException`.
 */
const config = require('../config/env');

let recent = 0;
let windowStart = Date.now();

function rateLimited() {
  const now = Date.now();
  if (now - windowStart > 60_000) { windowStart = now; recent = 0; }
  recent += 1;
  return recent > 30; // at most 30 forwarded events/min
}

function reportError({ source = 'backend', message, stack = null, context = {} }) {
  const event = {
    level: 'error',
    source,
    message: String(message || 'unknown error').slice(0, 2000),
    stack: stack ? String(stack).slice(0, 8000) : undefined,
    context,
    env: config.nodeEnv,
    at: new Date().toISOString(),
  };

  console.error(JSON.stringify({ tag: 'error_report', ...event }));

  if (config.errorWebhookUrl && !rateLimited()) {
    const isChat = /hooks\.slack\.com|discord(app)?\.com\/api\/webhooks/.test(config.errorWebhookUrl);
    const body = isChat
      ? JSON.stringify({ text: `:rotating_light: *${source}* ${event.message}\n\`\`\`${(event.stack || '').slice(0, 900)}\`\`\`` })
      : JSON.stringify(event);
    fetch(config.errorWebhookUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
      .catch((e) => console.error('[reportError] webhook failed:', e.message));
  }
}

module.exports = { reportError };

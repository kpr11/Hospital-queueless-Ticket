import { api } from './api/client.js';

/**
 * Best-effort browser error beacon → POST /api/v1/client-error (rate-limited,
 * public). Deduplicated so a render loop can't hammer the backend.
 */
const seen = new Set();

export function reportClientError({ message, stack, componentStack }) {
  try {
    const key = String(message || '').slice(0, 120);
    if (!key || seen.has(key)) return;
    seen.add(key);
    if (seen.size > 50) seen.clear();

    api.post('/client-error', {
      message: String(message || 'client error').slice(0, 500),
      stack: stack ? String(stack).slice(0, 4000) : undefined,
      componentStack: componentStack ? String(componentStack).slice(0, 4000) : undefined,
      url: window.location.pathname + window.location.search,
    }).catch(() => {});
  } catch {
    /* never let error reporting throw */
  }
}

/** Install window-level handlers. Call once at app startup. */
export function installGlobalErrorReporting() {
  window.addEventListener('error', (e) => {
    reportClientError({ message: e.message, stack: e.error?.stack });
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason;
    reportClientError({ message: `unhandledrejection: ${r?.message || r}`, stack: r?.stack });
  });
}

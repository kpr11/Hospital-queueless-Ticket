import axios from 'axios';

const baseURL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000/api/v1';

export const api = axios.create({
  baseURL,
  timeout: 10_000,
  headers: { 'Content-Type': 'application/json' },
});

export const ADMIN_TOKEN_KEY = 'queueless.adminToken';
export const STAFF_TOKEN_KEY  = 'queueless.staffToken';
// Legacy alias kept for AuthContext compatibility
export const TOKEN_KEY = ADMIN_TOKEN_KEY;

api.interceptors.request.use((config) => {
  const url = config.url || '';
  // Staff routes must always use the staff JWT (it carries the `service` claim).
  // `staffAuth: true` forces the staff JWT for identity-sensitive calls that
  // live outside the /staff/ prefix (roster availability, consultations) — so a
  // stale admin token left in the same browser can't act as the wrong person.
  // Everything else uses the admin token first, falling back to the staff token.
  const forceStaff = url.startsWith('/staff/') || config.staffAuth === true;
  const token = forceStaff
    ? (localStorage.getItem(STAFF_TOKEN_KEY) || localStorage.getItem(ADMIN_TOKEN_KEY))
    : (localStorage.getItem(ADMIN_TOKEN_KEY) || localStorage.getItem(STAFF_TOKEN_KEY));
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    // On a 401, clear ONLY the token that was used — localStorage is shared
    // across tabs, so nuking both would sign a staff tab out when an admin
    // tab's token lapses (and vice versa). Redirect only if the current page
    // belongs to that portal.
    if (err.response?.status === 401) {
      const cfg = err.config || {};
      const url = cfg.url || '';
      const path = typeof window !== 'undefined' ? window.location.pathname : '';
      const usedStaffToken = url.startsWith('/staff/') || cfg.staffAuth === true;

      if (usedStaffToken) {
        localStorage.removeItem(STAFF_TOKEN_KEY);
        localStorage.removeItem('queueless.staffUser');
        if (path.startsWith('/staff') || path === '/kiosk') window.location.href = '/staff/login';
      } else if (url.startsWith('/admin/')) {
        localStorage.removeItem(ADMIN_TOKEN_KEY);
        localStorage.removeItem('queueless.adminUser');
        if (path.startsWith('/admin')) window.location.href = '/admin/login';
      }
      // 401 on a shared route (/roster, /consultations, /patients, /config …)
      // with the admin-first fallback token: leave both sessions alone — the
      // session watchdog and the next real /admin or /staff call handle it.
    }
    return Promise.reject(err);
  }
);

import { useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useStaff } from '../context/StaffContext.jsx';
import { ADMIN_TOKEN_KEY, STAFF_TOKEN_KEY } from '../services/api.js';

const CHECK_INTERVAL_MS = 30_000;

/** Decode a JWT's expiry (seconds epoch) without verifying — display-only use. */
function tokenExpiry(token) {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return typeof payload.exp === 'number' ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

/**
 * Session expiry watchdog. Checks the stored admin/staff JWTs on mount and
 * every 30 s; when a token has expired it signs the user out and redirects to
 * the matching login screen.
 *
 * Route-scoped so it never cross-fires: on a /staff page it only watches the
 * staff session, on an /admin page only the admin session. localStorage is
 * shared across tabs, so a dead admin token must not bounce a staff tab (and
 * vice versa).
 */
export function useSessionExpiry() {
  const { user, logout } = useAuth();
  const { staff, logout: staffLogout } = useStaff();
  const navigate = useNavigate();
  const loc = useLocation();

  useEffect(() => {
    if (!user && !staff) return;

    const path = loc.pathname;
    const onAdmin = path.startsWith('/admin');
    const onStaff = path.startsWith('/staff') || path === '/kiosk';

    const check = () => {
      const now = Date.now();

      // Watch the admin session unless we're on a staff-portal page.
      if (user && !onStaff) {
        const token = localStorage.getItem(ADMIN_TOKEN_KEY);
        const exp = token ? tokenExpiry(token) : 0;
        if (!token || (exp && exp <= now)) {
          logout();
          if (onAdmin) navigate('/admin/login', { replace: true, state: { sessionExpired: true } });
          return;
        }
      }

      // Watch the staff session unless we're on an admin-portal page.
      if (staff && !onAdmin) {
        const token = localStorage.getItem(STAFF_TOKEN_KEY);
        const exp = token ? tokenExpiry(token) : 0;
        if (!token || (exp && exp <= now)) {
          staffLogout();
          if (onStaff) navigate('/staff/login', { replace: true, state: { sessionExpired: true } });
        }
      }
    };

    check();
    const id = setInterval(check, CHECK_INTERVAL_MS);
    return () => clearInterval(id);
  }, [user, staff, logout, staffLogout, navigate, loc.pathname]);
}

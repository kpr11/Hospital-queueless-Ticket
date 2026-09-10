import { useEffect } from 'react';
import { api } from '../services/api/client.js';

export function usePresence(username, service) {
  useEffect(() => {
    if (!username) return;
    const config = { staffAuth: service !== 'admin' };
    const heartbeat = () => api.post('/presence', { online: true }, config).catch(() => {});
    heartbeat();
    const timer = setInterval(heartbeat, 30000);
    return () => {
      clearInterval(timer);
      api.post('/presence', { online: false }, config).catch(() => {});
    };
  }, [username, service]);
}

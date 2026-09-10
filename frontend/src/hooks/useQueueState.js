import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { api } from '../services/api/client.js';

// Private tokens are served by the authenticated API. Public pages receive an
// allowlisted snapshot. Schedule after completion so slow requests never overlap.
export function useQueueState() {
  const { pathname } = useLocation();
  const privateView = pathname.startsWith('/admin') || pathname.startsWith('/staff') || pathname === '/reception';
  const staffAuth = pathname.startsWith('/staff');
  const [data, setData] = useState({ state: null, tokens: {}, announcement: null, loading: true, error: null });

  useEffect(() => {
    const controller = new AbortController();
    let timer;
    setData({ state: null, tokens: {}, announcement: null, loading: true, error: null });
    async function refresh() {
      try {
        const { data: snapshot } = await api.get(privateView ? '/queue/live' : '/queue/public', {
          signal: controller.signal, staffAuth,
        });
        if (!controller.signal.aborted) setData({ ...snapshot, loading: false, error: null });
      } catch (err) {
        if (!controller.signal.aborted) setData(d => ({ ...d, tokens: {}, error: err.message, loading: false }));
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(refresh, 3000);
      }
    }
    refresh();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [privateView, staffAuth]);
  return data;
}

export function useTokenLive(tokenId) {
  const [token, setToken] = useState(null);
  useEffect(() => {
    setToken(null);
    if (!tokenId) return;
    const controller = new AbortController();
    let timer;
    async function refresh() {
      try {
        const { data } = await api.get(`/tokens/${tokenId}`, { signal: controller.signal });
        if (!controller.signal.aborted) setToken(data);
      } catch {
        // A transient connection failure must not discard a patient's token.
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(refresh, 5000);
      }
    }
    refresh();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [tokenId]);
  return token;
}

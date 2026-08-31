import { useCallback, useEffect, useState } from 'react';
import { Navigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { apiListStaff, apiGetRoster, apiAddRosterDoctor, apiRemoveRosterDoctor } from '../services/api.js';

const DEPT = 'opd';

export default function AdminRoster() {
  const { user } = useAuth();

  const [staff, setStaff] = useState([]);
  const [roster, setRoster] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const [pick, setPick] = useState('');
  const [room, setRoom] = useState('');

  const load = useCallback(() => {
    Promise.all([apiListStaff(), apiGetRoster(DEPT)])
      .then(([s, r]) => { setStaff(s || []); setRoster(r); })
      .catch(() => setError('Could not load the roster.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(() => apiGetRoster(DEPT).then(setRoster).catch(() => {}), 10000);
    return () => clearInterval(id);
  }, [load]);

  if (!user) return <Navigate to="/admin/login" replace />;

  const opdStaff = staff.filter(s => s.service === DEPT);
  const onRoster = new Set((roster?.doctors || []).map(d => d.username));
  const available = opdStaff.filter(s => !onRoster.has(s.username));

  const add = async () => {
    if (!pick || !room.trim()) { setError('Pick a doctor and enter a room number.'); return; }
    setBusy(true);
    setError(null);
    try {
      const doc = opdStaff.find(s => s.username === pick);
      const r = await apiAddRosterDoctor({ username: pick, name: doc?.displayName, room: room.trim(), department: DEPT });
      setRoster(r.roster);
      setPick('');
      setRoom('');
    } catch (e) {
      setError(e.response?.data?.error || 'Could not add to the roster.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (username) => {
    setBusy(true);
    try {
      const r = await apiRemoveRosterDoctor(username, DEPT);
      setRoster(r.roster);
    } catch (e) {
      setError(e.response?.data?.error || 'Could not remove.');
    } finally {
      setBusy(false);
    }
  };

  const doctors = roster?.doctors || [];
  const availableCount = doctors.filter(d => d.status === 'available').length;

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 xl:px-10 py-12">
      <div className="flex items-start justify-between flex-wrap gap-4 mb-8">
        <div>
          <div className="label">Admin · OPD</div>
          <h1 className="font-display text-5xl tracking-tightest leading-none mt-2">Today’s roster</h1>
          <p className="mt-3 text-graphite text-sm max-w-lg">
            Add the OPD doctors on duty today and their room numbers. New patient tokens
            are handed to the <span className="font-medium text-ink">available</span> doctors
            in room order, round-robin. Doctors mark themselves available from their queue page.
          </p>
        </div>
        <Link to="/admin" className="btn-secondary text-sm">Back to dashboard</Link>
      </div>

      {error && <div className="mb-6 p-4 border border-accent bg-accent/5 text-accent-deep text-sm">{error}</div>}

      {loading ? (
        <div className="animate-pulse text-graphite text-sm">Loading…</div>
      ) : (
        <>
          <div className="flex items-center gap-6 mb-6 text-sm">
            <span><span className="font-display text-2xl num mr-1">{doctors.length}</span> on roster</span>
            <span className="text-success"><span className="font-display text-2xl num mr-1">{availableCount}</span> available now</span>
            <span className="text-graphite">{roster?.date}</span>
          </div>

          {/* Add a doctor */}
          {opdStaff.length === 0 ? (
            <div className="mb-8 p-4 border border-warn bg-warn/5 text-warn text-sm">
              No staff accounts are assigned to OPD yet. Create them under{' '}
              <Link to="/admin/staff" className="underline">Staff</Link> (assigned service = OPD), then come back here.
            </div>
          ) : (
            <div className="mb-8 border border-rule bg-cream p-4 flex flex-col sm:flex-row gap-3 sm:items-end">
              <label className="flex-1">
                <span className="label block mb-1">Doctor</span>
                <select
                  value={pick}
                  onChange={e => setPick(e.target.value)}
                  className="w-full border border-rule bg-paper px-3 py-2.5 text-sm focus:outline-none focus:border-ink"
                >
                  <option value="">Select a doctor…</option>
                  {available.map(s => (
                    <option key={s.username} value={s.username}>{s.displayName || s.username}</option>
                  ))}
                </select>
              </label>
              <label className="w-full sm:w-32">
                <span className="label block mb-1">Room</span>
                <input
                  value={room}
                  onChange={e => setRoom(e.target.value)}
                  placeholder="e.g. 3"
                  className="w-full border border-rule bg-paper px-3 py-2.5 text-sm focus:outline-none focus:border-ink"
                />
              </label>
              <button onClick={add} disabled={busy || !pick} className="btn-primary text-sm disabled:opacity-40">Add</button>
            </div>
          )}

          {/* Roster list */}
          {doctors.length === 0 ? (
            <div className="text-center py-10 border border-rule text-graphite text-sm">
              No doctors on today’s roster yet.
            </div>
          ) : (
            <div className="border border-rule divide-y divide-rule bg-cream">
              {doctors.map(d => (
                <div key={d.username} className="px-4 py-3 flex items-center justify-between gap-3 text-sm">
                  <div className="min-w-0">
                    <span className="font-medium text-ink">{d.name || d.username}</span>
                    <span className="text-graphite"> · Room {d.room}</span>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className={`text-[10px] tracking-[0.15em] uppercase px-2 py-0.5 border ${
                      d.status === 'available' ? 'text-success border-success/40' : 'text-graphite border-rule'
                    }`}>
                      {d.status === 'available' ? 'Available' : 'Off'}
                    </span>
                    <button
                      onClick={() => remove(d.username)}
                      disabled={busy}
                      className="text-xs underline text-accent-deep hover:text-accent disabled:opacity-40"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

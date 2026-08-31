import { useEffect, useState, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQueueState } from '../hooks/useQueueState.js';
import { useAppConfig } from '../hooks/useAppConfig.js';
import { getServices, getServiceLabel } from '../utils/industry.js';
import { apiGetRosterPublic } from '../services/api.js';

export default function Display() {
  const { state, tokens, announcement } = useQueueState();
  const cfg = useAppConfig();
  const [params] = useSearchParams();

  // ?dept=opd  (or ?dept=opd,cardiology) narrows the board to one area — handy
  // for a screen mounted outside a specific department. No param = every counter.
  const allServices = getServices(cfg.industry);
  const wanted = (params.get('dept') || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  const services = wanted.length
    ? allServices.filter(s => wanted.includes(s.id))
    : allServices;
  const single = services.length === 1 ? services[0] : null;

  const [time, setTime] = useState(new Date());
  const [flashId, setFlashId] = useState(null);
  const [rooms, setRooms] = useState([]);
  const prevCalledRef = useRef({});
  const flashTimerRef = useRef(null);

  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // OPD runs multiple rooms — pull the (PII-free) room list so the board can
  // show a "now serving" per room.
  const showRooms = single?.id === 'opd';
  useEffect(() => {
    if (!showRooms) { setRooms([]); return; }
    const load = () => apiGetRosterPublic('opd').then(d => setRooms(d.rooms || [])).catch(() => {});
    load();
    const id = setInterval(load, 12000);
    return () => clearInterval(id);
  }, [showRooms]);

  const tokenList = Object.values(tokens || {});
  const isPaused = state?.status === 'paused';

  // Flash animation when a new token is called
  useEffect(() => {
    tokenList.forEach(t => {
      if (t.status === 'called' && prevCalledRef.current[t.service] !== t.id) {
        prevCalledRef.current[t.service] = t.id;
        clearTimeout(flashTimerRef.current);
        setFlashId(t.id);
        flashTimerRef.current = setTimeout(() => setFlashId(null), 2000);
      }
    });
  }, [tokens]);

  const priorityWaiting = tokenList.filter(t => t.status === 'waiting' && t.priority === 'priority');
  const priorityCalled = tokenList.find(t => t.status === 'called' && t.priority === 'priority');

  const inScope = (t) => !wanted.length || wanted.includes(t.service);

  return (
    <div className="min-h-screen bg-ink text-paper flex flex-col select-none">
      {/* Announcement banner */}
      {announcement?.message && (
        <div className="px-8 py-3 bg-warn text-ink text-sm font-medium text-center tracking-wide">
          {announcement.message}
        </div>
      )}

      {/* Display message (permanent welcome message from admin settings) */}
      {cfg.displayMessage && (
        <div className="px-8 py-2.5 border-b border-teal-500/30 bg-teal-900/20 text-teal-200 text-sm text-center tracking-wide">
          {cfg.displayMessage}
        </div>
      )}

      {/* Top bar */}
      <div className="flex items-center justify-between px-8 py-5 border-b border-paper/10">
        <div>
          <span className="text-xs tracking-[0.18em] uppercase text-paper/50">{cfg.orgName}</span>
          <span className="ml-3 text-xs text-paper/30">
            · {single ? `${single.title} — Queue Display` : 'Queue Display'}
          </span>
        </div>
        <div className="flex items-center gap-4">
          {isPaused && (
            <span className="text-xs px-3 py-1 border border-warn/50 text-warn">Queue paused</span>
          )}
          {priorityWaiting.filter(inScope).length > 0 && (
            <span className="text-xs px-3 py-1 border border-warn/50 text-warn flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-warn animate-pulse" />
              {priorityWaiting.filter(inScope).length} priority waiting
            </span>
          )}
          <span className="font-mono text-paper/50 text-sm">{time.toLocaleTimeString()}</span>
        </div>
      </div>

      {/* Priority section (hidden in single-department view unless it's the one in scope) */}
      {(priorityCalled || priorityWaiting.length > 0) && (!wanted.length || priorityWaiting.some(inScope) || (priorityCalled && inScope(priorityCalled))) && (
        <div className="mx-8 mt-6 border border-warn/40 bg-warn/10 p-5">
          <div className="flex items-center gap-2 mb-3">
            <span className="w-2 h-2 rounded-full bg-warn animate-pulse" />
            <span className="text-xs tracking-[0.18em] uppercase text-warn font-medium">Priority counter</span>
          </div>
          {priorityCalled ? (
            <div className="flex items-baseline gap-4">
              <span
                className={`font-display num leading-none tracking-tightest text-warn ${flashId === priorityCalled.id ? 'animate-pulse' : ''}`}
                style={{ fontSize: 'clamp(3rem, 8vw, 7rem)' }}
              >
                #{String(priorityCalled.number).padStart(2, '0')}
              </span>
              <span className="text-warn/70 text-sm">{getServiceLabel(priorityCalled.service, cfg.industry)} · Now serving</span>
            </div>
          ) : (
            <p className="text-warn/50 text-sm">Preparing next priority patient…</p>
          )}
        </div>
      )}

      {single && rooms.length > 0 ? (
        <RoomsBoard service={single} rooms={rooms} tokenList={tokenList} flashId={flashId} />
      ) : single ? (
        <SingleDepartmentBoard
          service={single}
          tokenList={tokenList}
          flashId={flashId}
          industry={cfg.industry}
        />
      ) : (
        /* Service cards */
        <div className="flex-1 flex items-center justify-center p-8">
          <div className={`grid gap-6 w-full max-w-6xl ${
            services.length === 1 ? 'grid-cols-1 max-w-sm' :
            services.length === 2 ? 'grid-cols-2' :
            services.length <= 4 ? 'grid-cols-2 lg:grid-cols-4' :
            'grid-cols-2 lg:grid-cols-3'
          }`}>
            {services.map(s => {
              const called = tokenList.find(t => t.status === 'called' && t.service === s.id);
              const waiting = tokenList.filter(t => t.status === 'waiting' && t.service === s.id);
              const isFlashing = called && flashId === called.id;

              return (
                <div
                  key={s.id}
                  className={`border p-6 flex flex-col transition-all duration-500 ${
                    called ? 'border-accent bg-accent/10' : 'border-paper/10 bg-paper/5'
                  } ${isFlashing ? 'scale-105' : ''}`}
                >
                  <div className="text-xs tracking-[0.15em] uppercase text-paper/50 mb-4">{s.title}</div>

                  <div
                    className={`font-display num leading-none tracking-tightest flex-1 flex items-center transition-colors ${
                      called ? 'text-accent' : 'text-paper/20'
                    }`}
                    style={{ fontSize: 'clamp(4rem, 10vw, 10rem)' }}
                  >
                    {called ? `#${String(called.number).padStart(2, '0')}` : '—'}
                  </div>

                  {called?.note && (
                    <div className="mt-2 text-xs text-accent/70 italic border-t border-accent/20 pt-2">
                      {called.note}
                    </div>
                  )}

                  {waiting.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-paper/10 text-sm text-paper/50">
                      <span className="text-[10px] tracking-[0.15em] uppercase text-paper/40 mr-2">Waiting</span>
                      <span className="font-mono">
                        {waiting
                          .slice()
                          .sort((a, b) => a.number - b.number)
                          .slice(0, 6)
                          .map(t => String(t.number).padStart(2, '0'))
                          .join('  ')}
                      </span>
                    </div>
                  )}

                  <div className="mt-4 flex items-center justify-between text-xs">
                    <span className={called ? 'text-accent font-medium' : 'text-paper/30'}>
                      {called ? 'Now serving' : 'No one called'}
                    </span>
                    <span className="text-paper/40">{waiting.length} waiting</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Bottom ticker */}
      <div className="px-8 py-4 border-t border-paper/10 flex items-center justify-between text-xs text-paper/30">
        <span>Scan the QR on your slip or ask staff for your token number</span>
        <span className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
          Live
        </span>
      </div>
    </div>
  );
}

/** One department, one card per consulting room (OPD). */
function RoomsBoard({ service, rooms, tokenList, flashId }) {
  const forRoom = (room) => tokenList.filter(t => t.service === service.id && String(t.room) === String(room));
  const unassignedWaiting = tokenList.filter(
    t => t.status === 'waiting' && t.service === service.id && !t.room
  );
  const cols = rooms.length <= 2 ? 'sm:grid-cols-2' : rooms.length <= 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2 lg:grid-cols-3';

  return (
    <div className="flex-1 p-8">
      <div className={`grid gap-6 ${cols}`}>
        {rooms
          .slice()
          .sort((a, b) => String(a.room).localeCompare(String(b.room), undefined, { numeric: true }))
          .map((r) => {
            const called = forRoom(r.room).find(t => t.status === 'called');
            const waiting = forRoom(r.room).filter(t => t.status === 'waiting');
            const isFlashing = called && flashId === called.id;
            const off = r.status !== 'available';
            return (
              <div
                key={r.room}
                className={`border p-6 flex flex-col transition-all duration-500 ${
                  called ? 'border-accent bg-accent/10' : off ? 'border-paper/10 bg-paper/[0.03]' : 'border-paper/10 bg-paper/5'
                } ${isFlashing ? 'scale-[1.03]' : ''}`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm tracking-[0.2em] uppercase text-paper/60">Room {r.room}</span>
                  <span className={`text-[10px] tracking-[0.15em] uppercase px-2 py-0.5 border ${off ? 'text-paper/30 border-paper/15' : 'text-success border-success/40'}`}>
                    {off ? 'Off' : 'In'}
                  </span>
                </div>
                <div className="mt-1 text-sm text-paper/40 truncate">{r.doctor}</div>

                <div
                  className={`font-display num leading-none tracking-tightest flex-1 flex items-center transition-colors ${
                    called ? 'text-accent' : 'text-paper/15'
                  }`}
                  style={{ fontSize: 'clamp(3.5rem, 9vw, 8rem)' }}
                >
                  {called ? String(called.number).padStart(2, '0') : '—'}
                </div>

                <div className="flex items-center justify-between text-xs">
                  <span className={called ? 'text-accent font-medium' : 'text-paper/30'}>
                    {called ? 'Now serving' : off ? 'Room closed' : 'Ready'}
                  </span>
                  <span className="text-paper/40">{waiting.length} waiting</span>
                </div>
              </div>
            );
          })}
      </div>

      {unassignedWaiting.length > 0 && (
        <div className="mt-6 border border-paper/10 bg-paper/5 p-4 text-sm text-paper/50">
          <span className="text-[10px] tracking-[0.15em] uppercase text-paper/40 mr-2">Not yet assigned</span>
          <span className="font-mono">
            {unassignedWaiting.sort((a, b) => a.number - b.number).slice(0, 10)
              .map(t => String(t.number).padStart(2, '0')).join('  ')}
          </span>
        </div>
      )}
    </div>
  );
}

/** Full-screen board for one department — the layout a wall-mounted screen wants. */
function SingleDepartmentBoard({ service, tokenList, flashId }) {
  const called = tokenList.find(t => t.status === 'called' && t.service === service.id);
  const waiting = tokenList
    .filter(t => t.status === 'waiting' && t.service === service.id)
    .sort((a, b) => {
      const ap = a.priority === 'priority' || a.referred ? 0 : 1;
      const bp = b.priority === 'priority' || b.referred ? 0 : 1;
      return ap - bp || a.number - b.number;
    });
  const isFlashing = called && flashId === called.id;

  return (
    <div className="flex-1 grid lg:grid-cols-[1.6fr_1fr] gap-px bg-paper/10 m-8 border border-paper/10">
      {/* Now serving */}
      <div className={`bg-ink flex flex-col items-center justify-center p-10 transition-all duration-500 ${isFlashing ? 'bg-accent/10' : ''}`}>
        <div className="text-sm tracking-[0.3em] uppercase text-paper/40">{service.title}</div>
        <div className="mt-2 text-xs tracking-[0.25em] uppercase text-accent/80">Now serving</div>
        <div
          className={`font-display num leading-none tracking-tightest ${called ? 'text-accent' : 'text-paper/15'} ${isFlashing ? 'animate-pulse' : ''}`}
          style={{ fontSize: 'clamp(8rem, 26vw, 22rem)' }}
        >
          {called ? String(called.number).padStart(2, '0') : '—'}
        </div>
        {called?.note && (
          <div className="mt-4 text-lg text-accent/70 italic">{called.note}</div>
        )}
        {!called && (
          <div className="mt-4 text-lg text-paper/30">Waiting for the next patient…</div>
        )}
      </div>

      {/* Up next */}
      <div className="bg-ink p-8 flex flex-col">
        <div className="flex items-baseline justify-between">
          <span className="text-xs tracking-[0.25em] uppercase text-paper/40">Up next</span>
          <span className="text-xs text-paper/40">{waiting.length} waiting</span>
        </div>
        <div className="mt-6 flex-1 flex flex-col gap-3 overflow-hidden">
          {waiting.length === 0 && (
            <div className="text-paper/25 text-lg">No one in the queue</div>
          )}
          {waiting.slice(0, 8).map((t, i) => (
            <div
              key={t.id}
              className={`flex items-center justify-between border-b border-paper/10 pb-2 ${i === 0 ? 'text-paper' : 'text-paper/45'}`}
            >
              <span className="font-display num tracking-tightest" style={{ fontSize: i === 0 ? '2.6rem' : '2rem' }}>
                {String(t.number).padStart(2, '0')}
              </span>
              {(t.priority === 'priority' || t.referred) && (
                <span className="text-[10px] tracking-[0.15em] uppercase text-warn border border-warn/40 px-2 py-0.5">
                  {t.referred ? 'Referred' : 'Priority'}
                </span>
              )}
            </div>
          ))}
          {waiting.length > 8 && (
            <div className="text-paper/30 text-sm pt-1">+ {waiting.length - 8} more</div>
          )}
        </div>
      </div>
    </div>
  );
}

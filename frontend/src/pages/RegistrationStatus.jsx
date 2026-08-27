import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { apiRegistrationStatus } from '../services/api.js';
import { useAppConfig } from '../hooks/useAppConfig.js';
import { useQueues } from '../hooks/useQueues.js';

const STATUS_COPY = {
  registered: { label: 'Registered — waiting for check-in', tone: 'text-warn border-warn/40 bg-warn/5' },
  tokenIssued: { label: 'Token issued', tone: 'text-success border-success/40 bg-success/5' },
  cancelled: { label: 'Cancelled', tone: 'text-graphite border-rule bg-cream' },
  expired: { label: 'Expired — please register again', tone: 'text-graphite border-rule bg-cream' },
};

export default function RegistrationStatus() {
  const { id } = useParams();
  const cfg = useAppConfig();
  const { labelOf } = useQueues();
  const [reg, setReg] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    const load = () => apiRegistrationStatus(id)
      .then((r) => { if (alive) setReg(r); })
      .catch((e) => { if (alive) setError(e.response?.status === 404 ? 'Registration not found.' : 'Could not load your registration.'); });
    load();
    // Poll while still waiting so the token number appears as soon as the desk issues it.
    const t = setInterval(() => { if (reg?.status === 'registered' || !reg) load(); }, 5000);
    return () => { alive = false; clearInterval(t); };
  }, [id, reg?.status]);

  if (error) {
    return (
      <div className="max-w-lg mx-auto px-6 py-20 text-center">
        <div className="font-display text-4xl text-ash">{error}</div>
        <Link to="/register" className="btn-secondary mt-6 inline-block">Register</Link>
      </div>
    );
  }
  if (!reg) return <div className="max-w-lg mx-auto px-6 py-24 text-center text-graphite animate-pulse">Loading…</div>;

  const s = STATUS_COPY[reg.status] || STATUS_COPY.registered;

  return (
    <div className="max-w-lg mx-auto px-6 py-16">
      <div className="label mb-3">{cfg.orgName} · Your registration</div>
      <h1 className="font-display text-4xl tracking-tightest">Hi {reg.firstName}.</h1>

      <div className={`mt-6 border p-5 ${s.tone}`}>
        <div className="text-xs tracking-[0.15em] uppercase font-medium">{s.label}</div>
        {reg.status === 'tokenIssued' && (
          <div className="mt-3 flex items-baseline gap-3">
            <span className="font-display text-token num leading-none tracking-tightest text-accent">
              {String(reg.tokenNumber).padStart(2, '0')}
            </span>
            <span className="text-sm text-graphite">{labelOf(reg.department)}{reg.priorityRequested ? ' · priority' : ''}</span>
          </div>
        )}
      </div>

      <dl className="mt-6 border border-rule divide-y divide-rule bg-cream text-sm">
        <div className="flex justify-between px-4 py-3"><dt className="text-graphite">Department</dt><dd>{labelOf(reg.department)}</dd></div>
        <div className="flex justify-between px-4 py-3"><dt className="text-graphite">Aadhaar on file</dt><dd className="font-mono">XXXX XXXX {reg.aadhaarLast4}</dd></div>
        <div className="flex justify-between px-4 py-3"><dt className="text-graphite">Registered</dt><dd>{new Date(reg.registeredAt).toLocaleString()}</dd></div>
      </dl>

      {reg.status === 'registered' && (
        <p className="mt-6 text-sm text-graphite">
          Go to the <span className="font-medium text-ink">{labelOf(reg.department)}</span> desk and give your
          Aadhaar number. This page updates automatically once your token is issued.
        </p>
      )}
      {reg.status === 'tokenIssued' && reg.tokenId && (
        <Link to={`/token/${reg.tokenId}`} className="btn-primary mt-6 inline-block">Track my position live →</Link>
      )}
      {(reg.status === 'expired' || reg.status === 'cancelled') && (
        <Link to="/register" className="btn-primary mt-6 inline-block">Register again</Link>
      )}
    </div>
  );
}

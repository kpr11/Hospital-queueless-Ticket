import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import QRCode from 'qrcode';
import { useQueueState } from '../hooks/useQueueState.js';
import { useTheme } from '../context/ThemeContext.jsx';
import { useAppConfig } from '../hooks/useAppConfig.js';
import StatusBadge from '../components/StatusBadge.jsx';

export default function Home() {
  const { state, tokens, announcement, loading } = useQueueState();
  const { dark } = useTheme();
  const cfg = useAppConfig();
  const isMedical = cfg.industry === 'medical';
  const tokenList = Object.values(tokens || {});
  const waiting = tokenList.filter(t => t.status === 'waiting').length;
  const nowServing = state?.currentTokenNumber || 0;
  const [qrDataUrl, setQrDataUrl] = useState(null);

  useEffect(() => {
    const joinUrl = `${window.location.origin}${isMedical ? '/register' : '/take'}`;
    // QR foreground adapts to current theme
    const qrDark = dark ? '#F0EBE3' : '#171615';
    const qrLight = dark ? '#1C1A18' : '#FBF7F0';
    QRCode.toDataURL(joinUrl, { width: 160, margin: 1, color: { dark: qrDark, light: qrLight } })
      .then(setQrDataUrl)
      .catch(() => {});
  }, [dark, isMedical]);

  return (
    <div>
      {announcement?.message && (
        <div className="max-w-6xl mx-auto px-6 pt-8">
          <div className="p-4 border border-warn bg-warn/10 text-warn text-sm font-medium">
            {announcement.message}
          </div>
        </div>
      )}

      {/* Full-width institute hero */}
      <div className="relative w-full">
        <img
          src="/png/jayadeva-logo.jpg"
          alt="Sri Jayadeva Institute of Cardiovascular Sciences and Research"
          className="w-full h-[42vh] sm:h-[58vh] lg:h-[64vh] object-cover object-center"
        />
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent">
          <div className="max-w-6xl mx-auto px-6 py-6 sm:py-10">
            <h1 className="font-display text-2xl sm:text-4xl lg:text-5xl tracking-tight leading-tight text-white uppercase max-w-4xl">
              Sri Jayadeva Institute of Cardiovascular Sciences and Research
            </h1>
            <p className="mt-2 sm:mt-3 text-[11px] sm:text-xs tracking-[0.25em] uppercase text-white/80">
              Outpatient Token &amp; Queue System
            </p>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-10 lg:py-14">
        {/* Primary actions */}
        <div className="flex flex-col sm:flex-row gap-4">
          {isMedical
            ? <Link to="/register" className="btn-primary">Generate a token for patients →</Link>
            : <Link to="/take" className="btn-primary">Take a token →</Link>}
          <Link to="/book" className="btn-secondary">Book an appointment</Link>
          <Link to="/lookup" className="btn-secondary">I already have a token</Link>
        </div>

        {/* Live status + scan-to-join */}
        <div className="mt-12 grid lg:grid-cols-2 gap-8 lg:gap-12 items-start">
          <div className="card w-full max-w-sm">
            <div className="flex items-center justify-between mb-6">
              <span className="label">Right now</span>
              {!loading && <StatusBadge status={state?.status || 'running'} />}
            </div>

            <div className="grid grid-cols-2 gap-6">
              <div>
                <div className="label">Now serving</div>
                <div className="mt-3 font-display text-6xl tracking-tightest leading-none num text-accent">
                  {nowServing > 0 ? String(nowServing).padStart(2, '0') : '—'}
                </div>
              </div>
              <div>
                <div className="label">Waiting</div>
                <div className="mt-3 font-display text-6xl tracking-tightest leading-none num">
                  {String(waiting).padStart(2, '0')}
                </div>
              </div>
            </div>

            <div className="mt-6 pt-6 border-t border-rule">
              <p className="text-xs text-graphite leading-relaxed">
                Updates push live from the cloud — there's nothing to refresh.
                {state?.status === 'paused' && (
                  <span className="block mt-2 text-warn">
                    The queue is currently paused. New tokens will resume shortly.
                  </span>
                )}
              </p>
            </div>
          </div>

          <div className="w-full max-w-sm">
            {/* Trust strip */}
            <div className="grid grid-cols-3 text-center text-[10px] tracking-[0.2em] uppercase text-graphite">
              <div className="border-r border-rule py-3">No app needed</div>
              <div className="border-r border-rule py-3">Free to use</div>
              <div className="py-3">No login</div>
            </div>

            {/* Scan-to-join QR */}
            {qrDataUrl && (
              <div className="mt-6 border border-rule bg-cream p-4 flex items-center gap-4">
                <img src={qrDataUrl} alt={isMedical ? 'Scan to register a patient' : 'Scan to take a token'} className="w-16 h-16 shrink-0" />
                <div>
                  <div className="label">{isMedical ? 'Scan to register a patient' : 'Scan to join queue'}</div>
                  <p className="text-xs text-graphite mt-1">Point your phone camera here — no app needed.</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Institute location */}
        <div className="mt-12 lg:mt-16 pt-6 border-t border-rule flex items-start gap-2.5 text-sm">
          <img src="/svg/location-pin.svg" alt="" aria-hidden="true" className="w-4 h-4 mt-0.5 shrink-0 opacity-70" />
          <div>
            <div className="label mb-1">Location</div>
            <p className="text-ink leading-relaxed max-w-md">
              Bannerghatta Road in Jayanagar 9th Block, Bengaluru, Karnataka 560069
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

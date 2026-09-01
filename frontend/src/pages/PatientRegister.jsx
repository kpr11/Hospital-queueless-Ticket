import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import QRCode from 'qrcode';
import PatientForm from '../components/PatientForm.jsx';
import { PrintableRegistration } from '../components/PrintableSlip.jsx';
import { useAppConfig } from '../hooks/useAppConfig.js';
import { useQueues } from '../hooks/useQueues.js';
import { apiRegisterPatient } from '../services/api.js';

export default function PatientRegister() {
  const cfg = useAppConfig();
  const { labelOf } = useQueues();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null); // the sanitised patient record
  const [qr, setQr] = useState(null);

  const statusUrl = done ? `${window.location.origin}/registration/${done.id}` : null;

  useEffect(() => {
    if (!statusUrl) return;
    QRCode.toDataURL(statusUrl, { width: 180, margin: 1 }).then(setQr).catch(() => {});
  }, [statusUrl]);

  const handleSubmit = async (form) => {
    setBusy(true);
    setError(null);
    try {
      const res = await apiRegisterPatient(form);
      setDone(res.patient);
    } catch (e) {
      const status = e.response?.status;
      if (status === 429) setError('Too many attempts from this device. Please wait a minute and try again.');
      else setError(e.response?.data?.error || 'Could not register. Please check your details and try again.');
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className="max-w-2xl mx-auto px-6 py-16">
        <PrintableRegistration
          patient={done}
          departmentLabel={labelOf(done.department)}
          orgName={cfg.orgName}
          location={cfg.location}
        />
        <div className="print:hidden">
        <div className="label mb-3">{cfg.orgName} · Registration complete</div>
        <h1 className="font-display text-5xl tracking-tightest leading-[0.95]">
          You're registered, {done.name.split(' ')[0]}.
        </h1>
        <p className="mt-4 text-graphite">
          Go to the <span className="font-medium text-ink">{labelOf(done.department)}</span> desk and give
          your mobile number. The staff will hand you your token number.
        </p>
        {done.priorityRequested && (
          <p className="mt-2 text-sm text-accent-deep">
            You're flagged for priority — you'll be called ahead of the regular queue.
          </p>
        )}

        <div className="mt-8 border border-rule bg-cream p-6 flex flex-col sm:flex-row gap-6 sm:items-center">
          {qr && <img src={qr} alt="Scan to check your registration status" className="w-36 h-36 shrink-0" />}
          <div className="text-sm">
            <div className="label">Registered for</div>
            <div className="font-display text-2xl tracking-tightest mt-1">{labelOf(done.department)}</div>
            <div className="mt-3 label">Patient ID (mobile)</div>
            <div className="font-mono mt-1">{done.mobile}</div>
            <p className="mt-3 text-xs text-graphite">
              Scan this to check your status and see your token number the moment it's issued.
              At the desk, just give your mobile number.
            </p>
          </div>
        </div>

        <div className="mt-8 flex flex-wrap gap-4">
          <button onClick={() => window.print()} className="btn-secondary">Print</button>
          <Link to={`/registration/${done.id}`} className="btn-secondary">Check my status</Link>
          <button onClick={() => { setDone(null); setQr(null); }} className="btn-secondary">Register another patient</button>
          <Link to="/" className="btn-secondary">Home</Link>
        </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-6 py-16">
      <div className="label mb-3">{cfg.orgName} · Patient registration</div>
      <h1 className="font-display text-5xl tracking-tightest leading-[0.95]">Register patient</h1>
      <p className="mt-4 text-graphite max-w-xl">
        Fill in your details and pick the department you're here to see. You'll collect your
        token number at that department's desk — just give your mobile number.
      </p>

      <div className="mt-10">
        <PatientForm onSubmit={handleSubmit} busy={busy} error={error} submitLabel="Register patient" />
      </div>

      <p className="mt-6 text-xs text-graphite">
        Can't fill this in? Ask the reception desk — they can register you.
      </p>
    </div>
  );
}

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

  useEffect(() => {
    if (!done?.id) return;
    QRCode.toDataURL(done.id, { width: 180, margin: 1 }).then(setQr).catch(() => {});
  }, [done]);

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
          your Aadhaar number. The staff will verify it and hand you your token number.
        </p>

        <div className="mt-8 border border-rule bg-cream p-6 flex flex-col sm:flex-row gap-6 sm:items-center">
          {qr && <img src={qr} alt="Registration code" className="w-36 h-36 shrink-0" />}
          <div className="text-sm">
            <div className="label">Registered for</div>
            <div className="font-display text-2xl tracking-tightest mt-1">{labelOf(done.department)}</div>
            <div className="mt-3 label">Aadhaar on file</div>
            <div className="font-mono mt-1">XXXX XXXX {done.aadhaarLast4}</div>
            <p className="mt-3 text-xs text-graphite">
              Show this code at the desk to be found faster — or just give your Aadhaar number.
            </p>
          </div>
        </div>

        <div className="mt-8 flex gap-4">
          <button onClick={() => window.print()} className="btn-secondary">Print</button>
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
      <h1 className="font-display text-5xl tracking-tightest leading-[0.95]">Register your visit</h1>
      <p className="mt-4 text-graphite max-w-xl">
        Fill in your details and pick the department you're here to see. You'll collect your
        token number at that department's desk after a quick Aadhaar check.
      </p>

      <div className="mt-10">
        <PatientForm onSubmit={handleSubmit} busy={busy} error={error} submitLabel="Register my visit" />
      </div>

      <p className="mt-6 text-xs text-graphite">
        Can't fill this in? Ask the reception desk — they can register you.
      </p>
    </div>
  );
}

import { useState } from 'react';
import { useQueues } from '../hooks/useQueues.js';

export const EMPTY_PATIENT_FORM = {
  name: '', age: '', gender: '', mobile: '', address: '', department: '',
  priorityRequested: false, priorityReason: '',
  consent: false, website: '',
};

const field =
  'mt-1 w-full border border-rule bg-cream px-4 py-3 text-sm text-ink placeholder:text-graphite/50 focus:outline-none focus:border-ink';

/**
 * Shared patient-registration form — used by the public /register page and the
 * admin reception desk. Purely presentational: the parent owns submission.
 */
export default function PatientForm({ onSubmit, busy, error, submitLabel = 'Register patient', consentLabel }) {
  const { services } = useQueues();
  const [form, setForm] = useState(EMPTY_PATIENT_FORM);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const complete =
    form.name.trim().length >= 2 &&
    form.age !== '' &&
    form.gender &&
    /^[6-9]\d{9}$/.test(form.mobile.replace(/\D/g, '')) &&
    form.address.trim().length >= 1 &&
    form.department &&
    form.consent === true;

  const isEmergency = form.department === 'emergency';

  const submit = (e) => {
    e.preventDefault();
    if (!complete || busy) return;
    onSubmit({
      ...form,
      mobile: form.mobile.replace(/\D/g, ''),
      priorityRequested: form.priorityRequested || isEmergency,
      priorityReason: (form.priorityRequested && form.priorityReason.trim()) || null,
      consent: true,
    });
  };

  return (
    <form onSubmit={submit} className="space-y-5">
      <label className="block">
        <span className="label">Full name *</span>
        <input value={form.name} onChange={set('name')} maxLength={100} placeholder="As per hospital records" className={field} />
      </label>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <label className="block">
          <span className="label">Age *</span>
          <input
            type="number" min="0" max="120" value={form.age} onChange={set('age')}
            placeholder="Years" className={field}
          />
        </label>
        <label className="block">
          <span className="label">Gender *</span>
          <select value={form.gender} onChange={set('gender')} className={field}>
            <option value="">Select…</option>
            <option value="male">Male</option>
            <option value="female">Female</option>
            <option value="other">Other</option>
          </select>
        </label>
      </div>

      <label className="block">
        <span className="label">Mobile number *</span>
        <input
          type="tel" inputMode="numeric" value={form.mobile}
          onChange={(e) => setForm((f) => ({ ...f, mobile: e.target.value.replace(/\D/g, '').slice(0, 10) }))}
          placeholder="10-digit number" className={`${field} font-mono tracking-wider`}
        />
        <span className="mt-1 block text-xs text-graphite">
          This is your patient ID — give it at the department desk to collect your token.
        </span>
      </label>

      <label className="block">
        <span className="label">Address *</span>
        <textarea
          value={form.address} onChange={set('address')} rows={2} maxLength={300}
          placeholder="House / street / city" className={`${field} resize-none`}
        />
      </label>

      <label className="block">
        <span className="label">Department *</span>
        <select value={form.department} onChange={set('department')} className={field}>
          <option value="">Select department…</option>
          {services.map((s) => (
            <option key={s.id} value={s.id}>{s.title}</option>
          ))}
        </select>
      </label>

      {isEmergency ? (
        <div className="p-3 border border-accent bg-accent/5 text-accent-deep text-sm">
          Emergency is served ahead of the regular queue automatically.
        </div>
      ) : (
        <div>
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={form.priorityRequested}
              onChange={(e) => setForm((f) => ({ ...f, priorityRequested: e.target.checked }))}
              className="mt-0.5 w-4 h-4 border-rule accent-ink cursor-pointer shrink-0"
            />
            <span className="text-xs text-graphite leading-relaxed">
              Request priority — for elderly, disabled, pregnant, or medical urgency.
              Priority patients are called before the regular queue.
            </span>
          </label>
          {form.priorityRequested && (
            <input
              value={form.priorityReason}
              onChange={set('priorityReason')}
              maxLength={200}
              placeholder="Reason (optional) — e.g. 78 years old, wheelchair"
              className={`${field} mt-2`}
            />
          )}
        </div>
      )}

      {/* Honeypot — hidden from humans, catches bots that fill every field. */}
      <div aria-hidden="true" style={{ position: 'absolute', left: '-9999px', width: '1px', height: '1px', overflow: 'hidden' }}>
        <label>
          Website
          <input
            type="text" tabIndex={-1} autoComplete="off"
            value={form.website} onChange={set('website')}
          />
        </label>
      </div>

      <label className="flex items-start gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={form.consent}
          onChange={(e) => setForm((f) => ({ ...f, consent: e.target.checked }))}
          className="mt-0.5 w-4 h-4 border-rule accent-ink cursor-pointer shrink-0"
        />
        <span className="text-xs text-graphite leading-relaxed">
          {consentLabel || (
            <>
              I consent to this hospital storing my name, age, gender, mobile number and address
              to identify me and manage my visit.
            </>
          )}
        </span>
      </label>

      {error && <div className="p-3 border border-accent bg-accent/5 text-accent-deep text-sm">{error}</div>}

      <button type="submit" disabled={!complete || busy} className="btn-primary disabled:opacity-40">
        {busy ? 'Registering…' : submitLabel}
      </button>
    </form>
  );
}

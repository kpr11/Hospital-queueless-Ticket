import { useState, useEffect } from 'react';
import {
  apiGetPatient,
  apiConsultationForToken,
  apiLabTests,
  apiUpdateConsultation,
  apiOrderLabTests,
  apiCompleteConsultation,
} from '../services/api.js';

/**
 * OPD consultation workspace for the doctor: the called patient's details and
 * past visits, a place to record the diagnosis / notes, lab-test ordering
 * (auto-routed to Radiology / Lab), and the "Consultation done" action that
 * closes the visit and advances the room.
 */
export default function ConsultationPanel({ token, onCompleted }) {
  const tokenId = token?.id;

  const [patient, setPatient] = useState(null);
  const [consult, setConsult] = useState(null);
  const [history, setHistory] = useState([]);
  const [tests, setTests] = useState([]);
  const [diagnosis, setDiagnosis] = useState('');
  const [notes, setNotes] = useState('');
  const [picked, setPicked] = useState([]);
  const [showHistory, setShowHistory] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);
  const [ordering, setOrdering] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    if (!tokenId) return undefined;
    let cancelled = false;
    setErr(null);
    setConsult(null);
    setPatient(null);
    setSavedAt(null);
    apiConsultationForToken(tokenId)
      .then(({ consultation, history: h }) => {
        if (cancelled) return;
        setConsult(consultation);
        setHistory(h || []);
        setDiagnosis(consultation.diagnosis || '');
        setNotes(consultation.notes || '');
        setPicked([]);
      })
      .catch((e) => !cancelled && setErr(e.response?.data?.error || 'Could not open the consultation.'));
    if (token.patientId) {
      apiGetPatient(token.patientId).then((r) => !cancelled && setPatient(r.patient)).catch(() => {});
    }
    return () => { cancelled = true; };
  }, [tokenId, token?.patientId]);

  useEffect(() => { apiLabTests().then((d) => setTests(d.tests || [])).catch(() => {}); }, []);

  const save = async () => {
    if (!consult) return;
    setSaving(true);
    setErr(null);
    try {
      const r = await apiUpdateConsultation(consult.id, { diagnosis, notes });
      setConsult(r.consultation);
      setSavedAt(Date.now());
    } catch (e) {
      setErr(e.response?.data?.error || 'Could not save.');
    } finally {
      setSaving(false);
    }
  };

  const order = async () => {
    if (!consult || picked.length === 0) return;
    setOrdering(true);
    setErr(null);
    try {
      const r = await apiOrderLabTests(consult.id, picked);
      setConsult(r.consultation);
      setPicked([]);
    } catch (e) {
      setErr(e.response?.data?.error || 'Could not order the tests.');
    } finally {
      setOrdering(false);
    }
  };

  const complete = async () => {
    if (!consult || completing || completed) return;
    setCompleting(true);
    setErr(null);
    try {
      await apiCompleteConsultation(consult.id, { diagnosis, notes });
      setCompleted(true);
      onCompleted?.();
    } catch (e) {
      setErr(e.response?.data?.error || 'Could not complete the consultation.');
    } finally {
      setCompleting(false);
    }
  };

  if (!tokenId) return null;

  const orderedTestIds = new Set((consult?.labOrders || []).map((o) => o.test));

  return (
    <div className="border border-accent/30 bg-accent/[0.03] p-5 mb-4">
      <div className="flex items-center justify-between mb-4">
        <span className="label text-accent-deep">Consultation · token #{String(token.number).padStart(2, '0')}</span>
        {token.room && <span className="text-xs text-graphite">Room {token.room}</span>}
      </div>

      {err && <div className="mb-3 p-3 border border-accent bg-accent/5 text-accent-deep text-sm">{err}</div>}

      {!consult ? (
        <div className="animate-pulse text-graphite text-sm">Opening record…</div>
      ) : (
        <>
          {/* Patient */}
          <div className="border border-rule bg-paper p-4 text-sm">
            <div className="font-display text-2xl tracking-tightest">{token.patientName || patient?.name || 'Patient'}</div>
            {patient && (
              <div className="mt-1 text-graphite">
                {patient.age}/{String(patient.gender || '').charAt(0).toUpperCase()} · {patient.mobile}
                {patient.address ? <> · {patient.address}</> : null}
              </div>
            )}
            {patient?.priorityRequested && (
              <div className="mt-1 text-accent-deep text-xs">
                Priority{patient.priorityReason ? ` — ${patient.priorityReason}` : ''}
              </div>
            )}
            {history.length > 0 && (
              <button
                onClick={() => setShowHistory((v) => !v)}
                className="mt-2 text-xs underline text-graphite hover:text-ink"
              >
                {showHistory ? 'Hide' : 'Show'} past visits ({history.length})
              </button>
            )}
            {showHistory && (
              <div className="mt-3 pt-3 border-t border-rule space-y-3">
                {history.map((h) => (
                  <div key={h.id} className="text-xs text-graphite">
                    <div className="text-ink font-medium">
                      {new Date(h.createdAt).toLocaleDateString()} · {h.doctorName}
                      {h.department ? ` · ${h.department}` : ''}
                    </div>
                    {h.diagnosis && <div className="mt-0.5">Dx: {h.diagnosis}</div>}
                    {h.notes && <div className="mt-0.5 whitespace-pre-wrap">{h.notes}</div>}
                    {(h.labOrders || []).length > 0 && (
                      <div className="mt-0.5">Tests: {h.labOrders.map((o) => o.label).join(', ')}</div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Notes */}
          <label className="block mt-4">
            <span className="label block mb-1">Diagnosis</span>
            <textarea
              value={diagnosis}
              onChange={(e) => setDiagnosis(e.target.value)}
              rows={2}
              className="w-full border border-rule bg-paper px-3 py-2 text-sm focus:outline-none focus:border-ink resize-y"
            />
          </label>
          <label className="block mt-3">
            <span className="label block mb-1">Notes / advice</span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={4}
              className="w-full border border-rule bg-paper px-3 py-2 text-sm focus:outline-none focus:border-ink resize-y"
            />
          </label>
          <div className="mt-2 flex items-center gap-3">
            <button onClick={save} disabled={saving} className="btn-secondary text-xs disabled:opacity-40">
              {saving ? 'Saving…' : 'Save notes'}
            </button>
            {savedAt && <span className="text-xs text-success">Saved ✓</span>}
          </div>

          {/* Lab orders */}
          <div className="mt-4 pt-4 border-t border-rule">
            <span className="label block mb-2">Order tests <span className="normal-case font-normal text-graphite">— sent to the patient’s Radiology / Lab queue</span></span>
            {(consult.labOrders || []).length > 0 && (
              <div className="mb-3 flex flex-wrap gap-2">
                {consult.labOrders.map((o) => (
                  <span key={o.tokenId} className="text-[11px] border border-success/40 text-success px-2 py-1">
                    {o.label} → {o.department} #{String(o.tokenNumber).padStart(2, '0')}
                  </span>
                ))}
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              {tests.map((t) => {
                const done = orderedTestIds.has(t.id);
                const on = picked.includes(t.id);
                return (
                  <button
                    key={t.id}
                    onClick={() => setPicked((p) => (on ? p.filter((x) => x !== t.id) : [...p, t.id]))}
                    disabled={done}
                    className={`text-xs px-3 py-1.5 border transition-colors ${
                      done ? 'border-rule text-graphite/50 line-through'
                        : on ? 'border-ink bg-ink text-paper'
                        : 'border-rule text-graphite hover:border-ink'
                    }`}
                  >
                    {t.label}
                  </button>
                );
              })}
            </div>
            {picked.length > 0 && (
              <button onClick={order} disabled={ordering} className="btn-secondary text-xs mt-3 disabled:opacity-40">
                {ordering ? 'Ordering…' : `Order ${picked.length} test${picked.length > 1 ? 's' : ''}`}
              </button>
            )}
          </div>

          {/* Done */}
          <div className="mt-5 pt-4 border-t border-rule">
            {completed ? (
              <p className="text-sm text-success font-medium">
                Consultation completed ✓ — calling your next patient…
              </p>
            ) : (
              <>
                <button onClick={complete} disabled={completing} className="btn-primary text-sm disabled:opacity-40">
                  {completing ? 'Completing…' : 'Consultation done — call next →'}
                </button>
                <p className="mt-2 text-xs text-graphite">
                  Closes this visit, frees the room, and calls your next patient.
                </p>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

import { useCallback, useEffect, useState } from 'react';
import { Navigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useAppConfig } from '../hooks/useAppConfig.js';
import { useQueues } from '../hooks/useQueues.js';
import PatientForm from '../components/PatientForm.jsx';
import { PrintableTokenSlip } from '../components/PrintableSlip.jsx';
import {
  apiReceptionRegisterPatient,
  apiPendingRegistrations,
  apiVerifyAndIssueToken,
  apiListRegistrations,
  apiCancelRegistration,
  apiUpdateRegistration,
  apiRegistrationSummary,
  apiGetPatient,
} from '../services/api.js';

const STATUS_STYLE = {
  registered: 'text-warn border-warn/40',
  tokenIssued: 'text-success border-success/40',
  cancelled: 'text-graphite border-rule',
  expired: 'text-graphite border-rule',
};

function formatAadhaar(raw) {
  return String(raw || '').replace(/\D/g, '').slice(0, 12).replace(/(\d{4})(?=\d)/g, '$1 ').trim();
}

export default function ReceptionDesk() {
  const { user } = useAuth();
  const cfg = useAppConfig();
  const { services, labelOf } = useQueues();

  const [tab, setTab] = useState('register'); // 'register' | 'checkin' | 'all'

  // --- All registrations ---
  const [allRows, setAllRows] = useState([]);
  const [allFilter, setAllFilter] = useState('registered');
  const [editing, setEditing] = useState(null); // { id, name, age, gender, mobile, address, department }
  const [rowBusy, setRowBusy] = useState(null);
  const [expanded, setExpanded] = useState(null); // patient detail (with token trail)
  const [reprint, setReprint] = useState(null); // { token, patientName, department }
  const [summary, setSummary] = useState(null);

  const loadAll = useCallback(() => {
    apiListRegistrations(allFilter ? { status: allFilter } : {})
      .then((r) => setAllRows(r.patients || []))
      .catch(() => {});
  }, [allFilter]);

  useEffect(() => {
    if (tab !== 'all') return;
    loadAll();
    apiRegistrationSummary().then(setSummary).catch(() => {});
    const id = setInterval(() => { loadAll(); apiRegistrationSummary().then(setSummary).catch(() => {}); }, 10000);
    return () => clearInterval(id);
  }, [tab, loadAll]);

  const toggleExpand = async (id) => {
    if (expanded?.id === id) { setExpanded(null); return; }
    setExpanded({ id, loading: true });
    try {
      const r = await apiGetPatient(id);
      setExpanded({ id, ...r.patient });
    } catch {
      setExpanded({ id, error: true });
    }
  };

  const reprintToken = (p) => {
    setReprint({
      token: { number: p.tokenNumber, issuedAt: p.tokenIssuedAt, priority: p.priorityRequested ? 'priority' : 'normal' },
      patientName: p.name,
      department: p.department,
    });
    setTimeout(() => window.print(), 50);
  };

  const cancelRow = async (id) => {
    if (!window.confirm('Cancel this registration? The patient will need to register again.')) return;
    setRowBusy(id);
    try { await apiCancelRegistration(id); loadAll(); }
    catch (e) { alert(e.response?.data?.error || 'Could not cancel.'); }
    finally { setRowBusy(null); }
  };

  const saveEdit = async () => {
    setRowBusy(editing.id);
    try {
      await apiUpdateRegistration(editing.id, {
        name: editing.name, age: Number(editing.age), gender: editing.gender,
        mobile: editing.mobile, address: editing.address, department: editing.department,
      });
      setEditing(null);
      loadAll();
    } catch (e) {
      alert(e.response?.data?.error || 'Could not save.');
    } finally {
      setRowBusy(null);
    }
  };

  // --- Register walk-in ---
  const [regBusy, setRegBusy] = useState(false);
  const [regError, setRegError] = useState(null);
  const [regDone, setRegDone] = useState(null);

  const handleRegister = async (form) => {
    setRegBusy(true);
    setRegError(null);
    try {
      const res = await apiReceptionRegisterPatient(form);
      setRegDone(res.patient);
    } catch (e) {
      setRegError(e.response?.data?.error || 'Could not register the patient.');
    } finally {
      setRegBusy(false);
    }
  };

  // --- Check in & issue token ---
  const [dept, setDept] = useState('');
  const [pending, setPending] = useState([]);
  const [selected, setSelected] = useState(null);
  const [aadhaar, setAadhaar] = useState('');
  const [issueBusy, setIssueBusy] = useState(false);
  const [issueError, setIssueError] = useState(null);
  const [issued, setIssued] = useState(null); // { token, patient }

  useEffect(() => {
    if (!dept && services[0]) setDept(services[0].id);
  }, [services]);

  const loadPending = useCallback(() => {
    if (!dept) return;
    apiPendingRegistrations(dept).then((r) => setPending(r.patients || [])).catch(() => {});
  }, [dept]);

  useEffect(() => {
    if (tab !== 'checkin') return;
    loadPending();
    const id = setInterval(loadPending, 8000);
    return () => clearInterval(id);
  }, [tab, loadPending]);

  if (!user) return <Navigate to="/admin/login" replace />;

  const handleIssue = async () => {
    setIssueBusy(true);
    setIssueError(null);
    try {
      const res = await apiVerifyAndIssueToken({
        patientId: selected?.id,
        aadhaar,
        department: dept,
      });
      setIssued(res);
      setSelected(null);
      setAadhaar('');
      loadPending();
    } catch (e) {
      setIssueError(e.response?.data?.error || 'Could not issue a token.');
    } finally {
      setIssueBusy(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 xl:px-10 py-10">
      <div className="flex items-start justify-between flex-wrap gap-4 mb-8">
        <div>
          <div className="label">Admin · Reception</div>
          <h1 className="font-display text-5xl tracking-tightest leading-none mt-2">Reception desk</h1>
        </div>
        <Link to="/admin" className="btn-secondary text-sm">Back to dashboard</Link>
      </div>

      {cfg.industry !== 'medical' && (
        <div className="mb-6 p-4 border border-warn bg-warn/5 text-warn text-sm">
          Patient registration is designed for the Medical / Hospital industry profile.
          Set it under <Link to="/admin/setup" className="underline">Settings</Link>.
        </div>
      )}

      <div className="flex flex-wrap gap-px bg-rule mb-8 border border-rule w-full sm:w-fit">
        {[
          ['register', 'Register walk-in'],
          ['checkin', 'Check in & issue'],
          ['all', 'All registrations'],
        ].map(([t, label]) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 sm:flex-none px-4 sm:px-5 py-2.5 text-sm font-medium ${tab === t ? 'bg-ink text-paper' : 'bg-paper text-graphite hover:text-ink'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ---- Register walk-in ---- */}
      {tab === 'register' && (
        regDone ? (
          <div className="border border-rule bg-cream p-6">
            <div className="label">Registered</div>
            <div className="font-display text-3xl tracking-tightest mt-1">{regDone.name}</div>
            <p className="mt-2 text-sm text-graphite">
              Registered for <span className="text-ink font-medium">{labelOf(regDone.department)}</span> ·
              Aadhaar XXXX XXXX {regDone.aadhaarLast4}
            </p>
            <p className="mt-3 text-sm text-graphite">
              Send the patient to the {labelOf(regDone.department)} desk, or switch to
              <button onClick={() => { setTab('checkin'); setDept(regDone.department); }} className="mx-1 underline">Check in &amp; issue token</button>
              to issue their token now.
            </p>
            <button onClick={() => setRegDone(null)} className="btn-secondary mt-4">Register another</button>
          </div>
        ) : (
          <div className="max-w-xl">
            <PatientForm
              onSubmit={handleRegister}
              busy={regBusy}
              error={regError}
              submitLabel="Register patient"
              consentLabel="The patient has given verbal consent for the hospital to store their name, age, gender, mobile number, address and the last 4 digits of their Aadhaar number to manage this visit."
            />
          </div>
        )
      )}

      {/* ---- Check in & issue token ---- */}
      {tab === 'checkin' && (
        <div className="space-y-6">
          {issued && (
            <PrintableTokenSlip
              token={issued.token}
              patientName={issued.patient.name}
              departmentLabel={labelOf(issued.token.service)}
              orgName={cfg.orgName}
              location={cfg.location}
            />
          )}
          {issued && (
            <div className="border border-accent bg-accent/5 p-6 flex flex-wrap items-center gap-6 print:hidden">
              <div>
                <div className="label text-accent">Token issued</div>
                <div className="font-display text-token leading-none tracking-tightest text-accent num">
                  {String(issued.token.number).padStart(2, '0')}
                </div>
              </div>
              <div className="text-sm text-graphite">
                <div className="text-ink font-medium">{issued.patient.name}</div>
                <div>{labelOf(issued.token.service)}{issued.token.priority === 'priority' && ' · priority'}</div>
                <button onClick={() => window.print()} className="btn-secondary text-xs mt-2">Print</button>
                <button onClick={() => setIssued(null)} className="btn-secondary text-xs mt-2 ml-2">Dismiss</button>
              </div>
            </div>
          )}

          <label className="block max-w-xs">
            <span className="label">Department</span>
            <select
              value={dept}
              onChange={(e) => { setDept(e.target.value); setSelected(null); setIssueError(null); }}
              className="mt-1 w-full border border-rule bg-cream px-4 py-3 text-sm focus:outline-none focus:border-ink"
            >
              {services.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
            </select>
          </label>

          <div>
            <div className="label mb-3">Waiting to check in ({pending.length})</div>
            {pending.length === 0 ? (
              <div className="text-center py-10 border border-rule text-graphite text-sm">
                No pending registrations for {labelOf(dept)}.
              </div>
            ) : (
              <div className="border border-rule divide-y divide-rule bg-cream">
                {pending.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => { setSelected(p); setAadhaar(''); setIssueError(null); setIssued(null); }}
                    className={`w-full text-left px-4 py-3 flex items-center justify-between gap-2 text-sm ${selected?.id === p.id ? 'bg-ink text-paper' : 'hover:bg-paper'} ${p.priorityRequested && selected?.id !== p.id ? 'bg-accent/5' : ''}`}
                  >
                    <span className="min-w-0">
                      <span className="font-medium">{p.name}</span>
                      {p.priorityRequested && <span className="ml-1.5 text-[10px] font-bold text-accent" title="Priority">P</span>}
                      <span className={`block sm:inline sm:ml-1 ${selected?.id === p.id ? 'text-paper/60' : 'text-graphite'}`}>{p.age}/{p.gender[0].toUpperCase()} · {p.mobile}</span>
                    </span>
                    <span className={`font-mono text-xs shrink-0 ${selected?.id === p.id ? 'text-paper/60' : 'text-graphite'}`}>
                      XXXX {p.aadhaarLast4}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="border border-accent/30 bg-accent/5 p-4 space-y-3 max-w-md">
            <span className="label block">
              Verify Aadhaar {selected ? `for ${selected.name}` : '& issue token'}
            </span>
            <input
              inputMode="numeric"
              value={formatAadhaar(aadhaar)}
              onChange={(e) => setAadhaar(e.target.value)}
              placeholder="#### #### ####"
              className="w-full border border-rule bg-paper px-3 py-2.5 text-sm font-mono tracking-wider focus:outline-none focus:border-ink"
            />
            {selected && aadhaar.replace(/\D/g, '').length === 12 &&
              aadhaar.replace(/\D/g, '').slice(-4) !== selected.aadhaarLast4 && (
                <p className="text-xs text-accent-deep">Last 4 digits don't match the selected patient ({selected.aadhaarLast4}).</p>
            )}
            {issueError && <p className="text-sm text-accent-deep">{issueError}</p>}
            <button
              onClick={handleIssue}
              disabled={issueBusy || aadhaar.replace(/\D/g, '').length !== 12}
              className="btn-primary text-sm disabled:opacity-40"
            >
              {issueBusy ? 'Verifying…' : 'Verify & issue token'}
            </button>
            <p className="text-xs text-graphite">
              Pick a patient above, or just enter any registered Aadhaar number for {labelOf(dept)}.
            </p>
          </div>
        </div>
      )}

      {/* ---- All registrations ---- */}
      {tab === 'all' && (
        <div className="space-y-4">
          {reprint && (
            <PrintableTokenSlip
              token={reprint.token}
              patientName={reprint.patientName}
              departmentLabel={labelOf(reprint.department)}
              orgName={cfg.orgName}
              location={cfg.location}
            />
          )}

          {summary && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-rule border border-rule print:hidden">
              {[
                ['Registered today', summary.total],
                ['Waiting', summary.registered],
                ['Issued', summary.tokenIssued],
                ['Cancelled / expired', summary.cancelled + summary.expired],
              ].map(([k, v]) => (
                <div key={k} className="bg-paper p-3">
                  <div className="label text-[10px]">{k}</div>
                  <div className="font-display text-2xl tracking-tightest num mt-0.5">{v}</div>
                </div>
              ))}
            </div>
          )}

          <div className="flex gap-2 flex-wrap print:hidden">
            {['registered', 'tokenIssued', 'cancelled', 'expired', ''].map((s) => (
              <button
                key={s || 'all'}
                onClick={() => setAllFilter(s)}
                className={`px-3 py-1.5 text-xs border ${allFilter === s ? 'bg-ink text-paper border-ink' : 'border-rule text-graphite hover:border-ink'}`}
              >
                {s === '' ? 'All' : s === 'tokenIssued' ? 'Token issued' : s[0].toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>

          {allRows.length === 0 ? (
            <div className="text-center py-10 border border-rule text-graphite text-sm">No registrations.</div>
          ) : (
            <div className="border border-rule divide-y divide-rule bg-cream">
              {allRows.map((p) => (
                <div key={p.id} className="px-4 py-3 text-sm">
                  {editing?.id === p.id ? (
                    <div className="grid sm:grid-cols-2 gap-2">
                      {['name', 'mobile', 'address'].map((f) => (
                        <input
                          key={f}
                          value={editing[f]}
                          onChange={(e) => setEditing((d) => ({ ...d, [f]: e.target.value }))}
                          placeholder={f}
                          className="border border-rule bg-paper px-2 py-1.5 text-sm focus:outline-none focus:border-ink"
                        />
                      ))}
                      <input
                        type="number" value={editing.age}
                        onChange={(e) => setEditing((d) => ({ ...d, age: e.target.value }))}
                        placeholder="age"
                        className="border border-rule bg-paper px-2 py-1.5 text-sm focus:outline-none focus:border-ink"
                      />
                      <select
                        value={editing.gender}
                        onChange={(e) => setEditing((d) => ({ ...d, gender: e.target.value }))}
                        className="border border-rule bg-paper px-2 py-1.5 text-sm focus:outline-none focus:border-ink"
                      >
                        <option value="male">Male</option><option value="female">Female</option><option value="other">Other</option>
                      </select>
                      <select
                        value={editing.department}
                        onChange={(e) => setEditing((d) => ({ ...d, department: e.target.value }))}
                        className="border border-rule bg-paper px-2 py-1.5 text-sm focus:outline-none focus:border-ink"
                      >
                        {services.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
                      </select>
                      <div className="flex gap-2 sm:col-span-2">
                        <button onClick={saveEdit} disabled={rowBusy === p.id} className="btn-primary text-xs px-3 disabled:opacity-40">Save</button>
                        <button onClick={() => setEditing(null)} className="btn-secondary text-xs px-3">Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <button onClick={() => toggleExpand(p.id)} className="text-left min-w-0">
                          <span className="font-medium text-ink">{p.name}</span>
                          {p.priorityRequested && <span className="ml-1.5 text-[10px] text-accent font-bold" title="Priority">P</span>}
                          <span className="text-graphite block sm:inline sm:ml-1"> {p.age}/{p.gender[0].toUpperCase()} · {p.mobile} · {labelOf(p.department)}</span>
                          {p.status === 'tokenIssued' && <span className="text-success"> · token #{p.tokenNumber}</span>}
                        </button>
                        <span className="flex items-center gap-2 shrink-0">
                          <span className={`text-[10px] tracking-[0.15em] uppercase px-2 py-0.5 border ${STATUS_STYLE[p.status] || 'border-rule text-graphite'}`}>
                            {p.status === 'tokenIssued' ? 'issued' : p.status}
                          </span>
                          {p.status === 'registered' && (
                            <>
                              <button
                                onClick={() => setEditing({ id: p.id, name: p.name, age: p.age, gender: p.gender, mobile: p.mobile, address: p.address, department: p.department })}
                                className="text-xs underline text-graphite hover:text-ink"
                              >Edit</button>
                              <button
                                onClick={() => cancelRow(p.id)}
                                disabled={rowBusy === p.id}
                                className="text-xs underline text-accent-deep hover:text-accent disabled:opacity-40"
                              >Cancel</button>
                            </>
                          )}
                          {p.status === 'tokenIssued' && (
                            <button onClick={() => reprintToken(p)} className="text-xs underline text-graphite hover:text-ink">Reprint</button>
                          )}
                        </span>
                      </div>

                      {expanded?.id === p.id && (
                        <div className="mt-3 pt-3 border-t border-rule text-xs text-graphite space-y-1">
                          {expanded.loading && <div className="animate-pulse">Loading…</div>}
                          {expanded.error && <div>Could not load details.</div>}
                          {!expanded.loading && !expanded.error && (
                            <>
                              <div>Address: {expanded.address}</div>
                              <div>Source: {expanded.source === 'self' ? 'self-service' : `reception (${expanded.registeredBy || '—'})`}</div>
                              {expanded.priorityRequested && <div className="text-accent-deep">Priority{expanded.priorityReason ? ` — ${expanded.priorityReason}` : ''}</div>}
                              <div>Registered: {new Date(expanded.registeredAt).toLocaleString()}</div>
                              {expanded.token && (
                                <div className="mt-1">
                                  Token #{expanded.token.number} · {labelOf(expanded.token.service)} · {expanded.token.status}
                                  {expanded.token.referralHistory?.length > 0 && (
                                    <div className="mt-1">
                                      Trail: {[expanded.token.referralHistory[0].fromService, ...expanded.token.referralHistory.map(h => h.toService)].map(s => labelOf(s)).join(' → ')}
                                    </div>
                                  )}
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * A small print-only slip (thermal-printer sized). Shown only when the page is
 * printed (`print:block`), hidden on screen. Used for the registration
 * confirmation and for the issued token at the reception desk.
 */
function Frame({ orgName, location, kicker, big, rows, footer }) {
  return (
    <div
      className="hidden print:flex print:items-center print:justify-center print:min-h-screen print:bg-white"
      style={{ fontFamily: '"Georgia", serif' }}
    >
      <div style={{ width: '340px', border: '1.5px solid #1A1714', display: 'flex', flexDirection: 'column' }}>
        <div style={{ background: '#1A1714', padding: '14px 24px' }}>
          <div style={{ color: '#F7F3EC', fontSize: '11px', letterSpacing: '0.18em', textTransform: 'uppercase', fontWeight: 600 }}>
            {orgName || 'QueueLess'}
          </div>
          {location && <div style={{ color: '#A89E94', fontSize: '9px', marginTop: '3px' }}>{location}</div>}
        </div>
        <div style={{ padding: '28px 24px 18px', borderBottom: '1px dashed #D4CFC8', textAlign: 'center' }}>
          <div style={{ fontSize: '9px', letterSpacing: '0.2em', textTransform: 'uppercase', color: '#8A8278', marginBottom: '8px' }}>
            {kicker}
          </div>
          <div style={{ fontSize: big.length > 6 ? '28px' : '72px', fontWeight: 700, lineHeight: 1, letterSpacing: '-0.03em', color: '#1A1714' }}>
            {big}
          </div>
        </div>
        <div style={{ padding: '12px 24px' }}>
          {rows.map(([k, v]) => (
            <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#4A4542', padding: '3px 0' }}>
              <span style={{ color: '#8A8278', textTransform: 'uppercase', letterSpacing: '0.1em', fontSize: '8px' }}>{k}</span>
              <span>{v}</span>
            </div>
          ))}
        </div>
        {footer && (
          <div style={{ padding: '10px 24px', background: '#F7F3EC', fontSize: '9px', color: '#5C5854' }}>{footer}</div>
        )}
      </div>
    </div>
  );
}

export function PrintableRegistration({ patient, departmentLabel, orgName, location }) {
  if (!patient) return null;
  const rows = [
    ['Department', departmentLabel],
    ['Aadhaar', `XXXX XXXX ${patient.aadhaarLast4}`],
    ['Mobile', patient.mobile],
    ['Registered', new Date(patient.registeredAt).toLocaleString()],
  ];
  if (patient.priorityRequested) rows.push(['Priority', 'Yes']);
  return (
    <Frame
      orgName={orgName}
      location={location}
      kicker="Visit registration"
      big={patient.name}
      rows={rows}
      footer={`Go to the ${departmentLabel} desk and give your Aadhaar number to collect your token.`}
    />
  );
}

export function PrintableTokenSlip({ token, patientName, departmentLabel, orgName, location }) {
  if (!token) return null;
  const rows = [
    ['Patient', patientName || '—'],
    ['Issued', new Date(token.issuedAt || token.tokenIssuedAt || Date.now()).toLocaleString()],
  ];
  if (token.room) rows.push(['Room', String(token.room)]);
  if (token.priority === 'priority') rows.push(['Priority', 'Yes']);
  return (
    <Frame
      orgName={orgName}
      location={location}
      kicker={departmentLabel}
      big={`#${String(token.number).padStart(2, '0')}`}
      rows={rows}
      footer={token.room
        ? `Go to Room ${token.room} and wait until your number is called.`
        : 'Please wait until your number is called on the display board.'}
    />
  );
}

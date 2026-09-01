# End-to-End Flows & API Call Sequences

Open this file to understand **how a request travels through the system** — from a
click in the browser, through the REST API, into the services and Firebase, and
back. Every diagram is a real code path with the actual function and endpoint
names.

> Companion docs: [LLD-Backend.md](LLD-Backend.md) · [LLD-Frontend.md](LLD-Frontend.md) · [API.md](API.md)

---

## How to read these diagrams

```mermaid
sequenceDiagram
    autonumber
    actor U as User (browser)
    participant FE as Frontend page/hook
    participant API as Express route + middleware
    participant CT as Controller
    participant SV as Service (business rules)
    participant DB as Firebase RTDB
    U->>FE: clicks a button
    FE->>API: HTTP request (Bearer JWT if signed in)
    API->>CT: after auth guard + Joi validate()
    CT->>SV: one service call
    SV->>DB: read / transaction / multi-path write
    SV-->>CT: result object
    CT-->>U: JSON response
```

- **`alt` / `opt`** blocks = branching. The label is the condition.
- A dashed return arrow (`-->>`) is a response; a solid arrow (`->>`) is a call.
- "RTDB" is Firebase Realtime Database, written server-side via the Admin SDK.
- Live (push) updates to the browser come from Firebase `onValue`, drawn as a
  separate arrow from RTDB to the frontend.

---

## Index

1. [Authentication](#1-authentication)
2. [Customer — take & track a token](#2-customer--take--track-a-token)
3. [Hospital OPD — the full patient journey](#3-hospital-opd--the-full-patient-journey)
   - 3.1 [Patient registration](#31-patient-registration)
   - 3.2 [Daily roster setup](#32-daily-roster-setup)
   - 3.3 [Check-in & room assignment](#33-check-in--room-assignment)
   - 3.4 [Doctor calls the next patient](#34-doctor-calls-the-next-patient)
   - 3.5 [Consultation, lab orders, and "done"](#35-consultation-lab-orders-and-done)
   - 3.6 [Doctor stand-down & patient reassignment](#36-doctor-stand-down--patient-reassignment)
4. [Display board data flow](#4-display-board-data-flow)
5. [Queue control (admin / staff)](#5-queue-control-admin--staff)
6. [Background jobs](#6-background-jobs)
7. [Error mapping reference](#7-error-mapping-reference)

---

## 1. Authentication

### 1.1 Admin login

```mermaid
sequenceDiagram
    autonumber
    actor A as Admin
    participant LP as AdminLogin.jsx
    participant AC as AuthContext.login()
    participant RL as loginLimiter (20 / 15min)
    participant RT as POST /api/v1/auth/login
    participant AS as auth.service.login()
    participant DB as RTDB admins/{username}

    A->>LP: username + password → submit
    LP->>AC: login(username, password)
    AC->>RL: request
    RL->>RT: within limit
    RT->>RT: validate(loginSchema)  — 3-50 / 8-200 chars
    RT->>AS: login(username, password)
    AS->>DB: once('value')
    DB-->>AS: account (or null)
    Note over AS: bcrypt.compare against real OR dummy hash<br/>(constant time — no user enumeration)
    alt account && password ok
        AS->>AS: jwt.sign({ sub, role, displayName }, JWT_SECRET, 8h)
        AS-->>RT: { token, expiresIn, user }
        RT-->>AC: 200
        AC->>AC: localStorage['queueless.adminToken'] = token<br/>localStorage['queueless.adminUser'] = user
        AC-->>A: redirect to /admin
    else invalid
        AS-->>RT: throw Error{statusCode:401}
        RT-->>A: 401 { error: "Invalid username or password." }
    end
```

### 1.2 Staff login (password or kiosk PIN)

```mermaid
sequenceDiagram
    autonumber
    actor S as Staff / Kiosk
    participant SL as StaffLogin.jsx / StaffKiosk.jsx
    participant SC as StaffContext
    participant RT as POST /api/v1/staff/login  ·  /staff/login/pin
    participant SS as staff.service
    participant DB as RTDB staff/*

    alt password
        S->>SL: username + password
        SL->>SC: login(u, p)
        SC->>RT: POST /staff/login
        RT->>SS: loginStaff(u, p)
        SS->>DB: staffMember(u).once()
        SS->>SS: bcrypt.compare (constant time)
        SS->>SS: jwt.sign({ sub, role:'staff', service, displayName }, 8h)
        SS-->>SC: { token, user{ service } }
        SC->>SC: store staffToken + staffUser
    else PIN (shared terminal)
        S->>SL: 4-6 digit PIN
        SL->>RT: POST /staff/login/pin
        RT->>SS: loginByPin(pin)
        SS->>DB: staff().once() — scan every account with a pinHash
        loop each account with pinHash
            SS->>SS: bcrypt.compare(pin, pinHash) — first match wins
        end
        SS->>SS: jwt.sign(..., 12h)
        SS-->>SL: { token, user }
        SL->>SC: loginDirect(token, user)
    end
```

The **`service` claim** on the staff JWT is what locks a staff member to their
counter — `patient.controller.resolveDepartment()` and
`staff.controller.callNext()` both read `req.user.service`, never a body param.

### 1.3 Session expiry watchdog (client-side)

```mermaid
sequenceDiagram
    autonumber
    participant W as useSessionExpiry() (every 30s)
    participant LS as localStorage JWT
    participant NAV as react-router

    W->>LS: read admin/staff token
    W->>W: decode payload.exp (no signature check — display only)
    alt exp <= now  OR  token missing
        W->>W: logout()
        W->>NAV: navigate('/admin/login', { state: { sessionExpired: true } })
    end
    Note over W: the axios response interceptor is the backstop —<br/>a 401 on any /admin/ or /staff/ path also force-logs-out
```

---

## 2. Customer — take & track a token

```mermaid
sequenceDiagram
    autonumber
    actor C as Customer (phone)
    participant HP as Home.jsx / TakeToken.jsx
    participant RL as takeTokenLimiter (10 / min)
    participant RT as POST /api/v1/tokens
    participant TC as token.controller.takeToken
    participant QS as queue.service.issueToken
    participant CNT as RTDB queue/counter
    participant TOK as RTDB queue/tokens/{id}
    participant AN as analytics.service
    participant MT as MyToken.jsx
    participant FB as Firebase onValue

    C->>HP: scan QR → "Take a token", pick service
    HP->>RL: POST /tokens { service }
    RL->>RT: within limit
    RT->>RT: validate(takeTokenSchema)
    RT->>TC: takeToken(req)
    TC->>QS: issueToken({ service, priority, groupSize })
    QS->>CNT: transaction(c => c+1)   — atomic number allocation
    CNT-->>QS: number
    QS->>TOK: set({ id, number, service, status:'waiting', expiresAt, … })
    QS-)AN: logEvent('token_issued')   — fire & forget
    QS-->>TC: tokenRecord
    TC-->>C: 201 { token }
    C->>MT: open /token/{id}
    MT->>FB: onValue queue/tokens/{id}
    FB-->>MT: live status pushes (waiting → called → served)
    MT->>RT: GET /tokens/{id} (position, peopleAhead, ETA)
```

`GET /tokens/:id` computes `positionInQueue`, `peopleAhead`, and
`estimatedWaitSeconds` (= people ahead × live average wait) — the average comes
from `analytics.getTrafficStats()`, falling back to `AVG_SERVICE_TIME_SECONDS`.

---

## 3. Hospital OPD — the full patient journey

**One patient, start to finish.** OPD runs multiple consulting rooms; each doctor
is a sub-queue.

```mermaid
flowchart LR
    R["1. Register<br/>(self QR or reception)"] --> CI["2. Check in at desk<br/>Aadhaar verified"]
    CI --> AR["3. Round-robin<br/>room assignment<br/>P1→R1 P2→R2 … P6→R1"]
    AR --> CALL["4. Doctor calls next<br/>(their own patients first)"]
    CALL --> CONS["5. Consultation<br/>diagnosis · notes"]
    CONS --> LAB{"lab tests<br/>needed?"}
    LAB -->|yes| ROUTE["auto-issue referred token<br/>in Radiology / Lab / Cardiology"]
    LAB -->|no| DONE
    ROUTE --> DONE["6. 'Consultation done'<br/>→ close + call next patient"]
    DONE --> DISP["Display board advances"]
```

### 3.1 Patient registration

```mermaid
sequenceDiagram
    autonumber
    actor P as Patient / Receptionist
    participant FE as PatientRegister.jsx / ReceptionDesk (tab 1)
    participant RL as registerLimiter (5 / min, public route only)
    participant RT as POST /patients/register  ·  POST /patients/reception/register
    participant PC as patient.controller
    participant PS as patient.service.registerPatient
    participant AAD as utils/aadhaar (Verhoeff)
    participant DB as RTDB hospital/patients/{id}
    participant EV as events/bus

    P->>FE: name, age, gender, mobile, address, Aadhaar, department, consent
    FE->>RT: POST (public route is rate-limited, reception route needs staff JWT)
    RT->>RT: validate(registerSchema)  — honeypot 'website' must be empty
    RT->>PC: register / receptionRegister
    PC->>PS: registerPatient({ …, source, registeredBy })
    PS->>PS: consent === true ?  (else 400)
    PS->>AAD: isValidAadhaar(raw)  — 12 digits, first 2-9, Verhoeff checksum
    AAD-->>PS: ok  (else 400)
    PS->>PS: aadhaarHash = HMAC-SHA256(AADHAAR_SALT, digits) plus last4
    PS->>DB: read all patients — duplicate guard
    alt existing 'registered' for (aadhaarHash|mobile, department)
        PS-->>P: 409 "already registered for that department"
    else ok
        PS->>DB: set({ id, …, aadhaarHash, aadhaarLast4, status:'registered', tokenId:null })
        PS-)EV: emit(PATIENT_REGISTERED)  — notification.service fans out
        PS-->>PC: sanitised record (no aadhaarHash)
        PC-->>P: 201 { patient }  — go to the department desk with your Aadhaar
    end
```

The raw Aadhaar number is **never** stored or returned. `hospital/**` is
`.read: false` in the DB rules — the patient record is only ever served through
the JWT API.

### 3.2 Daily roster setup

```mermaid
sequenceDiagram
    autonumber
    actor AD as Admin
    participant AR as AdminRoster.jsx
    participant DOC as Doctor (StaffDashboard)
    participant RT1 as POST /roster/doctors  (requireAdmin)
    participant RT2 as POST /roster/availability  (requireStaff, self)
    participant RS as roster.service
    participant DB as RTDB hospital/roster/{today}/opd

    AD->>AR: pick OPD staff account + room number → Add
    AR->>RT1: POST { username, room, department:'opd' }
    RT1->>RS: addDoctor('opd', { username, room, addedBy })
    RS->>DB: staffMember(username).once()  — must exist, service must be 'opd'
    alt wrong service / no account
        RS-->>AD: 409 / 404
    else ok
        RS->>DB: rosterDoctor(today,'opd',username).update({ room, name, status:'off' })
        RS-->>AR: roster snapshot (doctors + waiting counts)
    end

    DOC->>RT2: POST /roster/availability { status:'available', department:'opd' }
    RT2->>RS: setAvailability('opd', req.user.sub, 'available')
    RS->>DB: rosterDoctor(today,'opd',me).once()
    alt not on today's roster
        RS-->>DOC: 409 "You are not on today's roster."
    else
        RS->>DB: update({ status:'available' })
        RS-->>DOC: roster snapshot — now eligible for round-robin assignment
    end
```

### 3.3 Check-in & room assignment

```mermaid
sequenceDiagram
    autonumber
    actor RC as Receptionist / OPD desk staff
    participant FE as ReceptionDesk (tab 2) / StaffDashboard check-in
    participant RT as POST /patients/verify-issue  (requireStaff)
    participant PC as patient.controller.verifyAndIssue
    participant PS as patient.service.verifyAndIssueToken
    participant RS as roster.service.assignRoom
    participant CUR as RTDB roster cursor (transaction)
    participant QS as queue.service.issueToken
    participant TOK as RTDB queue/tokens
    participant PAT as RTDB hospital/patients/{id}
    participant DISP as Display board (Firebase onValue)

    RC->>FE: pick patient from pending list + type the patient's 12-digit Aadhaar
    FE->>RT: POST { patientId, aadhaar, department }
    RT->>PC: verifyAndIssue
    PC->>PC: resolveDepartment()  — admin uses body value, staff uses req.user.service
    PC->>PS: verifyAndIssueToken({ patientId, aadhaar, department, issuedBy })
    PS->>PS: isValidAadhaar(aadhaar), providedHash = HMAC(salt, digits)
    PS->>PAT: load patient (by id, or scan by hash+dept)
    alt hash mismatch
        PS-->>RC: 422 "Aadhaar does not match the registered record"
    else already tokenIssued
        PS-->>RC: 409 "A token (#N) has already been issued"
    else ok
        opt department === 'opd'
            PS->>RS: assignRoom('opd')
            RS->>CUR: transaction(c => c+1)
            RS-->>PS: { username, room, name }  (or null if nobody available)
        end
        PS->>QS: issueToken({ service:dept, patientId, priority, room, assignedTo })
        QS->>TOK: set token (waiting, room, assignedTo)
        QS-->>PS: token
        PS->>PAT: update({ status:'tokenIssued', tokenId, tokenNumber, room, assignedDoctor })
        PS-->>PC: { token, assignment, patient }
        PC-->>RC: 201 "Token #N issued for opd — Room 3 (Dr X)"
        FE->>FE: PrintableTokenSlip — room printed on the slip
        TOK-->>DISP: onValue push — token appears under Room 3, "waiting"
    end
```

**Round-robin math** (`roster.service.assignRoom`): with `available` doctors
sorted by room, the cursor transaction returns a monotonically increasing
integer; the pick is `available[(cursor - 1) % available.length]`. So P1→room 1,
P2→room 2, P3→room 1 (2 doctors), matching the spec.

### 3.4 Doctor calls the next patient

```mermaid
sequenceDiagram
    autonumber
    actor DR as Doctor (Room 3)
    participant SD as StaffDashboard "Call Next"
    participant RT as POST /staff/queue/call-next  (requireStaff)
    participant SC as staff.controller.callNext
    participant QS as queue.service.callNextToken
    participant TOK as RTDB queue/tokens
    participant ST as RTDB queue/state
    participant DISP as Display / patient MyToken (onValue)

    DR->>SD: click "Call Next"
    SD->>RT: POST (staff JWT — carries service='opd')
    RT->>SC: callNext
    SC->>SC: assignedTo = (service === 'opd') ? req.user.sub : null
    SC->>QS: callNextToken('opd', me, { assignedTo: me })
    QS->>ST: read — global pause? service paused? → 423
    QS->>TOK: read all tokens
    QS->>QS: anyPriorityWaiting? if next isn't priority-tier → 409 PRIORITY_BLOCKING
    Note over QS: waiting filter: service='opd' AND (assignedTo=me OR unassigned)<br/>sort: my patients first, then priority-tier, then number
    QS->>QS: previouslyCalled = my current 'called' token (if any)
    QS->>TOK: multi-path update — prev to served, next to called, state.currentTokenNumber = next.number
    QS-)QS: analytics logEvent(token_served / token_called)
    QS-->>SC: { called: nextToken }
    SC-->>DR: 200 — patient shown on the Room 3 card
    TOK-->>DISP: onValue push — Room 3 "now serving #N"
```

### 3.5 Consultation, lab orders, and "done"

```mermaid
sequenceDiagram
    autonumber
    actor DR as Doctor
    participant CP as ConsultationPanel.jsx
    participant G as "GET /consultations [tokenId]"
    participant GP as "GET /patients/:patientId"
    participant U as "PUT /consultations/:id"
    participant LO as "POST /consultations/:id/lab-orders"
    participant DONE as "POST /consultations/:id/complete"
    participant CS as consultation.service
    participant QS as queue.service
    participant DB as "RTDB hospital/consultations + queue/tokens"

    Note over DR,CP: panel mounts when the doctor has a 'called' assigned patient
    CP->>G: open/load the record for this token
    G->>CS: openForToken({ tokenId, doctorUsername })
    CS->>DB: token.once()  — token.assignedTo must equal me → else 403
    alt record exists
        CS-->>CP: existing consultation
    else
        CS->>DB: set({ id, patientId, tokenId, department, room, doctorUsername, status:'open' })
    end
    CS->>DB: historyForPatient(patientId) — all prior consultations
    CS-->>CP: { consultation, history[] }
    CP->>GP: GET patient demographics
    GP-->>CP: name, age/sex, mobile, address, priority

    DR->>CP: type diagnosis + notes → "Save notes"
    CP->>U: PUT { diagnosis, notes }
    U->>CS: update(id, fields, me)  — 403 if not the owner, 409 if already completed
    CS->>DB: update({ diagnosis, notes, updatedAt })

    opt doctor ticks CT scan + Blood test → "Order tests"
        DR->>CP: select tests
        CP->>LO: POST { tests: ['ct','blood'] }
        LO->>CS: addLabOrders(id, tests, me)
        loop each test in LAB_TESTS map
            CS->>QS: issueToken({ service: 'radiology'|'lab'|'cardiology', patientId, referred:true, note })
            QS->>DB: new token (waiting, referred → priority-tier at that counter)
        end
        CS->>DB: consultation.labOrders += [{ test, department, tokenId, tokenNumber }]
        CS-->>CP: chips: "CT scan → radiology #12", "Blood test → lab #08"
    end

    DR->>CP: "Consultation done — call next"
    CP->>DONE: POST { diagnosis, notes }
    DONE->>CS: complete(id, {...}, me)
    CS->>DB: consultation.status = 'completed', completedAt
    CS->>QS: callNextToken(department, me, { assignedTo: me })
    QS->>DB: current 'called' to served, next assigned patient to called
    CS-->>CP: { consultation, advance:{ called } }
    CP->>CP: onCompleted() — panel re-keys to the new called token
```

**Lab order routing map** (`consultation.service.LAB_TESTS`):

| Test id | Label | Routed to queue |
|---|---|---|
| `ct`, `mri`, `xray`, `ultrasound` | CT scan / MRI / X-Ray / Ultrasound | `radiology` |
| `ecg` | ECG | `cardiology` |
| `blood`, `urine` | Blood test / Urine test | `lab` |

The ordered token is `referred: true`, so `isPriorityTier()` is true and the lab
serves it ahead of fresh walk-ins. The same `patientId` links it back to the
patient record and the originating consultation.

### 3.6 Doctor stand-down & patient reassignment

```mermaid
sequenceDiagram
    autonumber
    actor DR as Doctor (Room 3)
    actor AD as Admin
    participant SD as StaffDashboard
    participant AR as AdminRoster.jsx
    participant RA as POST /roster/availability
    participant RR as POST /roster/reassign  (requireAdmin)
    participant RS as roster.service
    participant TOK as RTDB queue/tokens
    participant PAT as RTDB hospital/patients

    DR->>SD: "Go off duty"
    SD->>RA: POST { status:'off' }
    RA->>RS: setAvailability('opd', me, 'off')
    RS->>TOK: (no token changes yet — Dr X still has N waiting patients assigned)
    Note over AR: roster row now shows "Dr X · Room 3 · N waiting" in red<br/>with a "Reassign N" button

    AD->>AR: click "Reassign N"  (or the unassigned-pool banner button)
    AR->>RR: POST { from: 'docX' }   (or from: 'unassigned')
    RR->>RS: reassign('opd', 'docX')
    RS->>RS: targets = available doctors except 'from'
    RS->>TOK: read waiting tokens, toMove = those with assignedTo='docX' (still 'waiting')
    loop each token i
        RS->>TOK: update assignedTo = targets[i % targets.length].username, room = their room
        RS->>PAT: update room + assignedDoctor  (best-effort)
    end
    RS-->>AD: "Moved N patient(s)" (or "…left unassigned (no available doctor)")

    Note over RS: removeDoctor() calls reassign() first — a doctor can never be<br/>removed from the roster while leaving patients stranded.
```

Already-`called` patients are left alone (the doctor is mid-consultation); only
still-`waiting` tokens move.

---

## 4. Display board data flow

```mermaid
sequenceDiagram
    autonumber
    participant TV as "Wall monitor - /display?dept=opd"
    participant DP as Display.jsx
    participant FB as "Firebase RTDB (client SDK, read-only)"
    participant RP as "GET /roster/public (no auth, PII-free)"

    DP->>FB: onValue queue/state, queue/tokens, queue/announcement
    FB-->>DP: initial snapshot + every subsequent change (push)
    DP->>RP: GET /roster/public?department=opd   (poll every 12s)
    RP-->>DP: { rooms: [{ room, doctor, status, waiting }] }
    DP->>DP: RoomsBoard — for each room:<br/>called token where token.room === room.room<br/>waiting count, "In"/"Off" badge
    Note over FB,DP: token status changes (waiting→called→served) arrive instantly<br/>via onValue — no polling for the numbers themselves
```

| URL | Renders |
|---|---|
| `/display` | grid — one card per service (now-serving number + first 6 waiting) |
| `/display?dept=opd` (roster exists) | `RoomsBoard` — one card per consulting room |
| `/display?dept=cardiology` (no roster) | `SingleDepartmentBoard` — big NOW SERVING + UP NEXT list |

`GET /roster/public` returns **room + doctor name + status + waiting count only**
— no usernames, no PII — so it's safe to serve unauthenticated to a screen.

---

## 5. Queue control (admin / staff)

### 5.1 Call next / priority blocking

```mermaid
sequenceDiagram
    autonumber
    actor OP as Admin / Staff
    participant RT as POST /admin/queue/call-next  ·  /staff/queue/call-next
    participant QS as queue.service.callNextToken
    participant DB as RTDB queue/*

    OP->>RT: Call Next (service)
    RT->>QS: callNextToken(service, user, { assignedTo? })
    QS->>DB: read queue/state
    alt global pause
        QS-->>OP: 423 "Cannot advance queue while paused."
    else service in state.pausedServices
        QS-->>OP: 423 "Service '…' is currently paused."
    else
        QS->>DB: read all tokens
        alt a priority-tier token waits anywhere AND next regular token isn't priority
            QS-->>OP: 409 { code: PRIORITY_BLOCKING }
            Note over OP: UI shows "serve priority first" → use Call Next Priority
        else
            QS->>DB: prev 'called' to served, next to called, bump state (one update)
            QS-->>OP: 200 { called }
        end
    end
```

### 5.2 Refer a token to another counter

```mermaid
sequenceDiagram
    autonumber
    actor OP as Admin / Staff (or OPD doctor)
    participant RT as POST /admin/queue/refer/{tokenId}  ·  /staff/queue/refer/{tokenId}
    participant QS as queue.service.referToken
    participant DB as RTDB queue/tokens/{id}
    participant EV as events/bus

    OP->>RT: refer { toService, reason? }
    RT->>QS: referToken(tokenId, { toService, reason, byStaff })
    QS->>DB: token.once()
    alt status not waiting/called  OR  already at toService
        QS-->>OP: 400
    else
        QS->>DB: update: service=toService, status='waiting', referred=true,<br/>referralHistory += entry, calledAt=null, expiresAt = now + expiry
        QS-)EV: emit(TOKEN_REFERRED) → notification.service
        QS-)QS: analytics logEvent('token_referred')
        QS-->>OP: 200 { referred, from, to }
    end
    Note over DB: the token keeps its NUMBER — the patient is traceable end-to-end.<br/>referred=true means served ahead of fresh walk-ins, and the expiry clock is reset.
```

### 5.3 Pause / resume / reset

| Action | Endpoint | Effect |
|---|---|---|
| Pause queue | `POST /admin/queue/pause` | `state.status='paused'` — blocks all non-priority issue + all call-next |
| Resume | `POST /admin/queue/resume` | `state.status='running'` |
| Pause one service | `POST /admin/queue/pause-service {service}` | adds to `state.pausedServices[]` |
| Reset | `POST /admin/queue/reset` | **deletes all tokens**, `counter=0`, state back to defaults |
| Skip / no-show | `POST /admin/queue/skip/{tokenId}` | `waiting`/`called` token → `expired` |

---

## 6. Background jobs

```mermaid
sequenceDiagram
    autonumber
    participant SRV as server.js (boot)
    participant EXP as expiry.service (5 min)
    participant PCU as patientCleanup.service (10 min)
    participant SCH as scheduler.service (1 min)
    participant APM as appointmentMerge.service (1 min)
    participant DB as RTDB

    SRV->>EXP: startExpirySweep()
    SRV->>PCU: startPatientCleanup()
    SRV->>SCH: startScheduler()
    SRV->>APM: startAppointmentMerge()

    loop every 5 min
        EXP->>DB: tokens where status='waiting' AND expiresAt < now AND NOT referred → 'expired'
    end
    loop every 10 min
        PCU->>DB: patients where status='registered' AND registeredAt < now - TTL → 'expired'
    end
    loop every 1 min
        SCH->>SCH: current HH:MM (Asia/Karachi) === config.autoResetTime AND not already today?
        SCH->>DB: queueService.resetQueue()
    end
    loop every 1 min
        APM->>DB: appointments status='confirmed' within ±5 min of slot → issueToken(priority)
    end
```

All sweepers are `try/catch` + log-only; a failure never crashes the process.
`SIGTERM`/`SIGINT` stops every timer and closes Mongo before exit.

---

## 7. Error mapping reference

The frontend surfaces `err.response.data.error` verbatim in an inline banner.
Backend services produce these by throwing `Object.assign(new Error(msg), { statusCode })`.

| Status | `code` | Where it comes from | User sees |
|---|---|---|---|
| 400 | — | `validate(schema)` failed | "Validation failed." + `details[]` |
| 400 | — | missing `department` / `from` / `tests` | field-specific message |
| 401 | — | bad/expired JWT, wrong password/PIN | "Invalid token." / "Invalid username or password." — force logout on protected paths |
| 403 | — | wrong tier/role | "Forbidden - admin access required." |
| 403 | — | `consultation.doctorUsername !== me` / `token.assignedTo !== me` | "Not your consultation." / "This patient is assigned to another room." |
| 404 | — | token / patient / consultation / account / route missing | "… not found." |
| 409 | — | duplicate registration | "already registered for that department" |
| 409 | — | second `verify-issue` for same patient | "A token (#N) has already been issued" |
| 409 | `PRIORITY_BLOCKING` | `callNextToken` with priority waiting | "Please serve all priority tokens first" |
| 409 | — | roster: wrong service / not rostered | "… is assigned to 'x', not 'opd'." / "You are not on today's roster." |
| 422 | — | Aadhaar hash mismatch at check-in | "Aadhaar does not match the registered record" |
| 423 | — | queue or service paused | "Queue is currently paused." |
| 429 | — | rate limiter | "Too many … Please slow down." |
| 500 | — | unexpected | "Internal server error." — also sent to `ERROR_WEBHOOK_URL` |

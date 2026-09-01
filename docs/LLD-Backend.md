# Low-Level Design — Backend

QueueLess API server. Node.js + Express, Firebase Realtime Database (RTDB) as the
system of record, JWT auth, an in-process event bus, and a set of `setInterval`
background sweepers. No external queue, no cron service, no ORM.

> Companion docs: [LLD-Frontend.md](LLD-Frontend.md) · [LLD-Flows.md](LLD-Flows.md)
> (every end-to-end sequence diagram) · [Architecture.md](Architecture.md) (high
> level) · [API.md](API.md) (endpoint reference).

---

## 1. Technology & process model

| Concern | Choice |
|---|---|
| Runtime | Node.js 20 / 22, single process |
| HTTP | Express 4 |
| System of record | Firebase RTDB via the **Admin SDK** (server-side, full trust) |
| Analytics store | MongoDB Atlas **and** an append-only CSV (dual write, best-effort) |
| Auth | Stateless JWT (`jsonwebtoken`), bcrypt password/PIN hashes |
| Validation | Joi schemas at the route boundary |
| Scheduling | `setInterval` timers started at boot (no cron) |
| Hosting | Render (web service), `node src/server.js` |

The server is **stateless** apart from the background timers — every request
reads/writes RTDB directly, so horizontal scaling only requires making the
sweepers singleton (today they assume one instance).

---

## 2. Boot sequence

```mermaid
sequenceDiagram
    autonumber
    participant N as node src/server.js
    participant Env as config/env.js
    participant FB as config/firebase.js
    participant EV as events/index.js
    participant AS as auth.service
    participant QS as queue.service
    participant SW as sweepers
    participant App as app.js (Express)

    N->>Env: load & Joi-validate process.env
    Env-->>N: frozen config object (throws & exits on invalid)
    N->>FB: initializeApp(cert) — Admin SDK
    N->>EV: registerSubscribers() — wire event bus → notification.service
    N->>AS: bootstrapAdmin() — create/promote the env superadmin
    N->>QS: ensureInitialized() — seed queue/state, queue/counter, config
    N->>SW: startExpirySweep / startScheduler / startAppointmentMerge / startPatientCleanup
    N->>App: buildApp() — mount middleware + routes
    App-->>N: app
    N->>App: app.listen(PORT)
```

Fatal errors during `main()` exit the process (Render restarts it).
`unhandledRejection` / `uncaughtException` are reported via `reportError` and the
process is allowed to crash so the platform restarts it cleanly.

---

## 3. Layered architecture

```mermaid
flowchart TD
    Client["Frontend / display / QR scanner"]

    subgraph Express
      MW["Middleware pipeline<br/>helmet · cors · body parsers · morgan · rate limiters"]
      RT["routes/*.routes.js<br/>path + method + Joi validate() + auth guard"]
      CT["controllers/*.controller.js<br/>thin — unwrap req, call one service, shape res"]
      EH["errorHandler + notFound<br/>(terminal middleware)"]
    end

    subgraph Domain
      SV["services/*.service.js<br/>all business rules, transactions, invariants"]
      EVB["events/bus.js<br/>in-process EventEmitter"]
      AN["analytics.service<br/>dual write Mongo + CSV"]
      AU["audit.service<br/>append-only log"]
    end

    subgraph Data
      RTDB[("Firebase RTDB<br/>Admin SDK")]
      MONGO[("MongoDB Atlas")]
      CSV[("queue_events.csv")]
    end

    Client -->|"HTTPS JSON /api/v1/*"| MW --> RT --> CT --> SV
    CT -.error.-> EH
    SV --> RTDB
    SV --> EVB
    SV --> AN --> MONGO & CSV
    SV --> AU --> RTDB
    EVB --> SV
```

**Rule of thumb:** controllers never touch RTDB directly (a few legacy spots in
`index.js` and `staff.controller.setTokenNote` do); all invariants live in
services; services never touch `req`/`res`.

---

## 4. Request lifecycle

```mermaid
sequenceDiagram
    autonumber
    actor C as Client
    participant EX as Express app
    participant RL as rate limiter (scoped)
    participant BP as body parser (scoped by path)
    participant RT as router (/api/v1)
    participant AU as auth middleware
    participant VA as validate(schema)
    participant CO as controller
    participant SE as service
    participant DB as RTDB
    participant EH as errorHandler

    C->>EX: POST /api/v1/patients/verify-issue  (Bearer <jwt>)
    EX->>RL: within window & under cap?
    RL-->>EX: ok
    EX->>BP: express.json({limit:'10kb'})
    EX->>RT: match route
    RT->>AU: requireStaff → verify JWT, set req.user
    AU-->>RT: ok (or 401)
    RT->>VA: validate(verifyIssueSchema) → strip unknown, coerce
    VA-->>RT: ok (or 400 with details[])
    RT->>CO: verifyAndIssue(req,res)
    CO->>SE: patientService.verifyAndIssueToken({...})
    SE->>DB: read patient + roster, transaction on counter, write token + patient
    SE-->>CO: { token, assignment, patient }
    CO-->>C: 201 { message, token, assignment, patient }
    Note over SE,EH: any thrown Error with .statusCode → EH maps to JSON<br/>status>=500 also goes to reportError()
```

### Middleware order (`app.js`)

1. `helmet()` — security headers, `x-powered-by` disabled, `trust proxy = 1`
2. `cors({ origin: CORS_ORIGIN.split(',') })`
3. **Scoped** JSON parsers first: `/api/v1/conversations` → 512 kb,
   `/api/v1/uploads` → 4 mb; then the global `express.json({ limit: '10kb' })`
4. `morgan` (`dev` in non-prod, `combined` in prod)
5. Scoped rate limiters: `/api/v1/auth/login` (20 / 15 min),
   `/api/v1/tokens` (10 / min)
6. `GET /` health/version
7. `app.use('/api/v1', routes)`
8. `notFound` → 404 `{ error: "Route not found: METHOD path" }`
9. `errorHandler` → `{ error, stack? }` with `err.statusCode || 500`

---

## 5. Routing map

Mounted under `/api/v1` in `routes/index.js`. Guard column: **public** = no auth,
**staff** = `requireStaff` (admin-tier OR `staff` role), **admin** =
`requireAdmin` (admin-tier only), **role:X** = `requireRole('X')`.

| Prefix | File | Notable routes | Guard |
|---|---|---|---|
| `/auth` | `auth.routes` | `POST /login` | public (rate-limited) |
| `/tokens` | `token.routes` | `POST /` take, `GET /:id` status, `POST /:id/requeue` | public (rate-limited) |
| `/patients` | `patient.routes` | `POST /register` (public), `POST /reception/register`, `GET /pending`, `GET /registrations`, `GET /summary`, `GET /:id/status` (public), `POST /verify-issue`, `GET/PUT /:id`, `POST /:id/cancel` | mixed |
| `/roster` | `roster.routes` | `GET /public` (public), `GET /`, `POST /doctors` (admin), `DELETE /doctors/:username` (admin), `POST /availability`, `POST /reassign` (admin) | mixed |
| `/consultations` | `consultation.routes` | `GET /lab-tests`, `GET /`, `PUT /:id`, `POST /:id/lab-orders`, `POST /:id/complete` | staff |
| `/admin` | `admin.routes` | queue control, analytics, config, feedback, staff CRUD, token note/refer/skip, announcements, appointments, custom queues, admin accounts | admin / role:X |
| `/staff` | `staff.routes` | `POST /login`, `POST /login/pin` (public), `GET /queue`, `POST /queue/call-next`, `PUT /queue/tokens/:id/note`, `POST /queue/refer/:id`, profile, change-password | mixed |
| _(root)_ | `messaging.routes` | `/directory`, `/conversations*`, `/notifications*` | staff (per-route) |
| _(root)_ | `share.routes` | `/shares*` (staff), `GET /share/:id` (public capability link) | mixed |
| _(root)_ | `upload.routes` | `/uploads*` | staff |
| _(root)_ | `index.js` | `POST /feedback`, `POST /client-error`, `GET /config`, `GET /announcement`, `POST /appointments`, `GET /health` | public |

---

## 6. Authentication & authorization

### JWT payload

```jsonc
// admin-tier token (auth.service.login)
{ "sub": "<username>", "role": "superadmin|admin|manager", "displayName": "…", "iat": …, "exp": … }

// staff token (staff.service.loginStaff / loginByPin)
{ "sub": "<username>", "role": "staff", "service": "<queue key, e.g. opd>", "displayName": "…" }
```

`JWT_SECRET` signs; `JWT_EXPIRES_IN` (default `8h`; PIN login is fixed `12h`).
The `service` claim on staff tokens is the single source of truth for *which
counter a staff member operates* — it can't be spoofed by the client.

### Guard hierarchy (`config/roles.js`)

```mermaid
flowchart LR
    SA[superadmin rank 3] --> A[admin rank 2] --> M[manager rank 1]
    ST[staff rank 0]
    SA -. "isAdminTier() = true" .- A
    A -. "isAdminTier() = true" .- M
```

| Middleware | Passes when |
|---|---|
| `requireAdmin` | `isAdminTier(role)` — superadmin, admin, manager |
| `requireStaff` | `isAdminTier(role) OR role === 'staff'` |
| `requireRole('admin')` | admin-tier AND `atLeast(role,'admin')` |
| `requireRole('superadmin')` | role === superadmin |

`extractPayload()` returns 401 on a missing/`Bearer`-less header, expired token
(`Token expired.`), or bad signature (`Invalid token.`).

### Constant-time login

`auth.service.login` and `staff.service.loginStaff` always run `bcrypt.compare`
against a dummy hash when the username is unknown, so response time doesn't leak
account existence.

### Department resolution (`patient.controller.resolveDepartment`)

```mermaid
flowchart TD
    R{"isAdminTier(req.user.role)?"}
    R -->|yes| Q["use req.body/query.department (explicit)"]
    R -->|no| S["use req.user.service (locked to their counter)"]
```

---

## 7. Data model (Firebase RTDB)

`config/firebase.js → refs` is the **only** place raw paths are written. Client
read/write access is governed by `firebase/database.rules.json`.

```mermaid
erDiagram
    QUEUE_STATE {
        string status "running|paused"
        number currentTokenNumber
        number lastCalledAt
        number pausedAt
        array pausedServices "service keys"
    }
    QUEUE_COUNTER {
        number value "monotonic, transaction-incremented"
    }
    TOKEN {
        string id PK "uuid"
        number number "from counter tx"
        string service "queue key"
        string status "waiting|called|served|expired"
        string priority "normal|priority"
        bool referred
        array referralHistory "transfer trail"
        number issuedAt
        number calledAt
        number servedAt
        number expiresAt
        string patientId FK "-> PATIENT.id"
        string room "OPD room number"
        string assignedTo "OPD doctor username"
        string note
    }
    ANNOUNCEMENT {
        string message
        number setAt
    }
    ADMIN {
        string username PK
        string passwordHash
        string role
        string displayName
    }
    STAFF {
        string username PK
        string passwordHash
        string pinHash
        string service "assigned queue key"
        string displayName
    }
    PRESENCE {
        string username PK
        bool online
        number lastSeen
        string service
    }
    APP_CONFIG {
        string industry "general|medical"
        string orgName
        string location "District, State"
        number slaMinutes
        string displayMessage
        string autoResetTime "HH:MM"
    }
    QUEUE_DEF {
        string id PK "uuid"
        string key "service key on tokens"
        string label
        string prefix
        number order
        bool enabled
        bool archived
    }
    PATIENT {
        string id PK "uuid — also the status capability token"
        string name
        number age
        string gender
        string mobile "10-digit — the patient's ID at the desk"
        string address
        string department
        bool priorityRequested
        string status "registered|tokenIssued|cancelled|expired"
        string tokenId FK "-> TOKEN.id"
        number tokenNumber
        string room
        string assignedDoctor
        number registeredAt
    }
    ROSTER_DOCTOR {
        string username PK "under hospital/roster/{date}/{dept}/doctors"
        string room
        string name
        string status "off|available"
        number addedAt
    }
    ROSTER_CURSOR {
        number value "round-robin pointer, transaction-incremented"
    }
    CONSULTATION {
        string id PK "uuid"
        string patientId FK "-> PATIENT.id"
        string tokenId FK "-> TOKEN.id"
        number tokenNumber
        string department
        string room
        string doctorUsername "owner — write-locked"
        string status "open|completed"
        string diagnosis
        string notes
        array labOrders "test,label,department,tokenId,tokenNumber"
        number startedAt
        number completedAt
    }
    APPOINTMENT {
        string id PK "uuid"
        string name
        string service
        string date "YYYY-MM-DD"
        string timeSlot "HH:MM"
        string status "pending|confirmed|cancelled"
    }
    AUDIT_LOG {
        string id PK "uuid"
        string actor
        string action
        string target
        json meta
        number at
    }

    PATIENT ||--o| TOKEN : "issues on check-in"
    TOKEN }o--o| ROSTER_DOCTOR : "assignedTo / room (OPD)"
    CONSULTATION }o--|| PATIENT : "clinical history"
    CONSULTATION }o--|| TOKEN : "opened for the called token"
    CONSULTATION ||--o{ TOKEN : "lab order -> referred token in lab/radiology"
    STAFF ||--o| PRESENCE : "heartbeat"
    QUEUE_DEF ||--o{ TOKEN : "service key"
```

### RTDB tree (top level)

```
queue/
  state, counter, tokens/{id}, announcement
config/                         app config (industry, orgName, location, SLA, …)
queues/{id}                     admin-defined custom queue definitions
admins/{username}               admin-tier accounts
staff/{username}                counter operators
presence/{username}             live online/offline (client-writable, scoped)
appointments/{id}
auditLogs/{id}
feedback/{tokenId}
hospital/
  patients/{id}                 PII — backend-only
  roster/{YYYY-MM-DD}/{dept}/doctors/{username}, .../cursor
  consultations/{id}
conversations/…, notifications/…, uploads/…, shares/…   (backend-only content)
messageSignals/{id}, notificationSignals/{username}     (content-free realtime pings)
```

### Client access rules (`database.rules.json`)

| Path | `.read` | `.write` | Notes |
|---|---|---|---|
| `queue/state`, `queue/tokens`, `queue/announcement` | **true** | false | display + customer live sync |
| `queue/counter` | false | false | monotonic; server tx only |
| `presence/$username` | true | **true** (self only, shape-validated) | the only client write in the app |
| `messageSignals`, `notificationSignals` | true | false | content-free "refetch now" pings |
| `hospital/**`, `admins`, `conversations`, `notifications`, `uploads` | false | false | served exclusively via the JWT API |

---

## 8. Domain services

### 8.1 Queue engine — `queue.service.js`

State machine for a token:

```mermaid
stateDiagram-v2
    [*] --> waiting : issueToken()
    waiting --> called : callNextToken() / callNextPriorityToken()
    called --> served : next callNext() on that counter (or consultation complete)
    waiting --> expired : expiry sweep (expiresAt < now) — unless referred
    called --> expired : skipToken()
    waiting --> expired : skipToken()
    waiting --> waiting : referToken() (service changes, referred=true, clock reset)
    called --> waiting : referToken()
    expired --> waiting : requeueToken() (new token, ≤2h old) 
```

Key invariants:

- **Token number allocation** is a `refs.counter().transaction()` — safe under
  concurrent `issueToken` calls. Numbers are org-wide, not per-service.
- **Priority blocking:** `callNextToken` throws `409 PRIORITY_BLOCKING` if any
  priority-tier token is waiting anywhere and the next regular token isn't
  priority. `isPriorityTier(t) = t.priority === 'priority' || t.referred`.
- **Pause gates:** global pause blocks all non-priority issue + all `callNext`;
  per-service pause (`state.pausedServices[]`) blocks that one service.
- **`callNextToken(service, staff, {assignedTo})`** — when `assignedTo` is set
  (OPD doctor = their own username), the caller only clears *their own* `called`
  token and is served their own `assignedTo` tokens first, then unassigned ones.
- **Atomic call:** the "serve previous + call next + bump `state`" write is one
  `db.ref('queue').update(multiPathUpdate)`.
- **Referral** keeps the token number, appends to `referralHistory[]`, sets
  `referred=true`, resets `expiresAt` (a referred patient is physically present).

### 8.2 Patient registry — `patient.service.js`

```mermaid
stateDiagram-v2
    [*] --> registered : registerPatient() (self or reception)
    registered --> tokenIssued : verifyAndIssueToken() (looked up by mobile / record id)
    registered --> cancelled : cancelRegistration()
    registered --> expired : patientCleanup sweep (> registrationTtlHours)
```

- **The 10-digit mobile number is the patient's ID.** No Aadhaar is collected.
  Validated as `^[6-9]\d{9}$`.
- **Duplicate guard:** one `registered` record per `(mobile, department)` → `409`.
  Same mobile in a different department is allowed.
- **`verifyAndIssueToken({ patientId?, mobile?, department })`** loads the record
  by `patientId` (staff picked it from the pending list) or finds the
  `registered` record by `(mobile, department)`, then:
  1. `dept === 'opd'` → `rosterService.assignRoom('opd')` (round-robin)
  2. `queueService.issueToken({ service, patientId, priority, room, assignedTo })`
  3. patient → `tokenIssued` with `room` + `assignedDoctor`
- **Priority:** `department === 'emergency'` OR `priorityRequested` → priority token.

### 8.3 Daily roster — `roster.service.js`

Keyed `hospital/roster/{YYYY-MM-DD IST}/{dept}`.

| Function | Guard | Behaviour |
|---|---|---|
| `getRoster(dept)` | staff | doctors sorted by room + live `waiting` count per doctor + `unassignedWaiting` |
| `addDoctor(dept,{username,room})` | admin | staff account must exist and its `service` must equal `dept` |
| `setAvailability(dept,username,status)` | staff (self) | `409` if the caller isn't on today's roster |
| `assignRoom(dept)` | internal | `rosterCursor` transaction → `available[(cursor-1) % n]`; `null` when nobody available |
| `reassign(dept, from)` | admin | move `from`'s (or `'unassigned'`) still-`waiting` tokens round-robin to available doctors; updates both token and patient records |
| `removeDoctor(dept,username)` | admin | `reassign` first (no stranded patients), then delete |

### 8.4 Consultations — `consultation.service.js`

```mermaid
stateDiagram-v2
    [*] --> open : openForToken() — first GET /consultations?tokenId=… by the assigned doctor
    open --> open : update() diagnosis/notes · addLabOrders()
    open --> completed : complete() — closes + calls the doctor's next patient
```

- **Ownership lock:** every mutation checks `c.doctorUsername === req.user.sub`
  → `403` otherwise. `openForToken` also checks `token.assignedTo`.
- **Lab orders** (`LAB_TESTS` map): CT / MRI / X-Ray / Ultrasound → `radiology`,
  ECG → `cardiology`, blood / urine → `lab`. Each ordered test calls
  `queueService.issueToken({ service: target, referred: true, patientId, note })`
  → the patient appears in that queue as a referred (priority-tier) token.
- **`complete()`** sets `completed`, then
  `queueService.callNextToken(dept, doctor, { assignedTo: doctor })` — the
  "Consultation done → call next" action in one call.
- **History:** `historyForPatient(patientId)` returns all prior consultations for
  the same `patientId`, newest first — a permanent per-patient clinical record.

### 8.5 Analytics — `analytics.service.js`

- Every lifecycle event (`token_issued`, `token_called`, `token_served`,
  `token_skipped`, `token_referred`, `patient_registered`, `queue_*`) →
  `logEvent()` → **append CSV row** (schema-guarded; a header mismatch archives
  the old file) **and** `insertOne` into Mongo (if `ANALYTICS_SINK=mongo`).
- All analytics writes are `.catch()`-swallowed — analytics never breaks a request.
- `getTrafficStats()` / `getStaffMetrics()` feed the admin analytics screen and
  the live `avgServiceSeconds` in `GET /config`.

### 8.6 Audit — `audit.service.js`

`record({ actor, action, target, meta })` → append to `auditLogs/{uuid}`.
Fire-and-forget, never throws. `list({ limit })` powers `GET /admin/audit`.

---

## 9. Event bus

`events/bus.js` is a thin `EventEmitter` wrapper. Emitting is deferred to
`setImmediate` (zero added request latency); handler errors are isolated.

```mermaid
flowchart LR
    subgraph Emitters
      P[patient.service] -->|PATIENT_REGISTERED| B
      Q[queue.service] -->|TOKEN_REFERRED| B
      QA[queueAdmin.service] -->|QUEUE_CREATED / QUEUE_ARCHIVED| B
      M[messaging.service] -->|MESSAGE_SENT| B
    end
    B((events/bus))
    B --> NS[notification.service]
    NS --> RTDB[("notifications/{user}<br/>+ notificationSignals/{user} ping")]
```

`events/index.registerSubscribers()` wires the five subscriptions at boot.
`notification.service` turns each event into per-user notification rows and bumps
the content-free `notificationSignals/$username` node the frontend listens on.

---

## 10. Background jobs (`server.js` starts all at boot)

| Service | Interval | Job |
|---|---|---|
| `expiry.service` | 5 min | `waiting` tokens with `expiresAt < now` → `expired` (skips `referred`) |
| `patientCleanup.service` | 10 min | `registered` patients older than `PATIENT_REGISTRATION_TTL_HOURS` → `expired` |
| `scheduler.service` | 1 min | at `config.autoResetTime` (Asia/Karachi) once/day → `queueService.resetQueue()` |
| `appointmentMerge.service` | 1 min | `confirmed` appointments within ±5 min of their slot → issue a priority token |

All are `try/catch`-wrapped and log-only on failure. `SIGTERM`/`SIGINT` stops
every timer and closes the Mongo client before `process.exit(0)`.

---

## 11. Error handling & status codes

Services throw plain `Error` objects with a `.statusCode` property
(`Object.assign(new Error(msg), { statusCode: 409 })`). `errorHandler`:

```mermaid
flowchart TD
    T["service throws Error{statusCode?}"] --> A["asyncHandler → next(err)"]
    A --> H{"status = err.statusCode || 500"}
    H -->|">= 500"| R["reportError() → ERROR_WEBHOOK_URL"]
    H --> J["res.status(status).json({ error: err.message, stack? })"]
```

| Code | Meaning in this system |
|---|---|
| 400 | Joi validation failed (`{ error, details: [{path,message}] }`), or a missing required field |
| 401 | bad/absent/expired JWT, wrong password/PIN |
| 403 | authenticated but wrong tier/role, or not the consultation owner / wrong room |
| 404 | token / patient / consultation / account / route not found |
| 409 | duplicate registration, double token issue, `PRIORITY_BLOCKING`, roster conflict (wrong service, not rostered), illegal state transition |
| 423 | queue or service is paused |
| 429 | rate limiter tripped |
| 500 | unexpected — reported to the webhook |

---

## 12. Security summary

- **No Firebase Auth.** All privileged data is written by the Admin SDK behind
  the JWT API; clients can only *read* the public queue nodes and *write* their
  own `presence` node.
- Passwords + PINs: bcrypt (10 rounds). Patient PII: name, mobile, address — no
  government IDs collected.
- Rate limits: login (20 / 15 min), take-token (10 / min), patient register
  (5 / min), messaging assistant-style caps.
- `helmet`, CORS allow-list from `CORS_ORIGIN`, `x-powered-by` off, `trust proxy`.
- The patient-status endpoint (`GET /patients/:id/status`) is public but the
  `:id` is an unguessable UUID acting as a capability token; it returns first
  name + status + token/room only — no demographics.
- Secrets (`JWT_SECRET`, `FIREBASE_PRIVATE_KEY`, admin creds) are Render
  environment variables, never committed.

---

## 13. Configuration (`config/env.js`, Joi-validated)

| Var | Purpose |
|---|---|
| `JWT_SECRET`, `JWT_EXPIRES_IN` | token signing / lifetime |
| `ADMIN_USERNAME`, `ADMIN_PASSWORD` | bootstrap superadmin |
| `ADMIN_RESET_ON_BOOT` | break-glass password reset flag |
| `FIREBASE_PROJECT_ID / CLIENT_EMAIL / PRIVATE_KEY / DATABASE_URL` | Admin SDK |
| `CORS_ORIGIN`, `FRONTEND_URL` | allow-list + email tracking links |
| `AVG_SERVICE_TIME_SECONDS`, `TOKEN_EXPIRY_SECONDS` | wait estimates, expiry clock |
| `PATIENT_REGISTRATION_TTL_HOURS` | stale-registration sweep |
| `ANALYTICS_SINK` (`csv`\|`mongo`), `ANALYTICS_CSV_PATH`, `MONGO_URI` | analytics store |
| `SMTP_*` | optional token emails |
| `ERROR_WEBHOOK_URL` | Slack/Discord 5xx + client-error feed |

Invalid config → `console.error` the Joi details and `process.exit(1)` before the
server binds.

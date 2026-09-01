# Architecture

QueueLess is a cloud-native monorepo with four independently deployed modules.

## Module map

```
frontend/   React 19 + Vite SPA ──────────▶ Vercel   (static + CDN)
backend/    Node 20 + Express REST API ───▶ Render   (web service)
firebase/   RTDB rules + Cloud Functions ─▶ Firebase (Spark plan)
analytics/  Python pandas + scikit-learn ─▶ CI artifact (predictions.json)
```

## Data flow

```
Customer browser ──REST──▶ Express API ──Admin SDK──▶ Firebase RTDB
        ▲                        │                        │
        └────── onValue (read-only live subscriptions) ◀──┘
                                 │
                                 ├──▶ MongoDB Atlas  (queue_events + tokens mirror)
                                 └──▶ CSV event log  (analytics/data/queue_events.csv)
                                              │
                                              ▼
                                   Python pipeline → predictions.json
                                              │
                                              ▼
                                 backend prediction service (RAG source)
```

- **Firebase RTDB** is the operational store: queue state, tokens, staff,
  admins, custom queues, presence, appointments, config.
- **Clients cannot write operational or content-bearing RTDB data** — those
  writes go through the JWT API. Scoped staff presence is the only direct
  client-write exception.
- **`hospital/patients`** (Medical industry) holds patient PII — name, age,
  gender, mobile number, address. The mobile number is the patient's ID at the
  department desk. Backend-only via the Admin SDK; `.read`/`.write` denied to
  clients. Served exclusively through `/api/v1/patients/*` (a public
  `:id/status` endpoint returns only a first name + status). A background
  sweeper expires stale un-checked-in registrations.
- **MongoDB + CSV** are the analytical event log (dual-write, both optional).

## Real-time model (no Firebase Auth required)

Content-bearing collections (messages, notifications, shared files, AI
conversations) are **not client-readable**. Clients subscribe to
content-free *signal nodes* (`messageSignals/*`, `notificationSignals/*`);
on a bump they refetch through the authenticated API, which enforces
membership/RBAC server-side.

## Backend layering

```
routes → middleware (auth: requireAdmin / requireStaff / requireRole)
       → controllers (thin)
       → services (queue, queueAdmin, roster, consultation, messaging,
                   notification, share, upload, analytics, audit, auth, staff)
       → config (env via Joi, firebase refs, roles)
events/  in-process event bus (token.referred, queue.created, message.sent…)
```

## RBAC

`superadmin > admin > manager` (admin tier) + `staff`. The bootstrap admin
is auto-promoted to superadmin. `requireRole(min)` guards account/role
management; sensitive actions append to the audit log.

## Free-tier constraints (deliberate)

- Firebase **Spark** plan: no Cloud Storage → shared files live in RTDB,
  bounded at 2 MB/file with strict validation.
- Render free tier: cold starts (~30 s) — the frontend tolerates them.
- All request bodies capped at 10 kB except scoped parsers
  (`/conversations` 512 kB, `/uploads` 4 MB).

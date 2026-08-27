# Deploying to production

Hospital / Aadhaar-registration build. Read **Blockers** before exposing anything publicly.

Replace `<PROJECT_ID>` below with your Firebase project id, and
`<BACKEND_URL>` / `<FRONTEND_URL>` with the deployed URLs.

---

## Architecture

| Piece | Runs on | Notes |
|---|---|---|
| Realtime Database | Firebase project (Spark / free plan) | operational store + patient registry |
| Frontend (`frontend/`) | Firebase Hosting (free) or Vercel / Netlify | static build → `dist/` |
| Backend (`backend/`) | Render / Railway / Fly.io / Cloud Run | cannot run on Firebase's free plan; `render.yaml` is pre-wired for Render |
| Analytics (`analytics/`) | on demand (cron / manual) | not a server |

Once deployed, everything runs 24/7 — your laptop is only needed to push code.

**Status:** frontend live at `https://hospital-queueless-dev.web.app` ·
Firebase rules locked · backend **not yet deployed** (do the Render step below,
then rebuild the frontend with `VITE_API_BASE_URL` set to the Render URL).

---

## 🔴 Blockers — before any public deploy

### 1. Lock down the Firebase database rules

The DB starts in **test mode** (`{".read": true, ".write": true}`) — the whole
database is world read/write. Deploy the hardened `firebase/database.rules.json`:

```bash
npm i -g firebase-tools
cd firebase && firebase login && firebase deploy --only database
```

or, without an interactive login, using the service-account JSON:

```bash
GOOGLE_APPLICATION_CREDENTIALS=../backend/serviceAccount.json \
  npx firebase-tools deploy --only database --project <PROJECT_ID> --non-interactive
```

`database.rules.json` denies **all** client access to `hospital/*` (patient PII);
clients can only read `queue/state`, `queue/tokens`, `queue/announcement`,
`presence`, and the signal nodes — everything else goes through the JWT API.

### 2. Rotate every secret

Fresh values in the **deployed backend env** — never reuse the dev `.env`:

```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"  # JWT_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"  # AADHAAR_SALT
```

Also set a strong `ADMIN_PASSWORD` and change it again in-app after first login.
`AADHAAR_SALT` invalidates every stored patient-record hash when changed — set it
once, before go-live.

### 3. Legal review for Aadhaar handling

Storing even a hash + last 4 digits of an Aadhaar number in India is governed by
the Aadhaar Act / UIDAI rules. Get the consent wording reviewed and a
data-retention policy in place, or switch identity verification to a
hospital-issued patient ID (MRN). **Not a code task; don't skip it.**

---

## Backend → Render

1. Render dashboard → **New → Blueprint** → select your GitHub repo. `render.yaml`
   is auto-detected (builds `backend/` with `npm ci`, starts `node src/server.js`,
   health check `/api/v1/health`).
2. In the service's **Environment** tab set every `sync: false` var from
   `render.yaml`: `JWT_SECRET`, `AADHAAR_SALT`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`,
   `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`
   (paste with the literal `\n`, wrapped in quotes), `FIREBASE_DATABASE_URL`,
   `CORS_ORIGIN` = `<FRONTEND_URL>`, `FRONTEND_URL` = `<FRONTEND_URL>`.
3. Deploy. Verify: `curl https://<BACKEND_URL>/api/v1/health` → `{"status":"ok"}`.
4. Settings → **Deploy Hook** → copy the URL → add it as the GitHub repo secret
   `RENDER_DEPLOY_HOOK` so `backend-ci.yml` redeploys on every green push.

> Free tier sleeps after 15 min idle (~50 s cold start). A real reception desk
> wants the always-on instance.

## Frontend → Firebase Hosting

**Already deployed** → `https://hospital-queueless-dev.web.app`
(the display board + live home-page status work now; interactive pages need the
backend). The root `firebase.json` holds the hosting config.

To redeploy (e.g. after the backend URL is known):

```bash
cd frontend
cp .env.example .env.production   # VITE_API_BASE_URL=https://<BACKEND_URL>/api/v1  + the VITE_FIREBASE_* web config
npm run build
cd ..
GOOGLE_APPLICATION_CREDENTIALS=backend/serviceAccount.json \
  firebase/node_modules/.bin/firebase deploy --only hosting --project <PROJECT_ID> --non-interactive
```

Or let CI do it — add two repo secrets and every push to `main` deploys:

| Secret | Value |
|---|---|
| `FIREBASE_SERVICE_ACCOUNT` | full contents of `backend/serviceAccount.json` |
| `FIREBASE_HOSTING_ENV` | the production `VITE_*` lines, one `KEY=VALUE` per line |

(Prefer Vercel? Connect the repo in the Vercel dashboard and delete the `deploy`
job in `.github/workflows/frontend-ci.yml`.)

After the frontend URL exists, set `CORS_ORIGIN` + `FRONTEND_URL` on Render to it
and redeploy the backend.

---

## GitHub repo secrets (Settings → Secrets and variables → Actions)

| Secret | Used by | Needed for |
|---|---|---|
| `FIREBASE_SERVICE_ACCOUNT` | `firebase-rules.yml`, `frontend-ci.yml`, `backup.yml` | auto-deploy DB rules + Hosting, nightly backup |
| `FIREBASE_DATABASE_URL` | `backup.yml` | the RTDB URL (not in the service account JSON) |
| `FIREBASE_HOSTING_ENV` | `frontend-ci.yml` | build the frontend with real env in CI |
| `RENDER_DEPLOY_HOOK` | `backend-ci.yml` | auto-redeploy the backend |
| `SMOKE_BASE_URL`, `SMOKE_ADMIN_USER`, `SMOKE_ADMIN_PASS` | `backend-ci.yml` | post-deploy read-only smoke test |

Every deploy/backup/smoke job **skips cleanly** if its secret is missing — CI
(lint + test + build) still gates merges.

---

## Operations scripts

Run from the repo root (they use `backend/serviceAccount.json`).

| Command | What |
|---|---|
| `node firebase/deploy-rules.js` | deploy `database.rules.json` to the live RTDB (`--open` reverts to test-mode) |
| `node firebase/verify-rules.js` | check the deployed rules allow queue reads and deny `hospital/*` / `admins` / `counter` |
| `node firebase/backup.js [outDir]` | full RTDB export → timestamped JSON (keeps newest 14 locally) |
| `cd backend && npm run smoke` | end-to-end HTTP test against a running backend (`BASE_URL`, `ADMIN_PASS` env; `--readonly` for a no-write check) |
| `cd backend && npm run loadtest` | read-path load generator (`DURATION`, `CONCURRENCY` env); reports throughput + latency percentiles |

## Monitoring

Set `ERROR_WEBHOOK_URL` on the backend to a Slack/Discord incoming webhook (or a
log collector). Backend 5xx errors, unhandled rejections, and browser errors
(via the `ErrorBoundary` + global handlers → `POST /api/v1/client-error`) are
forwarded there as JSON. Swap `backend/src/utils/reportError.js` for
`Sentry.captureException` if you'd rather use Sentry.

## Locked out of admin?

Set `ADMIN_RESET_ON_BOOT=true` on the backend and redeploy — the bootstrap
admin's password resets to `ADMIN_PASSWORD` on the next boot. Log in, then set
the flag back to `false` and redeploy. Or, from another superadmin account:
**Admin accounts → Reset password**.

---

## Post-deploy checklist

- [ ] `firebase deploy --only database` ran; test-mode rules replaced
- [ ] All secrets rotated; dev `.env` not reused
- [ ] `curl https://<BACKEND_URL>/api/v1/health` → `{"status":"ok"}`
- [ ] Admin login works; **admin password changed from the bootstrap value**
- [ ] `CORS_ORIGIN` on the backend exactly matches the frontend origin
- [ ] Industry = Medical → `/admin/queues` shows all departments
- [ ] `/register` → reception verify → token issued → shows on `/display`
- [ ] Public `/register` rate limit works (6th submit in a minute → 429)
- [ ] HTTPS everywhere; custom domain (optional)
- [ ] Consent wording reviewed; retention policy documented

## Still open (before a real hospital pilot)

- Uptime alerts (the error webhook covers exceptions, not "is it up")
- Hermetic integration tests against the Firebase emulator (the HTTP `smoke`
  script covers the critical path against a real backend today)
- Migrate the major dependency bumps: express 4→5, jest 29→30, tailwind 3→4,
  bcryptjs 2→3, eslint 9→10 (each is a breaking change — do them one at a time)
- Chart `patient_registered` / `patient_verified` in AdminAnalytics + the
  Python pipeline (live counts are on the reception page today)

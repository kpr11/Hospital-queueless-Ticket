# Deploying QueueLess to production

This is the hospital / Aadhaar-registration build. Read the **Blockers** section
before you expose anything publicly.

---

## Architecture

| Piece | Runs on | Notes |
|---|---|---|
| Realtime Database | Firebase project (your `hospital-queueless-dev`, or a fresh prod project) | Free Spark plan is enough. |
| Frontend (`frontend/`) | Firebase Hosting **or** Vercel / Netlify | Static build (`npm run build` → `dist/`). |
| Backend (`backend/`) | Render / Railway / Fly.io **or** Google Cloud Run | Cannot run on Firebase's free plan. `render.yaml` is pre-wired for Render. |
| Analytics (`analytics/`) | Run on demand (cron / manual) | Not a server. |

Your laptop is only needed to *deploy*. Once deployed, everything runs 24/7 without it.

---

## 🔴 Blockers — do these before any public deploy

1. **Lock down Firebase rules.** The database is currently in test mode
   (`{".read": true, ".write": true}`) — anyone on the internet can read/write
   everything. Deploy the hardened rules:
   ```bash
   npm i -g firebase-tools
   cd firebase
   firebase login
   firebase use <your-project-id>
   firebase deploy --only database
   ```
   `database.rules.json` already denies all client access to `hospital/*`
   (patient PII) — it is served only through the authenticated API.

2. **Rotate every secret.** In the deployed backend env, set fresh values for:
   `JWT_SECRET` (64-byte hex), `ADMIN_PASSWORD` (strong), `AADHAAR_SALT`
   (32-byte hex, dedicated — not the JWT secret). Never reuse the dev `.env`.
   ```bash
   node -e "console.log(require('crypto').randomBytes(64).toString('hex'))" # JWT_SECRET
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))" # AADHAAR_SALT
   ```
   Changing `AADHAAR_SALT` invalidates the hash of every existing patient
   record — only set it once, before go-live.

3. **Get the code into your own Git repo.** `origin` currently points at
   `SufiyanAasim/queueless` (upstream). Create your own repo and push there;
   Render/Vercel deploy from a repo you control.

4. **Legal review for Aadhaar handling.** Storing even a hash + last 4 digits of
   an Aadhaar number in India is governed by the Aadhaar Act / UIDAI rules. Get
   the consent wording reviewed and a data-retention policy in place, or switch
   identity verification to a hospital-issued patient ID (MRN). This is not a
   code task and should not be skipped for a real hospital.

---

## Backend → Render (free tier or $7/mo)

1. Push your repo to GitHub.
2. Render dashboard → **New → Blueprint** → point at your repo. `render.yaml` is
   detected; it builds `backend/` with `npm ci` and starts `node src/server.js`.
3. Set the secret env vars (marked `sync: false` in `render.yaml`) in the Render
   dashboard: `JWT_SECRET`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`,
   `AADHAAR_SALT`, `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`,
   `FIREBASE_PRIVATE_KEY` (keep the `\n` escapes, wrap in quotes),
   `FIREBASE_DATABASE_URL`, `CORS_ORIGIN` (your frontend URL),
   `FRONTEND_URL`, and `MONGO_URI` only if you set `ANALYTICS_SINK=mongo`.
4. Deploy. Health check: `https://<your-backend>.onrender.com/api/v1/health`.

> Free tier sleeps after 15 min idle (~50 s cold start on the next request).
> A real reception desk should use the $7/mo always-on instance.

## Frontend → Firebase Hosting (free)

```bash
cd frontend
# set the production API URL + Firebase web config in .env.production
#   VITE_API_BASE_URL=https://<your-backend>.onrender.com/api/v1
#   VITE_FIREBASE_* = your web app config
npm run build

cd ..
npm i -g firebase-tools   # if not already
firebase init hosting     # public dir: frontend/dist, SPA rewrite: yes
firebase deploy --only hosting
```

Then set `CORS_ORIGIN` and `FRONTEND_URL` on the backend to the Hosting URL and
redeploy the backend.

---

## Post-deploy checklist

- [ ] `firebase deploy --only database` ran; test-mode rules replaced
- [ ] All secrets rotated; dev `.env` not reused
- [ ] `curl https://<backend>/api/v1/health` → `{"status":"ok"}`
- [ ] Admin login works; **admin password changed from the bootstrap value**
- [ ] `CORS_ORIGIN` on the backend matches the deployed frontend origin exactly
- [ ] Industry set to Medical → `/admin/queues` shows all departments
      (use "+ Medical / Hospital defaults" if not)
- [ ] `/register` → reception desk verify → token issued → shows on `/display`
- [ ] Public `/register` rate limit works (6th submit in a minute → 429)
- [ ] HTTPS everywhere; custom domain (optional) configured
- [ ] Consent wording reviewed; retention policy documented

## Still open (not blockers, but before a real hospital pilot)

- Error monitoring (Sentry) + uptime alerts — needs an account + DSN
- CI running `npm test` + `npm run lint` on every push — needs the repo
- Admin password-reset flow
- Real integration tests (current suite mocks Firebase)
- RTDB backup schedule
- Load testing the reception + display path

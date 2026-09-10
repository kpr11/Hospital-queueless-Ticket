# GCP production release

Target: `hospital-queueless-prod-kpr11` (new production Firebase/GCP project).
Frontend: https://hospital-queueless-prod-kpr11.web.app
Backend: Cloud Run service `queueless-api`, region `asia-southeast1`.
Database: new empty Firebase Realtime Database in Singapore.

Firebase Hosting remains the public HTTPS/CDN entry point. `/api/**` forwards to Cloud Run; React routes fall back to `index.html`. No local web server is needed to use the deployed product. Builds run in Cloud Build and images are stored in Artifact Registry. Runtime credentials use the Cloud Run service identity; JWT/bootstrap passwords are versioned in Secret Manager. Application logs go to Cloud Logging.

## Deploy

Use Node 22, Google Cloud CLI and Firebase CLI 15.30.0. Database emulator checks require Java 21. Authenticate an account authorized to enable APIs, build images, deploy Cloud Run/Hosting, manage the two service accounts, and provision Secret Manager secrets. The Firebase Admin SDK account in the original repository environment does not have these deployment permissions.

```bash
gcloud auth login
firebase login
export GCP_PROJECT_ID=hospital-queueless-prod-kpr11
bash scripts/deploy-gcp.sh
```

For the current development session the downloaded tools are in `/tmp/queueless-cloud/google-cloud-sdk/bin` and `/tmp/queueless-tools/node_modules/.bin`. The isolated gcloud config is `/tmp/queueless-cloud/config`.

The script requires private `backend/.env.production` and `frontend/.env.production` files. The backend's Firebase project must match the target. Keep the existing JWT/bootstrap credentials in those private files; the script never prints them or includes them in the build upload. `ADMIN_RESET_ON_BOOT` stays false, so existing owner passwords are preserved. Set a strong unique admin password before accepting real patients. Firebase frontend configuration is public client configuration, not a server credential.

The frontend build is forced to `VITE_API_BASE_URL=/api/v1`; it must never contain the old Render API URL. Both application gates run before cloud resources change. The script creates dedicated runtime/build identities, uploads secrets, builds remotely, deploys Cloud Run, checks its health, deploys rules and Hosting, then runs read-only production checks.

Run database emulator tests before release:

```bash
NODE_PATH=/tmp/queueless-tools/node_modules \
FIREBASE_EMULATORS_PATH=/tmp/queueless-emulators \
/tmp/queueless-tools/node_modules/.bin/firebase emulators:exec \
  --only database --project demo-queueless --config firebase/emulator.json \
  'node firebase/test-rules.cjs'
```

Cloud Run uses one minimum instance and instance-based CPU allocation because this version runs appointment merge, expiry and daily reset in the process. This incurs ongoing compute charges while idle. The initial service is capped at one instance with concurrency one; do not treat this as a high-volume or highly available deployment. Configure a billing budget in the project and validate capacity before increasing limits.

## Cloud debugging

[Cloud Run service](https://console.cloud.google.com/run/detail/asia-southeast1/queueless-api/metrics?project=hospital-queueless-prod-kpr11)

[Cloud Build history](https://console.cloud.google.com/cloud-build/builds?project=hospital-queueless-prod-kpr11)

[Cloud Logging](https://console.cloud.google.com/logs/query?project=hospital-queueless-prod-kpr11)

```bash
gcloud run services logs read queueless-api \
  --region asia-southeast1 --project hospital-queueless-prod-kpr11 --limit 100

gcloud run services describe queueless-api \
  --region asia-southeast1 --project hospital-queueless-prod-kpr11

node scripts/smoke-production.mjs https://hospital-queueless-prod-kpr11.web.app
```

The health route is `/api/v1/health`. It establishes that startup completed and HTTP is responding; it is not a continuous database availability probe. Configure uptime/error alerts and a notification recipient in Cloud Monitoring. Avoid putting patient names, phone numbers or clinical notes in logs. Production access logs intentionally omit paths and query strings that can contain patient/token identifiers.

## Data and access changes

- Full token records are no longer readable through the Firebase browser SDK. The public queue/status API uses an explicit field allowlist and excludes patient names, registration IDs, notes and referral details.
- Queue pages refresh through the API every three seconds; individual token tracking refreshes every five seconds. A staff session receives private queue fields for its own department; public display pages receive public data even when a staff session exists in the browser.
- Presence writes use the authenticated API, heartbeat every 30 seconds, and appear offline after 90 seconds without a heartbeat.
- Removed accounts lose API access; password resets/changes revoke previous sessions. Changes to roles and service assignments are enforced from stored account data.
- Queue advancement uses a Firebase transaction, with analytics emitted only after commit.
- Analytics events use private `analytics/events` records in production, including CSV export and staff metrics. Existing local CSV history is not migrated automatically.
- Appointment/reset clocks use Asia/Kolkata.
- API responses use `private, no-store` so Hosting/browser caches do not retain patient responses.

## Release gates still requiring operational verification

A passing build and mock test suite do not establish commercial readiness. Before admitting real patients, verify the following against a designated test dataset in the deployed environment:

1. Hospital staff acceptance of the workflow. The release verification passed 19 live OPD checks covering registration, room assignment, consultation and lab referral; synthetic clinical records were removed afterward.
2. Expected desk/display traffic, latency and error rate. The current implementation scans whole token/patient/event collections; large histories need pagination, indexing and archival.
3. Scheduled tasks across restarts and deployments. Timers are process-local; overlapping revisions can overlap appointment/reset work. Move these jobs to an authenticated Cloud Scheduler/worker flow with durable idempotency before scaling out.
4. Database automated backups, a tested restore procedure, retention settings and operational ownership. Existing GitHub backup automation is not a verified restore guarantee.
5. Hospital access policies, including clinical-history retention and shared-file capabilities. Patient-history reads now require an assigned/treating doctor or an admin-tier session; this focused release review is not a complete security audit.
6. Alerts, a billing budget, staff training and a rollback exercise.

Do not run the existing mutating smoke/load scripts against real patient data. `scripts/smoke-production.mjs` is read-only.

## Rollback

Record the previous Cloud Run revision and Hosting release before deployment. To restore a known-safe backend:

```bash
gcloud run revisions list --service queueless-api --region asia-southeast1 --project hospital-queueless-prod-kpr11
gcloud run services update-traffic queueless-api --to-revisions SAFE_REVISION=100 \
  --region asia-southeast1 --project hospital-queueless-prod-kpr11
```

Use Firebase Hosting release history to roll back the frontend to a version compatible with the private token API. Do not restore the old public token database rule to make an old frontend work. Database migrations/backups are managed separately from application rollback. No reset or patient-data deletion is part of the deployment script.

## Official references

- [Firebase Hosting with Cloud Run](https://firebase.google.com/docs/hosting/cloud-run)
- [Cloud Run billing/CPU allocation](https://docs.cloud.google.com/run/docs/configuring/billing-settings)
- [gcloud run deploy options](https://docs.cloud.google.com/sdk/gcloud/reference/run/deploy)

## Release evidence

See [2026-09-10 release verification](GCP-Release-2026-09-10.md) for the deployed revision, build, test results and live links.

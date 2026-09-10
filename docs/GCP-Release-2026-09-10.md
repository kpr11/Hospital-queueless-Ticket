# GCP release verification — 2026-09-10

Deployed to the new project **hospital-queueless-prod-kpr11**, linked to the user's active billing account. No development records were migrated.

- [Production website](https://hospital-queueless-prod-kpr11.web.app/)
- [Admin login](https://hospital-queueless-prod-kpr11.web.app/admin/login)
- [Cloud Run service](https://console.cloud.google.com/run/detail/asia-southeast1/queueless-api/metrics?project=hospital-queueless-prod-kpr11)
- [Cloud Build](https://console.cloud.google.com/cloud-build/builds/227cca2c-229b-406b-a1c5-887c88710c1f?project=hospital-queueless-prod-kpr11)
- [Cloud logs](https://console.cloud.google.com/logs/query?project=hospital-queueless-prod-kpr11)
- [Admin bootstrap password in Secret Manager](https://console.cloud.google.com/security/secret-manager/secret/queueless-admin-password/versions?project=hospital-queueless-prod-kpr11)

Admin username: `admin`. The unique generated password is in Secret Manager and the ignored local `backend/.env.production`; no credentials are committed. Changing the password through the application does not change the stored bootstrap secret, and restart does not reset the account password.

Cloud Run revision: `queueless-api-00001-9n8`.

Image digest: `sha256:8b53ca45a3dedb8ed0098255c83be79abba1fa3df5eec8b6b1399d1bceee6d9d`.

Backend direct URL: `https://queueless-api-1027687904435.asia-southeast1.run.app`.

## Verification completed

- 79 backend tests passed after a clean dependency install.
- Frontend production build and lint passed; existing lint warnings remain.
- Backend and frontend dependency audits reported zero vulnerabilities after compatible security updates, including morgan, nodemailer, brace-expansion and qs. This records the audit result at release time, not a security guarantee.
- Firebase rules emulator verified denied reads of private token/patient/clinical/account/content data and denied browser presence writes.
- Actual Firebase emulator transactions verified simultaneous queue advances selected distinct tokens.
- Deployed anonymous requests to private database paths were rejected.
- Production HTTP checks passed for SPA routes, Hosting-to-Cloud Run API routing, health, authentication boundaries and cache-control headers.
- Chrome verified the home page, successful admin login, fully rendered admin dashboard, display board and mobile width, with no runtime JavaScript errors or failed API calls.
- All 19 live OPD workflow checks passed: doctor accounts/roster, room assignment, patient registration/check-in, consultation, lab routing, history and access restrictions.
- Synthetic patient, consultation, token, staff and presence records were removed after the workflow test. Default hospital departments and the owner account remain. Synthetic audit/analytics entries may remain as verification history.

## Operational limits

The service is live, but commercial hospital acceptance is still required. One always-on Cloud Run instance supports the current process timers; large-scale/high-availability operation has not been validated. Scheduled-job idempotency across overlapping revisions, backup scheduling plus restore testing, retention rules, monitoring notifications, billing alerts, and expected-load testing remain operational follow-up work. Configure the hospital name/location and real staff/doctor roster through the admin screens before intake.

The deployment and debugging commands, data-access changes, and rollback procedure are in the [GCP production runbook](GCP-Production.md).

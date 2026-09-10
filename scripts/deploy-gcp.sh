#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
export GCP_PROJECT_ID="${GCP_PROJECT_ID:-hospital-queueless-prod-kpr11}"
export GOOGLE_CLOUD_QUOTA_PROJECT="$GCP_PROJECT_ID"
region=asia-southeast1
service=queueless-api
runtime="queueless-runtime@${GCP_PROJECT_ID}.iam.gserviceaccount.com"
builder="queueless-build@${GCP_PROJECT_ID}.iam.gserviceaccount.com"
command -v gcloud >/dev/null
command -v firebase >/dev/null
private_dir=$(mktemp -d /tmp/queueless-deploy.XXXXXX)
trap 'rm -rf "$private_dir"' EXIT
node scripts/prepare-gcp-env.cjs "$private_dir"

# Both application gates complete before changing cloud resources.
npm --prefix backend ci
npm --prefix backend run lint
npm --prefix backend test -- --silent
npm --prefix frontend ci
npm --prefix frontend run lint
VITE_API_BASE_URL=/api/v1 npm --prefix frontend run build

gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com firebasedatabase.googleapis.com firebasehosting.googleapis.com --project "$GCP_PROJECT_ID"
for account in queueless-runtime queueless-build; do
  if ! gcloud iam service-accounts describe "${account}@${GCP_PROJECT_ID}.iam.gserviceaccount.com" --project "$GCP_PROJECT_ID" >/dev/null 2>&1; then
    gcloud iam service-accounts create "$account" --project "$GCP_PROJECT_ID"
  fi
done
gcloud projects add-iam-policy-binding "$GCP_PROJECT_ID" --member="serviceAccount:$runtime" --role=roles/firebasedatabase.admin --condition=None --quiet >/dev/null
for role in roles/artifactregistry.writer roles/logging.logWriter roles/storage.objectViewer; do
  gcloud projects add-iam-policy-binding "$GCP_PROJECT_ID" --member="serviceAccount:$builder" --role="$role" --condition=None --quiet >/dev/null
done
if ! gcloud artifacts repositories describe queueless --location "$region" --project "$GCP_PROJECT_ID" >/dev/null 2>&1; then
  gcloud artifacts repositories create queueless --repository-format=docker --location "$region" --project "$GCP_PROJECT_ID"
fi

for key in JWT_SECRET ADMIN_PASSWORD; do
  secret="queueless-${key,,}"
  secret="${secret//_/-}"
  if ! gcloud secrets describe "$secret" --project "$GCP_PROJECT_ID" >/dev/null 2>&1; then
    gcloud secrets create "$secret" --replication-policy=automatic --project "$GCP_PROJECT_ID"
  fi
  version=$(gcloud secrets versions add "$secret" --data-file="$private_dir/$key" --project "$GCP_PROJECT_ID" --format='value(name)')
  gcloud secrets add-iam-policy-binding "$secret" --member="serviceAccount:$runtime" --role=roles/secretmanager.secretAccessor --project "$GCP_PROJECT_ID" --quiet >/dev/null
  if [ "$key" = JWT_SECRET ]; then jwt_version="${version##*/}"; else admin_version="${version##*/}"; fi
done

build_id=$(gcloud builds submit . --config cloudbuild.yaml --substitutions="_REGION=$region" --service-account="projects/$GCP_PROJECT_ID/serviceAccounts/$builder" --project "$GCP_PROJECT_ID" --suppress-logs --format='value(id)')
gcloud run deploy "$service" --image="$region-docker.pkg.dev/$GCP_PROJECT_ID/queueless/backend:$build_id" \
  --project "$GCP_PROJECT_ID" --region "$region" --service-account="$runtime" \
  --port=8080 --cpu=1 --memory=512Mi --min=1 --max=1 --concurrency=1 \
  --no-cpu-throttling --timeout=60 --allow-unauthenticated \
  --env-vars-file="$private_dir/runtime.json" \
  --set-secrets="JWT_SECRET=queueless-jwt-secret:$jwt_version,ADMIN_PASSWORD=queueless-admin-password:$admin_version" \
  --startup-probe='httpGet.path=/api/v1/health,httpGet.port=8080,periodSeconds=10,failureThreshold=24,timeoutSeconds=5' --quiet

backend_url=$(gcloud run services describe "$service" --project "$GCP_PROJECT_ID" --region "$region" --format='value(status.url)')
curl --fail --silent --show-error "$backend_url/api/v1/health"
# Close direct patient-record reads before releasing the new frontend.
firebase deploy --only database,hosting --project "$GCP_PROJECT_ID" --non-interactive
node scripts/smoke-production.mjs "https://$GCP_PROJECT_ID.web.app"
printf '\nReleased frontend: https://%s.web.app\nBackend: %s\n' "$GCP_PROJECT_ID" "$backend_url"

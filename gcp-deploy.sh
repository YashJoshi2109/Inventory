#!/bin/bash
set -e

# Load env vars from .env (only KEY=VALUE lines, skip comments and bare values)
while IFS='=' read -r key value; do
  [[ "$key" =~ ^[[:space:]]*# ]] && continue
  [[ -z "$key" ]] && continue
  [[ "$key" != *"="* ]] || true
  value="${value%%#*}"  # strip inline comments
  value="${value%"${value##*[![:space:]]}"}"  # strip trailing whitespace
  export "$key=$value"
done < <(grep -E '^[A-Za-z_][A-Za-z0-9_]*=' .env)

PROJECT=gen-lang-client-0602255200
REGION=us-central1
IMAGE=us-central1-docker.pkg.dev/$PROJECT/inventory-backend/api:latest
SA=inventory-backend-sa@$PROJECT.iam.gserviceaccount.com

echo "Deploying Cloud Run service..."

gcloud run deploy inventory-backend \
  --image="$IMAGE" \
  --region="$REGION" \
  --platform=managed \
  --allow-unauthenticated \
  --service-account="$SA" \
  --port=8000 \
  --min-instances=0 \
  --max-instances=5 \
  --memory=1Gi \
  --cpu=1 \
  --timeout=300 \
  --concurrency=80 \
  --command="sh" \
  --args="-c,alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 1" \
  --set-env-vars="DATABASE_SSL=true,GCS_BUCKET_NAME=sierlab-inv-uploads,MQTT_ENABLED=false,ENVIRONMENT=production,POSTGRES_HOST=$POSTGRES_HOST,POSTGRES_PORT=$POSTGRES_PORT,POSTGRES_DB=$POSTGRES_DB,POSTGRES_USER=$POSTGRES_USER,WEBAUTHN_RP_ID=inventory-brown-beta.vercel.app,WEBAUTHN_ORIGINS=https://inventory-brown-beta.vercel.app,CORS_ORIGINS=[\"https://inventory-brown-beta.vercel.app\"],CORS_ORIGIN_REGEX=^https://.*\.vercel\.app$,GEMINI_API_KEY=$GEMINI_API_KEY,SECRET_KEY=$SECRET_KEY,POSTGRES_PASSWORD=$POSTGRES_PASSWORD"

echo ""
echo "Deploy complete! Service URL:"
gcloud run services describe inventory-backend --region=$REGION --format="value(status.url)"

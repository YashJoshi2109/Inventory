#!/bin/bash
set -e

PROJECT=gen-lang-client-0602255200
BUCKET=gs://sierlab-inv-uploads
SA=inventory-backend-sa@gen-lang-client-0602255200.iam.gserviceaccount.com

echo "Granting GCS access to service account..."
gcloud storage buckets add-iam-policy-binding $BUCKET \
  --member="serviceAccount:$SA" \
  --role="roles/storage.objectAdmin"

echo "Done!"

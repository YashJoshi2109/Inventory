# Required GitHub Secrets for CI/CD

Configure these in **Settings → Secrets and variables → Actions** on your GitHub repository.

## Deployment Secrets

| Secret | Required | Description |
|--------|----------|-------------|
| `VERCEL_TOKEN` | Yes | Vercel personal access token (from vercel.com/account/tokens) |
| `VERCEL_ORG_ID` | Yes | Found in `.vercel/project.json` after running `vercel link` |
| `VERCEL_PROJECT_ID` | Yes | Found in `.vercel/project.json` after running `vercel link` |
| `RENDER_DEPLOY_HOOK_URL` | Yes | Render deploy hook URL (Dashboard → Service → Settings → Deploy Hooks) |
| `BACKEND_URL` | Optional | e.g. `https://sierlab-inventory-backend.onrender.com` — used for smoke test |


## Getting Render Deploy Hook

1. Go to your Render service dashboard
2. Navigate to **Settings** → **Deploy Hooks**
3. Create a new hook and copy the URL

## Environment Variables (set in Render dashboard, NOT in GitHub)

The following are sensitive and must be set directly in the Render dashboard:
- `POSTGRES_PASSWORD`
- `SECRET_KEY`
- `GEMINI_API_KEY`
- `CORS_ORIGINS`
- `WEBAUTHN_RP_ID`
- `WEBAUTHN_ORIGINS`
- `MQTT_PASSWORD`

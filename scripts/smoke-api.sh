#!/usr/bin/env bash
# Quick production API checks (no browser). Override URLs as needed.
set -euo pipefail
API_ROOT="${SMOKE_API_ROOT:-https://sierlab-inventory-backend.onrender.com}"
API="${API_ROOT%/}/api/v1"
USER="${SMOKE_LOGIN_USERNAME:-sear_admin}"
PASS="${SMOKE_LOGIN_PASSWORD:-SearLab@2024}"

echo "== Health $API_ROOT/health =="
curl -sSf "$API_ROOT/health" | head -c 200
echo ""

echo "== Login 401 (bad password) =="
code=$(curl -sS -o /tmp/smoke-login.json -w "%{http_code}" -X POST "$API/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"$USER\",\"password\":\"wrong-password\"}")
test "$code" = "401"
echo "HTTP $code OK"

echo "== Login 200 =="
tok=$(curl -sS -X POST "$API/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"$USER\",\"password\":\"$PASS\"}" | python3 -c "import sys,json; print(json.load(sys.stdin).get('access_token',''))")
test "${#tok}" -gt 50
echo "token length ${#tok} OK"

echo "== GET /auth/me =="
curl -sS -o /tmp/smoke-me.json -w "HTTP %{http_code}\n" "$API/auth/me" -H "Authorization: Bearer $tok" | tail -1
grep -q "\"username\"" /tmp/smoke-me.json

echo "== GET /dashboard/email-service-status =="
code=$(curl -sS -o /tmp/smoke-email.json -w "%{http_code}" "$API/dashboard/email-service-status" \
  -H "Authorization: Bearer $tok")
if [[ "$code" != "200" ]]; then
  echo "HTTP $code. Body:" && head -c 300 /tmp/smoke-email.json && echo ""
  if [[ "${SMOKE_ALLOW_EMAIL_STATUS_404:-}" == "1" && "$code" == "404" ]]; then
    echo "SMOKE_ALLOW_EMAIL_STATUS_404=1: continuing (redeploy backend to enforce email-status check)."
  else
    echo "Fix: deploy latest backend to Render, or run with SMOKE_ALLOW_EMAIL_STATUS_404=1 during rollout."
    exit 1
  fi
else
  python3 -c "import json; d=json.load(open('/tmp/smoke-email.json')); assert 'active_provider' in d and 'brevo_configured' in d"
  echo "email-service-status JSON OK"
fi

echo ""
echo "All API smoke checks passed."

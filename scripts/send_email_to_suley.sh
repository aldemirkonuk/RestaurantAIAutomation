#!/usr/bin/env bash
# Send a template email via WineOps API (recipient from TO_EMAIL).
# Uses the ready-made "test" template.
#
# Requirements:
#   - API gateway running: pnpm --filter @wineops/api-gateway start:dev (port 4000)
#   - Gmail configured (GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN) for real sends;
#     otherwise the API mocks and logs only.
#
# Usage:
#   TO_EMAIL=you@example.com ./scripts/send_email_to_suley.sh

set -e

TO_EMAIL="${TO_EMAIL:-you@example.com}"
API_URL="${API_URL:-http://localhost:4000}"
ENDPOINT="${API_URL}/api/v1/communications/test/send-template"

echo "Sending template email to ${TO_EMAIL}..."
echo "API: $ENDPOINT"

RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$ENDPOINT" \
  -H "Content-Type: application/json" \
  -d "{\"to\": [\"${TO_EMAIL}\"], \"template\": \"test\"}" 2>/dev/null) || true

if [ -z "$RESPONSE" ]; then
  echo ""
  echo "Could not reach API. Is the gateway running on port 4000?"
  echo "  pnpm --filter @wineops/api-gateway start:dev"
  exit 1
fi

HTTP_BODY=$(echo "$RESPONSE" | head -n -1)
HTTP_CODE=$(echo "$RESPONSE" | tail -n 1)

echo ""
if [ "$HTTP_CODE" -ge 200 ] && [ "$HTTP_CODE" -lt 300 ]; then
  echo "Email sent successfully (HTTP $HTTP_CODE)"
  echo "$HTTP_BODY" | jq '.' 2>/dev/null || echo "$HTTP_BODY"
else
  echo "Request failed (HTTP $HTTP_CODE)"
  echo "$HTTP_BODY" | jq '.' 2>/dev/null || echo "$HTTP_BODY"
  exit 1
fi

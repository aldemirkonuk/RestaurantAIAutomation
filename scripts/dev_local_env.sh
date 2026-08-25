#!/usr/bin/env bash
# Print local-Supabase env vars, freshly resolved from the running `supabase`
# CLI. Source this into a process's environment before starting it locally:
#
#   set -a; source <(./scripts/dev_local_env.sh); set +a
#   python3 -m uvicorn main:app ...
#
# WHY THIS EXISTS
# ----------------
# INCIDENT, 2026-08-05: local dev work sourced Supabase credentials from a file
# written earlier into a session-scoped scratchpad directory:
#
#   set -a; . "$SCRATCHPAD/loop.env"; set +a
#
# Between sessions the scratchpad was cleared. Sourcing a MISSING file in bash
# is not an error — `.` on a nonexistent path prints nothing and the shell keeps
# going — so the orchestrator process that was launched next inherited none of
# those variables and fell through to `.env`, which holds PRODUCTION Supabase
# credentials. 311 requests went to the live project before it was noticed. No
# business table was touched (verified: inventory_lots, restaurant_inventory,
# procurement_orders, pos_checks all stayed at zero); 114 decision_log rows and
# 53 idempotency_keys rows landed and were deleted the same session. See
# BridgeConfig.assert_targets_are_safe in scripts/simulate/bridge.py for the
# companion guard on the HTTP side.
#
# The fix is not "remember to check the file exists" — that is exactly the kind
# of step a tired or interrupted session skips. It is to have nothing that CAN
# silently resolve to nothing: this script talks to the `supabase` CLI directly
# every time, and exits nonzero — loudly, on stderr — if the local stack is not
# running, rather than ever producing an empty or partial environment.

set -euo pipefail

if ! command -v supabase >/dev/null 2>&1; then
  echo "FATAL: supabase CLI not found on PATH." >&2
  exit 2
fi

STATUS_ENV="$(supabase status -o env 2>/dev/null)" || {
  echo "FATAL: 'supabase status' failed — is the local stack running? (supabase start)" >&2
  exit 2
}

API_URL="$(echo "$STATUS_ENV" | grep '^API_URL=' | cut -d= -f2- | tr -d '"')"
SERVICE_KEY="$(echo "$STATUS_ENV" | grep '^SERVICE_ROLE_KEY=' | cut -d= -f2- | tr -d '"')"
ANON_KEY="$(echo "$STATUS_ENV" | grep '^ANON_KEY=' | cut -d= -f2- | tr -d '"')"

if [[ -z "$API_URL" || -z "$SERVICE_KEY" ]]; then
  echo "FATAL: 'supabase status' returned no API_URL/SERVICE_ROLE_KEY. Local stack may not be running." >&2
  exit 2
fi

# The one check that actually matters: refuse to emit anything that is not
# loopback. If this script is ever pointed at a remote project by mistake — a
# `supabase link` to the wrong ref, for instance — this is the last line of
# defence before a downstream process inherits production credentials by name.
case "$API_URL" in
  http://127.0.0.1:*|http://localhost:*|http://\[::1\]:*) : ;;
  *)
    echo "FATAL: resolved API_URL='$API_URL' is not localhost. Refusing to emit it." >&2
    echo "       This script only ever prints LOCAL credentials, by design." >&2
    exit 2
    ;;
esac

cat <<ENV
SUPABASE_URL=$API_URL
SUPABASE_SERVICE_ROLE_KEY=$SERVICE_KEY
SUPABASE_ANON_KEY=$ANON_KEY
ENV

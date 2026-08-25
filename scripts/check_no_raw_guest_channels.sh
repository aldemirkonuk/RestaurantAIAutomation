#!/usr/bin/env bash
# Guard: a guest's raw contact channel (phone, email, card fingerprint,
# loyalty number) is never written anywhere except as an argument to
# guest_link_identifier(), which hashes it and stores only the hash
# (20260819000000_guest_identity_minimal_slice.sql).
#
# WHY THIS IS A GUARD AND NOT A CONVENTION
# Erasure is the whole reason. If the plaintext exists in exactly one place,
# an erasure request is a DELETE. If it has also been copied into a jsonb
# payload, erasure becomes a hunt -- and this schema has six sinks that will
# happily swallow it without erroring:
#
#   pos_checks.raw            events (174 rows)      notifications (457)
#   decision_log (23)         event_store            analytics_cache.data
#
# None of them holds guest PII today. That is precisely why this rule is free
# to enforce now and impossible to enforce later: once a year of payloads has
# absorbed phone numbers, no grep un-absorbs them, and a deletion the team
# cannot prove is a deletion that did not happen.
#
# The same reasoning as check_no_direct_stock_writes.sh: a grep, not a type
# check, because a loosely-typed Supabase client type-checks a raw column name
# string perfectly happily, and the API runs as service_role, which bypasses
# every RLS and grant that would otherwise stop it.
#
#   ./scripts/check_no_raw_guest_channels.sh
#
# Exits 1 if a guest channel value appears to be written into a payload.

set -euo pipefail

cd "$(dirname "$0")/.."

# A guest channel field name being assigned into one of the jsonb sinks, or
# a guest_identifiers write that is not the function call.
PATTERN='guest_identifiers\s*[).]|(from|into|table)\(\s*.guest_identifiers.|guest_(phone|email|card_fingerprint|loyalty)\w*\s*[:=]'

# file:line pairs already audited as NOT a violation:
ALLOWLIST=(
)

is_allowlisted() {
  local hit="$1"
  local file_line="${hit%%:*}:$(echo "$hit" | cut -d: -f2)"
  for entry in "${ALLOWLIST[@]}"; do
    local entry_prefix="${entry%%:*}:$(echo "$entry" | cut -d: -f2)"
    if [[ "$file_line" == "$entry_prefix" ]]; then
      return 0
    fi
  done
  return 1
}

matches="$(rg -n -P "$PATTERN" --type ts --type py -g '!*.spec.ts' -g '!*.test.ts' \
  apps/ services/ scripts/ 2>/dev/null || true)"

fail=0
offenders=()
while IFS= read -r line; do
  [[ -z "$line" ]] && continue
  if ! is_allowlisted "$line"; then
    offenders+=("$line")
    fail=1
  fi
done <<< "$matches"

if [[ $fail -eq 1 ]]; then
  echo "FAIL: a raw guest contact channel may be leaving its single home:"
  printf '  %s\n' "${offenders[@]}"
  echo
  echo "Write channels only by calling guest_link_identifier(restaurant_id,"
  echo "guest_id, channel_type, raw_value, verified). It canonicalises,"
  echo "hashes with a per-restaurant pepper, and stores only the hash --"
  echo "so an erasure request is a DELETE with nothing left to shred."
  echo "Never place a phone/email/card value in pos_checks.raw, events,"
  echo "notifications, decision_log, event_store or analytics_cache."
  exit 1
fi

echo "PASS — guest contact channels confined to guest_link_identifier()."

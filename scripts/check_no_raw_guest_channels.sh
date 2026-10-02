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
#   ./scripts/check_no_raw_guest_channels.sh              # the check
#   ./scripts/check_no_raw_guest_channels.sh --self-test  # proves it can fail
#
# Exits 1 if a guest channel value appears to be written into a payload.
# Exits 2 (CANNOT CHECK) if it could not search: until ADR 0259 it ran `rg`,
# which the CI runner does not have, and printed PASS over nothing.

set -uo pipefail

here="${BASH_SOURCE[0]}"; [[ "$here" == */* ]] && lib="${here%/*}/lib" || lib=lib
# shellcheck source=lib/app_code_grep.sh
source "$lib/app_code_grep.sh" 2>/dev/null \
  || { echo "CANNOT CHECK — ${lib}/app_code_grep.sh is missing."; exit 2; }
acg_enter_repo

# A guest channel field name being assigned into one of the jsonb sinks, or
# a guest_identifiers write that is not the function call.
PATTERN='guest_identifiers\s*[).]|(from|into|table)\(\s*.guest_identifiers.|guest_(phone|email|card_fingerprint|loyalty)\w*\s*[:=]'

# File and exact trimmed line, audited as NOT a violation (keyed on content,
# so an exemption never drifts onto a different line):
ALLOWLIST=(
)

if [[ "${1:-}" == "--self-test" ]]; then
  acg_self_test scripts/check_no_raw_guest_channels.sh \
    "const payload = { guest_phone: rawPhone };" \
    "guest_email = raw_value"
  exit $?
fi

acg_measure_corpus
matches="$(acg_search "$PATTERN")" || exit $?

fail=0
offenders=()
while IFS= read -r line; do
  [[ -z "$line" ]] && continue
  if ! acg_is_allowlisted "$line" "${ALLOWLIST[@]}"; then
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
echo "  searched ${ACG_CORPUS_COUNT} files (${ACG_TSX_COUNT} .tsx, ${ACG_PY_COUNT} .py) under apps/, services/ and scripts/."

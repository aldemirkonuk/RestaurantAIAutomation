#!/usr/bin/env bash
# Guard: beverages.type_attributes is never read or written directly from
# application code (arch §4.3). The view is the contract -- the physical
# layout underneath it is an implementation detail, and that is what makes
# a future promotion to a real per-category table a view-body swap instead
# of a multi-repo change. Break this once (an export script reaching into
# the JSONB) and promotion becomes impossible: every consumer that touched
# the column directly has to be found and migrated too.
#
# This is intentionally a grep, not a type check, matching
# check_no_direct_stock_writes.sh's own reasoning: a loosely-typed Supabase
# client happily type-checks a raw column-name string. Column-level GRANT
# (20260817080000_beverage_views.sql) blocks this for the `authenticated`
# role at the database layer; this catches it for application code running
# as service_role, which bypasses RLS/grants entirely.
#
#   ./scripts/check_no_direct_type_attributes_access.sh
#
# Exits 1 and prints offending lines if a new direct reference appears.
# Migrations and the view definitions themselves are the only allowed home.

set -euo pipefail

cd "$(dirname "$0")/.."

PATTERN='type_attributes'

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
  echo "FAIL: direct reference to beverages.type_attributes found outside migrations:"
  printf '  %s\n' "${offenders[@]}"
  echo
  echo "Fix: read/write through a category view (whiskey, beer, ...) instead."
  echo "If a new category needs a view, add one in a migration -- see"
  echo "supabase/migrations/20260817080000_beverage_views.sql for the pattern."
  exit 1
fi

echo "PASS — no direct type_attributes access outside migrations."

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
#   ./scripts/check_no_direct_type_attributes_access.sh              # the check
#   ./scripts/check_no_direct_type_attributes_access.sh --self-test  # proves it can fail
#
# Exits 1 and prints offending lines if a new direct reference appears.
# Exits 2 (CANNOT CHECK) if it could not search: until ADR 0259 it ran `rg`,
# which the CI runner does not have, and printed PASS over nothing.
# Comment lines are skipped (a comment is never access, founder 2026-10-02).

set -uo pipefail

here="${BASH_SOURCE[0]}"; [[ "$here" == */* ]] && lib="${here%/*}/lib" || lib=lib
# shellcheck source=lib/app_code_grep.sh
source "$lib/app_code_grep.sh" 2>/dev/null \
  || { echo "CANNOT CHECK — ${lib}/app_code_grep.sh is missing."; exit 2; }
acg_enter_repo

PATTERN='type_attributes'

# File and exact trimmed line, audited as NOT a violation. Keyed on content so
# an exemption never drifts onto a different line.
ALLOWLIST=(
  # Prose on /cellar's hidden-columns list: a measurement of the JSONB over all
  # 609 beverages rows, which naming the beer view would change (founder,
  # 2026-10-02, ADR 0259).
  "apps/web/src/pages/cellar/next/cellar-columns.ts|fill: 'type_attributes is {} on all 609 rows, so 0 of 57 beers carry a style.',"
  "apps/web/src/pages/cellar/next/cellar-columns.ts|'The column exists (type_attributes is JSONB and needs no migration) and has never been written to. It is the single highest-value writer this register is waiting on — a beer register without a style is a list of brand names.',"
)

if [[ "${1:-}" == "--self-test" ]]; then
  acg_self_test scripts/check_no_direct_type_attributes_access.sh \
    "const style = row.type_attributes?.style;" \
    "style = row['type_attributes']['style']"
  exit $?
fi

acg_measure_corpus
matches="$(acg_search "$PATTERN")" || exit $?

fail=0
offenders=()
while IFS= read -r line; do
  [[ -z "$line" ]] && continue
  acg_is_comment_line "$line" && continue
  if ! acg_is_allowlisted "$line" "${ALLOWLIST[@]}"; then
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
echo "  searched ${ACG_CORPUS_COUNT} files (${ACG_TSX_COUNT} .tsx, ${ACG_PY_COUNT} .py) under apps/, services/ and scripts/."

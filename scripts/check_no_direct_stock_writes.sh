#!/usr/bin/env bash
# Guard: restaurant_inventory.stock_live / shadow_stock are never written
# directly (SimPOS testbed plan, decision A8). Both are projections of
# inventory_lots, mutated only by project_stock_from_lots after a write
# through apply_stock_movement. A direct write desyncs from lots and gets
# silently clobbered by the projection trigger on the next lot change —
# which is exactly how the receiving-service and inventory-ledger bugs this
# plan fixed went undetected.
#
# This is intentionally a grep, not a type check: the two dead functions this
# guard was written against (`updateInventoryStock`, `reconcileShadowStock` in
# apps/web/src/lib/supabase.ts) type-checked fine — they wrote nonexistent
# columns (`inventory_id`, `live_stock`) on a loosely-typed Supabase client.
#
#   ./scripts/check_no_direct_stock_writes.sh
#
# Exits 1 and prints offending lines if a new direct write appears. Known-safe
# occurrences (initial-insert placeholders immediately corrected by a lot, and
# event-payload/interface fields that never reach a `.update()`/`.upsert()`)
# are allow-listed below by exact "file:line:content" — any new match must be
# either fixed or added here with a comment explaining why it is safe.

set -euo pipefail

cd "$(dirname "$0")/.."

PATTERN='\b(stock_live|shadow_stock)\s*:'

# Occurrences already audited as NOT a direct write:
#  - `stock_live: 0,` at insert time — the row is created with a zero
#    placeholder and the real quantity lands via apply_stock_movement in the
#    same request, as a lot. The projection trigger then sets stock_live to
#    match. Safe because the written value is always exactly 0.
#  - `shadow_stock: number` in the InventoryItem TS interface — a type
#    declaration, not an assignment.
#
# MATCHED BY FILE + CONTENT, NOT BY FILE:LINE.
#
# This list used to key on `file:line`. Every one of its ten entries had gone
# stale: the three `stock_live: 0` placeholders had drifted from lines
# 449/519/792 to 744/814/1087, and the six `old_*`/`new_*` RabbitMQ payload
# keys in inventory.service.ts and communications.controller.ts no longer exist
# at all. Nobody noticed, because the scan above was returning zero lines (see
# the ripgrep note below) so the allow-list was never consulted.
#
# Line numbers move every time anyone edits a file above the match, which makes
# a line-keyed exemption a guarantee of rot. Content is stable: the exemption
# survives refactoring and dies when the code it excused is actually gone.
ALLOWLIST=(
  "apps/api-gateway/src/inventory/inventory.service.ts|stock_live: 0,"
  "apps/web/src/lib/supabase.ts|shadow_stock: number"
)

# "path:line:content" -> "path|trimmed-content"
hit_key() {
  local hit="$1"
  local file="${hit%%:*}"
  local rest="${hit#*:}"          # line:content
  local content="${rest#*:}"      # content
  content="${content#"${content%%[![:space:]]*}"}"   # ltrim
  printf '%s|%s' "$file" "$content"
}

is_allowlisted() {
  local key
  key="$(hit_key "$1")"
  for entry in "${ALLOWLIST[@]}"; do
    # Prefix match on the content so a trailing comment does not break the
    # exemption, while the leading text still has to be the audited code.
    if [[ "$key" == "$entry"* ]]; then
      return 0
    fi
  done
  return 1
}

# `--type tsx` used to be passed here alongside `--type ts`. `tsx` is not a
# ripgrep type — rg's built-in `ts` type already covers *.ts, *.cts, *.mts AND
# *.tsx — so rg exited 2 with "unrecognized file type: tsx", `2>/dev/null ||
# true` swallowed both the message and the status, `matches` came back empty,
# and this script printed PASS having examined ZERO LINES. It had been doing
# that for every run since the flag was added.
#
# Two changes, because fixing only the flag would leave the same trap armed for
# the next mistake:
#   1. the invalid type is gone;
#   2. a non-zero rg exit is now FATAL unless it is exactly 1 ("no matches"),
#      and the guard exits 2 — "could not check" — instead of reporting the
#      absence of an answer as a clean bill of health.
# POSIX-ERE equivalent of the PCRE `\b`, for the grep fallback below. `\b` is
# a GNU/PCRE extension and is not in POSIX ERE.
PORTABLE_PATTERN='(^|[^A-Za-z0-9_])(stock_live|shadow_stock)[[:space:]]*:'

matches=""
scanner=""
set +e
if command -v rg >/dev/null 2>&1; then
  scanner="ripgrep"
  matches="$(rg -n -P "$PATTERN" --type ts -g '!*.spec.ts' -g '!*.test.ts' apps/ 2>&1)"
  status=$?
else
  # No ripgrep. grep is on every machine that can run this script at all, so
  # the check still happens rather than being skipped.
  scanner="grep"
  matches="$(grep -rnE "$PORTABLE_PATTERN" \
      --include='*.ts' --include='*.tsx' --include='*.cts' --include='*.mts' \
      --exclude='*.spec.ts' --exclude='*.test.ts' apps/ 2>&1)"
  status=$?
fi
set -e

if [[ $status -gt 1 ]]; then
  echo "COULD NOT CHECK: $scanner failed (exit $status):"
  echo "$matches"
  echo "Exit 2. This is not a pass."
  exit 2
fi
if [[ $status -eq 1 ]]; then
  matches=""
fi

# NON-VACUITY. The scanner must be shown to have reached the tree before an
# empty result is allowed to mean "clean". Counting matches cannot do this —
# zero matches is a legitimate outcome — so count the FILES the scan had to
# walk. If that is zero, the scan found nothing to look at and "no offenders"
# is an absence of evidence, not evidence of absence.
files_in_scope=$(find apps -type f \
  \( -name '*.ts' -o -name '*.tsx' -o -name '*.cts' -o -name '*.mts' \) \
  -not -path '*/node_modules/*' -not -path '*/dist/*' 2>/dev/null | wc -l | tr -d ' ')
if [[ "${files_in_scope:-0}" -lt 1 ]]; then
  echo "COULD NOT CHECK: no TypeScript files found under apps/ to scan."
  echo "Exit 2. This is not a pass."
  exit 2
fi

fail=0
offenders=()
while IFS= read -r line; do
  [[ -z "$line" ]] && continue
  if ! is_allowlisted "$line"; then
    offenders+=("$line")
    fail=1
  fi
done <<< "$matches"

matched=$(printf '%s' "$matches" | grep -c . || true)

if [[ $fail -eq 1 ]]; then
  echo "FAIL: direct write to stock_live/shadow_stock found outside the allowlist:"
  printf '  %s\n' "${offenders[@]}"
  echo
  echo "Fix: route the change through apply_stock_movement (apps/api-gateway/src/*/inventory-ledger, inventory.service.ts) instead of updating the projected column directly."
  echo "Coverage: $scanner, $files_in_scope file(s) in scope, $matched occurrence(s) matched."
  exit 1
fi

# The coverage line is not decoration. A guard that prints only its verdict
# cannot be distinguished from a guard that examined nothing — which is exactly
# what this one did, undetected, for as long as the invalid ripgrep type was in
# it. The numbers make a vacuous run visible in the CI log.
echo "PASS — no direct stock_live/shadow_stock writes outside the allowlist."
echo "Coverage: $scanner, $files_in_scope file(s) in scope, $matched occurrence(s) matched, ${#ALLOWLIST[@]} allow-list entr(ies)."

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

# ===========================================================================
# 2026-09-02 — THIS GUARD WAS VACUOUS AND PRINTED PASS OVER ZERO LINES.
#
# The search on the old line 63 read:
#
#     matches="$(rg -n -P "$PATTERN" --type ts --type tsx ... 2>/dev/null || true)"
#
# There is no ripgrep type named `tsx`. Measured on this tree:
#
#     $ rg -n -P '...' --type ts --type tsx apps/
#     rg: unrecognized file type: tsx
#     EXIT=2
#
# rg exited 2 before examining a single file, `2>/dev/null` hid the message,
# `|| true` hid the status, `matches` came back empty, the offender loop had
# nothing to iterate, and the script printed **PASS**. It had reported health for
# an inspection it never performed — the `absence-reported-as-health` shape, in
# the guard whose whole job is to notice something.
#
# Three things changed, and the first is the one that matters:
#
#   1. THE SEARCH'S EXIT STATUS IS INSPECTED. rg distinguishes 1 (no matches)
#      from >=2 (the search broke). A broken search is exit 2 — CANNOT CHECK —
#      never a pass. No `2>/dev/null` remains.
#   2. THE CORPUS IS COUNTED AND ASSERTED. Zero scannable files is exit 2. A
#      guard with nothing to look at must not answer the same as one that looked.
#   3. THE ALLOWLIST IS KEYED ON file+CONTENT, NOT file:line. Every recorded
#      line number had already rotted — the three `stock_live: 0,` placeholders
#      had moved from 449/519/792 to 744/814/1087 — so the list would have
#      started producing false failures the moment the search was repaired. The
#      four `old_/new_stock_live:` entries never matched at all: `\b` before
#      `stock_live` cannot match inside `old_stock_live`, `_` being a word
#      character. They are dropped rather than kept as decoration.
# ===========================================================================

set -uo pipefail

cd "$(dirname "$0")/.." || { echo "CANNOT CHECK — no repo root"; exit 2; }

PATTERN='\b(stock_live|shadow_stock)\s*:'

# file + exact content already audited as NOT a direct write:
#  - `stock_live: 0,` at insert time — the row is created with a zero
#    placeholder and the real quantity lands via apply_stock_movement in the
#    same request, as a lot. The projection trigger then sets stock_live to
#    match. Safe because the written value is always exactly 0.
#  - `shadow_stock: number` in the InventoryItem TS interface — a type
#    declaration, not an assignment.
ALLOWLIST=(
  "apps/api-gateway/src/inventory/inventory.service.ts|stock_live: 0,"
  "apps/web/src/lib/supabase.ts|shadow_stock: number"
)

is_allowlisted() {
  local hit="$1"
  local file="${hit%%:*}"
  # Strip "file:line:" to get the raw content, then trim whitespace.
  local content="${hit#*:}"; content="${content#*:}"
  content="$(printf '%s' "$content" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
  # Drop a trailing `// comment` so a note beside the line does not defeat the match.
  content="$(printf '%s' "$content" | sed -e 's|[[:space:]]*//.*$||' -e 's/[[:space:]]*$//')"
  for entry in "${ALLOWLIST[@]}"; do
    if [[ "$file" == "${entry%%|*}" && "$content" == "${entry#*|}" ]]; then
      return 0
    fi
  done
  return 1
}

# --- The search, with its failure modes separated. ------------------------
if ! command -v rg >/dev/null 2>&1; then
  echo "CANNOT CHECK — ripgrep (rg) not on PATH."
  echo "  Reporting PASS here is exactly the bug this header describes."
  exit 2
fi

# Corpus assertion FIRST: prove the globs match real files before believing any
# count over them. This is the line that would have caught the `--type tsx` bug.
corpus="$(rg --files -g '*.ts' -g '*.tsx' apps/)"
if [[ $? -ge 2 || -z "$corpus" ]]; then
  echo "CANNOT CHECK — the file sweep over apps/ returned nothing."
  exit 2
fi
corpus_count="$(printf '%s\n' "$corpus" | grep -c .)"
if [[ "$corpus_count" -lt 50 ]]; then
  echo "CANNOT CHECK — corpus is ${corpus_count} .ts/.tsx files under apps/; that is not this repo."
  exit 2
fi

matches="$(rg -n -P "$PATTERN" -g '*.ts' -g '*.tsx' \
  -g '!*.spec.ts' -g '!*.test.ts' -g '!*.spec.tsx' -g '!*.test.tsx' apps/)"
rc=$?
if [[ $rc -ge 2 ]]; then
  echo "CANNOT CHECK — the search failed (rg exit ${rc}). Not a pass."
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

if [[ $fail -eq 1 ]]; then
  echo "FAIL: direct write to stock_live/shadow_stock found outside the allowlist:"
  printf '  %s\n' "${offenders[@]}"
  echo
  echo "Fix: route the change through apply_stock_movement (apps/api-gateway/src/*/inventory-ledger, inventory.service.ts) instead of updating the projected column directly."
  exit 1
fi

matched_count="$(printf '%s\n' "$matches" | grep -c . || true)"
echo "PASS — no direct stock_live/shadow_stock writes outside the allowlist."
echo "  examined ${corpus_count} .ts/.tsx files under apps/; ${matched_count} occurrence(s), all allow-listed."

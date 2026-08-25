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

# file:line pairs already audited as NOT a direct write:
#  - `stock_live: 0,` at insert time — the row is created with a zero
#    placeholder and the real quantity lands via apply_stock_movement in the
#    same request, as a lot. The projection trigger then sets stock_live to
#    match. Safe because the written value is always exactly 0.
#  - `old_stock_live:` / `new_stock_live:` / `old_shadow_stock:` /
#    `new_shadow_stock:` — RabbitMQ event-payload keys, not a DB write.
#  - `shadow_stock: number` in the InventoryItem TS interface — a type
#    declaration, not an assignment.
ALLOWLIST=(
  "apps/api-gateway/src/inventory/inventory.service.ts:449:stock_live: 0,"
  "apps/api-gateway/src/inventory/inventory.service.ts:519:stock_live: 0,"
  "apps/api-gateway/src/inventory/inventory.service.ts:792:stock_live: 0,"
  "apps/api-gateway/src/inventory/inventory.service.ts:1028:old_stock_live:"
  "apps/api-gateway/src/inventory/inventory.service.ts:1029:new_stock_live:"
  "apps/api-gateway/src/inventory/inventory.service.ts:1030:old_shadow_stock:"
  "apps/api-gateway/src/inventory/inventory.service.ts:1031:new_shadow_stock:"
  "apps/web/src/lib/supabase.ts:83:shadow_stock: number"
  "apps/api-gateway/src/communications/communications.controller.ts:633:old_stock_live:"
  "apps/api-gateway/src/communications/communications.controller.ts:634:new_stock_live:"
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

matches="$(rg -n -P "$PATTERN" --type ts --type tsx -g '!*.spec.ts' -g '!*.test.ts' apps/ 2>/dev/null || true)"

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

echo "PASS — no direct stock_live/shadow_stock writes outside the allowlist."

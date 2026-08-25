# inventory-ledger — repaired 2026-08-05 (SimPOS testbed plan, spine repair)

**Status:** live. The `LEDGER_V1_ENABLED` quarantine flag has been removed.

## What was wrong (history)

- `inventory-ledger.service.ts` read `restaurant_inventory.live_stock`
  (`.select("live_stock")`) — the real column is `stock_live`. Every
  reconcile/read 500'd against the real DB.
- The ledger RPC `record_inventory_transaction` resolved the stock column to
  `'live_stock'` and its auto-logging trigger inserted `NEW.wine_id`, but
  `restaurant_inventory` has `master_wine_id`, not `wine_id`.
- The unit tests mocked `{ live_stock: 10 }` (the ghost column), so the suite
  was green while production would fail.
- The web app had zero callers of `/inventory-ledger` — reconcile/override
  went through `PATCH /inventory` → `stock_live` directly, so this ledger was
  not the system of record.

## What replaced it

`InventoryLedgerService.createTransaction` and `.reconcileInventory` now call
`apply_stock_movement` — the single stock write primitive shared with the
receiving door flow, POS ingress, spot counting, and manual overrides.
`stock_live`/`shadow_stock` are projections of `inventory_lots`, owned by
`project_stock_from_lots`, and are never written directly anywhere in the
codebase (`scripts/check_no_direct_stock_writes.sh` enforces this in CI).
`idempotencyKey` is mandatory on `POST /inventory-ledger/transactions`, and
`StockType.RESERVED` has been removed — only `live`/`shadow` are valid states,
matching what `apply_stock_movement` accepts.

`record_inventory_transaction` has been dropped from the database; nothing
calls it.

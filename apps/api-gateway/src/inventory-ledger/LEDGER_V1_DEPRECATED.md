# ⚠️ inventory-ledger (v1) is QUARANTINED — do not wire to production

**Status:** disabled behind `LEDGER_V1_ENABLED` (default OFF) as of Phase 1 · 1.4 (D4).
**Why:** this module is written against a schema that does not exist.

## The defects (verified)
- `inventory-ledger.service.ts` reads `restaurant_inventory.live_stock` (`.select("live_stock")`, ~L453/L461). The **real column is `stock_live`.** Every reconcile/read here 500s against the real DB.
- The ledger RPC `record_inventory_transaction` (`services/database/migrations/005_*.sql`) resolves the stock column to `'live_stock'` and the auto-logging trigger (`006_*.sql`) inserts `NEW.wine_id` — but `restaurant_inventory` has **`master_wine_id`**, not `wine_id`.
- The unit tests mocked `{ live_stock: 10 }` (the ghost column), so the suite was **green while production would fail**. Those tests are now `describe.skip` with a reason (`__tests__/inventory-ledger.service.spec.ts`).
- The web app has **zero callers** of `/inventory-ledger` — reconcile/override go through `PATCH /inventory` → `stock_live` directly. So this ledger is not the system of record today.

## What replaces it
Phase 2 ports a **corrected** ledger into the LIVE `supabase/migrations/` tree:
`stock_live` + `master_wine_id`, delta-based writes, version CAS, idempotency keys, lot references.
All stock writes route through it; direct `UPDATE stock_live` is forbidden.

See **`.planning/INVENTORY_SOTA_PLAN.md` §6b (ledger port) and §9A (quarantine).**

## To re-enable temporarily (not recommended)
Set `LEDGER_V1_ENABLED=true`. The write endpoints will attempt the ghost-column path and fail
against the real schema. Only useful for local schema experiments.

-- POS correctness: persist `voided`, and make the consumption log idempotent.
--
-- Both defects were found by driving 66 real checks through the live webhook
-- (.planning/04-specs/POS-BRIDGE-AUDIT.md, Appendix A). Neither had corrupted
-- anything, for one reason only: `pos_checks` held 0 rows until 2026-08-24.
-- They go live the moment a real POS connects, which is why they are fixed
-- before that happens rather than after.

-- ---------------------------------------------------------------------------
-- 1. pos_checks.voided
-- ---------------------------------------------------------------------------
-- `voided` exists in the CanonicalCheck contract (pos-types.ts:32) and already
-- drives stock reversal (pos-hub.service.ts:323) — but it was never written to
-- the table, and the column did not exist at all. So a voided check reversed
-- the stock correctly and then counted as revenue forever: goals, insights and
-- table/waiter analytics all sum `total` with no way to exclude it.
--
-- NOT NULL DEFAULT false is deliberate. A nullable flag would make every reader
-- choose between `= false` and `is not true` and get it wrong somewhere; and
-- unlike neural_footprint_event.outcome — where NULL genuinely means UNKNOWN —
-- a check that was never marked void is a check that was not voided.
alter table public.pos_checks
  add column if not exists voided boolean not null default false;

comment on column public.pos_checks.voided is
  'Whole check voided after close. Revenue readers MUST filter these out; '
  'stock effects are reversed at ingest (pos-hub.service.ts).';

-- Partial index: voided checks are the rare case, and every revenue query wants
-- the complement. Indexing only the true rows keeps it small while still
-- letting the planner exclude them.
create index if not exists pos_checks_voided_idx
  on public.pos_checks (restaurant_id, opened_at desc)
  where voided;

-- ---------------------------------------------------------------------------
-- 2. wine_consumption_log idempotency
-- ---------------------------------------------------------------------------
-- The asymmetry that made this dangerous: `apply_stock_movement` is idempotent
-- on p_idempotency_key and returns the existing transaction for a known key,
-- but pos-hub.service.ts read "no rpcError" as "this depleted just now" and
-- then did a bare INSERT into wine_consumption_log. So a replay or re-import
-- left STOCK CORRECT and the CONSUMPTION LOG INFLATED — one check line replayed
-- twice produced three rows.
--
-- That is the worst shape a data bug can have: the number a human would check
-- stays right while the series feeding velocity, XYZ classification, reorder
-- points, Holt-Winters forecasting and goal progress quietly drifts up.
--
-- The unique index is what makes the fix true at the database rather than in
-- one caller. `notes` carries the POS idempotency key; it is NULL for manual
-- entries, and a partial index leaves those unconstrained.
--
-- Safe to add as unique: wine_consumption_log holds 0 rows in production
-- (verified 2026-08-24), so there are no existing duplicates to collide.
create unique index if not exists wine_consumption_log_pos_idem_uidx
  on public.wine_consumption_log (restaurant_id, notes)
  where notes is not null and source = 'pos';

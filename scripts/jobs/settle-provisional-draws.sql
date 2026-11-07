-- settle-provisional-draws.sql — one-off backfill for a_sale_settles_its_cost
-- (migration 20270502100100). THE FOUNDER RUNS IT; nobody else, and no CI.
--
-- Bottles sold from a lot while its cost was provisional (or unpriced), whose
-- lot has since been finalised by a finalise_delivery_cost that wrote no
-- settlements, owe the difference to the lot's final cost. This writes one
-- inventory_lot_draw_settlements row per such draw, linked to the lot's latest
-- revaluation, at the lot's current unit_cost. Append-only: nothing is edited.
--
-- Dry-run first (the default only SELECTs, writes nothing - not even a sequence value - and ends in ROLLBACK):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/jobs/settle-provisional-draws.sql
-- Then, only after reading the counts:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v apply=1 -f scripts/jobs/settle-provisional-draws.sql
--
-- Not settled, and counted as such: a draw whose final lot has no revaluation
-- (a lot that was final when it was booked, so its draws were not provisional
-- in the first place, or a revaluation lost to ON DELETE SET NULL).

\if :{?apply}
\else
\set apply 0
\endif

BEGIN;

-- Two job runs serialise on this advisory lock. The table lock stops a live
-- finalise_delivery_cost (which updates lots and does not take the advisory
-- lock) committing between the candidate read below and the INSERT: that
-- window once settled a draw at 105.00 where the lot's true cost was 55.00.
-- SHARE ROW EXCLUSIVE lets reads through and blocks every writer of the lots.
SELECT pg_advisory_xact_lock(hashtext('settle-provisional-draws'));
LOCK TABLE public.inventory_lots IN SHARE ROW EXCLUSIVE MODE;

CREATE TEMP TABLE settle_job_candidates ON COMMIT DROP AS
SELECT d.id AS draw_id, d.txn_id, d.lot_id, d.inventory_id, d.qty, d.unit_cost AS prior_unit_cost,
       l.restaurant_id, l.unit_cost AS settled_unit_cost,
       (SELECT r.id FROM public.inventory_lot_revaluations r
         WHERE r.lot_id = l.id ORDER BY r.created_at DESC, r.id DESC LIMIT 1) AS revaluation_id
  FROM public.inventory_lot_draws d
  JOIN public.inventory_lots l ON l.id = d.lot_id
 WHERE l.cost_state = 'final'
   AND l.unit_cost IS NOT NULL
   AND (d.cost_state = 'provisional' OR d.unit_cost IS NULL)
   AND d.unit_cost IS DISTINCT FROM l.unit_cost
   AND NOT EXISTS (SELECT 1 FROM public.inventory_lot_draw_settlements s WHERE s.draw_id = d.id);

SELECT restaurant_id,
       count(*) FILTER (WHERE revaluation_id IS NOT NULL) AS draws_settled,
       count(*) FILTER (WHERE revaluation_id IS NULL) AS draws_skipped_no_revaluation,
       sum(round(qty * settled_unit_cost, 2) - COALESCE(round(qty * prior_unit_cost, 2), 0))
         FILTER (WHERE revaluation_id IS NOT NULL) AS sum_difference
  FROM settle_job_candidates
 GROUP BY restaurant_id
 ORDER BY restaurant_id;

-- The dry run only SELECTs: an INSERT that is then rolled back still spends
-- the settlements' identity sequence (seq 11 -> 15 in QA), so the INSERT lives
-- in the apply branch alone.
SELECT (:'apply' = '1') AS settle_job_apply \gset
\if :settle_job_apply
INSERT INTO public.inventory_lot_draw_settlements
  (restaurant_id, draw_id, lot_id, txn_id, inventory_id, revaluation_id, qty,
   prior_unit_cost, settled_unit_cost, prior_total, settled_total, difference)
SELECT restaurant_id, draw_id, lot_id, txn_id, inventory_id, revaluation_id, qty,
       prior_unit_cost, settled_unit_cost, round(qty * prior_unit_cost, 2), round(qty * settled_unit_cost, 2),
       round(qty * settled_unit_cost, 2) - COALESCE(round(qty * prior_unit_cost, 2), 0)
  FROM settle_job_candidates
 WHERE revaluation_id IS NOT NULL;
COMMIT;
\echo 'settle-provisional-draws: COMMITTED'
\else
ROLLBACK;
\echo 'settle-provisional-draws: dry run, ROLLED BACK (pass -v apply=1 to write)'
\endif

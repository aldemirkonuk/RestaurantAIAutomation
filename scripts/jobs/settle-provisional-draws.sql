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
-- in the first place, or a revaluation lost to ON DELETE SET NULL), and a draw
-- whose lot was moved after its latest revaluation (the two costs disagree).

\if :{?apply}
\else
\set apply 0
\endif

-- A settlement is written at the scale its own columns keep, the same as
-- finalise_delivery_cost writes it: two places under 20270502100100, six
-- places once 20270615100000 (a_settlement_keeps_six_places) has run. The job
-- reads that scale rather than fixing it, so it settles the way the live
-- function does whichever of the two migrations the database has. Rounding
-- to cents here would undo the six-place fix for every back-settled draw.
SELECT numeric_scale AS settle_scale
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'inventory_lot_draw_settlements'
   AND column_name = 'settled_total' \gset
\if :{?settle_scale}
\else
\echo 'settle-provisional-draws: inventory_lot_draw_settlements.settled_total not found; nothing done'
\quit
\endif

BEGIN;

-- Two job runs serialise on this advisory lock. The table lock stops a live
-- finalise_delivery_cost (which updates lots and does not take the advisory
-- lock) committing between the candidate read below and the INSERT: that
-- window once settled a draw at 105.00 where the lot's true cost was 55.00.
-- SHARE ROW EXCLUSIVE lets reads through and blocks every writer of the lots.
SELECT pg_advisory_xact_lock(hashtext('settle-provisional-draws'));
LOCK TABLE public.inventory_lots IN SHARE ROW EXCLUSIVE MODE;

-- The settled price is the latest revaluation's new_unit_cost: the invoice
-- cost finalise_delivery_cost was given (p_unit_cost), kept exactly. The lot's
-- own unit_cost is numeric(10,2) and has lost the sub-cent, so pricing from it
-- settled a 10.0049 bottle at 10.00, and skipped outright a draw estimated at
-- 10.00 (it looked already settled). Under six-place settlements the live
-- function prices at round(p_unit_cost, 6); under two-place ones it rounds
-- qty * p_unit_cost to the cent. settled_price below is that price.
CREATE TEMP TABLE settle_job_candidates ON COMMIT DROP AS
SELECT d.id AS draw_id, d.txn_id, d.lot_id, d.inventory_id, d.qty, d.unit_cost AS prior_unit_cost,
       l.restaurant_id, l.unit_cost AS lot_unit_cost, r.id AS revaluation_id,
       CASE WHEN :settle_scale >= 6 THEN round(r.new_unit_cost, 6) ELSE r.new_unit_cost END AS settled_price
  FROM public.inventory_lot_draws d
  JOIN public.inventory_lots l ON l.id = d.lot_id
  LEFT JOIN LATERAL (SELECT r.id, r.new_unit_cost FROM public.inventory_lot_revaluations r
                      WHERE r.lot_id = l.id ORDER BY r.created_at DESC, r.id DESC LIMIT 1) r ON true
 WHERE l.cost_state = 'final'
   AND l.unit_cost IS NOT NULL
   AND (d.cost_state = 'provisional' OR d.unit_cost IS NULL)
   AND d.unit_cost IS DISTINCT FROM COALESCE(CASE WHEN :settle_scale >= 6 THEN round(r.new_unit_cost, 6) ELSE r.new_unit_cost END, l.unit_cost)
   AND NOT EXISTS (SELECT 1 FROM public.inventory_lot_draw_settlements s WHERE s.draw_id = d.id);

-- A revaluation whose cost does not round to the lot's is not the lot's
-- current price (something else moved the lot since): those draws are skipped
-- and counted, never settled at a guess.
ALTER TABLE settle_job_candidates ADD COLUMN settle_ok boolean;
UPDATE settle_job_candidates
   SET settle_ok = revaluation_id IS NOT NULL AND settled_price IS NOT NULL
                   AND round(settled_price, 2) = lot_unit_cost;

SELECT restaurant_id,
       count(*) FILTER (WHERE settle_ok) AS draws_settled,
       count(*) FILTER (WHERE revaluation_id IS NULL) AS draws_skipped_no_revaluation,
       count(*) FILTER (WHERE revaluation_id IS NOT NULL AND NOT settle_ok) AS draws_skipped_revaluation_not_lot_cost,
       sum(round(qty * settled_price, :settle_scale) - COALESCE(round(qty * prior_unit_cost, :settle_scale), 0))
         FILTER (WHERE settle_ok) AS sum_difference
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
       prior_unit_cost, round(settled_price, 6), round(qty * prior_unit_cost, :settle_scale), round(qty * settled_price, :settle_scale),
       round(qty * settled_price, :settle_scale) - COALESCE(round(qty * prior_unit_cost, :settle_scale), 0)
  FROM settle_job_candidates
 WHERE settle_ok;
COMMIT;
\echo 'settle-provisional-draws: COMMITTED'
\else
ROLLBACK;
\echo 'settle-provisional-draws: dry run, ROLLED BACK (pass -v apply=1 to write)'
\endif

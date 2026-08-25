-- ============================================================================
-- OD-61 — api_spend.cost_usd must be able to say "unknown"
-- ============================================================================
-- The column was `numeric(10,6) NOT NULL DEFAULT 0.0`, so a model with no rate
-- in spend_logger._RATES_PER_M booked a false $0.000000: the primary cost ledger
-- could not distinguish "this call was free" from "we have no rate for it".
--
-- `neural_footprint_event.cost_usd` is already nullable and records NULL plus
-- context.cost_basis = 'unpriced_model' for exactly this case (ADR 0010). The
-- secondary ledger was therefore telling the truth while the primary one was
-- not — the defect this migration closes.
--
-- TWO changes, for two different ways to book a false zero:
--
--   DROP NOT NULL   lets the writer state the unknown explicitly. SpendLogger
--                   now computes one `unpriced` flag and applies it to BOTH
--                   ledgers, so they can no longer disagree about whether a
--                   call's cost is known.
--
--   DROP DEFAULT    closes the other door. A default of 0.0 means any INSERT
--                   that OMITS the column silently asserts "free" — the same
--                   lie, arrived at by a different route. With no default an
--                   omitted column yields NULL, which is the honest reading of
--                   "nobody said". `neural_footprint_event.cost_usd` already
--                   has no default; this aligns the two ledgers.
--                   SpendLogger is the only writer and always supplies the
--                   column explicitly, so nothing in the codebase changes
--                   behaviour because of this (`grep -c api_spend
--                   apps/api-gateway/src` is 0 — the gateway never writes here).
--
-- READERS — all three sum client-side, none order or filter on cost_usd:
--   jobs/spend_tasks.py::_get_monthly_spend        `... or 0.0`   NULL-safe
--   api/onboarding_routes.py::_preflight_cap_check `... or 0.0`   NULL-safe
--   jobs/research_tasks.py::_budget_available      float(None) -> TypeError,
--     swallowed by its fail-open except, which would have SILENTLY DISABLED the
--     research daily budget gate. Fixed in the same commit as this migration.
--
-- NOT BACKFILLED, deliberately. Production holds 185 rows, 2 of them zero-cost,
-- and the two kinds ARE distinguishable here rather than conflated:
--   - 7909b29a…  anthropic/claude-haiku-4-5-20251001, 0 in / 0 out tokens,
--     2026-07-01. Zero tokens costs zero at any rate, so the 0.0 is TRUE. The
--     token gate in SpendLogger leaves rows like this at 0.0 today too.
--   - 1d73fe73…  google/gemini-3.6-flash, 146 in / 53 out, 2026-08-24. The
--     model had no row in _RATES_PER_M when this was written (ADR 0010 added
--     the Gemini 3.x rates that same day), so this is the one genuine unpriced
--     false zero. It is worth $0.000309 at today's rate — 0.03% of the $0.923359
--     lifetime total.
-- Rewriting one row for $0.0003 by asserting that today's rate applied on that
-- date is the same "price frozen in and inherited" move OD-62 exists to stop,
-- and the token counts are on the row either way, so the figure is recomputable
-- whenever anyone wants it. The gap is documented instead of guessed.
-- If the founder prefers the honest NULL, it is one statement, applied by hand:
--   update api_spend set cost_usd = null
--    where id = '1d73fe73-bdb9-4623-a65a-32408481f8dd';
-- ============================================================================

ALTER TABLE public.api_spend ALTER COLUMN cost_usd DROP NOT NULL;
ALTER TABLE public.api_spend ALTER COLUMN cost_usd DROP DEFAULT;

COMMENT ON COLUMN public.api_spend.cost_usd IS
  'USD cost of this call. NULL means UNKNOWN — the model had no rate in '
  'spend_logger._RATES_PER_M, so no cost could be computed (neural_footprint_event '
  'carries the matching context.cost_basis = ''unpriced_model''). 0 means the call '
  'genuinely cost nothing. Never conflate the two: SUM() ignores NULL, but any '
  'reader that counts rows, averages, or filters on > 0 must decide explicitly. '
  'OD-61.';

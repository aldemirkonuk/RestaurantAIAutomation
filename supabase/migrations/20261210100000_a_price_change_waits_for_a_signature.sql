-- A price change the proposer's approval rules do not cover waits for a
-- signature — ADR 0244 D3, the founder's four calls of 2026-09-30.
--
-- WHAT HE DECIDED
-- ---------------
-- F1, verbatim pick "Pending price change (Recommended)": an approved order
-- (or one further on, before delivery) keeps its state. A price change by a
-- person whose approval rules no longer cover the new figures is held as a
-- PENDING change, and takes effect only when someone whose rules cover it
-- approves it through a sealed act. No stock is released, no mail is held,
-- no state changes.
-- F2, verbatim pick "Yes, gate it (Recommended)": confirming a deal runs the
-- same rules for the confirming person; a deal over their rules waits here
-- for someone whose rules cover it instead of being committed.
-- F4, verbatim pick "Any price change": every price change on an approved
-- order re-runs every rule for the person making it — including the dedup
-- merge in POST orders, which rewrites an open order's prices and quantity.
--
-- WHY A TABLE OF ITS OWN, NOT COLUMNS ON procurement_orders
-- --------------------------------------------------------
-- A pending change is a proposal with a proposer, a reason and an outcome;
-- the order row holds what IS agreed. Columns on the order ("pending_total",
-- "pending_by", ...) would sit beside the live figures that every spend,
-- scorecard and seal reader already reads, and one missed reader would take a
-- figure nobody approved as the order's own. A row here is read only by the
-- code that proposes and approves it. It also keeps the history: a
-- superseded or stale proposal stays on the record instead of being
-- overwritten by the next one.
--
-- WHAT A ROW SAYS
-- ---------------
--   source          order_edit   (PATCH orders/:id)
--                   confirm_deal (confirm-deal)
--                   order_merge  (POST orders folding a re-quote into an open
--                                 order for the same wine and vendor)
--   figures_from    each figure the change moves, as it stood when proposed
--   figures_to      each figure the change moves, as proposed
--   terms           what the approval replays, for the two acts that are more
--                   than figures: confirm_deal keeps {finalPrice, quantity,
--                   sendConfirmation} exactly as the confirming person held
--                   over them; order_merge keeps the order request and its
--                   source. NULL for order_edit, whose figures ARE the change.
--   required_role   who has to approve it (owner | manager), from the rules
--   fired_by        which rules fired; reasons: one sentence per rule
--   decrease_only   every figure the change moves goes DOWN (founder,
--                   2026-09-30, answer 7 "Decreases skip new-vendor
--                   (Recommended)": such a change does not re-trigger the
--                   new_vendor rule; every other rule still runs)
--   state           waiting -> approved | declined | withdrawn | superseded
--                   | stale (answer 6 "Decline + withdraw (Recommended)":
--                   an approver declines with a reason, the person who
--                   raised it withdraws it)
--   decided_*       who approved, declined or withdrew it, and when; or
--                   when it was closed
--   closed_reason   why a row stopped waiting without being approved
--
-- One waiting change per order: a later proposal supersedes the waiting one
-- in the same request (the code closes it first), and an applied price change
-- supersedes it too.
--
-- Locked down in the same file (RLS on, one service_role policy, anon and
-- authenticated revoked); actor columns on public.users(user_id), never
-- auth.users. Additive, idempotent, structural assertions at the bottom (no
-- probe rows).

CREATE TABLE IF NOT EXISTS public.procurement_order_price_changes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  order_id UUID NOT NULL REFERENCES public.procurement_orders(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  raised_by UUID REFERENCES public.users(user_id) ON DELETE SET NULL,
  raised_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  raised_by_role TEXT,
  figures_from JSONB NOT NULL,
  figures_to JSONB NOT NULL,
  terms JSONB,
  required_role TEXT NOT NULL,
  fired_by TEXT[] NOT NULL DEFAULT '{}',
  reasons TEXT[] NOT NULL DEFAULT '{}',
  decrease_only BOOLEAN NOT NULL DEFAULT false,
  state TEXT NOT NULL DEFAULT 'waiting',
  decided_by UUID REFERENCES public.users(user_id) ON DELETE SET NULL,
  decided_at TIMESTAMPTZ,
  closed_reason TEXT,
  CONSTRAINT procurement_order_price_changes_source_known
    CHECK (source IN ('order_edit', 'confirm_deal', 'order_merge')),
  CONSTRAINT procurement_order_price_changes_state_known
    CHECK (state IN ('waiting', 'approved', 'declined', 'withdrawn', 'superseded', 'stale')),
  CONSTRAINT procurement_order_price_changes_role_known
    CHECK (required_role IN ('owner', 'manager')),
  CONSTRAINT procurement_order_price_changes_figures_are_objects
    CHECK (jsonb_typeof(figures_from) = 'object' AND jsonb_typeof(figures_to) = 'object'),
  CONSTRAINT procurement_order_price_changes_replay_has_terms
    CHECK ((source IN ('confirm_deal', 'order_merge')) = (terms IS NOT NULL AND jsonb_typeof(terms) = 'object')),
  CONSTRAINT procurement_order_price_changes_decided_when_not_waiting
    CHECK ((state = 'waiting') = (decided_at IS NULL)),
  CONSTRAINT procurement_order_price_changes_close_says_why
    CHECK ((state IN ('declined', 'withdrawn', 'superseded', 'stale')) = (closed_reason IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_procurement_order_price_changes_one_waiting
  ON public.procurement_order_price_changes (order_id)
  WHERE state = 'waiting';

CREATE INDEX IF NOT EXISTS idx_procurement_order_price_changes_waiting
  ON public.procurement_order_price_changes (restaurant_id, raised_at DESC)
  WHERE state = 'waiting';

ALTER TABLE public.procurement_order_price_changes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS procurement_order_price_changes_service_role ON public.procurement_order_price_changes;
CREATE POLICY procurement_order_price_changes_service_role
  ON public.procurement_order_price_changes
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.procurement_order_price_changes FROM anon, authenticated;

COMMENT ON TABLE public.procurement_order_price_changes IS
  'A price change on an order that the proposer''s approval rules did not cover (ADR 0244 D3, founder 2026-09-30: F1 pending price change, F2 confirm-deal gated, F4 any price change, the POST orders merge included). The order keeps its state and figures; the change applies only when someone whose rules cover it approves it through the sealed approve_price_change act. RLS on, service_role only.';

DO $$
DECLARE
  c TEXT;
  fk_target TEXT;
BEGIN
  IF to_regclass('public.procurement_order_price_changes') IS NULL THEN
    RAISE EXCEPTION 'procurement_order_price_changes was not created';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass('public.procurement_order_price_changes')) THEN
    RAISE EXCEPTION 'procurement_order_price_changes has RLS off';
  END IF;
  IF has_table_privilege('anon', 'public.procurement_order_price_changes', 'SELECT')
     OR has_table_privilege('authenticated', 'public.procurement_order_price_changes', 'SELECT')
     OR has_table_privilege('anon', 'public.procurement_order_price_changes', 'INSERT')
     OR has_table_privilege('authenticated', 'public.procurement_order_price_changes', 'INSERT')
     OR has_table_privilege('anon', 'public.procurement_order_price_changes', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.procurement_order_price_changes', 'UPDATE')
  THEN
    RAISE EXCEPTION 'procurement_order_price_changes is still reachable by anon/authenticated';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public'
       AND indexname = 'uniq_procurement_order_price_changes_one_waiting'
       AND indexdef ILIKE '%UNIQUE%'
       AND indexdef ILIKE '%WHERE%waiting%'
  ) THEN
    RAISE EXCEPTION 'procurement_order_price_changes: the one-waiting-per-order index is missing';
  END IF;
  FOREACH c IN ARRAY ARRAY['raised_by', 'decided_by'] LOOP
    SELECT ccu.table_schema || '.' || ccu.table_name || '.' || ccu.column_name
      INTO fk_target
      FROM information_schema.key_column_usage kcu
      JOIN information_schema.referential_constraints rc
        ON rc.constraint_name = kcu.constraint_name
       AND rc.constraint_schema = kcu.constraint_schema
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = rc.unique_constraint_name
       AND ccu.constraint_schema = rc.unique_constraint_schema
     WHERE kcu.table_schema = 'public'
       AND kcu.table_name = 'procurement_order_price_changes'
       AND kcu.column_name = c
     LIMIT 1;
    IF fk_target IS DISTINCT FROM 'public.users.user_id' THEN
      RAISE EXCEPTION 'procurement_order_price_changes.% must reference public.users(user_id), found %', c, coalesce(fk_target, 'no foreign key');
    END IF;
  END LOOP;
  RAISE NOTICE 'procurement_order_price_changes: created, locked down, one waiting per order, actor keys on public.users.';
END
$$;

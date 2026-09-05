-- An order changes state by the table, and the database is where that is true.
--
-- ADR 0125, Q2, answered by the founder on 2026-09-05: "Enforce the table as a
-- database trigger."
--
-- WHY THE SERVICE CHECK WAS NOT ENOUGH
-- ------------------------------------
-- `apps/api-gateway/src/procurement/order-transitions.ts` refuses an illegal
-- status move at two doors: `cancelOrder` and `updateOrder`. It cannot reach
-- `services/agent-orchestrator/agents/procurement_agent.py`, which writes
-- terminal statuses straight to Supabase with the service key and never touches
-- the gateway, and it cannot reach a hand at the SQL console. A
-- `BEFORE UPDATE OF status` trigger reaches every writer in every language.
--
-- ONE DEFINITION, NOT TWO
-- -----------------------
-- The two ARRAY literals below are GENERATED from `ORDER_TRANSITIONS` in
-- `order-transitions.ts` by `renderOrderTransitionSqlArrays()`. They are not
-- maintained here. Two things stop them drifting:
--   * `order-transition-sql.spec.ts` renders the arrays and asserts this file
--     contains them character for character;
--   * `scripts/check_order_transition_sql.py` parses BOTH the .ts table and
--     this file and compares the edge sets, exiting 2 when it cannot parse
--     either rather than passing on an empty comparison.
-- Regenerate, never hand-edit.
--
-- WHAT THIS TRIGGER DELIBERATELY DOES NOT ENFORCE
-- -----------------------------------------------
-- The same-state rule. `sameStateIsPermitted` in the TypeScript refuses
-- RE-ENTERING a terminal state, because cancelling an already-cancelled order
-- overwrites its reason and files a second audit row naming a second person.
-- Postgres cannot see that distinction: `SET status = 'CANCELLED'` on a row that
-- already reads CANCELLED, and an UPDATE that never mentions status, are the
-- same event to a trigger, and refusing it would forbid editing the notes on a
-- cancelled order. The trigger returns early on a same-state write; the terminal
-- re-entry rule stays in the service, where intent is visible. The equality the
-- spec and the guard enforce is over the EDGES, which is the part that must
-- never drift.
--
-- WHAT IT COSTS PRODUCTION TODAY: NOTHING. Measured read-only against project
-- `exzueerziesmczwlhomd` on 2026-09-05, before writing this file:
--   total orders                                        2
--   rows whose status is outside the twelve-member vocabulary   0
--   rows in a terminal state (which this trigger freezes)       0
--   rows whose goods have arrived                               0
-- so no existing row violates the table and none is frozen by it. The counts
-- are in ADR 0125's addendum with the query.
--
-- Additive: one function, one trigger. No column, no table, no RLS surface, no
-- backfill, and nothing to revert on an existing row.

CREATE OR REPLACE FUNCTION public.procurement_order_transition_is_legal()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  -- GENERATED from apps/api-gateway/src/procurement/order-transitions.ts
  -- (ORDER_TRANSITIONS). Do not hand-edit; see this file's header.
  edges text[] := ARRAY[
      'APPROVAL_NEEDED>APPROVED',
      'APPROVAL_NEEDED>CANCELLED',
      'APPROVAL_NEEDED>FAILED',
      'APPROVAL_NEEDED>NEGOTIATING',
      'APPROVAL_NEEDED>REJECTED',
      'APPROVED>CANCELLED',
      'APPROVED>CONFIRMED',
      'APPROVED>DELIVERED',
      'APPROVED>FAILED',
      'APPROVED>IN_TRANSIT',
      'APPROVED>NEGOTIATING',
      'APPROVED>PARTIALLY_RECEIVED',
      'APPROVED>REJECTED',
      'CONFIRMED>CANCELLED',
      'CONFIRMED>DELIVERED',
      'CONFIRMED>FAILED',
      'CONFIRMED>IN_TRANSIT',
      'CONFIRMED>NEGOTIATING',
      'CONFIRMED>PARTIALLY_RECEIVED',
      'DELIVERED>COMPLETED',
      'DELIVERED>FAILED',
      'DELIVERED>PARTIALLY_RECEIVED',
      'IN_TRANSIT>CANCELLED',
      'IN_TRANSIT>DELIVERED',
      'IN_TRANSIT>FAILED',
      'IN_TRANSIT>PARTIALLY_RECEIVED',
      'NEGOTIATING>APPROVAL_NEEDED',
      'NEGOTIATING>APPROVED',
      'NEGOTIATING>CANCELLED',
      'NEGOTIATING>FAILED',
      'NEGOTIATING>REJECTED',
      'PARTIALLY_RECEIVED>COMPLETED',
      'PARTIALLY_RECEIVED>DELIVERED',
      'PARTIALLY_RECEIVED>FAILED',
      'PENDING>APPROVAL_NEEDED',
      'PENDING>APPROVED',
      'PENDING>CANCELLED',
      'PENDING>FAILED',
      'PENDING>NEGOTIATING',
      'PENDING>REJECTED'
    ];
  -- GENERATED likewise. Every member of ProcurementOrderStatus, so a state the
  -- house does not recognise is refused rather than silently permitted.
  vocabulary text[] := ARRAY[
      'APPROVAL_NEEDED',
      'APPROVED',
      'CANCELLED',
      'COMPLETED',
      'CONFIRMED',
      'DELIVERED',
      'FAILED',
      'IN_TRANSIT',
      'NEGOTIATING',
      'PARTIALLY_RECEIVED',
      'PENDING',
      'REJECTED'
    ];
  v_from text := OLD.status::text;
  v_to   text := NEW.status::text;
BEGIN
  -- A write that does not move the order is not a transition. See the header.
  IF v_to IS NOT DISTINCT FROM v_from THEN
    RETURN NEW;
  END IF;

  IF v_from IS NULL OR NOT (v_from = ANY (vocabulary)) THEN
    RAISE EXCEPTION
      'This order''s current state reads %, which is not a state this house recognises, so whether it may become % cannot be decided. Nothing was changed.',
      COALESCE(v_from, 'nothing at all'), COALESCE(v_to, 'nothing at all')
      USING ERRCODE = '23514';
  END IF;

  IF v_to IS NULL OR NOT (v_to = ANY (vocabulary)) THEN
    RAISE EXCEPTION
      'An order cannot be moved to %, which is not a state this house recognises. It is % and it stays %. Nothing was changed.',
      COALESCE(v_to, 'nothing at all'), v_from, v_from
      USING ERRCODE = '23514';
  END IF;

  IF NOT (v_from || '>' || v_to = ANY (edges)) THEN
    -- The three rules, named, so the row that refused says WHY and not merely
    -- that it refused. The service says the same things in fuller words
    -- (`refuseTransition`); this is the backstop for writers that never reach it.
    IF v_to = 'CANCELLED'
       AND v_from IN ('DELIVERED', 'PARTIALLY_RECEIVED', 'COMPLETED') THEN
      RAISE EXCEPTION
        'Refused % -> %: the rule is that an order whose goods have arrived cannot be cancelled. The wine is counted into stock and its cost is in the books; cancelling would take the money out of every spend and delivery figure while the bottles stay on the shelf. Raise a vendor credit, or correct the count at the receiving door. Nothing was changed.',
        v_from, v_to
        USING ERRCODE = '23514';
    ELSIF NOT EXISTS (SELECT 1 FROM unnest(edges) e WHERE e LIKE v_from || '>%') THEN
      RAISE EXCEPTION
        'Refused % -> %: the rule is that a closed order is not reopened. A second life for the same order would let its money be counted twice. Raise a new order instead. Nothing was changed.',
        v_from, v_to
        USING ERRCODE = '23514';
    ELSE
      RAISE EXCEPTION
        'Refused % -> %: the rule is that an order moves only along transitions this house has agreed to, and that is not one of them. Nothing was changed.',
        v_from, v_to
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$fn$;

COMMENT ON FUNCTION public.procurement_order_transition_is_legal() IS
  'ADR 0125. The order transition table, generated from apps/api-gateway/src/procurement/order-transitions.ts. Regenerate with renderOrderTransitionSqlArrays(); never hand-edit. Same-state writes are deliberately permitted here and refused in the service.';

DROP TRIGGER IF EXISTS trg_procurement_order_transition_is_legal
  ON public.procurement_orders;

-- `OF status` so an UPDATE that never mentions the column does not pay for this
-- check at all, and cannot be refused by it.
CREATE TRIGGER trg_procurement_order_transition_is_legal
  BEFORE UPDATE OF status ON public.procurement_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.procurement_order_transition_is_legal();

-- In-file assertions: this migration proves it did what it says.
DO $assert$
DECLARE
  n int;
BEGIN
  SELECT count(*) INTO n
    FROM pg_trigger
   WHERE tgname = 'trg_procurement_order_transition_is_legal'
     AND tgrelid = 'public.procurement_orders'::regclass
     AND NOT tgisinternal;
  IF n <> 1 THEN
    RAISE EXCEPTION 'the transition trigger was not created (found % of 1)', n;
  END IF;

  SELECT count(*) INTO n
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public'
     AND p.proname = 'procurement_order_transition_is_legal';
  IF n <> 1 THEN
    RAISE EXCEPTION 'the transition function was not created (found % of 1)', n;
  END IF;
END;
$assert$;

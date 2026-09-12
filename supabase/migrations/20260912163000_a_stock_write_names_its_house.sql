-- ===========================================================================
-- ADR 0141 — a stock write names the house it is for, and the primitive
--            refuses a mismatch rather than trusting the caller
-- ===========================================================================
--
-- WHAT WAS WRONG (measured on main `aa426050`, live in production).
--
-- `public.apply_stock_movement` took NO restaurant argument. Its first act on
-- the item was
--
--     SELECT restaurant_id, master_wine_id INTO v_restaurant, v_wine
--       FROM restaurant_inventory WHERE id = p_inventory_id FOR UPDATE;
--
-- (`20260906233000_stock_at_the_door_cost_at_verified.sql:222`) and it then
-- wrote the lot and the ledger row under THAT restaurant. The tenant of a
-- stock write was therefore decided entirely by the id the caller handed in.
--
-- There is no RLS on this path — the gateway holds the service-role key — and
-- there was no tenant assertion anywhere in the function. The gateway did not
-- compensate: `InventoryLedgerService.createTransaction` received the caller's
-- `restaurantId` from the authenticated token, logged it, checked only that
-- the quantity was non-zero, and passed `p_inventory_id` straight through. So
-- a signed-in user who supplied an inventory id belonging to another house
-- wrote into that house's ledger, and — because the read-back afterwards IS
-- scoped to the caller — was told "Transaction not found" while the write had
-- committed.
--
-- WHAT THIS MIGRATION DOES.
--
-- One thing: the function learns to be TOLD which restaurant a movement is
-- for, and refuses when the item does not belong to it. The guarantee stops
-- resting on every present and future caller remembering to check first.
--
-- THE ROLLOUT, AND WHY THE ARGUMENT DEFAULTS TO NULL.
--
-- Migrations apply when the PR merges; the gateway deploys AFTER that. For the
-- length of that window the OLD gateway calls the NEW function.
--
--   * A REQUIRED argument would make every stock write fail in that window —
--     every POS sale, every door receipt, every inventory add — because the
--     old gateway cannot supply it. Worse, two callers outside this deploy
--     unit would break for longer than the window: the Python orchestrator
--     (`services/agent-orchestrator/core/database.py:996`) and the sim seed
--     (`scripts/synth/seed.py:925`) ship on their own cadence. A fix whose
--     first act is to stop the floor is not a fix.
--
--   * An argument that DEFAULTS TO NULL and asserts only when supplied breaks
--     nothing. The window costs exactly this and no more: during it the hole
--     is as wide as it is today — no wider — because the old gateway passes no
--     restaurant and the assertion does not fire. It closes the moment the new
--     gateway lands, since every gateway call site in this change names its
--     house. The residual is that NULL is still admitted afterwards, which a
--     SECOND migration must remove once the Python orchestrator can name a
--     restaurant (it takes only an inventory id today — recorded in
--     `.planning/v3.0-TECH-DEBT.md`, not fixed here).
--
-- The NULL default is the choice. It is the weaker of the two guarantees and
-- it is the only one that can be deployed without an outage.
--
-- WHAT THE FUNCTION MUST NEVER DO is widen. A supplied restaurant that does
-- not match the item RAISES; it is never downgraded to a warning, never
-- ignored, and never used to relocate the write.
--
-- WHY A DROP AND NOT A `CREATE OR REPLACE`. Postgres treats a different
-- parameter LIST as a distinct overload, so replacing in place is not
-- available: an 18-argument function would sit ALONGSIDE the 17-argument one
-- and PostgREST — which resolves by argument NAME — would then have two
-- candidates for a 17-key call and refuse as ambiguous. The old signature is
-- therefore dropped first so there is exactly one `apply_stock_movement`
-- afterwards, which is precisely what `20260805130000_extend_apply_stock_movement.sql:27`
-- did for the same reason when it went from 12 parameters to 17.
--
-- NO ACL IS LOST BY THE DROP. `grep -rn "apply_stock_movement" supabase/migrations/`
-- returns no GRANT or REVOKE for this function in any migration, baseline
-- included — it has only ever carried Postgres's default EXECUTE, which the
-- new function also carries. The comment in `20260906233000` that a DROP
-- "silently discards the baseline ACL" is true in general and empty here:
-- there is no baseline ACL on this function to discard.
--
-- NOT APPLIED BY HAND. The Supabase GitHub integration applies migrations on
-- merge, keyed by this filename.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Exactly one apply_stock_movement, and it is the one below
-- ---------------------------------------------------------------------------
--
-- The 12-argument baseline signature was already dropped by 20260805130000;
-- naming it again is idempotent and makes the "exactly one" assertion at the
-- end of this file provable rather than assumed.

DROP FUNCTION IF EXISTS public.apply_stock_movement(
    uuid, text, integer, text, text, uuid, text, numeric, uuid, uuid, text, text
);

DROP FUNCTION IF EXISTS public.apply_stock_movement(
    uuid, text, integer, text, text, uuid, text, numeric, uuid, uuid, text, text,
    text, uuid, text, text, jsonb
);

-- ---------------------------------------------------------------------------
-- 2. The primitive, with the house it is acting for
-- ---------------------------------------------------------------------------
--
-- The body is `20260906233000_stock_at_the_door_cost_at_verified.sql:155-254`
-- verbatim except for the two assertions marked ADR 0141 and the new final
-- parameter. Nothing about cost, provenance, delivery stamping, FIFO depletion
-- or idempotency changes.

CREATE FUNCTION public.apply_stock_movement(
    p_inventory_id uuid,
    p_stock_state text,
    p_delta integer,
    p_transaction_type text,
    p_source text,
    p_performed_by uuid DEFAULT NULL::uuid,
    p_reason text DEFAULT NULL::text,
    p_unit_cost numeric DEFAULT NULL::numeric,
    p_location_id uuid DEFAULT NULL::uuid,
    p_order_id uuid DEFAULT NULL::uuid,
    p_idempotency_key text DEFAULT NULL::text,
    p_cost_provenance text DEFAULT NULL::text,
    p_reference_type text DEFAULT NULL::text,
    p_reference_id uuid DEFAULT NULL::uuid,
    p_pos_transaction_id text DEFAULT NULL::text,
    p_notes text DEFAULT NULL::text,
    p_metadata jsonb DEFAULT NULL::jsonb,
    p_restaurant_id uuid DEFAULT NULL::uuid
) RETURNS uuid
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_restaurant uuid; v_wine uuid;
  v_before int; v_after int; v_remaining int; v_txn uuid; v_lot record;
  v_provenance text;
  v_delivery uuid;
  v_cost_state text;
  v_owned boolean;
BEGIN
  IF p_delta = 0 THEN RETURN NULL; END IF;
  IF p_stock_state NOT IN ('live','shadow') THEN RAISE EXCEPTION 'invalid stock_state %', p_stock_state; END IF;

  -- ADR 0141 — THE FIRST ASSERTION, BEFORE THE IDEMPOTENCY LOOKUP.
  --
  -- It sits here rather than beside the FOR UPDATE below for one reason: the
  -- idempotency short-circuit returns an EXISTING transaction id for a key it
  -- has seen, and a key is not tenant-scoped. Checking only after that would
  -- let a caller naming another house's item confirm, and retrieve the id of,
  -- a transaction it has no business seeing. A movement that names a house
  -- proves the item is that house's BEFORE anything is looked up or returned.
  --
  -- Deliberately not `FOR UPDATE`: this is a refusal test, not the read the
  -- write depends on, and taking the row lock before the idempotency check
  -- would make every replay contend for a lock it does not need. The
  -- authoritative comparison is repeated below, inside the lock.
  --
  -- A NULL p_restaurant_id asserts NOTHING. That is the deploy window, and it
  -- is temporary — see the header.
  IF p_restaurant_id IS NOT NULL THEN
    SELECT true INTO v_owned FROM restaurant_inventory
      WHERE id = p_inventory_id AND restaurant_id = p_restaurant_id;
    IF v_owned IS NOT TRUE THEN
      RAISE EXCEPTION
        'apply_stock_movement: item % is not an item of restaurant %, so no stock was moved and no ledger row was written. A stock movement names the house it is for, and this one does not match the item.',
        p_inventory_id, p_restaurant_id
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF p_cost_provenance IS NOT NULL
     AND p_cost_provenance NOT IN ('invoice','estimated','manual','sample') THEN
    RAISE EXCEPTION 'invalid cost_provenance %', p_cost_provenance;
  END IF;

  IF p_delta > 0 AND p_unit_cost IS NOT NULL AND p_cost_provenance IS NULL THEN
    RAISE EXCEPTION
      'apply_stock_movement: p_unit_cost was given without p_cost_provenance. '
      'A price that becomes a lot must say what kind of price it is: '
      '''invoice'' (a document was read), ''manual'' (a person typed it), '
      '''estimated'' (nobody has verified it) or ''sample'' (it was free). '
      'This used to default to ''invoice'', which stamped unverified prices as '
      'invoice-verified. See ADR 0078.'
      USING ERRCODE = '22023';
  END IF;

  -- No inference. A lot with no price is 'estimated' — the column's own schema
  -- default, and the only honest label for a quantity nobody has costed.
  v_provenance := COALESCE(p_cost_provenance, 'estimated');

  -- ADR 0103 A1. A movement that NAMES a delivery books against it, and what it
  -- books is provisional until somebody verifies the delivery. Everything else
  -- is final only when a price AND a provenance that names a document or a
  -- person stand behind it — an estimate is not a settled cost, and saying so
  -- is the whole of finding 2.
  v_delivery := CASE WHEN p_reference_type = 'delivery' THEN p_reference_id ELSE NULL END;
  v_cost_state := CASE
    WHEN v_delivery IS NOT NULL THEN 'provisional'
    WHEN p_unit_cost IS NOT NULL AND v_provenance IN ('invoice','manual') THEN 'final'
    ELSE 'provisional'
  END;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_txn FROM inventory_transactions WHERE idempotency_key = p_idempotency_key LIMIT 1;
    IF v_txn IS NOT NULL THEN RETURN v_txn; END IF;
  END IF;

  SELECT restaurant_id, master_wine_id INTO v_restaurant, v_wine
    FROM restaurant_inventory WHERE id = p_inventory_id FOR UPDATE;
  IF v_restaurant IS NULL THEN RAISE EXCEPTION 'inventory % not found', p_inventory_id; END IF;

  -- ADR 0141 — THE AUTHORITATIVE ASSERTION, UNDER THE ROW LOCK.
  --
  -- The check above ran without a lock, so between it and here the item could
  -- in principle have been moved to another restaurant. This one is the
  -- comparison the write actually depends on: v_restaurant is the value about
  -- to be stamped on the lot and the ledger row, and it is compared against
  -- what the caller said it would be. Same sentence, because it is the same
  -- refusal.
  IF p_restaurant_id IS NOT NULL AND v_restaurant <> p_restaurant_id THEN
    RAISE EXCEPTION
      'apply_stock_movement: item % is not an item of restaurant %, so no stock was moved and no ledger row was written. A stock movement names the house it is for, and this one does not match the item.',
      p_inventory_id, p_restaurant_id
      USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(SUM(qty),0) INTO v_before FROM inventory_lots
    WHERE inventory_id = p_inventory_id AND stock_state = p_stock_state;
  v_after := v_before + p_delta;
  IF v_after < 0 THEN RAISE EXCEPTION 'stock would go negative: % + %', v_before, p_delta; END IF;

  IF p_delta > 0 THEN
    INSERT INTO inventory_lots (restaurant_id, inventory_id, master_wine_id, location_id, stock_state, qty, unit_cost, cost_provenance, source_order_id, delivery_id, cost_state)
    VALUES (v_restaurant, p_inventory_id, v_wine, p_location_id, p_stock_state, p_delta, p_unit_cost,
            v_provenance, p_order_id, v_delivery, v_cost_state);
  ELSE
    v_remaining := -p_delta;
    FOR v_lot IN SELECT id, qty FROM inventory_lots
        WHERE inventory_id = p_inventory_id AND stock_state = p_stock_state AND qty > 0
        ORDER BY received_at ASC, created_at ASC LOOP
      EXIT WHEN v_remaining <= 0;
      IF v_lot.qty <= v_remaining THEN
        v_remaining := v_remaining - v_lot.qty;
        DELETE FROM inventory_lots WHERE id = v_lot.id;
      ELSE
        UPDATE inventory_lots SET qty = qty - v_remaining, updated_at = now() WHERE id = v_lot.id;
        v_remaining := 0;
      END IF;
    END LOOP;
  END IF;

  INSERT INTO inventory_transactions
    (restaurant_id, inventory_id, wine_id, transaction_type, source, quantity_change, quantity_before, quantity_after,
     stock_type, unit_cost, performed_by, performed_by_type, reason, order_id, idempotency_key, transaction_date,
     reference_type, reference_id, pos_transaction_id, notes, metadata, delivery_id)
  VALUES
    (v_restaurant, p_inventory_id, v_wine, p_transaction_type::inventory_transaction_type, p_source::inventory_transaction_source,
     p_delta, v_before, v_after, p_stock_state, p_unit_cost, p_performed_by,
     CASE WHEN p_performed_by IS NOT NULL THEN 'user' ELSE 'system' END,
     p_reason, p_order_id, p_idempotency_key, now(),
     p_reference_type, p_reference_id, p_pos_transaction_id, p_notes, COALESCE(p_metadata, '{}'::jsonb), v_delivery)
  RETURNING id INTO v_txn;

  RETURN v_txn;
END;
$$;

COMMENT ON FUNCTION public.apply_stock_movement IS
  'Single stock write primitive (SimPOS testbed plan, decision A1). Locks the '
  'inventory row, depletes/creates lots FIFO, writes the ledger row, and is '
  'idempotent on p_idempotency_key. Extended 2026-08-05 with reference_type, '
  'reference_id, pos_transaction_id, notes and metadata. Changed 2026-09-02 '
  '(ADR 0078): cost provenance is never inferred. Changed 2026-09-06 (ADR 0103 '
  'A1): a caller naming p_reference_type = ''delivery'' stamps '
  'inventory_transactions.delivery_id and inventory_lots.delivery_id, and the '
  'lot it creates is cost_state = ''provisional'' until finalise_delivery_cost '
  'settles it at VERIFIED. Changed 2026-09-12 (ADR 0141): p_restaurant_id says '
  'WHICH HOUSE the movement is for, and an item that does not belong to it '
  'RAISES 42501 before the idempotency lookup and again under the row lock — '
  'the tenant of a stock write is no longer decided by the inventory id alone. '
  'p_restaurant_id DEFAULTS TO NULL and a NULL asserts nothing; that default '
  'exists only to survive the window between this migration applying at merge '
  'and the gateway deploying after it, and a later migration makes NULL refuse. '
  'Use revalue_lot or finalise_delivery_cost to CORRECT a cost — this function '
  'only ever creates or consumes quantity.';

-- ---------------------------------------------------------------------------
-- 3. In-file assertions
-- ---------------------------------------------------------------------------
--
-- Structural only. A behavioural assertion would have to INSERT a restaurant,
-- an item and a lot into live tables to have something to refuse, and a
-- migration does not get to write rows into production to prove itself. The
-- behaviour is exercised against a real Postgres in the PGlite probe named in
-- ADR 0141 and in the gateway suite.

DO $$
DECLARE
  v_count int;
  v_args int;
  v_src text;
BEGIN
  SELECT count(*) INTO v_count
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'apply_stock_movement';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'expected exactly one public.apply_stock_movement after this migration, found %. Two overloads make PostgREST ambiguous and every named-argument call fails.', v_count;
  END IF;

  SELECT p.pronargs, p.prosrc INTO v_args, v_src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'apply_stock_movement';

  IF v_args <> 18 THEN
    RAISE EXCEPTION 'apply_stock_movement should take 18 arguments after this migration, takes %', v_args;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'apply_stock_movement'
       AND p.proargnames[18] = 'p_restaurant_id'
  ) THEN
    RAISE EXCEPTION 'the 18th argument of apply_stock_movement is not named p_restaurant_id';
  END IF;

  -- The default is what makes the deploy window survivable. If a later change
  -- removes it, that is a decision and this assertion should be removed with
  -- it — not left to be discovered by an outage.
  IF (SELECT pronargdefaults FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'apply_stock_movement') <> 13 THEN
    RAISE EXCEPTION 'apply_stock_movement should carry 13 defaulted arguments (p_performed_by through p_restaurant_id)';
  END IF;

  -- The refusal is really in the body, not only in this file's comments.
  IF position('does not match the item' in v_src) = 0 THEN
    RAISE EXCEPTION 'apply_stock_movement body carries no tenant refusal';
  END IF;
END;
$$;

COMMIT;

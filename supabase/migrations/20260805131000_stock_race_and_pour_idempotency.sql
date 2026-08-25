-- Spine repair, decisions A11-A12.
--
-- A11: inventory.service.ts's updateInventoryItem read stock_live/shadow_stock
-- with a plain SELECT (no lock), computed a delta against that stale value in
-- JS, then called apply_stock_movement. Two concurrent manual overrides that
-- both read before either wrote both diff against the same baseline, and the
-- loser's update is silently absorbed rather than applied. set_stock_absolute
-- locks the restaurant_inventory row FIRST, reads the true current quantity
-- from inventory_lots under that lock, computes the delta itself, and only
-- then calls apply_stock_movement (which re-locks the same row in the same
-- transaction — safe, Postgres row locks are reentrant within one xact).
-- apply_stock_movement remains the only function that writes inventory_lots /
-- inventory_transactions; this is a locked-read wrapper, not a second ledger
-- path.
CREATE OR REPLACE FUNCTION public.set_stock_absolute(
    p_inventory_id uuid,
    p_stock_state text,
    p_target_qty integer,
    p_transaction_type text,
    p_source text,
    p_performed_by uuid DEFAULT NULL::uuid,
    p_reason text DEFAULT NULL::text,
    p_idempotency_key text DEFAULT NULL::text
) RETURNS uuid
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_current int;
  v_delta int;
BEGIN
  IF p_stock_state NOT IN ('live','shadow') THEN
    RAISE EXCEPTION 'invalid stock_state %', p_stock_state;
  END IF;

  -- Lock BEFORE reading. This is the entire fix: nobody else's transaction can
  -- change this item's lots between the read below and the write inside
  -- apply_stock_movement, because both happen while this lock is held.
  PERFORM 1 FROM restaurant_inventory WHERE id = p_inventory_id FOR UPDATE;

  SELECT COALESCE(SUM(qty), 0) INTO v_current
    FROM inventory_lots
    WHERE inventory_id = p_inventory_id AND stock_state = p_stock_state;

  v_delta := p_target_qty - v_current;
  IF v_delta = 0 THEN RETURN NULL; END IF;

  RETURN apply_stock_movement(
    p_inventory_id, p_stock_state, v_delta, p_transaction_type, p_source,
    p_performed_by, p_reason, NULL, NULL, NULL, p_idempotency_key
  );
END;
$$;

COMMENT ON FUNCTION public.set_stock_absolute IS
  'Locked "set to X" wrapper around apply_stock_movement (SimPOS testbed '
  'plan, decision A11). Use this instead of reading stock_live client-side '
  'and computing a delta, which races under concurrent manual overrides.';

-- A12: pour_events.idempotency_key has pour_events_idempotency_key_key UNIQUE
-- but the column was nullable, and NestJS's recordPour endpoint never passed
-- p_idempotency_key at all — every manual pour landed with idempotency_key
-- NULL. Backfill existing NULL rows with a synthetic, unique value derived
-- from the row id (never collides, never retried against) before making the
-- column mandatory.
UPDATE public.pour_events
   SET idempotency_key = 'backfill:' || id::text
 WHERE idempotency_key IS NULL;

ALTER TABLE public.pour_events
    ALTER COLUMN idempotency_key SET NOT NULL;

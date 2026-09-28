-- The door record is append-only in the database (ADR 0227).
--
-- THE RULING
-- ----------
-- The founder, 2026-09-25, round 5, asked whether the door record the
-- receiving desk's history is built from should be append-only by
-- construction, chose verbatim: "Trigger, no cascade (Recommended) — A
-- trigger refuses UPDATE/DELETE on door receipts, and the FK stops cascading
-- (orders with receipts can't be hard-deleted). Makes 'history from receipts'
-- trustworthy." (Rejected: "Trigger only" and "Leave by convention".)
--
-- WHAT WAS TRUE BEFORE THIS FILE (measured on main + #436, PGlite build of all
-- 235 migrations, 2026-09-25)
-- ---------------------------------------------------------------------------
--   * `procurement_receipt_events` had no trigger of its own. Every write in
--     apps/, services/, packages/ and scripts/ is an INSERT (door and desk),
--     and anon/authenticated hold no privilege on it
--     (20260825200000_od73_close_anon_dml.sql:204-208) — append-only by
--     convention only: the service role could UPDATE or DELETE any row, and a
--     migration already rewrote rows once
--     (20260901220000_door_facts_are_columns.sql:64).
--   * Its three foreign keys (baseline:13174, :13182, :13190):
--       order_id      -> procurement_orders   ON DELETE CASCADE
--       restaurant_id -> restaurants          ON DELETE CASCADE
--       document_id   -> procurement_documents ON DELETE SET NULL
--     so deleting an order or a house erased its receipts, and deleting a
--     document rewrote them.
--
-- WHAT THIS FILE DOES
-- -------------------
--   1. A row trigger refuses every UPDATE and DELETE, and a statement trigger
--      refuses TRUNCATE (a row trigger never sees a TRUNCATE). It binds every
--      role, the table owner included; only disabling the trigger gets past
--      it, which is a schema change a reviewer sees in a migration.
--   2. order_id and restaurant_id stop cascading: ON DELETE RESTRICT. An
--      order or a house that has door receipts cannot be hard-deleted; the
--      delete is refused whole (23503) and nothing is removed. An order or a
--      house with NO receipts deletes exactly as before (orders still cascade
--      from their house).
--   3. document_id: SET NULL -> RESTRICT as well. SET NULL is an UPDATE of the
--      receipt row, which (1) now refuses, so keeping SET NULL would declare
--      an action that can never succeed; RESTRICT says what actually happens.
--
-- WHAT STILL DELETES A HOUSE OR AN ORDER, AND WHY IT STILL WORKS (ADR 0227 §2)
--   * auth.service.ts createHouse / registerRestaurant rollbacks and
--     organizations.service.ts createLocation rollback delete a house created
--     moments earlier in the same request: it has no orders and no receipts.
--   * scripts/synth/teardown.py deletes sim houses; the simulator writes no
--     procurement orders or receipts (its write set has neither).
--   * No product route deletes an order or a house. Removing a house that
--     has a door history is a soft delete (`restaurants.deleted_at`, which
--     exists), never a hard one.
--
-- Additive to data: no row is read, written or removed. Idempotent. The
-- assertions at the bottom read the catalogue only.

-- ---------------------------------------------------------------------------
-- 1. The refusal.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.procurement_receipt_events_are_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION
    'procurement_receipt_events is append-only (ADR 0227): % refused. A door receipt is a record of what happened; record a new receipt event instead of changing or removing one.',
    tg_op
    USING errcode = 'restrict_violation';
END;
$$;

COMMENT ON FUNCTION public.procurement_receipt_events_are_append_only() IS
  'Refuses every UPDATE, DELETE and TRUNCATE on procurement_receipt_events: the door record the receiving desk history is built from is append-only by construction (founder, 2026-09-25, round 5: "Trigger, no cascade"). ADR 0227.';

DROP TRIGGER IF EXISTS trg_procurement_receipt_events_append_only
  ON public.procurement_receipt_events;
CREATE TRIGGER trg_procurement_receipt_events_append_only
  BEFORE UPDATE OR DELETE ON public.procurement_receipt_events
  FOR EACH ROW EXECUTE FUNCTION public.procurement_receipt_events_are_append_only();

DROP TRIGGER IF EXISTS trg_procurement_receipt_events_no_truncate
  ON public.procurement_receipt_events;
CREATE TRIGGER trg_procurement_receipt_events_no_truncate
  BEFORE TRUNCATE ON public.procurement_receipt_events
  FOR EACH STATEMENT EXECUTE FUNCTION public.procurement_receipt_events_are_append_only();

-- ---------------------------------------------------------------------------
-- 2 and 3. The foreign keys stop acting on the rows.
-- ---------------------------------------------------------------------------
ALTER TABLE public.procurement_receipt_events
  DROP CONSTRAINT IF EXISTS procurement_receipt_events_order_id_fkey,
  ADD CONSTRAINT procurement_receipt_events_order_id_fkey
    FOREIGN KEY (order_id) REFERENCES public.procurement_orders(id) ON DELETE RESTRICT;

ALTER TABLE public.procurement_receipt_events
  DROP CONSTRAINT IF EXISTS procurement_receipt_events_restaurant_id_fkey,
  ADD CONSTRAINT procurement_receipt_events_restaurant_id_fkey
    FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE RESTRICT;

ALTER TABLE public.procurement_receipt_events
  DROP CONSTRAINT IF EXISTS procurement_receipt_events_document_id_fkey,
  ADD CONSTRAINT procurement_receipt_events_document_id_fkey
    FOREIGN KEY (document_id) REFERENCES public.procurement_documents(id) ON DELETE RESTRICT;

COMMENT ON TABLE public.procurement_receipt_events IS
  'The door record: one row per receipt act (door count, refusal, desk verification). Append-only by trigger; its order, house and document cannot be hard-deleted from under it (ON DELETE RESTRICT). ADR 0227.';

-- ---------------------------------------------------------------------------
-- Assertions (catalogue reads only).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_actions text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'public.procurement_receipt_events'::regclass
       AND tgname = 'trg_procurement_receipt_events_append_only'
       AND NOT tgisinternal AND tgenabled = 'O'
       -- BEFORE (2) | ROW (1) | DELETE (8) | UPDATE (16) = 27
       AND tgtype = 27
  ) THEN
    RAISE EXCEPTION 'procurement_receipt_events has no enabled BEFORE UPDATE OR DELETE row trigger';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'public.procurement_receipt_events'::regclass
       AND tgname = 'trg_procurement_receipt_events_no_truncate'
       AND NOT tgisinternal AND tgenabled = 'O'
       -- BEFORE (2) | TRUNCATE (32), statement level = 34
       AND tgtype = 34
  ) THEN
    RAISE EXCEPTION 'procurement_receipt_events has no enabled BEFORE TRUNCATE trigger';
  END IF;

  SELECT string_agg(a.attname::text || '=' || c.confdeltype::text, ',' ORDER BY a.attname)
    INTO v_actions
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
   WHERE c.conrelid = 'public.procurement_receipt_events'::regclass
     AND c.contype = 'f';
  IF v_actions IS DISTINCT FROM 'document_id=r,order_id=r,restaurant_id=r' THEN
    RAISE EXCEPTION 'procurement_receipt_events foreign keys must all be ON DELETE RESTRICT, found %', v_actions;
  END IF;
END
$$;

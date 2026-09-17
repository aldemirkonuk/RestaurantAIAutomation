-- A decision on a shared register names the house that took it.
--
-- ADR 0124 addendum, 2026-09-16; ADR 0149 answer 17, the founder in session:
-- *"A new nullable deciding-house column; the person's name and undo only
-- inside that house."* Supersedes the Q2 read of ADR 0124 for shared rows only.
--
-- THE FAULT THIS CLOSES
-- ---------------------
-- A candidate on a public register (`beverage_identity_candidates.restaurant_id`
-- NULL -- a `price_index_postings` row every house reads) is shown to every
-- house, and ADR 0124 Q2 lets any house decide it. The decision log copies the
-- CANDIDATE's house (20260906030000), so a shared decision is logged with
-- `restaurant_id` NULL and the house that actually took it is recorded
-- nowhere. Two things followed from that one missing fact
-- (p4-scratch/endpoint-faults/vendor-intel-identity.md, faults 1 and 2):
--   * any house's manager could undo another house's decision on a shared row,
--     clearing a link that changes every house's price ladder;
--   * every house read the deciding person's `decided_by_label`, which is
--     `name ?? email` -- another tenant's staff name or email address.
--
-- WHAT IS ADDED
-- -------------
-- `deciding_restaurant_id`: the house the session was acting in when it took
-- the decision (the token's active house, never the request body). NULLABLE,
-- and it stays NULL on every row written before this migration:
--   * the log is APPEND-ONLY by trigger (20260906030000), so an UPDATE backfill
--     is refused -- correctly;
--   * and for a shared row the house was never recorded, so there is nothing
--     true to backfill it with. The gateway reads such a row conservatively:
--     the person is hidden from every house and no house may undo it.
-- For a HOUSE row (`restaurant_id` set) the deciding house can only ever be
-- that house -- `IdentityService.requireSameHouse` refuses anything else -- so
-- the CHECK below pins that, and the reader treats a NULL there as the row's
-- own house.
--
-- NOT NULL WAS REJECTED. Migrations apply on merge and the gateway deploys
-- separately; a NOT NULL (or a date-keyed CHECK) would make the still-running
-- previous gateway fail every decision in the window between the two. A row it
-- writes in that window reads as an unrecorded house: hidden and not undoable,
-- which is the safe side.
--
-- FK TARGET. `public.restaurants(id)`, ON DELETE RESTRICT -- the same rule the
-- log's `restaurant_id` already follows (a house holding decisions is retired
-- by soft delete). Not `auth.users` / not a person: this is a house.
--
-- Additive and idempotent: no column is dropped or retyped, no row is written,
-- updated or deleted. No explicit BEGIN/COMMIT: the Supabase CLI wraps each
-- migration file in a transaction.

ALTER TABLE public.beverage_identity_decisions
  ADD COLUMN IF NOT EXISTS deciding_restaurant_id UUID
    REFERENCES public.restaurants(id) ON DELETE RESTRICT;

-- A house row is decided from its own house, or its deciding house was not
-- recorded. A shared row (restaurant_id NULL) may name any house.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = to_regclass('public.beverage_identity_decisions')
       AND conname = 'bid_house_row_is_decided_by_its_house'
  ) THEN
    ALTER TABLE public.beverage_identity_decisions
      ADD CONSTRAINT bid_house_row_is_decided_by_its_house CHECK (
        restaurant_id IS NULL
        OR deciding_restaurant_id IS NULL
        OR deciding_restaurant_id = restaurant_id
      );
  END IF;
END
$$;

-- The FK's own RESTRICT check reads this column when a restaurant is deleted;
-- partial because most rows (house rows, and every row before today) carry no
-- separate deciding house worth indexing.
CREATE INDEX IF NOT EXISTS idx_beverage_identity_decisions_deciding_house
  ON public.beverage_identity_decisions (deciding_restaurant_id)
  WHERE deciding_restaurant_id IS NOT NULL;

COMMENT ON COLUMN public.beverage_identity_decisions.deciding_restaurant_id IS
  'The house the session was acting in when it took this decision (the token''s active house). On a shared-register row (restaurant_id NULL) it is the ONLY record of which house decided: the person''s name and the undo are shown only inside this house, other houses see the outcome and when. NULL on rows written before 2026-09-17 and never backfilled (the log is append-only, and a shared row''s house was never recorded): the gateway hides the person on such a shared row from every house and refuses its undo. ADR 0124 addendum / ADR 0149 answer 17.';

-- ---------------------------------------------------------------------------
-- Assert the outcome rather than reporting success.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  col_type          text;
  col_nullable      text;
  fk_delete         "char";
  fk_target         regclass;
  check_def         text;
  probe_state       text;
  probe_constraint  text;
  decisions_before  bigint;
  decisions_after   bigint;
BEGIN
  SELECT data_type, is_nullable INTO col_type, col_nullable
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name = 'beverage_identity_decisions'
     AND column_name = 'deciding_restaurant_id';
  IF col_type IS NULL THEN
    RAISE EXCEPTION 'beverage_identity_decisions.deciding_restaurant_id was not added';
  END IF;
  IF col_type <> 'uuid' OR col_nullable <> 'YES' THEN
    RAISE EXCEPTION
      'deciding_restaurant_id must be a nullable uuid, is % (nullable %)',
      col_type, col_nullable;
  END IF;

  SELECT c.confdeltype, c.confrelid::regclass INTO fk_delete, fk_target
    FROM pg_constraint c
    JOIN pg_attribute a
      ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
   WHERE c.conrelid = to_regclass('public.beverage_identity_decisions')
     AND c.contype = 'f'
     AND a.attname = 'deciding_restaurant_id';
  IF fk_target IS NULL OR fk_target <> to_regclass('public.restaurants') THEN
    RAISE EXCEPTION 'deciding_restaurant_id does not reference public.restaurants (found %)', fk_target;
  END IF;
  IF fk_delete <> 'r' THEN
    RAISE EXCEPTION 'deciding_restaurant_id must be ON DELETE RESTRICT, is %', fk_delete;
  END IF;

  IF NOT (SELECT relrowsecurity FROM pg_class
           WHERE oid = to_regclass('public.beverage_identity_decisions')) THEN
    RAISE EXCEPTION 'beverage_identity_decisions has RLS off';
  END IF;

  -- The CHECK is the one this file means, not merely one with its name:
  -- `IF NOT EXISTS` above keeps a same-named constraint whatever its body.
  -- Compared with whitespace and parentheses stripped, because
  -- pg_get_constraintdef re-parenthesises the expression.
  SELECT pg_get_constraintdef(c.oid) INTO check_def
    FROM pg_constraint c
   WHERE c.conrelid = to_regclass('public.beverage_identity_decisions')
     AND c.conname = 'bid_house_row_is_decided_by_its_house'
     AND c.contype = 'c';
  IF check_def IS NULL THEN
    RAISE EXCEPTION 'bid_house_row_is_decided_by_its_house is missing, or is not a CHECK';
  END IF;
  IF regexp_replace(lower(check_def), '[[:space:]()]', '', 'g')
     <> 'checkrestaurant_idisnullordeciding_restaurant_idisnullordeciding_restaurant_id=restaurant_id' THEN
    RAISE EXCEPTION
      'bid_house_row_is_decided_by_its_house exists with a different body: %', check_def;
  END IF;

  -- PROVE the CHECK on a probe that cannot survive: a house row naming a
  -- DIFFERENT deciding house. CHECK constraints fire as the tuple is formed,
  -- before the foreign keys' end-of-statement triggers, so a working CHECK
  -- answers 23514 here and the random candidate/house ids are never looked up.
  -- Any other outcome (success, a foreign-key error meaning the CHECK let it
  -- through, or a DIFFERENT check constraint firing first) aborts the migration
  -- -- and with it the probe row. Nothing is deleted afterwards because nothing
  -- can have been written.
  SELECT count(*) INTO decisions_before FROM public.beverage_identity_decisions;

  probe_state := 'inserted';
  probe_constraint := NULL;
  BEGIN
    INSERT INTO public.beverage_identity_decisions
      (candidate_id, restaurant_id, deciding_restaurant_id, action,
       decided_by_label, decided_by_role)
    VALUES (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'confirmed',
            'Probe Person', 'staff');
  EXCEPTION
    WHEN check_violation THEN
      GET STACKED DIAGNOSTICS probe_constraint = CONSTRAINT_NAME;
      probe_state := 'check_violation';
    WHEN others THEN probe_state := SQLSTATE;
  END;
  IF probe_state <> 'check_violation' THEN
    RAISE EXCEPTION
      'a house row decided by another house was not refused by bid_house_row_is_decided_by_its_house (outcome: %)',
      probe_state;
  END IF;
  IF probe_constraint IS DISTINCT FROM 'bid_house_row_is_decided_by_its_house' THEN
    RAISE EXCEPTION
      'the probe row was refused by check constraint %, not bid_house_row_is_decided_by_its_house, so that CHECK is unproved',
      coalesce(probe_constraint, '(unnamed)');
  END IF;

  SELECT count(*) INTO decisions_after FROM public.beverage_identity_decisions;
  IF decisions_after <> decisions_before THEN
    RAISE EXCEPTION 'the probe wrote rows: decisions % -> %', decisions_before, decisions_after;
  END IF;

  RAISE NOTICE 'deciding_restaurant_id added (nullable uuid, FK restaurants ON DELETE RESTRICT), house-row CHECK body matched and proved by name against a mismatched insert, RLS still on, no net rows written (decisions % -> %).', decisions_before, decisions_after;
END
$$;

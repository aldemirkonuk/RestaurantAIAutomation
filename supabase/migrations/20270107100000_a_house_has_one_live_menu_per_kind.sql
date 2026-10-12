-- A HOUSE HAS ONE LIVE MENU PER KIND (ADR 0340 rules 1, 2, 4, 5, 13, 17, 22;
-- founder answer S208, sim ledger, with S198/S202 as sources).
--
-- Lane 1 of the menus build (sim-run/arch/menus-lanes.md). The schema only: no
-- gateway route reads or writes the new columns yet, and the gateway still
-- files every upload as 'beverage', status 'draft' written explicitly
-- (menus.service.ts createVersion). No screen can make a second kind live
-- after this file; that state is reachable by SQL only until lanes 2-3c.
--
-- WHAT THIS FILE DOES
-- 1. restaurant_menus.menu_type accepts 'desserts' (ADR 0340 F1: 'dessert'
--    already means a dessert WINE in the drink vocabulary). The legacy
--    'full', 'bar' and 'events' stay in the CHECK so any existing row still
--    validates; make_menu_current and make_menus_current refuse them
--    (a_menu_is_made_current_per_kind). DROP, ADD NOT VALID, VALIDATE: a
--    brief ACCESS EXCLUSIVE, then a scan under SHARE UPDATE EXCLUSIVE.
-- 2. A fail-loud check BEFORE the index: if any house holds two active menus
--    of one kind, or any active menu of a legacy kind, the migration RAISES
--    with the counts and applies nothing (one transaction). It never archives
--    a menu itself: that would pick a winner on rows nobody has looked at
--    (ADR 0340 F7). The cleanup is a person choosing through
--    make_menu_current, then the deploy is re-run. Gate G0 (a production
--    read, on the founder's word) measures this in the hour before merge.
-- 3. restaurant_menus_one_active_per_kind: a partial UNIQUE index on
--    (restaurant_id, menu_type) WHERE status = 'active'. It reverses ADR 0193
--    round 2's "no unique index" choice (20260922230700:68-73), as ADR 0340
--    rule 2 amends it. Not deferrable: make_menu_current archives before it
--    activates, so the index holds after every statement.
-- 4. status DEFAULT 'draft' (was 'active', baseline :5135). Every writer
--    measured at 0266eee31 names its status: menus.service.ts createVersion
--    ('draft'), the baseline seed RPC (:1560-1568) and scripts/synth/seed.py
--    (:630-634). A row inserted without a status is now a draft, never the
--    house's live menu by accident.
-- 5. New columns on restaurant_menus, all NULL and not defaulted:
--      read_together_id  links the drafts one upload produced (rule 13);
--      part_read         why the read is partial (rule 17; replaces the
--                        name prefix for new rows, legacy names still parse);
--      carried_at        when this menu's per-line carry finished (rule 4).
--                        NULL on a live menu = the carry is not finished,
--                        and a retry may run it again. Cleared on every
--                        activation by the make-current functions.
-- 6. restaurants.menu_kind_order: the order kinds show on the Full menu
--    (rule 22). NULL = the default order (Drinks, Food, Desserts); otherwise
--    exactly a permutation of the three kinds.
-- 7. UNIQUE (id, restaurant_id) on restaurant_menus: the target of
--    menu_sections' composite house FK (a_menu_keeps_the_houses_own_sections).
--
-- Writes no row. Re-runnable.

-- ---------------------------------------------------------------------------
-- 1. 'desserts' is a menu kind.
-- ---------------------------------------------------------------------------
ALTER TABLE public.restaurant_menus
  DROP CONSTRAINT IF EXISTS restaurant_menus_menu_type_check;
ALTER TABLE public.restaurant_menus
  ADD CONSTRAINT restaurant_menus_menu_type_check
  CHECK (menu_type IN ('beverage', 'food', 'desserts', 'full', 'bar', 'events')) NOT VALID;
ALTER TABLE public.restaurant_menus
  VALIDATE CONSTRAINT restaurant_menus_menu_type_check;

COMMENT ON COLUMN public.restaurant_menus.menu_type IS
  'The menu kind (ADR 0340): beverage (shown as Drinks), food, desserts. At most one active menu per house per kind (restaurant_menus_one_active_per_kind). full, bar and events are legacy values kept so old rows validate; neither make-current function will make one live.';

-- ---------------------------------------------------------------------------
-- 2. Refuse, loudly, a house the index cannot hold.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_dup_houses  integer;
  v_dup_rows    integer;
  v_legacy_live integer;
BEGIN
  SELECT count(*), coalesce(sum(n), 0)
    INTO v_dup_houses, v_dup_rows
    FROM (SELECT restaurant_id, menu_type, count(*) AS n
            FROM public.restaurant_menus
           WHERE status = 'active'
           GROUP BY restaurant_id, menu_type
          HAVING count(*) > 1) d;

  SELECT count(*) INTO v_legacy_live
    FROM public.restaurant_menus
   WHERE status = 'active'
     AND menu_type IN ('full', 'bar', 'events');

  IF v_dup_houses > 0 OR v_legacy_live > 0 THEN
    RAISE EXCEPTION 'a_house_has_one_live_menu_per_kind: % house-kind pair(s) hold % active menus between them, and % active menu(s) are of a legacy kind (full, bar, events). Nothing was applied. A person chooses which menu stays current through make_menu_current; then re-run the deploy (ADR 0340 F7).',
      v_dup_houses, v_dup_rows, v_legacy_live
      USING ERRCODE = '23505';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 3. One live menu per house per kind, held by the database.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS restaurant_menus_one_active_per_kind
  ON public.restaurant_menus (restaurant_id, menu_type)
  WHERE status = 'active';

COMMENT ON INDEX public.restaurant_menus_one_active_per_kind IS
  'ADR 0340 rule 2 (amending ADR 0193 round-2 item 7): a house has at most one active menu of each kind. make_menu_current and make_menus_current archive before they activate, so the index holds after every statement.';

-- ---------------------------------------------------------------------------
-- 4. A new menu is a draft unless its writer says otherwise.
-- ---------------------------------------------------------------------------
ALTER TABLE public.restaurant_menus
  ALTER COLUMN status SET DEFAULT 'draft';

-- ---------------------------------------------------------------------------
-- 5. Batch, partial-read and carry columns.
-- ---------------------------------------------------------------------------
ALTER TABLE public.restaurant_menus
  ADD COLUMN IF NOT EXISTS read_together_id uuid,
  ADD COLUMN IF NOT EXISTS part_read text,
  ADD COLUMN IF NOT EXISTS carried_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'restaurant_menus_part_read_says_why'
                    AND conrelid = to_regclass('public.restaurant_menus')) THEN
    ALTER TABLE public.restaurant_menus
      ADD CONSTRAINT restaurant_menus_part_read_says_why
      CHECK (part_read IS NULL OR btrim(part_read) <> '');
  END IF;
  -- A carry finishes only on a menu that was made current.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'restaurant_menus_carried_after_made_current'
                    AND conrelid = to_regclass('public.restaurant_menus')) THEN
    ALTER TABLE public.restaurant_menus
      ADD CONSTRAINT restaurant_menus_carried_after_made_current
      CHECK (carried_at IS NULL OR made_current_at IS NOT NULL);
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_restaurant_menus_read_together
  ON public.restaurant_menus (read_together_id)
  WHERE read_together_id IS NOT NULL;

COMMENT ON COLUMN public.restaurant_menus.read_together_id IS
  'ADR 0340 rule 13: the drafts one upload produced share this id (one draft per kind found). NULL = read on its own, or read before ADR 0340.';
COMMENT ON COLUMN public.restaurant_menus.part_read IS
  'ADR 0340 rule 17: why this read is partial (pages or sections not read). NULL = read whole, or a legacy row whose name carries the old part-read prefix.';
COMMENT ON COLUMN public.restaurant_menus.carried_at IS
  'ADR 0340 rule 4: when the per-line carry of this menu finished after it was made current. NULL on an active menu = the carry is not finished and may be re-run, dated at made_current_at. Cleared by make_menu_current / make_menus_current on every activation.';

-- ---------------------------------------------------------------------------
-- 6. The house's order of kinds on the Full menu.
-- ---------------------------------------------------------------------------
ALTER TABLE public.restaurants
  ADD COLUMN IF NOT EXISTS menu_kind_order text[];

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'restaurants_menu_kind_order_is_the_three_kinds'
                    AND conrelid = to_regclass('public.restaurants')) THEN
    ALTER TABLE public.restaurants
      ADD CONSTRAINT restaurants_menu_kind_order_is_the_three_kinds
      CHECK (menu_kind_order IS NULL
             OR (cardinality(menu_kind_order) = 3
                 AND menu_kind_order @> ARRAY['beverage', 'food', 'desserts']::text[]
                 AND menu_kind_order <@ ARRAY['beverage', 'food', 'desserts']::text[]));
  END IF;
END
$$;

COMMENT ON COLUMN public.restaurants.menu_kind_order IS
  'ADR 0340 rule 22: the order of menu kinds on the Full menu, a permutation of beverage, food, desserts. NULL = the default order (Drinks, Food, Desserts).';

-- ---------------------------------------------------------------------------
-- 7. A menu id names its house: the target of the sections' house FK.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'restaurant_menus_id_restaurant_id_key'
                    AND conrelid = to_regclass('public.restaurant_menus')) THEN
    ALTER TABLE public.restaurant_menus
      ADD CONSTRAINT restaurant_menus_id_restaurant_id_key UNIQUE (id, restaurant_id);
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- Assertions (catalogue reads only).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_index i
                  WHERE i.indexrelid = to_regclass('public.restaurant_menus_one_active_per_kind')
                    AND i.indisunique AND i.indisvalid
                    AND pg_get_expr(i.indpred, i.indrelid) LIKE '%status = ''active''%') THEN
    RAISE EXCEPTION 'restaurant_menus_one_active_per_kind is missing, not unique, invalid or not partial on status';
  END IF;
  IF (SELECT column_default FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'restaurant_menus'
         AND column_name = 'status') NOT LIKE '''draft''%' THEN
    RAISE EXCEPTION 'restaurant_menus.status does not default to draft';
  END IF;
END
$$;

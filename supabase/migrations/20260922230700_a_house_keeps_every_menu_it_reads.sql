-- A house keeps every menu it reads: the source, the extracted lines, when it
-- was read and by whom, whether it is the current menu, and which one was used
-- last. Choosing the current menu is an owner's or a manager's act.
--
-- THE FOUNDER, 2026-09-21, relayed (ADR 0193, answer 7, "menu versions", the
-- gist of his words): newest scan wins; an OPTIONAL cadence tag (weekly /
-- monthly / quarterly / yearly / none) and an optional date (a day, or just a
-- month); keep ALL menu extractions - the source PDF/photo and the extracted
-- lines, with a vector embedding for later search - accessible over time; a
-- "current menu" and the "last one used"; after a photo + extraction the
-- person chooses whether it becomes the current default menu or not; either
-- way the extraction is kept as ML data. Connecting Drive/Notion-like storage
-- is a later option (recorded, not built).
-- ---------------------------------------------------------------------------
-- THE STORE IS THE EXISTING TABLE. `restaurant_menus` (baseline :5128) is
-- already one row per menu with `status` in (active, draft, archived) and RLS
-- on; `menu_items` (baseline :3783) already hangs each line off its menu. What
-- was missing is everything that makes a row a VERSION: the gateway reused the
-- one `active` row for every import and appended lines to it, so a re-scan was
-- indistinguishable from the menu it replaced, its source was never kept, and
-- no row said when a menu stopped being the one in use. So:
--
--   status 'active'   = the current menu (at most one per house, enforced by
--                       make_menu_current below, which archives every other);
--   status 'draft'    = read and kept, never chosen (the ML-data case);
--   status 'archived' = was current once; `retired_at` says until when, and
--                       the one with the latest `retired_at` is the "last one
--                       used".
--
-- COLUMNS ON restaurant_menus (all nullable, none defaulted; legacy rows keep
-- NULL, which reads "not recorded", never a guess):
--   cadence              optional tag: weekly | monthly | quarterly | yearly
--                        | none. NULL = the person did not tag it.
--   menu_date            optional date the menu is FOR ...
--   menu_date_precision  ... 'day' or 'month' (a month is stored as its 1st).
--   source_method        scan | csv | manual - how it was read.
--   source_path          where the source file is kept (the private
--                        `vendor-attachments` bucket the gateway already uses
--                        for original bytes, under <house>/menus/<sha256>).
--   source_sha256, source_mime, source_bytes - what was kept.
--   source_failure       why the source was NOT kept, when the write failed.
--                        A scan or CSV version has one or the other (CHECK):
--                        a lost file is said, never implied.
--   extraction           the parser's lines exactly as read (jsonb array),
--                        immutable ML data; `menu_items` holds the resolved,
--                        editable copy.
--   lines_extracted      how many lines the parser returned (counted here,
--                        so a list of menus never has to aggregate).
--   extracted_by/_at     who read it and when (FK public.users, RESTRICT).
--   made_current_by/_at  who chose it as current and when.
--   retired_by/_at       who replaced it as current and when.
--
-- COLUMNS ON menu_items:
--   price_flag / price_flag_note - a line whose menu price was blank for a
--     price the house already has: the house keeps its last known price and
--     the line is FLAGGED so a manager can look (founder answer 3). Written
--     only when the menu becomes current (make_menu_current's caller).
--   embedding vector(384) + embedding_model - for later search. 384 and
--     all-MiniLM-L6-v2 are the repo's existing embedding path
--     (scripts/populate_embeddings.py, master_wine_library.embedding,
--     beverages.embedding). NULL until that script embeds the line; nothing
--     here writes a vector, and a NULL vector is "not embedded yet", never a
--     zero vector.
--
-- ACTOR FKs go to public.users(user_id), never auth.users (disjoint tables;
-- the JWT carries public.users.user_id).
--
-- NO UNIQUE INDEX on (restaurant_id) WHERE status = 'active'. Production may
-- already hold two active menus for one house (nothing ever prevented it), and
-- this migration will not run a data-dependent DDL it cannot measure first.
-- make_menu_current archives EVERY other active menu of the house under a row
-- lock, so the invariant holds from the first choice on.
--
-- Additive and idempotent. Writes no row.

ALTER TABLE public.restaurant_menus
  ADD COLUMN IF NOT EXISTS cadence TEXT,
  ADD COLUMN IF NOT EXISTS menu_date DATE,
  ADD COLUMN IF NOT EXISTS menu_date_precision TEXT,
  ADD COLUMN IF NOT EXISTS source_method TEXT,
  ADD COLUMN IF NOT EXISTS source_path TEXT,
  ADD COLUMN IF NOT EXISTS source_sha256 TEXT,
  ADD COLUMN IF NOT EXISTS source_mime TEXT,
  ADD COLUMN IF NOT EXISTS source_bytes INTEGER,
  ADD COLUMN IF NOT EXISTS source_failure TEXT,
  ADD COLUMN IF NOT EXISTS extraction JSONB,
  ADD COLUMN IF NOT EXISTS lines_extracted INTEGER,
  ADD COLUMN IF NOT EXISTS extracted_by UUID
    REFERENCES public.users(user_id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS extracted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS made_current_by UUID
    REFERENCES public.users(user_id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS made_current_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS retired_by UUID
    REFERENCES public.users(user_id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS retired_at TIMESTAMPTZ;

ALTER TABLE public.menu_items
  ADD COLUMN IF NOT EXISTS price_flag TEXT,
  ADD COLUMN IF NOT EXISTS price_flag_note TEXT,
  ADD COLUMN IF NOT EXISTS embedding vector(384),
  ADD COLUMN IF NOT EXISTS embedding_model TEXT;

COMMENT ON COLUMN public.restaurant_menus.cadence IS
  'Optional tag the person gave this menu: weekly | monthly | quarterly | yearly | none. NULL = not tagged (founder, 2026-09-21, ADR 0193).';
COMMENT ON COLUMN public.restaurant_menus.menu_date IS
  'Optional date this menu is for; a month-only date is stored as the 1st with menu_date_precision = month. Not used to date prices: the newest SCAN wins (ADR 0193).';
COMMENT ON COLUMN public.restaurant_menus.source_path IS
  'Object path of the kept source file in the private vendor-attachments bucket (<restaurant_id>/menus/<sha256>.<ext>). NULL with source_failure set when the write failed.';
COMMENT ON COLUMN public.restaurant_menus.extraction IS
  'The parser''s lines exactly as read, kept whether or not this menu was ever made current (ML data, ADR 0193). menu_items holds the resolved, editable copy.';
COMMENT ON COLUMN public.restaurant_menus.retired_at IS
  'When this menu stopped being the current one. The archived menu with the latest retired_at is the house''s "last one used".';
COMMENT ON COLUMN public.menu_items.price_flag IS
  'blank_kept_last_known: the line showed no price for a kind the house already prices, so the house kept its last known price and the line is flagged for a manager (founder, 2026-09-21, ADR 0193). NULL = nothing unclear.';
COMMENT ON COLUMN public.menu_items.embedding IS
  'all-MiniLM-L6-v2 (384) embedding of the line, written by scripts/populate_embeddings.py; NULL = not embedded yet. Never a placeholder vector.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'restaurant_menus_cadence_check'
                    AND conrelid = to_regclass('public.restaurant_menus')) THEN
    ALTER TABLE public.restaurant_menus
      ADD CONSTRAINT restaurant_menus_cadence_check
      CHECK (cadence IS NULL
             OR cadence IN ('weekly', 'monthly', 'quarterly', 'yearly', 'none'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'restaurant_menus_menu_date_is_a_day_or_a_month'
                    AND conrelid = to_regclass('public.restaurant_menus')) THEN
    ALTER TABLE public.restaurant_menus
      ADD CONSTRAINT restaurant_menus_menu_date_is_a_day_or_a_month
      -- Every branch is written so no term can be NULL: a CHECK passes on
      -- NULL, and "a date with no precision" must be refused, not unknown.
      CHECK (
        (menu_date IS NULL AND menu_date_precision IS NULL)
        OR (menu_date IS NOT NULL AND menu_date_precision IS NOT NULL
            AND (menu_date_precision = 'day'
                 OR (menu_date_precision = 'month' AND extract(day FROM menu_date) = 1)))
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'restaurant_menus_source_method_check'
                    AND conrelid = to_regclass('public.restaurant_menus')) THEN
    ALTER TABLE public.restaurant_menus
      ADD CONSTRAINT restaurant_menus_source_method_check
      CHECK (source_method IS NULL OR source_method IN ('scan', 'csv', 'manual'));
  END IF;

  -- A scan or CSV version either kept its source or says why not.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'restaurant_menus_source_is_kept_or_said'
                    AND conrelid = to_regclass('public.restaurant_menus')) THEN
    ALTER TABLE public.restaurant_menus
      ADD CONSTRAINT restaurant_menus_source_is_kept_or_said
      CHECK (
        source_method IS NULL
        OR source_method = 'manual'
        OR (source_path IS NOT NULL AND source_sha256 IS NOT NULL)
        OR source_failure IS NOT NULL
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'restaurant_menus_acts_name_their_author'
                    AND conrelid = to_regclass('public.restaurant_menus')) THEN
    ALTER TABLE public.restaurant_menus
      ADD CONSTRAINT restaurant_menus_acts_name_their_author
      CHECK (
        (extracted_by IS NULL) = (extracted_at IS NULL)
        AND (made_current_by IS NULL) = (made_current_at IS NULL)
        AND (retired_by IS NULL) = (retired_at IS NULL)
        AND (lines_extracted IS NULL OR lines_extracted >= 0)
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'menu_items_price_flag_check'
                    AND conrelid = to_regclass('public.menu_items')) THEN
    ALTER TABLE public.menu_items
      ADD CONSTRAINT menu_items_price_flag_check
      CHECK (
        (price_flag IS NULL AND price_flag_note IS NULL)
        OR (price_flag = 'blank_kept_last_known' AND price_flag_note IS NOT NULL)
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'menu_items_embedding_names_its_model'
                    AND conrelid = to_regclass('public.menu_items')) THEN
    ALTER TABLE public.menu_items
      ADD CONSTRAINT menu_items_embedding_names_its_model
      CHECK ((embedding IS NULL) = (embedding_model IS NULL));
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_restaurant_menus_retired
  ON public.restaurant_menus (restaurant_id, retired_at DESC);

-- ---------------------------------------------------------------------------
-- make_menu_current: the one writer of "which menu is current".
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.make_menu_current(
  p_restaurant_id uuid,
  p_menu_id       uuid,
  p_actor         uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_menu     record;
  v_previous uuid[];
BEGIN
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'make_menu_current: choosing the current menu names the person who chose it (actor is NULL); nothing was changed'
      USING ERRCODE = '22023';
  END IF;

  -- Serialise two choices for one house: the house row is the lock.
  PERFORM 1 FROM public.restaurants WHERE id = p_restaurant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'make_menu_current: no restaurant %; nothing was changed', p_restaurant_id
      USING ERRCODE = 'P0002';
  END IF;

  SELECT id, status
    INTO v_menu
    FROM public.restaurant_menus
   WHERE id = p_menu_id
     AND restaurant_id = p_restaurant_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'make_menu_current: no menu % in house %; nothing was changed', p_menu_id, p_restaurant_id
      USING ERRCODE = 'P0002';
  END IF;

  IF v_menu.status = 'active'
     AND NOT EXISTS (SELECT 1 FROM public.restaurant_menus
                      WHERE restaurant_id = p_restaurant_id
                        AND status = 'active'
                        AND id <> p_menu_id) THEN
    RETURN jsonb_build_object('outcome', 'already_current', 'menu_id', p_menu_id,
                              'previous_menu_ids', '[]'::jsonb);
  END IF;

  -- Every other active menu of the house stops being current, now, by this person.
  WITH retired AS (
    UPDATE public.restaurant_menus
       SET status = 'archived',
           retired_at = now(),
           retired_by = p_actor
     WHERE restaurant_id = p_restaurant_id
       AND status = 'active'
       AND id <> p_menu_id
    RETURNING id
  )
  SELECT coalesce(array_agg(id), '{}') INTO v_previous FROM retired;

  UPDATE public.restaurant_menus
     SET status = 'active',
         made_current_at = now(),
         made_current_by = p_actor,
         retired_at = NULL,
         retired_by = NULL
   WHERE id = p_menu_id
     AND restaurant_id = p_restaurant_id;

  RETURN jsonb_build_object('outcome', 'made_current', 'menu_id', p_menu_id,
                            'previous_menu_ids', to_jsonb(v_previous));
END
$$;

COMMENT ON FUNCTION public.make_menu_current(uuid, uuid, uuid) IS
  'ADR 0193 (menu versions): the one writer of which menu is current. House-scoped (P0002 otherwise), names its actor (22023 otherwise), locks the house row, archives every other active menu of the house with retired_at/retired_by, and stamps made_current_at/by on the chosen one. The gateway checks owner/manager before calling it and carries the menu''s prices afterwards.';

REVOKE ALL ON FUNCTION public.make_menu_current(uuid, uuid, uuid) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.make_menu_current(uuid, uuid, uuid) FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.make_menu_current(uuid, uuid, uuid) FROM authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.make_menu_current(uuid, uuid, uuid) TO service_role';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- Assert the outcome. Catalog reads, and counts that must be zero.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  n BIGINT;
BEGIN
  IF (SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'restaurant_menus'
         AND column_name IN ('cadence', 'menu_date', 'menu_date_precision', 'source_method',
                             'source_path', 'source_sha256', 'source_mime', 'source_bytes',
                             'source_failure', 'extraction', 'lines_extracted',
                             'extracted_by', 'extracted_at', 'made_current_by',
                             'made_current_at', 'retired_by', 'retired_at')
         AND column_default IS NULL) <> 17 THEN
    RAISE EXCEPTION 'the seventeen menu-version columns are not all present without a default';
  END IF;

  IF (SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'menu_items'
         AND column_name IN ('price_flag', 'price_flag_note', 'embedding', 'embedding_model')
         AND column_default IS NULL) <> 4 THEN
    RAISE EXCEPTION 'the four menu_items columns are not all present without a default';
  END IF;

  IF (SELECT count(DISTINCT att.attname)
        FROM pg_constraint con
        JOIN pg_attribute att
          ON att.attrelid = con.conrelid AND att.attnum = ANY (con.conkey)
       WHERE con.conrelid = to_regclass('public.restaurant_menus')
         AND con.contype = 'f'
         AND att.attname IN ('extracted_by', 'made_current_by', 'retired_by')
         AND con.confrelid = to_regclass('public.users')) <> 3 THEN
    RAISE EXCEPTION 'a menu-version actor column does not reference public.users';
  END IF;

  IF to_regprocedure('public.make_menu_current(uuid, uuid, uuid)') IS NULL THEN
    RAISE EXCEPTION 'make_menu_current was not created';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc
              WHERE oid = to_regprocedure('public.make_menu_current(uuid, uuid, uuid)')
                AND prosecdef) THEN
    RAISE EXCEPTION 'make_menu_current is SECURITY DEFINER; it must not be';
  END IF;

  SELECT count(*) INTO n FROM public.restaurant_menus
   WHERE cadence IS NOT NULL OR menu_date IS NOT NULL OR source_method IS NOT NULL
      OR extracted_by IS NOT NULL OR made_current_by IS NOT NULL OR retired_by IS NOT NULL;
  IF n <> 0 THEN
    RAISE EXCEPTION 'this migration wrote % menu-version values; it must write none', n;
  END IF;
  SELECT count(*) INTO n FROM public.menu_items
   WHERE price_flag IS NOT NULL OR embedding IS NOT NULL;
  IF n <> 0 THEN
    RAISE EXCEPTION 'this migration wrote % menu-line flags or vectors; it must write none', n;
  END IF;

  RAISE NOTICE 'menu versions: 17 columns on restaurant_menus, 4 on menu_items, no defaults, actor FKs to public.users, make_menu_current (invoker), zero rows written';
END
$$;

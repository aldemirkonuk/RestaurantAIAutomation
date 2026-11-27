-- A menu read runs in the background (founder, 2026-11-07: "Background job").
--
-- A scan used to be read inside the request. The web client gives up after
-- 30 seconds and a many-page menu takes longer, so the browser said "failed"
-- while the server went on reading and kept a version nobody was shown.
-- Now POST /menus/import keeps the file and a draft version at once, answers
-- with its id, and the read finishes on the server. The version says where
-- the read stands:
--
--   read_state   'reading' while the server reads it; 'done' once its lines
--                are kept; 'failed' when the read ended without a line or with
--                an error. Every version read before this column is 'done'.
--   read_failure the sentence a failed read ends with (required when failed).
--   read_reply   what the import would have answered had it waited: the lines
--                as resolved against the library. A page that comes back later
--                shows exactly what the person would have seen.
--
-- Only a finished read can be the current menu (CHECK below), so neither a
-- half-read nor a failed version can ever be made current, whatever calls it.
-- The index serves "this exact file was already read" (same bytes reopen the
-- version they made, unless the person asks to read it again).

ALTER TABLE public.restaurant_menus
  ADD COLUMN IF NOT EXISTS read_state TEXT NOT NULL DEFAULT 'done',
  ADD COLUMN IF NOT EXISTS read_failure TEXT,
  ADD COLUMN IF NOT EXISTS read_reply JSONB;

COMMENT ON COLUMN public.restaurant_menus.read_state IS
  'reading | done | failed. A scan is read in the background; reading = the server is still reading it. Only a done read may be active.';
COMMENT ON COLUMN public.restaurant_menus.read_failure IS
  'Why a failed read ended, in the words the person is shown. Required when read_state = failed.';
COMMENT ON COLUMN public.restaurant_menus.read_reply IS
  'The import reply of a background read (lines as resolved), so a page that comes back shows what the read found.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'restaurant_menus_read_state_check'
                    AND conrelid = to_regclass('public.restaurant_menus')) THEN
    ALTER TABLE public.restaurant_menus
      ADD CONSTRAINT restaurant_menus_read_state_check
      CHECK (read_state IN ('reading', 'done', 'failed'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'restaurant_menus_failed_read_says_why'
                    AND conrelid = to_regclass('public.restaurant_menus')) THEN
    ALTER TABLE public.restaurant_menus
      ADD CONSTRAINT restaurant_menus_failed_read_says_why
      CHECK (read_state <> 'failed' OR read_failure IS NOT NULL);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'restaurant_menus_only_a_finished_read_is_current'
                    AND conrelid = to_regclass('public.restaurant_menus')) THEN
    ALTER TABLE public.restaurant_menus
      ADD CONSTRAINT restaurant_menus_only_a_finished_read_is_current
      CHECK (status IS DISTINCT FROM 'active' OR read_state = 'done');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'restaurant_menus_read_reply_is_an_object'
                    AND conrelid = to_regclass('public.restaurant_menus')) THEN
    ALTER TABLE public.restaurant_menus
      ADD CONSTRAINT restaurant_menus_read_reply_is_an_object
      CHECK (read_reply IS NULL OR jsonb_typeof(read_reply) = 'object');
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_restaurant_menus_source_sha
  ON public.restaurant_menus (restaurant_id, source_sha256)
  WHERE source_sha256 IS NOT NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.restaurant_menus WHERE read_state <> 'done') THEN
    RAISE EXCEPTION 'every menu read before this migration must read as done';
  END IF;
END
$$;

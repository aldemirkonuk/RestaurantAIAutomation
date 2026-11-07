-- restaurant_menus.read_warnings (proposal-menu step 1c, ADR 0213 #17).
-- A scan whose page range errored, or whose reply was cut off, said so only in
-- the server log. This column holds those two kinds and nothing else: pages
-- past the 120-page cap and an unparseable model reply are not recorded here.
-- `extraction` keeps its shape (lines as read). Nullable, no default, no
-- backfill. Ships before the gateway change that writes and selects it.

ALTER TABLE public.restaurant_menus
  ADD COLUMN IF NOT EXISTS read_warnings JSONB;

COMMENT ON COLUMN public.restaurant_menus.read_warnings IS
  '[{kind: truncated | chunk_failed, pages: {first, last} | null}]. [] = no page range errored and no reply was cut off; it does not cover pages past the 120-page cap or an unparseable reply. NULL = read before this column.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'restaurant_menus_read_warnings_is_an_array'
                    AND conrelid = to_regclass('public.restaurant_menus')) THEN
    ALTER TABLE public.restaurant_menus
      ADD CONSTRAINT restaurant_menus_read_warnings_is_an_array
      CHECK (read_warnings IS NULL OR jsonb_typeof(read_warnings) = 'array');
  END IF;
END
$$;

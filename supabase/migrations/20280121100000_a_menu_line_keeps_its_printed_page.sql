-- r110 menu-g4: a menu line keeps the page of the kept file it is printed on.
--
-- The review's source pane opened a 20-page PDF at page 1 and the reviewer
-- hunted for the line. The reader now names each line's page; the gateway
-- adds a chunk's offset (scan-parser placeOnPage) and drops a page outside
-- the chunk to NULL. A CSV or typed line has no page and stays NULL, as do
-- lines read before this.
--
-- Named printed_page, not source_page: source_page is already a public enum
-- type (baseline_from_production.sql). Bounded 1..200 so a stray model
-- number can never become a page link past any menu this house would send.
ALTER TABLE public.menu_items
  ADD COLUMN IF NOT EXISTS printed_page SMALLINT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'menu_items_printed_page_is_a_page'
                    AND conrelid = to_regclass('public.menu_items')) THEN
    ALTER TABLE public.menu_items
      ADD CONSTRAINT menu_items_printed_page_is_a_page
      CHECK (printed_page IS NULL OR printed_page BETWEEN 1 AND 200);
  END IF;
END
$$;

COMMENT ON COLUMN public.menu_items.printed_page IS
  'The 1-based page of the kept menu file this line is printed on, as the reader named it, offset by its chunk''s first page. NULL for a CSV or typed line, a single photo, a page outside its chunk, or a line read before r110 menu-g4.';

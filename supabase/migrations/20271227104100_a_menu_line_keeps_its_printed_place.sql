-- r108 menu-g14: a menu line keeps the place it was printed in.
--
-- Until now menu_items had no position, and every reader paged and returned
-- the lines in uuid order, so the review and the current menu listed a menu
-- in an order no menu was ever printed in. line_no is the line's place in the
-- read that made it: the parse index (0..n-1) for a scan or a CSV, and the
-- menu's last place + 1 for a line typed in by hand.
--
-- Old rows stay NULL and are read after the numbered ones, by id. Readers
-- still page on id (keyset, PAGE_ROWS 1000) and sort (line_no NULLS LAST, id)
-- AFTER the whole read, so the 1000-row cap is unchanged; line_no is not
-- unique (two typed adds at once can share one; id breaks the tie), which is
-- why it is never a paging key.
ALTER TABLE public.menu_items
  ADD COLUMN IF NOT EXISTS line_no INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'menu_items_line_no_is_a_place'
                    AND conrelid = to_regclass('public.menu_items')) THEN
    ALTER TABLE public.menu_items
      ADD CONSTRAINT menu_items_line_no_is_a_place CHECK (line_no IS NULL OR line_no >= 0);
  END IF;
END
$$;

COMMENT ON COLUMN public.menu_items.line_no IS
  'The line''s place on the menu as printed: the parse index (0..n-1) of the scan or CSV read that made it, or the menu''s last place + 1 for a line typed in by hand. NULL for a line made before r108 menu-g14; such lines are read after the numbered ones, by id.';

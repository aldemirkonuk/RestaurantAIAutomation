-- r108 menu-g10: a menu line keeps its printed description and the dietary
-- or allergen marks the menu itself prints beside it.
--
-- printed_marks holds only what the menu PRINTS (a legend symbol or words:
-- V, VG, GF, a chilli, "contains nuts"), never a mark worked out from the
-- dish's name: a wrong "no nuts" is a safety harm. The gateway keeps a mark
-- only when its token appears in the line's own raw text, so this column is
-- never an inference. NULL = the line prints no mark (or the read could not
-- show one); it never means "free of".
ALTER TABLE public.menu_items
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS printed_marks TEXT[];

-- A CHECK cannot hold a subquery, so the per-mark rule is an immutable
-- function: at most 12 marks, each 1 to 40 characters, none NULL.
CREATE OR REPLACE FUNCTION public.menu_printed_marks_fit(marks TEXT[])
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT marks IS NULL
      OR (pg_catalog.cardinality(marks) BETWEEN 1 AND 12
          AND NOT EXISTS (
            SELECT 1 FROM pg_catalog.unnest(marks) AS m(v)
             WHERE m.v IS NULL OR pg_catalog.char_length(m.v) NOT BETWEEN 1 AND 40
          ));
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'menu_items_printed_marks_fit'
                    AND conrelid = to_regclass('public.menu_items')) THEN
    ALTER TABLE public.menu_items
      ADD CONSTRAINT menu_items_printed_marks_fit CHECK (public.menu_printed_marks_fit(printed_marks));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'menu_items_description_is_short'
                    AND conrelid = to_regclass('public.menu_items')) THEN
    ALTER TABLE public.menu_items
      ADD CONSTRAINT menu_items_description_is_short
      CHECK (description IS NULL OR pg_catalog.char_length(description) BETWEEN 1 AND 1000);
  END IF;
END
$$;

COMMENT ON COLUMN public.menu_items.description IS
  'The line''s description as the menu prints it (r108 menu-g10), at most 1000 characters. NULL = none printed.';
COMMENT ON COLUMN public.menu_items.printed_marks IS
  'Dietary or allergen marks the menu PRINTS beside the line, as printed (r108 menu-g10): kept only when the mark appears in the line''s raw text, never inferred from the name. NULL = no printed mark; never "free of".';

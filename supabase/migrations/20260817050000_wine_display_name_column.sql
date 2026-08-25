-- Plan §1 continued: the display_name COLUMN, maintained by the existing
-- search_vector trigger rather than a second one, and added to
-- search_vector itself. Vintage is currently NOT searchable at all —
-- searching "2016 Gravner" matches nothing today, because
-- master_wine_library_set_search_vector never indexed it.

ALTER TABLE public.master_wine_library
  ADD COLUMN IF NOT EXISTS display_name text;

COMMENT ON COLUMN public.master_wine_library.display_name IS
  'Derived full descriptive name via wine_display_name(). NEVER a match '
  'key -- name/normalized_name still are. Auto-maintained by '
  'master_wine_library_set_search_vector on every insert/update. '
  'See plan §1 and wine_display_name()''s own comment for the algorithm.';

CREATE OR REPLACE FUNCTION public.master_wine_library_set_search_vector()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
    NEW.display_name := public.wine_display_name(
        NEW.vintage, NEW.producer, NEW.name, NEW.region, NEW.country
    );
    NEW.search_vector :=
        to_tsvector('english',
            COALESCE(NEW.name, '') || ' ' ||
            COALESCE(NEW.producer, '') || ' ' ||
            COALESCE(NEW.region, '') || ' ' ||
            COALESCE(NEW.grape_variety, '') || ' ' ||
            -- Vintage was never indexed at all before this migration —
            -- searching "2016 Gravner" matched nothing. display_name
            -- already carries it as text, so this is additive, not a new
            -- concept: to_tsvector tokenizes the 4-digit year as its own
            -- lexeme the same way it would any other word.
            COALESCE(NEW.display_name, '')
        );
    RETURN NEW;
END;
$function$;

-- Backfill: existing rows need their trigger-computed columns filled once.
-- Same posture as the identity_status backfill in 20260817030000 — an
-- ordinary UPDATE re-fires the trigger, and since search_vector/display_name
-- are recomputed identically for every row regardless of which columns
-- changed, this necessarily touches all 4,160 rows' updated_at. That is
-- different from that migration's situation (where only ~334 of 4,160
-- needed the flag) -- here EVERY row gets a genuinely new display_name
-- value it didn't have before, so touching updated_at on all of them is the
-- correct side effect of a real, one-time backfill, not collateral damage.
UPDATE public.master_wine_library
   SET updated_at = updated_at
 WHERE deleted_at IS NULL;

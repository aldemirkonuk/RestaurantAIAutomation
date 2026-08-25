-- A12 (register, arch §10.3): sensory data had two homes. Typed columns
-- acidity/tannins/texture/finish/primary_aromas/secondary_aromas/
-- tertiary_aromas were populated on 0 of 3,497 live wine rows; the real
-- values live in wine_structure (JSONB) and sensory_profile (JSONB) --
-- §4.1 violated inside master_wine_library itself. Every pairing filter
-- ("light body, high acidity") and any ML feature extraction had to go
-- through a JSONB scan instead of an index.
--
-- Decision (the register said "choosing matters more than which"):
-- BACKFILL the typed columns and keep them DERIVED from the JSONB via
-- trigger, rather than dropping them. Reasoning: wine_structure/
-- sensory_profile is what enrichment actually writes today
-- (load_enriched_wines.py, wine-submissions.service.ts) -- making the typed
-- columns auto-derived from that write means neither Python nor TypeScript
-- callers need to change, and it is the SAME pattern already established
-- for display_name/identity_status/beverage_kind/enrichment_observed_at:
-- auto-maintained by a trigger, never set by application code, so no
-- future writer can forget to keep them in sync.

CREATE OR REPLACE FUNCTION public.set_wine_sensory_columns()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.acidity := nullif(NEW.wine_structure ->> 'acidity', '');
  NEW.tannins := nullif(NEW.wine_structure ->> 'tannins', '');
  NEW.texture := nullif(NEW.wine_structure ->> 'texture', '');
  NEW.finish  := nullif(NEW.wine_structure ->> 'finish', '');
  NEW.primary_aromas   := NEW.sensory_profile -> 'primary_aromas';
  NEW.secondary_aromas := NEW.sensory_profile -> 'secondary_aromas';
  NEW.tertiary_aromas  := NEW.sensory_profile -> 'tertiary_aromas';
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.set_wine_sensory_columns() IS
  'Derives the typed sensory columns from wine_structure/sensory_profile '
  'JSONB on every insert/update -- one write path (the JSONB), one source '
  'of truth, never diverging. See arch §4.1/§10.3 and register A12.';

DROP TRIGGER IF EXISTS trg_wine_sensory_columns ON public.master_wine_library;
CREATE TRIGGER trg_wine_sensory_columns
  BEFORE INSERT OR UPDATE ON public.master_wine_library
  FOR EACH ROW
  EXECUTE FUNCTION public.set_wine_sensory_columns();

-- Backfill: targeted to rows that actually have JSONB content to derive
-- from, not a blanket touch of every row (same discipline as the
-- identity_status backfill in 20260817030000 -- avoid bumping updated_at
-- on rows this doesn't change).
UPDATE public.master_wine_library
   SET acidity = acidity  -- no-op write; re-fires the trigger above, which
                            -- recomputes all seven columns from the JSONB
 WHERE deleted_at IS NULL
   AND (wine_structure IS NOT NULL AND wine_structure <> '{}'::jsonb
        OR sensory_profile IS NOT NULL AND sensory_profile <> '{}'::jsonb);

-- Index the columns a pairing filter actually queries -- acidity/tannins/
-- texture as discrete style buckets ("light body, high acidity").
CREATE INDEX IF NOT EXISTS idx_master_wine_library_acidity
  ON public.master_wine_library (acidity) WHERE acidity IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_master_wine_library_tannins
  ON public.master_wine_library (tannins) WHERE tannins IS NOT NULL;

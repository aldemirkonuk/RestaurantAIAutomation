-- Premortem audit finding #2: sensory columns (acidity/tannins/texture/
-- finish/primary_aromas/secondary_aromas/tertiary_aromas) were correctly
-- backfilled and kept derived from wine_structure/sensory_profile JSONB
-- (20260817110000), but via a BEFORE INSERT OR UPDATE trigger rather than
-- a generated column. The choice to derive rather than drop was right --
-- audited and confirmed: no malformed-JSON risk (jsonb ->> against any
-- shape returns NULL, never errors), no constraint that can fail, no
-- provenance corruption (enrichment_observed_at's own trigger is already
-- guarded on data_enrichment actually changing), and the JSONB genuinely
-- is the only write path today (checked: load_enriched_wines.py writes
-- only the JSONB blocks, nothing writes the seven scalar columns).
--
-- What was wrong was the MECHANISM. With a trigger,
-- `UPDATE master_wine_library SET acidity = 'high' WHERE id = X` returns
-- `UPDATE 1` and silently discards the value on the next trigger fire --
-- a write that appears to succeed and doesn't, with no error and no log.
-- `GENERATED ALWAYS AS (...) STORED` makes the same statement fail
-- immediately with 42601 ("column can only be updated to DEFAULT") --
-- turning a silent, delayed no-op into an immediate, loud one. Arch §4.1
-- already names this as the intended mechanism for exactly this kind of
-- derived column ("`identity_key`, a generated column"); this migration
-- makes the sensory columns consistent with that stated intent.
--
-- Checked before writing this: no view in this schema selects any of the
-- seven columns (query against pg_depend/pg_rewrite), so nothing needs
-- CASCADE handling. 3,497 live wine rows -- a full table rewrite (which
-- ALTER TABLE ADD COLUMN ... GENERATED ALWAYS does) is sub-second at this
-- size.

DROP TRIGGER IF EXISTS trg_wine_sensory_columns ON public.master_wine_library;
DROP FUNCTION IF EXISTS public.set_wine_sensory_columns();

ALTER TABLE public.master_wine_library
  DROP COLUMN acidity,
  DROP COLUMN tannins,
  DROP COLUMN texture,
  DROP COLUMN finish,
  DROP COLUMN primary_aromas,
  DROP COLUMN secondary_aromas,
  DROP COLUMN tertiary_aromas;

ALTER TABLE public.master_wine_library
  ADD COLUMN acidity text
    GENERATED ALWAYS AS (nullif(wine_structure ->> 'acidity', '')) STORED,
  ADD COLUMN tannins text
    GENERATED ALWAYS AS (nullif(wine_structure ->> 'tannins', '')) STORED,
  ADD COLUMN texture text
    GENERATED ALWAYS AS (nullif(wine_structure ->> 'texture', '')) STORED,
  ADD COLUMN finish text
    GENERATED ALWAYS AS (nullif(wine_structure ->> 'finish', '')) STORED,
  ADD COLUMN primary_aromas jsonb
    GENERATED ALWAYS AS (sensory_profile -> 'primary_aromas') STORED,
  ADD COLUMN secondary_aromas jsonb
    GENERATED ALWAYS AS (sensory_profile -> 'secondary_aromas') STORED,
  ADD COLUMN tertiary_aromas jsonb
    GENERATED ALWAYS AS (sensory_profile -> 'tertiary_aromas') STORED;

COMMENT ON COLUMN public.master_wine_library.acidity IS
  'Generated from wine_structure->>''acidity''. A direct write to this '
  'column errors (42601) instead of silently being discarded -- the '
  'mechanism premortem audit finding #2 (2026-08-18) upgraded from a '
  'BEFORE trigger to this, specifically for that property. See arch §4.1 '
  'and register A12.';

CREATE INDEX IF NOT EXISTS idx_master_wine_library_acidity
  ON public.master_wine_library (acidity) WHERE acidity IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_master_wine_library_tannins
  ON public.master_wine_library (tannins) WHERE tannins IS NOT NULL;

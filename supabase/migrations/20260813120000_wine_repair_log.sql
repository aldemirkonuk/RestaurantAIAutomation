-- Audit trail for corrections applied to master_wine_library field values.
--
-- Distinct from wine_merge_log, which records whole rows collapsing into each
-- other. This records a surviving row having a field rewritten — currently the
-- seed-importer repair, where `producer` named someone who appears nowhere in
-- the wine's own name and `vintage` disagreed with the year printed in it.
--
-- Field-level provenance matters more here than for a merge: a merge is
-- verifiable after the fact by looking at what survived, whereas an
-- overwritten producer leaves no trace of what it replaced. Storing the source
-- string alongside the change is what makes a bad repair reversible.

CREATE TABLE IF NOT EXISTS public.wine_repair_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wine_id       uuid NOT NULL REFERENCES public.master_wine_library(id) ON DELETE CASCADE,
  field_changes jsonb NOT NULL,
  repaired_at   timestamptz NOT NULL DEFAULT now(),
  repaired_by   text
);

COMMENT ON TABLE public.wine_repair_log IS
  'Field-level corrections to master_wine_library. field_changes holds '
  '{field: {from, to}} plus the source string the correction was derived from, '
  'so a bad repair can be traced and reversed.';

CREATE INDEX IF NOT EXISTS idx_wine_repair_log_wine
  ON public.wine_repair_log (wine_id);

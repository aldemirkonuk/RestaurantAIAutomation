-- The enrich chain gets the columns it already writes to —
-- the founder's answer of 2026-09-22 (round 6z) on ADR 0192's residual,
-- verbatim pick: (3) "Add the columns (Recommended)".
--
-- WHAT WAS BROKEN
-- ----------------
-- `haiku_enrich_task` (services/agent-orchestrator/jobs/haiku_tasks.py
-- `_enrich_async`) has, since before this lane, built an `update_payload` of
-- nine columns and written it to `master_wine_library_submissions` — and the
-- table has never had eight of them. `field_confidence` (the ninth) already
-- existed (baseline 20260805000000); every other key the task sets was
-- silently dropped by PostgREST/postgrest-py's column filtering, which is why
-- ADR 0192's E4 last call could say "the sweep ships off because of it": a
-- house that turned `HOUSE_ITEM_RESEARCH_DISPATCH_ENABLED` on would see
-- `haiku_enrich_task` run, report success, and persist nothing it enriched.
--
-- THE NINE
-- --------
-- Three scalar/flag columns the task sets directly:
--   enrichment_source  TEXT      — `EnrichmentResult.enrichment_source`,
--                                  default "haiku" (haiku_enrichment_service.py)
--   ai_enriched         BOOLEAN  — literal `True`, set only when enrichment
--                                  actually ran (haiku_tasks.py:114)
-- ... and `field_confidence` (JSONB, already present) makes three; plus the
-- seven JSONB structured fields (FCONF-08 / CONTEXT.md D-07,
-- `JSONB_ENRICHMENT_KEYS` in services/field_confidence.py), each an
-- `Optional[Dict[str, Any]]` on `EnrichmentResult`:
--   grape_family, wine_structure, sensory_profile, practical_attributes,
--   region_hierarchy, critic_scores, winemaking_details
-- 2 + 7 = 9 new columns; field_confidence is the pre-existing tenth key of
-- the same update_payload.
--
-- WHY JSONB HERE EVEN THOUGH master_wine_library.grape_family IS varchar(100)
-- -----------------------------------------------------------------------
-- This is the STAGING table. What Haiku returns for `grape_family` is a
-- structured object (`{"primary": "...", "blend": bool, "percentages": null,
-- "family": "..."}`, haiku_enrichment_service.py:203), not a string — the
-- final table's varchar is a summary a later, unwritten step would have to
-- derive. Matching the value the task actually sends is what makes the
-- write succeed; reconciling the two shapes is not this file's claim and is
-- carried in ADR 0192 as a residual, same as the other "not wired" gaps.
--
-- HOUSE_ITEM_RESEARCH_DISPATCH_ENABLED (founder, 2026-09-22, verbatim,
-- round 6z, item 3): "stays as it is (the flip is his keystroke)" — this file
-- touches no flag and no application code; the sweep still requires that
-- env var to run at all (20260921170520's comment, house_item_research.py).
--
-- Additive (nullable columns only, no defaults that change existing rows'
-- meaning beyond ai_enriched's natural "not yet" default), idempotent,
-- assertions at the bottom. No RLS change: master_wine_library_submissions'
-- policies are unchanged by this file.

ALTER TABLE public.master_wine_library_submissions
  ADD COLUMN IF NOT EXISTS enrichment_source TEXT,
  ADD COLUMN IF NOT EXISTS ai_enriched BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS grape_family JSONB,
  ADD COLUMN IF NOT EXISTS wine_structure JSONB,
  ADD COLUMN IF NOT EXISTS sensory_profile JSONB,
  ADD COLUMN IF NOT EXISTS practical_attributes JSONB,
  ADD COLUMN IF NOT EXISTS region_hierarchy JSONB,
  ADD COLUMN IF NOT EXISTS critic_scores JSONB,
  ADD COLUMN IF NOT EXISTS winemaking_details JSONB;

COMMENT ON COLUMN public.master_wine_library_submissions.enrichment_source IS
  'Set by haiku_enrich_task (EnrichmentResult.enrichment_source, default "haiku"). Founder, 2026-09-22: "Add the columns (Recommended)".';
COMMENT ON COLUMN public.master_wine_library_submissions.ai_enriched IS
  'True once haiku_enrich_task has persisted a result for this submission (haiku_tasks.py:114). Founder, 2026-09-22: "Add the columns (Recommended)".';
COMMENT ON COLUMN public.master_wine_library_submissions.grape_family IS
  'JSONB structured enrichment from Haiku ({"primary","blend","percentages","family"}), not the varchar summary master_wine_library.grape_family holds — no step maps one into the other yet (ADR 0192 residual).';

DO $$
DECLARE
  c TEXT;
BEGIN
  FOREACH c IN ARRAY ARRAY[
    'enrichment_source', 'ai_enriched', 'grape_family', 'wine_structure',
    'sensory_profile', 'practical_attributes', 'region_hierarchy',
    'critic_scores', 'winemaking_details'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'master_wine_library_submissions' AND column_name = c
    ) THEN
      RAISE EXCEPTION 'master_wine_library_submissions.% was not added', c;
    END IF;
  END LOOP;
  IF (SELECT data_type FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'master_wine_library_submissions' AND column_name = 'ai_enriched') <> 'boolean' THEN
    RAISE EXCEPTION 'master_wine_library_submissions.ai_enriched must be boolean';
  END IF;
  RAISE NOTICE 'master_wine_library_submissions: the nine columns haiku_enrich_task writes now exist.';
END
$$;

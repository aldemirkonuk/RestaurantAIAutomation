-- Capture the ADR-0025 evidence/provenance schema that was applied to
-- production by hand on 2026-08-26.
--
-- WHY THIS FILE EXISTS
-- --------------------
-- `Schema parity / Fresh database equals remote` was green on `4c6eb6d2`
-- (17:51Z) and red on `c6e0477a` (18:03Z), and it went red on all eight open
-- branches within the same ten minutes. Branches do not fail in unison because
-- of anything in a branch -- that pattern only happens when the REMOTE side
-- moves. Between those two runs, this DDL was applied straight to production:
--
--   3 tables   field_evidence_policy, promotion_audit, source_registry
--   3 views    v_library_provenance_health, v_promotion_blockers,
--              v_signature_drift
--   4 columns  evidence_citations.{submission_id, content_sha256, verifier,
--              http_status}, plus two CHECKs and three indexes
--   6 functions fn_can_promote, fn_repair_signature_hashes,
--              fn_uncited_fields (two overloads), and the two trigger
--              functions below
--   2 triggers on master_wine_library
--
-- That is 53 columns and 6 functions -- exactly the counts the check reported.
-- None of it existed in any migration, on any of the 103 remote branches.
--
-- This migration changes NOTHING on production: every object here is already
-- there. It exists so that a database built from migrations alone is the same
-- database, which is the whole claim `check_schema_parity.sh` makes.
--
-- Every statement is idempotent, because production is ahead of this file and
-- must survive it being pushed. Captured read-only from
-- exzueerziesmczwlhomd via pg_get_functiondef / pg_get_viewdef /
-- pg_get_constraintdef, not rewritten by hand.

-- ---------------------------------------------------------------------------
-- 1. evidence_citations -- the four columns ADR 0025 added
--
-- The submission anchor. A citation used to be able to point only at a live
-- master_wine_library row; it can now point at a submission that has not been
-- promoted yet, which is what "citations carry two anchors" means.
-- ---------------------------------------------------------------------------

ALTER TABLE public.evidence_citations
  ADD COLUMN IF NOT EXISTS submission_id  uuid,
  ADD COLUMN IF NOT EXISTS content_sha256 text,
  ADD COLUMN IF NOT EXISTS verifier       text,
  ADD COLUMN IF NOT EXISTS http_status    integer;

-- ADD CONSTRAINT has no IF NOT EXISTS, so both are guarded by name.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.evidence_citations'::regclass
      AND conname  = 'evidence_anchor_present'
  ) THEN
    ALTER TABLE public.evidence_citations
      ADD CONSTRAINT evidence_anchor_present
      CHECK (wine_id IS NOT NULL OR submission_id IS NOT NULL);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.evidence_citations'::regclass
      AND conname  = 'evidence_snippet_present'
  ) THEN
    ALTER TABLE public.evidence_citations
      ADD CONSTRAINT evidence_snippet_present
      CHECK (NOT fetch_verified
             OR (snippet IS NOT NULL AND length(btrim(snippet)) >= 8));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_evidence_submission
  ON public.evidence_citations USING btree (submission_id)
  WHERE submission_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_evidence_wine_field
  ON public.evidence_citations USING btree (wine_id, field_name)
  WHERE fetch_verified;

CREATE UNIQUE INDEX IF NOT EXISTS uq_evidence_claim
  ON public.evidence_citations USING btree (wine_id, field_name, source_url)
  WHERE wine_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. field_evidence_policy -- which fields may not be approved uncited
--
-- Seeded here rather than in supabase/migrations/seed/, deliberately. CI runs
-- `supabase db reset --no-seed`, so a seed file would be skipped -- and an
-- EMPTY field_evidence_policy is not a smaller version of this table, it is an
-- off switch: fn_uncited_fields returns no rows, fn_can_promote returns true
-- for every wine, and the PROMOTION BLOCKED trigger below is installed and
-- silently inert. The 26 rows ARE the policy.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.field_evidence_policy (
  field_name        text    NOT NULL,
  requires_evidence boolean NOT NULL DEFAULT true,
  min_source_tier   character(1) NOT NULL DEFAULT 'C'::bpchar,
  min_corroboration integer NOT NULL DEFAULT 1,
  rationale         text,
  CONSTRAINT field_evidence_policy_pkey PRIMARY KEY (field_name),
  CONSTRAINT field_evidence_policy_min_corroboration_check
    CHECK (min_corroboration >= 1),
  CONSTRAINT field_evidence_policy_min_source_tier_check
    CHECK (min_source_tier = ANY (ARRAY['A'::bpchar, 'B'::bpchar, 'C'::bpchar]))
);

COMMENT ON TABLE public.field_evidence_policy IS
  'Per-field citation requirements enforced by fn_uncited_fields and the master_wine_library approval trigger.';

-- ---------------------------------------------------------------------------
-- 3. source_registry -- the tier of each source domain
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.source_registry (
  id          uuid NOT NULL DEFAULT gen_random_uuid(),
  domain      text NOT NULL,
  source_tier character(1) NOT NULL,
  category    text NOT NULL,
  notes       text,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT source_registry_pkey PRIMARY KEY (id),
  CONSTRAINT source_registry_domain_key UNIQUE (domain),
  CONSTRAINT source_registry_source_tier_check
    CHECK (source_tier = ANY (ARRAY['A'::bpchar, 'B'::bpchar, 'C'::bpchar]))
);

COMMENT ON TABLE public.source_registry IS
  'Source-domain tiers. A = official/regulatory, B = critic/reference, C = commercial.';

-- ---------------------------------------------------------------------------
-- 4. promotion_audit -- one row per approval, written by the trigger
--
-- Operational rows are NOT seeded; production holds 3 and they are history,
-- not configuration.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.promotion_audit (
  id             uuid NOT NULL DEFAULT gen_random_uuid(),
  wine_id        uuid NOT NULL,
  wine_code      text,
  from_status    text,
  to_status      text,
  decided_by     text NOT NULL DEFAULT CURRENT_USER,
  evidence_count integer,
  cited_fields   text[],
  decided_at     timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT promotion_audit_pkey PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_promotion_audit_wine
  ON public.promotion_audit USING btree (wine_id, decided_at DESC);

-- ---------------------------------------------------------------------------
-- 5. Reference rows (see the note on field_evidence_policy above)
--
-- ON CONFLICT DO NOTHING: on production every one of these already exists, and
-- this must never overwrite a value someone has since tuned there.
-- ---------------------------------------------------------------------------

INSERT INTO public.field_evidence_policy
  (field_name, requires_evidence, min_source_tier, min_corroboration, rationale)
VALUES
  ('aging_duration', true, 'B', 1, 'Producer tech sheet fact'),
  ('aging_vessel', true, 'B', 1, 'Producer tech sheet fact'),
  ('appellation', true, 'B', 1, 'Legally defined; must not be inferred from name'),
  ('awards', true, 'B', 1, 'Awards are checkable or absent'),
  ('bottle_size_ml', false, 'C', 1, 'NOT NULL DEFAULT 750 makes this unenforceable as a claim; 750ml is a convention, not an assertion. Non-standard formats are a review concern.'),
  ('classification_name', true, 'A', 1, 'Legal classification requires an official source'),
  ('classification_system', true, 'A', 1, 'Legal classification requires an official source'),
  ('closure_type', true, 'B', 1, NULL),
  ('country', true, 'B', 1, 'Identity field'),
  ('critic_scores', true, 'B', 1, 'Every score needs its critic'),
  ('farming', true, 'A', 1, 'Organic/biodynamic are certified claims'),
  ('grape_variety', true, 'B', 1, 'Blend composition is a label/tech-sheet fact'),
  ('historical_notes', true, 'B', 1, NULL),
  ('name', true, 'B', 1, 'Identity field'),
  ('price_reference', true, 'C', 1, 'Menu price must cite the menu PDF'),
  ('producer', true, 'B', 1, 'Identity field'),
  ('producer_bio', true, 'B', 1, NULL),
  ('producer_story', true, 'B', 1, NULL),
  ('rating_jr', true, 'B', 1, 'Must cite Jancis Robinson'),
  ('rating_rp', true, 'B', 1, 'Must cite Robert Parker / Wine Advocate'),
  ('rating_ws', true, 'B', 1, 'Must cite Wine Spectator'),
  ('region', true, 'B', 1, 'Checkable against producer or appellation source'),
  ('retail_price_avg', true, 'C', 1, NULL),
  ('sub_region', true, 'B', 1, NULL),
  ('tasting_notes', true, 'B', 1, 'Must quote a real taster, not a template'),
  ('vintage', true, 'B', 1, 'Identity field; NV must be NULL not guessed')
ON CONFLICT (field_name) DO NOTHING;

INSERT INTO public.source_registry (domain, source_tier, category, notes, is_active)
VALUES
  ('__menu_pdf__', 'A', 'primary_document', 'The restaurant menu PDF itself; the only valid source for menu price and listing facts', true),
  ('decanter.com', 'B', 'critic', NULL, true),
  ('ec.europa.eu', 'A', 'regulatory', 'EU eAmbrosia GI register', true),
  ('guildsomm.com', 'B', 'reference', NULL, true),
  ('inao.gouv.fr', 'A', 'appellation_authority', 'French AOC authority', true),
  ('jancisrobinson.com', 'B', 'critic', NULL, true),
  ('klwines.com', 'C', 'commercial', NULL, true),
  ('poderialdoconterno.com', 'A', 'producer_official', 'Poderi Aldo Conterno estate site; verified against contacts page address in Monforte d''Alba', true),
  ('politicheagricole.it', 'A', 'appellation_authority', 'Italian DOC/DOCG authority', true),
  ('robertparker.com', 'B', 'critic', NULL, true),
  ('totalwine.com', 'C', 'commercial', NULL, true),
  ('ttb.gov', 'A', 'regulatory', 'US TTB label approvals (COLA)', true),
  ('vinous.com', 'B', 'critic', NULL, true),
  ('vivino.com', 'C', 'commercial', 'Crowd-sourced; never sufficient alone for identity fields', true),
  ('wine-searcher.com', 'B', 'reference', 'Aggregated pricing and identity', true),
  ('winespectator.com', 'B', 'critic', NULL, true)
ON CONFLICT (domain) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 6. Functions
--
-- Order matters: fn_uncited_fields(uuid) calls the (uuid, jsonb) overload,
-- fn_can_promote calls fn_uncited_fields, and the views below call both.
-- ---------------------------------------------------------------------------

-- The row-shaped overload. Takes the candidate row as jsonb so the approval
-- trigger can ask about NEW -- a row that is not committed yet and therefore
-- cannot be looked up by id.
CREATE OR REPLACE FUNCTION public.fn_uncited_fields(p_wine uuid, p_row jsonb)
 RETURNS TABLE(field_name text, reason text, have integer, need integer)
 LANGUAGE sql
 STABLE
AS $function$
  SELECT p.field_name,
         CASE WHEN c.n = 0 THEN 'no_verified_citation'
              ELSE 'insufficient_corroboration' END,
         c.n::integer,
         p.min_corroboration
  FROM field_evidence_policy p
  CROSS JOIN LATERAL (
    SELECT count(DISTINCT e.source_url) AS n
    FROM evidence_citations e
    WHERE e.wine_id = p_wine
      AND e.field_name = p.field_name
      AND e.fetch_verified
      AND e.source_tier <= p.min_source_tier
  ) c
  WHERE p.requires_evidence
    AND p_row ? p.field_name
    AND jsonb_typeof(p_row -> p.field_name) <> 'null'
    AND btrim(COALESCE(p_row ->> p.field_name, '')) NOT IN ('', '{}', '[]', 'null')
    AND c.n < p.min_corroboration;
$function$;

CREATE OR REPLACE FUNCTION public.fn_uncited_fields(p_wine uuid)
 RETURNS TABLE(field_name text, reason text, have integer, need integer)
 LANGUAGE sql
 STABLE
AS $function$
  SELECT * FROM fn_uncited_fields(p_wine, (SELECT to_jsonb(m.*) FROM master_wine_library m WHERE m.id = p_wine));
$function$;

CREATE OR REPLACE FUNCTION public.fn_can_promote(p_wine uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
  SELECT NOT EXISTS (SELECT 1 FROM fn_uncited_fields(p_wine));
$function$;

-- ---------------------------------------------------------------------------
-- 7. Views
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW public.v_library_provenance_health AS
 SELECT count(*) AS rows_live,
    count(*) FILTER (WHERE m.review_status = 'approved'::text) AS approved,
    count(*) FILTER (WHERE m.review_status = 'pending'::text) AS pending,
    count(*) FILTER (WHERE m.review_status = 'needs_review'::text) AS needs_review,
    count(*) FILTER (WHERE ec.n > 0) AS rows_with_any_evidence,
    round(100.0 * count(*) FILTER (WHERE ec.n > 0)::numeric / NULLIF(count(*), 0)::numeric, 2) AS pct_with_evidence,
    count(*) FILTER (WHERE (m.data_enrichment ->> 'knowledge'::text) = 'inferred'::text) AS rows_inferred,
    count(*) FILTER (WHERE m.data_enrichment ? 'repair_note'::text) AS rows_repaired,
    count(*) FILTER (WHERE m.beverage_kind <> 'wine'::text) AS rows_not_wine
   FROM master_wine_library m
     LEFT JOIN LATERAL ( SELECT count(*) AS n
           FROM evidence_citations e
          WHERE e.wine_id = m.id AND e.fetch_verified) ec ON true
  WHERE m.deleted_at IS NULL;

CREATE OR REPLACE VIEW public.v_promotion_blockers AS
 SELECT m.id,
    m.wine_id,
    m.name,
    m.producer,
    m.vintage,
    m.review_status,
    u.field_name,
    u.reason,
    u.have,
    u.need
   FROM master_wine_library m
     CROSS JOIN LATERAL fn_uncited_fields(m.id) u(field_name, reason, have, need)
  WHERE m.deleted_at IS NULL;

-- Rows whose stored signature_hash disagrees with what the hash function
-- produces today -- i.e. rows edited before trg_sync_signature_hash existed.
CREATE OR REPLACE VIEW public.v_signature_drift AS
 SELECT id,
    wine_id,
    name,
    producer,
    vintage,
    source,
    created_at,
    signature_hash AS stored_hash,
    wine_signature_hash(producer::text, name::text, vintage, country::text, region::text, grape_variety) AS correct_hash
   FROM master_wine_library
  WHERE deleted_at IS NULL AND signature_hash IS DISTINCT FROM wine_signature_hash(producer::text, name::text, vintage, country::text, region::text, grape_variety);

-- Reads v_signature_drift, so it is defined after it. Defaults to a dry run:
-- p_apply => false reports WOULD_REPAIR and writes nothing.
CREATE OR REPLACE FUNCTION public.fn_repair_signature_hashes(p_apply boolean DEFAULT false)
 RETURNS TABLE(wine_id text, action text, detail text)
 LANGUAGE plpgsql
AS $function$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT d.id, d.wine_id AS code, d.correct_hash, d.name, d.producer
    FROM v_signature_drift d
  LOOP
    IF EXISTS (SELECT 1 FROM master_wine_library m
               WHERE m.signature_hash = r.correct_hash AND m.id <> r.id) THEN
      wine_id := r.code; action := 'SKIPPED_COLLISION';
      detail  := format('%s / %s already occupies the corrected hash; needs a merge decision', r.producer, r.name);
      RETURN NEXT;
    ELSE
      IF p_apply THEN
        UPDATE master_wine_library SET signature_hash = r.correct_hash WHERE id = r.id;
        wine_id := r.code; action := 'REPAIRED';
      ELSE
        wine_id := r.code; action := 'WOULD_REPAIR';
      END IF;
      detail := format('%s / %s', r.producer, r.name);
      RETURN NEXT;
    END IF;
  END LOOP;
END $function$;

-- ---------------------------------------------------------------------------
-- 8. Triggers on master_wine_library
--
-- DROP IF EXISTS + CREATE is the pattern the rest of this directory uses
-- (20260817030000, 20260817060000, 20260818030000) and is what makes these
-- two re-runnable.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.trg_fn_sync_signature_hash()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.signature_hash := wine_signature_hash(
    NEW.producer, NEW.name, NEW.vintage, NEW.country, NEW.region, NEW.grape_variety
  );
  NEW.normalized_name     := wine_normalize_text(NEW.name);
  NEW.normalized_producer := wine_normalize_text(NEW.producer);
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS trg_sync_signature_hash ON public.master_wine_library;
CREATE TRIGGER trg_sync_signature_hash
  BEFORE INSERT OR UPDATE OF producer, name, vintage, country, region, grape_variety
  ON public.master_wine_library
  FOR EACH ROW EXECUTE FUNCTION trg_fn_sync_signature_hash();

-- The one object here with teeth: it can REFUSE an update. Approving a wine
-- whose policy-covered fields have no verified citation raises
-- check_violation. Every successful approval writes a promotion_audit row.
CREATE OR REPLACE FUNCTION public.trg_fn_require_evidence_for_approval()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_missing text;
  v_count   integer;
  v_fields  text[];
BEGIN
  IF NEW.review_status = 'approved'
     AND COALESCE(OLD.review_status, '') IS DISTINCT FROM 'approved' THEN

    SELECT string_agg(format('%s (%s: have %s, need %s)', field_name, reason, have, need), '; ')
      INTO v_missing
      FROM fn_uncited_fields(NEW.id, to_jsonb(NEW));

    IF v_missing IS NOT NULL THEN
      RAISE EXCEPTION
        'PROMOTION BLOCKED for wine %: unsourced fields -> %', NEW.wine_id, v_missing
        USING ERRCODE = 'check_violation',
              HINT = 'Record verified evidence_citations for these fields, or set them NULL. Never approve an inferred value.';
    END IF;

    SELECT count(*), array_agg(DISTINCT field_name)
      INTO v_count, v_fields
      FROM evidence_citations WHERE wine_id = NEW.id AND fetch_verified;

    INSERT INTO promotion_audit (wine_id, wine_code, from_status, to_status, evidence_count, cited_fields)
    VALUES (NEW.id, NEW.wine_id, OLD.review_status, NEW.review_status, COALESCE(v_count,0), v_fields);
  END IF;

  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS trg_require_evidence_for_approval ON public.master_wine_library;
CREATE TRIGGER trg_require_evidence_for_approval
  BEFORE UPDATE ON public.master_wine_library
  FOR EACH ROW EXECUTE FUNCTION trg_fn_require_evidence_for_approval();

-- ---------------------------------------------------------------------------
-- 9. Grants -- match production, which grants none of these to clients
--
-- Production has RLS off and NO anon/authenticated privileges on any of these
-- six relations; only postgres and service_role can reach them. The OD-72
-- sweep (20260825210000) already ran by the time this file executes, so it
-- cannot cover tables created here -- and Supabase's default privileges would
-- otherwise hand anon and authenticated a PostgREST-reachable copy of the
-- promotion audit trail. Revoked explicitly instead.
-- ---------------------------------------------------------------------------

REVOKE ALL ON public.field_evidence_policy       FROM anon, authenticated;
REVOKE ALL ON public.source_registry             FROM anon, authenticated;
REVOKE ALL ON public.promotion_audit             FROM anon, authenticated;
REVOKE ALL ON public.v_library_provenance_health FROM anon, authenticated;
REVOKE ALL ON public.v_promotion_blockers        FROM anon, authenticated;
REVOKE ALL ON public.v_signature_drift           FROM anon, authenticated;

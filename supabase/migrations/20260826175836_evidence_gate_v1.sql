CREATE TABLE IF NOT EXISTS source_registry (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  domain        text NOT NULL UNIQUE,
  source_tier   char(1) NOT NULL CHECK (source_tier IN ('A','B','C')),
  category      text NOT NULL,
  notes         text,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE source_registry IS 'Allowlist of evidence domains. A=primary/official, B=recognised critic or reference, C=commercial listing. Anything not listed is untrusted and cannot satisfy the promotion gate.';

INSERT INTO source_registry (domain, source_tier, category, notes) VALUES
  ('__menu_pdf__',            'A', 'primary_document', 'The restaurant menu PDF itself; the only valid source for menu price and listing facts'),
  ('inao.gouv.fr',            'A', 'appellation_authority', 'French AOC authority'),
  ('politicheagricole.it',    'A', 'appellation_authority', 'Italian DOC/DOCG authority'),
  ('ttb.gov',                 'A', 'regulatory', 'US TTB label approvals (COLA)'),
  ('ec.europa.eu',            'A', 'regulatory', 'EU eAmbrosia GI register'),
  ('wine-searcher.com',       'B', 'reference', 'Aggregated pricing and identity'),
  ('jancisrobinson.com',      'B', 'critic', NULL),
  ('vinous.com',              'B', 'critic', NULL),
  ('winespectator.com',       'B', 'critic', NULL),
  ('decanter.com',            'B', 'critic', NULL),
  ('robertparker.com',        'B', 'critic', NULL),
  ('guildsomm.com',           'B', 'reference', NULL),
  ('vivino.com',              'C', 'commercial', 'Crowd-sourced; never sufficient alone for identity fields'),
  ('klwines.com',             'C', 'commercial', NULL),
  ('totalwine.com',           'C', 'commercial', NULL)
ON CONFLICT (domain) DO NOTHING;

ALTER TABLE evidence_citations
  ADD COLUMN IF NOT EXISTS submission_id   uuid,
  ADD COLUMN IF NOT EXISTS content_sha256  text,
  ADD COLUMN IF NOT EXISTS verifier        text,
  ADD COLUMN IF NOT EXISTS http_status     integer;

COMMENT ON COLUMN evidence_citations.content_sha256 IS 'sha256 of the fetched document body at retrieved_at. Lets a later audit detect that the cited page changed underneath the claim.';
COMMENT ON COLUMN evidence_citations.fetch_verified IS 'TRUE only when the recorded snippet was literally found in the fetched body. Never set this by hand.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='evidence_anchor_present') THEN
    ALTER TABLE evidence_citations
      ADD CONSTRAINT evidence_anchor_present
      CHECK (wine_id IS NOT NULL OR submission_id IS NOT NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='evidence_snippet_present') THEN
    ALTER TABLE evidence_citations
      ADD CONSTRAINT evidence_snippet_present
      CHECK (NOT fetch_verified OR (snippet IS NOT NULL AND length(btrim(snippet)) >= 8));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_evidence_claim
  ON evidence_citations (wine_id, field_name, source_url)
  WHERE wine_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_evidence_wine_field
  ON evidence_citations (wine_id, field_name) WHERE fetch_verified;

CREATE INDEX IF NOT EXISTS idx_evidence_submission
  ON evidence_citations (submission_id) WHERE submission_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS field_evidence_policy (
  field_name        text PRIMARY KEY,
  requires_evidence boolean NOT NULL DEFAULT true,
  min_source_tier   char(1) NOT NULL DEFAULT 'C' CHECK (min_source_tier IN ('A','B','C')),
  min_corroboration integer NOT NULL DEFAULT 1 CHECK (min_corroboration >= 1),
  rationale         text
);

COMMENT ON TABLE field_evidence_policy IS 'Per-field proof burden. A field listed here with requires_evidence=true may not hold a non-null value in an approved row unless matching verified citations exist.';

INSERT INTO field_evidence_policy (field_name, requires_evidence, min_source_tier, min_corroboration, rationale) VALUES
  ('name',                  true, 'B', 1, 'Identity field'),
  ('producer',              true, 'B', 1, 'Identity field'),
  ('vintage',               true, 'B', 1, 'Identity field; NV must be NULL not guessed'),
  ('country',               true, 'B', 1, 'Identity field'),
  ('region',                true, 'B', 1, 'Checkable against producer or appellation source'),
  ('appellation',           true, 'B', 1, 'Legally defined; must not be inferred from name'),
  ('sub_region',            true, 'B', 1, NULL),
  ('grape_variety',         true, 'B', 1, 'Blend composition is a label/tech-sheet fact'),
  ('classification_name',   true, 'A', 1, 'Legal classification requires an official source'),
  ('classification_system', true, 'A', 1, 'Legal classification requires an official source'),
  ('farming',               true, 'A', 1, 'Organic/biodynamic are certified claims'),
  ('aging_vessel',          true, 'B', 1, 'Producer tech sheet fact'),
  ('aging_duration',        true, 'B', 1, 'Producer tech sheet fact'),
  ('closure_type',          true, 'B', 1, NULL),
  ('bottle_size_ml',        true, 'C', 1, NULL),
  ('rating_ws',             true, 'B', 1, 'Must cite Wine Spectator'),
  ('rating_rp',             true, 'B', 1, 'Must cite Robert Parker / Wine Advocate'),
  ('rating_jr',             true, 'B', 1, 'Must cite Jancis Robinson'),
  ('critic_scores',         true, 'B', 1, 'Every score needs its critic'),
  ('awards',                true, 'B', 1, 'Awards are checkable or absent'),
  ('retail_price_avg',      true, 'C', 1, NULL),
  ('price_reference',       true, 'C', 1, 'Menu price must cite the menu PDF'),
  ('tasting_notes',         true, 'B', 1, 'Must quote a real taster, not a template'),
  ('producer_story',        true, 'B', 1, NULL),
  ('producer_bio',          true, 'B', 1, NULL),
  ('historical_notes',      true, 'B', 1, NULL)
ON CONFLICT (field_name) DO NOTHING;

CREATE OR REPLACE FUNCTION fn_uncited_fields(p_wine uuid, p_row jsonb)
RETURNS TABLE (field_name text, reason text, have integer, need integer)
LANGUAGE sql STABLE AS $fn$
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
$fn$;

COMMENT ON FUNCTION fn_uncited_fields(uuid, jsonb) IS 'Returns every policy-covered field that holds a value without adequate verified evidence. Empty result = row is promotable.';

CREATE OR REPLACE FUNCTION fn_uncited_fields(p_wine uuid)
RETURNS TABLE (field_name text, reason text, have integer, need integer)
LANGUAGE sql STABLE AS $fn$
  SELECT * FROM fn_uncited_fields(p_wine, (SELECT to_jsonb(m.*) FROM master_wine_library m WHERE m.id = p_wine));
$fn$;

CREATE OR REPLACE FUNCTION fn_can_promote(p_wine uuid)
RETURNS boolean LANGUAGE sql STABLE AS $fn$
  SELECT NOT EXISTS (SELECT 1 FROM fn_uncited_fields(p_wine));
$fn$;

CREATE TABLE IF NOT EXISTS promotion_audit (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wine_id       uuid NOT NULL,
  wine_code     text,
  from_status   text,
  to_status     text,
  decided_by    text NOT NULL DEFAULT current_user,
  evidence_count integer,
  cited_fields  text[],
  decided_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_promotion_audit_wine ON promotion_audit (wine_id, decided_at DESC);

CREATE OR REPLACE FUNCTION trg_fn_require_evidence_for_approval()
RETURNS trigger LANGUAGE plpgsql AS $fn$
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
END $fn$;

DROP TRIGGER IF EXISTS trg_require_evidence_for_approval ON master_wine_library;
CREATE TRIGGER trg_require_evidence_for_approval
  BEFORE UPDATE ON master_wine_library
  FOR EACH ROW EXECUTE FUNCTION trg_fn_require_evidence_for_approval();

CREATE OR REPLACE VIEW v_library_provenance_health AS
SELECT
  count(*)                                                             AS rows_live,
  count(*) FILTER (WHERE review_status = 'approved')                   AS approved,
  count(*) FILTER (WHERE review_status = 'pending')                    AS pending,
  count(*) FILTER (WHERE review_status = 'needs_review')               AS needs_review,
  count(*) FILTER (WHERE ec.n > 0)                                     AS rows_with_any_evidence,
  round(100.0 * count(*) FILTER (WHERE ec.n > 0) / NULLIF(count(*),0), 2) AS pct_with_evidence,
  count(*) FILTER (WHERE data_enrichment->>'knowledge' = 'inferred')   AS rows_inferred,
  count(*) FILTER (WHERE data_enrichment ? 'repair_note')              AS rows_repaired,
  count(*) FILTER (WHERE beverage_kind <> 'wine')                      AS rows_not_wine
FROM master_wine_library m
LEFT JOIN LATERAL (
  SELECT count(*) AS n FROM evidence_citations e WHERE e.wine_id = m.id AND e.fetch_verified
) ec ON true
WHERE m.deleted_at IS NULL;

CREATE OR REPLACE VIEW v_promotion_blockers AS
SELECT m.id, m.wine_id, m.name, m.producer, m.vintage, m.review_status,
       u.field_name, u.reason, u.have, u.need
FROM master_wine_library m
CROSS JOIN LATERAL fn_uncited_fields(m.id) u
WHERE m.deleted_at IS NULL;

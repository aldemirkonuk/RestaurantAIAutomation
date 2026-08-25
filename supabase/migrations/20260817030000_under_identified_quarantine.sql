-- 0c (BEVERAGE_CATALOGUE_PLAN.md; arch §3.5, register A3): a row whose name
-- adds nothing beyond its producer carries NO IDENTITY. On one menu alone,
-- six different Hermitage Blanc wines -- different growers, different
-- prices -- are stored as six identical rows, because the extractor wrote
-- the appellation into `producer`. Merging them is "correct given the data"
-- and destroys five real, distinct wines. Matching new submissions against
-- them is equally unsound: which Hermitage would a fuzzy match even mean?
--
-- No merge policy fixes this -- the information was lost upstream, at
-- extraction, and quarantine is the only sound response until it is fixed
-- there (0d). This migration:
--   1. adds identity_status, auto-maintained by a trigger (same posture as
--      enrichment_observed_at in 20260817010000 -- a column stamped by
--      individual call sites is one a future writer forgets to stamp);
--   2. excludes quarantined rows from match_library_wine's FUZZY candidate
--      paths, while deliberately leaving its EXACT signature_hash path
--      unguarded -- an exact resubmission of the identical wine must still
--      resolve back to the existing row, or every re-import of the same
--      menu would spawn a fresh quarantined duplicate and compound the
--      exact problem this migration exists to stop;
--   3. excludes quarantined rows as either side of a find_library_duplicates
--      proposal, unconditionally -- not only when they co-occur on one menu
--      (0b's guard), since two under-identified rows from DIFFERENT menus
--      are exactly as unmergeable as two from the same one.
--
-- The predicate (normalized_producer = normalized_name) is the same one
-- measured during planning. The count drifted between that measurement and
-- this migration (357 -> a lower live figure) -- expected, this is a live,
-- shared database, not a snapshot -- so the backfill below computes the set
-- fresh at apply time rather than trusting any previously-reported number.

ALTER TABLE public.master_wine_library
  ADD COLUMN IF NOT EXISTS identity_status text NOT NULL DEFAULT 'normal'
    CHECK (identity_status IN ('normal', 'under_identified'));

COMMENT ON COLUMN public.master_wine_library.identity_status IS
  'under_identified: normalized_producer = normalized_name, i.e. the name '
  'contributes nothing beyond the producer -- usually an appellation written '
  'into the producer field by extraction. Such rows are stored, displayed '
  'and counted normally, but are ineligible to be a merge target '
  '(find_library_duplicates) or a FUZZY match target (match_library_wine); '
  'an exact signature_hash resubmission still resolves to them. '
  'Auto-maintained by trg_wine_identity_status -- never set by application '
  'code. See BEVERAGE_CATALOGUE_ARCHITECTURE.md §3.5.';

CREATE OR REPLACE FUNCTION public.set_wine_identity_status()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.identity_status := CASE
    WHEN NEW.normalized_name <> '' AND NEW.normalized_producer = NEW.normalized_name
      THEN 'under_identified'
    ELSE 'normal'
  END;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.set_wine_identity_status() IS
  'Auto-maintains identity_status from normalized_name/normalized_producer '
  'on every insert or update, so quarantine can never drift out of sync '
  'with the columns it is computed from.';

DROP TRIGGER IF EXISTS trg_wine_identity_status ON public.master_wine_library;
CREATE TRIGGER trg_wine_identity_status
  BEFORE INSERT OR UPDATE ON public.master_wine_library
  FOR EACH ROW
  EXECUTE FUNCTION public.set_wine_identity_status();

-- Backfill: targeted, not a blanket no-op touch of every row. This table
-- already has update_master_wine_library_updated_at (BEFORE UPDATE, bumps
-- updated_at unconditionally on any write), so a no-op UPDATE across all
-- 4,160 rows would have overwritten updated_at everywhere with "now" and
-- destroyed the very signal this plan has spent the whole session trying to
-- preserve (arch §9.3). Only rows that actually need the flag are touched;
-- their updated_at moving is a correct side effect of a real classification
-- change, not collateral damage.
UPDATE public.master_wine_library
   SET identity_status = 'under_identified'
 WHERE deleted_at IS NULL
   AND normalized_name <> ''
   AND normalized_producer = normalized_name
   AND identity_status <> 'under_identified';

-- ---------------------------------------------------------------------
-- match_library_wine: exclude quarantined rows from the two FUZZY/loose
-- candidate branches. The exact signature_hash branch is intentionally
-- left untouched.
-- ---------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.match_library_wine(
  text, text, integer, text, text, text, real, real, integer
);

CREATE OR REPLACE FUNCTION public.match_library_wine(
  p_name text, p_producer text DEFAULT NULL::text, p_vintage integer DEFAULT NULL::integer,
  p_country text DEFAULT NULL::text, p_region text DEFAULT NULL::text,
  p_grape_variety text DEFAULT NULL::text, p_min_name_sim real DEFAULT 0.60,
  p_min_producer_sim real DEFAULT 0.70, p_limit integer DEFAULT 5
)
RETURNS TABLE(id uuid, name character varying, producer character varying,
              vintage integer, library_tier integer, confidence integer,
              name_sim real, producer_sim real)
LANGUAGE sql
STABLE
AS $function$
  WITH q AS (
    SELECT public.wine_normalize_text(p_name)     AS nn,
           public.wine_normalize_text(p_producer) AS np,
           public.wine_strip_trade_words(
             public.wine_normalize_text(p_producer))  AS np_core,
           public.wine_trade_words(
             public.wine_normalize_text(p_producer))  AS np_trade,
           public.wine_signature_hash(p_producer, p_name, p_vintage,
                                      p_country, p_region, p_grape_variety) AS sig
  ),
  candidate AS (
    -- Exact signature match: NOT guarded by identity_status. An exact
    -- resubmission of an already-quarantined wine must still resolve to
    -- it, or every re-import spawns a fresh under-identified duplicate.
    SELECT m.id FROM public.master_wine_library m, q
    WHERE m.signature_hash = q.sig AND m.deleted_at IS NULL
    UNION
    -- Exact normalized-name match: guarded. If the incoming query's name
    -- also reduces to a bare producer/appellation string, it is itself an
    -- ambiguous query, and resolving one ambiguous string to another
    -- resolves nothing.
    SELECT m.id FROM public.master_wine_library m, q
    WHERE m.normalized_name = q.nn AND m.deleted_at IS NULL
      AND m.identity_status = 'normal'
    UNION
    -- Fuzzy word-similarity candidates: guarded. This is the path that
    -- actually caused the Hermitage-Blanc hazard.
    (SELECT m.id FROM public.master_wine_library m, q
     WHERE q.nn <> '' AND q.nn <% m.normalized_name AND m.deleted_at IS NULL
       AND m.identity_status = 'normal'
     LIMIT 200)
  ),
  scored AS (
    SELECT m.id, m.name, m.producer, m.vintage, m.library_tier,
           (m.signature_hash = q.sig) AS sig_match,
           GREATEST(word_similarity(q.nn, m.normalized_name),
                    word_similarity(m.normalized_name, q.nn)) AS nsim,
           CASE
             WHEN q.np = '' AND m.normalized_producer = '' THEN 1.0::real
             WHEN q.np = '' OR m.normalized_producer = ''  THEN 0.0::real
             ELSE GREATEST(
               word_similarity(q.np, m.normalized_producer),
               word_similarity(m.normalized_producer, q.np),
               CASE
                 WHEN cardinality(q.np_trade) = 0
                   OR cardinality(mt.trade) = 0
                   OR q.np_trade && mt.trade
                 THEN GREATEST(word_similarity(q.np_core, mc.core),
                               word_similarity(mc.core, q.np_core))
                 ELSE 0.0::real
               END
             )
           END AS psim
    FROM public.master_wine_library m
    JOIN candidate c ON c.id = m.id
    CROSS JOIN q
    CROSS JOIN LATERAL (
      SELECT public.wine_strip_trade_words(m.normalized_producer) AS core
    ) mc
    CROSS JOIN LATERAL (
      SELECT public.wine_trade_words(m.normalized_producer) AS trade
    ) mt
  )
  SELECT s.id, s.name, s.producer, s.vintage, s.library_tier,
         CASE
           WHEN s.sig_match THEN 100
           ELSE GREATEST(0, round(LEAST(s.nsim, s.psim) * 100)::int
                            - CASE
                                WHEN s.vintage IS NOT DISTINCT FROM p_vintage THEN 0
                                WHEN s.vintage IS NULL OR p_vintage IS NULL   THEN 10
                                ELSE 30
                              END)
         END AS confidence,
         s.nsim, s.psim
  FROM scored s
  WHERE s.sig_match
     OR (s.nsim >= p_min_name_sim AND s.psim >= p_min_producer_sim)
  ORDER BY confidence DESC, s.nsim DESC, s.psim DESC,
           s.library_tier NULLS LAST, s.id
  LIMIT p_limit;
$function$;

COMMENT ON FUNCTION public.match_library_wine IS
  'Match a menu line against the library. Exact signature_hash always '
  'resolves, including to quarantined (identity_status=under_identified) '
  'rows. Fuzzy/exact-name candidates exclude quarantined rows -- they '
  'carry no identity to match against (0c guard, '
  'BEVERAGE_CATALOGUE_ARCHITECTURE.md §3.5).';

GRANT EXECUTE ON FUNCTION public.match_library_wine
  TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- find_library_duplicates: exclude quarantined rows as either side of a
-- proposal, unconditionally -- not only when they co-occur on one menu.
-- ---------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.find_library_duplicates(integer, integer);

CREATE OR REPLACE FUNCTION public.find_library_duplicates(
  p_min_confidence integer DEFAULT 85,
  p_limit          integer DEFAULT 500
)
RETURNS TABLE (
  keeper_id          uuid,
  keeper_producer    varchar,
  keeper_name        varchar,
  keeper_vintage     integer,
  loser_id           uuid,
  loser_producer     varchar,
  loser_name         varchar,
  loser_vintage      integer,
  confidence         integer,
  same_vintage       boolean,
  match_kind         text,
  co_occurs_on_menu  boolean,
  safe_to_merge      boolean
)
LANGUAGE sql
STABLE
AS $$
  WITH pairs AS (
    SELECT m.id AS a_id, c.id AS b_id, c.confidence,
           m.library_tier AS a_tier, c.library_tier AS b_tier,
           m.created_at   AS a_created,
           (SELECT x.created_at FROM public.master_wine_library x WHERE x.id = c.id) AS b_created
    FROM public.master_wine_library m
    CROSS JOIN LATERAL public.match_library_wine(
      m.name, m.producer, m.vintage, m.country, m.region, m.grape_variety,
      0.60, 0.70, 5
    ) c
    WHERE m.deleted_at IS NULL
      -- Quarantined source rows excluded here; match_library_wine already
      -- excludes quarantined CANDIDATE rows from its fuzzy paths (0c), so
      -- this covers the direction that would otherwise slip through: an
      -- under-identified row fuzzy-matching a normal one.
      AND m.identity_status = 'normal'
      AND c.id <> m.id
      AND c.confidence >= p_min_confidence
  ),
  ordered AS (
    SELECT DISTINCT ON (least(a_id::text, b_id::text), greatest(a_id::text, b_id::text))
           CASE WHEN (coalesce(a_tier, 99), a_created, a_id)
                  <= (coalesce(b_tier, 99), b_created, b_id)
                THEN a_id ELSE b_id END AS keeper_id,
           CASE WHEN (coalesce(a_tier, 99), a_created, a_id)
                  <= (coalesce(b_tier, 99), b_created, b_id)
                THEN b_id ELSE a_id END AS loser_id,
           confidence
    FROM pairs
    ORDER BY least(a_id::text, b_id::text), greatest(a_id::text, b_id::text),
             confidence DESC
  ),
  classified AS (
    SELECT o.keeper_id, o.loser_id, o.confidence,
           k.producer AS kp, k.name AS kn, k.vintage AS kv,
           l.producer AS lp, l.name AS ln, l.vintage AS lv,
           k.normalized_name AS knn, l.normalized_name AS lnn,
           k.normalized_producer AS knp, l.normalized_producer AS lnp,
           k.data_enrichment AS k_enrich, l.data_enrichment AS l_enrich
    FROM ordered o
    JOIN public.master_wine_library k ON k.id = o.keeper_id
    JOIN public.master_wine_library l ON l.id = o.loser_id
    -- Belt-and-suspenders: the loser side too, in case a future caller of
    -- match_library_wine passes different thresholds that let one through.
    WHERE k.identity_status = 'normal' AND l.identity_status = 'normal'
  )
  SELECT c.keeper_id, c.kp, c.kn, c.kv,
         c.loser_id,  c.lp, c.ln, c.lv,
         c.confidence,
         (c.kv IS NOT DISTINCT FROM c.lv) AS same_vintage,
         kind.k,
         cooc.co_occurs,
         (kind.k = 'identical'
            AND c.kv IS NOT DISTINCT FROM c.lv
            AND NOT cooc.co_occurs)
  FROM classified c
  CROSS JOIN LATERAL (
    SELECT CASE
      WHEN c.knn = c.lnn AND c.knp = c.lnp THEN 'identical'
      WHEN c.knp = c.lnp AND (
             string_to_array(c.knn, ' ') @> string_to_array(c.lnn, ' ')
          OR string_to_array(c.lnn, ' ') @> string_to_array(c.knn, ' ')
           ) THEN 'name_extends'
      ELSE 'fuzzy'
    END AS k
  ) kind
  CROSS JOIN LATERAL (
    SELECT COALESCE(
      ARRAY(SELECT jsonb_array_elements_text(c.k_enrich -> 'menus'))
        &&
      ARRAY(SELECT jsonb_array_elements_text(c.l_enrich -> 'menus')),
      false
    ) AS co_occurs
  ) cooc
  ORDER BY (kind.k = 'identical') DESC, c.confidence DESC, c.kp, c.kn
  LIMIT p_limit;
$$;

COMMENT ON FUNCTION public.find_library_duplicates IS
  'Existing duplicate pairs, found with the same matcher the importer uses. '
  'match_kind separates rows that differ only in punctuation/case '
  '(identical, safe_to_merge) from ones where a cuvee or vineyard suffix may '
  'mean two genuinely different wines (name_extends / fuzzy - review). '
  'co_occurs_on_menu forces safe_to_merge=false when both rows were seen on '
  'the same source menu (0b). Rows with identity_status=under_identified '
  'never appear on either side of a proposal (0c) - they carry no identity '
  'to compare. Keeper/loser ordering matches merge_library_wines'' precedence.';

GRANT EXECUTE ON FUNCTION public.find_library_duplicates
  TO authenticated, service_role;

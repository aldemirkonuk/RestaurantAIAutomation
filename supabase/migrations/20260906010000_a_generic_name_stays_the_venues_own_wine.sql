-- A generic name stays the venue's own wine (ADR 0130).
--
-- WHAT WAS MEASURED
--
-- Antalya night, 2026-09-04 (PR #314). The venue's bulk-add draft
-- `"House White Wine"` -- no producer, no vintage, no region -- resolved
-- through match_library_wine() and came back at confidence 90, pointing at
-- `HOUSE WHITE`, a library row created by the Sim Meyhouse load: country
-- United States, region California, vintage 2023. The venue's Turkish house
-- white was then stocked as a 2023 California wine and its own name was gone
-- from every screen.
--
-- Reproduced here on the schema built from all 100 migrations, with the
-- Meyhouse row inserted exactly as that load writes it:
--
--   match_library_wine('House White Wine', NULL, NULL, NULL, NULL, NULL)
--     -> HOUSE WHITE, confidence 90, name_sim 1, producer_sim 1
--
-- producer_sim is 1 because of this branch in the scorer:
--
--   WHEN q.np = '' AND m.normalized_producer = '' THEN 1.0
--
-- Two rows that state NO producer score a PERFECT producer match. Absence is
-- read as agreement. That is the whole defect: `nsim` was 1.0 because
-- "house white" is a word-subset of "house white wine", `psim` was 1.0
-- because neither side said who made it, and the only thing standing between
-- two unrelated venues was a 10-point vintage penalty.
--
-- The 0c quarantine (20260817030000) does not reach this. It excludes rows
-- whose normalized_producer EQUALS their normalized_name from the fuzzy
-- paths; the Meyhouse row's producer is the empty string, so it is
-- identity_status = 'normal' and a perfectly good fuzzy target.
--
-- THE DECISION (founder, 2026-09-05, in session)
--
-- A generic, producer-less wine name never auto-links to an existing
-- shared-library row. It becomes the tenant's own provisional wine. Only a
-- SPECIFIC identity -- producer + name, or name + vintage + region -- joins
-- the shared library. Nothing is renamed under a venue.
--
-- THE MECHANISM
--
-- 1. `wine_identity_is_specific()` states the rule once, in SQL, mirrored by
--    `isSpecificWineIdentity()` (apps/api-gateway/src/wines/wine-signature.ts)
--    and `wine_identity_is_specific()` (scripts/synth/identity.py). All three
--    are pinned against each other by
--    datasets/sim/fixtures/wine-identity-vectors.json.
--
-- 2. `match_library_wine()` returns NO ROWS for a query that is not specific.
--    Not "fewer candidates" -- none. A query that cannot say who made the
--    wine or when has nothing to be compared against, and every candidate it
--    would return is a different bottle that happens to share a common word.
--    This is the gate; the application-side gate in wine-submissions.service
--    is the second wall, not the first.
--
-- 3. A venue's provisional wine still needs a library row, because
--    restaurant_inventory.master_wine_id is NOT NULL. So the row is created
--    and MARKED: `provisional_for_restaurant_id` names the one venue it
--    belongs to. Such a row is never a match target for anybody, and its
--    signature_hash is computed over a key that carries the venue's id, so
--    two venues' "House White Wine" occupy two rows under the same UNIQUE
--    index instead of colliding -- while the SAME venue re-scanning its own
--    menu still lands on its own row rather than spawning duplicates.
--
-- WHAT THIS DOES NOT CHANGE, stated rather than discovered later
--
--   * No existing hash moves. `provisional_for_restaurant_id` is NULL on
--     every row that exists today, and the trigger's shared-library branch is
--     byte-identical to what it was. Verified by re-running the trigger over
--     the whole table in the test below.
--   * The exact-signature branch of match_library_wine is still unguarded by
--     identity_status, exactly as 20260817030000 intended. A specific
--     resubmission of a quarantined wine still resolves back to it.
--   * Nothing repairs the rows already written. The 26 Antalya rows and the
--     earlier Meyhouse rows are a separate stop with its own fingerprint
--     rule; see ADR 0130 Consequences.
--   * No CHECK constraint forces a generic row to be owned. It cannot bite
--     yet: the application still writes `producer = the wine's own name`, so
--     every generic row LOOKS specific to SQL. The ops track is removing that
--     fabrication; the constraint becomes enforceable, and is filed, once it
--     lands.

-- ---------------------------------------------------------------------
-- 1. The rule, stated once.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.wine_identity_is_specific(
  p_producer text,
  p_name     text,
  p_vintage  integer,
  p_region   text
) RETURNS boolean
LANGUAGE sql
IMMUTABLE PARALLEL SAFE
AS $function$
  -- A name is the floor, never the answer: "House White Wine" is a menu
  -- section, not a bottle. On top of the name the caller must say EITHER who
  -- made it, OR when it was made and where it comes from. Emptiness is judged
  -- after normalization so that "  " and "-" count as absent, the same way
  -- wine_signature_hash already treats them.
  SELECT public.wine_normalize_text(p_name) <> ''
     AND (
          public.wine_normalize_text(p_producer) <> ''
       OR (p_vintage IS NOT NULL AND public.wine_normalize_text(p_region) <> '')
     );
$function$;

COMMENT ON FUNCTION public.wine_identity_is_specific IS
  'True when an identity is specific enough to join the SHARED library: a '
  'name plus either a producer, or a vintage and a region (ADR 0130, founder '
  '2026-09-05). Anything else is the venue''s own provisional wine. Mirrored '
  'by isSpecificWineIdentity() in apps/api-gateway/src/wines/wine-signature.ts '
  'and wine_identity_is_specific() in scripts/synth/identity.py; the three are '
  'pinned against each other by datasets/sim/fixtures/wine-identity-vectors.json.';

GRANT EXECUTE ON FUNCTION public.wine_identity_is_specific
  TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- 2. A provisional row names the one venue it belongs to.
-- ---------------------------------------------------------------------

ALTER TABLE public.master_wine_library
  ADD COLUMN IF NOT EXISTS provisional_for_restaurant_id uuid
    REFERENCES public.restaurants(id);

COMMENT ON COLUMN public.master_wine_library.provisional_for_restaurant_id IS
  'NOT NULL: this row is one venue''s own provisional wine, not a shared '
  'library entry. It exists only because restaurant_inventory.master_wine_id '
  'is NOT NULL. Such a row is never a match target for any other venue, and '
  'its signature_hash is keyed on the venue id so two venues'' identically '
  'named house wines do not collide under '
  'idx_master_wine_library_signature_hash. Promotion to the shared library is '
  'setting this back to NULL once a real identity is known -- the trigger '
  'recomputes the shared hash, and a collision then means a genuine merge '
  'decision (merge_library_wines). ADR 0130.';

-- Partial: only owned rows are ever looked up this way, and there are few.
CREATE INDEX IF NOT EXISTS idx_mwl_provisional_owner
  ON public.master_wine_library (provisional_for_restaurant_id)
  WHERE provisional_for_restaurant_id IS NOT NULL;

-- ---------------------------------------------------------------------
-- 3. A venue-scoped identity key.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.wine_provisional_signature_hash(
  p_restaurant_id  uuid,
  p_producer       text,
  p_name           text,
  p_vintage        integer,
  p_country        text,
  p_region         text,
  p_grape_variety  text
) RETURNS text
LANGUAGE sql
IMMUTABLE PARALLEL SAFE
AS $function$
  -- The same six-field key as wine_signature_hash, behind a venue segment.
  -- 'venue:' is provably disjoint from any shared key: the shared key's first
  -- segment is wine_normalize_text(producer), whose character class is
  -- [a-z0-9 ] only -- it can never contain a colon. So a provisional hash and
  -- a shared hash can never denote the same thing by construction, not by
  -- luck.
  SELECT encode(
    sha256(
      convert_to(
        'venue:' || p_restaurant_id::text || '|' ||
        concat_ws('|',
          public.wine_normalize_text(p_producer),
          public.wine_normalize_text(p_name),
          COALESCE(p_vintage::text, 'NV'),
          public.wine_normalize_text(p_country),
          public.wine_normalize_text(p_region),
          public.wine_normalize_text(p_grape_variety)
        ),
        'UTF8'
      )
    ),
    'hex'
  );
$function$;

COMMENT ON FUNCTION public.wine_provisional_signature_hash IS
  'The identity of one venue''s own provisional wine. Same six fields as '
  'wine_signature_hash behind a "venue:<id>|" segment, so the same venue '
  'rescanning its own menu lands on its own row while another venue with the '
  'same generic name gets its own. ADR 0130.';

GRANT EXECUTE ON FUNCTION public.wine_provisional_signature_hash
  TO authenticated, service_role;

-- The trigger picks the key. signature_hash stays derived state that no
-- client supplies -- the posture 20260826180321 established.
CREATE OR REPLACE FUNCTION trg_fn_sync_signature_hash()
RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  NEW.signature_hash := CASE
    WHEN NEW.provisional_for_restaurant_id IS NULL
      THEN public.wine_signature_hash(
             NEW.producer, NEW.name, NEW.vintage,
             NEW.country, NEW.region, NEW.grape_variety)
    ELSE public.wine_provisional_signature_hash(
             NEW.provisional_for_restaurant_id,
             NEW.producer, NEW.name, NEW.vintage,
             NEW.country, NEW.region, NEW.grape_variety)
  END;
  NEW.normalized_name     := public.wine_normalize_text(NEW.name);
  NEW.normalized_producer := public.wine_normalize_text(NEW.producer);
  RETURN NEW;
END $fn$;

COMMENT ON FUNCTION trg_fn_sync_signature_hash IS
  'signature_hash is derived state, never client-supplied. A shared row is '
  'keyed on its six identity fields; a row owned by one venue '
  '(provisional_for_restaurant_id) is keyed on those fields behind the venue '
  'id, so two venues'' identically named house wines do not collide. Any '
  'writer that edits producer/name/vintage/country/region/grape_variety or '
  'the owner gets a fresh hash automatically. ADR 0130.';

-- The owner column has to be in the trigger's UPDATE OF list, or clearing it
-- (promotion to the shared library) would leave the venue-scoped hash behind
-- and the row would be unreachable by its own identity.
DROP TRIGGER IF EXISTS trg_sync_signature_hash ON public.master_wine_library;
CREATE TRIGGER trg_sync_signature_hash
  BEFORE INSERT OR UPDATE OF producer, name, vintage, country, region,
                             grape_variety, provisional_for_restaurant_id
  ON public.master_wine_library
  FOR EACH ROW EXECUTE FUNCTION trg_fn_sync_signature_hash();

-- v_signature_drift compares stored hashes against the shared formula, which
-- is the wrong question for an owned row. Teach it the owner branch, or every
-- provisional row reads as a hole in duplicate protection.
CREATE OR REPLACE VIEW v_signature_drift AS
SELECT id, wine_id, name, producer, vintage, source, created_at,
       signature_hash AS stored_hash,
       CASE
         WHEN provisional_for_restaurant_id IS NULL
           THEN public.wine_signature_hash(producer, name, vintage,
                                           country, region, grape_variety)
         ELSE public.wine_provisional_signature_hash(
                provisional_for_restaurant_id, producer, name, vintage,
                country, region, grape_variety)
       END AS correct_hash
FROM master_wine_library
WHERE deleted_at IS NULL
  AND signature_hash IS DISTINCT FROM
      CASE
        WHEN provisional_for_restaurant_id IS NULL
          THEN public.wine_signature_hash(producer, name, vintage,
                                          country, region, grape_variety)
        ELSE public.wine_provisional_signature_hash(
               provisional_for_restaurant_id, producer, name, vintage,
               country, region, grape_variety)
      END;

COMMENT ON VIEW v_signature_drift IS
  'Rows whose stored dedup hash no longer matches their own identity fields — '
  'against the shared formula for a shared row, and against the venue-scoped '
  'formula for a row owned by one venue (ADR 0130). Each one is a hole in '
  'duplicate protection.';

-- ---------------------------------------------------------------------
-- 4. The matcher refuses a query that carries no identity, and never
--    offers one venue's own wine to another.
-- ---------------------------------------------------------------------

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
                                      p_country, p_region, p_grape_variety) AS sig,
           -- ADR 0130. A query with no producer and no (vintage, region) is
           -- not a bottle, it is a menu section. Below, every candidate
           -- branch is switched off for it -- including the exact-signature
           -- one, because the hash of a generic identity is shared by every
           -- venue that prints the same words.
           public.wine_identity_is_specific(p_producer, p_name, p_vintage,
                                            p_region) AS specific
  ),
  candidate AS (
    -- Exact signature match: NOT guarded by identity_status. An exact
    -- resubmission of an already-quarantined wine must still resolve to
    -- it, or every re-import spawns a fresh under-identified duplicate.
    SELECT m.id FROM public.master_wine_library m, q
    WHERE q.specific AND m.signature_hash = q.sig AND m.deleted_at IS NULL
      AND m.provisional_for_restaurant_id IS NULL
    UNION
    -- Exact normalized-name match: guarded. If the incoming query's name
    -- also reduces to a bare producer/appellation string, it is itself an
    -- ambiguous query, and resolving one ambiguous string to another
    -- resolves nothing.
    SELECT m.id FROM public.master_wine_library m, q
    WHERE q.specific AND m.normalized_name = q.nn AND m.deleted_at IS NULL
      AND m.identity_status = 'normal'
      AND m.provisional_for_restaurant_id IS NULL
    UNION
    -- Fuzzy word-similarity candidates: guarded. This is the path that
    -- actually caused the Hermitage-Blanc hazard, and the path the Antalya
    -- house white came down.
    (SELECT m.id FROM public.master_wine_library m, q
     WHERE q.specific AND q.nn <> '' AND q.nn <% m.normalized_name
       AND m.deleted_at IS NULL
       AND m.identity_status = 'normal'
       AND m.provisional_for_restaurant_id IS NULL
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
  'Match a menu line against the SHARED library. A query that is not '
  'specific (wine_identity_is_specific: a name plus a producer, or a vintage '
  'and a region) returns NOTHING — it names a menu section, not a bottle '
  '(ADR 0130). Rows owned by one venue '
  '(provisional_for_restaurant_id) are never candidates. Otherwise: exact '
  'signature_hash always resolves, including to quarantined '
  '(identity_status=under_identified) rows; fuzzy/exact-name candidates '
  'exclude quarantined rows (0c guard, '
  'BEVERAGE_CATALOGUE_ARCHITECTURE.md §3.5).';

GRANT EXECUTE ON FUNCTION public.match_library_wine
  TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- 5. A venue's own wine is never one side of a merge proposal either.
--    match_library_wine already excludes it as a CANDIDATE; this is the
--    other direction, the same shape as 0c's source-side guard.
-- ---------------------------------------------------------------------

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
      -- Same shape for a venue's own provisional wine (ADR 0130): it is not
      -- part of the shared library, so it is never merged into or out of it
      -- by this proposer. Promotion is a deliberate act, not a duplicate
      -- sweep.
      AND m.provisional_for_restaurant_id IS NULL
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
      AND k.provisional_for_restaurant_id IS NULL
      AND l.provisional_for_restaurant_id IS NULL
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
  'to compare - and neither does a row owned by one venue '
  '(provisional_for_restaurant_id, ADR 0130). Keeper/loser ordering matches '
  'merge_library_wines'' precedence.';

GRANT EXECUTE ON FUNCTION public.find_library_duplicates
  TO authenticated, service_role;

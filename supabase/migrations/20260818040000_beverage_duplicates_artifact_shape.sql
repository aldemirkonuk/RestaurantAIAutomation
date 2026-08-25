-- Premortem audit finding #5: find_beverage_duplicates blanket-blocks every
-- same-menu (co-occurring) pair, including ones that look like the SAME
-- bottle extracted twice with the producer echoed differently -- exactly
-- what scripts/build_merge_eval_set.py's is_artifact() already knows how
-- to detect, and already uses to keep the merge-identity eval set honest.
-- The blanket block itself is right (arch §3.9's ~100:1 cost ratio still
-- argues for it -- reusing is_artifact() to APPROVE a merge would be a much
-- stronger claim than the eval script makes with it, and is correctly
-- declined). What was missing is exposing the signal the codebase already
-- has, so a human clearing the review queue can tell an extraction
-- artifact apart from a genuine two-products case at a glance instead of
-- re-deriving it by hand -- register C5's "if unclearable, fix
-- generation" applies to review-queue ergonomics too, not only to recall.
--
-- Two more findings from the same audit, fixed here:
--   - the co-occurrence guard FAILS OPEN when either row lacks
--     data_enrichment->'menus' (jsonb_array_elements_text(NULL) is empty,
--     so the overlap check silently returns false -- "no menus recorded"
--     reads identically to "definitely never on the same menu"). Added
--     menus_known and require it for safe_to_merge, so a guard that could
--     not run no longer reads as a guard that passed.
--   - ordering was `ORDER BY identity_key`, an opaque key with no
--     relationship to review value. Reordered so a human clearing the
--     queue sees decided-safe pairs first, then likely-artifacts, then
--     everything else.

DROP FUNCTION IF EXISTS public.find_beverage_duplicates(integer);

CREATE OR REPLACE FUNCTION public.find_beverage_duplicates(
  p_limit integer DEFAULT 500
)
RETURNS TABLE (
  keeper_id          uuid,
  keeper_producer    text,
  keeper_name        text,
  loser_id           uuid,
  loser_producer     text,
  loser_name         text,
  identity_key       text,
  match_kind         text,
  co_occurs_on_menu  boolean,
  menus_known        boolean,
  artifact_shape     boolean,
  safe_to_merge      boolean
)
LANGUAGE sql
STABLE
AS $function$
  WITH live AS (
    SELECT id, name, producer, identity_key, data_enrichment, created_at,
           public.beverage_tokenize(producer) AS producer_tokens
    FROM public.beverages
    WHERE deleted_at IS NULL AND identity_status = 'normal'
  ),
  exact_groups AS (
    SELECT identity_key, array_agg(id ORDER BY created_at, id) AS ids
    FROM live
    GROUP BY identity_key
    HAVING count(*) > 1
  ),
  exact_pairs AS (
    SELECT 'exact_key'::text AS match_kind, g.ids[1] AS keeper_id, g.ids[i] AS loser_id
    FROM exact_groups g, generate_series(2, array_length(g.ids, 1)) AS i
  ),
  near_groups AS (
    SELECT producer_tokens, array_agg(id ORDER BY created_at, id) AS ids,
           array_agg(DISTINCT identity_key) AS keys
    FROM live
    WHERE cardinality(producer_tokens) > 0
    GROUP BY producer_tokens
    HAVING count(DISTINCT identity_key) > 1
  ),
  near_pairs AS (
    SELECT 'near_key'::text AS match_kind, g.ids[1] AS keeper_id, g.ids[i] AS loser_id
    FROM near_groups g, generate_series(2, array_length(g.ids, 1)) AS i
    WHERE array_length(g.keys, 1) > 1
  ),
  pairs AS (
    SELECT * FROM exact_pairs
    UNION ALL
    SELECT * FROM near_pairs
  )
  SELECT
    p.keeper_id, k.producer, k.name,
    p.loser_id,  l.producer, l.name,
    k.identity_key,
    p.match_kind,
    cooc.co_occurs,
    cooc.menus_known,
    -- Ported from scripts/build_merge_eval_set.py's is_artifact(): true
    -- when one row's name is the other's (producer + name) concatenated,
    -- in any of the four producer/name combinations -- the shape of "same
    -- bottle, producer echoed into the name differently by extraction."
    (
      public.beverage_normalize_text(k.name)
        = public.beverage_normalize_text(l.producer || ' ' || l.name)
      OR public.beverage_normalize_text(l.name)
        = public.beverage_normalize_text(k.producer || ' ' || k.name)
      OR public.beverage_normalize_text(k.name)
        = public.beverage_normalize_text(k.producer || ' ' || l.name)
      OR public.beverage_normalize_text(l.name)
        = public.beverage_normalize_text(l.producer || ' ' || k.name)
    ) AS artifact_shape,
    -- safe_to_merge now requires menus_known -- a guard that could not run
    -- (no menus recorded on one or both sides) no longer reads as a guard
    -- that passed.
    (p.match_kind = 'exact_key' AND NOT cooc.co_occurs AND cooc.menus_known) AS safe_to_merge
  FROM pairs p
  JOIN live k ON k.id = p.keeper_id
  JOIN live l ON l.id = p.loser_id
  CROSS JOIN LATERAL (
    SELECT
      COALESCE(
        ARRAY(SELECT jsonb_array_elements_text(k.data_enrichment -> 'menus'))
          &&
        ARRAY(SELECT jsonb_array_elements_text(l.data_enrichment -> 'menus')),
        false
      ) AS co_occurs,
      (k.data_enrichment ? 'menus') AND (l.data_enrichment ? 'menus') AS menus_known
  ) cooc
  ORDER BY
    (p.match_kind = 'exact_key' AND NOT cooc.co_occurs AND cooc.menus_known) DESC,
    (
      public.beverage_normalize_text(k.name)
        = public.beverage_normalize_text(l.producer || ' ' || l.name)
      OR public.beverage_normalize_text(l.name)
        = public.beverage_normalize_text(k.producer || ' ' || k.name)
      OR public.beverage_normalize_text(k.name)
        = public.beverage_normalize_text(k.producer || ' ' || l.name)
      OR public.beverage_normalize_text(l.name)
        = public.beverage_normalize_text(l.producer || ' ' || k.name)
    ) DESC,
    p.match_kind, k.producer, k.name
  LIMIT p_limit;
$function$;

COMMENT ON FUNCTION public.find_beverage_duplicates IS
  'Beverage duplicate candidates. match_kind=''exact_key'': equal '
  'identity_key (arch §3.4) -- 0 false merges measured against 732,874 '
  'known-distinct pairs, may be safe_to_merge=true, but only when '
  'menus_known is also true (co-occurrence fails open on unenriched rows, '
  'so an unknown guard state must never read as a passed one). '
  'match_kind=''near_key'': same producer tokens, different identity_key '
  '-- generation only, never safe_to_merge. artifact_shape (ported from '
  'scripts/build_merge_eval_set.py''s is_artifact()) flags the "same '
  'bottle, producer echoed differently" pattern for a human reviewer -- '
  'informational only, never used to auto-approve a merge, since that '
  'would be a stronger claim than the eval script itself makes with the '
  'same heuristic. Ordered by review value: decided-safe first, then '
  'likely artifacts, then everything else. Premortem audit finding '
  '2026-08-18 #5.';

GRANT EXECUTE ON FUNCTION public.find_beverage_duplicates
  TO authenticated, service_role;

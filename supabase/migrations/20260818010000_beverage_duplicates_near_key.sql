-- Premortem audit finding #1: find_beverage_duplicates's own header claimed
-- "100% recall (nothing is candidate-narrowed away)". That is false, and the
-- repo's own gate proves it: running scripts/eval_merge_policies.py against
-- the labelled corpus shows the residual-token key produces 5 false SPLITS
-- out of 12 known positives (0 false merges -- the safety property holds;
-- recall is what does not). Two are real, checkable pairs: "Woodford
-- Reserve"/"Bourbon" vs "WOODFORD RESERVE"/"Whiskey", and "Maker's Mark"/
-- "Bourbon" vs "MAKER'S MARK"/"Whiskey" -- same bottle, one menu calls the
-- category "Bourbon", another calls it "Whiskey", and neither word is in
-- EQUIV, so the residual tokens differ and the keys differ. A pure
-- `GROUP BY identity_key` has no mechanism to ever surface this pair.
--
-- Fix: a second, lower-precision candidate class -- same brand tokens
-- (beverage_tokenize(producer) equal) but a DIFFERENT identity_key --
-- returned as match_kind='near_key', ALWAYS safe_to_merge=false. This is
-- exactly arch §3.6's two-stage design applied a second time: 'exact_key'
-- is the decided-safe class (0 false merges, may auto-suggest), 'near_key'
-- is a generation-only class (recall-widening, never auto-anything, always
-- routed to a human). It does not touch the decision rule -- identity_key
-- equality is still the only thing that can ever produce
-- safe_to_merge=true. Register C5's own principle: "if unclearable, fix
-- generation, never the decision rule." This is that fix.

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
  -- Stage 1 (decision): equal identity_key. 0 false merges, measured.
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
  -- Stage 2 (generation only): same brand, different residual. Recall-
  -- widening candidates, never a decision -- see header comment.
  near_groups AS (
    SELECT producer_tokens, array_agg(id ORDER BY created_at, id) AS ids,
           array_agg(DISTINCT identity_key) AS keys
    FROM live
    WHERE cardinality(producer_tokens) > 0
    GROUP BY producer_tokens
    HAVING count(DISTINCT identity_key) > 1  -- same brand, keys differ
  ),
  near_pairs AS (
    SELECT 'near_key'::text AS match_kind, g.ids[1] AS keeper_id, g.ids[i] AS loser_id
    FROM near_groups g, generate_series(2, array_length(g.ids, 1)) AS i
    -- Exclude pairs already covered by stage 1 (equal key) -- near_key is
    -- specifically the "same brand, keys DIFFER" residue.
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
    -- near_key NEVER auto-suggests -- it is evidence a human should look,
    -- not a decision. Only exact_key + no co-occurrence is safe_to_merge.
    (p.match_kind = 'exact_key' AND NOT cooc.co_occurs) AS safe_to_merge
  FROM pairs p
  JOIN live k ON k.id = p.keeper_id
  JOIN live l ON l.id = p.loser_id
  CROSS JOIN LATERAL (
    SELECT COALESCE(
      ARRAY(SELECT jsonb_array_elements_text(k.data_enrichment -> 'menus'))
        &&
      ARRAY(SELECT jsonb_array_elements_text(l.data_enrichment -> 'menus')),
      false
    ) AS co_occurs
  ) cooc
  ORDER BY (p.match_kind = 'exact_key' AND NOT cooc.co_occurs) DESC,
           p.match_kind, k.producer, k.name
  LIMIT p_limit;
$function$;

COMMENT ON FUNCTION public.find_beverage_duplicates IS
  'Beverage duplicate candidates, two classes. match_kind=''exact_key'': '
  'equal identity_key (arch §3.4) -- the decided-safe class, 0 false '
  'merges measured against 732,874 known-distinct pairs, may be '
  'safe_to_merge=true. match_kind=''near_key'': same brand '
  '(beverage_tokenize(producer) equal) but a DIFFERENT identity_key -- '
  'generation only (recall-widening), NEVER safe_to_merge, always a human '
  'call. Recall is NOT 100% even with both classes -- residual-token '
  'vocabulary gaps in EQUIV (measured: "bourbon" vs "whiskey" as a menu '
  'category word for the identical bottle) can still put two rows in '
  'different producer-token buckets if the producer string itself differs '
  '(not just the residual) -- see scripts/eval_merge_policies.py and '
  'scripts/check_beverage_identity_parity.py, the latter now wired into '
  '.github/workflows/schema-parity.yml. Premortem audit finding '
  '2026-08-18 #1 -- corrects an earlier version of this function''s '
  'comment, which overstated recall as 100%.';

GRANT EXECUTE ON FUNCTION public.find_beverage_duplicates
  TO authenticated, service_role;

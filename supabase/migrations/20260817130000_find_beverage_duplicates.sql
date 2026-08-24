-- Register item 18 / plan §2.1 task 6: beverages had an identity DECISION
-- (beverage_identity_key, 0 false merges across 732,874 pairs) but no
-- duplicate-FINDING tool surfacing candidates for review. Non-wines would
-- accumulate duplicates the same way wine did before find_library_duplicates
-- existed.
--
-- Deliberately SIMPLER than find_library_duplicates, and that is not a
-- shortcut -- it is the correct shape given what is actually different here.
-- Wine's finder needs trigram/word-similarity CANDIDATE GENERATION (arch
-- §3.6's "generate" stage) because its decision criterion is inherently
-- approximate (word similarity), so it has to narrow a large space of
-- maybes before classifying. beverage_identity_key is not approximate --
-- equal key IS the decision, by construction, measured at 0 false merges.
-- So the correct tool is a direct GROUP BY over identity_key: it has 100%
-- recall (nothing is candidate-narrowed away) and 0 false positives (the
-- same guarantee the key itself carries). Building a two-stage
-- generate-then-decide pipeline here would add complexity to work around a
-- problem (approximate similarity) that does not exist in this path.
--
-- Same co-occurrence guard as wine's finder (0b): two rows sharing an
-- identity_key that ALSO appeared as separate lines on one menu is a
-- genuine anomaly -- the residual-token key was not designed to
-- distinguish them, and that is stronger counter-evidence than the key's
-- own guarantee, so it forces safe_to_merge=false rather than being
-- silently trusted.

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
  co_occurs_on_menu  boolean,
  safe_to_merge      boolean
)
LANGUAGE sql
STABLE
AS $function$
  WITH live AS (
    SELECT id, name, producer, identity_key, data_enrichment, created_at
    FROM public.beverages
    WHERE deleted_at IS NULL AND identity_status = 'normal'
  ),
  groups AS (
    SELECT identity_key, array_agg(id ORDER BY created_at, id) AS ids
    FROM live
    GROUP BY identity_key
    HAVING count(*) > 1
  ),
  pairs AS (
    SELECT g.identity_key, g.ids[1] AS keeper_id, g.ids[i] AS loser_id
    FROM groups g, generate_series(2, array_length(g.ids, 1)) AS i
  )
  SELECT
    p.keeper_id, k.producer, k.name,
    p.loser_id,  l.producer, l.name,
    p.identity_key,
    cooc.co_occurs,
    NOT cooc.co_occurs AS safe_to_merge
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
  ORDER BY p.identity_key
  LIMIT p_limit;
$function$;

COMMENT ON FUNCTION public.find_beverage_duplicates IS
  'Beverage duplicate candidates, grouped by equal identity_key (the '
  'decided identity, arch §3.4) rather than fuzzy-matched like '
  'find_library_duplicates -- correct here because the key is not '
  'approximate. safe_to_merge is false only when the two rows co-occur on '
  'one source menu (0b-style guard) -- a genuine anomaly worth a human '
  'looking at, since two rows sharing a key that also appear as separate '
  'menu lines contradicts the key''s own guarantee.';

GRANT EXECUTE ON FUNCTION public.find_beverage_duplicates
  TO authenticated, service_role;

-- Plan §2.1 / arch §3.4, §4: the beverages table.
--
-- Identity is a deterministic key, not a similarity score (arch §3) --
-- measured at 0 false merges across 732,874 known-distinct pairs, because
-- no similarity threshold separates true matches from false ones (worst
-- true match 0.919, worst false pair 0.979 -- "Pappy Van Winkle 12" vs "15").
-- beverage_identity_key() below is the SAME algorithm as
-- scripts/eval_merge_policies.py's residual_key() -- same EQUIV table, same
-- NOISE set, same "every non-brand token discriminates until a closed,
-- versioned equivalence says otherwise" rule. Ported to PL/pgSQL rather than
-- pure SQL because the residual-token step needs Counter-style multiset
-- SUBTRACTION (a word appearing twice in the name minus once from the
-- producer must still count once), which is far more legible imperatively
-- than as nested array operations.
--
-- IMPORTANT: if EQUIV or NOISE changes here, the SAME change must land in
-- scripts/eval_merge_policies.py's residual_key(), and the merge-identity
-- CI gate (0a) must be re-run. Two independent implementations of one
-- algorithm is exactly the "one fact, two homes" defect this whole build
-- has been closing everywhere else -- unavoidable here only because the
-- eval tooling is offline/file-based (arch §3.1) and the production key
-- must run inside Postgres at scale. Keeping them in lockstep is a
-- discipline, not a guarantee; that is written down here on purpose.

CREATE OR REPLACE FUNCTION public.beverage_normalize_text(p_text text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $function$
  -- Deliberately NOT wine_normalize_text. That function also expands trade
  -- abbreviations (Ch. -> chateau, St. -> saint, Mt. -> monte, Dom. ->
  -- domaine, ...), which is correct for WINE matching but is NOT what the
  -- validated Python reference (scripts/eval_merge_policies.py norm()) does
  -- -- caught by a direct parity run across all 4,822 corpus entries before
  -- this shipped: reusing wine_normalize_text produced 67 divergences, all
  -- of the same shape ("St. George" -> "saint george" in SQL, "st george"
  -- in Python). This function mirrors norm() exactly: NFD, diacritic strip
  -- (same shared class wine_normalize_text uses), lowercase, non-alnum to
  -- space. No abbreviation table.
  SELECT lower(
    regexp_replace(
      normalize(coalesce(p_text, ''), NFD),
      '[̀-ͯ᪰-᫿᷀-᷿︠-︯^`¨¯´·¸ʰ-˿ʹ͵ͺ΄΅]', '', 'g'
    )
  );
$function$;

COMMENT ON FUNCTION public.beverage_normalize_text IS
  'NFD + diacritic strip + lowercase, matching '
  'scripts/eval_merge_policies.py norm() exactly -- no abbreviation '
  'expansion, unlike wine_normalize_text. See this function''s body '
  'comment for why reusing wine_normalize_text was tried and reverted.';

CREATE OR REPLACE FUNCTION public.beverage_tokenize(p_text text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $function$
  WITH normed AS (
    -- Unglue "12yr" -> "12 yr", "107proof" -> "107 proof" BEFORE the yr-
    -- family collapse below, or "12yrs" never matches the collapse regex.
    SELECT regexp_replace(
             regexp_replace(
               regexp_replace(public.beverage_normalize_text(p_text), '[^a-z0-9]+', ' ', 'g'),
               '(\d)\s*(yrs|yr|years|year|yo)\M', '\1 yr', 'g'
             ),
             '(?<=[0-9])(?=[a-z])', ' ', 'g'
           ) AS t
  ),
  words AS (
    SELECT unnest(string_to_array(normed.t, ' ')) AS w FROM normed
  ),
  equiv AS (
    -- EQUIV table -- mirror scripts/eval_merge_policies.py's EQUIV exactly.
    SELECT CASE w
             WHEN 'yrs' THEN 'yr'
             WHEN 'year' THEN 'yr'
             WHEN 'years' THEN 'yr'
             WHEN 'yo' THEN 'yr'
             ELSE w
           END AS w
    FROM words
  )
  SELECT coalesce(array_agg(w), ARRAY[]::text[])
  FROM equiv
  -- NOISE set -- mirror scripts/eval_merge_policies.py's NOISE exactly.
  WHERE w <> '' AND w NOT IN (
    'the', 'label', 'co', 'company', 'distillery', 'distillers', 'and'
  );
$function$;

COMMENT ON FUNCTION public.beverage_tokenize IS
  'Tokenizes for beverage_identity_key(): wine_normalize_text, then unglues '
  'digit-letter boundaries (12yr -> 12 yr), collapses the yr-word family, '
  'drops noise words. MUST stay in lockstep with '
  'scripts/eval_merge_policies.py tokens() -- see this migration''s header.';

CREATE OR REPLACE FUNCTION public.beverage_identity_key(
  p_producer text,
  p_name     text
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $function$
DECLARE
  producer_tokens text[];
  name_tokens text[];
  residual text[] := ARRAY[]::text[];
  counts jsonb := '{}'::jsonb;
  t text;
  remaining int;
BEGIN
  producer_tokens := public.beverage_tokenize(p_producer);
  name_tokens := public.beverage_tokenize(p_name);

  -- Build a multiset (word -> count) of the name's tokens.
  FOREACH t IN ARRAY name_tokens LOOP
    counts := jsonb_set(counts, ARRAY[t], to_jsonb(coalesce((counts ->> t)::int, 0) + 1));
  END LOOP;

  -- Subtract one occurrence per producer token -- Counter subtraction, not
  -- set difference: "Buffalo Trace Buffalo Trace Kentucky Straight" has the
  -- producer's words appearing once each in the residual after this, not
  -- zero, because "Buffalo" and "Trace" each appear twice in the raw name
  -- and only one occurrence is the producer echo.
  FOREACH t IN ARRAY producer_tokens LOOP
    remaining := coalesce((counts ->> t)::int, 0);
    IF remaining > 0 THEN
      counts := jsonb_set(counts, ARRAY[t], to_jsonb(remaining - 1));
    END IF;
  END LOOP;

  -- Flatten the surviving multiset back into a sorted, duplicate-preserving
  -- array so two rows with the same residual multiset produce byte-identical
  -- keys regardless of original word order.
  FOR t IN SELECT jsonb_object_keys(counts) ORDER BY 1 LOOP
    remaining := (counts ->> t)::int;
    IF remaining > 0 THEN
      residual := residual || array_fill(t, ARRAY[remaining]);
    END IF;
  END LOOP;

  RETURN array_to_string(producer_tokens, ' ') || '||' || array_to_string(residual, ' ');
END;
$function$;

COMMENT ON FUNCTION public.beverage_identity_key IS
  'The merge/link decision key (arch §3.4): brand tokens + the COMPLETE '
  'residual multiset of the name, after subtracting the producer''s own '
  'tokens. Two rows with an equal key are the same product; unequal keys '
  'are treated as distinct even when superficially similar. Measured at 0 '
  'false merges across 732,874 known-distinct pairs '
  '(scripts/eval_merge_policies.py) -- the property that makes this safe is '
  'that an unrecognised token always counts as discriminating, so a gap in '
  'the EQUIV/NOISE tables costs a visible duplicate, never a silent global '
  'merge (arch §3.4).';

-- ---------------------------------------------------------------------
-- beverage_type: fine-grained category (whiskey/gin/rum/... ), distinct
-- from master_wine_library.beverage_kind (coarse: wine/beer/spirit/...,
-- the migration predicate). Same keyword-precedence approach as
-- wine_classify_beverage_kind, tuned to the finer grain the plan's §2
-- per-category view sketch actually needs.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.beverage_classify_type(
  p_menu_category text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $function$
  WITH mc AS (
    SELECT regexp_replace(lower(btrim(coalesce(p_menu_category, ''))), '[()]', '', 'g') AS v
  )
  SELECT CASE
    WHEN mc.v ~ '\m(sake|junmai|ginjo|daiginjo|honjozo)\M' THEN 'sake'
    WHEN mc.v ~ '\m(beer|birra|lager|pilsner|ipa|ale|stout|porter|hefeweizen)\M' THEN 'beer'
    WHEN mc.v ~ '\mcider\M' THEN 'cider'
    WHEN mc.v ~ '\m(zero.?proof|spirit.?free|non.?alcoholic|nonalcoholic|na)\M' THEN 'non_alcoholic'
    WHEN mc.v ~ '\m(whiskeys?|whiskys?|whiskies|scotch|bourbon|rye)\M' THEN 'whiskey'
    WHEN mc.v ~ '\m(tequila|mezcal|agave)\M' THEN 'agave_spirit'
    WHEN mc.v ~ '\mgin\M' THEN 'gin'
    WHEN mc.v ~ '\mrum\M' THEN 'rum'
    WHEN mc.v ~ '\mvodka\M' THEN 'vodka'
    WHEN mc.v ~ '\m(brandy|cognac|armagnac|calvados)\M' THEN 'brandy'
    WHEN mc.v ~ '\m(amari|amaro)\M' THEN 'amaro'
    WHEN mc.v ~ '\m(cordials?|liqueurs?|digestifs?|digestivi|apertivi|aperitifs?|vermouth)\M' THEN 'liqueur'
    WHEN mc.v ~ '\m(grappa|arak|cane|spirits?)\M' THEN 'spirit_other'
    ELSE 'other'
  END
  FROM mc;
$function$;

COMMENT ON FUNCTION public.beverage_classify_type IS
  'Fine-grained category from the menu''s own section header -- distinct '
  'from master_wine_library.beverage_kind, which is deliberately coarse '
  '(it is a migration predicate, not a display category). Basis for future '
  'per-category views (plan §2.1, arch §4) once a category''s population '
  'and query pressure justify one -- see arch §4.3''s promotion path before '
  'adding any.';

-- ---------------------------------------------------------------------
-- beverages: one physical row per bottle, typed columns for identity and
-- the wine-shaped sensory core (arch §4.5 -- sake needs body/acidity/
-- serving_temp/glass_type as real columns, not just a name and a price, or
-- it loses information on the way over from the wine-shaped world), plus
-- type_attributes JSONB for everything category-specific and descriptive
-- only. No per-category physical tables -- arch §4.2/§4.3: promote a
-- category individually, later, only once it clears an objective trigger.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.beverages (
  id                      uuid PRIMARY KEY,
  beverage_type           text NOT NULL DEFAULT 'other',
  name                    text NOT NULL,
  display_name            text,
  producer                text,
  brand                   text,
  country                 text,
  region                  text,
  abv_pct                 numeric,
  volume_ml               integer,
  package_format          text,
  price_reference         numeric,
  -- Market hint only, never a restaurant's actual price -- same caveat as
  -- master_wine_library.price_reference (arch §9.0/C12). Real prices live
  -- in menu_items / restaurant_inventory, scoped per restaurant.
  barcode                 text,
  sku                     text,
  upc                     text,
  ean                     text,
  -- 384, matching master_wine_library.embedding's actual live dimension
  -- (checked, not assumed -- 1536 was the OpenAI-ada convention, this
  -- schema uses a smaller model).
  embedding               vector(384),
  library_tier            integer,
  review_status           text,
  field_confidences       jsonb,
  data_enrichment         jsonb,
  signature_hash          text,
  normalized_name         text,
  normalized_producer     text,
  -- identity_key/identity_status: §3.4/§3.5, the merge/link decision layer.
  -- Auto-maintained by trigger below -- never set by application code.
  identity_key            text,
  identity_status         text NOT NULL DEFAULT 'normal'
    CHECK (identity_status IN ('normal', 'under_identified')),
  -- Sensory core (arch §4.5) -- real columns because sake, and eventually
  -- other categories sold and reasoned about like wine, need them queried
  -- and indexed the same way master_wine_library's do, not buried in JSONB.
  body                    text,
  acidity                 text,
  serving_temp_celsius    numeric,
  glass_type              text,
  -- Parsed projections (arch §4.1) -- best-effort, NOT authoritative for
  -- identity. A null age_years on a row whose name says "12 yr" is a
  -- parsing miss, not an identity change; identity_key already has the
  -- token. Left NULL at migration time -- parsing is separate, future work
  -- (arch §8: discriminator-parse coverage was measured low, 13%/10%/0%/0%,
  -- which is exactly why identity does not depend on these columns).
  age_years               integer,
  cask_finish             text,
  expression               text,
  proof                   numeric,
  type_attributes         jsonb NOT NULL DEFAULT '{}'::jsonb,
  observed_at             timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  deleted_at              timestamptz,
  -- Non-destructive merge (arch §3.7): a superseded row is never deleted,
  -- only pointed at its keeper. Mirrors wine_aliases.canonical_id's role
  -- for master_wine_library.
  superseded_by           uuid REFERENCES public.beverages(id)
);

COMMENT ON TABLE public.beverages IS
  'One physical row per non-wine, non-cocktail bottle. Identity is decided '
  'by identity_key (arch §3.4), never a similarity score. Per-category '
  'shapes (whiskey, sake, ...) are VIEWS over type_attributes, not physical '
  'tables -- promote individually only per arch §4.3''s objective triggers. '
  'See BEVERAGE_CATALOGUE_PLAN.md §2 and BEVERAGE_CATALOGUE_ARCHITECTURE.md '
  '§4.';
COMMENT ON COLUMN public.beverages.price_reference IS
  'Market hint only -- never a restaurant''s actual price. Prices are '
  'relationship outcomes (arch §9.0); real prices live in menu_items / '
  'restaurant_inventory, scoped per restaurant.';
COMMENT ON COLUMN public.beverages.age_years IS
  'Best-effort parsed projection, NOT authoritative for identity -- '
  'identity_key already carries this information via its residual tokens. '
  'See arch §4.1.';
COMMENT ON COLUMN public.beverages.identity_status IS
  'under_identified: mirrors master_wine_library''s quarantine (arch §3.5) '
  '-- ineligible to merge, ineligible as a fuzzy match target.';

CREATE INDEX IF NOT EXISTS idx_beverages_beverage_type ON public.beverages (beverage_type);
CREATE INDEX IF NOT EXISTS idx_beverages_identity_key ON public.beverages (identity_key);
CREATE INDEX IF NOT EXISTS idx_beverages_normalized_name ON public.beverages (normalized_name);
CREATE INDEX IF NOT EXISTS idx_beverages_normalized_producer ON public.beverages (normalized_producer);
CREATE INDEX IF NOT EXISTS idx_beverages_barcode ON public.beverages (barcode) WHERE barcode IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_beverages_deleted_at ON public.beverages (deleted_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_beverages_signature_hash
  ON public.beverages (signature_hash) WHERE signature_hash IS NOT NULL;

ALTER TABLE public.beverages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS beverages_service_role ON public.beverages;
CREATE POLICY beverages_service_role ON public.beverages
  FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS beverages_authenticated_read ON public.beverages;
CREATE POLICY beverages_authenticated_read ON public.beverages
  FOR SELECT TO authenticated USING (deleted_at IS NULL);

CREATE OR REPLACE FUNCTION public.set_beverage_identity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.normalized_name := public.wine_normalize_text(NEW.name);
  NEW.normalized_producer := public.wine_normalize_text(NEW.producer);
  NEW.identity_key := public.beverage_identity_key(NEW.producer, NEW.name);
  NEW.identity_status := CASE
    WHEN NEW.normalized_name <> '' AND NEW.normalized_producer = NEW.normalized_name
      THEN 'under_identified'
    ELSE 'normal'
  END;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_beverage_identity ON public.beverages;
CREATE TRIGGER trg_beverage_identity
  BEFORE INSERT OR UPDATE ON public.beverages
  FOR EACH ROW
  EXECUTE FUNCTION public.set_beverage_identity();

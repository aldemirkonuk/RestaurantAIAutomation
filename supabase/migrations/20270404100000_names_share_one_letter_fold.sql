-- One letter fold for every name normaliser that keys a product.
--
-- WHY
--
-- wine_names_fold_turkish_dotless_i taught public.wine_normalize_text to
-- fold Turkish dotless "ı" (U+0131) to "i" with an inline translate(). QA
-- round 5 (#785) found the other product key still split: beverage_normalize_
-- text (beverages.identity_key, through beverage_tokenize /
-- beverage_identity_key) turned "ı" into nothing at all, so "Kavaklıdere"
-- and "KAVAKLIDERE" were two beverages. Each normaliser carrying its own copy
-- of the fold is how one of them was missed.
--
-- WHAT
--
-- public.fold_undecomposable_letters(), translate(value, 'ı', 'i'), applied
-- after the diacritic strip and before lower() by both:
--
--   wine_normalize_text      redefined to call it instead of its inline
--                            translate(); its output does not change
--   beverage_normalize_text  gains the fold; otherwise the
--                            20260817070000_beverages_table body verbatim
--
-- translate() rather than lower(), because lower() of a non-ASCII letter
-- depends on the database's ctype and the fold must not. The TypeScript twin
-- is UNDECOMPOSABLE_LETTERS in apps/api-gateway/src/common/fold-letters.ts
-- (normalizeSignatureText uses it); the Python mirrors are
-- scripts/synth/identity.py, scripts/load_enriched_wines.py and
-- scripts/eval_merge_policies.py norm(). fold-letters.spec.ts reads all of
-- them and the latest SQL definitions, and fails when one drifts.
--
-- beverage_normalize_text must stay byte-compatible with
-- scripts/eval_merge_policies.py norm() (scripts/check_beverage_identity_
-- parity.py); both gain the fold in this branch. The merge-eval corpus
-- (datasets/merge_eval/entries.json, 4,822 entries) holds no "ı", so the 0a
-- gate's false-merge measurement is unchanged (re-run 2026-11-07: identical
-- output before and after).
--
-- A separate migration rather than an edit to wine_names_fold_turkish_
-- dotless_i, so that file can ship on its own and be applied without this
-- one; an applied migration is never edited.
--
-- Not touched: master_wine_library.signature_hash (the later migration
-- wine_signatures_refold_dotless_i recomputes it).

CREATE OR REPLACE FUNCTION public.fold_undecomposable_letters(value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  -- Letters NFD cannot reach. Mirrored verbatim in
  -- apps/api-gateway/src/common/fold-letters.ts UNDECOMPOSABLE_LETTERS --
  -- change both together (fold-letters.spec.ts fails on drift).
  SELECT translate(value, 'ı', 'i');
$$;

COMMENT ON FUNCTION public.fold_undecomposable_letters(text) IS
  'Folds letters Unicode NFD cannot decompose (Turkish dotless i) to the '
  'letter their capital spells. Called after the diacritic strip and before '
  'lower() by wine_normalize_text and beverage_normalize_text. Twin of '
  'UNDECOMPOSABLE_LETTERS in apps/api-gateway/src/common/fold-letters.ts.';

CREATE OR REPLACE FUNCTION public.wine_normalize_text(value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT btrim(
    regexp_replace(
      regexp_replace(
      regexp_replace(
      regexp_replace(
      regexp_replace(
      regexp_replace(
      regexp_replace(
      regexp_replace(
      regexp_replace(
      regexp_replace(
      regexp_replace(
      regexp_replace(
      regexp_replace(
      regexp_replace(
        lower(
          -- Letters NFD cannot reach: the shared fold, defined above.
          public.fold_undecomposable_letters(
            regexp_replace(
              normalize(coalesce(value, ''), NFD),
              -- Shared diacritic class. Mirrored verbatim in
              -- wine-signature.ts DIACRITICS -- change both together.
              '[̀-ͯ᪰-᫿᷀-᷿︠-︯^`¨¯´·¸ʰ-˿ʹ͵ͺ΄΅]', '', 'g'
            )
          )
        ),
        '\maz\.\s*agr\.\s*', 'azienda agricola ', 'g'),
        '\mdom\.\s*',        'domaine ',          'g'),
        '\mch\.\s*',         'chateau ',          'g'),
        '\mcht\.\s*',        'chateau ',          'g'),
        '\mbod\.\s*',        'bodegas ',          'g'),
        '\mwgt\.\s*',        'weingut ',          'g'),
        '\mten\.\s*',        'tenuta ',           'g'),
        '\mfatt\.\s*',       'fattoria ',         'g'),
        '\mcant\.\s*',       'cantina ',          'g'),
        '\mmarch\.\s*',      'marchesi ',         'g'),
        '\mste\.\s*',        'sainte ',           'g'),
        '\mst\.\s*',         'saint ',            'g'),
        '\mmt\.\s*',         'monte ',            'g'),
      -- everything that is not a letter or digit becomes a single space
      '[^a-z0-9]+', ' ', 'g')
  );
$$;

COMMENT ON FUNCTION public.wine_normalize_text(text) IS
  'SQL mirror of normalizeSignatureText (apps/api-gateway/src/wines/'
  'wine-signature.ts): NFD, diacritic strip, fold_undecomposable_letters, lowercase, '
  'trade-abbreviation expansion, non-alphanumerics to one space. Parity is '
  'pinned by wine-submissions.service.spec.ts fixtures.';

-- beverage_normalize_text: the same fold in the same position. The body is
-- otherwise the 20260817070000_beverages_table definition verbatim, so it
-- stays byte-compatible with scripts/eval_merge_policies.py norm(), which
-- gains the same fold in this branch.
CREATE OR REPLACE FUNCTION public.beverage_normalize_text(p_text text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $function$
  -- Deliberately NOT wine_normalize_text: no trade-abbreviation expansion
  -- (see 20260817070000_beverages_table for the 67-divergence parity run that
  -- decided it). NFD, diacritic strip (the shared class), the shared fold of
  -- letters NFD cannot reach, lowercase.
  SELECT lower(
    public.fold_undecomposable_letters(
      regexp_replace(
        normalize(coalesce(p_text, ''), NFD),
        '[̀-ͯ᪰-᫿᷀-᷿︠-︯^`¨¯´·¸ʰ-˿ʹ͵ͺ΄΅]', '', 'g'
      )
    )
  );
$function$;

COMMENT ON FUNCTION public.beverage_normalize_text IS
  'NFD + diacritic strip + fold_undecomposable_letters + lowercase, matching '
  'scripts/eval_merge_policies.py norm() exactly -- no abbreviation '
  'expansion, unlike wine_normalize_text. See 20260817070000_beverages_table '
  'for why reusing wine_normalize_text was tried and reverted.';

-- Refresh beverages.identity_key for rows with "ı". trg_beverage_identity
-- fires on every UPDATE: it re-derives normalized_name / normalized_producer
-- (unchanged here: wine_normalize_text returns what it did before this
-- file) and recomputes identity_key through beverage_identity_key, which now
-- folds "ı" through beverage_normalize_text. identity_key is non-unique
-- (idx_beverages_identity_key), so no row can be refused here.
UPDATE public.beverages
SET normalized_name     = public.wine_normalize_text(name),
    normalized_producer = public.wine_normalize_text(producer)
WHERE name LIKE '%ı%' OR producer LIKE '%ı%';

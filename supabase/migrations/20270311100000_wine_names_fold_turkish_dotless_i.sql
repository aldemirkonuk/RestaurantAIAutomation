-- Fold Turkish dotless "ı" in wine_normalize_text, so "Kavaklıdere" and
-- "KAVAKLIDERE" are one wine.
--
-- THE DEFECT (QA round 1, B-1)
--
-- U+0131 LATIN SMALL LETTER DOTLESS I has no Unicode decomposition. NFD leaves
-- it as is, the diacritic class does not contain it, and the final
-- '[^a-z0-9]+' pass turns it into a space:
--
--     Kavaklıdere          -> "kavakl dere"
--     KAVAKLIDERE          -> "kavaklidere"
--     Kalecik Karası       -> "kalecik karas"
--     KALECIK KARASI       -> "kalecik karasi"
--
-- Menus print mixed case and invoices print capitals, so the same Turkish
-- bottle got two signature hashes: a duplicate library row, an invoice line
-- that never matches, and a price history split in two.
--
-- The rest of the Turkish alphabet already folds. "İ" is I + U+0307, and
-- "ş ğ ç ö ü" are base letter + combining mark (U+0327, U+0306, U+0308), all
-- deleted by the shared diacritic class. Only "ı" was left over.
--
-- THE FIX
--
-- translate(..., 'ı', 'i') after the diacritic strip and before lower(). That
-- is the same position the TypeScript half (normalizeSignatureText in
-- apps/api-gateway/src/wines/wine-signature.ts, UNDECOMPOSABLE) applies it, and
-- the Python mirrors (scripts/synth/identity.py, scripts/load_enriched_wines.py)
-- were changed in the same commit. translate() is used rather than relying on
-- lower(), because lower() of a non-ASCII letter depends on the database's
-- ctype; the fold must not.
--
-- Everything else in the body is unchanged from the definition in
-- 20260813060000_expand_trade_abbreviations (the latest before this one).
--
-- WHAT THIS DOES NOT DO: RECOMPUTE STORED KEYS
--
-- Any stored row whose identity fields contain "ı" now has a signature_hash /
-- normalized_* computed with the old rule. There is no backfill here on
-- purpose: a recomputed hash can collide with the UNIQUE index on
-- master_wine_library.signature_hash (that collision IS the duplicate this
-- fixes, and it needs a merge decision, not an UPDATE), and the same hash is
-- copied into master_wine_library_submissions, restaurant_wine_roster and
-- menu_changes. The rows show up in v_signature_drift, and
-- fn_repair_signature_hashes(false) reports them, skipping collisions, before
-- anyone applies it. Filed in .planning/tech-debt.d.

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
          -- Letters NFD cannot reach. Mirrored verbatim in
          -- wine-signature.ts UNDECOMPOSABLE -- change both together.
          translate(
            regexp_replace(
              normalize(coalesce(value, ''), NFD),
              -- Shared diacritic class. Mirrored verbatim in
              -- wine-signature.ts DIACRITICS -- change both together.
              '[̀-ͯ᪰-᫿᷀-᷿︠-︯^`¨¯´·¸ʰ-˿ʹ͵ͺ΄΅]', '', 'g'
            ),
            'ı', 'i'
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
  'wine-signature.ts): NFD, diacritic strip, dotless-i fold, lowercase, '
  'trade-abbreviation expansion, non-alphanumerics to one space. Parity is '
  'pinned by wine-submissions.service.spec.ts fixtures.';

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
-- WHAT THIS DOES: REFRESH THE STORED NORMALISED NAMES (bottom of this file)
--
-- Replacing the function alone would make a re-import of a wine the library
-- already holds WORSE, not better. Take "Kavaklıdere / Yakut", stored before
-- this migration with normalized_producer "kavakl dere". After the function
-- changes, the same menu line normalises to "kavaklidere" and hashes under
-- the new rule, so the signature leg of match_library_wine misses (stored
-- hash is old), and the producer similarity is
-- word_similarity('kavaklidere', 'kavakl dere') = 0.6: confidence 60, under
-- AUTO_LINK_CONFIDENCE (85). resolveOrCreateLibraryWine would then create a
-- new provisional row on every import -- the duplicate this fixes.
--
-- So normalized_name / normalized_producer are recomputed here for every row
-- whose name or producer holds an "ı", on master_wine_library and on
-- beverages (set_beverage_identity fills both from wine_normalize_text).
-- Neither column is unique, and on master_wine_library the UPDATE does not
-- fire trg_sync_signature_hash (its UPDATE OF list is identity columns only),
-- so signature_hash is untouched. trg_wine_identity_status re-derives
-- identity_status from the new values, as it does on any write. Precedent:
-- 20260813060000_expand_trade_abbreviations refreshed the same two columns.
-- With the refresh, the line above reaches the stored row through the
-- normalized-name leg with name and producer similarity 1: confidence 100.
--
-- WHAT THIS DOES NOT DO: RECOMPUTE signature_hash
--
-- Any stored row whose identity fields contain "ı" keeps a signature_hash
-- computed with the old rule. It is not recomputed here on purpose: a new
-- hash can collide with the UNIQUE index on master_wine_library.
-- signature_hash (that collision IS the duplicate this fixes, and it needs a
-- merge decision, not an UPDATE), and the same hash is copied into
-- master_wine_library_submissions, restaurant_wine_roster and menu_changes.
-- The rows show up in v_signature_drift, and fn_repair_signature_hashes(false)
-- reports them, skipping collisions, before anyone applies it. Filed in
-- .planning/tech-debt.d.

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

-- Refresh the derived, non-unique keys of rows the fold changes (see header).
-- Only a lowercase "ı" changes the output: "I" and "İ" already folded to "i".
UPDATE public.master_wine_library
SET normalized_name     = public.wine_normalize_text(name),
    normalized_producer = public.wine_normalize_text(producer)
WHERE name LIKE '%ı%' OR producer LIKE '%ı%';

-- trg_beverage_identity fires on every UPDATE and sets the same two columns
-- from the same function (plus updated_at); setting them here keeps the
-- statement correct even if that trigger is ever narrowed.
UPDATE public.beverages
SET normalized_name     = public.wine_normalize_text(name),
    normalized_producer = public.wine_normalize_text(producer)
WHERE name LIKE '%ı%' OR producer LIKE '%ı%';

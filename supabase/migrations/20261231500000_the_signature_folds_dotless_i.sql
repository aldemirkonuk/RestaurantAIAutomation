-- F-356 (owner-quarter sim, wave 6): the Turkish dotless ı split a wine from
-- itself. ı (U+0131) has no NFD decomposition, so wine_normalize_text kept it
-- through the diacritic strip and the final [^a-z0-9] pass turned it into a
-- space: "Kalecik Karası" -> 'kalecik karas', "KALECIK KARASI" ->
-- 'kalecik karasi', "Kavaklıdere" -> 'kavakl dere'. A Turkish menu line, a
-- capitalised label and an ASCII invoice line never met the same library row.
--
-- The fix folds ı and İ to i before NFD (İ already came out as i; it is listed
-- for symmetry with foldText). The TypeScript half is normalizeSignatureText
-- in apps/api-gateway/src/wines/wine-signature.ts; the parity spec pins both.
--
-- Stored keys: master_wine_library.normalized_name / normalized_producer /
-- signature_hash and beverages.normalized_name / normalized_producer are
-- derived from this function, never typed by a house. Changing the function
-- without them would leave every stored Turkish key in a space nothing
-- reaches, so the rows whose value changes are recomputed here — and only
-- those. Rows whose new hash would collide with another row are left exactly
-- as they are and counted; nothing is merged or deleted. Decision note:
-- p4-scratch/sim-run/bulletproof/wave6sim/signature-fold-decision.md.

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
          regexp_replace(
            -- ı and İ fold to i first: ı has no NFD decomposition, so without
            -- this it survives the strip and the last pass splits the word.
            normalize(translate(coalesce(value, ''), 'ıİ', 'ii'), NFD),
            -- Shared diacritic class. Mirrored verbatim in
            -- WineSubmissionsService.DIACRITICS — change both together.
            '[̀-ͯ᪰-᫿᷀-᷿︠-︯^`¨¯´·¸ʰ-˿ʹ͵ͺ΄΅]', '', 'g'
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
  'wine-signature.ts): Turkish ı/İ fold to i, NFD diacritic strip, trade-'
  'abbreviation expansion. Parity is pinned by wine-submissions.service.spec.ts.';

-- Recompute the keys the fold changes. A function, not an inline block, so the
-- test can seed rows in the old state and prove the recompute and the
-- collision rule; the migration calls it once below. Safe to re-run: a second
-- call finds nothing left to move.
CREATE OR REPLACE FUNCTION public.wine_refold_dotless_i()
RETURNS TABLE (recomputed integer, kept_for_collision integer, beverages_refreshed integer)
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_changed integer;
BEGIN
  -- Candidates: only a field holding ı can normalize differently now. The old
  -- function turned ı into a separator, so its value is reproduced exactly as
  -- the new function over the text with ı replaced by a space.
  CREATE TEMP TABLE refold ON COMMIT DROP AS
  SELECT m.id,
         m.signature_hash AS stored_hash,
         public.wine_normalize_text(m.name)     AS new_nn,
         public.wine_normalize_text(m.producer) AS new_np,
         CASE WHEN m.provisional_for_restaurant_id IS NULL
           THEN public.wine_signature_hash(m.producer, m.name, m.vintage,
                                           m.country, m.region, m.grape_variety)
           ELSE public.wine_provisional_signature_hash(
                  m.provisional_for_restaurant_id, m.producer, m.name, m.vintage,
                  m.country, m.region, m.grape_variety)
         END AS new_hash,
         CASE WHEN m.provisional_for_restaurant_id IS NULL
           THEN public.wine_signature_hash(
                  replace(m.producer, 'ı', ' '), replace(m.name, 'ı', ' '), m.vintage,
                  replace(m.country, 'ı', ' '), replace(m.region, 'ı', ' '),
                  replace(m.grape_variety, 'ı', ' '))
           ELSE public.wine_provisional_signature_hash(
                  m.provisional_for_restaurant_id,
                  replace(m.producer, 'ı', ' '), replace(m.name, 'ı', ' '), m.vintage,
                  replace(m.country, 'ı', ' '), replace(m.region, 'ı', ' '),
                  replace(m.grape_variety, 'ı', ' '))
         END AS old_hash,
         false AS keep
  FROM public.master_wine_library m
  WHERE concat_ws('|', m.producer, m.name, m.country, m.region, m.grape_variety) LIKE '%ı%';

  -- The hash moves only for a row that was in sync with the old formula. A
  -- drifted or NULL hash stays as it is: repairing drift is
  -- fn_repair_signature_hashes' job, with its own collision report.
  ALTER TABLE refold ADD COLUMN moves boolean;
  UPDATE refold SET moves = (stored_hash IS NOT DISTINCT FROM old_hash
                             AND new_hash IS DISTINCT FROM stored_hash);

  -- Collision rule: a row whose new hash another row would also hold is not
  -- changed at all. Iterated, because keeping a row keeps its old hash, which
  -- can block a row that was about to move onto it.
  LOOP
    UPDATE refold r SET keep = true
    WHERE NOT r.keep AND r.moves AND (
      EXISTS (SELECT 1 FROM public.master_wine_library m
              WHERE m.signature_hash = r.new_hash AND m.id <> r.id
                AND NOT EXISTS (SELECT 1 FROM refold o
                                WHERE o.id = m.id AND o.moves AND NOT o.keep))
      OR EXISTS (SELECT 1 FROM refold o
                 WHERE o.id <> r.id AND o.moves AND NOT o.keep
                   AND o.new_hash = r.new_hash)
    );
    GET DIAGNOSTICS v_changed = ROW_COUNT;
    EXIT WHEN v_changed = 0;
  END LOOP;

  -- Two passes so two moving rows trading keys never meet mid-statement on
  -- the unique index. Neither pass touches an identity column, so the
  -- signature trigger does not fire.
  UPDATE public.master_wine_library m SET signature_hash = NULL
  FROM refold r WHERE m.id = r.id AND r.moves AND NOT r.keep;

  UPDATE public.master_wine_library m
  SET normalized_name     = r.new_nn,
      normalized_producer = r.new_np,
      signature_hash      = CASE WHEN r.moves THEN r.new_hash ELSE m.signature_hash END
  FROM refold r
  WHERE m.id = r.id AND NOT r.keep
    AND (r.moves
         OR m.normalized_name     IS DISTINCT FROM r.new_nn
         OR m.normalized_producer IS DISTINCT FROM r.new_np);
  GET DIAGNOSTICS recomputed = ROW_COUNT;

  SELECT count(*)::integer INTO kept_for_collision FROM refold WHERE keep;

  -- beverages keeps its own normalized_* through set_beverage_identity, which
  -- runs on any update; touching the row is the recompute.
  UPDATE public.beverages b SET name = b.name
  WHERE concat_ws('|', b.name, b.producer) LIKE '%ı%'
    AND (b.normalized_name     IS DISTINCT FROM public.wine_normalize_text(b.name)
      OR b.normalized_producer IS DISTINCT FROM public.wine_normalize_text(b.producer));
  GET DIAGNOSTICS beverages_refreshed = ROW_COUNT;

  DROP TABLE refold;
  RETURN NEXT;
END $fn$;

COMMENT ON FUNCTION public.wine_refold_dotless_i() IS
  'Recomputes the stored wine keys the dotless-ı fold changed (F-356). A row '
  'whose new signature_hash would collide with another row is left unchanged '
  'and counted in kept_for_collision; nothing is merged or deleted. Those rows '
  'show in v_signature_drift for a merge decision.';

REVOKE ALL ON FUNCTION public.wine_refold_dotless_i() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  r record;
BEGIN
  SELECT * INTO r FROM public.wine_refold_dotless_i();
  RAISE NOTICE 'dotless-ı fold: % library row(s) recomputed, % beverage row(s) refreshed',
    r.recomputed, r.beverages_refreshed;
  IF r.kept_for_collision > 0 THEN
    RAISE NOTICE
      'dotless-ı fold: % row(s) left unchanged because their folded key collides '
      'with another row — see v_signature_drift; merge with '
      'merge_library_wines(keeper, loser, false) if they are the same wine',
      r.kept_for_collision;
  END IF;
END $$;

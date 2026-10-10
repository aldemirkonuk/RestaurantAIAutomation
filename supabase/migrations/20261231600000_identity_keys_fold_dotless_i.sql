-- F-373 (owner-quarter sim, wave 6): the beverages identity key had the same
-- dotless-ı gap the wine signature had (F-356, the_signature_folds_dotless_i).
-- ı (U+0131) has no NFD decomposition, so beverage_normalize_text kept it and
-- beverage_tokenize's [^a-z0-9] pass split the word on it: "Kalecik Karası"
-- tokenized to 'kalecik karas', "KALECIK KARASI" to 'kalecik karasi', and the
-- two rows never shared an identity_key.
--
-- The fix folds ı and İ to i before NFD (İ already came out as i; it is listed
-- for symmetry with foldText). The Python reference norm() in
-- scripts/eval_merge_policies.py folds the same way, so
-- scripts/check_beverage_identity_parity.py keeps holding; the merge eval still
-- reports 0 false merges across 732,874 known-distinct pairs with the fold.
--
-- Stored keys: beverages.identity_key is derived from this function by
-- set_beverage_identity, never typed by a house. Rows whose key changes are
-- recomputed here, and only those. A row whose folded key would equal another
-- row's key is left exactly as it is and counted; nothing is merged or
-- deleted. Same rule as the signature fold; decision note:
-- p4-scratch/sim-run/bulletproof/wave6sim/signature-fold-decision.md.
--
-- Not recomputed, only counted below: beverage_identities.producer_normalised /
-- name_normalised and vendor_price_observations.signature_hash come from the
-- gateway's normalizeIdentityText (folded in the same change), but neither
-- table keeps the source text the parts were cut from, so the old value cannot
-- be reproduced and the row cannot be moved safely.

CREATE OR REPLACE FUNCTION public.beverage_normalize_text(p_text text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $function$
  -- Deliberately NOT wine_normalize_text: no abbreviation table, so it stays
  -- byte-compatible with scripts/eval_merge_policies.py norm() (see
  -- 20260817070000_beverages_table.sql for the 67-divergence story). ı and İ
  -- fold to i first: ı has no NFD decomposition, so without this it survives
  -- the strip and beverage_tokenize splits the word on it.
  SELECT lower(
    regexp_replace(
      normalize(translate(coalesce(p_text, ''), 'ıİ', 'ii'), NFD),
      '[̀-ͯ᪰-᫿᷀-᷿︠-︯^`¨¯´·¸ʰ-˿ʹ͵ͺ΄΅]', '', 'g'
    )
  );
$function$;

COMMENT ON FUNCTION public.beverage_normalize_text IS
  'Turkish ı/İ fold to i, then NFD + diacritic strip + lowercase, matching '
  'scripts/eval_merge_policies.py norm() exactly -- no abbreviation '
  'expansion, unlike wine_normalize_text. See 20260817070000 for why reusing '
  'wine_normalize_text was tried and reverted.';

-- Recompute the identity keys the fold changes. A function, not an inline
-- block, so the test can seed rows in the old state and prove the recompute
-- and the collision rule; the migration calls it once below. Safe to re-run:
-- a second call finds nothing left to move.
CREATE OR REPLACE FUNCTION public.beverage_refold_dotless_i()
RETURNS TABLE (recomputed integer, kept_for_collision integer)
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_changed integer;
BEGIN
  -- Candidates: only a producer or name holding ı can key differently now. The
  -- old tokenizer turned ı into a separator, so the old key is reproduced
  -- exactly as the new key over the text with ı replaced by a space.
  CREATE TEMP TABLE bev_refold ON COMMIT DROP AS
  SELECT b.id,
         b.identity_key AS stored_key,
         public.beverage_identity_key(b.producer, b.name) AS new_key,
         public.beverage_identity_key(replace(b.producer, 'ı', ' '),
                                      replace(b.name, 'ı', ' ')) AS old_key,
         false AS keep
  FROM public.beverages b
  WHERE concat_ws('|', b.producer, b.name) LIKE '%ı%';

  -- A key moves only for a row that was in sync with the old formula.
  ALTER TABLE bev_refold ADD COLUMN moves boolean;
  UPDATE bev_refold SET moves = (stored_key IS NOT DISTINCT FROM old_key
                                 AND new_key IS DISTINCT FROM stored_key);

  -- Collision rule: a row whose new key another row would also hold is not
  -- changed at all. Iterated, because keeping a row keeps its old key, which
  -- can block a row that was about to move onto it.
  LOOP
    UPDATE bev_refold r SET keep = true
    WHERE NOT r.keep AND r.moves AND (
      EXISTS (SELECT 1 FROM public.beverages b
              WHERE b.identity_key = r.new_key AND b.id <> r.id
                AND NOT EXISTS (SELECT 1 FROM bev_refold o
                                WHERE o.id = b.id AND o.moves AND NOT o.keep))
      OR EXISTS (SELECT 1 FROM bev_refold o
                 WHERE o.id <> r.id AND o.moves AND NOT o.keep
                   AND o.new_key = r.new_key)
    );
    GET DIAGNOSTICS v_changed = ROW_COUNT;
    EXIT WHEN v_changed = 0;
  END LOOP;

  -- set_beverage_identity rewrites identity_key on any update, so touching the
  -- row is the recompute. Its updated_at moves with it.
  UPDATE public.beverages b SET name = b.name
  FROM bev_refold r
  WHERE b.id = r.id AND r.moves AND NOT r.keep;
  GET DIAGNOSTICS recomputed = ROW_COUNT;

  SELECT count(*)::integer INTO kept_for_collision FROM bev_refold WHERE keep;

  DROP TABLE bev_refold;
  RETURN NEXT;
END $fn$;

COMMENT ON FUNCTION public.beverage_refold_dotless_i() IS
  'Recomputes the beverages.identity_key values the dotless-ı fold changed '
  '(F-373). A row whose new key would equal another row''s key is left '
  'unchanged and counted in kept_for_collision; nothing is merged or deleted.';

REVOKE ALL ON FUNCTION public.beverage_refold_dotless_i() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  r record;
  n_identities integer;
  n_prices integer;
BEGIN
  SELECT * INTO r FROM public.beverage_refold_dotless_i();
  RAISE NOTICE 'dotless-ı fold: % beverage identity key(s) recomputed', r.recomputed;
  IF r.kept_for_collision > 0 THEN
    RAISE NOTICE
      'dotless-ı fold: % beverage row(s) left unchanged because their folded '
      'identity key equals another row''s — review them with find_beverage_duplicates',
      r.kept_for_collision;
  END IF;

  SELECT count(*) INTO n_identities FROM public.beverage_identities
   WHERE display_label LIKE '%ı%';
  SELECT count(*) INTO n_prices FROM public.vendor_price_observations
   WHERE product_name_raw LIKE '%ı%';
  IF n_identities + n_prices > 0 THEN
    RAISE NOTICE
      'dotless-ı fold: % beverage_identities and % vendor_price_observations '
      'row(s) carry ı and keep the keys the old gateway fold gave them',
      n_identities, n_prices;
  END IF;
END $$;

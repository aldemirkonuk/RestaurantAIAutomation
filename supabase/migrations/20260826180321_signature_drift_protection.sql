-- Keeps signature_hash from ever drifting away from the identity fields again.
-- Measured before this migration: 1,431 / 4,094 rows (35%) had a signature_hash
-- that did not match wine_signature_hash(...) of their own columns, which
-- silently disabled the UNIQUE index that prevents duplicate wines.

CREATE OR REPLACE FUNCTION trg_fn_sync_signature_hash()
RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  NEW.signature_hash := wine_signature_hash(
    NEW.producer, NEW.name, NEW.vintage, NEW.country, NEW.region, NEW.grape_variety
  );
  NEW.normalized_name     := wine_normalize_text(NEW.name);
  NEW.normalized_producer := wine_normalize_text(NEW.producer);
  RETURN NEW;
END $fn$;

COMMENT ON FUNCTION trg_fn_sync_signature_hash IS
  'signature_hash is derived state, never client-supplied. Any writer that '
  'edits producer/name/vintage/country/region/grape_variety gets a fresh hash '
  'automatically, so the UNIQUE index keeps working.';

DROP TRIGGER IF EXISTS trg_sync_signature_hash ON master_wine_library;
CREATE TRIGGER trg_sync_signature_hash
  BEFORE INSERT OR UPDATE OF producer, name, vintage, country, region, grape_variety
  ON master_wine_library
  FOR EACH ROW EXECUTE FUNCTION trg_fn_sync_signature_hash();

CREATE OR REPLACE VIEW v_signature_drift AS
SELECT id, wine_id, name, producer, vintage, source, created_at,
       signature_hash AS stored_hash,
       wine_signature_hash(producer,name,vintage,country,region,grape_variety) AS correct_hash
FROM master_wine_library
WHERE deleted_at IS NULL
  AND signature_hash IS DISTINCT FROM
      wine_signature_hash(producer,name,vintage,country,region,grape_variety);

COMMENT ON VIEW v_signature_drift IS
  'Rows whose stored dedup hash no longer matches their own identity fields. '
  'Each one is a hole in duplicate protection.';

-- Safe repair: reports by default, only writes when p_apply is true, and
-- never touches a row whose corrected hash would collide with another row.
CREATE OR REPLACE FUNCTION fn_repair_signature_hashes(p_apply boolean DEFAULT false)
RETURNS TABLE (wine_id text, action text, detail text)
LANGUAGE plpgsql AS $fn$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT d.id, d.wine_id AS code, d.correct_hash, d.name, d.producer
    FROM v_signature_drift d
  LOOP
    IF EXISTS (SELECT 1 FROM master_wine_library m
               WHERE m.signature_hash = r.correct_hash AND m.id <> r.id) THEN
      wine_id := r.code; action := 'SKIPPED_COLLISION';
      detail  := format('%s / %s already occupies the corrected hash; needs a merge decision', r.producer, r.name);
      RETURN NEXT;
    ELSE
      IF p_apply THEN
        UPDATE master_wine_library SET signature_hash = r.correct_hash WHERE id = r.id;
        wine_id := r.code; action := 'REPAIRED';
      ELSE
        wine_id := r.code; action := 'WOULD_REPAIR';
      END IF;
      detail := format('%s / %s', r.producer, r.name);
      RETURN NEXT;
    END IF;
  END LOOP;
END $fn$;

COMMENT ON FUNCTION fn_repair_signature_hashes IS
  'Dry-run by default. SELECT * FROM fn_repair_signature_hashes(false) to preview, '
  '(true) to apply. Collisions are reported, never silently resolved.';

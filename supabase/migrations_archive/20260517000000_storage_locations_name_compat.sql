-- storage_locations: backward-compatibility 'name' column
--
-- Schema A (20260208024921_new-migration.sql) has: name VARCHAR(255) NOT NULL
-- Schema B (production SQL editor) has: zone, section (no name column)
--
-- This migration adds 'name' on Schema B databases so any code that queries
-- storage_locations.name no longer gets "column does not exist".
-- Schema A databases already have 'name'; ADD COLUMN IF NOT EXISTS safely skips it.

-- Step 1: Add column (no-op if already present)
ALTER TABLE storage_locations ADD COLUMN IF NOT EXISTS name TEXT;

-- Step 2: Backfill + trigger — guarded at runtime by checking for zone column
DO $outer$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'storage_locations'
      AND column_name  = 'zone'
  ) THEN
    -- Backfill rows where name is null using zone and (if available) section
    UPDATE storage_locations
    SET name = (
      SELECT COALESCE(
        CASE
          WHEN sl2.section IS NOT NULL AND sl2.section <> ''
            THEN sl2.zone || ' - ' || sl2.section
          ELSE sl2.zone
        END,
        'Unknown Location'
      )
      FROM storage_locations sl2
      WHERE sl2.id = storage_locations.id
    )
    WHERE name IS NULL;

    -- Trigger function to keep name in sync
    IF NOT EXISTS (
      SELECT 1 FROM pg_proc WHERE proname = '_sync_storage_location_name'
    ) THEN
      EXECUTE '
        CREATE FUNCTION _sync_storage_location_name()
        RETURNS TRIGGER LANGUAGE plpgsql AS
        $func$
        BEGIN
          NEW.name := COALESCE(
            CASE
              WHEN NEW.section IS NOT NULL AND NEW.section <> ''''
                THEN NEW.zone || '' - '' || NEW.section
              ELSE NEW.zone
            END,
            ''Unknown Location''
          );
          RETURN NEW;
        END;
        $func$
      ';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      WHERE t.tgname = 'trg_storage_location_name'
        AND c.relname = 'storage_locations'
    ) THEN
      EXECUTE '
        CREATE TRIGGER trg_storage_location_name
          BEFORE INSERT OR UPDATE ON storage_locations
          FOR EACH ROW EXECUTE FUNCTION _sync_storage_location_name()
      ';
    END IF;
  END IF;
END $outer$;

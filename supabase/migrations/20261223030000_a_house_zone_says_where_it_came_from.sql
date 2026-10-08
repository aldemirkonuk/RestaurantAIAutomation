-- A HOUSE'S ZONE SAYS WHERE IT CAME FROM. ADR 0304, PR-1 of lane zoneaddr.
--
-- WHY. The founder, 2026-10-04 ~22:35Z, on a house with no time zone: *"When
-- a house signs up, when, whenever it adds a restaurant or anything else, when
-- they type in their addresses, that also shows which time zone they are in.
-- Unless they are want to change."* With no address to read, the owner's
-- device decides, "labelled 'from your device'". The 2026-09-03 rule (ADR
-- 0116, migration a_default_is_not_an_answer) still holds: a value nobody can
-- attribute is not an answer. A zone worked out from an address or a device is
-- therefore kept WITH its source, and the source is shown. These two columns
-- are that record. This file adds them and nothing else. No writer sets
-- 'address' or 'device' yet (that is PR-2), and no row is changed.
--
-- THE TWO COLUMNS.
--   timezone_source       who or what gave restaurants.timezone:
--                           'address'  worked out from the house's address
--                           'device'   the zone of the device the house was
--                                      created on
--                           'stated'   a person picked it in Settings ->
--                                      Time zone (PUT /settings/time-zone)
--   timezone_source_zone  the zone that source vouches for.
-- A source counts only while timezone_source_zone = timezone. A writer that
-- rewrites timezone without knowing about these columns (the sim seed RPC,
-- scripts/synth/seed.py) therefore turns the label into "source not recorded"
-- instead of leaving a stale one. That is why the pair is NOT tied to timezone
-- by the CHECK: tying it would break those writers, and the binding is read
-- by the gateway (house-time-zone.service.ts), which compares the two.
--
-- THE CHECK, AND WHY IT IS AN EQUALITY. restaurants_timezone_source_known:
--   (timezone_source IS NULL) = (timezone_source_zone IS NULL)
--   AND (timezone_source IS NULL OR timezone_source IN ('address','device','stated'))
-- Both conjuncts are never NULL, so the CHECK can never pass by evaluating to
-- NULL. The tempting form, "(both null) OR (source IN (...) AND zone IS NOT
-- NULL)", admits a vouched zone with a NULL source, because NULL IN (...) is
-- NULL and a CHECK that is NULL passes. Migration
-- a_vendor_states_its_usual_currency_and_an_order_carries_one measured that
-- trap on PGlite (its :172-177).
--
-- NOT these columns: house-frame.ts's read-time ZoneSource ('house' |
-- 'country' | 'none', apps/api-gateway/src/common/house-frame.ts:41), which
-- says how a reader found a zone, and the low-stock digest payload's
-- zone_source (ADR 0149), which says which clock a sweep kept. Those are
-- computed on a read. These are stored on a write.
--
-- NULLABLE, NO DEFAULT (ADR 0116). Every existing row reads null/null: its
-- source was never recorded, and this migration does not invent one. A
-- back-fill of a missing zone from a stored address is PR-3's dry run and the
-- founder's yes, never a migration (ADR 0111 row 2).
--
-- LOCK. ADD COLUMN with no default is catalog-only. The CHECK takes one
-- validating scan of restaurants (every row passes: both new columns are null)
-- under ACCESS EXCLUSIVE. statement_timeout follows the repo's ALTER TABLE
-- precedent (migration a_google_place_id_is_as_long_as_google_makes_it).
-- Re-runnable: ADD COLUMN IF NOT EXISTS, and the CHECK is added only if absent. No BEGIN/COMMIT: the Supabase CLI wraps each file in a
-- transaction. The closing DO block reads the catalog only; it writes no row.

SET local statement_timeout = '120s';

ALTER TABLE public.restaurants
  ADD COLUMN IF NOT EXISTS timezone_source text,
  ADD COLUMN IF NOT EXISTS timezone_source_zone character varying(50);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'restaurants_timezone_source_known'
       AND conrelid = to_regclass('public.restaurants')
  ) THEN
    ALTER TABLE public.restaurants
      ADD CONSTRAINT restaurants_timezone_source_known
      CHECK (
        ((timezone_source IS NULL) = (timezone_source_zone IS NULL))
        AND (timezone_source IS NULL OR timezone_source IN ('address', 'device', 'stated'))
      );
  END IF;
END $$;

COMMENT ON COLUMN public.restaurants.timezone_source IS
  'Who or what gave restaurants.timezone, recorded when it was written (ADR 0304): ''address'' (worked out from the house''s address), ''device'' (the zone of the device the house was created on) or ''stated'' (a person picked it in Settings -> Time zone). It counts only while timezone_source_zone = timezone; a writer that rewrites timezone alone leaves the source unbound, and the gateway then reads "source not recorded". Null = never recorded (ADR 0116: no default, no invented source). Not house-frame.ts''s read-time ZoneSource, and not the digest payload''s zone_source (ADR 0149).';

COMMENT ON COLUMN public.restaurants.timezone_source_zone IS
  'The zone timezone_source vouches for (ADR 0304). The source is read as the zone''s source only while this equals restaurants.timezone. Null exactly when timezone_source is null (restaurants_timezone_source_known).';

DO $$
BEGIN
  IF (SELECT format_type(a.atttypid, a.atttypmod)
        FROM pg_attribute a
       WHERE a.attrelid = 'public.restaurants'::regclass
         AND a.attname = 'timezone_source'
         AND NOT a.attisdropped) IS DISTINCT FROM 'text' THEN
    RAISE EXCEPTION 'restaurants.timezone_source is missing or not text';
  END IF;
  IF (SELECT format_type(a.atttypid, a.atttypmod)
        FROM pg_attribute a
       WHERE a.attrelid = 'public.restaurants'::regclass
         AND a.attname = 'timezone_source_zone'
         AND NOT a.attisdropped)
     IS DISTINCT FROM (SELECT format_type(a.atttypid, a.atttypmod)
                         FROM pg_attribute a
                        WHERE a.attrelid = 'public.restaurants'::regclass
                          AND a.attname = 'timezone'
                          AND NOT a.attisdropped) THEN
    RAISE EXCEPTION 'restaurants.timezone_source_zone is missing or not the type of restaurants.timezone';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM pg_attribute a
      JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
     WHERE a.attrelid = 'public.restaurants'::regclass
       AND a.attname IN ('timezone_source', 'timezone_source_zone')
  ) THEN
    RAISE EXCEPTION 'a time-zone source column carries a default; ADR 0116 forbids one';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'restaurants_timezone_source_known'
       AND conrelid = 'public.restaurants'::regclass
       AND contype = 'c'
       AND convalidated
  ) THEN
    RAISE EXCEPTION 'restaurants_timezone_source_known is missing or not validated';
  END IF;
END $$;

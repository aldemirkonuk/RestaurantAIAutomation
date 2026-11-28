-- r110 onboarding (DD-r109-22 narrowing 2, DD-r110-19): a till's day is
-- counted once.
--
-- pos_sales_history holds a till's past item sales per house-local day. A day
-- the till itself reported (any pos_checks row, voided or not) is the house's
-- own record of that day, and history for it would be a second count of the
-- same takings. A check counts toward a day when it is CLOSED: an open check
-- has not been counted yet and may close on a later day, so it holds nothing.
-- So, on both sides:
--
--   * import_pos_sales_history refuses a house-day that already holds a
--     closed check, and saves the others. It answers which days it refused.
--     A day it saves is REPLACED whole (that day's earlier history rows are
--     deleted first), so a corrected or renamed re-upload never adds a second
--     figure; the caller sends a day's rows in one call.
--   * a check that closes on (or is moved onto) a house-day holding history
--     rows deletes those rows in the check's own transaction (trigger
--     pos_checks_replace_history_day). The ingest reads the per-day counts
--     around its writes (pos_sales_history_day_counts) and says so.
--
-- Both sides take the same transaction-scoped advisory lock per (house,
-- house-day), pos_history_day_lock, and read after taking it, so an import and
-- a check landing together cannot both pass: whichever commits second sees
-- the other.
--
-- A check's house-day is its closed_at in the house's zone, the history's own
-- day. A zone that is unset or unknown to PostgreSQL reads
-- as UTC; the import itself refuses a house with no zone, so history exists
-- only for houses whose zone was set.
--
-- The trigger is SECURITY DEFINER so a writer of pos_checks never needs a
-- grant on pos_sales_history (a check must never be refused for it); EXECUTE
-- is revoked from every client role, and a trigger does not check EXECUTE when
-- it fires. Every other function is SECURITY INVOKER and service_role only.

CREATE OR REPLACE FUNCTION public.pos_house_zone(p_restaurant_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, public
AS $$
DECLARE
  tz text;
BEGIN
  SELECT NULLIF(btrim(r.timezone), '') INTO tz
    FROM public.restaurants r
   WHERE r.id = p_restaurant_id;
  IF tz IS NULL THEN
    RETURN 'UTC';
  END IF;
  BEGIN
    PERFORM now() AT TIME ZONE tz;
  EXCEPTION WHEN invalid_parameter_value THEN
    RETURN 'UTC';
  END;
  RETURN tz;
END;
$$;

COMMENT ON FUNCTION public.pos_house_zone(uuid) IS
  'The house''s zone for dating a till day, or UTC when unset or unknown (r110 onboarding, DD-r110-19).';

CREATE OR REPLACE FUNCTION public.pos_history_day_lock(p_restaurant_id uuid, p_day date)
RETURNS void
LANGUAGE sql
VOLATILE
SET search_path = pg_catalog, public
AS $$
  SELECT pg_advisory_xact_lock(
    hashtextextended('pos_history_day:' || p_restaurant_id::text || ':' || p_day::text, 0)
  );
$$;

COMMENT ON FUNCTION public.pos_history_day_lock(uuid, date) IS
  'The one lock an import and a check both take for a (house, house-day) before reading it (DD-r110-19).';

CREATE OR REPLACE FUNCTION public.import_pos_sales_history(p_restaurant_id uuid, p_rows jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SET search_path = pg_catalog, public
AS $$
DECLARE
  tz text := public.pos_house_zone(p_restaurant_id);
  d date;
  lo timestamptz;
  hi timestamptz;
  n integer;
  saved integer := 0;
  refused date[] := '{}';
BEGIN
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'import_pos_sales_history: p_rows must be a json array' USING ERRCODE = '22023';
  END IF;
  -- Ascending days, so two imports of one house lock in the same order.
  FOR d IN
    SELECT DISTINCT (e->>'sale_date')::date
      FROM jsonb_array_elements(p_rows) e
     ORDER BY 1
  LOOP
    PERFORM public.pos_history_day_lock(p_restaurant_id, d);
    lo := d::timestamp AT TIME ZONE tz;
    hi := (d + 1)::timestamp AT TIME ZONE tz;
    IF EXISTS (
      SELECT 1 FROM public.pos_checks c
       WHERE c.restaurant_id = p_restaurant_id
         AND c.closed_at >= lo AND c.closed_at < hi
    ) THEN
      refused := refused || d;
      CONTINUE;
    END IF;
    DELETE FROM public.pos_sales_history h
     WHERE h.restaurant_id = p_restaurant_id
       AND h.sale_date = d;
    INSERT INTO public.pos_sales_history
      (restaurant_id, sale_date, item_key, item_name, qty, net, currency, imported_by, imported_at)
    SELECT p_restaurant_id, d, e->>'item_key', e->>'item_name',
           (e->>'qty')::numeric, (e->>'net')::numeric, e->>'currency',
           (e->>'imported_by')::uuid, COALESCE((e->>'imported_at')::timestamptz, now())
      FROM jsonb_array_elements(p_rows) e
     WHERE (e->>'sale_date')::date = d
    ON CONFLICT (restaurant_id, sale_date, item_key) DO UPDATE
       SET item_name = EXCLUDED.item_name,
           qty = EXCLUDED.qty,
           net = EXCLUDED.net,
           currency = EXCLUDED.currency,
           imported_by = EXCLUDED.imported_by,
           imported_at = EXCLUDED.imported_at;
    GET DIAGNOSTICS n = ROW_COUNT;
    saved := saved + n;
  END LOOP;
  RETURN jsonb_build_object('saved', saved, 'refused_days', to_jsonb(refused));
END;
$$;

COMMENT ON FUNCTION public.import_pos_sales_history(uuid, jsonb) IS
  'Saves a till''s past item-days, refusing every house-day that already holds a check (r110 onboarding, DD-r110-19).';

CREATE OR REPLACE FUNCTION public.pos_sales_history_day_counts(p_restaurant_id uuid, p_from date, p_to date)
RETURNS TABLE (sale_date date, item_days integer)
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT h.sale_date, count(*)::integer
    FROM public.pos_sales_history h
   WHERE h.restaurant_id = p_restaurant_id
     AND h.sale_date BETWEEN p_from AND p_to
   GROUP BY h.sale_date
   ORDER BY h.sale_date;
$$;

COMMENT ON FUNCTION public.pos_sales_history_day_counts(uuid, date, date) IS
  'Item-days of till history per house-day, for an ingest to say which days its checks replaced (DD-r110-19).';

CREATE OR REPLACE FUNCTION public.pos_checks_replace_history_day()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  d date;
BEGIN
  d := (NEW.closed_at AT TIME ZONE public.pos_house_zone(NEW.restaurant_id))::date;
  IF d IS NULL THEN
    RETURN NULL;
  END IF;
  PERFORM public.pos_history_day_lock(NEW.restaurant_id, d);
  DELETE FROM public.pos_sales_history h
   WHERE h.restaurant_id = NEW.restaurant_id
     AND h.sale_date = d;
  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.pos_checks_replace_history_day() IS
  'AFTER trigger on pos_checks: a check closed on a house-day deletes that day''s till history in its own transaction (DD-r110-19).';

DROP TRIGGER IF EXISTS pos_checks_replace_history_day ON public.pos_checks;
CREATE TRIGGER pos_checks_replace_history_day
  AFTER INSERT OR UPDATE OF restaurant_id, closed_at ON public.pos_checks
  FOR EACH ROW WHEN (NEW.closed_at IS NOT NULL) EXECUTE FUNCTION public.pos_checks_replace_history_day();

REVOKE ALL ON FUNCTION public.pos_house_zone(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pos_history_day_lock(uuid, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.import_pos_sales_history(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pos_sales_history_day_counts(uuid, date, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pos_checks_replace_history_day() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pos_house_zone(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.pos_history_day_lock(uuid, date) TO service_role;
GRANT EXECUTE ON FUNCTION public.import_pos_sales_history(uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.pos_sales_history_day_counts(uuid, date, date) TO service_role;

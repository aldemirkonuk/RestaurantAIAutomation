-- A chosen menu carries its prices in one call (r28 menu audit, G1).
--
-- Choosing a menu commits the switch (make_menu_current) and THEN writes each
-- priced line's price through set_house_menu_price, one round trip per line.
-- Against the pooler a round trip costs about a third of a second
-- (menus.service.ts), so past about 90 priced lines the request ran over the
-- page's 30 s limit after the menu was already current, and the page said
-- nothing had changed.
--
-- This function takes many lines' price changes of ONE house in one call and
-- runs set_house_menu_price for each, in the order given, inside the
-- database. set_house_menu_price stays the one writer: it checks the house,
-- takes the wine row FOR UPDATE, holds every lock (ADR 0193 L4, L27), refuses
-- a stale change and records the version row. Nothing here writes a price
-- itself.
--
-- Each row runs in its own savepoint: a row the writer refuses (another
-- house's wine, a negative price, the lock guard) answers
-- {"outcome": "failed", "error", "code"} and rolls back that row only; the
-- rows around it are written. Every element of p_rows is
-- {id, inventory_id, bottle?, glass?}: a key that is present is a kind to set
-- (a JSON null clears it), a key that is absent leaves that kind alone. `id`
-- is the caller's own name for the row and comes back unchanged. The answer
-- is a list, in input order, of {id, result} where result is exactly what
-- set_house_menu_price answered.
--
-- SECURITY INVOKER, callable by service_role only, the same as
-- set_house_menu_price, make_menu_current and menu_items_write_back.

CREATE OR REPLACE FUNCTION public.set_house_menu_prices(
  p_restaurant_id   uuid,
  p_rows            jsonb,
  p_change_source   text,
  p_changed_by      uuid,
  p_effective_from  timestamptz,
  p_reason          text,
  p_menu_id         uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_e      jsonb;
  v_res    jsonb;
  v_out    jsonb := '[]'::jsonb;
BEGIN
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'set_house_menu_prices: the rows are a list; nothing was changed'
      USING ERRCODE = '22023';
  END IF;

  FOR v_e IN SELECT e FROM jsonb_array_elements(p_rows) WITH ORDINALITY AS t(e, n) ORDER BY n LOOP
    BEGIN
      v_res := public.set_house_menu_price(
        p_restaurant_id,
        (v_e->>'inventory_id')::uuid,
        v_e ? 'bottle',
        (v_e->>'bottle')::numeric,
        v_e ? 'glass',
        (v_e->>'glass')::numeric,
        p_change_source,
        p_changed_by,
        p_effective_from,
        p_reason,
        NULL::numeric,
        NULL::uuid,
        p_menu_id
      );
    EXCEPTION WHEN OTHERS THEN
      v_res := jsonb_build_object('outcome', 'failed', 'error', SQLERRM, 'code', SQLSTATE);
    END;
    v_out := v_out || jsonb_build_array(jsonb_build_object('id', v_e->'id', 'result', v_res));
  END LOOP;

  RETURN v_out;
END
$$;

COMMENT ON FUNCTION public.set_house_menu_prices(uuid, jsonb, text, uuid, timestamptz, text, uuid) IS
  'r28 G1: many price changes of one house in one call. Runs set_house_menu_price (the one lock-holding writer) for each element {id, inventory_id, bottle?, glass?} in order, each in its own savepoint; answers [{id, result}] in input order, result = the writer''s own answer or {outcome: failed, error, code}. Writes no price itself.';

REVOKE ALL ON FUNCTION public.set_house_menu_prices(uuid, jsonb, text, uuid, timestamptz, text, uuid) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.set_house_menu_prices(uuid, jsonb, text, uuid, timestamptz, text, uuid) FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.set_house_menu_prices(uuid, jsonb, text, uuid, timestamptz, text, uuid) FROM authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.set_house_menu_prices(uuid, jsonb, text, uuid, timestamptz, text, uuid) TO service_role';
  END IF;
END
$$;

DO $$
BEGIN
  IF to_regprocedure('public.set_house_menu_prices(uuid, jsonb, text, uuid, timestamptz, text, uuid)') IS NULL THEN
    RAISE EXCEPTION 'set_house_menu_prices was not created';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc
              WHERE oid = to_regprocedure('public.set_house_menu_prices(uuid, jsonb, text, uuid, timestamptz, text, uuid)')
                AND prosecdef) THEN
    RAISE EXCEPTION 'set_house_menu_prices is SECURITY DEFINER; it must not be';
  END IF;
END
$$;

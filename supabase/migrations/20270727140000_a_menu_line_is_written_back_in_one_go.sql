-- A menu's lines are written back in one statement (menu proposal item 2e, M15).
--
-- Choosing a menu, and importing one, wrote each line back on its own: one
-- UPDATE per line for its house row (inventory_item_id), one for its price flag,
-- and one for its library submission. Against the pooler each round trip costs
-- about a third of a second (menus.service.ts, the resolver note), so a 300-line
-- menu spent minutes on bookkeeping alone. This function takes every line's
-- write-back in one call.
--
-- What it may write is fixed: inventory_item_id, submission_id, price_flag and
-- price_flag_note, each only when the row's object names the key (a missing key
-- leaves the column as it is; a JSON null writes NULL). Nothing else on the line
-- moves. House-scoped: a row id of another house is not written, and is not an
-- error -- the count returned is what was written, and the gateway compares it.
-- No row is created: an id that no longer exists is skipped. SECURITY INVOKER,
-- callable by service_role only, the same as make_menu_current.
--
-- The house price is NOT written here. set_house_menu_price stays the one
-- lock-holding writer, per line (ADR 0193 L4, L27).

CREATE OR REPLACE FUNCTION public.menu_items_write_back(
  p_restaurant_id uuid,
  p_rows          jsonb
)
RETURNS integer
LANGUAGE sql
SET search_path = public, pg_temp
AS $$
  WITH r AS (
    SELECT (e->>'id')::uuid AS id, e
      FROM jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) AS e
  ),
  written AS (
    UPDATE public.menu_items AS m
       SET inventory_item_id = CASE WHEN r.e ? 'inventory_item_id'
                                    THEN (r.e->>'inventory_item_id')::uuid
                                    ELSE m.inventory_item_id END,
           submission_id     = CASE WHEN r.e ? 'submission_id'
                                    THEN (r.e->>'submission_id')::uuid
                                    ELSE m.submission_id END,
           price_flag        = CASE WHEN r.e ? 'price_flag'
                                    THEN r.e->>'price_flag'
                                    ELSE m.price_flag END,
           price_flag_note   = CASE WHEN r.e ? 'price_flag_note'
                                    THEN r.e->>'price_flag_note'
                                    ELSE m.price_flag_note END
      FROM r
     WHERE m.id = r.id
       AND m.restaurant_id = p_restaurant_id
    RETURNING m.id
  )
  SELECT count(*)::integer FROM written;
$$;

COMMENT ON FUNCTION public.menu_items_write_back(uuid, jsonb) IS
  'Menu proposal 2e: one statement writes back many menu lines of one house. Each element {id, inventory_item_id?, submission_id?, price_flag?, price_flag_note?} sets only the keys it names; other houses'' rows and missing ids are skipped; returns the number of rows written. Never writes a house price (set_house_menu_price does, per line).';

REVOKE ALL ON FUNCTION public.menu_items_write_back(uuid, jsonb) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.menu_items_write_back(uuid, jsonb) FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.menu_items_write_back(uuid, jsonb) FROM authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.menu_items_write_back(uuid, jsonb) TO service_role';
  END IF;
END
$$;

DO $$
BEGIN
  IF to_regprocedure('public.menu_items_write_back(uuid, jsonb)') IS NULL THEN
    RAISE EXCEPTION 'menu_items_write_back was not created';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc
              WHERE oid = to_regprocedure('public.menu_items_write_back(uuid, jsonb)')
                AND prosecdef) THEN
    RAISE EXCEPTION 'menu_items_write_back is SECURITY DEFINER; it must not be';
  END IF;
END
$$;

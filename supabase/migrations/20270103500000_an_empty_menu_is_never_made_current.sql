-- F-681 (sim wave 23, 2026-10-09): an empty menu is never made current.
--
-- make_menu_current archived the house's active menu and activated the chosen
-- one with no look at its lines. A file that read as zero lines (a Turkish
-- Excel ';' CSV, for one) could be chosen from /menu with one press, and every
-- line left /menu and /cellar, since the current-menu readers read only the
-- active menu (current-menu-lines.ts).
--
-- The function is the one in 20260922230800_a_house_can_hold_a_price.sql,
-- unchanged but for the refusal before the switch: a menu with no line that a
-- person has not discarded raises 22023 (the gateway's makeCurrent answers it
-- as a 400 with this message) and changes nothing. Choosing the menu that is
-- already current still answers already_current. CREATE OR REPLACE keeps the
-- function's grants (service_role only) and its SECURITY INVOKER.

CREATE OR REPLACE FUNCTION public.make_menu_current(
  p_restaurant_id uuid,
  p_menu_id       uuid,
  p_actor         uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_menu     record;
  v_previous uuid[];
  v_at       timestamptz := now();
BEGIN
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'make_menu_current: choosing the current menu names the person who chose it (actor is NULL); nothing was changed'
      USING ERRCODE = '22023';
  END IF;

  PERFORM 1 FROM public.restaurants WHERE id = p_restaurant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'make_menu_current: no restaurant %; nothing was changed', p_restaurant_id
      USING ERRCODE = 'P0002';
  END IF;

  SELECT id, status, made_current_at
    INTO v_menu
    FROM public.restaurant_menus
   WHERE id = p_menu_id
     AND restaurant_id = p_restaurant_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'make_menu_current: no menu % in house %; nothing was changed', p_menu_id, p_restaurant_id
      USING ERRCODE = 'P0002';
  END IF;

  IF v_menu.status = 'active'
     AND NOT EXISTS (SELECT 1 FROM public.restaurant_menus
                      WHERE restaurant_id = p_restaurant_id
                        AND status = 'active'
                        AND id <> p_menu_id) THEN
    RETURN jsonb_build_object('outcome', 'already_current', 'menu_id', p_menu_id,
                              'previous_menu_ids', '[]'::jsonb,
                              'made_current_at', v_menu.made_current_at);
  END IF;

  -- F-681: a menu with no lines would archive the house's menu and leave it
  -- with none. Lines discarded by a person do not count, as the gateway's
  -- line read does not count them.
  IF NOT EXISTS (SELECT 1 FROM public.menu_items
                  WHERE menu_id = p_menu_id
                    AND restaurant_id = p_restaurant_id
                    AND status IS DISTINCT FROM 'discarded') THEN
    RAISE EXCEPTION 'This menu has no lines, so making it current would empty the house''s menu. Nothing was changed.'
      USING ERRCODE = '22023';
  END IF;

  WITH retired AS (
    UPDATE public.restaurant_menus
       SET status = 'archived',
           retired_at = v_at,
           retired_by = p_actor
     WHERE restaurant_id = p_restaurant_id
       AND status = 'active'
       AND id <> p_menu_id
    RETURNING id
  )
  SELECT coalesce(array_agg(id), '{}') INTO v_previous FROM retired;

  UPDATE public.restaurant_menus
     SET status = 'active',
         made_current_at = v_at,
         made_current_by = p_actor,
         retired_at = NULL,
         retired_by = NULL
   WHERE id = p_menu_id
     AND restaurant_id = p_restaurant_id;

  RETURN jsonb_build_object('outcome', 'made_current', 'menu_id', p_menu_id,
                            'previous_menu_ids', to_jsonb(v_previous),
                            'made_current_at', v_at);
END
$$;

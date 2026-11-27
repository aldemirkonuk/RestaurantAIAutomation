-- r102 menu-func-3: choosing a menu with no live line is refused by the rpc as
-- well as by the gateway. Same body as 20260922230800, plus one check after the
-- already-current early return. No data is touched.
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

  -- A menu with no live line would retire the house's real menu and put nothing
  -- in its place (r102 menu-func-3). The gateway checks first; this keeps a
  -- second caller honest. Said in words, 22023 = a bad request.
  IF NOT EXISTS (SELECT 1 FROM public.menu_items
                  WHERE menu_id = p_menu_id
                    AND restaurant_id = p_restaurant_id
                    AND status <> 'discarded') THEN
    RAISE EXCEPTION 'A menu with no lines cannot be the current menu. Nothing was changed.'
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

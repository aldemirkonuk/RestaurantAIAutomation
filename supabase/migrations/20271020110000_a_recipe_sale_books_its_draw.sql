-- A recipe sale books what it takes off the shelf (inventory r28 audit, gap 1,
-- slice 3b of the recipe draw). 3a (20271020100000) holds the tables and the
-- shared arithmetic; 3c gives a voided sale's draw back; slice 4 wires the
-- till. Until slice 4 lands nothing calls this, and no sale moves differently.
--
-- INVARIANTS (W1, W2 are 3a's):
--   W3 All or nothing. A call books every draw it names or none: a wait or a
--      short shelf returns before anything is written, and a refusal raises.
--   W4 Once. A sale key that has booked returns 'replay' and books nothing.
--   W5 House. Every good must be p_restaurant's, under its row lock. Otherwise
--      42501 and nothing is written (ADR 0141's sentence).
--   W6 Unit under the lock. A plan made for a unit the good no longer has
--      waits ('changed') rather than booking grams as milligrams.
--   W9 Draws of one good run one at a time: goods are locked in id order
--      before anything is read.
--
-- The calls (short shelf = 'short', a sub-unit draw is carried, a removed
-- good waits) and their rejected alternatives are in the PR body.
--
-- Version: past every migration on main and on every open PR at writing.

-- ---------------------------------------------------------------------------
-- 1. record_recipe_draw: book one till line's plan
-- ---------------------------------------------------------------------------
-- p_draws: recipe-draw.ts drawArgs(); big integers travel as strings.
-- Returns {status}:
--   booked  {version_id, draws:[{inventory_id, via, units, carry_out}]}
--   replay  {draws}         the sale key has booked already (W4)
--   wait    {waits:[{inventory_id, reason}]}  removed, no_unit, measure_mismatch,
--           no_container_size, or changed (W6); nothing written
--   short   {short:[{inventory_id, via, need, have}]}  nothing written (W3)
-- Raises RDR00 on a malformed call and 42501 on another house's good (W5).
create function public.record_recipe_draw(
  p_restaurant uuid,
  p_sale_key text,
  p_version_id uuid,
  p_cocktail_id uuid,
  p_draws jsonb,
  p_occurred_at timestamptz default null,
  p_reason text default null
) returns jsonb
language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_d jsonb; v_i integer; v_id uuid; v_key text; v_keys text[] := '{}'; v_ids uuid[] := '{}';
  v_item record; v_route record; v_settled record;
  v_exact bigint; v_bpu bigint; v_carry bigint; v_have bigint; v_txn uuid;
  v_plan jsonb := '[]'::jsonb; v_waits jsonb := '[]'::jsonb;
  v_short jsonb := '[]'::jsonb; v_out jsonb := '[]'::jsonb;
  v_reason text := coalesce(nullif(btrim(p_reason), ''), 'recipe sale');
begin
  if p_restaurant is null then
    raise exception 'record_recipe_draw: a draw names the house it is for.' using errcode = 'RDR00';
  end if;
  if p_sale_key is null or btrim(p_sale_key) = '' then
    raise exception 'record_recipe_draw: a draw needs the sale''s key.' using errcode = 'RDR00';
  end if;
  if p_version_id is null then
    raise exception 'record_recipe_draw: a draw names the recipe version it sold.' using errcode = 'RDR00';
  end if;
  if p_draws is null or jsonb_typeof(p_draws) <> 'array' or jsonb_array_length(p_draws) = 0 then
    raise exception 'record_recipe_draw: a draw names at least one good.' using errcode = 'RDR00';
  end if;
  if jsonb_array_length(p_draws) > 40 then
    raise exception 'record_recipe_draw: a recipe draws at most 40 goods.' using errcode = 'RDR00';
  end if;

  -- Shape, and one key per good and via (I4).
  for v_d, v_i in select e, o::integer from jsonb_array_elements(p_draws) with ordinality as t(e, o) loop
    if jsonb_typeof(v_d -> 'inventory_id') is distinct from 'string'
       or (v_d ->> 'inventory_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'record_recipe_draw: draw % names no good.', v_i using errcode = 'RDR00';
    end if;
    if (v_d ->> 'via') is null or (v_d ->> 'via') not in ('book', 'pour') then
      raise exception 'record_recipe_draw: draw % is neither booked nor poured.', v_i using errcode = 'RDR00';
    end if;
    if (v_d ->> 'base_unit') is null or (v_d ->> 'base_unit') not in ('ml10', 'mg', 'each_milli') then
      raise exception 'record_recipe_draw: draw % has no recipe measure.', v_i using errcode = 'RDR00';
    end if;
    if jsonb_typeof(v_d -> 'base_per_unit') is distinct from 'string'
       or (v_d ->> 'base_per_unit') !~ '^[1-9][0-9]{0,11}$' then
      raise exception 'record_recipe_draw: draw % has no unit size.', v_i using errcode = 'RDR00';
    end if;
    if jsonb_typeof(v_d -> 'exact_micro') is distinct from 'string'
       or (v_d ->> 'exact_micro') !~ '^(0|[1-9][0-9]{0,17})$' then
      raise exception 'record_recipe_draw: draw % has no amount.', v_i using errcode = 'RDR00';
    end if;
    v_id := (v_d ->> 'inventory_id')::uuid;
    v_key := p_sale_key || ':r:' || v_id::text || ':' || (v_d ->> 'via');
    if v_key = any(v_keys) then
      raise exception 'record_recipe_draw: draw % names a good the line already draws.', v_i using errcode = 'RDR00';
    end if;
    v_keys := v_keys || v_key;
    v_ids := v_ids || v_id;
  end loop;

  -- W9: lock the goods in id order before anything is read.
  perform 1 from public.restaurant_inventory ri where ri.id = any(v_ids) order by ri.id for update;

  -- W4: a sale books once. Read under the locks, so a second call with this
  -- key waits for the first and then sees what it booked.
  if exists (select 1 from public.recipe_draws r
              where r.restaurant_id = p_restaurant and r.sale_key = p_sale_key) then
    return jsonb_build_object('status', 'replay', 'draws', (
      select jsonb_agg(jsonb_build_object('inventory_id', r.inventory_id, 'via', r.via,
                                          'units', r.units, 'carry_out', r.carry_out::text)
                       order by r.draw_key)
        from public.recipe_draws r
       where r.restaurant_id = p_restaurant and r.sale_key = p_sale_key));
  end if;

  -- W5 and W6, under the locks. Nothing is written in this loop.
  for v_d in select e from jsonb_array_elements(p_draws) as t(e) loop
    v_id := (v_d ->> 'inventory_id')::uuid;
    select ri.id, ri.restaurant_id, ri.uom, ri.bottle_size_ml, ri.deleted_at
      into v_item from public.restaurant_inventory ri where ri.id = v_id;
    if v_item.id is null or v_item.restaurant_id is distinct from p_restaurant then
      raise exception
        'record_recipe_draw: item % is not an item of restaurant %, so nothing was drawn and no ledger row was written. A stock movement names the house it is for, and this one does not match the item.',
        v_id, p_restaurant
        using errcode = '42501';
    end if;
    if v_item.deleted_at is not null then
      v_waits := v_waits || jsonb_build_object('inventory_id', v_id, 'reason', 'removed');
      continue;
    end if;
    select * into v_route from public.recipe_draw_route(v_d ->> 'base_unit', v_item.uom, v_item.bottle_size_ml);
    if v_route.wait is not null then
      v_waits := v_waits || jsonb_build_object('inventory_id', v_id, 'reason', v_route.wait);
    elsif v_route.via <> (v_d ->> 'via') or v_route.base_per_unit <> (v_d ->> 'base_per_unit')::bigint then
      v_waits := v_waits || jsonb_build_object('inventory_id', v_id, 'reason', 'changed');
    end if;
  end loop;
  if jsonb_array_length(v_waits) > 0 then
    return jsonb_build_object('status', 'wait', 'waits', v_waits);
  end if;

  -- Settle each draw and check the shelf covers it (W2, W3). Still nothing written.
  for v_d in select e from jsonb_array_elements(p_draws) as t(e) loop
    v_id := (v_d ->> 'inventory_id')::uuid;
    v_exact := (v_d ->> 'exact_micro')::bigint;
    v_bpu := (v_d ->> 'base_per_unit')::bigint;
    select c.carry_micro into v_carry from public.recipe_draw_carry c
     where c.restaurant_id = p_restaurant and c.inventory_id = v_id
       and c.via = (v_d ->> 'via') and c.base_unit = (v_d ->> 'base_unit');
    v_carry := coalesce(v_carry, 0);
    select * into v_settled from public.recipe_draw_settle(v_exact, v_bpu, v_carry);
    if v_settled.units > 2147483647 then
      raise exception 'record_recipe_draw: the draw of item % is too large to book.', v_id using errcode = 'RDR00';
    end if;
    if v_settled.units > 0 then
      if (v_d ->> 'via') = 'book' then
        select coalesce(sum(l.qty), 0) into v_have from public.inventory_lots l
         where l.inventory_id = v_id and l.stock_state = 'live';
      else
        select coalesce(sum(l.open_bottle_ml), 0) + coalesce(sum(l.qty), 0)::bigint * ri.bottle_size_ml
          into v_have
          from public.restaurant_inventory ri
          left join public.inventory_lots l on l.inventory_id = ri.id and l.stock_state = 'live'
         where ri.id = v_id
         group by ri.bottle_size_ml;
      end if;
      if v_have < v_settled.units then
        v_short := v_short || jsonb_build_object('inventory_id', v_id, 'via', v_d ->> 'via',
                                                 'need', v_settled.units, 'have', v_have);
      end if;
    end if;
    v_plan := v_plan || jsonb_build_object(
      'inventory_id', v_id, 'via', v_d ->> 'via', 'base_unit', v_d ->> 'base_unit',
      'base_per_unit', v_bpu::text, 'exact_micro', v_exact::text, 'carry_in', v_carry::text,
      'units', v_settled.units::text, 'carry_out', v_settled.carry_out::text,
      'key', p_sale_key || ':r:' || v_id::text || ':' || (v_d ->> 'via'));
    v_carry := null;
  end loop;
  if jsonb_array_length(v_short) > 0 then
    return jsonb_build_object('status', 'short', 'short', v_short);
  end if;

  -- Write: the movement, the carry, the record.
  for v_d in select e from jsonb_array_elements(v_plan) as t(e) loop
    v_id := (v_d ->> 'inventory_id')::uuid;
    if (v_d ->> 'units')::bigint > 0 then
      if (v_d ->> 'via') = 'book' then
        v_txn := public.apply_stock_movement(
          p_inventory_id => v_id,
          p_stock_state => 'live',
          p_delta => -((v_d ->> 'units')::integer),
          p_transaction_type => 'sale',
          p_source => 'pos',
          p_reason => v_reason,
          p_idempotency_key => v_d ->> 'key',
          p_metadata => jsonb_build_object('recipe_version_id', p_version_id, 'cocktail_id', p_cocktail_id,
                                           'sale_key', p_sale_key, 'exact_micro', v_d ->> 'exact_micro'),
          p_restaurant_id => p_restaurant,
          p_occurred_at => p_occurred_at);
      else
        perform public.record_glass_pour(
          p_inventory_id => v_id,
          p_pours => 1,
          p_pour_ml => (v_d ->> 'units')::integer,
          p_source => 'pos',
          p_reason => v_reason,
          p_idempotency_key => v_d ->> 'key',
          p_occurred_at => p_occurred_at);
      end if;
    end if;
    insert into public.recipe_draw_carry as c (restaurant_id, inventory_id, via, base_unit, carry_micro)
    values (p_restaurant, v_id, v_d ->> 'via', v_d ->> 'base_unit', (v_d ->> 'carry_out')::bigint)
    on conflict (restaurant_id, inventory_id, via, base_unit)
      do update set carry_micro = excluded.carry_micro, updated_at = now();
    insert into public.recipe_draws
      (draw_key, sale_key, restaurant_id, inventory_id, via, base_unit, base_per_unit,
       exact_micro, carry_in, carry_out, units, version_id, cocktail_id, occurred_at)
    values
      (v_d ->> 'key', p_sale_key, p_restaurant, v_id, v_d ->> 'via', v_d ->> 'base_unit',
       (v_d ->> 'base_per_unit')::bigint, (v_d ->> 'exact_micro')::bigint, (v_d ->> 'carry_in')::bigint,
       (v_d ->> 'carry_out')::bigint, (v_d ->> 'units')::bigint, p_version_id, p_cocktail_id,
       least(coalesce(p_occurred_at, now()), now()));
    v_out := v_out || jsonb_build_object('inventory_id', v_id, 'via', v_d ->> 'via',
                                         'units', (v_d ->> 'units')::bigint, 'carry_out', v_d ->> 'carry_out');
  end loop;

  return jsonb_build_object('status', 'booked', 'version_id', p_version_id, 'draws', v_out);
end $$;

-- ---------------------------------------------------------------------------
-- 2. Only the gateway calls it (service_role).
-- ---------------------------------------------------------------------------
revoke all on function public.record_recipe_draw(uuid, text, uuid, uuid, jsonb, timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.record_recipe_draw(uuid, text, uuid, uuid, jsonb, timestamptz, text) to service_role;

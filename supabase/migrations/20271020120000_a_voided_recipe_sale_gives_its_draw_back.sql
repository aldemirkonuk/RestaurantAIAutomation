-- A voided recipe sale gives its draw back (inventory r28 audit, gap 1, slice
-- 3c of the recipe draw). 3a (20271020100000) holds the tables and the shared
-- arithmetic, 3b (20271020110000) books a sale's draw, slice 4 wires the till.
-- Until slice 4 lands nothing calls this, and no sale moves differently.
--
-- INVARIANTS (W1-W6 and W9 are 3a's and 3b's):
--   W7 A void gives back what its sale booked. When nothing drew the same good
--      in between, it returns exactly the sale's units and puts the carry back
--      where it was. When something did, it can differ from the sale's units
--      by one, and W1 still holds: booked units plus the carry equal the exact
--      draws still standing. The recipe is never read again (I3); only the
--      recorded exact draw is.
--   W8 A void of a sale this house never booked (it waited, or never arrived)
--      gives back nothing and says so ('nothing_booked').
--   W4 Once: a void of a sale already given back returns 'replay'.
--
-- THE CALLS (the session's, under the 2026-11-07 /goal):
--   * The fewest whole units that keep the carry a true remainder go back
--     (recipe_draw_unsettle). Rejected: returning the sale's units always,
--     which lets the carry go below zero or past a unit when draws came in
--     between, so the books stop adding up.
--   * A poured draw's ml go back into the good's open container (the newest
--     lot with one open, else the newest lot), and every full bottle's worth
--     turns back into a sealed bottle, with one 'return' ledger row. Rejected:
--     returning a whole bottle per voided pour (B19's error, which ADR 0011
--     records for the wine path and this path need not repeat), and leaving
--     pours un-voidable.
--   * A poured good with no live lot or no bottle size to take the ml back
--     waits, and nothing is written.
--   * A booked draw goes back through apply_stock_movement as a 'return', as
--     a wine void does today; the lot it makes carries no cost, the same as
--     that path.
--
-- Version: past every migration on main and on every open PR at writing.

-- ---------------------------------------------------------------------------
-- 1. reverse_recipe_draw: a void gives back what its sale booked
-- ---------------------------------------------------------------------------
-- Returns {status}:
--   returned        {draws:[{inventory_id, via, units}]}
--   replay          every draw of this sale was given back already (W4)
--   nothing_booked  this house never booked this sale key (W8)
--   wait            {waits:[{inventory_id, reason}]}: a poured good has no lot
--                   or no container size to take the ml back; nothing written
create function public.reverse_recipe_draw(
  p_restaurant uuid,
  p_sale_key text,
  p_occurred_at timestamptz default null,
  p_reason text default null
) returns jsonb
language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_ids uuid[];
  v_r record;
  v_carry bigint;
  v_back record;
  v_item record;
  v_lot record;
  v_plan jsonb := '[]'::jsonb;
  v_waits jsonb := '[]'::jsonb;
  v_out jsonb := '[]'::jsonb;
  v_d jsonb;
  v_units bigint;
  v_open bigint;
  v_restored bigint;
  v_before integer;
  v_reason text := coalesce(nullif(btrim(p_reason), ''), 'recipe sale voided');
begin
  if p_restaurant is null then
    raise exception 'reverse_recipe_draw: a void names the house it is for.' using errcode = 'RDR00';
  end if;
  if p_sale_key is null or btrim(p_sale_key) = '' then
    raise exception 'reverse_recipe_draw: a void needs the sale''s key.' using errcode = 'RDR00';
  end if;

  select array_agg(distinct r.inventory_id) into v_ids from public.recipe_draws r
   where r.restaurant_id = p_restaurant and r.sale_key = p_sale_key;
  if v_ids is null then
    return jsonb_build_object('status', 'nothing_booked');
  end if;

  -- W9, then W4 under the locks.
  perform 1 from public.restaurant_inventory ri where ri.id = any(v_ids) order by ri.id for update;
  if not exists (select 1 from public.recipe_draws r
                  where r.restaurant_id = p_restaurant and r.sale_key = p_sale_key and r.voided_at is null) then
    return jsonb_build_object('status', 'replay');
  end if;

  -- Work out every give-back before writing any (W3).
  for v_r in select * from public.recipe_draws r
              where r.restaurant_id = p_restaurant and r.sale_key = p_sale_key and r.voided_at is null
              order by r.draw_key loop
    select c.carry_micro into v_carry from public.recipe_draw_carry c
     where c.restaurant_id = p_restaurant and c.inventory_id = v_r.inventory_id
       and c.via = v_r.via and c.base_unit = v_r.base_unit;
    v_carry := coalesce(v_carry, 0);
    select * into v_back from public.recipe_draw_unsettle(v_r.exact_micro, v_r.base_per_unit, v_carry);
    if v_back.units > 2147483647 then
      raise exception 'reverse_recipe_draw: the draw of item % is too large to give back.', v_r.inventory_id
        using errcode = 'RDR00';
    end if;
    if v_r.via = 'pour' and v_back.units > 0 then
      select ri.bottle_size_ml into v_item from public.restaurant_inventory ri where ri.id = v_r.inventory_id;
      if v_item.bottle_size_ml is null or v_item.bottle_size_ml <= 0 then
        v_waits := v_waits || jsonb_build_object('inventory_id', v_r.inventory_id, 'reason', 'no_container_size');
      elsif not exists (select 1 from public.inventory_lots l
                         where l.inventory_id = v_r.inventory_id and l.stock_state = 'live') then
        v_waits := v_waits || jsonb_build_object('inventory_id', v_r.inventory_id, 'reason', 'no_lot');
      end if;
    end if;
    v_plan := v_plan || jsonb_build_object(
      'key', v_r.draw_key, 'inventory_id', v_r.inventory_id, 'via', v_r.via, 'base_unit', v_r.base_unit,
      'units', v_back.units::text, 'carry_in', v_carry::text, 'carry_out', v_back.carry_out::text);
    v_carry := null;
  end loop;
  if jsonb_array_length(v_waits) > 0 then
    return jsonb_build_object('status', 'wait', 'waits', v_waits);
  end if;

  for v_d in select e from jsonb_array_elements(v_plan) as t(e) loop
    v_units := (v_d ->> 'units')::bigint;
    if v_units > 0 and (v_d ->> 'via') = 'book' then
      perform public.apply_stock_movement(
        p_inventory_id => (v_d ->> 'inventory_id')::uuid,
        p_stock_state => 'live',
        p_delta => v_units::integer,
        p_transaction_type => 'return',
        p_source => 'pos',
        p_reason => v_reason,
        p_idempotency_key => (v_d ->> 'key') || ':void',
        p_metadata => jsonb_build_object('sale_key', p_sale_key, 'voids', v_d ->> 'key'),
        p_restaurant_id => p_restaurant,
        p_occurred_at => p_occurred_at);
    elsif v_units > 0 then
      -- The ml go back into the good's open container: the newest lot that
      -- has one open, else the newest lot. Every full bottle's worth turns
      -- back into a sealed bottle. One 'return' row says how many.
      select ri.restaurant_id, ri.master_wine_id, ri.bottle_size_ml into v_item
        from public.restaurant_inventory ri where ri.id = (v_d ->> 'inventory_id')::uuid;
      perform 1 from public.inventory_lots l
       where l.inventory_id = (v_d ->> 'inventory_id')::uuid and l.stock_state = 'live' for update;
      select l.id, l.open_bottle_ml into v_lot from public.inventory_lots l
       where l.inventory_id = (v_d ->> 'inventory_id')::uuid and l.stock_state = 'live'
       order by (l.open_bottle_ml > 0) desc, l.received_at desc, l.created_at desc, l.id desc
       limit 1;
      select coalesce(sum(l.qty), 0) into v_before from public.inventory_lots l
       where l.inventory_id = (v_d ->> 'inventory_id')::uuid and l.stock_state = 'live';
      v_open := v_lot.open_bottle_ml::bigint + v_units;
      v_restored := v_open / v_item.bottle_size_ml;
      v_open := v_open % v_item.bottle_size_ml;
      update public.inventory_lots
         set qty = qty + v_restored::integer, open_bottle_ml = v_open::integer, updated_at = now()
       where id = v_lot.id;
      if v_restored > 0 then
        insert into public.inventory_transactions
          (restaurant_id, inventory_id, wine_id, transaction_type, source, quantity_change, quantity_before,
           quantity_after, stock_type, performed_by_type, reason, idempotency_key, metadata, transaction_date)
        values
          (v_item.restaurant_id, (v_d ->> 'inventory_id')::uuid, v_item.master_wine_id, 'return', 'pos',
           v_restored::integer, v_before, v_before + v_restored::integer, 'live', 'system', v_reason,
           (v_d ->> 'key') || ':void',
           jsonb_build_object('sale_key', p_sale_key, 'voids', v_d ->> 'key',
                              'ml_returned', v_units, 'bottles_restored', v_restored),
           least(coalesce(p_occurred_at, now()), now()));
      end if;
    end if;
    update public.recipe_draw_carry c set carry_micro = (v_d ->> 'carry_out')::bigint, updated_at = now()
     where c.restaurant_id = p_restaurant and c.inventory_id = (v_d ->> 'inventory_id')::uuid
       and c.via = (v_d ->> 'via') and c.base_unit = (v_d ->> 'base_unit');
    update public.recipe_draws r
       set voided_at = now(), units_returned = v_units,
           void_carry_in = (v_d ->> 'carry_in')::bigint, void_carry_out = (v_d ->> 'carry_out')::bigint
     where r.draw_key = (v_d ->> 'key');
    v_out := v_out || jsonb_build_object('inventory_id', (v_d ->> 'inventory_id')::uuid,
                                         'via', v_d ->> 'via', 'units', v_units);
  end loop;

  return jsonb_build_object('status', 'returned', 'draws', v_out);
end $$;

-- ---------------------------------------------------------------------------
-- 2. Only the gateway calls it (service_role).
-- ---------------------------------------------------------------------------
revoke all on function public.reverse_recipe_draw(uuid, text, timestamptz, text) from public, anon, authenticated;
grant execute on function public.reverse_recipe_draw(uuid, text, timestamptz, text) to service_role;

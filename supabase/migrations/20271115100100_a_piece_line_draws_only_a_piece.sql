-- A piece line draws only a piece (r36 recipes audit, gap 4).
--
-- recipe_draw_route sent a piece line (each_milli) to one unit of any good
-- counted by the container: bottle, case, keg, pack, glass or shot. So "1
-- lime" linked to Limes kept by the case would take a whole case a serve, and
-- "2 eggs" against Eggs kept by the pack two packs. The cost side refuses the
-- same pairs on purpose (recipe-cost.ts directCost: "1 lime linked to a case
-- of limes would cost the case"), so stock and cost disagreed both ways.
--
-- A piece now meets only a good the shelf counts each, as on the cost side.
-- Every other unit waits with measure_mismatch, so the sale waits (I2) rather
-- than draw a container a piece. recipe-draw.ts route() changes with it; the
-- parity table in the remainder migration's test holds both to the same rows.
-- Only the each_milli branch differs from the function it replaces.

begin;

create or replace function public.recipe_draw_route(
  p_base text, p_uom text, p_bottle_ml integer,
  out via text, out base_per_unit bigint, out wait text)
language plpgsql immutable set search_path = public, pg_temp as $$
begin
  if p_uom is null or p_uom = '' then wait := 'no_unit'; return; end if;
  if p_base = 'ml10' then
    if p_uom = 'ml' then via := 'book'; base_per_unit := 10; return; end if;
    if p_uom = 'l' then via := 'book'; base_per_unit := 10000; return; end if;
    if p_uom in ('bottle', 'keg') then
      if p_bottle_ml is not null and p_bottle_ml > 0 then
        via := 'pour'; base_per_unit := 10;
      else
        wait := 'no_container_size';
      end if;
      return;
    end if;
    wait := 'measure_mismatch'; return;
  end if;
  if p_base = 'mg' then
    if p_uom = 'mg' then via := 'book'; base_per_unit := 1; return; end if;
    if p_uom = 'g' then via := 'book'; base_per_unit := 1000; return; end if;
    if p_uom = 'kg' then via := 'book'; base_per_unit := 1000000; return; end if;
    wait := 'measure_mismatch'; return;
  end if;
  if p_base = 'each_milli' then
    if p_uom = 'each' then
      via := 'book'; base_per_unit := 1000; return;
    end if;
    wait := 'measure_mismatch'; return;
  end if;
  wait := 'measure_mismatch';
end $$;

revoke all on function public.recipe_draw_route(text, text, integer) from public, anon, authenticated;
grant execute on function public.recipe_draw_route(text, text, integer) to service_role;

commit;

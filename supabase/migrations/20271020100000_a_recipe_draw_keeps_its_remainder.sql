-- A recipe draw keeps its remainder (inventory r28 audit, gap 1, slice 3a of
-- the recipe draw). Slice 1 (#1396) is the planner, apps/api-gateway/src/
-- pos-hub/recipe-draw.ts. Slice 2 (#1421) lets a till button name its drink
-- recipe. 3b books a sale's draw, 3c gives a voided sale's draw back, and
-- slice 4 wires the till to them. This file holds what 3b and 3c share: the
-- two tables, how a recipe measure reaches a good's unit, and the arithmetic
-- that turns an exact draw into whole ledger units. Nothing writes the tables
-- yet, and no sale moves differently.
--
-- THE SPLIT (the session's call, under the 2026-11-07 /goal). The gateway
-- plans (which goods, how much, exact to a millionth of a base unit, or why
-- the line waits); the database does what needs the lock: house and unit
-- re-checked, the carry settled, the shelf checked, the draw booked and
-- recorded. Rejected: re-planning in PL/pgSQL, as the slice-1 brief had it.
-- That is a second planner that can drift, and it would need recipe_versions,
-- which lives on an unmerged chain (#863).
--
-- PARITY. What both sides must agree on is the three functions below. The
-- test file holds their case tables; it asserts these functions against them,
-- and recipe-draw.parity.spec.ts asserts route(), settle() and unsettle() in
-- recipe-draw.ts against the same rows.
--
-- INVARIANTS kept here (3b and 3c state the rest):
--   W1 Conservation. For each house, good, via and base unit:
--      (units booked - units given back) * one unit + carry
--        = the exact draws of the sales still standing.
--      Every recipe_draws row states it for itself (CHECKs recipe_draws_settled
--      and recipe_draws_void_settled), so a row that breaks it cannot be written.
--   W2 0 <= carry < one ledger unit, after every write.
--
-- THE CARRY KEY (the session's call): (house, good, via, base unit). A good
-- whose unit moves from g to kg keeps its carry (both are mg). One that moves
-- to another measure starts a new row, and the old row stays still. Rejected:
-- keying by (good, via) alone, which would add tenths of a ml to mg.
--
-- Version: past every migration on main and on every open PR at writing
-- (newest seen: 20271015100000_a_till_button_names_its_drink_recipe, #1421).

-- ---------------------------------------------------------------------------
-- 1. The carried remainder, one row per good and measure
-- ---------------------------------------------------------------------------
create table public.recipe_draw_carry (
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  inventory_id  uuid not null references public.restaurant_inventory(id) on delete cascade,
  via           text not null check (via in ('book', 'pour')),
  base_unit     text not null check (base_unit in ('ml10', 'mg', 'each_milli')),
  carry_micro   bigint not null default 0 check (carry_micro >= 0),
  updated_at    timestamptz not null default now(),
  primary key (restaurant_id, inventory_id, via, base_unit)
);
comment on table public.recipe_draw_carry is
  'What recipe sales drew from a good but did not yet book, in millionths of the base unit (ml10, mg, each_milli); under one ledger unit after a write. Written only under the good''s row lock.';

-- ---------------------------------------------------------------------------
-- 2. What each sale booked, so its void can give back exactly that
-- ---------------------------------------------------------------------------
create table public.recipe_draws (
  draw_key       text primary key check (btrim(draw_key) <> ''),
  sale_key       text not null check (btrim(sale_key) <> ''),
  restaurant_id  uuid not null references public.restaurants(id) on delete cascade,
  inventory_id   uuid not null references public.restaurant_inventory(id) on delete cascade,
  via            text not null check (via in ('book', 'pour')),
  base_unit      text not null check (base_unit in ('ml10', 'mg', 'each_milli')),
  base_per_unit  bigint not null check (base_per_unit > 0),
  exact_micro    bigint not null check (exact_micro >= 0),
  carry_in       bigint not null check (carry_in >= 0),
  carry_out      bigint not null check (carry_out >= 0),
  units          bigint not null check (units >= 0),
  version_id     uuid not null,
  cocktail_id    uuid references public.cocktails(id) on delete set null,
  occurred_at    timestamptz,
  created_at     timestamptz not null default now(),
  voided_at      timestamptz,
  units_returned bigint check (units_returned >= 0),
  void_carry_in  bigint check (void_carry_in >= 0),
  void_carry_out bigint check (void_carry_out >= 0),
  -- W1/W2 for the sale: whole units plus what is carried = what came in.
  constraint recipe_draws_settled check (
    units * base_per_unit * 1000000 + carry_out = carry_in + exact_micro
    and carry_out < base_per_unit * 1000000),
  -- A void states all three of its figures, or none.
  constraint recipe_draws_void_whole check (
    (voided_at is null) = (units_returned is null)
    and (voided_at is null) = (void_carry_in is null)
    and (voided_at is null) = (void_carry_out is null)),
  -- W1/W2 for the void: the exact draw leaves the carry, the units come back.
  constraint recipe_draws_void_settled check (
    voided_at is null
    or (void_carry_out + exact_micro = void_carry_in + units_returned * base_per_unit * 1000000
        and void_carry_out < base_per_unit * 1000000))
);
create index recipe_draws_sale_idx on public.recipe_draws (restaurant_id, sale_key);
comment on table public.recipe_draws is
  'One row per good a recipe sale drew: exact draw, units booked, carry before and after, version sold. version_id has no foreign key, so this stands on main before recipe_versions (#863) lands. A void fills the void columns. Written only by record_recipe_draw and reverse_recipe_draw.';
comment on column public.recipe_draws.draw_key is
  'sale_key || '':r:'' || inventory_id || '':'' || via, the drawKey of recipe-draw.ts (I4). It is the ledger''s idempotency key for a booked draw; the void''s is draw_key || '':void''.';

-- ---------------------------------------------------------------------------
-- 3. The two shared pieces: how a measure reaches a good's unit, and settle
-- ---------------------------------------------------------------------------

-- recipe-draw.ts route(), case for case (parity cases R* in the test file).
create function public.recipe_draw_route(
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
    if p_uom in ('each', 'bottle', 'case', 'keg', 'pack', 'glass', 'shot') then
      via := 'book'; base_per_unit := 1000; return;
    end if;
    wait := 'measure_mismatch'; return;
  end if;
  wait := 'measure_mismatch';
end $$;

-- recipe-draw.ts settle() (parity cases S*): whole units, and the remainder.
create function public.recipe_draw_settle(
  p_exact_micro bigint, p_base_per_unit bigint, p_carry_in bigint,
  out units bigint, out carry_out bigint)
language plpgsql immutable set search_path = public, pg_temp as $$
declare v_unit bigint; v_total bigint;
begin
  if p_exact_micro is null or p_base_per_unit is null or p_carry_in is null
     or p_exact_micro < 0 or p_carry_in < 0 or p_base_per_unit <= 0 then
    raise exception 'recipe_draw_settle takes a draw, a unit and a carry that are not negative'
      using errcode = '22023';
  end if;
  v_unit := p_base_per_unit * 1000000;
  v_total := p_carry_in + p_exact_micro;
  units := v_total / v_unit;
  carry_out := v_total % v_unit;
end $$;

-- recipe-draw.ts unsettle() (parity cases U*): what a void gives back (W7).
create function public.recipe_draw_unsettle(
  p_exact_micro bigint, p_base_per_unit bigint, p_carry_in bigint,
  out units bigint, out carry_out bigint)
language plpgsql immutable set search_path = public, pg_temp as $$
declare v_unit bigint; v_owed bigint;
begin
  if p_exact_micro is null or p_base_per_unit is null or p_carry_in is null
     or p_exact_micro < 0 or p_carry_in < 0 or p_base_per_unit <= 0 then
    raise exception 'recipe_draw_unsettle takes a draw, a unit and a carry that are not negative'
      using errcode = '22023';
  end if;
  v_unit := p_base_per_unit * 1000000;
  if p_exact_micro <= p_carry_in then
    units := 0; carry_out := p_carry_in - p_exact_micro; return;
  end if;
  v_owed := p_exact_micro - p_carry_in;
  units := (v_owed + v_unit - 1) / v_unit;
  carry_out := units * v_unit - v_owed;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Grants and RLS. The gateway reads and writes with service_role; clients
--    hold no grant (OD-72; check_new_tables_are_locked_down).
-- ---------------------------------------------------------------------------
alter table public.recipe_draw_carry enable row level security;
alter table public.recipe_draws enable row level security;
revoke all on public.recipe_draw_carry from anon, authenticated;
revoke all on public.recipe_draws from anon, authenticated;
grant all on public.recipe_draw_carry, public.recipe_draws to service_role;
create policy recipe_draw_carry_service_role on public.recipe_draw_carry
  for all to service_role using (true) with check (true);
create policy recipe_draws_service_role on public.recipe_draws
  for all to service_role using (true) with check (true);

revoke all on function public.recipe_draw_route(text, text, integer) from public, anon, authenticated;
revoke all on function public.recipe_draw_settle(bigint, bigint, bigint) from public, anon, authenticated;
revoke all on function public.recipe_draw_unsettle(bigint, bigint, bigint) from public, anon, authenticated;
grant execute on function public.recipe_draw_route(text, text, integer) to service_role;
grant execute on function public.recipe_draw_settle(bigint, bigint, bigint) to service_role;
grant execute on function public.recipe_draw_unsettle(bigint, bigint, bigint) to service_role;

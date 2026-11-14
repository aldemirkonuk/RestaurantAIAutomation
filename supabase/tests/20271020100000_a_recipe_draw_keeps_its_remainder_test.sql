-- A recipe draw keeps its remainder (inventory r28 gap 1, slice 3a; migration
-- 20271020100000_a_recipe_draw_keeps_its_remainder.sql).
--
-- Run on a database built from supabase/migrations; one transaction, rolled
-- back. One row per case (id, ok, detail); every ok must be true. Without the
-- migration the first parity case errors, which is the control.
--
-- The three PARITY tables below are also read by
-- apps/api-gateway/src/pos-hub/recipe-draw.parity.spec.ts, which feeds the
-- same rows to route(), settle() and unsettle() in recipe-draw.ts. Keep one
-- row per line between the begin and end markers, in the form shown.

begin;

create temp table _t (id text primary key, ok boolean, detail text) on commit drop;

-- PARITY: route (base unit, uom, bottle ml) -> via, base_per_unit, or wait
create temp table _route (id text, base text, uom text, bottle_ml integer, via text, bpu bigint, wait text) on commit drop;
insert into _route values
-- parity:route:begin
  ('R01', 'ml10', 'ml', null, 'book', 10, null),
  ('R02', 'ml10', 'l', null, 'book', 10000, null),
  ('R03', 'ml10', 'bottle', 700, 'pour', 10, null),
  ('R04', 'ml10', 'keg', 30000, 'pour', 10, null),
  ('R05', 'ml10', 'bottle', null, null, null, 'no_container_size'),
  ('R06', 'ml10', 'bottle', 0, null, null, 'no_container_size'),
  ('R07', 'ml10', 'g', null, null, null, 'measure_mismatch'),
  ('R08', 'ml10', 'case', 750, null, null, 'measure_mismatch'),
  ('R09', 'mg', 'mg', null, 'book', 1, null),
  ('R10', 'mg', 'g', null, 'book', 1000, null),
  ('R11', 'mg', 'kg', null, 'book', 1000000, null),
  ('R12', 'mg', 'ml', null, null, null, 'measure_mismatch'),
  ('R13', 'mg', 'each', null, null, null, 'measure_mismatch'),
  ('R14', 'each_milli', 'each', null, 'book', 1000, null),
  ('R15', 'each_milli', 'bottle', 700, 'book', 1000, null),
  ('R16', 'each_milli', 'case', null, 'book', 1000, null),
  ('R17', 'each_milli', 'shot', null, 'book', 1000, null),
  ('R18', 'each_milli', 'g', null, null, null, 'measure_mismatch'),
  ('R19', 'ml10', null, null, null, null, 'no_unit'),
  ('R20', 'mg', '', null, null, null, 'no_unit');
-- parity:route:end

insert into _t
select 'P-route', bool_and(r.via is not distinct from x.via and r.bpu is not distinct from x.base_per_unit
                           and r.wait is not distinct from x.wait),
       coalesce(string_agg(r.id, ',') filter (where not (r.via is not distinct from x.via
              and r.bpu is not distinct from x.base_per_unit and r.wait is not distinct from x.wait)), 'all match')
  from _route r cross join lateral public.recipe_draw_route(r.base, r.uom, r.bottle_ml) x;

-- PARITY: settle and unsettle (exact micro, base per unit, carry in) -> units, carry out
create temp table _settle (id text, exact bigint, bpu bigint, carry_in bigint, units bigint, carry_out bigint) on commit drop;
insert into _settle values
-- parity:settle:begin
  ('S01', 7500000000, 1000, 0, 7, 500000000),
  ('S02', 7500000000, 1000, 500000000, 8, 0),
  ('S03', 400000000, 1000, 0, 0, 400000000),
  ('S04', 400000000, 1000, 800000000, 1, 200000000),
  ('S05', 450000000, 10, 0, 45, 0),
  ('S06', 0, 10, 3000000, 0, 3000000),
  ('S07', 1000000, 10, 9000000, 1, 0),
  ('S08', 1500000000, 1000, 0, 1, 500000000),
  ('S09', 12500000000000, 1000000, 999999999999, 13, 499999999999),
  ('S10', 1, 1, 0, 0, 1);
-- parity:settle:end

create temp table _unsettle (id text, exact bigint, bpu bigint, carry_in bigint, units bigint, carry_out bigint) on commit drop;
insert into _unsettle values
-- parity:unsettle:begin
  ('U01', 7500000000, 1000, 500000000, 7, 0),
  ('U02', 7500000000, 1000, 0, 8, 500000000),
  ('U03', 400000000, 1000, 400000000, 0, 0),
  ('U04', 400000000, 1000, 900000000, 0, 500000000),
  ('U05', 450000000, 10, 0, 45, 0),
  ('U06', 0, 10, 3000000, 0, 3000000),
  ('U07', 1500000000, 1000, 500000000, 1, 0),
  ('U08', 1000000, 10, 0, 1, 9000000),
  ('U09', 12500000000000, 1000000, 499999999999, 13, 999999999999);
-- parity:unsettle:end

insert into _t
select 'P-settle', bool_and(x.units = s.units and x.carry_out = s.carry_out),
       coalesce(string_agg(s.id, ',') filter (where not (x.units = s.units and x.carry_out = s.carry_out)), 'all match')
  from _settle s cross join lateral public.recipe_draw_settle(s.exact, s.bpu, s.carry_in) x;
insert into _t
select 'P-unsettle', bool_and(x.units = s.units and x.carry_out = s.carry_out),
       coalesce(string_agg(s.id, ',') filter (where not (x.units = s.units and x.carry_out = s.carry_out)), 'all match')
  from _unsettle s cross join lateral public.recipe_draw_unsettle(s.exact, s.bpu, s.carry_in) x;

-- The record cannot say what the arithmetic does not (W1, W2).
do $$ begin
  insert into public.restaurants (id, name, slug) values
    ('d3a00000-0000-4000-8000-000000000001', 'Draw test house', 'draw-test-house');
  insert into public.restaurant_inventory
    (id, restaurant_id, kind, uom, display_name, identity_provenance)
  values ('d3a00000-0000-4000-8000-000000000102', 'd3a00000-0000-4000-8000-000000000001',
          'food', 'g', 'Salt', 'house_declared');
end $$;

create function pg_temp.rec(p_key text, p_units bigint, p_carry_out bigint) returns void language sql as $$
  insert into public.recipe_draws (draw_key, sale_key, restaurant_id, inventory_id, via, base_unit, base_per_unit,
    exact_micro, carry_in, carry_out, units, version_id)
  values (p_key, p_key, 'd3a00000-0000-4000-8000-000000000001', 'd3a00000-0000-4000-8000-000000000102',
    'book', 'mg', 1000, 7500000000, 0, p_carry_out, p_units, gen_random_uuid())
$$;

-- C0: 7.5 g booked as 7 g with half a gram carried is a record that adds up.
do $$ begin
  perform pg_temp.rec('good', 7, 500000000);
  insert into _t values ('C0', true, 'written');
end $$;

-- C1: 7.5 g booked as 8 g does not add up and cannot be written.
do $$ begin
  begin
    perform pg_temp.rec('bad-units', 8, 500000000);
    insert into _t values ('C1', false, 'a record booking 8 g for 7.5 g was written');
  exception when check_violation then
    insert into _t values ('C1', true, 'refused');
  end;
end $$;

-- C2 (W2): a carry of a whole gram or more is booked, never carried.
do $$ begin
  begin
    perform pg_temp.rec('bad-carry', 6, 1500000000);
    insert into _t values ('C2', false, 'a carry of 1.5 g was written');
  exception when check_violation then
    insert into _t values ('C2', true, 'refused');
  end;
end $$;

-- C3: a void must add up too: giving back 9 g for a 7.5 g draw with no carry is refused.
do $$ begin
  begin
    update public.recipe_draws set voided_at = now(), units_returned = 9, void_carry_in = 0, void_carry_out = 0
     where draw_key = 'good';
    insert into _t values ('C3', false, 'a void that does not add up was written');
  exception when check_violation then
    insert into _t values ('C3', true, 'refused');
  end;
end $$;

-- C4: a void that adds up is written (8 g back, half a gram carried on), and it states all three figures.
do $$ declare n int := 0; begin
  update public.recipe_draws set voided_at = now(), units_returned = 8, void_carry_in = 0, void_carry_out = 500000000
   where draw_key = 'good';
  begin
    update public.recipe_draws set void_carry_out = null where draw_key = 'good';
  exception when check_violation then n := 1;
  end;
  insert into _t select 'C4', n = 1 and voided_at is not null, 'written; a partial void refused'
    from public.recipe_draws where draw_key = 'good';
end $$;

-- C5: no client role reads the tables or calls the arithmetic.
insert into _t
select 'C5',
  not has_table_privilege('authenticated', 'public.recipe_draws', 'select')
  and not has_table_privilege('anon', 'public.recipe_draw_carry', 'select')
  and not has_function_privilege('anon', 'public.recipe_draw_settle(bigint, bigint, bigint)', 'execute')
  and not has_function_privilege('authenticated', 'public.recipe_draw_unsettle(bigint, bigint, bigint)', 'execute'),
  'client grants';

select id, ok, detail from _t order by id;

rollback;

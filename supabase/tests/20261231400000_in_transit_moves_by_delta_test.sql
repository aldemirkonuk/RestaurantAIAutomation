-- F-351: migration in_transit_moves_by_delta. The in-transit counter moves by
-- a delta in one statement, floored at 0, scoped to the house, and callable by
-- service_role only.
--
-- Self-asserting: every block raises on a failure, so `psql -v ON_ERROR_STOP=1
-- -f` stops at the first one. Synthetic fixtures only, one transaction, rolled
-- back. On a build WITHOUT the migration every block FAILS on the missing
-- function.
--
-- What a single session cannot show is two moves racing. That part rests on
-- the function being one UPDATE ... SET x = x + d: Postgres takes the row lock
-- and re-reads the row before applying the second, which is the property the
-- gateway's read-then-write did not have.

begin;

insert into public.restaurants (id, name, slug) values
  ('f3510000-0000-4000-8000-000000000001', 'F351 house', 'f351-house'),
  ('f3510000-0000-4000-8000-000000000002', 'F351 other house', 'f351-other-house');

insert into public.restaurant_inventory (id, restaurant_id, kind, uom, display_name, identity_provenance) values
  ('f3510000-0000-4000-8000-0000000000c1', 'f3510000-0000-4000-8000-000000000001', 'wine', 'bottle', 'Zqf351 Shelf', 'house_declared');

-- T1: two reserves and a release compose; nothing is lost.
do $$
declare v integer;
begin
  perform public.move_in_transit_by_delta('f3510000-0000-4000-8000-000000000001', 'f3510000-0000-4000-8000-0000000000c1', 6);
  perform public.move_in_transit_by_delta('f3510000-0000-4000-8000-000000000001', 'f3510000-0000-4000-8000-0000000000c1', 4);
  v := public.move_in_transit_by_delta('f3510000-0000-4000-8000-000000000001', 'f3510000-0000-4000-8000-0000000000c1', -3);
  assert v = 7, format('T1: expected 7 in transit, got %s', v);
  select in_transit_quantity into v from public.restaurant_inventory where id = 'f3510000-0000-4000-8000-0000000000c1';
  assert v = 7, format('T1: row reads %s, not 7', v);
end $$;

-- T2: a release larger than what is on order floors at 0, as every caller did.
do $$
declare v integer;
begin
  v := public.move_in_transit_by_delta('f3510000-0000-4000-8000-000000000001', 'f3510000-0000-4000-8000-0000000000c1', -50);
  assert v = 0, format('T2: expected 0, got %s', v);
end $$;

-- T3: a NULL counter is read as 0, not left NULL.
do $$
declare v integer;
begin
  update public.restaurant_inventory set in_transit_quantity = null where id = 'f3510000-0000-4000-8000-0000000000c1';
  v := public.move_in_transit_by_delta('f3510000-0000-4000-8000-000000000001', 'f3510000-0000-4000-8000-0000000000c1', 2);
  assert v = 2, format('T3: expected 2, got %s', v);
end $$;

-- T4: another house's id changes nothing and answers NULL.
do $$
declare v integer;
begin
  v := public.move_in_transit_by_delta('f3510000-0000-4000-8000-000000000002', 'f3510000-0000-4000-8000-0000000000c1', 9);
  assert v is null, format('T4: another house moved the counter to %s', v);
  select in_transit_quantity into v from public.restaurant_inventory where id = 'f3510000-0000-4000-8000-0000000000c1';
  assert v = 2, format('T4: row reads %s, not 2', v);
end $$;

-- T5: only service_role may call it.
do $$
begin
  assert has_function_privilege('service_role', 'public.move_in_transit_by_delta(uuid, uuid, integer)', 'execute'),
    'T5: service_role cannot execute';
  assert not has_function_privilege('anon', 'public.move_in_transit_by_delta(uuid, uuid, integer)', 'execute'),
    'T5: anon can execute';
  assert not has_function_privilege('authenticated', 'public.move_in_transit_by_delta(uuid, uuid, integer)', 'execute'),
    'T5: authenticated can execute';
end $$;

rollback;

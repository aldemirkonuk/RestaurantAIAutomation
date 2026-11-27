-- r109 (DD-r108-21): one return_glass_pour, and r57's whole/fraction split
-- voided part by part under each part's own sale key. A void returns only what
-- its part booked, at most once. Self-asserting; synthetic; rolled back.
-- Run on a database built from supabase/migrations (PGlite in r109, superuser).

begin;

create function pg_temp.h() returns uuid language sql as $$ select 'a1090000-0000-4000-8000-000000000001'::uuid $$;
create function pg_temp.it() returns uuid language sql as $$ select 'a1090000-0000-4000-8000-000000000201'::uuid $$;
create function pg_temp.ml() returns bigint language sql as $$
  select coalesce(sum(open_bottle_ml), 0) + coalesce(sum(qty), 0) * 750
    from public.inventory_lots where inventory_id = pg_temp.it() and stock_state = 'live' $$;

do $$
declare r jsonb; before bigint;
begin
  -- O1: one definition, the sale-keyed one.
  if (select count(*) from pg_proc where proname = 'return_glass_pour') <> 1 then
    raise exception 'O1: expected one return_glass_pour, got %', (select count(*) from pg_proc where proname = 'return_glass_pour');
  end if;

  insert into public.restaurants (id, name, slug) values (pg_temp.h(), 'OV test house', 'ov-test-house');
  insert into public.master_wine_library (id, wine_id, name, primary_type)
  values ('a1090000-0000-4000-8000-000000000101', 'OV-TEST-1', 'OV wine', 'red');
  insert into public.restaurant_inventory (id, restaurant_id, master_wine_id, bottle_size_ml, pour_size_ml)
  values (pg_temp.it(), pg_temp.h(), 'a1090000-0000-4000-8000-000000000101', 750, 150);
  insert into public.inventory_lots (restaurant_id, inventory_id, master_wine_id, qty, open_bottle_ml)
  values (pg_temp.h(), pg_temp.it(), 'a1090000-0000-4000-8000-000000000101', 5, 0);
  before := pg_temp.ml();

  -- The sale of 1.5 bottles, as pos-hub books it: the whole bottle by unit
  -- move under K, the half as one 375 ml pour under K:frac.
  perform public.apply_stock_movement(
    p_inventory_id => pg_temp.it(), p_stock_state => 'live', p_delta => -1,
    p_transaction_type => 'sale', p_source => 'pos', p_reason => 'ov sale',
    p_idempotency_key => 'ov:K', p_restaurant_id => pg_temp.h());
  perform public.record_glass_pour(pg_temp.it(), 1, 375, null, 'pos', null, 'ov sale', 'ov:K:frac');
  if pg_temp.ml() <> before - 1125 then raise exception 'setup: the sale drew % ml', before - pg_temp.ml(); end if;

  -- O2: each part voided under its own sale key gives back what it booked.
  r := public.return_glass_pour(pg_temp.h(), pg_temp.it(), 'ov:K', 1, 'ov:K:void');
  if (r->>'returned_bottles')::int <> 1 then raise exception 'O2: the whole part gave back %', r; end if;
  r := public.return_glass_pour(pg_temp.h(), pg_temp.it(), 'ov:K:frac', 1, 'ov:K:frac:void');
  if (r->>'returned_ml')::int <> 375 then raise exception 'O2: the fraction gave back %', r; end if;
  if pg_temp.ml() <> before then raise exception 'O2: after both voids the shelf holds % ml, not %', pg_temp.ml(), before; end if;

  -- O3: a replayed void moves nothing.
  r := public.return_glass_pour(pg_temp.h(), pg_temp.it(), 'ov:K:frac', 1, 'ov:K:frac:void');
  if coalesce((r->>'idempotent')::boolean, false) is not true then raise exception 'O3: a replay was not idempotent: %', r; end if;

  -- O4: a second void of the same sale under ANOTHER key gives back nothing
  -- (capped once across voids), for both parts.
  r := public.return_glass_pour(pg_temp.h(), pg_temp.it(), 'ov:K', 1, 'ov:K:void2');
  if coalesce((r->>'returned_bottles')::int, -1) <> 0 then raise exception 'O4: the whole part gave back again: %', r; end if;
  r := public.return_glass_pour(pg_temp.h(), pg_temp.it(), 'ov:K:frac', 1, 'ov:K:frac:void2');
  if coalesce((r->>'returned_ml')::int, -1) <> 0 then raise exception 'O4: the fraction gave back again: %', r; end if;
  if pg_temp.ml() <> before then raise exception 'O4: the shelf moved to % ml', pg_temp.ml(); end if;

  -- O5: the ml-based call shape is gone (42883), so nothing can return by ml.
  begin
    perform public.return_glass_pour(p_inventory_id => pg_temp.it(), p_pours => 1, p_pour_ml => 375,
      p_restaurant_id => pg_temp.h(), p_idempotency_key => 'ov:ml');
    raise exception 'O5: the ml-based overload still answers';
  exception when undefined_function then null; end;
end $$;

rollback;

-- F-1544 lane 2: migration a_count_names_its_open_bottles.
--   A count names what is left in the open bottles (F3 a: integer ml in the
--   one count writer), a line of a stock-take names its walk, and a second
--   line for the same shelf in the same walk is held, not posted (F2 a).
--   A spot count that names neither is exactly what it was.
--
-- Self-asserting: every block raises on a failure, so the PGlite harness or
-- `psql -v ON_ERROR_STOP=1 -f` stops at the first one. On a build WITHOUT the
-- migration T1 FAILS (no counted_open_ml). One transaction, rolled back.
-- All fixtures are SYNTHETIC, keyed by fresh uuids.

begin;

create temporary table t_fx (k text primary key, v uuid) on commit drop;
insert into t_fx values
  ('house', gen_random_uuid()), ('other', gen_random_uuid()),
  ('wine', gen_random_uuid()), ('item', gen_random_uuid()),
  ('bar', gen_random_uuid()), ('cellar', gen_random_uuid()), ('back', gen_random_uuid()),
  ('person', gen_random_uuid()), ('second', gen_random_uuid()),
  ('s_walk', gen_random_uuid()), ('s_other', gen_random_uuid()),
  ('lot_old', gen_random_uuid()), ('lot_new', gen_random_uuid()), ('lot_dregs', gen_random_uuid());

insert into public.restaurants (id, name, slug)
select v, 'SYNTHETIC open-bottle count ' || k, 'syn-cntopen-' || left(replace(v::text, '-', ''), 16)
  from t_fx where k in ('house', 'other');

insert into public.users (user_id, email, name, role, restaurant_id)
select (select v from t_fx where k = p), 'zqob-' || p || '@example.invalid', 'Zqob ' || p, 'staff',
       (select v from t_fx where k = 'house')
  from (values ('person'), ('second')) as x(p);

insert into public.master_wine_library (id, wine_id, name, primary_type)
select v, 'SYN-OB-' || left(replace(v::text, '-', ''), 12), 'SYNTHETIC Narince', 'white'
  from t_fx where k = 'wine';

insert into public.restaurant_inventory (id, restaurant_id, master_wine_id, bottle_size_ml, pour_size_ml)
select (select v from t_fx where k = 'item'), (select v from t_fx where k = 'house'),
       (select v from t_fx where k = 'wine'), 750, 150;

insert into public.storage_locations (id, restaurant_id, zone, capacity_bottles)
select (select v from t_fx where k = s), (select v from t_fx where k = 'house'), z, 50
  from (values ('bar', 'Bar'), ('cellar', 'Cellar'), ('back', 'Back bar')) as x(s, z);

-- The bar: an older lot of 3 with 400 ml open, a newer lot of 2 with 200 ml
-- open, and the dregs of a finished lot (0 bottles, 50 ml).
insert into public.inventory_lots
  (id, restaurant_id, inventory_id, master_wine_id, stock_state, qty, open_bottle_ml, location_id, received_at)
select (select v from t_fx where k = l), (select v from t_fx where k = 'house'), (select v from t_fx where k = 'item'),
       (select v from t_fx where k = 'wine'), 'live', q, ml, (select v from t_fx where k = 'bar'), now() - r
  from (values ('lot_dregs', 0, 50, interval '30 days'),
               ('lot_old', 3, 400, interval '20 days'),
               ('lot_new', 2, 200, interval '2 days')) as x(l, q, ml, r);

insert into public.stock_count_sessions (id, restaurant_id, kind, opened_by)
select (select v from t_fx where k = 's_walk'), (select v from t_fx where k = 'house'), 'closing',
       (select v from t_fx where k = 'person');
insert into public.stock_count_sessions (id, restaurant_id, kind)
select (select v from t_fx where k = 's_other'), (select v from t_fx where k = 'other'), 'full';

-- T1 the columns, the held-line table locked down, still one count writer.
do $$
declare
  c text;
begin
  foreach c in array array['expected_open_ml', 'counted_open_ml', 'variance_open_ml'] loop
    assert exists (select 1 from information_schema.columns
                    where table_schema = 'public' and table_name = 'stock_counts' and column_name = c),
      format('T1 FAIL stock_counts has no %s', c);
  end loop;
  assert to_regclass('public.stock_count_held_lines') is not null, 'T1 FAIL no stock_count_held_lines';
  assert (select relrowsecurity from pg_class where oid = to_regclass('public.stock_count_held_lines')),
    'T1 FAIL stock_count_held_lines has RLS off';
  if exists (select 1 from pg_roles where rolname = 'anon') then
    assert not has_table_privilege('anon', 'public.stock_count_held_lines', 'select'),
      'T1 FAIL anon can read stock_count_held_lines';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    assert not has_table_privilege('authenticated', 'public.stock_count_held_lines', 'select'),
      'T1 FAIL authenticated can read stock_count_held_lines';
  end if;
  assert (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'record_stock_count') = 1,
    'T1 FAIL there is not exactly one record_stock_count';
  assert not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                      where n.nspname = 'public' and p.proname ~* '(record|set)_open_bottle'),
    'T1 FAIL a second open-bottle count writer exists';
end $$;

-- T2 the strict no-op: a spot count naming neither open ml nor a walk gives
-- the base's exact keys, leaves the open bottles as they were and records no
-- open figures.
do $$
declare
  v_item uuid := (select v from t_fx where k = 'item');
  r jsonb;
begin
  r := public.record_stock_count(
    p_inventory_id => v_item, p_counted_qty => 5, p_idempotency_key => 'syn-cntopen-t2-' || v_item::text,
    p_location_id => (select v from t_fx where k = 'bar'), p_reason => 'SYNTHETIC spot count');
  assert (select array_agg(k order by k) from jsonb_object_keys(r) k)
         = array['cost_applied', 'count_id', 'counted_at', 'counted_qty', 'expected_qty',
                 'location_id', 'replayed', 'transaction_id', 'variance_qty'],
    format('T2 FAIL the spot count''s result changed shape: %s', r);
  assert (r->>'variance_qty')::int = 0, format('T2 FAIL variance %s, not 0', r->>'variance_qty');
  assert (select expected_open_ml is null and counted_open_ml is null and variance_open_ml is null and session_id is null
            from public.stock_counts where id = (r->>'count_id')::uuid),
    'T2 FAIL a spot count recorded open figures or a walk';
  assert (select sum(open_bottle_ml) from public.inventory_lots where inventory_id = v_item) = 650,
    'T2 FAIL a spot count with no open figure changed the open bottles';
end $$;

-- T3 fewer ml than the books: the open bottles come down oldest first, the
-- dregs lot (0 bottles, now 0 ml) goes, and the count row says 650 -> 150.
do $$
declare
  v_item uuid := (select v from t_fx where k = 'item');
  r jsonb;
begin
  r := public.record_stock_count(
    p_inventory_id => v_item, p_counted_qty => 5, p_idempotency_key => 'syn-cntopen-t3-' || v_item::text,
    p_location_id => (select v from t_fx where k = 'bar'), p_counted_open_ml => 150,
    p_performed_by => (select v from t_fx where k = 'person'));
  assert (r->>'expected_open_ml')::int = 650 and (r->>'counted_open_ml')::int = 150
         and (r->>'variance_open_ml')::int = -500 and (r->>'held')::boolean = false,
    format('T3 FAIL the answer did not say 650 -> 150 ml: %s', r);
  assert (select expected_open_ml = 650 and counted_open_ml = 150 and variance_open_ml = -500
            from public.stock_counts where id = (r->>'count_id')::uuid),
    'T3 FAIL the count row does not hold the open figures';
  assert not exists (select 1 from public.inventory_lots where id = (select v from t_fx where k = 'lot_dregs')),
    'T3 FAIL the emptied dregs lot (0 bottles, 0 ml) stayed';
  assert (select open_bottle_ml from public.inventory_lots where id = (select v from t_fx where k = 'lot_old')) = 0,
    'T3 FAIL the older open bottle was not drunk first';
  assert (select open_bottle_ml from public.inventory_lots where id = (select v from t_fx where k = 'lot_new')) = 150,
    'T3 FAIL the newer open bottle does not hold the rest (150 ml)';
  assert (select sum(qty) from public.inventory_lots where inventory_id = v_item) = 5,
    'T3 FAIL an open-ml count moved sealed bottles';
end $$;

-- T4 more ml than the books: onto the open bottle already on the shelf; and a
-- shelf with no lot at all gets one of 0 bottles, uncosted, on that shelf.
do $$
declare
  v_item uuid := (select v from t_fx where k = 'item');
  r jsonb;
begin
  r := public.record_stock_count(
    p_inventory_id => v_item, p_counted_qty => 5, p_idempotency_key => 'syn-cntopen-t4a-' || v_item::text,
    p_location_id => (select v from t_fx where k = 'bar'), p_counted_open_ml => 525);
  assert (r->>'variance_open_ml')::int = 375, format('T4 FAIL bar variance %s, not 375', r->>'variance_open_ml');
  assert (select open_bottle_ml from public.inventory_lots where id = (select v from t_fx where k = 'lot_new')) = 525,
    'T4 FAIL the surplus did not go onto the open bottle already there';

  r := public.record_stock_count(
    p_inventory_id => v_item, p_counted_qty => 0, p_idempotency_key => 'syn-cntopen-t4b-' || v_item::text,
    p_location_id => (select v from t_fx where k = 'back'), p_counted_open_ml => 375);
  assert (r->>'expected_open_ml')::int = 0 and (r->>'variance_qty')::int = 0,
    format('T4 FAIL the back bar answer: %s', r);
  assert (select count(*) = 1 and sum(qty) = 0 and sum(open_bottle_ml) = 375 and bool_and(unit_cost is null)
            from public.inventory_lots
           where inventory_id = v_item and location_id = (select v from t_fx where k = 'back')),
    'T4 FAIL the back bar does not hold one uncosted lot of 0 bottles and 375 ml';
  -- The bar's own count did not touch the back bar, nor the back bar's the bar.
  assert (select sum(open_bottle_ml) from public.inventory_lots
           where inventory_id = v_item and location_id = (select v from t_fx where k = 'bar')) = 525,
    'T4 FAIL one shelf''s open count moved another shelf''s open bottles';
end $$;

-- T5 a retry replays: same answer, nothing moves twice.
do $$
declare
  v_item uuid := (select v from t_fx where k = 'item');
  r jsonb;
begin
  r := public.record_stock_count(
    p_inventory_id => v_item, p_counted_qty => 0, p_idempotency_key => 'syn-cntopen-t4b-' || v_item::text,
    p_location_id => (select v from t_fx where k = 'back'), p_counted_open_ml => 375);
  assert (r->>'replayed')::boolean and (r->>'counted_open_ml')::int = 375 and (r->>'expected_open_ml')::int = 0,
    format('T5 FAIL the retry did not replay the open figures: %s', r);
  assert (select sum(open_bottle_ml) from public.inventory_lots
           where inventory_id = v_item and location_id = (select v from t_fx where k = 'back')) = 375,
    'T5 FAIL a retried open count moved the open bottles twice';
  assert (select count(*) from public.stock_counts where idempotency_key = 'syn-cntopen-t4b-' || v_item::text) = 1,
    'T5 FAIL a retry recorded a second count';
end $$;

-- T6 a walk: a line names its own house's walk, never another's; a second
-- line for the same item and shelf in the walk is held, moves nothing, and
-- holds once however often it is sent; another shelf in the walk posts.
do $$
declare
  v_item uuid := (select v from t_fx where k = 'item');
  r jsonb;
  v_refused boolean := false;
  v_before int;
begin
  begin
    perform public.record_stock_count(
      p_inventory_id => v_item, p_counted_qty => 5, p_idempotency_key => 'syn-cntopen-t6x-' || v_item::text,
      p_location_id => (select v from t_fx where k = 'bar'), p_session_id => (select v from t_fx where k = 's_other'));
  exception when sqlstate '42501' then v_refused := true;
  end;
  assert v_refused, 'T6 FAIL a count named another house''s stock-take';
  assert not exists (select 1 from public.stock_counts where idempotency_key = 'syn-cntopen-t6x-' || v_item::text),
    'T6 FAIL a refused line left a count';

  r := public.record_stock_count(
    p_inventory_id => v_item, p_counted_qty => 4, p_idempotency_key => 'syn-cntopen-t6a-' || v_item::text,
    p_location_id => (select v from t_fx where k = 'bar'), p_counted_open_ml => 525,
    p_session_id => (select v from t_fx where k = 's_walk'), p_performed_by => (select v from t_fx where k = 'person'));
  assert (r->>'held')::boolean = false and (r->>'session_id')::uuid = (select v from t_fx where k = 's_walk')
         and (r->>'variance_qty')::int = -1,
    format('T6 FAIL the first line of the walk did not post: %s', r);
  assert (select session_id from public.stock_counts where id = (r->>'count_id')::uuid) = (select v from t_fx where k = 's_walk'),
    'T6 FAIL the count row does not name its walk';

  v_before := (select sum(qty) from public.inventory_lots where inventory_id = v_item);
  r := public.record_stock_count(
    p_inventory_id => v_item, p_counted_qty => 9, p_idempotency_key => 'syn-cntopen-t6b-' || v_item::text,
    p_location_id => (select v from t_fx where k = 'bar'), p_counted_open_ml => 0,
    p_session_id => (select v from t_fx where k = 's_walk'), p_performed_by => (select v from t_fx where k = 'second'));
  assert (r->>'held')::boolean and r->>'count_id' is null and (r->>'counted_qty')::int = 9,
    format('T6 FAIL a second line for the same shelf was not held: %s', r);
  assert (select sum(qty) from public.inventory_lots where inventory_id = v_item) = v_before,
    'T6 FAIL a held line moved bottles';
  assert (select sum(open_bottle_ml) from public.inventory_lots
           where inventory_id = v_item and location_id = (select v from t_fx where k = 'bar')) = 525,
    'T6 FAIL a held line moved open ml';
  assert not exists (select 1 from public.stock_counts where idempotency_key = 'syn-cntopen-t6b-' || v_item::text),
    'T6 FAIL a held line was posted as a count';
  assert (select counted_by = (select v from t_fx where k = 'second') and state = 'held'
                 and held_against = (select id from public.stock_counts where idempotency_key = 'syn-cntopen-t6a-' || v_item::text)
            from public.stock_count_held_lines where idempotency_key = 'syn-cntopen-t6b-' || v_item::text),
    'T6 FAIL the held line does not keep its counter and the count it collided with';

  r := public.record_stock_count(
    p_inventory_id => v_item, p_counted_qty => 9, p_idempotency_key => 'syn-cntopen-t6b-' || v_item::text,
    p_location_id => (select v from t_fx where k = 'bar'), p_counted_open_ml => 0,
    p_session_id => (select v from t_fx where k = 's_walk'), p_performed_by => (select v from t_fx where k = 'second'));
  assert (r->>'held')::boolean and (r->>'replayed')::boolean,
    format('T6 FAIL a retried held line did not replay as held: %s', r);
  assert (select count(*) from public.stock_count_held_lines where idempotency_key = 'syn-cntopen-t6b-' || v_item::text) = 1,
    'T6 FAIL a retried held line was held twice';

  r := public.record_stock_count(
    p_inventory_id => v_item, p_counted_qty => 0, p_idempotency_key => 'syn-cntopen-t6c-' || v_item::text,
    p_location_id => (select v from t_fx where k = 'cellar'),
    p_session_id => (select v from t_fx where k = 's_walk'));
  assert (r->>'held')::boolean = false and r->>'count_id' is not null,
    format('T6 FAIL another shelf of the same walk was held: %s', r);

  -- A spot count of the bar outside the walk is never held by it.
  r := public.record_stock_count(
    p_inventory_id => v_item, p_counted_qty => 4, p_idempotency_key => 'syn-cntopen-t6d-' || v_item::text,
    p_location_id => (select v from t_fx where k = 'bar'));
  assert r->>'count_id' is not null and not (r ? 'held'),
    format('T6 FAIL a spot count was held by a walk: %s', r);
end $$;

-- T7 refused: an open figure below nothing; a stock_counts row cannot hold
-- half the open pair.
do $$
declare
  v_item uuid := (select v from t_fx where k = 'item');
  v_refused boolean := false;
begin
  begin
    perform public.record_stock_count(
      p_inventory_id => v_item, p_counted_qty => 1, p_idempotency_key => 'syn-cntopen-t7-' || v_item::text,
      p_counted_open_ml => -1);
  exception when sqlstate '22023' then v_refused := true;
  end;
  assert v_refused, 'T7 FAIL a negative open figure was taken';
  v_refused := false;
  begin
    update public.stock_counts set counted_open_ml = 10
     where idempotency_key = 'syn-cntopen-t2-' || v_item::text;
  exception when check_violation then v_refused := true;
  end;
  assert v_refused, 'T7 FAIL a count row took a counted open figure with no expected one';
end $$;

rollback;

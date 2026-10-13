-- F-1544: migration a_count_session_groups_a_walk_of_shelves.
--   A count session groups a walk of one house's shelves; its shelves, parked
--   lines and counts cannot name another house; an ended session stays ended;
--   a spot count with no session is exactly what it was.
--
-- Self-asserting: every block raises on a failure, so the PGlite harness or
-- `psql -v ON_ERROR_STOP=1 -f` stops at the first one. On a build WITHOUT the
-- migration T1 FAILS (no stock_count_sessions). One transaction, rolled back.
-- All fixtures are SYNTHETIC, keyed by fresh uuids.

begin;

create temporary table t_fx (k text primary key, v uuid) on commit drop;
insert into t_fx values
  ('house', gen_random_uuid()), ('other', gen_random_uuid()),
  ('wine', gen_random_uuid()), ('item', gen_random_uuid()),
  ('bar', gen_random_uuid()), ('cellar', gen_random_uuid()), ('other_shelf', gen_random_uuid()),
  ('person', gen_random_uuid()),
  ('s_open', gen_random_uuid()), ('s_other', gen_random_uuid());

insert into public.restaurants (id, name, slug)
select v, 'SYNTHETIC count-session ' || k, 'syn-cntses-' || left(replace(v::text, '-', ''), 16)
  from t_fx where k in ('house', 'other');

insert into public.users (user_id, email, name, role, restaurant_id)
select (select v from t_fx where k = 'person'), 'zqcs-bartender@example.invalid', 'Zqcs bartender', 'staff',
       (select v from t_fx where k = 'house');

insert into public.master_wine_library (id, wine_id, name, primary_type)
select v, 'SYN-CS-' || left(replace(v::text, '-', ''), 12), 'SYNTHETIC Kalecik Karasi', 'red'
  from t_fx where k = 'wine';

insert into public.restaurant_inventory (id, restaurant_id, master_wine_id, bottle_size_ml, pour_size_ml)
select (select v from t_fx where k = 'item'), (select v from t_fx where k = 'house'),
       (select v from t_fx where k = 'wine'), 750, 150;

insert into public.storage_locations (id, restaurant_id, zone, capacity_bottles)
select (select v from t_fx where k = s), (select v from t_fx where k = h), z, 50
  from (values ('bar', 'house', 'Bar'), ('cellar', 'house', 'Cellar'), ('other_shelf', 'other', 'Other bar')) as x(s, h, z);

insert into public.inventory_lots (restaurant_id, inventory_id, master_wine_id, stock_state, qty, location_id)
select (select v from t_fx where k = 'house'), (select v from t_fx where k = 'item'),
       (select v from t_fx where k = 'wine'), 'live', 5, (select v from t_fx where k = 'bar');

-- T1 the three tables exist, RLS on, no client grant; still one count writer.
do $$
declare
  t text;
begin
  foreach t in array array['stock_count_sessions', 'stock_count_session_shelves', 'stock_count_parked_lines'] loop
    assert to_regclass('public.' || t) is not null, format('T1 FAIL public.%s does not exist', t);
    assert (select relrowsecurity from pg_class where oid = to_regclass('public.' || t)),
      format('T1 FAIL public.%s has RLS off', t);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      assert not has_table_privilege('anon', 'public.' || t, 'select'),
        format('T1 FAIL anon can read public.%s', t);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      assert not has_table_privilege('authenticated', 'public.' || t, 'select'),
        format('T1 FAIL authenticated can read public.%s', t);
    end if;
  end loop;
  assert (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'record_stock_count') = 1,
    'T1 FAIL there is not exactly one record_stock_count';
end $$;

-- Two sessions, one per house.
insert into public.stock_count_sessions (id, restaurant_id, kind, opened_by, open_key)
select (select v from t_fx where k = 's_open'), (select v from t_fx where k = 'house'), 'closing',
       (select v from t_fx where k = 'person'), 'syn-open-key-1';
insert into public.stock_count_sessions (id, restaurant_id, kind)
select (select v from t_fx where k = 's_other'), (select v from t_fx where k = 'other'), 'full';

-- T2 a session's shelf is its own house's: the bar goes in, the other house's
-- shelf is refused, and a shelf row cannot name the other house's session.
do $$
declare
  v_refused boolean := false;
begin
  insert into public.stock_count_session_shelves (session_id, restaurant_id, location_id, sort_order)
  values ((select v from t_fx where k = 's_open'), (select v from t_fx where k = 'house'),
          (select v from t_fx where k = 'bar'), 0),
         ((select v from t_fx where k = 's_open'), (select v from t_fx where k = 'house'),
          (select v from t_fx where k = 'cellar'), 1);
  begin
    insert into public.stock_count_session_shelves (session_id, restaurant_id, location_id, sort_order)
    values ((select v from t_fx where k = 's_open'), (select v from t_fx where k = 'house'),
            (select v from t_fx where k = 'other_shelf'), 2);
  exception when sqlstate '42501' then v_refused := true;
  end;
  assert v_refused, 'T2 FAIL a session took a shelf of another house';
  v_refused := false;
  begin
    insert into public.stock_count_session_shelves (session_id, restaurant_id, location_id, sort_order)
    values ((select v from t_fx where k = 's_other'), (select v from t_fx where k = 'house'),
            (select v from t_fx where k = 'bar'), 0);
  exception when foreign_key_violation then v_refused := true;
  end;
  assert v_refused, 'T2 FAIL a shelf row named another house''s session';
end $$;

-- T3 a claim and a done carry their moment; a shelf with no done_at is not done.
do $$
declare
  v_refused boolean := false;
begin
  begin
    update public.stock_count_session_shelves
       set done_by = (select v from t_fx where k = 'person')
     where session_id = (select v from t_fx where k = 's_open')
       and location_id = (select v from t_fx where k = 'bar');
  exception when check_violation then v_refused := true;
  end;
  assert v_refused, 'T3 FAIL a shelf was marked done with no moment';
  update public.stock_count_session_shelves
     set claimed_by = (select v from t_fx where k = 'person'), claimed_at = now(),
         done_by = (select v from t_fx where k = 'person'), done_at = now()
   where session_id = (select v from t_fx where k = 's_open')
     and location_id = (select v from t_fx where k = 'bar');
  assert (select count(*) from public.stock_count_session_shelves
           where session_id = (select v from t_fx where k = 's_open') and done_at is null) = 1,
    'T3 FAIL the cellar, never marked done, does not read as not counted';
end $$;

-- T4 one session per open key per house; a parked line parks once per key and
-- is refused on another house's shelf.
do $$
declare
  v_refused boolean := false;
begin
  begin
    insert into public.stock_count_sessions (restaurant_id, kind, open_key)
    values ((select v from t_fx where k = 'house'), 'closing', 'syn-open-key-1');
  exception when unique_violation then v_refused := true;
  end;
  assert v_refused, 'T4 FAIL a retried open made a second session';

  insert into public.stock_count_parked_lines
    (session_id, restaurant_id, location_id, description, counted_qty, counted_by, counted_at, client_line_id)
  values ((select v from t_fx where k = 's_open'), (select v from t_fx where k = 'house'),
          (select v from t_fx where k = 'bar'), 'SYNTHETIC unknown red, no label', 2,
          (select v from t_fx where k = 'person'), now(), 'syn-park-1')
  on conflict (restaurant_id, client_line_id) do nothing;
  insert into public.stock_count_parked_lines
    (session_id, restaurant_id, location_id, description, counted_qty, counted_by, counted_at, client_line_id)
  values ((select v from t_fx where k = 's_open'), (select v from t_fx where k = 'house'),
          (select v from t_fx where k = 'bar'), 'SYNTHETIC unknown red, no label', 2,
          (select v from t_fx where k = 'person'), now(), 'syn-park-1')
  on conflict (restaurant_id, client_line_id) do nothing;
  assert (select count(*) from public.stock_count_parked_lines where client_line_id = 'syn-park-1') = 1,
    'T4 FAIL a retried parked line was parked twice';

  v_refused := false;
  begin
    insert into public.stock_count_parked_lines
      (session_id, restaurant_id, location_id, description, counted_qty, counted_at, client_line_id)
    values ((select v from t_fx where k = 's_open'), (select v from t_fx where k = 'house'),
            (select v from t_fx where k = 'other_shelf'), 'SYNTHETIC', 1, now(), 'syn-park-2');
  exception when sqlstate '42501' then v_refused := true;
  end;
  assert v_refused, 'T4 FAIL a parked line named another house''s shelf';
end $$;

-- T5 an ended session stays ended, and an ending carries its moment.
do $$
declare
  v_refused boolean := false;
begin
  begin
    update public.stock_count_sessions set status = 'abandoned'
     where id = (select v from t_fx where k = 's_other');
  exception when check_violation then v_refused := true;
  end;
  assert v_refused, 'T5 FAIL a session was abandoned with no moment';
  update public.stock_count_sessions set status = 'abandoned', abandoned_at = now()
   where id = (select v from t_fx where k = 's_other');
  v_refused := false;
  begin
    update public.stock_count_sessions set status = 'open', abandoned_at = null
     where id = (select v from t_fx where k = 's_other');
  exception when sqlstate '22023' then v_refused := true;
  end;
  assert v_refused, 'T5 FAIL an abandoned session was reopened';
end $$;

-- T6 the strict no-op: a spot count with no session is recorded exactly as
-- before (same result keys, same figures, no session), and a count can name
-- its own house's session but never another house's.
do $$
declare
  v_item uuid := (select v from t_fx where k = 'item');
  r jsonb;
  v_refused boolean := false;
begin
  r := public.record_stock_count(
    p_inventory_id => v_item, p_counted_qty => 4, p_idempotency_key => 'syn-cntses-t6-' || v_item::text,
    p_location_id => (select v from t_fx where k = 'bar'), p_reason => 'SYNTHETIC spot count');
  assert (select array_agg(k order by k) from jsonb_object_keys(r) k)
         = array['cost_applied', 'count_id', 'counted_at', 'counted_qty', 'expected_qty',
                 'location_id', 'replayed', 'transaction_id', 'variance_qty'],
    format('T6 FAIL the spot count''s result changed shape: %s', r);
  assert (r->>'expected_qty')::int = 5 and (r->>'variance_qty')::int = -1,
    format('T6 FAIL the spot count read %s expected / %s variance, not 5 / -1', r->>'expected_qty', r->>'variance_qty');
  assert (select session_id from public.stock_counts where id = (r->>'count_id')::uuid) is null,
    'T6 FAIL a spot count was given a session';

  update public.stock_counts set session_id = (select v from t_fx where k = 's_open')
   where id = (r->>'count_id')::uuid;
  begin
    update public.stock_counts set session_id = (select v from t_fx where k = 's_other')
     where id = (r->>'count_id')::uuid;
  exception when foreign_key_violation then v_refused := true;
  end;
  assert v_refused, 'T6 FAIL a count named another house''s session';
end $$;

rollback;

-- F-1544 lane 4: migration a_whole_walk_stamps_last_counted.
--   A held line a manager chooses posts through the one count writer as its
--   counter and sets the shelf's other held lines aside; a shelf sent to be
--   counted again starts a new pass the hold respects; sign-off stamps
--   last_counted_at only on items whose every holding shelf this walk counted
--   (F-1165). A spot count that names none of it is exactly what it was.
--
-- Self-asserting: every block raises on a failure, so the PGlite harness or
-- `psql -v ON_ERROR_STOP=1 -f` stops at the first one. On a build WITHOUT the
-- migration T1 FAILS (no stock_counts.arrived_at). One transaction, rolled
-- back. All fixtures are SYNTHETIC, keyed by fresh uuids.

begin;

create temporary table t_fx (k text primary key, v uuid) on commit drop;
insert into t_fx values
  ('house', gen_random_uuid()),
  ('w1', gen_random_uuid()), ('w2', gen_random_uuid()), ('w3', gen_random_uuid()),
  ('i1', gen_random_uuid()), ('i2', gen_random_uuid()), ('i3', gen_random_uuid()),
  ('bar', gen_random_uuid()), ('cellar', gen_random_uuid()), ('back', gen_random_uuid()),
  ('person', gen_random_uuid()), ('second', gen_random_uuid()), ('boss', gen_random_uuid()),
  ('s_walk', gen_random_uuid()), ('s_stopped', gen_random_uuid());

create temporary table t_keep (k text primary key, v uuid) on commit drop;

insert into public.restaurants (id, name, slug)
select v, 'SYNTHETIC walk review', 'syn-cntrev-' || left(replace(v::text, '-', ''), 16)
  from t_fx where k = 'house';

insert into public.users (user_id, email, name, role, restaurant_id)
select (select v from t_fx where k = p), 'zqrv-' || p || '@example.invalid', 'Zqrv ' || p, r,
       (select v from t_fx where k = 'house')
  from (values ('person', 'staff'), ('second', 'staff'), ('boss', 'manager')) as x(p, r);

insert into public.master_wine_library (id, wine_id, name, primary_type)
select v, 'SYN-RV-' || left(replace(v::text, '-', ''), 12), 'SYNTHETIC ' || k, 'red'
  from t_fx where k in ('w1', 'w2', 'w3');

insert into public.restaurant_inventory (id, restaurant_id, master_wine_id, bottle_size_ml)
select (select v from t_fx where k = i), (select v from t_fx where k = 'house'),
       (select v from t_fx where k = w), 750
  from (values ('i1', 'w1'), ('i2', 'w2'), ('i3', 'w3')) as x(i, w);

insert into public.storage_locations (id, restaurant_id, zone, capacity_bottles)
select (select v from t_fx where k = s), (select v from t_fx where k = 'house'), z, 50
  from (values ('bar', 'Bar'), ('cellar', 'Cellar'), ('back', 'Back room')) as x(s, z);

-- i1: 5 on the bar. i2: 3 in the cellar and 2 in the back room (outside the
-- walk). i3: 2 in the cellar.
insert into public.inventory_lots
  (restaurant_id, inventory_id, master_wine_id, stock_state, qty, open_bottle_ml, location_id, received_at)
select (select v from t_fx where k = 'house'), (select v from t_fx where k = i),
       (select v from t_fx where k = w), 'live', q, 0, (select v from t_fx where k = s), now() - interval '40 days'
  from (values ('i1', 'w1', 5, 'bar'), ('i2', 'w2', 3, 'cellar'), ('i2', 'w2', 2, 'back'),
               ('i3', 'w3', 2, 'cellar')) as x(i, w, q, s);

insert into public.stock_count_sessions (id, restaurant_id, kind, opened_by)
select (select v from t_fx where k = s), (select v from t_fx where k = 'house'), 'closing',
       (select v from t_fx where k = 'boss')
  from (values ('s_walk'), ('s_stopped')) as x(s);
insert into public.stock_count_session_shelves (session_id, restaurant_id, location_id, sort_order)
select (select v from t_fx where k = 's_walk'), (select v from t_fx where k = 'house'),
       (select v from t_fx where k = s), o
  from (values ('bar', 0), ('cellar', 1)) as x(s, o);
update public.stock_count_sessions
   set status = 'abandoned', abandoned_at = now()
 where id = (select v from t_fx where k = 's_stopped');

-- T1 the columns and functions, locked down, still one count writer.
do $$
begin
  assert exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'stock_counts' and column_name = 'arrived_at'),
    'T1 FAIL stock_counts has no arrived_at';
  assert exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'stock_count_session_shelves'
                    and column_name = 'recount_asked_at'),
    'T1 FAIL the shelves have no recount_asked_at';
  assert (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'record_stock_count') = 1,
    'T1 FAIL there is not exactly one record_stock_count';
  assert to_regprocedure('public.sign_off_stock_count_session(uuid, uuid, uuid, boolean)') is not null,
    'T1 FAIL no sign_off_stock_count_session';
  assert to_regprocedure('public.ask_stock_count_shelf_recount(uuid, uuid, uuid, uuid, integer)') is not null,
    'T1 FAIL no ask_stock_count_shelf_recount';
  if exists (select 1 from pg_roles where rolname = 'anon') then
    assert not has_function_privilege('anon',
      'public.sign_off_stock_count_session(uuid, uuid, uuid, boolean)', 'execute'),
      'T1 FAIL anon can sign a count off';
    assert not has_function_privilege('anon',
      'public.ask_stock_count_shelf_recount(uuid, uuid, uuid, uuid, integer)', 'execute'),
      'T1 FAIL anon can send a shelf back';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    assert not has_function_privilege('authenticated',
      'public.sign_off_stock_count_session(uuid, uuid, uuid, boolean)', 'execute'),
      'T1 FAIL authenticated can sign a count off';
  end if;
end $$;

-- T2 the strict no-op: a spot count gives the base's exact keys, and its row
-- says when it arrived.
do $$
declare
  r jsonb;
begin
  r := public.record_stock_count(
    p_inventory_id => (select v from t_fx where k = 'i3'), p_counted_qty => 2,
    p_idempotency_key => 'syn-cntrev-t2-' || (select v from t_fx where k = 'i3')::text,
    p_location_id => (select v from t_fx where k = 'cellar'), p_reason => 'SYNTHETIC spot count');
  assert (select array_agg(k order by k) from jsonb_object_keys(r) k)
         = array['cost_applied', 'count_id', 'counted_at', 'counted_qty', 'expected_qty',
                 'location_id', 'replayed', 'transaction_id', 'variance_qty'],
    format('T2 FAIL the spot count''s result changed shape: %s', r);
  assert (select arrived_at is not null and session_id is null
            from public.stock_counts where id = (r->>'count_id')::uuid),
    'T2 FAIL a spot count has no arrival time, or names a walk';
end $$;

-- T3 a manager chooses the second count of a shelf: it posts as ITS counter,
-- at its own moment, against the books as they stand; the third is set aside.
do $$
declare
  v_item  uuid := (select v from t_fx where k = 'i1');
  v_bar   uuid := (select v from t_fx where k = 'bar');
  v_walk  uuid := (select v from t_fx where k = 's_walk');
  a jsonb; b jsonb; c jsonb; r jsonb; again jsonb;
  v_b uuid; v_c uuid;
begin
  a := public.record_stock_count(p_inventory_id => v_item, p_counted_qty => 5,
    p_idempotency_key => 'syn-cntrev-a', p_location_id => v_bar, p_session_id => v_walk,
    p_performed_by => (select v from t_fx where k = 'person'), p_counted_at => now() - interval '20 minutes');
  assert (a->>'held')::boolean = false, format('T3 FAIL the first count was held: %s', a);
  b := public.record_stock_count(p_inventory_id => v_item, p_counted_qty => 4,
    p_idempotency_key => 'syn-cntrev-b', p_location_id => v_bar, p_session_id => v_walk,
    p_performed_by => (select v from t_fx where k = 'second'), p_counted_at => now() - interval '10 minutes');
  c := public.record_stock_count(p_inventory_id => v_item, p_counted_qty => 6,
    p_idempotency_key => 'syn-cntrev-c', p_location_id => v_bar, p_session_id => v_walk,
    p_performed_by => (select v from t_fx where k = 'person'), p_counted_at => now() - interval '5 minutes');
  assert (b->>'held')::boolean and (c->>'held')::boolean, format('T3 FAIL the duplicates were not held: %s %s', b, c);
  v_b := (b->>'held_line_id')::uuid;
  v_c := (c->>'held_line_id')::uuid;
  insert into t_keep values ('held_c', v_c);

  r := public.record_stock_count(p_inventory_id => v_item, p_counted_qty => 4,
    p_idempotency_key => 'syn-cntrev-b', p_location_id => v_bar, p_session_id => v_walk,
    p_performed_by => (select counted_by from public.stock_count_held_lines where id = v_b),
    p_counted_at => (select counted_at from public.stock_count_held_lines where id = v_b),
    p_resolves_held_line => v_b, p_resolved_by => (select v from t_fx where k = 'boss'));
  assert (r->>'held')::boolean = false and (r->>'resolved_held_line')::uuid = v_b
         and (r->>'expected_qty')::int = 5 and (r->>'variance_qty')::int = -1,
    format('T3 FAIL the chosen line did not post 5 -> 4: %s', r);
  assert (select counted_by = (select v from t_fx where k = 'second')
                 and counted_at = (select counted_at from public.stock_count_held_lines where id = v_b)
            from public.stock_counts where id = (r->>'count_id')::uuid),
    'T3 FAIL the chosen count is not its counter''s, at its own moment';
  assert (select state = 'posted' and resolved_count_id = (r->>'count_id')::uuid
                 and resolved_by = (select v from t_fx where k = 'boss')
            from public.stock_count_held_lines where id = v_b),
    'T3 FAIL the chosen line is not marked posted by the manager';
  assert (select state = 'dropped' and resolved_count_id is null
            from public.stock_count_held_lines where id = v_c),
    'T3 FAIL the other held line of the shelf was not set aside';
  assert (select sum(qty) from public.inventory_lots where inventory_id = v_item and location_id = v_bar) = 4,
    'T3 FAIL the bar does not hold the chosen 4';

  again := public.record_stock_count(p_inventory_id => v_item, p_counted_qty => 4,
    p_idempotency_key => 'syn-cntrev-b', p_location_id => v_bar, p_session_id => v_walk,
    p_resolves_held_line => v_b, p_resolved_by => (select v from t_fx where k = 'boss'));
  assert (again->>'replayed')::boolean and (again->>'count_id')::uuid = (r->>'count_id')::uuid,
    format('T3 FAIL choosing twice was not a replay: %s', again);
  assert (select count(*) from public.stock_counts where idempotency_key = 'syn-cntrev-b') = 1,
    'T3 FAIL choosing twice posted twice';
end $$;

-- T4 what a chosen line must be: the same line, inside its walk, not set aside.
do $$
declare
  v_item uuid := (select v from t_fx where k = 'i1');
  v_bar  uuid := (select v from t_fx where k = 'bar');
  v_walk uuid := (select v from t_fx where k = 's_walk');
  v_c    uuid := (select v from t_keep where k = 'held_c');
  refused text;
begin
  begin
    perform public.record_stock_count(p_inventory_id => v_item, p_counted_qty => 6,
      p_idempotency_key => 'syn-cntrev-c', p_location_id => v_bar, p_session_id => v_walk,
      p_resolves_held_line => v_c);
    refused := null;
  exception when others then refused := sqlstate;
  end;
  assert refused = '22023', format('T4 FAIL a line set aside was used (%s)', refused);
  begin
    perform public.record_stock_count(p_inventory_id => v_item, p_counted_qty => 6,
      p_idempotency_key => 'syn-cntrev-other-key', p_location_id => v_bar, p_session_id => v_walk,
      p_resolves_held_line => v_c);
    refused := null;
  exception when others then refused := sqlstate;
  end;
  assert refused = '42501', format('T4 FAIL a held line was used under another key (%s)', refused);
  begin
    perform public.record_stock_count(p_inventory_id => v_item, p_counted_qty => 6,
      p_idempotency_key => 'syn-cntrev-c', p_location_id => v_bar, p_resolves_held_line => v_c);
    refused := null;
  exception when others then refused := sqlstate;
  end;
  assert refused = '22023', format('T4 FAIL a held line was used outside its walk (%s)', refused);
end $$;

-- T5 the bar is sent to be counted again: done and claim cleared, its held
-- lines set aside, a retry of the ask is a no-op; a recount line posts, an
-- old-pass line that syncs late is still held.
do $$
declare
  v_item uuid := (select v from t_fx where k = 'i1');
  v_bar  uuid := (select v from t_fx where k = 'bar');
  v_walk uuid := (select v from t_fx where k = 's_walk');
  v_house uuid := (select v from t_fx where k = 'house');
  v_boss uuid := (select v from t_fx where k = 'boss');
  held_e jsonb; r jsonb; d jsonb; e jsonb;
begin
  -- An old-pass duplicate, held before the ask.
  held_e := public.record_stock_count(p_inventory_id => v_item, p_counted_qty => 3,
    p_idempotency_key => 'syn-cntrev-pre', p_location_id => v_bar, p_session_id => v_walk,
    p_counted_at => now() - interval '3 minutes');
  assert (held_e->>'held')::boolean, format('T5 FAIL the pre-ask duplicate was not held: %s', held_e);
  update public.stock_count_session_shelves
     set done_by = (select v from t_fx where k = 'person'), done_at = now() - interval '2 minutes',
         claimed_by = (select v from t_fx where k = 'person'), claimed_at = now() - interval '30 minutes'
   where session_id = v_walk and location_id = v_bar;

  r := public.ask_stock_count_shelf_recount(v_walk, v_house, v_bar, v_boss, 0);
  assert (r->>'round')::int = 1 and (r->>'dropped_held')::int = 1 and not (r->>'replayed')::boolean,
    format('T5 FAIL the ask did not move the round and set the held line aside: %s', r);
  assert (select done_at is null and done_by is null and claimed_by is null and recount_asked_by = v_boss
            from public.stock_count_session_shelves where session_id = v_walk and location_id = v_bar),
    'T5 FAIL the shelf was not reopened';
  assert (select state from public.stock_count_held_lines where id = (held_e->>'held_line_id')::uuid) = 'dropped',
    'T5 FAIL the held line of the shelf was not set aside';
  r := public.ask_stock_count_shelf_recount(v_walk, v_house, v_bar, v_boss, 0);
  assert (r->>'round')::int = 1 and (r->>'replayed')::boolean,
    format('T5 FAIL a retried ask moved the round again: %s', r);

  d := public.record_stock_count(p_inventory_id => v_item, p_counted_qty => 4,
    p_idempotency_key => 'syn-cntrev-d', p_location_id => v_bar, p_session_id => v_walk,
    p_performed_by => (select v from t_fx where k = 'second'));
  assert (d->>'held')::boolean = false and d->>'count_id' is not null,
    format('T5 FAIL the recount line was held against the old pass: %s', d);
  e := public.record_stock_count(p_inventory_id => v_item, p_counted_qty => 2,
    p_idempotency_key => 'syn-cntrev-e', p_location_id => v_bar, p_session_id => v_walk,
    p_counted_at => now() - interval '1 minute');
  assert (e->>'held')::boolean,
    format('T5 FAIL an old-pass line that synced late was posted: %s', e);
end $$;

-- T6 sign-off: asked first while shelves are not done; then stamps only the
-- items whose every holding shelf this walk counted, with the oldest of their
-- shelves' latest counts; a second sign-off is a replay.
do $$
declare
  v_walk uuid := (select v from t_fx where k = 's_walk');
  v_house uuid := (select v from t_fx where k = 'house');
  v_boss uuid := (select v from t_fx where k = 'boss');
  v_cellar uuid := (select v from t_fx where k = 'cellar');
  r jsonb;
begin
  perform public.record_stock_count(p_inventory_id => (select v from t_fx where k = 'i2'), p_counted_qty => 3,
    p_idempotency_key => 'syn-cntrev-i2', p_location_id => v_cellar, p_session_id => v_walk,
    p_counted_at => now() - interval '25 minutes');
  perform public.record_stock_count(p_inventory_id => (select v from t_fx where k = 'i3'), p_counted_qty => 2,
    p_idempotency_key => 'syn-cntrev-i3', p_location_id => v_cellar, p_session_id => v_walk,
    p_counted_at => now() - interval '30 minutes');

  r := public.sign_off_stock_count_session(v_walk, v_house, v_boss);
  assert (r->>'not_counted')::int = 2 and r->>'status' = 'open' and r->>'signed_off_at' is null,
    format('T6 FAIL a walk with shelves not counted was signed off unasked: %s', r);
  assert (select status from public.stock_count_sessions where id = v_walk) = 'open',
    'T6 FAIL the unasked sign-off changed the walk';

  update public.stock_count_session_shelves set done_by = v_boss, done_at = now()
   where session_id = v_walk;
  r := public.sign_off_stock_count_session(v_walk, v_house, v_boss);
  assert r->>'status' = 'signed_off' and (r->>'stamped')::int = 2,
    format('T6 FAIL sign-off did not stamp the two whole items: %s', r);
  assert (select last_counted_at = now() from public.restaurant_inventory
           where id = (select v from t_fx where k = 'i1')),
    'T6 FAIL i1 was not stamped with its latest bar count';
  assert (select last_counted_at = now() - interval '30 minutes' from public.restaurant_inventory
           where id = (select v from t_fx where k = 'i3')),
    'T6 FAIL i3 was not stamped with its cellar count';
  assert (select last_counted_at is null from public.restaurant_inventory
           where id = (select v from t_fx where k = 'i2')),
    'T6 FAIL i2 was stamped though the back room was never counted (F-1165)';

  r := public.sign_off_stock_count_session(v_walk, v_house, v_boss);
  assert (r->>'replayed')::boolean and r->>'status' = 'signed_off',
    format('T6 FAIL a second sign-off was not a replay: %s', r);
end $$;

-- T7 an ended walk: no shelf goes back, a stopped walk is not signed off, and
-- a line that arrives after sign-off still lands (ADR 0241).
do $$
declare
  v_house uuid := (select v from t_fx where k = 'house');
  v_boss uuid := (select v from t_fx where k = 'boss');
  refused text;
  late jsonb;
begin
  begin
    perform public.ask_stock_count_shelf_recount((select v from t_fx where k = 's_walk'), v_house,
      (select v from t_fx where k = 'cellar'), v_boss, 0);
    refused := null;
  exception when others then refused := sqlstate;
  end;
  assert refused = '22023', format('T7 FAIL a signed-off walk sent a shelf back (%s)', refused);
  begin
    perform public.sign_off_stock_count_session((select v from t_fx where k = 's_stopped'), v_house, v_boss);
    refused := null;
  exception when others then refused := sqlstate;
  end;
  assert refused = '22023', format('T7 FAIL a stopped walk was signed off (%s)', refused);
  late := public.record_stock_count(p_inventory_id => (select v from t_fx where k = 'i3'), p_counted_qty => 2,
    p_idempotency_key => 'syn-cntrev-late', p_location_id => (select v from t_fx where k = 'back'),
    p_session_id => (select v from t_fx where k = 's_walk'));
  assert late->>'count_id' is not null, format('T7 FAIL a late line did not land: %s', late);
end $$;

rollback;

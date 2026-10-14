-- F-1544 owed (S227): migration a_count_sheet_load_is_logged_with_who_counted.
--   A load of a stock-take's paper sheet is kept: who loaded it, who counted on
--   paper (NULL = the loader), its shelf keys, and how many rows went in, were
--   refused and were not sent (ADR 0335 §3). Kept as written; this house's
--   count only; locked to the gateway.
--
-- Self-asserting: every block raises on a failure, so the PGlite harness or
-- `psql -v ON_ERROR_STOP=1 -f` stops at the first one. On a build WITHOUT the
-- migration T1 FAILS (no stock_count_sheet_loads). One transaction, rolled
-- back. All fixtures are SYNTHETIC, keyed by fresh uuids.

begin;

create temporary table t_fx (k text primary key, v uuid) on commit drop;
insert into t_fx values
  ('house', gen_random_uuid()), ('other', gen_random_uuid()),
  ('boss', gen_random_uuid()), ('s1', gen_random_uuid()), ('load', gen_random_uuid());

insert into public.restaurants (id, name, slug)
select v, 'SYNTHETIC sheet load ' || k, 'syn-shload-' || left(replace(v::text, '-', ''), 16)
  from t_fx where k in ('house', 'other');

insert into public.users (user_id, email, name, role, restaurant_id)
select (select v from t_fx where k = 'boss'), 'zqsl-boss@example.invalid', 'Zqsl boss', 'manager',
       (select v from t_fx where k = 'house');

insert into public.stock_count_sessions (id, restaurant_id, kind, opened_by)
values ((select v from t_fx where k = 's1'), (select v from t_fx where k = 'house'), 'closing',
        (select v from t_fx where k = 'boss'));

-- T1 a load keeps who counted on paper, its shelf keys and its figures; a load
-- by the counter themselves names nobody else.
do $$
begin
  insert into public.stock_count_sheet_loads
    (id, session_id, restaurant_id, loaded_by, counted_by_name, shelf_keys, rows_in, rows_refused, rows_not_sent)
  values ((select v from t_fx where k = 'load'), (select v from t_fx where k = 's1'),
          (select v from t_fx where k = 'house'), (select v from t_fx where k = 'boss'),
          'Deniz', array['sheet:x:y:1'], 4, 1, 0);
  insert into public.stock_count_sheet_loads (session_id, restaurant_id, loaded_by, rows_in, rows_refused)
  values ((select v from t_fx where k = 's1'), (select v from t_fx where k = 'house'),
          (select v from t_fx where k = 'boss'), 2, 0);
  assert (select counted_by_name || ':' || rows_in || ':' || rows_refused || ':' || shelf_keys[1]
            from public.stock_count_sheet_loads where id = (select v from t_fx where k = 'load'))
         = 'Deniz:4:1:sheet:x:y:1',
    'T1 FAIL the load did not keep what it was given';
  assert (select count(*) from public.stock_count_sheet_loads
           where session_id = (select v from t_fx where k = 's1') and counted_by_name is null) = 1,
    'T1 FAIL a load by the loader was given a name';
end $$;

-- T2 a blank name, a negative figure, and another house's count are refused.
do $$
declare
  v_refused boolean;
begin
  v_refused := false;
  begin
    insert into public.stock_count_sheet_loads (session_id, restaurant_id, counted_by_name, rows_in, rows_refused)
    values ((select v from t_fx where k = 's1'), (select v from t_fx where k = 'house'), '   ', 1, 0);
  exception when check_violation then v_refused := true;
  end;
  assert v_refused, 'T2 FAIL a blank name was kept';

  v_refused := false;
  begin
    insert into public.stock_count_sheet_loads (session_id, restaurant_id, rows_in, rows_refused)
    values ((select v from t_fx where k = 's1'), (select v from t_fx where k = 'house'), 1, -1);
  exception when check_violation then v_refused := true;
  end;
  assert v_refused, 'T2 FAIL a negative row figure was kept';

  v_refused := false;
  begin
    insert into public.stock_count_sheet_loads (session_id, restaurant_id, rows_in, rows_refused)
    values ((select v from t_fx where k = 's1'), (select v from t_fx where k = 'other'), 1, 0);
  exception when foreign_key_violation then v_refused := true;
  end;
  assert v_refused, 'T2 FAIL a load was filed against another house''s count';
end $$;

-- T3 a load is a record: it is not changed or removed.
do $$
declare
  v_refused boolean;
begin
  v_refused := false;
  begin
    update public.stock_count_sheet_loads set rows_in = 99
     where id = (select v from t_fx where k = 'load');
  exception when insufficient_privilege then v_refused := true;
  end;
  assert v_refused, 'T3 FAIL a load was changed';

  v_refused := false;
  begin
    delete from public.stock_count_sheet_loads where id = (select v from t_fx where k = 'load');
  exception when insufficient_privilege then v_refused := true;
  end;
  assert v_refused, 'T3 FAIL a load was removed';
end $$;

-- T4 locked to the gateway: row security on, nothing granted to a browser key.
do $$
begin
  assert (select relrowsecurity from pg_class where oid = 'public.stock_count_sheet_loads'::regclass),
    'T4 FAIL row security is off';
  if exists (select 1 from pg_roles where rolname = 'anon') then
    assert not has_table_privilege('anon', 'public.stock_count_sheet_loads', 'select'),
      'T4 FAIL anon can read the loads';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    assert not has_table_privilege('authenticated', 'public.stock_count_sheet_loads', 'insert'),
      'T4 FAIL a signed-in browser can write a load';
  end if;
end $$;

rollback;

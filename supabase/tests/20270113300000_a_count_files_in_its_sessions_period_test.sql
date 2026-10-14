-- F-1544 lane 5: migration a_count_files_in_its_sessions_period.
--   A count session states the month its counts are filed in (founder
--   2026-10-12 S224, F1 b): a real month, none on an opening count, within a
--   day of its opening, and kept once set. A session that names none, and a
--   spot count, are what they were.
--
-- Self-asserting: every block raises on a failure, so the PGlite harness or
-- `psql -v ON_ERROR_STOP=1 -f` stops at the first one. On a build WITHOUT the
-- migration T1 FAILS (no stock_count_sessions.attributed_period). One
-- transaction, rolled back. All fixtures are SYNTHETIC, keyed by fresh uuids.

begin;

create temporary table t_fx (k text primary key, v uuid) on commit drop;
insert into t_fx values
  ('house', gen_random_uuid()), ('boss', gen_random_uuid()),
  ('s_oct', gen_random_uuid()), ('s_none', gen_random_uuid());

insert into public.restaurants (id, name, slug)
select v, 'SYNTHETIC count period', 'syn-cntper-' || left(replace(v::text, '-', ''), 16)
  from t_fx where k = 'house';

insert into public.users (user_id, email, name, role, restaurant_id)
select (select v from t_fx where k = 'boss'), 'zqpr-boss@example.invalid', 'Zqpr boss', 'manager',
       (select v from t_fx where k = 'house');

-- T1 a month-end count opened at 00:30 on 1 November (house UTC+3, so
-- 21:30 UTC on 31 October) states October; one opened before lane 5 states none.
do $$
begin
  insert into public.stock_count_sessions (id, restaurant_id, kind, opened_by, opened_at, attributed_period)
  values ((select v from t_fx where k = 's_oct'), (select v from t_fx where k = 'house'), 'month_end',
          (select v from t_fx where k = 'boss'), '2026-10-31T21:30:00Z', '2026-10');
  insert into public.stock_count_sessions (id, restaurant_id, kind, opened_by)
  values ((select v from t_fx where k = 's_none'), (select v from t_fx where k = 'house'), 'closing',
          (select v from t_fx where k = 'boss'));
  assert (select attributed_period from public.stock_count_sessions
           where id = (select v from t_fx where k = 's_oct')) = '2026-10',
    'T1 FAIL the session did not keep its month';
  assert (select attributed_period from public.stock_count_sessions
           where id = (select v from t_fx where k = 's_none')) is null,
    'T1 FAIL a session that names no month was given one';
end $$;

-- T2 not a month, an opening count with a month, and a month far from the
-- opening are each refused.
do $$
declare
  v_bad text;
  v_refused boolean;
begin
  foreach v_bad in array array['2026-13', '2026-1', 'October', '2026-10-31'] loop
    v_refused := false;
    begin
      insert into public.stock_count_sessions (restaurant_id, kind, opened_at, attributed_period)
      values ((select v from t_fx where k = 'house'), 'full', '2026-10-20T10:00:00Z', v_bad);
    exception when check_violation then v_refused := true;
    end;
    assert v_refused, format('T2 FAIL a session took %L as its month', v_bad);
  end loop;

  v_refused := false;
  begin
    insert into public.stock_count_sessions (restaurant_id, kind, opened_at, attributed_period)
    values ((select v from t_fx where k = 'house'), 'opening', '2026-10-20T10:00:00Z', '2026-10');
  exception when check_violation then v_refused := true;
  end;
  assert v_refused, 'T2 FAIL an opening count took a month';

  v_refused := false;
  begin
    insert into public.stock_count_sessions (restaurant_id, kind, opened_at, attributed_period)
    values ((select v from t_fx where k = 'house'), 'month_end', '2026-11-03T10:00:00Z', '2026-10');
  exception when check_violation then v_refused := true;
  end;
  assert v_refused, 'T2 FAIL a count opened on 3 November took October';

  v_refused := false;
  begin
    insert into public.stock_count_sessions (restaurant_id, kind, opened_at, attributed_period)
    values ((select v from t_fx where k = 'house'), 'month_end', '2026-10-20T10:00:00Z', '2026-12');
  exception when check_violation then v_refused := true;
  end;
  assert v_refused, 'T2 FAIL a count opened in October took December';
end $$;

-- T3 the month is kept: neither changed nor added later, not even while open.
do $$
declare
  v_refused boolean := false;
begin
  begin
    update public.stock_count_sessions set attributed_period = '2026-11'
     where id = (select v from t_fx where k = 's_oct');
  exception when sqlstate '22023' then v_refused := true;
  end;
  assert v_refused, 'T3 FAIL a session''s month was changed';
  v_refused := false;
  begin
    update public.stock_count_sessions
       set attributed_period = to_char(now() at time zone 'UTC', 'YYYY-MM')
     where id = (select v from t_fx where k = 's_none');
  exception when sqlstate '22023' then v_refused := true;
  end;
  assert v_refused, 'T3 FAIL a month was added to a session after it opened';
  -- Lane 1's rule still stands beside it.
  v_refused := false;
  begin
    update public.stock_count_sessions set kind = 'full'
     where id = (select v from t_fx where k = 's_oct');
  exception when sqlstate '22023' then v_refused := true;
  end;
  assert v_refused, 'T3 FAIL a session''s kind was changed';
  -- Signing off still works and keeps the month.
  update public.stock_count_sessions
     set status = 'signed_off', signed_off_at = now(), signed_off_by = (select v from t_fx where k = 'boss')
   where id = (select v from t_fx where k = 's_oct');
  assert (select attributed_period from public.stock_count_sessions
           where id = (select v from t_fx where k = 's_oct')) = '2026-10',
    'T3 FAIL signing off lost the month';
end $$;

-- T4 still one count writer, and the writer never reads the period: a
-- count's moment is recorded as it was made.
do $$
begin
  assert (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'record_stock_count') = 1,
    'T4 FAIL there is not exactly one record_stock_count';
  assert position('attributed_period' in (
           select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname = 'record_stock_count')) = 0,
    'T4 FAIL the count writer reads the session''s month';
end $$;

rollback;

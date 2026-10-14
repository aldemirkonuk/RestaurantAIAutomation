-- S234 owed (sim ledger): migration a_parked_count_line_keeps_its_open_bottle.
--   A parked stock-take line keeps its open bottle in integer ml, NULL when
--   it was not counted; a negative amount is refused; the table stays locked
--   down.
--
-- Self-asserting: every block raises on a failure, so the PGlite harness or
-- `psql -v ON_ERROR_STOP=1 -f` stops at the first one. On a build WITHOUT the
-- migration T1 FAILS (no counted_open_ml). One transaction, rolled back.
-- All fixtures are SYNTHETIC, keyed by fresh uuids.

begin;

create temporary table t_fx (k text primary key, v uuid) on commit drop;
insert into t_fx values
  ('house', gen_random_uuid()), ('bar', gen_random_uuid()),
  ('person', gen_random_uuid()), ('walk', gen_random_uuid());

-- T1 the column exists, is an integer, carries no default; RLS still on.
do $$
declare
  t text;
  d text;
begin
  select data_type, column_default into t, d from information_schema.columns
   where table_schema = 'public' and table_name = 'stock_count_parked_lines'
     and column_name = 'counted_open_ml';
  if t is null then raise exception 'T1 FAIL: stock_count_parked_lines.counted_open_ml does not exist'; end if;
  if t <> 'integer' then raise exception 'T1 FAIL: counted_open_ml is %, not integer', t; end if;
  if d is not null then raise exception 'T1 FAIL: counted_open_ml carries a default (%)', d; end if;
  if not (select relrowsecurity from pg_class where oid = to_regclass('public.stock_count_parked_lines')) then
    raise exception 'T1 FAIL: stock_count_parked_lines has RLS off';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated')
     and has_table_privilege('authenticated', 'public.stock_count_parked_lines', 'select') then
    raise exception 'T1 FAIL: authenticated can read stock_count_parked_lines';
  end if;
end $$;

insert into public.restaurants (id, name, slug)
select v, 'SYNTHETIC parked-open house', 'syn-parkopen-' || left(replace(v::text, '-', ''), 16)
  from t_fx where k = 'house';
insert into public.users (user_id, email, name, role, restaurant_id)
select (select v from t_fx where k = 'person'), 'zqpo-bartender@example.invalid', 'Zqpo bartender', 'staff',
       (select v from t_fx where k = 'house');
insert into public.storage_locations (id, restaurant_id, zone, capacity_bottles)
select (select v from t_fx where k = 'bar'), (select v from t_fx where k = 'house'), 'Bar', 50;
insert into public.stock_count_sessions (id, restaurant_id, kind)
select (select v from t_fx where k = 'walk'), (select v from t_fx where k = 'house'), 'closing';

-- T2 a parked line with no open bottle reads NULL; one with 7/10 keeps 525 ml.
do $$
declare
  h uuid := (select v from t_fx where k = 'house');
  w uuid := (select v from t_fx where k = 'walk');
  b uuid := (select v from t_fx where k = 'bar');
  p uuid := (select v from t_fx where k = 'person');
  ml integer;
begin
  insert into public.stock_count_parked_lines
    (session_id, restaurant_id, location_id, description, counted_qty, counted_by, counted_at, client_line_id)
  values (w, h, b, 'SYNTHETIC unknown red', 2, p, now(), 'syn-po-1');
  select counted_open_ml into ml from public.stock_count_parked_lines
   where restaurant_id = h and client_line_id = 'syn-po-1';
  if ml is not null then raise exception 'T2 FAIL: a line with no open bottle reads % ml', ml; end if;

  insert into public.stock_count_parked_lines
    (session_id, restaurant_id, location_id, description, counted_qty, counted_open_ml, counted_by, counted_at, client_line_id)
  values (w, h, b, 'SYNTHETIC unknown white', 1, 525, p, now(), 'syn-po-2');
  select counted_open_ml into ml from public.stock_count_parked_lines
   where restaurant_id = h and client_line_id = 'syn-po-2';
  if ml is distinct from 525 then raise exception 'T2 FAIL: read back % ml, not 525', ml; end if;
end $$;

-- T3 a negative open amount is refused.
do $$
declare
  refused boolean := false;
begin
  begin
    insert into public.stock_count_parked_lines
      (session_id, restaurant_id, location_id, description, counted_qty, counted_open_ml, counted_by, counted_at, client_line_id)
    values ((select v from t_fx where k = 'walk'), (select v from t_fx where k = 'house'),
            (select v from t_fx where k = 'bar'), 'SYNTHETIC unknown rose', 0, -75,
            (select v from t_fx where k = 'person'), now(), 'syn-po-3');
  exception when check_violation then
    refused := true;
  end;
  if not refused then raise exception 'T3 FAIL: a negative open amount was kept'; end if;
end $$;

rollback;

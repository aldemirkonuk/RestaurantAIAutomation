-- F-1013 (sim wave 36, export half): a month of the till could not be
-- written up, because report_exports kept only window_days. Migration
-- a_till_export_can_hold_a_month adds window_month (YYYY-MM, checked) and
-- refuses a row that holds both a day count and a month.
--
-- Self-asserting: every block raises on a failure, so the PGlite harness or
-- `psql -v ON_ERROR_STOP=1 -f` stops at the first one. It must FAIL on a
-- build without that migration (T1) and PASS with it. One transaction,
-- rolled back. All fixtures are SYNTHETIC, keyed by fresh uuids.

begin;

create temporary table t_fx (k text primary key, v uuid) on commit drop;
insert into t_fx values ('house', gen_random_uuid());

insert into public.restaurants (id, name, slug)
select v, 'SYNTHETIC month-export house', 'syn-mexp-' || left(replace(v::text, '-', ''), 16)
  from t_fx where k = 'house';

-- T1 the column exists.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'report_exports'
       and column_name = 'window_month'
  ) then
    raise exception 'T1: report_exports.window_month is missing';
  end if;
end $$;

-- T2 a month of the till is kept, and so is a day window and a fixed one.
insert into public.report_exports (restaurant_id, cutting, window_month, title, window_label)
select v, 'till', '2026-07', 'Through the till', 'July 2026 of POS checks, by the house''s days'
  from t_fx where k = 'house';
insert into public.report_exports (restaurant_id, cutting, window_days, title, window_label)
select v, 'till', 30, 'Through the till', 'the last 30 days of POS checks'
  from t_fx where k = 'house';
insert into public.report_exports (restaurant_id, cutting, title, window_label)
select v, 'goals', 'Goals', 'each goal counted from the day it was set'
  from t_fx where k = 'house';
do $$
begin
  if (select count(*) from public.report_exports
       where restaurant_id = (select v from t_fx where k = 'house')) <> 3 then
    raise exception 'T2: a month, a day window or a fixed window was not kept';
  end if;
end $$;

-- T3 a month that is not one is refused: month 13, a bare year, a full day.
do $$
declare
  bad text;
begin
  foreach bad in array array['2026-13', '2026-00', '2026', '2026-07-01', '26-07', ' 2026-07']
  loop
    begin
      insert into public.report_exports (restaurant_id, cutting, window_month, title, window_label)
      select v, 'till', bad, 'Through the till', 'x' from t_fx where k = 'house';
      raise exception 'T3: % was stored as a month', bad;
    exception when check_violation then
      null;
    end;
  end loop;
end $$;

-- T4 a row never holds both a day count and a month.
do $$
begin
  begin
    insert into public.report_exports (restaurant_id, cutting, window_days, window_month, title, window_label)
    select v, 'till', 30, '2026-07', 'Through the till', 'x' from t_fx where k = 'house';
    raise exception 'T4: a row held both 30 days and a month';
  exception when check_violation then
    null;
  end;
end $$;

rollback;

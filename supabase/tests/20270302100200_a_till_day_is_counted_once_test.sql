-- r110 onboarding (DD-r109-22 narrowing 2, DD-r110-19): a till's day is
-- counted once. Migration a_till_day_is_counted_once.
--
-- Self-asserting: every block raises on a failure, so `psql -v ON_ERROR_STOP=1
-- -f` stops at the first one. Run it on a database built from
-- supabase/migrations. It must FAIL without that migration (T1: no function)
-- and PASS with it. One transaction, rolled back.
--
-- Not covered here: two sessions really racing. This file runs in one
-- session; T6 shows both sides take the same advisory lock key, and
-- PostgreSQL's lock semantics do the rest.

begin;

insert into public.restaurants (id, name, slug, timezone)
values
  ('a1100000-0000-4000-8000-000000000001', 'r110 history house', 'r110-history-house', 'Europe/Istanbul'),
  ('a1100000-0000-4000-8000-000000000002', 'r110 other house', 'r110-other-house', 'Europe/Istanbul');

-- The day's takings as any reader that adds the two sources would compute it.
create function pg_temp.takings(p_house uuid, p_day date) returns numeric language sql as $$
  select coalesce((select sum(c.total) from public.pos_checks c
                    where c.restaurant_id = p_house
                      and (c.closed_at at time zone 'Europe/Istanbul')::date = p_day), 0)
       + coalesce((select sum(h.net) from public.pos_sales_history h
                    where h.restaurant_id = p_house and h.sale_date = p_day), 0)
$$;

-- T1 a history day leaves Average check unchanged: the import writes no check.
do $$
declare
  before_avg numeric;
  before_n bigint;
  out jsonb;
begin
  insert into public.pos_checks (restaurant_id, source, external_check_id, opened_at, closed_at, total)
  values ('a1100000-0000-4000-8000-000000000001', 'toast', 'T-19', '2026-11-19 18:00+03', '2026-11-19 19:00+03', 100.00);
  select avg(total), count(*) into before_avg, before_n from public.pos_checks
   where restaurant_id = 'a1100000-0000-4000-8000-000000000001';
  out := public.import_pos_sales_history('a1100000-0000-4000-8000-000000000001', jsonb_build_array(
    jsonb_build_object('sale_date', '2026-11-20', 'item_key', 'meze', 'item_name', 'Meze', 'qty', 3, 'net', 30, 'currency', 'TRY'),
    jsonb_build_object('sale_date', '2026-11-20', 'item_key', 'raki', 'item_name', 'Rakı', 'qty', 2, 'net', 50, 'currency', 'TRY')));
  assert (out->>'saved')::int = 2, format('T1 FAIL saved %s, expected 2', out);
  assert (select avg(total) from public.pos_checks where restaurant_id = 'a1100000-0000-4000-8000-000000000001') = before_avg,
    'T1 FAIL the import moved Average check';
  assert (select count(*) from public.pos_checks where restaurant_id = 'a1100000-0000-4000-8000-000000000001') = before_n,
    'T1 FAIL the import wrote a check';
  raise notice 'PASS T1 a history day leaves Average check unchanged';
end $$;

-- T2 the import refuses a house-day that already holds a check, by house-day
-- (00:30 Istanbul on the 22nd is 21:30 UTC on the 21st), and saves the rest.
do $$
declare
  out jsonb;
begin
  insert into public.pos_checks (restaurant_id, source, external_check_id, opened_at, closed_at, total)
  values ('a1100000-0000-4000-8000-000000000001', 'csv_import', 'C-22', '2026-11-22 00:10+03', '2026-11-22 00:30+03', 80.00);
  out := public.import_pos_sales_history('a1100000-0000-4000-8000-000000000001', jsonb_build_array(
    jsonb_build_object('sale_date', '2026-11-19', 'item_key', 'meze', 'item_name', 'Meze', 'qty', 9, 'net', 90, 'currency', 'TRY'),
    jsonb_build_object('sale_date', '2026-11-21', 'item_key', 'meze', 'item_name', 'Meze', 'qty', 1, 'net', 10, 'currency', 'TRY'),
    jsonb_build_object('sale_date', '2026-11-22', 'item_key', 'meze', 'item_name', 'Meze', 'qty', 4, 'net', 40, 'currency', 'TRY')));
  assert out->'refused_days' = '["2026-11-19", "2026-11-22"]'::jsonb, format('T2 FAIL refused %s', out->'refused_days');
  assert (out->>'saved')::int = 1, format('T2 FAIL saved %s, expected 1', out);
  assert not exists (select 1 from public.pos_sales_history where restaurant_id = 'a1100000-0000-4000-8000-000000000001'
                      and sale_date in ('2026-11-19', '2026-11-22')), 'T2 FAIL a refused day kept history';
  assert pg_temp.takings('a1100000-0000-4000-8000-000000000001', '2026-11-19') = 100.00, 'T2 FAIL the 19th counted twice';
  -- An open check (no closed_at) holds nothing: it may close on another day.
  insert into public.pos_checks (restaurant_id, source, external_check_id, opened_at, total)
  values ('a1100000-0000-4000-8000-000000000001', 'toast', 'OPEN-24', '2026-11-24 20:00+03', 12.00);
  out := public.import_pos_sales_history('a1100000-0000-4000-8000-000000000001', jsonb_build_array(
    jsonb_build_object('sale_date', '2026-11-24', 'item_key', 'meze', 'item_name', 'Meze', 'qty', 1, 'net', 10, 'currency', 'TRY')));
  assert out->'refused_days' = '[]'::jsonb and (out->>'saved')::int = 1, format('T2 FAIL an open check held its day: %s', out);
  raise notice 'PASS T2 the import refuses a day the till already holds';
end $$;

-- T3 import, then a live check on the same day: one day's takings, not two.
do $$
begin
  assert pg_temp.takings('a1100000-0000-4000-8000-000000000001', '2026-11-20') = 80, 'T3 FAIL setup: history not 80';
  insert into public.pos_checks (restaurant_id, source, external_check_id, opened_at, closed_at, total)
  values ('a1100000-0000-4000-8000-000000000001', 'toast', 'T-20', '2026-11-20 20:00+03', '2026-11-20 21:00+03', 95.00);
  assert not exists (select 1 from public.pos_sales_history where restaurant_id = 'a1100000-0000-4000-8000-000000000001'
                      and sale_date = '2026-11-20'), 'T3 FAIL history rows survived the check';
  assert pg_temp.takings('a1100000-0000-4000-8000-000000000001', '2026-11-20') = 95.00, 'T3 FAIL the 20th counted twice';
  -- Other days and other houses keep theirs.
  assert exists (select 1 from public.pos_sales_history where restaurant_id = 'a1100000-0000-4000-8000-000000000001'
                  and sale_date = '2026-11-21'), 'T3 FAIL the 21st lost its history';
  raise notice 'PASS T3 a live check replaces that day''s history';
end $$;

-- T4 a check moved onto a history day (late close, an upsert) replaces it too,
-- and the house-day is the house's: 01:00 Istanbul on the 22nd is the 22nd.
do $$
begin
  perform public.import_pos_sales_history('a1100000-0000-4000-8000-000000000002', jsonb_build_array(
    jsonb_build_object('sale_date', '2026-11-21', 'item_key', 'meze', 'item_name', 'Meze', 'qty', 1, 'net', 10, 'currency', 'TRY'),
    jsonb_build_object('sale_date', '2026-11-22', 'item_key', 'meze', 'item_name', 'Meze', 'qty', 1, 'net', 10, 'currency', 'TRY')));
  insert into public.pos_checks (restaurant_id, source, external_check_id, opened_at, total)
  values ('a1100000-0000-4000-8000-000000000002', 'toast', 'MOVE', '2026-11-20 12:00+03', 10.00);
  assert (select count(*) from public.pos_sales_history where restaurant_id = 'a1100000-0000-4000-8000-000000000002') = 2,
    'T4 FAIL an open check on the 20th touched other days';
  update public.pos_checks set closed_at = '2026-11-22 01:00+03'
   where restaurant_id = 'a1100000-0000-4000-8000-000000000002' and external_check_id = 'MOVE';
  assert not exists (select 1 from public.pos_sales_history where restaurant_id = 'a1100000-0000-4000-8000-000000000002'
                      and sale_date = '2026-11-22'), 'T4 FAIL the close on the 22nd left its history';
  assert exists (select 1 from public.pos_sales_history where restaurant_id = 'a1100000-0000-4000-8000-000000000002'
                  and sale_date = '2026-11-21'), 'T4 FAIL the 21st (the UTC date of the close) lost its history';
  raise notice 'PASS T4 a check closed onto a history day replaces it, by the house''s day';
end $$;

-- T4b history on the day a check OPENS survives that check closing after
-- midnight: only the close day is replaced (the late close moves to the 21st).
do $$
begin
  perform public.import_pos_sales_history('a1100000-0000-4000-8000-000000000002', jsonb_build_array(
    jsonb_build_object('sale_date', '2026-11-26', 'item_key', 'meze', 'item_name', 'Meze', 'qty', 9, 'net', 90, 'currency', 'TRY')));
  insert into public.pos_checks (restaurant_id, source, external_check_id, opened_at, total)
  values ('a1100000-0000-4000-8000-000000000002', 'toast', 'LATE', '2026-11-26 23:30+03', 50.00);
  update public.pos_checks set closed_at = '2026-11-27 00:30+03'
   where restaurant_id = 'a1100000-0000-4000-8000-000000000002' and external_check_id = 'LATE';
  assert pg_temp.takings('a1100000-0000-4000-8000-000000000002', '2026-11-26') = 90, 'T4b FAIL the 26th lost its history to a check that opened on it';
  assert pg_temp.takings('a1100000-0000-4000-8000-000000000002', '2026-11-27') = 50, 'T4b FAIL the 27th is not the check''s alone';
  raise notice 'PASS T4b a check opened on a day and closed after midnight leaves the opened day alone';
end $$;

-- T4c a corrected re-upload that renames an item replaces the day, never adds.
do $$
begin
  perform public.import_pos_sales_history('a1100000-0000-4000-8000-000000000002', jsonb_build_array(
    jsonb_build_object('sale_date', '2026-11-18', 'item_key', 'hist:mezze', 'item_name', 'Mezze', 'qty', 3, 'net', 30, 'currency', 'TRY')));
  perform public.import_pos_sales_history('a1100000-0000-4000-8000-000000000002', jsonb_build_array(
    jsonb_build_object('sale_date', '2026-11-18', 'item_key', 'hist:meze', 'item_name', 'Meze', 'qty', 3, 'net', 30, 'currency', 'TRY')));
  assert (select sum(net) from public.pos_sales_history where restaurant_id = 'a1100000-0000-4000-8000-000000000002' and sale_date = '2026-11-18') = 30,
    'T4c FAIL the day''s takings doubled on a renamed re-upload';
  raise notice 'PASS T4c a re-upload replaces the day';
end $$;

-- T5 the day counts the ingest reads to say what was replaced.
do $$
declare
  n int;
begin
  select item_days into n from public.pos_sales_history_day_counts('a1100000-0000-4000-8000-000000000001', '2026-11-01', '2026-11-30')
   where sale_date = '2026-11-21';
  assert n = 1, format('T5 FAIL day count %s, expected 1', n);
  assert (select count(*) from public.pos_sales_history_day_counts('a1100000-0000-4000-8000-000000000001', '2026-11-01', '2026-11-30')) = 2,
    'T5 FAIL a replaced day still counted';
  raise notice 'PASS T5 day counts';
end $$;

-- T6 both sides take the same lock key for a (house, day), and nothing else.
do $$
declare
  k bigint := hashtextextended('pos_history_day:a1100000-0000-4000-8000-000000000001:2026-11-25', 0);
  held int;
begin
  perform public.pos_history_day_lock('a1100000-0000-4000-8000-000000000001', '2026-11-25');
  select count(*) into held from pg_locks
   where locktype = 'advisory' and pid = pg_backend_pid()
     and ((classid::bigint << 32) | objid::bigint) = k;
  assert held = 1, format('T6 FAIL the lock helper did not hold key %s', k);
  assert pg_get_functiondef('public.pos_checks_replace_history_day()'::regprocedure) like '%pos_history_day_lock(NEW.restaurant_id, d)%',
    'T6 FAIL the trigger does not take the day lock';
  assert pg_get_functiondef('public.import_pos_sales_history(uuid, jsonb)'::regprocedure) like '%pos_history_day_lock(p_restaurant_id, d)%',
    'T6 FAIL the import does not take the day lock';
  raise notice 'PASS T6 one lock key on both sides';
end $$;

-- T7 grants: no client role may call any of it; service_role may call the RPCs.
do $$
declare
  f text;
begin
  foreach f in array array['public.pos_house_zone(uuid)', 'public.pos_history_day_lock(uuid,date)',
                           'public.import_pos_sales_history(uuid,jsonb)', 'public.pos_sales_history_day_counts(uuid,date,date)',
                           'public.pos_checks_replace_history_day()'] loop
    assert not has_function_privilege('anon', f, 'EXECUTE'), format('T7 FAIL anon may execute %s', f);
    assert not has_function_privilege('authenticated', f, 'EXECUTE'), format('T7 FAIL authenticated may execute %s', f);
  end loop;
  assert has_function_privilege('service_role', 'public.import_pos_sales_history(uuid,jsonb)', 'EXECUTE'), 'T7 FAIL service_role cannot import';
  raise notice 'PASS T7 grants';
end $$;

rollback;

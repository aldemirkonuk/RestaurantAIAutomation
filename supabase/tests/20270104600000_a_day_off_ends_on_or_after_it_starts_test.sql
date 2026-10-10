-- F-923 (sim wave 67): time_off_requests stored a last day before the first.
-- Migration a_day_off_ends_on_or_after_it_starts adds
-- CHECK (start_date <= end_date); a past first day stays allowed.
--
-- Self-asserting: every block raises on a failure, so the PGlite harness or
-- `psql -v ON_ERROR_STOP=1 -f` stops at the first one. It must FAIL on a
-- build without that migration (T1) and PASS with it. One transaction,
-- rolled back. All fixtures are SYNTHETIC, keyed by fresh uuids.

begin;

create temporary table t_fx (k text primary key, v uuid) on commit drop;
insert into t_fx values ('house', gen_random_uuid()), ('member', gen_random_uuid());

insert into public.restaurants (id, name, slug)
select v, 'SYNTHETIC time-off house', 'syn-toff-' || left(replace(v::text, '-', ''), 16)
  from t_fx where k = 'house';

insert into public.team_members (id, restaurant_id, display_name)
select (select v from t_fx where k = 'member'), (select v from t_fx where k = 'house'), 'SYNTHETIC member';

-- T1 the check exists.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'time_off_requests_ends_on_or_after_start'
       and conrelid = 'public.time_off_requests'::regclass
       and contype = 'c'
  ) then
    raise exception 'T1: time_off_requests_ends_on_or_after_start is missing';
  end if;
end $$;

-- T2 a last day before the first is refused.
do $$
begin
  begin
    insert into public.time_off_requests (restaurant_id, member_id, start_date, end_date)
    select (select v from t_fx where k = 'house'), (select v from t_fx where k = 'member'),
           current_date + 5, current_date + 3;
    raise exception 'T2: a reversed range was stored';
  exception when check_violation then
    null;
  end;
end $$;

-- T3 a past first day is kept (sick leave filed after the day), and so is a
-- one-day request.
insert into public.time_off_requests (restaurant_id, member_id, start_date, end_date)
select (select v from t_fx where k = 'house'), (select v from t_fx where k = 'member'),
       current_date - 3, current_date - 2;
insert into public.time_off_requests (restaurant_id, member_id, start_date, end_date)
select (select v from t_fx where k = 'house'), (select v from t_fx where k = 'member'),
       current_date + 1, current_date + 1;
do $$
begin
  if (select count(*) from public.time_off_requests
       where restaurant_id = (select v from t_fx where k = 'house')) <> 2 then
    raise exception 'T3: a past-dated or one-day request was not kept';
  end if;
end $$;

-- T4 an edit that turns a kept range backwards is refused too.
do $$
begin
  begin
    update public.time_off_requests set end_date = start_date - 1
     where restaurant_id = (select v from t_fx where k = 'house');
    raise exception 'T4: an update reversed a stored range';
  exception when check_violation then
    null;
  end;
end $$;

-- T5 with no reversed row stored before it, the check was validated, not
-- left NOT VALID.
do $$
begin
  if not exists (select 1 from public.time_off_requests where end_date < start_date)
     and not (select convalidated from pg_constraint
               where conname = 'time_off_requests_ends_on_or_after_start'
                 and conrelid = 'public.time_off_requests'::regclass) then
    raise exception 'T5: no reversed row exists, yet the check was left NOT VALID';
  end if;
end $$;

rollback;

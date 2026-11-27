-- One setup letter per house (DD-r108-57; migration
-- 20270303090000_one_setup_reminder_per_house.sql; r109 onboarding-r109-5).
--
-- Run against a database built from supabase/migrations. Everything it writes
-- is inside one transaction that is ROLLED BACK at the end. It prints one row
-- per test: id, ok, detail. Every "ok" must be true. Without the migration the
-- first fixture insert errors (no setup_reminder columns), which is the control.
--
-- The claim below is the statement SetupReminderService.runOnce sends through
-- PostgREST: update ... where id = $1 and setup_reminder_sent_at is null and
-- menu_uploaded = false and setup_reminder_opt_out = false returning id.
-- This file runs in one session, so T4 is the second instance arriving after
-- the first committed. Two sessions racing is Postgres's READ COMMITTED rule:
-- the blocked UPDATE re-checks its WHERE on the stamped row and matches none.

begin;

create temp table _t (id text primary key, ok boolean, detail text) on commit drop;
create temp table _fx (k text primary key, v uuid) on commit drop;

do $$
declare h uuid; u1 uuid := gen_random_uuid(); u2 uuid := gen_random_uuid(); u3 uuid := gen_random_uuid();
  u4 uuid := gen_random_uuid(); p1 uuid; p2 uuid; p3 uuid; p4 uuid;
begin
  insert into public.restaurants (name, slug) values ('Letter house', 'letter-' || u1) returning id into h;
  insert into public.users (user_id, email, name) values
    (u1, u1 || '@t.test', 'Waiting'), (u2, u2 || '@t.test', 'Read'),
    (u3, u3 || '@t.test', 'Stopped'), (u4, u4 || '@t.test', 'Plain');
  -- p1 waits (25 h, no menu); p2 read its menu; p3 opted out; p4 is written
  -- the way auth.service writes a new row: without the three new columns.
  insert into public.user_onboarding_progress (user_id, restaurant_id, created_at)
    values (u1, h, now() - interval '25 hours') returning id into p1;
  insert into public.user_onboarding_progress (user_id, restaurant_id, created_at, menu_uploaded)
    values (u2, h, now() - interval '25 hours', true) returning id into p2;
  insert into public.user_onboarding_progress (user_id, restaurant_id, created_at, setup_reminder_opt_out)
    values (u3, h, now() - interval '25 hours', true) returning id into p3;
  insert into public.user_onboarding_progress (user_id, restaurant_id) values (u4, h) returning id into p4;
  insert into _fx values ('h', h), ('p1', p1), ('p2', p2), ('p3', p3), ('p4', p4);
end $$;

create or replace function pg_temp.fx(k text) returns uuid language sql as $$ select v from _fx where _fx.k = fx.k $$;

-- The service's claim, as one statement. Returns how many rows it won.
create or replace function pg_temp.claim(row_id uuid, token_hash text) returns int language sql as $$
  with won as (
    update public.user_onboarding_progress
       set setup_reminder_sent_at = now(), setup_reminder_token_hash = token_hash
     where id = row_id
       and setup_reminder_sent_at is null
       and menu_uploaded = false
       and setup_reminder_opt_out = false
    returning id)
  select count(*)::int from won
$$;

-- T1: a row written without the new columns waits for its letter, not opted out.
insert into _t
select 'T1', setup_reminder_sent_at is null and setup_reminder_opt_out = false and setup_reminder_token_hash is null,
  format('sent_at=%s opt_out=%s hash=%s', setup_reminder_sent_at, setup_reminder_opt_out, setup_reminder_token_hash)
from public.user_onboarding_progress where id = pg_temp.fx('p4');

-- T2: opt-out is NOT NULL DEFAULT false; the other two are nullable with no default.
insert into _t
select 'T2', bool_and(case column_name
    when 'setup_reminder_opt_out' then is_nullable = 'NO' and column_default = 'false'
    else is_nullable = 'YES' and column_default is null end) and count(*) = 3,
  string_agg(column_name || ':' || is_nullable || ':' || coalesce(column_default, '-'), ' ' order by column_name)
from information_schema.columns
where table_schema = 'public' and table_name = 'user_onboarding_progress' and column_name like 'setup_reminder_%';

-- T3: the first claim wins the waiting row and stamps the hash with it.
insert into _t select 'T3', pg_temp.claim(pg_temp.fx('p1'), 'hash-one') = 1, 'first claim';
insert into _t
select 'T3b', setup_reminder_sent_at is not null and setup_reminder_token_hash = 'hash-one',
  format('sent_at=%s hash=%s', setup_reminder_sent_at, setup_reminder_token_hash)
from public.user_onboarding_progress where id = pg_temp.fx('p1');

-- T4: a second instance's claim on the same row wins nothing and keeps the first hash.
insert into _t select 'T4', pg_temp.claim(pg_temp.fx('p1'), 'hash-two') = 0, 'second claim';
insert into _t
select 'T4b', setup_reminder_token_hash = 'hash-one', coalesce(setup_reminder_token_hash, 'null')
from public.user_onboarding_progress where id = pg_temp.fx('p1');

-- T5: a house that read its menu cannot be claimed, so it gets no letter.
insert into _t select 'T5', pg_temp.claim(pg_temp.fx('p2'), 'hash-read') = 0, 'menu read';

-- T6: an owner who opted out cannot be claimed.
insert into _t select 'T6', pg_temp.claim(pg_temp.fx('p3'), 'hash-stop') = 0, 'opted out';

-- T7: a menu read between the sweep's read and its claim still wins nothing.
update public.user_onboarding_progress set menu_uploaded = true where id = pg_temp.fx('p4');
insert into _t select 'T7', pg_temp.claim(pg_temp.fx('p4'), 'hash-late') = 0, 'menu read after the sweep read';

-- T8: two rows can never carry the same token hash (one link, one row).
do $$ begin
  begin
    update public.user_onboarding_progress set setup_reminder_token_hash = 'hash-one' where id = pg_temp.fx('p2');
    insert into _t values ('T8', false, 'a second row took hash-one');
  exception when unique_violation then
    insert into _t values ('T8', true, 'unique_violation');
  end;
end $$;

-- T9: the unsubscribe write (by hash) stops that row only.
update public.user_onboarding_progress set setup_reminder_opt_out = true
 where id = (select id from public.user_onboarding_progress where setup_reminder_token_hash = 'hash-one' limit 1);
insert into _t
select 'T9', bool_and((id = pg_temp.fx('p1')) = setup_reminder_opt_out) filter (where id <> pg_temp.fx('p3')),
  string_agg(setup_reminder_opt_out::text, ',' order by created_at, id)
from public.user_onboarding_progress where restaurant_id = pg_temp.fx('h');

-- T10: the sweep's partial index carries the three conditions the sweep reads.
insert into _t
select 'T10', indexdef like '%WHERE ((setup_reminder_sent_at IS NULL) AND (menu_uploaded = false) AND (setup_reminder_opt_out = false))%',
  indexdef
from pg_indexes where schemaname = 'public' and indexname = 'user_onboarding_progress_setup_reminder_due';

-- T11: the token index is unique and partial (rows without a letter carry no hash).
insert into _t
select 'T11', indexdef like 'CREATE UNIQUE INDEX%' and indexdef like '%WHERE (setup_reminder_token_hash IS NOT NULL)%', indexdef
from pg_indexes where schemaname = 'public' and indexname = 'user_onboarding_progress_setup_reminder_token';

select id, ok, detail from _t order by id;

rollback;

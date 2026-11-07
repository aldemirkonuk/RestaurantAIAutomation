-- The floor keeps its own record (ADR 0345 E4, E5, E7; migration
-- 20270302100000_the_floor_keeps_its_own_record.sql).
--
-- Run against a database built from supabase/migrations. Everything it writes
-- is inside one transaction that is ROLLED BACK at the end. It prints one row
-- per test: id, ok, detail. Every "ok" must be true. Without the migration the
-- first fixture insert errors (no floor tables), which is the control.

begin;

create temp table _t (id text primary key, ok boolean, detail text) on commit drop;
create temp table _fx (k text primary key, v uuid) on commit drop;

do $$
declare a uuid; b uuid; u1 uuid := gen_random_uuid(); u2 uuid := gen_random_uuid();
  ta uuid; tb uuid; sa uuid; sb uuid; shift_a uuid; shift_b uuid; item_a uuid; menu_a uuid;
begin
  insert into public.restaurants (name, slug) values ('Floor A', 'floor-a-' || u1) returning id into a;
  insert into public.restaurants (name, slug) values ('Floor B', 'floor-b-' || u1) returning id into b;
  insert into public.users (user_id, email, name) values (u1, u1 || '@t.test', 'One'), (u2, u2 || '@t.test', 'Two');
  insert into public.restaurant_tables (restaurant_id, label) values (a, 'A1') returning id into ta;
  insert into public.restaurant_tables (restaurant_id, label) values (b, 'B1') returning id into tb;
  insert into public.floor_sections (restaurant_id, name) values (a, 'Terrace') returning id into sa;
  insert into public.floor_sections (restaurant_id, name) values (b, 'Hall') returning id into sb;
  insert into public.shifts (restaurant_id, shift_date, start_time, end_time) values (a, current_date, '18:00', '23:00') returning id into shift_a;
  insert into public.shifts (restaurant_id, shift_date, start_time, end_time) values (b, current_date, '18:00', '23:00') returning id into shift_b;
  insert into public.restaurant_menus (restaurant_id, name) values (a, 'Wine') returning id into menu_a;
  insert into public.menu_items (menu_id, restaurant_id, name) values (menu_a, a, 'House red') returning id into item_a;
  insert into _fx values ('a', a), ('b', b), ('u1', u1), ('u2', u2), ('ta', ta), ('tb', tb),
    ('sa', sa), ('sb', sb), ('shift_a', shift_a), ('shift_b', shift_b), ('item_a', item_a);
end $$;

create or replace function pg_temp.fx(k text) returns uuid language sql as $$ select v from _fx where _fx.k = fx.k $$;

-- T1: one open party per table.
do $$ begin
  insert into public.floor_seatings (restaurant_id, table_id) values (pg_temp.fx('a'), pg_temp.fx('ta'));
  begin
    insert into public.floor_seatings (restaurant_id, table_id) values (pg_temp.fx('a'), pg_temp.fx('ta'));
    insert into _t values ('T1', false, 'second open seating accepted');
  exception when unique_violation then insert into _t values ('T1', true, 'second open seating refused');
  end;
end $$;

-- T2: party size is NULL when nobody said; zero is refused (E9).
do $$ begin
  insert into _t select 'T2a', party_size is null, 'party_size defaults NULL'
    from public.floor_seatings where table_id = pg_temp.fx('ta');
  begin
    update public.floor_seatings set party_size = 0 where table_id = pg_temp.fx('ta');
    insert into _t values ('T2b', false, 'party_size 0 accepted');
  exception when check_violation then insert into _t values ('T2b', true, 'party_size 0 refused');
  end;
end $$;

-- T3: Paid carries its source.
do $$ begin
  update public.floor_seatings set paid_at = now() where table_id = pg_temp.fx('ta');
  insert into _t values ('T3', false, 'paid_at without paid_source accepted');
exception when check_violation then insert into _t values ('T3', true, 'paid_at without source refused');
end $$;

-- T4: a section of house A cannot hold a table of house B.
do $$ begin
  insert into public.floor_section_tables (table_id, restaurant_id, section_id)
    values (pg_temp.fx('tb'), pg_temp.fx('a'), pg_temp.fx('sa'));
  insert into _t values ('T4', false, 'cross-house section table accepted');
exception when foreign_key_violation then insert into _t values ('T4', true, 'cross-house refused');
end $$;

-- T5: one live holder per table.
do $$ begin
  insert into public.floor_assignments (restaurant_id, user_id, table_id, service_date)
    values (pg_temp.fx('a'), pg_temp.fx('u1'), pg_temp.fx('ta'), current_date);
  begin
    insert into public.floor_assignments (restaurant_id, user_id, table_id, service_date)
      values (pg_temp.fx('a'), pg_temp.fx('u2'), pg_temp.fx('ta'), current_date);
    insert into _t values ('T5', false, 'second live holder accepted');
  exception when unique_violation then insert into _t values ('T5', true, 'second live holder refused');
  end;
end $$;

-- T6: a punch names a shift of its own house; deleting the shift keeps the punch.
do $$ declare n int; begin
  begin
    insert into public.floor_punches (restaurant_id, user_id, shift_id)
      values (pg_temp.fx('a'), pg_temp.fx('u1'), pg_temp.fx('shift_b'));
    insert into _t values ('T6a', false, 'cross-house shift accepted');
  exception when foreign_key_violation then insert into _t values ('T6a', true, 'cross-house shift refused');
  end;
  insert into public.floor_punches (restaurant_id, user_id, shift_id)
    values (pg_temp.fx('a'), pg_temp.fx('u1'), pg_temp.fx('shift_a'));
  delete from public.shifts where id = pg_temp.fx('shift_a');
  select count(*) into n from public.floor_punches
    where user_id = pg_temp.fx('u1') and restaurant_id = pg_temp.fx('a') and shift_id is null;
  insert into _t values ('T6b', n = 1, 'punch kept with shift_id NULL: ' || n);
end $$;

-- T7: one open punch per person per house.
do $$ begin
  insert into public.floor_punches (restaurant_id, user_id) values (pg_temp.fx('a'), pg_temp.fx('u1'));
  insert into _t values ('T7', false, 'second open punch accepted');
exception when unique_violation then insert into _t values ('T7', true, 'second open punch refused');
end $$;

-- T8: Out tonight names exactly one thing.
do $$ begin
  insert into public.floor_out_tonight (restaurant_id, menu_item_id, label, service_date, marked_by)
    values (pg_temp.fx('a'), pg_temp.fx('item_a'), 'House red', current_date, pg_temp.fx('u1'));
  insert into _t values ('T8', false, 'item and label both accepted');
exception when check_violation then insert into _t values ('T8', true, 'item and label refused');
end $$;

-- T9: a confirmed till link names a person (E4).
do $$ begin
  insert into public.pos_server_links (restaurant_id, source, till_server_name_norm, state)
    values (pg_temp.fx('a'), 'sim', 'ayse', 'confirmed');
  insert into _t values ('T9', false, 'confirmed link without a person accepted');
exception when check_violation then insert into _t values ('T9', true, 'confirmed link without a person refused');
end $$;

-- T10: a send is claimed once per key and person (E3).
do $$ begin
  insert into public.floor_nudge_sends (restaurant_id, idempotency_key, user_id, kind)
    values (pg_temp.fx('a'), 'late:s1:v0:w0', pg_temp.fx('u1'), 'late');
  begin
    insert into public.floor_nudge_sends (restaurant_id, idempotency_key, user_id, kind)
      values (pg_temp.fx('a'), 'late:s1:v0:w0', pg_temp.fx('u1'), 'late');
    insert into _t values ('T10', false, 'second claim accepted');
  exception when unique_violation then insert into _t values ('T10', true, 'second claim refused');
  end;
end $$;

-- T11: one runner per tick.
do $$ begin
  insert into public.floor_nudge_ticks (tick_at, runner) values ('2027-03-02T20:00:00Z', 'r1');
  begin
    insert into public.floor_nudge_ticks (tick_at, runner) values ('2027-03-02T20:00:00Z', 'r2');
    insert into _t values ('T11', false, 'second runner accepted');
  exception when unique_violation then insert into _t values ('T11', true, 'second runner refused');
  end;
end $$;

-- T14: a punch is append-only (ADR 0350 :78).
do $$ declare p uuid; begin
  insert into public.floor_punches (restaurant_id, user_id) values (pg_temp.fx('b'), pg_temp.fx('u2')) returning id into p;
  insert into _fx values ('p14', p);
  begin
    update public.floor_punches set clocked_in_at = clocked_in_at - interval '1 hour' where id = p;
    insert into _t values ('T14a', false, 'clocked_in_at rewritten');
  exception when check_violation then insert into _t values ('T14a', true, 'clocked_in_at change refused');
  end;
  update public.floor_punches set clocked_out_at = now(), clocked_out_reason = 'break' where id = p;
  begin
    update public.floor_punches set clocked_out_at = clocked_out_at + interval '1 minute' where id = p;
    insert into _t values ('T14b', false, 'clock-out rewritten');
  exception when check_violation then insert into _t values ('T14b', true, 'second clock-out refused, first accepted');
  end;
  update public.floor_punches set superseded_at = now() where id = p;
  begin
    update public.floor_punches set superseded_at = null where id = p;
    insert into _t values ('T14c', false, 'superseded mark cleared');
  exception when check_violation then insert into _t values ('T14c', true, 'superseded mark set once');
  end;
end $$;

-- T15: a correction and a Back name a punch of their own house only.
do $$ begin
  begin
    insert into public.floor_punches (restaurant_id, user_id, supersedes_id, clocked_out_at, clocked_out_reason)
      values (pg_temp.fx('a'), pg_temp.fx('u2'), pg_temp.fx('p14'), now(), 'clock_out');
    insert into _t values ('T15a', false, 'cross-house correction accepted');
  exception when foreign_key_violation then insert into _t values ('T15a', true, 'cross-house correction refused');
  end;
  begin
    insert into public.floor_punches (restaurant_id, user_id, resumes_id, clocked_out_at, clocked_out_reason)
      values (pg_temp.fx('a'), pg_temp.fx('u2'), pg_temp.fx('p14'), now(), 'clock_out');
    insert into _t values ('T15b', false, 'cross-house Back accepted');
  exception when foreign_key_violation then insert into _t values ('T15b', true, 'cross-house Back refused');
  end;
  insert into public.floor_punches (restaurant_id, user_id, resumes_id) values (pg_temp.fx('b'), pg_temp.fx('u2'), pg_temp.fx('p14'));
  insert into _t values ('T15c', true, 'same-house Back accepted');
end $$;

-- T16: a person with punches cannot be hard-deleted under them (ADR 0350 :71).
do $$ declare c text; begin
  delete from public.users where user_id = pg_temp.fx('u2');
  insert into _t values ('T16', false, 'person deleted with punches');
exception when foreign_key_violation then
  get stacked diagnostics c = constraint_name;
  insert into _t values ('T16', c like 'floor_punches%', 'delete refused by ' || c);
end $$;

-- T17: a punch is not deleted or truncated on its own (ADR 0350 :71, :78).
do $$ declare p uuid; begin
  insert into public.floor_punches (restaurant_id, user_id, clocked_out_at, clocked_out_reason)
    values (pg_temp.fx('a'), pg_temp.fx('u1'), now(), 'clock_out') returning id into p;
  begin
    delete from public.floor_punches where id = p;
    insert into _t values ('T17a', false, 'punch deleted while its house stands');
  exception when check_violation then insert into _t values ('T17a', true, 'punch delete refused');
  end;
  begin
    truncate public.floor_punches;
    insert into _t values ('T17b', false, 'punches truncated');
  exception when check_violation then insert into _t values ('T17b', true, 'truncate refused');
  end;
end $$;

-- T18: a house with punches is not hard-deleted under them (ADR 0350 :71).
do $$ declare c text; begin
  delete from public.restaurants where id = pg_temp.fx('b');
  insert into _t values ('T18', false, 'house deleted with punches');
exception when foreign_key_violation then
  get stacked diagnostics c = constraint_name;
  insert into _t values ('T18', c like 'floor_punches%', 'house delete refused by ' || c);
when check_violation then
  insert into _t values ('T18', false, 'house delete cascaded into the punches');
end $$;

-- T19: one live link per till server (E4): by id when the till sends one, else by name.
do $$ begin
  insert into public.pos_server_links (restaurant_id, source, till_server_id, till_server_name_norm)
    values (pg_temp.fx('a'), 'sim', '42', 'ayse');
  begin
    insert into public.pos_server_links (restaurant_id, source, till_server_id, till_server_name_norm)
      values (pg_temp.fx('a'), 'sim', '42', 'ayse k');
    insert into _t values ('T19a', false, 'second live link for till id 42 accepted');
  exception when unique_violation then insert into _t values ('T19a', true, 'second live link for one till id refused');
  end;
  insert into public.pos_server_links (restaurant_id, source, till_server_name_norm) values (pg_temp.fx('a'), 'sim', 'mehmet');
  begin
    insert into public.pos_server_links (restaurant_id, source, till_server_name_norm) values (pg_temp.fx('a'), 'sim', 'mehmet');
    insert into _t values ('T19b', false, 'second live link for one name accepted');
  exception when unique_violation then insert into _t values ('T19b', true, 'second live link for one name refused');
  end;
  begin
    insert into public.pos_server_links (restaurant_id, source, till_server_id) values (pg_temp.fx('a'), 'sim', ' ');
    insert into _t values ('T19c', false, 'blank till id accepted');
  exception when check_violation then insert into _t values ('T19c', true, 'blank till id refused');
  end;
end $$;

-- T20: deleting the account of the person who entered a punch keeps the punch.
do $$ declare u3 uuid := gen_random_uuid(); p uuid; n int; begin
  insert into public.users (user_id, email, name) values (u3, u3 || '@t.test', 'Three');
  insert into public.floor_punches (restaurant_id, user_id, created_by, clocked_out_at, clocked_out_reason)
    values (pg_temp.fx('a'), pg_temp.fx('u1'), u3, now(), 'clock_out') returning id into p;
  delete from public.users where user_id = u3;
  select count(*) into n from public.floor_punches where id = p and created_by is null;
  insert into _t values ('T20', n = 1, 'punch kept, entered-by cleared: ' || n);
exception when others then
  insert into _t values ('T20', false, 'creator delete failed: ' || sqlerrm);
end $$;

-- T12: RLS on every new table, and no client grant left.
insert into _t
select 'T12', count(*) = 14 and bool_and(c.relrowsecurity)
  and not bool_or(has_table_privilege('anon', c.oid, 'SELECT') or has_table_privilege('authenticated', c.oid, 'SELECT')),
  count(*)::text || ' tables checked'
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname in (
  'floor_settings', 'floor_sections', 'floor_section_tables', 'floor_assignments',
  'floor_seatings', 'floor_visits', 'floor_events', 'floor_table_merges',
  'floor_table_merge_members', 'floor_punches', 'floor_out_tonight',
  'pos_server_links', 'floor_nudge_ticks', 'floor_nudge_sends');

-- T13: the house switch exists and is off by default (E7).
insert into _t
select 'T13', column_default = 'false' and is_nullable = 'NO', coalesce(column_default, 'no default')
from information_schema.columns
where table_schema = 'public' and table_name = 'restaurant_feature_flags' and column_name = 'floor_checker';

select id, ok, detail from _t order by id;

rollback;

-- A zone can sit inside another zone (founder answer 2026-09-29, "Add parent
-- column (Recommended)"; migration 20261202110000_a_zone_can_sit_inside_another_zone.sql).
--
-- Run against a database built from supabase/migrations. Everything it writes
-- is inside one transaction that is ROLLED BACK at the end, so it leaves
-- nothing behind. It prints one row per test: id, ok, detail. Every "ok" must
-- be true. Against the corpus WITHOUT the migration every test is false or
-- errors (there is no parent_id column), which is the control that shows the
-- tests can fail.
--
-- Measured 2026-09-29 (feat/storage-zone-parent) on PostgreSQL 16 over a
-- FIXTURE, not the whole corpus: restaurants reduced to (id, name, slug) and
-- storage_locations with its two baseline triggers copied verbatim from
-- 20260805000000_baseline_from_production.sql, then this migration (applied
-- twice, to show it re-runs). With the migration 13/13; without it the first
-- fixture insert errors on the missing column and nothing passes; with the
-- guard trigger dropped T3b T4 T5 T6 T7 T10 fail; with the orphan trigger
-- dropped T8 fails.
--
-- Not in this file (it needs two sessions): the same run raced A-under-B and
-- B-under-A from two connections; the second was refused (23514) after the
-- first committed. It was refused with the advisory lock removed too, because
-- the guard's FOR SHARE read of the direct parent already waits on the first
-- session's row; the lock is there for longer chains, which were not raced.

begin;

create temp table _t (id text primary key, ok boolean, detail text) on commit drop;
create temp table _fx (k text primary key, v uuid) on commit drop;

-- Fixtures: house A has Cellar > Rack A > Shelf 2 and a loose zone X, Y;
-- house B has one zone.
do $$
declare a uuid; b uuid; cellar uuid; rack uuid; shelf uuid; x uuid; y uuid; bz uuid;
begin
  insert into public.restaurants (name, slug) values ('T House A', 't-house-a-zone-nest') returning id into a;
  insert into public.restaurants (name, slug) values ('T House B', 't-house-b-zone-nest') returning id into b;
  insert into public.storage_locations (restaurant_id, zone, capacity_bottles) values (a, 'Cellar', 500) returning id into cellar;
  insert into public.storage_locations (restaurant_id, zone, capacity_bottles, parent_id) values (a, 'Rack A', 60, cellar) returning id into rack;
  insert into public.storage_locations (restaurant_id, zone, capacity_bottles, parent_id) values (a, 'Shelf 2', 12, rack) returning id into shelf;
  insert into public.storage_locations (restaurant_id, zone, capacity_bottles) values (a, 'X', 10) returning id into x;
  insert into public.storage_locations (restaurant_id, zone, capacity_bottles) values (a, 'Y', 10) returning id into y;
  insert into public.storage_locations (restaurant_id, zone, capacity_bottles) values (b, 'B Cellar', 100) returning id into bz;
  insert into _fx values ('a', a), ('b', b), ('cellar', cellar), ('rack', rack), ('shelf', shelf), ('x', x), ('y', y), ('bz', bz);
end $$;

-- T1 parent_id exists and references storage_locations ON DELETE SET NULL
insert into _t
select 'T1', exists (
  select 1 from pg_constraint c
  join pg_attribute att on att.attrelid = c.conrelid and att.attnum = any (c.conkey)
  where c.conrelid = 'public.storage_locations'::regclass and c.contype = 'f'
    and c.confrelid = 'public.storage_locations'::regclass
    and att.attname = 'parent_id' and c.confdeltype = 'n'), 'fk on parent_id, set null';

-- T2 the fixture nested three deep in one house
insert into _t
select 'T2',
  (select parent_id from public.storage_locations where id = (select v from _fx where k = 'shelf')) = (select v from _fx where k = 'rack')
  and (select parent_id from public.storage_locations where id = (select v from _fx where k = 'rack')) = (select v from _fx where k = 'cellar'),
  'Cellar > Rack A > Shelf 2 stored';

-- T3 a zone cannot be its own parent (the CHECK)
do $$ declare z uuid := (select v from _fx where k = 'x'); st text; cn text; begin
  begin
    update public.storage_locations set parent_id = z where id = z;
    insert into _t values ('T3', false, 'self-parent accepted');
  exception when others then get stacked diagnostics st = returned_sqlstate, cn = constraint_name;
    insert into _t values ('T3', st = '23514', 'refused with ' || st || coalesce(' by ' || nullif(cn, ''), ''));
  end;
end $$;

-- T3b the guard refuses it too (with the CHECK out of the way, the trigger is
-- the second wall; a savepoint keeps the drop local to this test)
do $$ declare z uuid := (select v from _fx where k = 'x'); st text; msg text; begin
  begin
    alter table public.storage_locations drop constraint storage_locations_parent_is_not_self;
    update public.storage_locations set parent_id = z where id = z;
    insert into _t values ('T3b', false, 'self-parent accepted without the check');
    raise exception 'undo' using errcode = 'P0001';
  exception when others then get stacked diagnostics st = returned_sqlstate, msg = message_text;
    if not exists (select 1 from _t where id = 'T3b') then
      insert into _t values ('T3b', st = '23514' and msg like '%itself%', 'refused with ' || st || ': ' || left(msg, 60));
    end if;
  end;
end $$;

-- T4 a parent in another restaurant is refused, on insert and on update
do $$ declare a uuid := (select v from _fx where k = 'a'); bz uuid := (select v from _fx where k = 'bz');
          z uuid := (select v from _fx where k = 'x'); st1 text := 'none'; st2 text := 'none'; begin
  begin
    insert into public.storage_locations (restaurant_id, zone, capacity_bottles, parent_id) values (a, 'Cross', 1, bz);
  exception when others then get stacked diagnostics st1 = returned_sqlstate; end;
  begin
    update public.storage_locations set parent_id = bz where id = z;
  exception when others then get stacked diagnostics st2 = returned_sqlstate; end;
  insert into _t values ('T4', st1 = '23514' and st2 = '23514'
    and (select parent_id from public.storage_locations where id = z) is null
    and not exists (select 1 from public.storage_locations where zone = 'Cross' and restaurant_id = a),
    'insert ' || st1 || ', update ' || st2);
end $$;

-- T5 a cycle is refused: Cellar cannot go inside Shelf 2 (which is inside it)
do $$ declare c uuid := (select v from _fx where k = 'cellar'); s uuid := (select v from _fx where k = 'shelf'); st text; msg text; begin
  begin
    update public.storage_locations set parent_id = s where id = c;
    insert into _t values ('T5', false, 'cycle accepted');
  exception when others then get stacked diagnostics st = returned_sqlstate, msg = message_text;
    insert into _t values ('T5', st = '23514' and (select parent_id from public.storage_locations where id = c) is null,
      'refused with ' || st || ': ' || left(msg, 60));
  end;
end $$;

-- T6 a two-row cycle written in ONE statement is refused (the second row's
-- check sees the first row's new parent)
do $$ declare x uuid := (select v from _fx where k = 'x'); y uuid := (select v from _fx where k = 'y'); st text; begin
  begin
    update public.storage_locations
       set parent_id = case id when x then y when y then x end
     where id in (x, y);
    insert into _t values ('T6', false, 'two-row cycle accepted');
  exception when others then get stacked diagnostics st = returned_sqlstate;
    insert into _t values ('T6', st = '23514', 'refused with ' || st);
  end;
end $$;

-- T7 a soft-deleted zone cannot become a parent
do $$ declare a uuid := (select v from _fx where k = 'a'); gone uuid; z uuid := (select v from _fx where k = 'x'); st text; begin
  insert into public.storage_locations (restaurant_id, zone, capacity_bottles, deleted_at)
    values (a, 'Gone', 1, now()) returning id into gone;
  begin
    update public.storage_locations set parent_id = gone where id = z;
    insert into _t values ('T7', false, 'a deleted parent was accepted');
  exception when others then get stacked diagnostics st = returned_sqlstate;
    insert into _t values ('T7', st = '23514', 'refused with ' || st);
  end;
end $$;

-- T8 soft-deleting Rack A (the gateway's delete) makes Shelf 2 top-level and
-- leaves Cellar alone
do $$ declare r uuid := (select v from _fx where k = 'rack'); s uuid := (select v from _fx where k = 'shelf'); c uuid := (select v from _fx where k = 'cellar'); begin
  update public.storage_locations set deleted_at = now() where id = r;
  insert into _t values ('T8',
    (select parent_id from public.storage_locations where id = s) is null
    and exists (select 1 from public.storage_locations where id = s and deleted_at is null)
    and (select parent_id from public.storage_locations where id = r) = c,
    'shelf parent after soft delete: ' || coalesce((select parent_id::text from public.storage_locations where id = s), 'null'));
end $$;

-- T9 a hard delete of a parent makes its children top-level (ON DELETE SET NULL)
do $$ declare a uuid := (select v from _fx where k = 'a'); p uuid; ch uuid; begin
  insert into public.storage_locations (restaurant_id, zone, capacity_bottles) values (a, 'Bar', 20) returning id into p;
  insert into public.storage_locations (restaurant_id, zone, capacity_bottles, parent_id) values (a, 'Bar Fridge', 20, p) returning id into ch;
  delete from public.storage_locations where id = p;
  insert into _t values ('T9',
    exists (select 1 from public.storage_locations where id = ch and parent_id is null),
    'child kept, top-level');
end $$;

-- T10 a zone with zones inside it cannot move to another restaurant
do $$ declare c uuid := (select v from _fx where k = 'cellar'); b uuid := (select v from _fx where k = 'b');
          a uuid := (select v from _fx where k = 'a'); st text; begin
  begin
    update public.storage_locations set restaurant_id = b where id = c;
    insert into _t values ('T10', false, 'moved with its tree');
  exception when others then get stacked diagnostics st = returned_sqlstate;
    insert into _t values ('T10', st = '23514' and (select restaurant_id from public.storage_locations where id = c) = a,
      'refused with ' || st);
  end;
end $$;

-- T11 a legal move still works: X goes inside Cellar, then back to top level
do $$ declare c uuid := (select v from _fx where k = 'cellar'); z uuid := (select v from _fx where k = 'x'); ok1 boolean; begin
  update public.storage_locations set parent_id = c where id = z;
  ok1 := (select parent_id from public.storage_locations where id = z) = c;
  update public.storage_locations set parent_id = null where id = z;
  insert into _t values ('T11', ok1 and (select parent_id from public.storage_locations where id = z) is null, 'nest then clear');
end $$;

-- T12 RLS is still on for the table the column joined
insert into _t
select 'T12', (select relrowsecurity from pg_class where oid = 'public.storage_locations'::regclass), 'rls on';

select id, ok, detail from _t order by id;

rollback;

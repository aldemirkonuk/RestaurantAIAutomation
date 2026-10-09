-- F-457: account_delete_blockers names the records that would refuse
-- DELETE FROM public.users, before anything is written. Migration
-- an_account_is_deleted_whole_or_not_at_all.
--
-- Self-asserting: every block raises on a failure. Run it on a database built
-- from supabase/migrations. It must FAIL on a build without that migration
-- (T1: there is no such function) and PASS with it. One transaction, rolled
-- back: it leaves nothing behind.

begin;

insert into public.users (user_id, email, name)
values ('00000000-0000-4000-8000-0000000a0001', 'f457-clean@example.test', 'Clean'),
       ('00000000-0000-4000-8000-0000000a0002', 'f457-noted@example.test', 'Noted');

-- T1 a person nothing refuses: no rows, and the trial delete was undone.
do $$
declare
  n int;
begin
  select count(*) into n
    from public.account_delete_blockers('00000000-0000-4000-8000-0000000a0001');
  assert n = 0, format('T1 FAIL expected no blockers, got %s', n);
  assert exists (select 1 from public.users
                  where user_id = '00000000-0000-4000-8000-0000000a0001'),
    'T1 FAIL the trial delete was not rolled back; the person is gone';
end $$;

-- T2 a RESTRICT referrer holding rows is named, with its count, and the
-- person is still there.
do $$
declare
  r record;
begin
  -- Any RESTRICT referrer works; build one on a scratch table (rolled back
  -- with the rest) so the test does not depend on which rows exist.
  create table public.f457_note (
    id serial primary key,
    author uuid not null references public.users(user_id) on delete restrict
  );
  insert into public.f457_note (author)
  values ('00000000-0000-4000-8000-0000000a0002'),
         ('00000000-0000-4000-8000-0000000a0002');

  select * into r
    from public.account_delete_blockers('00000000-0000-4000-8000-0000000a0002')
   where table_name like '%f457_note';
  assert r.row_count = 2, format('T2 FAIL expected f457_note x2, got %s', r);
  assert r.column_name = 'author', format('T2 FAIL column %s', r.column_name);
  assert exists (select 1 from public.users
                  where user_id = '00000000-0000-4000-8000-0000000a0002'),
    'T2 FAIL the person is gone';
end $$;

-- T3 the house tables the sim hit are covered: a crew note author is a
-- blocker by the catalog, not by a list someone has to keep.
do $$
begin
  assert exists (
    select 1 from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
     where c.contype = 'f' and c.confrelid = 'public.users'::regclass
       and c.conrelid = 'public.team_notes'::regclass
       and a.attname = 'author_user_id' and c.confdeltype in ('r', 'a')),
    'T3 FAIL team_notes.author_user_id is no longer RESTRICT; re-read F-457';
end $$;

-- T3b a refusal one hop away -- a row the delete would cascade away, which
-- another table still points at with RESTRICT -- is caught by the trial
-- delete, and undone.
insert into public.users (user_id, email, name)
values ('00000000-0000-4000-8000-0000000a0003', 'f457-deep@example.test', 'Deep');
do $$
declare
  r record;
  n int;
begin
  create table public.f457_child (
    id int primary key,
    person uuid references public.users(user_id) on delete cascade
  );
  create table public.f457_grand (
    child_id int references public.f457_child(id) on delete restrict
  );
  insert into public.f457_child values (1, '00000000-0000-4000-8000-0000000a0003');
  insert into public.f457_grand values (1);

  select count(*) into n
    from public.account_delete_blockers('00000000-0000-4000-8000-0000000a0003');
  assert n = 1, format('T3b FAIL expected one deep blocker, got %s', n);
  select * into r
    from public.account_delete_blockers('00000000-0000-4000-8000-0000000a0003');
  assert r.table_name like '%f457_grand' and r.row_count is null,
    format('T3b FAIL expected f457_grand named, got %s', r);
  assert exists (select 1 from public.f457_child where id = 1),
    'T3b FAIL the trial delete left the cascaded row gone';
end $$;

-- T4 only the gateway may call it.
do $$
begin
  assert has_function_privilege('service_role', 'public.account_delete_blockers(uuid)', 'execute'),
    'T4 FAIL service_role cannot execute';
  assert not has_function_privilege('anon', 'public.account_delete_blockers(uuid)', 'execute'),
    'T4 FAIL anon can execute';
  assert not has_function_privilege('authenticated', 'public.account_delete_blockers(uuid)', 'execute'),
    'T4 FAIL authenticated can execute';
end $$;

rollback;

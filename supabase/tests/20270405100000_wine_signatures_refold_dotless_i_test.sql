-- QA round 10c (F4) on #832: runs public.refold_wine_signatures_dotless_i(),
-- the function migration 20270405100000 calls once, over seeded rows and
-- checks what it leaves. Seeded rows get the hash the code before the fold gave
-- them ("ı" read as a space); a row left on the folded hash plays one written
-- after the fold. Every block raises on failure; run with ON_ERROR_STOP
-- (pgtest.sh lane). One transaction, rolled back; names carry "Zq832".

begin;

insert into public.restaurant_directory (id, restaurant_name, city) values
  ('f8320000-0000-4000-8000-0000000000a1', 'Zq832 venue A', 'Antalya'),
  ('f8320000-0000-4000-8000-0000000000b2', 'Zq832 venue B', 'Antalya');

-- Pre-fold rows get their old hash before the next insert (UNIQUE index).
create function pg_temp.zq_prefold(p_wine_id text) returns void language sql as $f$
  update public.master_wine_library
     set signature_hash = public.wine_signature_hash(translate(producer, 'ı', ' '),
           translate(name, 'ı', ' '), vintage, translate(country, 'ı', ' '),
           translate(region, 'ı', ' '), translate(grape_variety, 'ı', ' '))
   where wine_id = p_wine_id;
$f$;

-- The headline pair: A1 stored before the fold, K1 written after it.
insert into public.master_wine_library (id, wine_id, name, producer, primary_type, country, created_at)
  values ('f8320000-0000-4000-8000-00000000a001', 'ZQ832-A1', 'Yakut', 'Kavaklıdere Zq832', 'red', 'Turkey', '2026-01-01');
select pg_temp.zq_prefold('ZQ832-A1');
insert into public.master_wine_library (id, wine_id, name, producer, primary_type, country, created_at)
  values ('f8320000-0000-4000-8000-00000000a002', 'ZQ832-K1', 'YAKUT', 'KAVAKLIDERE ZQ832', 'red', 'Turkey', '2026-11-07');
-- Two stored ı-rows that meet on one folded hash: the older takes it.
insert into public.master_wine_library (id, wine_id, name, producer, primary_type, country, created_at)
  values ('f8320000-0000-4000-8000-00000000b001', 'ZQ832-B1', 'Kıraz Karasi', 'Vinkara Zq832', 'red', 'Turkey', '2026-01-03');
select pg_temp.zq_prefold('ZQ832-B1');
insert into public.master_wine_library (id, wine_id, name, producer, primary_type, country, created_at)
  values ('f8320000-0000-4000-8000-00000000b002', 'ZQ832-B2', 'Kiraz Karası', 'Vinkara Zq832', 'red', 'Turkey', '2026-01-04');
select pg_temp.zq_prefold('ZQ832-B2');
-- R2 (older) folds onto the hash R1 holds before R1 itself moves: only a
-- second pass gives R2 its hash.
insert into public.master_wine_library (id, wine_id, name, producer, primary_type, country, created_at)
  values ('f8320000-0000-4000-8000-00000000c002', 'ZQ832-R2', 'Zqx ı', 'Sevilen Zq832', 'red', 'Turkey', '2026-01-05');
select pg_temp.zq_prefold('ZQ832-R2');
insert into public.master_wine_library (id, wine_id, name, producer, primary_type, country, created_at)
  values ('f8320000-0000-4000-8000-00000000c001', 'ZQ832-R1', 'Zqx ıi', 'Sevilen Zq832', 'red', 'Turkey', '2026-01-06');
select pg_temp.zq_prefold('ZQ832-R1');
-- Q1 moves; venue A already holds its folded hash on the roster.
insert into public.master_wine_library (id, wine_id, name, producer, primary_type, country, created_at)
  values ('f8320000-0000-4000-8000-00000000d001', 'ZQ832-Q1', 'Karası Özel', 'Doluca Zq832', 'red', 'Turkey', '2026-01-07');
select pg_temp.zq_prefold('ZQ832-Q1');
-- Out of scope: a NULL-hash ı-row, a soft-deleted ı-row, non-ı drift.
insert into public.master_wine_library (id, wine_id, name, producer, primary_type, country, created_at)
  values ('f8320000-0000-4000-8000-00000000e001', 'ZQ832-G1', 'Narince', 'Kavaklıdere Zq832', 'white', 'Turkey', '2026-01-08');
insert into public.master_wine_library (id, wine_id, name, producer, primary_type, country, created_at)
  values ('f8320000-0000-4000-8000-00000000e002', 'ZQ832-F1', 'Emir', 'Kavaklıdere Zq832', 'white', 'Turkey', '2026-01-09');
select pg_temp.zq_prefold('ZQ832-F1');
insert into public.master_wine_library (id, wine_id, name, producer, primary_type, country, created_at)
  values ('f8320000-0000-4000-8000-00000000e003', 'ZQ832-X1', 'Chablis', 'Domaine Laroche Zq832', 'white', 'France', '2026-01-10');

create temp table zq_old on commit drop as
select id, wine_id,
       public.wine_signature_hash(translate(producer, 'ı', ' '), translate(name, 'ı', ' '),
         vintage, translate(country, 'ı', ' '), translate(region, 'ı', ' '),
         translate(grape_variety, 'ı', ' ')) as old_hash,
       public.wine_signature_hash(producer, name, vintage, country, region,
         grape_variety) as new_hash
  from public.master_wine_library
 where wine_id like 'ZQ832-%';

update public.master_wine_library set signature_hash = null where wine_id = 'ZQ832-G1';
update public.master_wine_library set signature_hash = md5('zq832 corrupt') where wine_id = 'ZQ832-X1';
update public.master_wine_library set deleted_at = now() where wine_id = 'ZQ832-F1';

-- Copies of B1's and Q1's stored hash.
insert into public.master_wine_library_submissions (payload, signature_hash)
select '{"zq832": "B1"}'::jsonb, old_hash from zq_old where wine_id = 'ZQ832-B1';
insert into public.menu_changes (restaurant_id, wine_signature_hash, change_type)
select v, old_hash, 'added' from zq_old,
       unnest(array['f8320000-0000-4000-8000-0000000000a1'::uuid,
                    'f8320000-0000-4000-8000-0000000000b2'::uuid]) v
 where wine_id = 'ZQ832-B1';
insert into public.restaurant_wine_roster (restaurant_id, signature_hash, wine_name)
select 'f8320000-0000-4000-8000-0000000000b2', old_hash, 'Zq832 B1 roster' from zq_old where wine_id = 'ZQ832-B1';
insert into public.restaurant_wine_roster (restaurant_id, signature_hash, wine_name)
select 'f8320000-0000-4000-8000-0000000000a1', old_hash, 'Zq832 Q1 roster (old key)' from zq_old where wine_id = 'ZQ832-Q1';
insert into public.restaurant_wine_roster (restaurant_id, signature_hash, wine_name)
select 'f8320000-0000-4000-8000-0000000000a1', new_hash, 'Zq832 Q1 roster (new key)' from zq_old where wine_id = 'ZQ832-Q1';

-- T0 the seed is what the tests below assume.
do $$
declare o record;
begin
  for o in select * from zq_old where wine_id in ('ZQ832-A1','ZQ832-B1','ZQ832-B2','ZQ832-R1','ZQ832-R2','ZQ832-Q1') loop
    assert o.old_hash is distinct from o.new_hash, format('T0 FAIL %s has no pre-fold drift', o.wine_id);
  end loop;
  assert (select new_hash from zq_old where wine_id = 'ZQ832-R2') = (select old_hash from zq_old where wine_id = 'ZQ832-R1'),
    'T0 FAIL R2''s folded hash is not R1''s stored hash';
  assert (select new_hash from zq_old where wine_id = 'ZQ832-B1') = (select new_hash from zq_old where wine_id = 'ZQ832-B2'),
    'T0 FAIL B1 and B2 do not meet on one folded hash';
end $$;

create temp table zq_count on commit drop as
select count(*) filter (where deleted_at is null) as live, count(*) as total
  from public.master_wine_library where wine_id like 'ZQ832-%';

select public.refold_wine_signatures_dotless_i();

create temp view zq_now as
select m.wine_id, m.id, m.signature_hash h, o.old_hash, o.new_hash
  from public.master_wine_library m join zq_old o on o.id = m.id;

-- T1 why the Yakut pair stays two rows. Not the producer, the vintage or the
-- signature: they agree. A1 is held back because K1, already correct, holds
-- the folded hash, and joining two library rows is a merge decision.
do $$
declare a record; k record;
begin
  select * into a from public.master_wine_library where wine_id = 'ZQ832-A1';
  select * into k from public.master_wine_library where wine_id = 'ZQ832-K1';
  assert public.wine_normalize_text(a.producer) = public.wine_normalize_text(k.producer),
    'T1 FAIL the producers do not fold to one';
  assert a.vintage is not distinct from k.vintage, 'T1 FAIL the vintages differ';
  assert (select new_hash from zq_old where wine_id = 'ZQ832-A1') = k.signature_hash,
    'T1 FAIL A1''s folded signature is not K1''s';
  assert a.signature_hash = (select old_hash from zq_old where wine_id = 'ZQ832-A1'),
    'T1 FAIL A1 was rewritten onto a hash K1 holds';
  assert exists (select 1 from public.wine_signature_refold_review r
                  where r.table_name = 'master_wine_library' and r.row_id = a.id
                    and r.held_by = k.id and r.resolved_at is null),
    'T1 FAIL the A1/K1 pair is not in the review table';
end $$;

-- T2 merges nothing: same rows, none soft-deleted.
do $$
declare n_live bigint; n_total bigint;
begin
  select count(*) filter (where deleted_at is null), count(*) into n_live, n_total
    from public.master_wine_library where wine_id like 'ZQ832-%';
  assert n_live = (select live from zq_count) and n_total = (select total from zq_count),
    format('T2 FAIL library rows changed: %s live / %s total', n_live, n_total);
end $$;

-- T3 oldest first: B1 (older) takes the folded hash, B2 is held by B1.
do $$
begin
  assert (select h = new_hash from zq_now where wine_id = 'ZQ832-B1'), 'T3 FAIL B1 (older) did not take the folded hash';
  assert (select h = old_hash from zq_now where wine_id = 'ZQ832-B2'), 'T3 FAIL B2 (younger) was moved';
  assert exists (select 1 from public.wine_signature_refold_review r
                  join zq_now b2 on b2.id = r.row_id and b2.wine_id = 'ZQ832-B2'
                  join zq_now b1 on b1.id = r.held_by and b1.wine_id = 'ZQ832-B1'),
    'T3 FAIL B2 is not recorded as held by B1';
end $$;

-- T4 repeat until nothing moves: R2 gets its hash once R1 has left it.
do $$
begin
  assert (select h = new_hash from zq_now where wine_id = 'ZQ832-R1'), 'T4 FAIL R1 did not move';
  assert (select h = new_hash from zq_now where wine_id = 'ZQ832-R2'), 'T4 FAIL R2 kept its old hash (one pass only?)';
end $$;

-- T5 copies follow a row that moves: submission, both menu_changes, roster.
do $$
declare b1 record;
begin
  select * into b1 from zq_now where wine_id = 'ZQ832-B1';
  assert (select count(*) from public.master_wine_library_submissions where payload->>'zq832' = 'B1' and signature_hash = b1.new_hash) = 1,
    'T5 FAIL B1''s submission did not follow it';
  assert (select count(*) from public.menu_changes where wine_signature_hash = b1.old_hash) = 0
     and (select count(*) from public.menu_changes where wine_signature_hash = b1.new_hash
            and restaurant_id in ('f8320000-0000-4000-8000-0000000000a1', 'f8320000-0000-4000-8000-0000000000b2')) = 2,
    'T5 FAIL B1''s menu_changes did not follow it';
  assert (select signature_hash from public.restaurant_wine_roster where wine_name = 'Zq832 B1 roster') = b1.new_hash,
    'T5 FAIL B1''s roster copy did not follow it';
end $$;

-- T6 a roster row whose venue already holds the folded hash is kept and recorded.
do $$
declare q1 record;
begin
  select * into q1 from zq_now where wine_id = 'ZQ832-Q1';
  assert q1.h = q1.new_hash, 'T6 FAIL Q1 did not move';
  assert (select signature_hash from public.restaurant_wine_roster where wine_name = 'Zq832 Q1 roster (old key)') = q1.old_hash,
    'T6 FAIL the venue''s old-key roster row was moved onto a hash it already holds';
  assert exists (select 1 from public.wine_signature_refold_review r
                   join public.restaurant_wine_roster w on w.id = r.row_id
                  where r.table_name = 'restaurant_wine_roster' and w.wine_name = 'Zq832 Q1 roster (old key)'
                    and r.folded_hash = q1.new_hash),
    'T6 FAIL the kept roster row is not in the review table';
end $$;

-- T7 out of scope stays put: NULL hash, soft-deleted, non-ı drift.
do $$
begin
  assert (select signature_hash from public.master_wine_library where wine_id = 'ZQ832-G1') is null, 'T7 FAIL a NULL-hash ı-row was given a hash';
  assert (select h = old_hash from zq_now where wine_id = 'ZQ832-F1'), 'T7 FAIL a soft-deleted ı-row was moved';
  assert (select signature_hash from public.master_wine_library where wine_id = 'ZQ832-X1') = md5('zq832 corrupt'), 'T7 FAIL drift with no ı was rewritten';
end $$;

-- T8 a second run moves nothing of these rows and adds no review row.
create temp table zq_snap on commit drop as
select (select string_agg(wine_id || '=' || coalesce(h, 'null'), ',' order by wine_id) from zq_now)
       || '|' || (select count(*) from public.wine_signature_refold_review r
                   where r.row_id in (select id from zq_now)
                      or r.row_id in (select id from public.restaurant_wine_roster where wine_name like 'Zq832%')) as s;
select public.refold_wine_signatures_dotless_i();
do $$
begin
  assert (select s from zq_snap) =
         (select string_agg(wine_id || '=' || coalesce(h, 'null'), ',' order by wine_id) from zq_now)
         || '|' || (select count(*) from public.wine_signature_refold_review r
                     where r.row_id in (select id from zq_now)
                        or r.row_id in (select id from public.restaurant_wine_roster where wine_name like 'Zq832%')),
    'T8 FAIL a second run changed the rows or the review table';
end $$;

-- T9 the review table and the function are closed to browsers.
do $$
begin
  assert not has_table_privilege('authenticated', 'public.wine_signature_refold_review', 'SELECT'), 'T9 FAIL authenticated can read the review table';
  assert not has_table_privilege('anon', 'public.wine_signature_refold_review', 'SELECT'), 'T9 FAIL anon can read the review table';
  assert not has_function_privilege('authenticated', 'public.refold_wine_signatures_dotless_i()', 'EXECUTE'), 'T9 FAIL authenticated can run the refold';
  assert not has_function_privilege('anon', 'public.refold_wine_signatures_dotless_i()', 'EXECUTE'), 'T9 FAIL anon can run the refold';
end $$;

rollback;

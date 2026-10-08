-- F-006 (owner-quarter sim, 2026-10-02): a street-address Place ID of 128
-- characters failed house creation on /get-started with "value too long for
-- type character varying(100)". Migration
-- a_google_place_id_is_as_long_as_google_makes_it makes
-- restaurants.google_place_id `text`, bounded to 2048 BYTES by the CHECK
-- restaurants_google_place_id_length so a value always fits the partial
-- unique index (a btree entry over 2704 bytes fails with 54000).
--
-- Self-asserting: every block raises on a failure (assert -> P0004, or the
-- error itself), so `psql -v ON_ERROR_STOP=1 -f` or the PGlite harness stops
-- at the first one. Run it on a database built from supabase/migrations. It
-- must FAIL on a build without that migration (T1: the column is still
-- character varying(100)) and PASS with it. One transaction, rolled back: it
-- leaves nothing behind.

begin;

-- T1 the column is text.
do $$
declare
  t text;
begin
  select format_type(a.atttypid, a.atttypmod) into t
    from pg_attribute a
   where a.attrelid = 'public.restaurants'::regclass
     and a.attname = 'google_place_id' and not a.attisdropped;
  assert t = 'text', format('T1 FAIL google_place_id is %s, expected text', coalesce(t, 'absent'));
end $$;

-- T2 the bound is a validated CHECK in BYTES at 2048, and the unique index is
-- still there and still partial on not null.
do $$
declare
  def text;
  idx text;
begin
  select pg_get_constraintdef(c.oid) into def
    from pg_constraint c
   where c.conrelid = 'public.restaurants'::regclass
     and c.conname = 'restaurants_google_place_id_length'
     and c.contype = 'c' and c.convalidated;
  assert def is not null, 'T2 FAIL restaurants_google_place_id_length is missing or not validated';
  assert def ~ 'octet_length\(google_place_id\) <= 2048',
    format('T2 FAIL the bound is not octet_length <= 2048: %s', def);
  select pg_get_indexdef(i.indexrelid) into idx
    from pg_index i
   where i.indexrelid = to_regclass('public.idx_restaurants_google_place_id')
     and i.indisunique;
  assert idx ~ 'WHERE \(google_place_id IS NOT NULL\)',
    format('T2 FAIL the unique index is missing, not unique, or not partial: %s', coalesce(idx, 'absent'));
end $$;

-- T3 the measured case: a 128-character id (what F-006 sent) is stored whole.
-- Every id below is random per run, so a populated database cannot collide.
do $$
declare
  pid text := 'Ei' || left((select string_agg(replace(gen_random_uuid()::text, '-', ''), '') from generate_series(1, 4)), 126);
  n integer;
begin
  assert char_length(pid) = 128, 'T3 setup: id is not 128 characters';
  insert into public.restaurants (id, name, slug, google_place_id)
  values ('f0060000-0000-4000-8000-000000000001', 'F006 house 128', 'f006-house-128', pid);
  select count(*) into n from public.restaurants
   where id = 'f0060000-0000-4000-8000-000000000001' and google_place_id = pid;
  assert n = 1, 'T3 FAIL a 128-character id was not stored whole';
end $$;

-- T4 the edge: a 2048-byte id is admitted AND fits the unique index. Hex from
-- uuids, so pglz cannot shrink it below the limit it is meant to test.
do $$
declare
  pid text := (select string_agg(replace(gen_random_uuid()::text, '-', ''), '') from generate_series(1, 64));
begin
  assert octet_length(pid) = 2048, 'T4 setup: id is not 2048 bytes';
  insert into public.restaurants (id, name, slug, google_place_id)
  values ('f0060000-0000-4000-8000-000000000002', 'F006 house 2048', 'f006-house-2048', pid);
end $$;

-- T5 one byte past the bound: refused by the CHECK (23514), not by the index.
do $$
declare
  pid text := (select string_agg(replace(gen_random_uuid()::text, '-', ''), '') from generate_series(1, 64)) || 'z';
  con text;
begin
  assert octet_length(pid) = 2049, 'T5 setup: id is not 2049 bytes';
  begin
    insert into public.restaurants (id, name, slug, google_place_id)
    values ('f0060000-0000-4000-8000-000000000003', 'F006 house 2049', 'f006-house-2049', pid);
    raise exception 'T5 FAIL a 2049-byte id was stored';
  exception when check_violation then
    get stacked diagnostics con = constraint_name;
    assert con = 'restaurants_google_place_id_length',
      format('T5 FAIL refused by %s, expected restaurants_google_place_id_length', con);
  end;
end $$;

-- T6 multibyte: the bound counts bytes. 1008 two-byte characters plus 32
-- ASCII (2048 bytes, 1040 characters) are admitted; 683 three-byte characters
-- (2049 bytes, only 683 characters) are refused by the CHECK, which a
-- character bound would have let through.
do $$
declare
  ok_id text := repeat('ğ', 1008) || replace(gen_random_uuid()::text, '-', '');
  bad_id text := repeat('€', 683);
  con text;
begin
  assert octet_length(ok_id) = 2048 and char_length(ok_id) = 1040, 'T6 setup: ok_id is not 2048 bytes';
  assert octet_length(bad_id) = 2049 and char_length(bad_id) = 683, 'T6 setup: bad_id is not 2049 bytes';
  insert into public.restaurants (id, name, slug, google_place_id)
  values ('f0060000-0000-4000-8000-000000000004', 'F006 house mb ok', 'f006-house-mb-ok', ok_id);
  begin
    insert into public.restaurants (id, name, slug, google_place_id)
    values ('f0060000-0000-4000-8000-000000000005', 'F006 house mb bad', 'f006-house-mb-bad', bad_id);
    raise exception 'T6 FAIL a 2049-byte multibyte id of 683 characters was stored';
  exception when check_violation then
    get stacked diagnostics con = constraint_name;
    assert con = 'restaurants_google_place_id_length',
      format('T6 FAIL refused by %s, expected restaurants_google_place_id_length', con);
  end;
end $$;

-- T7 unchanged: a second house claiming the same place is refused 23505 by
-- the unique index.
do $$
declare
  pid text;
  con text;
begin
  select google_place_id into pid from public.restaurants
   where id = 'f0060000-0000-4000-8000-000000000001';
  begin
    insert into public.restaurants (id, name, slug, google_place_id)
    values ('f0060000-0000-4000-8000-000000000006', 'F006 house dup', 'f006-house-dup', pid);
    raise exception 'T7 FAIL a duplicate place id was stored';
  exception when unique_violation then
    get stacked diagnostics con = constraint_name;
    assert con = 'idx_restaurants_google_place_id',
      format('T7 FAIL refused by %s, expected idx_restaurants_google_place_id', con);
  end;
end $$;

-- T8 unchanged: no place id at all is still allowed, for more than one house.
do $$
declare
  n integer;
begin
  insert into public.restaurants (id, name, slug, google_place_id) values
    ('f0060000-0000-4000-8000-000000000007', 'F006 house null a', 'f006-house-null-a', null),
    ('f0060000-0000-4000-8000-000000000008', 'F006 house null b', 'f006-house-null-b', null);
  select count(*) into n from public.restaurants
   where id in ('f0060000-0000-4000-8000-000000000007', 'f0060000-0000-4000-8000-000000000008')
     and google_place_id is null;
  assert n = 2, 'T8 FAIL two houses without a place id were not both stored';
end $$;

rollback;

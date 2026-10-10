-- F-356 (owner-quarter sim, wave 6): "Kalecik Karası" and "KALECIK KARASI"
-- were two wines, because wine_normalize_text turned the dotless ı into a
-- space. Migration the_signature_folds_dotless_i folds ı/İ to i and
-- recomputes the stored keys that change, leaving a row unchanged when its
-- folded key would collide with another row.
--
-- Self-asserting: every block raises on a failure, so `psql -v ON_ERROR_STOP=1`
-- stops at the first one. It must FAIL on a build without the migration (T1:
-- the ı is still split off) and PASS with it. One transaction, rolled back.

begin;

-- T1 the function folds ı and İ, so the Turkish, capitalised and ASCII
-- spellings meet.
do $$
begin
  assert public.wine_normalize_text('Kalecik Karası') = 'kalecik karasi',
    format('T1 FAIL Kalecik Karası -> %s', public.wine_normalize_text('Kalecik Karası'));
  assert public.wine_normalize_text('KALECIK KARASI') = 'kalecik karasi', 'T1 FAIL capitals';
  assert public.wine_normalize_text('Kavaklıdere') = 'kavaklidere',
    format('T1 FAIL Kavaklıdere -> %s', public.wine_normalize_text('Kavaklıdere'));
  assert public.wine_normalize_text('İZMİR Öküzgözü') = 'izmir okuzgozu', 'T1 FAIL İ';
  assert public.wine_signature_hash('Kavaklıdere', 'Kalecik Karası', 2021, 'Türkiye', NULL, NULL)
       = public.wine_signature_hash('KAVAKLIDERE', 'KALECIK KARASI', 2021, 'TURKIYE', NULL, NULL),
    'T1 FAIL the two spellings still hash apart';
end $$;

-- Rows seeded in the state the old function left them: the trigger writes the
-- new keys on insert, so each Turkish row is pushed back to the old keys (ı as
-- a separator). Updating only derived columns does not fire the trigger.
create temp table seed (tag text primary key, id uuid) on commit drop;

do $$
declare
  v uuid;
  r record;
begin
  for r in select * from (values
    -- A: alone; its new key is free, so it is recomputed.
    ('A', 'tw-a', 'Kavaklıdere', 'Kalecik Karası', 2019, false),
    -- C: same wine as B in Turkish spelling; its new key is B's. Kept.
    -- Seeded before B, since inserting it computes that key.
    ('C', 'tw-c', 'Kavaklıdere', 'Kalecik Karası', 2021, false),
    -- B: already stored in the folded spelling, with no ı at all.
    ('B', 'tw-b', 'KAVAKLIDERE', 'KALECIK KARASI', 2021, false),
    -- D and E: two Turkish rows whose old keys differ but fold to one. Kept.
    ('D', 'tw-d', 'Sarıca', 'Sarı Karası', 2020, false),
    ('E', 'tw-e', 'Sarıca', 'Sari Karası', 2020, false),
    -- F: Turkish, but its stored hash had already drifted to NULL; the hash
    -- stays for fn_repair_signature_hashes, the names are recomputed.
    ('F', 'tw-f', 'Pamukkale', 'Anfora Boğazkere Kalecik Karası', 2018, true),
    -- G and H trade places: G's folded key ('ki ra') is H's old key, and H
    -- moves off it ('kiira'). Both are recomputed; neither blocks the other.
    ('G', 'tw-g', 'Ova', 'Kı ra', 2017, false),
    ('H', 'tw-h', 'Ova', 'Kiıra', 2017, false)
  ) t(tag, wine_id, producer, name, vintage, drifted)
  loop
    insert into public.master_wine_library (wine_id, name, producer, vintage, primary_type, country)
    values (r.wine_id, r.name, r.producer, r.vintage, 'red', 'Türkiye')
    returning id into v;
    insert into seed values (r.tag, v);
    if r.tag <> 'B' then
      update public.master_wine_library m
         set normalized_name     = public.wine_normalize_text(replace(m.name, 'ı', ' ')),
             normalized_producer = public.wine_normalize_text(replace(m.producer, 'ı', ' ')),
             signature_hash = case when r.drifted then null else public.wine_signature_hash(
               replace(m.producer, 'ı', ' '), replace(m.name, 'ı', ' '), m.vintage,
               replace(m.country, 'ı', ' '), replace(m.region, 'ı', ' '),
               replace(m.grape_variety, 'ı', ' ')) end
       where m.id = v;
    end if;
  end loop;
end $$;

create temp table before_fold on commit drop as
select s.tag, m.normalized_name, m.normalized_producer, m.signature_hash
  from seed s join public.master_wine_library m on m.id = s.id;

-- T2 the recompute reports what it did: A, F, G, H recomputed, C/D/E kept.
do $$
declare
  r record;
begin
  select * into r from public.wine_refold_dotless_i();
  assert r.recomputed = 4, format('T2 FAIL recomputed %s, expected 4 (A, F, G, H)', r.recomputed);
  assert r.kept_for_collision = 3, format('T2 FAIL kept %s, expected 3 (C, D, E)', r.kept_for_collision);
end $$;

-- T3 A now carries the folded keys and the hash its spelling computes.
do $$
declare
  m record;
begin
  select x.* into m from public.master_wine_library x join seed s on s.id = x.id where s.tag = 'A';
  assert m.normalized_name = 'kalecik karasi', format('T3 FAIL A name %s', m.normalized_name);
  assert m.normalized_producer = 'kavaklidere', format('T3 FAIL A producer %s', m.normalized_producer);
  assert m.signature_hash = public.wine_signature_hash(m.producer, m.name, m.vintage, m.country, m.region, m.grape_variety),
    'T3 FAIL A hash is not the folded hash';
end $$;

-- T4 the collision rule: B, C, D and E are exactly as they were. Nothing
-- merged, nothing deleted.
do $$
declare
  n integer;
begin
  select count(*) into n
    from before_fold b join seed s using (tag) join public.master_wine_library m on m.id = s.id
   where b.tag in ('B', 'C', 'D', 'E')
     and m.normalized_name is not distinct from b.normalized_name
     and m.normalized_producer is not distinct from b.normalized_producer
     and m.signature_hash is not distinct from b.signature_hash
     and m.deleted_at is null;
  assert n = 4, format('T4 FAIL %s of B/C/D/E left unchanged and live, expected 4', n);
  assert (select normalized_name from public.master_wine_library x join seed s on s.id = x.id where s.tag = 'C') = 'kalecik karas',
    'T4 FAIL C was not seeded in the old state';
end $$;

-- T5 F: names folded, the drifted NULL hash left alone.
do $$
declare
  m record;
begin
  select x.* into m from public.master_wine_library x join seed s on s.id = x.id where s.tag = 'F';
  assert m.normalized_name = 'anfora bogazkere kalecik karasi', format('T5 FAIL F name %s', m.normalized_name);
  assert m.signature_hash is null, 'T5 FAIL F drifted hash was rewritten';
end $$;

-- T5b G took the key H left, and both carry their own folded hash.
do $$
declare
  m record;
  n integer := 0;
begin
  assert (select signature_hash from before_fold where tag = 'H')
       = (select x.signature_hash from public.master_wine_library x join seed s on s.id = x.id where s.tag = 'G'),
    'T5b FAIL G does not hold the key H held before the fold';
  for m in select x.* from public.master_wine_library x join seed s on s.id = x.id where s.tag in ('G', 'H') loop
    assert m.signature_hash = public.wine_signature_hash(m.producer, m.name, m.vintage, m.country, m.region, m.grape_variety),
      format('T5b FAIL %s hash is not its folded hash', m.name);
    n := n + 1;
  end loop;
  assert n = 2, 'T5b FAIL G and H are not both present';
end $$;

-- T6 a second run finds nothing left to move, and the keeps are stable.
do $$
declare
  r record;
begin
  select * into r from public.wine_refold_dotless_i();
  assert r.recomputed = 0, format('T6 FAIL second run recomputed %s', r.recomputed);
  assert r.kept_for_collision = 3, format('T6 FAIL second run kept %s', r.kept_for_collision);
end $$;

-- T7 the repair function is not callable from the API roles.
do $$
begin
  assert not has_function_privilege('anon', 'public.wine_refold_dotless_i()', 'execute'), 'T7 FAIL anon can execute';
  assert not has_function_privilege('authenticated', 'public.wine_refold_dotless_i()', 'execute'), 'T7 FAIL authenticated can execute';
end $$;

rollback;

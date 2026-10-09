-- F-373 (owner-quarter sim, wave 6): "Kalecik Karası" and "KALECIK KARASI"
-- carried two beverages identity keys, because beverage_normalize_text kept
-- the dotless ı and beverage_tokenize split the word on it. Migration
-- identity_keys_fold_dotless_i folds ı/İ to i and recomputes the stored keys
-- that change, leaving a row unchanged when its folded key would equal
-- another row's.
--
-- Self-asserting: every block raises on a failure, so `psql -v ON_ERROR_STOP=1`
-- stops at the first one. It must FAIL on a build without the migration (T1:
-- the ı is still split off) and PASS with it. One transaction, rolled back.

begin;

-- T1 the function folds ı and İ, so the Turkish, capitalised and ASCII
-- spellings share one key.
do $$
begin
  assert public.beverage_normalize_text('Kavaklıdere') = 'kavaklidere',
    format('T1 FAIL Kavaklıdere -> %s', public.beverage_normalize_text('Kavaklıdere'));
  assert public.beverage_normalize_text('İZMİR Öküzgözü') = 'izmir okuzgozu', 'T1 FAIL İ';
  assert public.beverage_identity_key('Kavaklıdere', 'Kalecik Karası')
       = public.beverage_identity_key('KAVAKLIDERE', 'KALECIK KARASI'),
    format('T1 FAIL the two spellings still key apart: %s',
           public.beverage_identity_key('Kavaklıdere', 'Kalecik Karası'));
end $$;

-- Rows seeded in the state the old function left them: the trigger writes the
-- new key on insert, so with it switched off each Turkish row is pushed back to
-- its old key (ı as a separator).
create temp table seed (tag text primary key, id uuid) on commit drop;

do $$
declare
  v uuid;
  r record;
begin
  for r in select * from (values
    -- A: alone; its new key is free, so it is recomputed.
    ('A', 'Kavaklıdere', 'Kalecik Karası', false),
    -- C: same bottle as B in Turkish spelling; its new key is B's. Kept.
    ('C', 'Kavaklıdere', 'Kalecik Karası Prestige', false),
    -- B: already stored in the folded spelling, with no ı at all.
    ('B', 'KAVAKLIDERE', 'KALECIK KARASI PRESTIGE', false),
    -- D and E: two Turkish rows whose old keys differ but fold to one. Kept.
    ('D', 'Sarıca', 'Sarı Karası', false),
    ('E', 'Sarıca', 'Sari Karası', false),
    -- F: Turkish, but its stored key had already drifted to NULL; left alone.
    ('F', 'Pamukkale', 'Anfora Boğazkere', true),
    -- G and H trade places: G's folded key ('ova||ki ra') is H's old key, and
    -- H moves off it ('ova||kiira'). Both are recomputed.
    ('G', 'Ova', 'Kı ra', false),
    ('H', 'Ova', 'Kiıra', false)
  ) t(tag, producer, name, drifted)
  loop
    insert into public.beverages (id, producer, name) values (gen_random_uuid(), r.producer, r.name)
    returning id into v;
    insert into seed values (r.tag, v);
  end loop;

  alter table public.beverages disable trigger trg_beverage_identity;
  update public.beverages b
     set identity_key = case when s.tag = 'F' then null
                        else public.beverage_identity_key(replace(b.producer, 'ı', ' '),
                                                          replace(b.name, 'ı', ' ')) end
    from seed s
   where b.id = s.id and s.tag <> 'B';
  alter table public.beverages enable trigger trg_beverage_identity;
end $$;

create temp table before_fold on commit drop as
select s.tag, b.identity_key
  from seed s join public.beverages b on b.id = s.id;

-- T2 the recompute reports what it did: A, G, H recomputed, C/D/E kept.
do $$
declare
  r record;
begin
  select * into r from public.beverage_refold_dotless_i();
  assert r.recomputed = 3, format('T2 FAIL recomputed %s, expected 3 (A, G, H)', r.recomputed);
  assert r.kept_for_collision = 3, format('T2 FAIL kept %s, expected 3 (C, D, E)', r.kept_for_collision);
end $$;

-- T3 A now carries the folded key, the one its capitalised spelling computes.
do $$
declare
  k text;
begin
  select b.identity_key into k from public.beverages b join seed s on s.id = b.id where s.tag = 'A';
  assert k = public.beverage_identity_key('KAVAKLIDERE', 'KALECIK KARASI'),
    format('T3 FAIL A key %s', k);
end $$;

-- T4 the collision rule: B, C, D and E are exactly as they were, F's drifted
-- key stays NULL. Nothing merged, nothing deleted.
do $$
declare
  n integer;
begin
  select count(*) into n
    from before_fold f join seed s using (tag) join public.beverages b on b.id = s.id
   where f.tag in ('B', 'C', 'D', 'E', 'F')
     and b.identity_key is not distinct from f.identity_key
     and b.deleted_at is null;
  assert n = 5, format('T4 FAIL %s of B/C/D/E/F left unchanged and live, expected 5', n);
  assert (select identity_key from before_fold where tag = 'C') = 'kavakl dere||kalecik karas prestige',
    format('T4 FAIL C was not seeded in the old state: %s', (select identity_key from before_fold where tag = 'C'));
end $$;

-- T5 G took the key H left, and both carry their own folded key.
do $$
declare
  m record;
  n integer := 0;
begin
  assert (select identity_key from before_fold where tag = 'H')
       = (select b.identity_key from public.beverages b join seed s on s.id = b.id where s.tag = 'G'),
    'T5 FAIL G does not hold the key H held before the fold';
  for m in select b.* from public.beverages b join seed s on s.id = b.id where s.tag in ('G', 'H') loop
    assert m.identity_key = public.beverage_identity_key(m.producer, m.name),
      format('T5 FAIL %s key is not its folded key', m.name);
    n := n + 1;
  end loop;
  assert n = 2, 'T5 FAIL G and H are not both present';
end $$;

-- T6 a second run finds nothing left to move, and the keeps are stable.
do $$
declare
  r record;
begin
  select * into r from public.beverage_refold_dotless_i();
  assert r.recomputed = 0, format('T6 FAIL second run recomputed %s', r.recomputed);
  assert r.kept_for_collision = 3, format('T6 FAIL second run kept %s', r.kept_for_collision);
end $$;

-- T7 the repair function is not callable from the API roles.
do $$
begin
  assert not has_function_privilege('anon', 'public.beverage_refold_dotless_i()', 'execute'), 'T7 FAIL anon can execute';
  assert not has_function_privilege('authenticated', 'public.beverage_refold_dotless_i()', 'execute'), 'T7 FAIL authenticated can execute';
end $$;

rollback;

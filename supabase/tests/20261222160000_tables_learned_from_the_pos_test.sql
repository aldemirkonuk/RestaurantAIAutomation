-- AW25 + AW30 (analytics walk, 2026-10-03; A-051, A-055): a house whose till
-- names its tables had no restaurant_tables row, so every check stayed
-- unattributed and the till's word was lost inside `raw`. Migration
-- tables_learned_from_the_pos (ADR 0303) reads the word out of `raw` into
-- pos_checks.table_ref (so pos-hub writes no new column), learns a table the
-- first time the till names it with a word that has a digit in it (founder,
-- 2026-10-05: "Only words with a number"), re-links past checks when a table
-- is added or changed, and backfills history. Words with no digit ('booth',
-- 'Ayla') keep their table_ref and make no table: T21-T23. A renamed or
-- re-mapped table keeps every till spelling it was linked by and its old
-- label, so a rename never makes a twin table, and a past check never moves
-- (founder, 2026-10-05, "Keep every spelling"): T24-T29.
--
-- Self-asserting: every block raises on a failure (assert -> P0004, or a
-- RAISE naming the test), so `psql -v ON_ERROR_STOP=1 -f` stops at the first
-- one. Run it on a database built from supabase/migrations. Synthetic fixtures
-- only, one transaction, rolled back.
--
-- On a build WITHOUT that migration every block fails: each one reads
-- pos_checks.table_ref, restaurant_tables.learned_at/hidden_at, or a function
-- the migration adds (T1 is the first to stop the file).

begin;

-- One house. tl_check stores a csv_import check (or the given source) with a
-- till word and returns the table it landed on.
create function pg_temp.tl_house() returns uuid language sql immutable as $$
  select 'a0303000-0000-4000-8000-000000000001'::uuid
$$;
create function pg_temp.tl_check(p_ext text, p_ref text, p_source text default 'csv_import')
returns uuid language sql as $$
  insert into public.pos_checks (restaurant_id, source, external_check_id, opened_at, table_ref)
  values (pg_temp.tl_house(), p_source, p_ext, now(), p_ref)
  returning table_id
$$;
create function pg_temp.tl_link(p_ext text) returns uuid language sql as $$
  select table_id from public.pos_checks
   where restaurant_id = pg_temp.tl_house() and external_check_id = p_ext
$$;
create function pg_temp.tl_tables(p_word text default null) returns bigint language sql as $$
  select count(*) from public.restaurant_tables
   where restaurant_id = pg_temp.tl_house()
     and (p_word is null or lower(label) = lower(p_word))
$$;
create function pg_temp.tl_id(p_label text) returns uuid language sql as $$
  select id from public.restaurant_tables
   where restaurant_id = pg_temp.tl_house() and label = p_label
$$;
-- History as it was before this migration: a row stored with no trigger run.
create function pg_temp.tl_history(p_ext text, p_ref text, p_raw jsonb default null, p_source text default 'csv_import')
returns void language plpgsql as $$
begin
  perform set_config('session_replication_role', 'replica', true);
  insert into public.pos_checks (restaurant_id, source, external_check_id, opened_at, table_ref, raw)
  values (pg_temp.tl_house(), p_source, p_ext, now() - interval '30 days', p_ref, p_raw);
  perform set_config('session_replication_role', 'origin', true);
end $$;

do $$
declare
  h uuid := pg_temp.tl_house();
begin
  insert into public.restaurants (id, name, slug) values (h, 'ADR 0303 test house', 'adr-0303-test-house');
  -- Hand-added tables (learned_at NULL), as POST /analytics/tables writes them.
  insert into public.restaurant_tables (restaurant_id, label, seats, created_at) values
    (h, '5', 4, now() - interval '9 days'),
    (h, 'b2', 2, now() - interval '9 days'),
    (h, 'T12', 4, now() - interval '9 days');
  insert into public.restaurant_tables (restaurant_id, label, seats, hidden_at) values (h, 'H1', 2, now());
  insert into public.restaurant_tables (restaurant_id, label, seats, is_active) values (h, 'Bar 9', 6, false);
  insert into public.restaurant_tables (restaurant_id, label, seats, pos_refs) values
    (h, 'Alpha', 4, '{"csv_import": "P1"}'), (h, 'Beta', 4, '{}');
end $$;

-- T1: the columns, the nullable answers, the index, and invoker functions.
do $$
begin
  assert exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'pos_checks' and column_name = 'table_ref'),
    'T1 FAIL: pos_checks.table_ref is missing';
  assert (select count(*) from information_schema.columns
           where table_schema = 'public' and table_name = 'restaurant_tables'
             and column_name in ('learned_at', 'hidden_at')) = 2,
    'T1 FAIL: restaurant_tables.learned_at / hidden_at are missing';
  assert (select count(*) from information_schema.columns
           where table_schema = 'public' and table_name = 'restaurant_tables' and is_nullable = 'NO'
             and ((column_name = 'till_words' and data_type = 'jsonb' and column_default like '''{}''::jsonb%')
               or (column_name = 'former_labels' and data_type = 'ARRAY' and column_default like '''{}''::text[]%'))) = 2,
    'T1 FAIL: restaurant_tables.till_words / former_labels are missing, nullable, or without an empty default';
  assert (select is_nullable from information_schema.columns
           where table_schema = 'public' and table_name = 'restaurant_tables' and column_name = 'seats') = 'YES',
    'T1 FAIL: restaurant_tables.seats is still NOT NULL';
  assert (select is_nullable from information_schema.columns
           where table_schema = 'public' and table_name = 'restaurant_tables' and column_name = 'is_outdoor') = 'YES',
    'T1 FAIL: restaurant_tables.is_outdoor is still NOT NULL';
  assert exists (select 1 from pg_indexes
                  where schemaname = 'public' and indexname = 'idx_pos_checks_unlinked_ref'
                    and indexdef like '%WHERE ((table_id IS NULL) AND (table_ref IS NOT NULL))%'),
    'T1 FAIL: the partial index idx_pos_checks_unlinked_ref is missing or unscoped';
  assert not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                      where n.nspname = 'public' and p.prosecdef
                        and p.proname in ('pos_table_ref_from_raw', 'pos_table_for_ref',
                                          'pos_checks_find_or_learn_table',
                                          'restaurant_tables_keep_till_names',
                                          'restaurant_tables_relink_checks')),
    'T1 FAIL: an ADR 0303 function is SECURITY DEFINER';
end $$;

-- T2: the till's first T7 learns one table, with no answer invented.
do $$
declare
  v uuid;
  t record;
begin
  v := pg_temp.tl_check('c2', 'T7');
  assert pg_temp.tl_tables('T7') = 1, 'T2 FAIL: T7 was not learned exactly once';
  select * into t from public.restaurant_tables where id = pg_temp.tl_id('T7');
  assert t.seats is null, 'T2 FAIL: a learned table carries seats = ' || coalesce(t.seats::text, '?');
  assert t.is_outdoor is null, 'T2 FAIL: a learned table carries is_outdoor = ' || coalesce(t.is_outdoor::text, '?');
  assert t.learned_at is not null, 'T2 FAIL: learned_at is not set';
  assert t.hidden_at is null, 'T2 FAIL: a learned table starts hidden';
  assert t.pos_refs ->> 'csv_import' = 'T7', 'T2 FAIL: pos_refs = ' || t.pos_refs::text;
  assert v = t.id, 'T2 FAIL: the check is not linked to the learned table';
end $$;

-- T3: the same word, spaced and lower-cased, links to the same table.
do $$
begin
  assert pg_temp.tl_check('c3', ' t7 ') = pg_temp.tl_id('T7'), 'T3 FAIL: " t7 " did not link to T7';
  assert pg_temp.tl_tables('t7') = 1, 'T3 FAIL: " t7 " learned a second table';
end $$;

-- T4: "table 5" and "B2" find the hand-added "5" and "b2"; nothing is learned.
do $$
declare
  n bigint := pg_temp.tl_tables();
begin
  assert pg_temp.tl_check('c4a', 'table 5') = pg_temp.tl_id('5'), 'T4 FAIL: "table 5" did not find "5"';
  assert pg_temp.tl_check('c4b', 'B2') = pg_temp.tl_id('b2'), 'T4 FAIL: "B2" did not find "b2"';
  assert pg_temp.tl_tables() = n, 'T4 FAIL: a table was learned for a word an existing table answers';
end $$;

-- T5: no word and a blank word stay unlinked and learn nothing.
do $$
declare
  n bigint := pg_temp.tl_tables();
begin
  assert pg_temp.tl_check('c5a', null) is null, 'T5 FAIL: a check with no word got a table';
  assert pg_temp.tl_check('c5b', '   ') is null, 'T5 FAIL: a blank word got a table';
  assert pg_temp.tl_tables() = n, 'T5 FAIL: a blank word learned a table';
end $$;

-- T6: a hidden table still catches its checks and is not learned again.
do $$
begin
  assert pg_temp.tl_check('c6', 'h1') = pg_temp.tl_id('H1'), 'T6 FAIL: a hidden table did not catch its check';
  assert pg_temp.tl_tables('h1') = 1, 'T6 FAIL: a hidden table was learned again';
end $$;

-- T7: a renamed learned table keeps catching the till's word.
do $$
declare
  v uuid := pg_temp.tl_id('T7');
  n bigint;
begin
  update public.restaurant_tables set label = 'Window 7' where id = v;
  n := pg_temp.tl_tables();
  assert pg_temp.tl_check('c7', 'T7') = v, 'T7 FAIL: the next T7 did not reach "Window 7"';
  assert pg_temp.tl_tables() = n, 'T7 FAIL: the next T7 learned a duplicate';
  assert (select pos_refs ->> 'csv_import' from public.restaurant_tables where id = v) = 'T7',
    'T7 FAIL: the rename lost the till''s word';
  assert (select till_words -> 'csv_import' = '["T7"]'::jsonb and former_labels = array['T7']
            from public.restaurant_tables where id = v),
    'T7 FAIL: the rename did not keep T7 (once, any case) in till_words and former_labels';
end $$;

-- T8: renaming a hand-added table keeps the till's word in till_words and
-- the old label in former_labels; pos_refs is not written.
do $$
declare
  v uuid := pg_temp.tl_id('T12');
begin
  assert pg_temp.tl_check('c8a', 'T12') = v, 'T8 FAIL: T12 did not find the hand-added T12';
  update public.restaurant_tables set label = 'Corner' where id = v;
  assert (select till_words -> 'csv_import' from public.restaurant_tables where id = v) = '["T12"]'::jsonb,
    'T8 FAIL: till_words did not gain csv_import:["T12"] on the rename';
  assert (select former_labels from public.restaurant_tables where id = v) = array['T12'],
    'T8 FAIL: former_labels did not gain T12 on the rename';
  assert (select pos_refs from public.restaurant_tables where id = v) = '{}'::jsonb,
    'T8 FAIL: the rename wrote pos_refs';
  assert pg_temp.tl_check('c8b', 'T12') = v, 'T8 FAIL: the next T12 did not reach "Corner"';
  assert pg_temp.tl_tables('T12') = 0, 'T8 FAIL: a T12 table was learned after the rename';
end $$;

-- T9: adding a table by hand re-links the history that names it.
do $$
declare
  v uuid;
begin
  perform pg_temp.tl_history('c9', 'Patio');
  assert pg_temp.tl_link('c9') is null, 'T9 FAIL: setup: the history row is already linked';
  insert into public.restaurant_tables (restaurant_id, label, seats) values (pg_temp.tl_house(), 'Patio', 4)
  returning id into v;
  assert pg_temp.tl_link('c9') = v, 'T9 FAIL: adding "Patio" did not re-link the check that names it';
end $$;

-- T10: a retired table blocks learning; re-activating it links the check.
-- (The word has a digit, so only the retired table stops it being learned.)
do $$
declare
  v uuid := pg_temp.tl_id('Bar 9');
begin
  assert pg_temp.tl_check('c10', 'bar 9') is null, 'T10 FAIL: a retired table caught a check';
  assert pg_temp.tl_tables('bar 9') = 1, 'T10 FAIL: a retired table''s word learned a duplicate';
  update public.restaurant_tables set is_active = true where id = v;
  assert pg_temp.tl_link('c10') = v, 'T10 FAIL: re-activating "Bar 9" did not link its check';
end $$;

-- T11: one INSERT ... ON CONFLICT DO UPDATE batch carrying a new "Deck 2"
-- check (it learns Deck 2) and then a re-import of a stored unlinked one. An
-- immediate re-link on the learned insert would touch the second row inside
-- the same command and abort the whole import ("ON CONFLICT DO UPDATE command
-- cannot affect row a second time": measured by removing the migration's
-- learned_at condition on restaurant_tables_relink_on_add).
do $$
begin
  perform pg_temp.tl_history('c11a', 'Deck 2');
  insert into public.pos_checks (restaurant_id, source, external_check_id, opened_at, table_ref)
  values (pg_temp.tl_house(), 'csv_import', 'c11b', now(), 'Deck 2'),
         (pg_temp.tl_house(), 'csv_import', 'c11a', now(), 'Deck 2')
  on conflict (restaurant_id, source, external_check_id)
  do update set table_ref = excluded.table_ref, table_id = excluded.table_id;
  assert pg_temp.tl_tables('Deck 2') = 1, 'T11 FAIL: Deck 2 was not learned exactly once';
  assert pg_temp.tl_link('c11a') = pg_temp.tl_id('Deck 2') and pg_temp.tl_link('c11b') = pg_temp.tl_id('Deck 2'),
    'T11 FAIL: both Deck 2 checks are not on the one Deck 2';
end $$;

-- T12: a learning failure stores the check without a table; it is not refused.
create function pg_temp.tl_refuse() returns trigger language plpgsql as $$
begin
  raise exception 'T12 refuses every new table';
end $$;
create trigger tl_refuse before insert on public.restaurant_tables
  for each row execute function pg_temp.tl_refuse();
do $$
begin
  assert pg_temp.tl_check('c12', 'Loft 1') is null, 'T12 FAIL: the check got a table while learning failed';
  assert exists (select 1 from public.pos_checks
                  where restaurant_id = pg_temp.tl_house() and external_check_id = 'c12'
                    and table_ref = 'Loft 1'),
    'T12 FAIL: the check was not stored';
  assert pg_temp.tl_tables('Loft 1') = 0, 'T12 FAIL: a Loft 1 table exists';
end $$;
drop trigger tl_refuse on public.restaurant_tables;

-- T13: the raw reader mirrors the adapters, and the migration's own backfill
-- learns and links history.
do $$
begin
  assert public.pos_table_ref_from_raw('csv_import', '{"tableRef": "T1"}') = 'T1', 'T13 FAIL: csv tableRef';
  assert public.pos_table_ref_from_raw('csv_import', '{"table_ref": " T2 "}') = 'T2', 'T13 FAIL: csv table_ref';
  assert public.pos_table_ref_from_raw('csv_import', '{"table": "T3"}') = 'T3', 'T13 FAIL: csv table';
  assert public.pos_table_ref_from_raw('csv_import', '{"tableRef": null, "table": "T4"}') = 'T4',
    'T13 FAIL: a JSON null must be skipped like ??';
  assert public.pos_table_ref_from_raw('generic_webhook', '{"tableRef": 14}') = '14', 'T13 FAIL: a numeric word';
  assert public.pos_table_ref_from_raw('square', '{"ticket_name": "Bar 2"}') = 'Bar 2', 'T13 FAIL: square ticket_name';
  assert public.pos_table_ref_from_raw('square', '{"tableRef": "T1"}') is null, 'T13 FAIL: square reads only ticket_name';
  assert public.pos_table_ref_from_raw('toast', '{"table": {"guid": "g-1", "name": "T9"}}') = 'g-1',
    'T13 FAIL: toast reads the guid before the name';
  assert public.pos_table_ref_from_raw('toast', '{"table": {"name": "T9"}}') = 'T9', 'T13 FAIL: toast name';
  assert public.pos_table_ref_from_raw('clover', '{"orderType": {"label": "Dine In"}, "tableRef": "T1"}') is null,
    'T13 FAIL: clover''s order type is a channel, never a table';
  assert public.pos_table_ref_from_raw('csv_import', '{"tableRef": "   "}') is null, 'T13 FAIL: a blank word';
  assert public.pos_table_ref_from_raw('csv_import', '{"tableRef": {"x": 1}}') is null, 'T13 FAIL: an object word';
  assert public.pos_table_ref_from_raw('csv_import', '[1]') is null, 'T13 FAIL: a non-object raw';
  assert public.pos_table_ref_from_raw('csv_import', null) is null, 'T13 FAIL: a NULL raw';

  perform pg_temp.tl_history('h13a', null, '{"tableRef": "Garden 4"}');
  perform pg_temp.tl_history('h13b', null, '{"table": "garden 4 "}');
  perform pg_temp.tl_history('h13c', null, '{"tableRef": null}');
  perform pg_temp.tl_history('h13d', null, '{"orderType": {"label": "Dine In"}}', 'clover');

  -- Verbatim from the migration, step 6.
  UPDATE public.pos_checks
     SET table_ref = public.pos_table_ref_from_raw(source, raw)
   WHERE table_ref IS NULL
     AND raw IS NOT NULL
     AND public.pos_table_ref_from_raw(source, raw) IS NOT NULL;

  assert pg_temp.tl_tables('garden 4') = 1, 'T13 FAIL: the backfill did not learn Garden 4 exactly once';
  assert (select learned_at is not null and seats is null from public.restaurant_tables
           where restaurant_id = pg_temp.tl_house() and lower(label) = 'garden 4'),
    'T13 FAIL: the backfilled table is not a learned one';
  assert pg_temp.tl_link('h13a') is not null and pg_temp.tl_link('h13a') = pg_temp.tl_link('h13b'),
    'T13 FAIL: the backfill did not link both Garden 4 checks to one table';
  assert (select table_ref is null and table_id is null from public.pos_checks
           where restaurant_id = pg_temp.tl_house() and external_check_id = 'h13c'),
    'T13 FAIL: a check with no word was touched';
  assert (select table_ref is null and table_id is null from public.pos_checks
           where restaurant_id = pg_temp.tl_house() and external_check_id = 'h13d'),
    'T13 FAIL: a clover order type became a table';
end $$;

-- T14: a link is never moved: renaming Beta to the word Alpha already catches
-- leaves Alpha's check on Alpha, and the next P1 still reaches Alpha.
do $$
declare
  a uuid := pg_temp.tl_id('Alpha');
begin
  assert pg_temp.tl_check('c14a', 'P1') = a, 'T14 FAIL: setup: P1 did not reach Alpha by its pos ref';
  update public.restaurant_tables set label = 'P1' where id = pg_temp.tl_id('Beta');
  assert pg_temp.tl_link('c14a') = a, 'T14 FAIL: the rename moved a check off Alpha';
  assert pg_temp.tl_check('c14b', 'P1') = a, 'T14 FAIL: a pos ref no longer outranks a label';
end $$;

-- T15: a re-sent check keeps its table while its word is unchanged (here:
-- the table was retired after the check landed on it, so nothing answers).
do $$
declare
  v uuid;
begin
  v := pg_temp.tl_check('c15', 'Q1');
  assert v = pg_temp.tl_id('Q1'), 'T15 FAIL: setup: Q1 was not learned';
  update public.restaurant_tables set is_active = false where id = v;
  insert into public.pos_checks (restaurant_id, source, external_check_id, opened_at, table_ref, table_id)
  values (pg_temp.tl_house(), 'csv_import', 'c15', now(), 'Q1', null)
  on conflict (restaurant_id, source, external_check_id)
  do update set table_ref = excluded.table_ref, table_id = excluded.table_id;
  assert pg_temp.tl_link('c15') = v, 'T15 FAIL: a re-send dropped the link';
  assert pg_temp.tl_tables('Q1') = 1, 'T15 FAIL: the re-send learned a duplicate Q1';
end $$;

-- T16: a learned table re-links, at commit, the history that already named it
-- (here: a check stored while learning failed).
do $$
declare
  v uuid;
begin
  perform pg_temp.tl_history('c16a', 'Mezz 1');
  v := pg_temp.tl_check('c16b', 'Mezz 1');
  assert v is not null, 'T16 FAIL: Mezz 1 was not learned';
  assert pg_temp.tl_link('c16a') is null, 'T16 FAIL: the learned insert re-linked inside the command';
  set constraints public.restaurant_tables_relink_on_learn immediate;
  assert pg_temp.tl_link('c16a') = v, 'T16 FAIL: the deferred re-link did not reach the earlier Mezz 1 check';
  set constraints public.restaurant_tables_relink_on_learn deferred;
end $$;

-- pos-hub's write, as it reaches the database: the row names raw and table_id
-- (its in-memory resolve) but never table_ref, and an upsert sets every column
-- the row names.
create function pg_temp.tl_hub(p_ext text, p_raw jsonb, p_source text default 'csv_import', p_table uuid default null)
returns uuid language sql as $$
  insert into public.pos_checks (restaurant_id, source, external_check_id, opened_at, table_id, raw)
  values (pg_temp.tl_house(), p_source, p_ext, now(), p_table, p_raw)
  on conflict (restaurant_id, source, external_check_id)
  do update set table_id = excluded.table_id, raw = excluded.raw, opened_at = excluded.opened_at
  returning table_id
$$;
create function pg_temp.tl_ref(p_ext text) returns text language sql as $$
  select table_ref from public.pos_checks
   where restaurant_id = pg_temp.tl_house() and external_check_id = p_ext
$$;

-- T17: a check written as pos-hub writes it gets its word from raw and learns
-- its table; the word is kept beside the gateway's own resolve; Clover's order
-- type is never a word; and a word raw carries beats a table_ref given with it.
do $$
declare
  n bigint;
begin
  assert pg_temp.tl_hub('c17a', '{"tableRef": " Terrace 1 "}') = pg_temp.tl_id('Terrace 1'),
    'T17 FAIL: a check written as pos-hub writes it did not learn Terrace 1 from raw';
  assert pg_temp.tl_ref('c17a') = 'Terrace 1',
    'T17 FAIL: table_ref was not read from raw: ' || coalesce(pg_temp.tl_ref('c17a'), 'NULL');
  assert pg_temp.tl_hub('c17b', '{"table": "terrace 1"}') = pg_temp.tl_id('Terrace 1'),
    'T17 FAIL: the same word under another key did not reach Terrace 1';
  assert pg_temp.tl_hub('c17e', '{"tableRef": "table 5"}', 'csv_import', pg_temp.tl_id('5')) = pg_temp.tl_id('5')
     and pg_temp.tl_ref('c17e') = 'table 5',
    'T17 FAIL: the word was not kept beside the gateway''s own resolve';
  n := pg_temp.tl_tables();
  assert pg_temp.tl_hub('c17c', '{"orderType": {"label": "Dine In"}, "tableRef": "Dine In"}', 'clover') is null,
    'T17 FAIL: a Clover order type found a table';
  assert pg_temp.tl_ref('c17c') is null, 'T17 FAIL: a Clover order type became a table word';
  assert pg_temp.tl_tables() = n, 'T17 FAIL: a Clover order type learned a table';
  insert into public.pos_checks (restaurant_id, source, external_check_id, opened_at, table_ref, raw)
  values (pg_temp.tl_house(), 'csv_import', 'c17d', now(), 'Nook 1', '{"tableRef": "Terrace 1"}');
  assert pg_temp.tl_ref('c17d') = 'Terrace 1' and pg_temp.tl_link('c17d') = pg_temp.tl_id('Terrace 1'),
    'T17 FAIL: a given table_ref beat the word raw carries';
  assert pg_temp.tl_tables('Nook 1') = 0, 'T17 FAIL: the overridden word learned a table';
end $$;

-- T18: the word follows the till on a re-send. The same payload keeps word and
-- link; a payload naming Snug 1 moves both; a payload naming no table clears
-- both; an update writing only raw re-resolves a changed word; and a word a
-- writer set itself stands when raw, carrying none, is written again.
do $$
declare
  terrace uuid := pg_temp.tl_id('Terrace 1');
  n bigint := pg_temp.tl_tables();
begin
  assert pg_temp.tl_hub('c17a', '{"tableRef": " Terrace 1 "}') = terrace and pg_temp.tl_ref('c17a') = 'Terrace 1',
    'T18 FAIL: an unchanged re-send moved the check or its word';
  assert pg_temp.tl_tables() = n, 'T18 FAIL: an unchanged re-send learned a table';

  assert pg_temp.tl_hub('c17a', '{"tableRef": "Snug 1", "closed": true}') = pg_temp.tl_id('Snug 1'),
    'T18 FAIL: a re-send naming Snug 1 did not move the check there';
  assert pg_temp.tl_ref('c17a') = 'Snug 1', 'T18 FAIL: table_ref did not follow raw to Snug 1';

  assert pg_temp.tl_hub('c17a', '{"closed": true}') is null,
    'T18 FAIL: a re-send naming no table kept a table';
  assert pg_temp.tl_ref('c17a') is null,
    'T18 FAIL: a re-send naming no table kept the old word ' || coalesce(pg_temp.tl_ref('c17a'), '');

  update public.pos_checks set raw = '{"tableRef": "Snug 1"}'
   where restaurant_id = pg_temp.tl_house() and external_check_id = 'c17b';
  assert pg_temp.tl_ref('c17b') = 'Snug 1' and pg_temp.tl_link('c17b') = pg_temp.tl_id('Snug 1'),
    'T18 FAIL: an update writing only raw left the link on the old word''s table';

  insert into public.pos_checks (restaurant_id, source, external_check_id, opened_at, table_ref, raw)
  values (pg_temp.tl_house(), 'csv_import', 'c18', now(), 'Terrace 1', '{"note": 1}');
  update public.pos_checks set raw = '{"note": 2}'
   where restaurant_id = pg_temp.tl_house() and external_check_id = 'c18';
  assert pg_temp.tl_ref('c18') = 'Terrace 1' and pg_temp.tl_link('c18') = terrace,
    'T18 FAIL: a writer''s own word went when raw, naming none, was written again';
end $$;

-- T19: a re-link never moves a link: the immediate re-link, after a person
-- adds or renames a table. "table 7" lands on the hand-added "7" by the
-- "table <label>" rule. A table labelled "Table 7" then outranks that rule for
-- the same word, so the word now resolves to it, yet the check stays on "7":
-- a re-link fills only unlinked checks. The same for a rename into "Table 8".
-- (T14 cannot see this: there the pos ref keeps the word on Alpha.) The
-- re-link does not even rewrite the linked check (its ctid stands): the belt
-- in pos_checks_find_or_learn_table would also hold the link, so only the
-- untouched row version shows the re-link's own "fills only unlinked checks".
do $$
declare
  seven uuid;
  table7 uuid;
  eight uuid;
  lounge uuid;
  v_ctid tid;
begin
  insert into public.restaurant_tables (restaurant_id, label, seats)
  values (pg_temp.tl_house(), '7', 4) returning id into seven;
  assert pg_temp.tl_check('c19a', 'table 7') = seven, 'T19 FAIL: setup: "table 7" did not land on "7"';
  select ctid into v_ctid from public.pos_checks where restaurant_id = pg_temp.tl_house() and external_check_id = 'c19a';
  insert into public.restaurant_tables (restaurant_id, label, seats)
  values (pg_temp.tl_house(), 'Table 7', 4) returning id into table7;
  assert public.pos_table_for_ref(pg_temp.tl_house(), 'csv_import', 'table 7') = table7,
    'T19 FAIL: setup: "table 7" does not resolve to the added "Table 7", so the case proves nothing';
  assert pg_temp.tl_link('c19a') = seven, 'T19 FAIL: adding "Table 7" moved a linked check off "7"';
  assert (select ctid from public.pos_checks where restaurant_id = pg_temp.tl_house() and external_check_id = 'c19a') = v_ctid,
    'T19 FAIL: adding "Table 7" rewrote a linked check (the immediate re-link must touch only unlinked ones)';

  insert into public.restaurant_tables (restaurant_id, label, seats)
  values (pg_temp.tl_house(), '8', 4) returning id into eight;
  insert into public.restaurant_tables (restaurant_id, label, seats)
  values (pg_temp.tl_house(), 'Lounge', 4) returning id into lounge;
  assert pg_temp.tl_check('c19b', 'table 8') = eight, 'T19 FAIL: setup: "table 8" did not land on "8"';
  select ctid into v_ctid from public.pos_checks where restaurant_id = pg_temp.tl_house() and external_check_id = 'c19b';
  update public.restaurant_tables set label = 'Table 8' where id = lounge;
  assert public.pos_table_for_ref(pg_temp.tl_house(), 'csv_import', 'table 8') = lounge,
    'T19 FAIL: setup: "table 8" does not resolve to the renamed "Table 8", so the case proves nothing';
  assert pg_temp.tl_link('c19b') = eight, 'T19 FAIL: renaming "Lounge" to "Table 8" moved a linked check off "8"';
  assert (select ctid from public.pos_checks where restaurant_id = pg_temp.tl_house() and external_check_id = 'c19b') = v_ctid,
    'T19 FAIL: renaming "Lounge" to "Table 8" rewrote a linked check (the immediate re-link must touch only unlinked ones)';
end $$;

-- T20: a re-link never moves a link: the deferred re-link after learning. A
-- check written with its own table_id beside the word "Zed 1" stays on that
-- table when a later check learns "Zed 1" and the re-link runs at commit,
-- and the re-link does not rewrite it (its ctid stands; see T19).
do $$
declare
  five uuid := pg_temp.tl_id('5');
  zed uuid;
  v_ctid tid;
begin
  insert into public.pos_checks (restaurant_id, source, external_check_id, opened_at, table_ref, table_id)
  values (pg_temp.tl_house(), 'csv_import', 'c20a', now(), 'Zed 1', five);
  select ctid into v_ctid from public.pos_checks where restaurant_id = pg_temp.tl_house() and external_check_id = 'c20a';
  assert pg_temp.tl_link('c20a') = five and pg_temp.tl_tables('Zed 1') = 0,
    'T20 FAIL: setup: the check did not keep the table its writer gave, or "Zed 1" exists already';
  zed := pg_temp.tl_check('c20b', 'Zed 1');
  assert zed is not null and zed = pg_temp.tl_id('Zed 1') and pg_temp.tl_tables('Zed 1') = 1,
    'T20 FAIL: setup: "Zed 1" was not learned once';
  set constraints public.restaurant_tables_relink_on_learn immediate;
  assert pg_temp.tl_link('c20a') = five,
    'T20 FAIL: the re-link after learning "Zed 1" moved a linked check off "5"';
  assert (select ctid from public.pos_checks where restaurant_id = pg_temp.tl_house() and external_check_id = 'c20a') = v_ctid,
    'T20 FAIL: the re-link after learning "Zed 1" rewrote a linked check (it must touch only unlinked ones)';
  assert pg_temp.tl_link('c20b') = zed, 'T20 FAIL: the check that learned "Zed 1" left it';
  set constraints public.restaurant_tables_relink_on_learn deferred;
end $$;

-- T21-T23: the founder's 2026-10-05 answer, verbatim pick "Only words with a
-- number (Recommended)": a till word makes a NEW table only when it has an
-- ASCII digit in it. A word with none stays on the check as its table_ref and
-- links only to a table that already answers it. A second house with no
-- table, so no hand-added row of the first house answers these words.
create function pg_temp.tl_house2() returns uuid language sql immutable as $$
  select 'a0303000-0000-4000-8000-000000000002'::uuid
$$;
create function pg_temp.tl2_check(p_ext text, p_ref text, p_raw jsonb default null, p_source text default 'csv_import')
returns uuid language sql as $$
  insert into public.pos_checks (restaurant_id, source, external_check_id, opened_at, table_ref, raw)
  values (pg_temp.tl_house2(), p_source, p_ext, now(), p_ref, p_raw)
  returning table_id
$$;
create function pg_temp.tl2_row(p_ext text) returns public.pos_checks language sql as $$
  select * from public.pos_checks
   where restaurant_id = pg_temp.tl_house2() and external_check_id = p_ext
$$;
create function pg_temp.tl2_tables(p_word text default null) returns bigint language sql as $$
  select count(*) from public.restaurant_tables
   where restaurant_id = pg_temp.tl_house2()
     and (p_word is null or lower(label) = lower(p_word))
$$;
create function pg_temp.tl2_id(p_label text) returns uuid language sql as $$
  select id from public.restaurant_tables
   where restaurant_id = pg_temp.tl_house2() and lower(label) = lower(p_label)
$$;
insert into public.restaurants (id, name, slug)
values ('a0303000-0000-4000-8000-000000000002', 'ADR 0303 test house 2', 'adr-0303-test-house-2');

-- T21: new checks. 'booth', 'ayla' and Square's ticket name 'Ayla' make no
-- table and keep their word; 't12', '12', 'patio 3', 'table 7', '7a',
-- '2nd floor' and the number 14 are each learned once, as learned rows, with
-- the check on them. '7a' and '2nd floor' pin "a digit anywhere in the word":
-- a rule that needs the digit last (or the word to end in one) misses them.
do $$
declare
  w text;
  v uuid;
begin
  foreach w in array array['booth', 'ayla'] loop
    assert pg_temp.tl2_check('c21-' || w, w) is null, 'T21 FAIL: the word "' || w || '" got a table';
    assert (pg_temp.tl2_row('c21-' || w)).table_ref = w, 'T21 FAIL: the word "' || w || '" was not kept on its check';
    assert pg_temp.tl2_tables(w) = 0, 'T21 FAIL: the word "' || w || '" with no digit made a table';
  end loop;
  assert pg_temp.tl2_check('c21-sq', null, '{"ticket_name": "Ayla"}', 'square') is null,
    'T21 FAIL: Square''s ticket name "Ayla" got a table';
  assert (pg_temp.tl2_row('c21-sq')).table_ref = 'Ayla', 'T21 FAIL: Square''s ticket name was not kept as the word';
  assert pg_temp.tl2_tables() = 0, 'T21 FAIL: a word with no digit made a table';

  foreach w in array array['t12', '12', 'patio 3', 'table 7', '7a', '2nd floor'] loop
    v := pg_temp.tl2_check('c21-' || w, w);
    assert pg_temp.tl2_tables(w) = 1, 'T21 FAIL: the word "' || w || '" was not learned exactly once';
    assert v = pg_temp.tl2_id(w), 'T21 FAIL: the "' || w || '" check is not on its learned table';
    assert (select learned_at is not null from public.restaurant_tables where id = v),
      'T21 FAIL: "' || w || '" is not a learned table';
  end loop;
  assert pg_temp.tl2_check('c21-14', null, '{"tableRef": 14}', 'generic_webhook') = pg_temp.tl2_id('14'),
    'T21 FAIL: the number 14 was not learned';
  assert pg_temp.tl2_tables() = 7, 'T21 FAIL: house 2 should hold 7 learned tables, holds ' || pg_temp.tl2_tables();
end $$;

-- T22: the backfill keeps the same rule. History stored before the migration
-- (no trigger run) with BOOTH, Square's 'Ayla', T5 and 'Patio 6' in raw: the
-- backfill writes every word, learns T5 and Patio 6, and makes no table for
-- BOOTH or Ayla.
do $$
begin
  perform set_config('session_replication_role', 'replica', true);
  insert into public.pos_checks (restaurant_id, source, external_check_id, opened_at, raw) values
    (pg_temp.tl_house2(), 'csv_import', 'h22a', now() - interval '30 days', '{"tableRef": "BOOTH"}'),
    (pg_temp.tl_house2(), 'square', 'h22b', now() - interval '30 days', '{"ticket_name": "Ayla"}'),
    (pg_temp.tl_house2(), 'csv_import', 'h22c', now() - interval '30 days', '{"tableRef": "T5"}'),
    (pg_temp.tl_house2(), 'csv_import', 'h22d', now() - interval '30 days', '{"table": "Patio 6"}');
  perform set_config('session_replication_role', 'origin', true);

  -- Verbatim from the migration, step 6.
  UPDATE public.pos_checks
     SET table_ref = public.pos_table_ref_from_raw(source, raw)
   WHERE table_ref IS NULL
     AND raw IS NOT NULL
     AND public.pos_table_ref_from_raw(source, raw) IS NOT NULL;

  assert (pg_temp.tl2_row('h22a')).table_ref = 'BOOTH' and (pg_temp.tl2_row('h22a')).table_id is null,
    'T22 FAIL: the backfill did not keep BOOTH as a word with no table';
  assert (pg_temp.tl2_row('h22b')).table_ref = 'Ayla' and (pg_temp.tl2_row('h22b')).table_id is null,
    'T22 FAIL: the backfill did not keep Ayla as a word with no table';
  assert pg_temp.tl2_tables('booth') = 0 and pg_temp.tl2_tables('ayla') = 0,
    'T22 FAIL: the backfill made a table for a word with no digit';
  assert (pg_temp.tl2_row('h22c')).table_id = pg_temp.tl2_id('T5') and pg_temp.tl2_tables('T5') = 1,
    'T22 FAIL: the backfill did not learn T5 and link its check';
  assert (pg_temp.tl2_row('h22d')).table_id = pg_temp.tl2_id('Patio 6') and pg_temp.tl2_tables('Patio 6') = 1,
    'T22 FAIL: the backfill did not learn Patio 6 and link its check';
end $$;

-- T23: an owner-added 'Bar' links past and new 'bar' checks; a table renamed
-- to 'Window' links the 'window' checks. A word with no digit still links to
-- a table that answers it: it only never makes one.
do $$
declare
  bar uuid;
  room uuid;
begin
  perform set_config('session_replication_role', 'replica', true);
  insert into public.pos_checks (restaurant_id, source, external_check_id, opened_at, table_ref) values
    (pg_temp.tl_house2(), 'csv_import', 'h23a', now() - interval '30 days', 'bar');
  perform set_config('session_replication_role', 'origin', true);
  assert pg_temp.tl2_check('c23b', 'Bar') is null, 'T23 FAIL: setup: "Bar" got a table before one was added';
  assert pg_temp.tl2_tables('bar') = 0, 'T23 FAIL: the word "Bar" made a table';

  insert into public.restaurant_tables (restaurant_id, label, seats) values (pg_temp.tl_house2(), 'Bar', 6)
  returning id into bar;
  assert (pg_temp.tl2_row('h23a')).table_id = bar, 'T23 FAIL: adding "Bar" did not link the past "bar" check';
  assert (pg_temp.tl2_row('c23b')).table_id = bar, 'T23 FAIL: adding "Bar" did not link the earlier "Bar" check';
  assert pg_temp.tl2_check('c23c', 'BAR ') = bar, 'T23 FAIL: a new "BAR " check did not reach the added "Bar"';
  assert pg_temp.tl2_tables('bar') = 1, 'T23 FAIL: a second bar table exists';

  insert into public.restaurant_tables (restaurant_id, label, seats) values (pg_temp.tl_house2(), 'Room', 4)
  returning id into room;
  assert pg_temp.tl2_check('c23d', 'window') is null, 'T23 FAIL: setup: "window" got a table';
  update public.restaurant_tables set label = 'Window' where id = room;
  assert (pg_temp.tl2_row('c23d')).table_id = room, 'T23 FAIL: renaming a table to "Window" did not link the "window" check';
  assert pg_temp.tl2_check('c23e', 'Window') = room, 'T23 FAIL: a new "Window" check did not reach the renamed table';
end $$;


-- T24-T29: the founder's 2026-10-05 answer to the rename fork, verbatim pick
-- "Keep every spelling (Recommended)": "A table remembers every till
-- spelling it was ever linked by, not just one. A rename never creates a twin
-- table, and past checks never move." A third house, empty, so no row of the
-- other two answers these words. tl3_hub writes as pos-hub does (raw and the
-- gateway's table_id, never table_ref), with an opened_at when the order of
-- checks matters.
create function pg_temp.tl_house3() returns uuid language sql immutable as $$
  select 'a0303000-0000-4000-8000-000000000003'::uuid
$$;
create function pg_temp.tl3_hub(p_ext text, p_raw jsonb, p_table uuid default null, p_opened timestamptz default now())
returns uuid language sql as $$
  insert into public.pos_checks (restaurant_id, source, external_check_id, opened_at, table_id, raw)
  values (pg_temp.tl_house3(), 'csv_import', p_ext, p_opened, p_table, p_raw)
  on conflict (restaurant_id, source, external_check_id)
  do update set table_id = excluded.table_id, raw = excluded.raw, opened_at = excluded.opened_at
  returning table_id
$$;
create function pg_temp.tl3_link(p_ext text) returns uuid language sql as $$
  select table_id from public.pos_checks
   where restaurant_id = pg_temp.tl_house3() and external_check_id = p_ext
$$;
create function pg_temp.tl3_ref(p_ext text) returns text language sql as $$
  select table_ref from public.pos_checks
   where restaurant_id = pg_temp.tl_house3() and external_check_id = p_ext
$$;
create function pg_temp.tl3_tables(p_word text default null) returns bigint language sql as $$
  select count(*) from public.restaurant_tables
   where restaurant_id = pg_temp.tl_house3()
     and (p_word is null or lower(label) = lower(p_word))
$$;
create function pg_temp.tl3_id(p_label text) returns uuid language sql as $$
  select id from public.restaurant_tables
   where restaurant_id = pg_temp.tl_house3() and lower(label) = lower(p_label)
$$;
insert into public.restaurants (id, name, slug)
values ('a0303000-0000-4000-8000-000000000003', 'ADR 0303 test house 3', 'adr-0303-test-house-3');

-- T24: the sequence the fork was asked on. The till learns table "5"; a
-- "Table 5" check lands on it; the owner renames it "Patio"; the till re-sends
-- the "Table 5" check and sends a new one. The gateway's in-memory resolve
-- finds no table for "Table 5" after the rename (pos ref "5", label "Patio"),
-- so both writes carry table_id NULL. One table, Patio, holds all three
-- checks; no "Table 5" table is learned.
do $$
declare
  patio uuid;
begin
  patio := pg_temp.tl3_hub('c24-1', '{"tableRef": "5"}');
  assert patio is not null and patio = pg_temp.tl3_id('5') and pg_temp.tl3_tables() = 1,
    'T24 FAIL: setup: the till''s "5" was not learned as the house''s one table';
  assert pg_temp.tl3_hub('c24-2', '{"tableRef": "Table 5"}', patio) = patio,
    'T24 FAIL: setup: the "Table 5" check did not land on "5"';
  set constraints public.restaurant_tables_relink_on_learn immediate;
  set constraints public.restaurant_tables_relink_on_learn deferred;

  update public.restaurant_tables set label = 'Patio' where id = patio;

  assert pg_temp.tl3_hub('c24-2', '{"tableRef": "Table 5"}') = patio,
    'T24 FAIL: the re-sent "Table 5" check moved off Patio';
  assert pg_temp.tl3_hub('c24-3', '{"tableRef": "Table 5"}') = patio,
    'T24 FAIL: the new "Table 5" check did not land on Patio';
  set constraints public.restaurant_tables_relink_on_learn immediate;
  set constraints public.restaurant_tables_relink_on_learn deferred;
  assert pg_temp.tl3_tables('Table 5') = 0, 'T24 FAIL: a twin "Table 5" table was learned';
  assert pg_temp.tl3_tables() = 1, 'T24 FAIL: house 3 should hold one table, holds ' || pg_temp.tl3_tables();
  assert pg_temp.tl3_link('c24-1') = patio and pg_temp.tl3_link('c24-2') = patio and pg_temp.tl3_link('c24-3') = patio,
    'T24 FAIL: c1, c2 and c3 are not all on Patio';
  assert pg_temp.tl3_hub('c24-4', '{"tableRef": "5"}', patio) = patio,
    'T24 FAIL: a new "5" check did not land on Patio';
  assert (select till_words -> 'csv_import' = '["5", "Table 5"]'::jsonb and former_labels = array['5']
                 and pos_refs = '{"csv_import": "5"}'::jsonb
            from public.restaurant_tables where id = patio),
    'T24 FAIL: Patio does not keep "5" and "Table 5" as till words, "5" as its former label, and its pos ref';
end $$;

-- T25: a past check never moves, even when the write names another table.
-- The owner adds a table "5" by hand after the rename. The gateway now
-- resolves "Table 5" to that new "5" ("table <label>") and writes its id on
-- the re-send; the check stays on Patio. A NEW "Table 5" check goes to the
-- new "5": a table's current label outranks a word another table remembers
-- (ADR 0303, residual). A new "5" still reaches Patio by its pos ref.
do $$
declare
  patio uuid := pg_temp.tl3_id('Patio');
  five uuid;
begin
  insert into public.restaurant_tables (restaurant_id, label, seats) values (pg_temp.tl_house3(), '5', 4)
  returning id into five;
  assert pg_temp.tl3_link('c24-2') = patio and pg_temp.tl3_link('c24-3') = patio,
    'T25 FAIL: adding a hand "5" moved a "Table 5" check off Patio';
  assert pg_temp.tl3_hub('c24-2', '{"tableRef": "Table 5"}', five) = patio,
    'T25 FAIL: a re-send naming the new "5" moved a past check off Patio';
  assert pg_temp.tl3_hub('c24-3', '{"tableRef": "Table 5", "closed": true}', five) = patio,
    'T25 FAIL: a re-send with a changed payload but the same word moved a past check off Patio';
  assert pg_temp.tl3_hub('c25-1', '{"tableRef": "Table 5"}') = five,
    'T25 FAIL: a new "Table 5" check did not go to the hand-added "5"';
  assert pg_temp.tl3_hub('c25-2', '{"tableRef": "5"}') = patio,
    'T25 FAIL: a new "5" check did not reach Patio by its pos ref';
end $$;

-- T26: the hand-added variant. A table "9" added by hand (no pos ref) catches
-- "9" and "Table 9"; renamed "Garden", it still catches both, past and new,
-- and no "9" or "Table 9" table is learned. A hand-added "11" that no check
-- ever named, renamed "Corner", still answers "11" and "Table 11": the old
-- label is kept even when no check carried it.
do $$
declare
  garden uuid;
  corner uuid;
begin
  insert into public.restaurant_tables (restaurant_id, label, seats) values (pg_temp.tl_house3(), '9', 4)
  returning id into garden;
  assert pg_temp.tl3_hub('c26-1', '{"tableRef": "9"}') = garden, 'T26 FAIL: setup: "9" did not land on "9"';
  assert pg_temp.tl3_hub('c26-2', '{"tableRef": "Table 9"}') = garden, 'T26 FAIL: setup: "Table 9" did not land on "9"';

  update public.restaurant_tables set label = 'Garden' where id = garden;

  assert pg_temp.tl3_hub('c26-2', '{"tableRef": "Table 9"}') = garden,
    'T26 FAIL: the re-sent "Table 9" check moved off Garden';
  assert pg_temp.tl3_hub('c26-3', '{"tableRef": "Table 9"}') = garden,
    'T26 FAIL: a new "Table 9" check did not land on Garden';
  assert pg_temp.tl3_hub('c26-4', '{"tableRef": "9"}') = garden,
    'T26 FAIL: a new "9" check did not land on Garden';
  set constraints public.restaurant_tables_relink_on_learn immediate;
  set constraints public.restaurant_tables_relink_on_learn deferred;
  assert pg_temp.tl3_tables('9') = 0 and pg_temp.tl3_tables('Table 9') = 0,
    'T26 FAIL: a twin "9" or "Table 9" table was learned';
  assert pg_temp.tl3_link('c26-1') = garden, 'T26 FAIL: the first "9" check left Garden';

  insert into public.restaurant_tables (restaurant_id, label, seats) values (pg_temp.tl_house3(), '11', 2)
  returning id into corner;
  update public.restaurant_tables set label = 'Corner' where id = corner;
  assert pg_temp.tl3_hub('c26-5', '{"tableRef": "Table 11"}') = corner,
    'T26 FAIL: "Table 11" did not reach Corner, renamed from "11"';
  assert pg_temp.tl3_hub('c26-6', '{"tableRef": "11"}') = corner,
    'T26 FAIL: "11" did not reach Corner, renamed from "11"';
  set constraints public.restaurant_tables_relink_on_learn immediate;
  set constraints public.restaurant_tables_relink_on_learn deferred;
  assert pg_temp.tl3_tables('11') = 0 and pg_temp.tl3_tables('Table 11') = 0,
    'T26 FAIL: a twin "11" or "Table 11" table was learned';
  assert (select till_words = '{}'::jsonb and former_labels = array['11'] from public.restaurant_tables where id = corner),
    'T26 FAIL: a rename with no linked check did not keep "11" as a former label';
end $$;

-- T27: every spelling, not one per till. A learned "Deck 4" carries "Deck 4"
-- and, through a writer's own table_id, "D4". Renamed "Sun deck" (the latest
-- check says "Deck 4"), it still answers "D4": no "D4" table is learned.
do $$
declare
  deck uuid;
begin
  deck := pg_temp.tl3_hub('c27-1', '{"tableRef": "Deck 4"}', null, now() - interval '2 hours');
  assert deck = pg_temp.tl3_id('Deck 4'), 'T27 FAIL: setup: "Deck 4" was not learned';
  assert pg_temp.tl3_hub('c27-2', '{"tableRef": "D4"}', deck, now() - interval '1 hour') = deck,
    'T27 FAIL: setup: "D4" did not keep the table its writer gave';
  assert pg_temp.tl3_hub('c27-3', '{"tableRef": "Deck 4"}', null, now()) = deck,
    'T27 FAIL: setup: the latest "Deck 4" did not land on "Deck 4"';
  update public.restaurant_tables set label = 'Sun deck' where id = deck;
  assert pg_temp.tl3_hub('c27-4', '{"tableRef": "D4"}') = deck, 'T27 FAIL: a new "D4" did not reach Sun deck';
  set constraints public.restaurant_tables_relink_on_learn immediate;
  set constraints public.restaurant_tables_relink_on_learn deferred;
  assert pg_temp.tl3_tables('D4') = 0, 'T27 FAIL: a twin "D4" table was learned';
  assert (select till_words -> 'csv_import' = '["Deck 4", "D4"]'::jsonb from public.restaurant_tables where id = deck),
    'T27 FAIL: Sun deck does not keep both "Deck 4" and "D4"';
end $$;

-- T28: a re-mapped pos ref keeps the old word. "Bar 2" answers the till's
-- "P7"; re-mapped to "P8" (label unchanged), it answers both, and "P7" makes
-- no table.
do $$
declare
  bar uuid;
begin
  insert into public.restaurant_tables (restaurant_id, label, seats, pos_refs)
  values (pg_temp.tl_house3(), 'Bar 2', 2, '{"csv_import": "P7"}') returning id into bar;
  assert pg_temp.tl3_hub('c28-1', '{"tableRef": "P7"}') = bar, 'T28 FAIL: setup: "P7" did not reach Bar 2';
  update public.restaurant_tables set pos_refs = '{"csv_import": "P8"}' where id = bar;
  assert pg_temp.tl3_hub('c28-2', '{"tableRef": "P7"}') = bar, 'T28 FAIL: "P7" did not reach Bar 2 after the re-map';
  assert pg_temp.tl3_hub('c28-3', '{"tableRef": "P8"}') = bar, 'T28 FAIL: "P8" did not reach Bar 2';
  set constraints public.restaurant_tables_relink_on_learn immediate;
  set constraints public.restaurant_tables_relink_on_learn deferred;
  assert pg_temp.tl3_tables('P7') = 0, 'T28 FAIL: a twin "P7" table was learned';
  assert (select former_labels = '{}'::text[] from public.restaurant_tables where id = bar),
    'T28 FAIL: a re-map with the label unchanged wrote a former label';
end $$;

-- T29: a learned label is at most 60 characters, the most PATCH lets a person
-- name a table. A 61-character word with a digit stays on the check as its
-- word and makes no table; the check is stored, never refused. A 60-character
-- one is learned.
do $$
declare
  w61 text := 'Room 1 ' || repeat('x', 54);
  w60 text := 'Room 2 ' || repeat('y', 53);
  n bigint := pg_temp.tl3_tables();
begin
  assert char_length(w61) = 61 and char_length(w60) = 60, 'T29 FAIL: setup: the words are the wrong length';
  assert pg_temp.tl3_hub('c29-1', jsonb_build_object('tableRef', w61)) is null,
    'T29 FAIL: a 61-character word got a table';
  assert pg_temp.tl3_ref('c29-1') = w61, 'T29 FAIL: the 61-character word was not kept on its check';
  assert pg_temp.tl3_tables() = n, 'T29 FAIL: a 61-character word made a table';
  assert pg_temp.tl3_hub('c29-2', jsonb_build_object('tableRef', w60)) = pg_temp.tl3_id(w60),
    'T29 FAIL: a 60-character word was not learned';
end $$;

rollback;

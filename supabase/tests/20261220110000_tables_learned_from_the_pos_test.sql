-- AW25 + AW30 (analytics walk, 2026-10-03; A-051, A-055): a house whose till
-- names its tables had no restaurant_tables row, so every check stayed
-- unattributed and the till's word was lost inside `raw`. Migration
-- tables_learned_from_the_pos (ADR 0303) reads the word out of `raw` into
-- pos_checks.table_ref (so pos-hub writes no new column), learns a table the
-- first time the till names it, re-links past checks when a table is added or
-- changed, and backfills history.
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
  insert into public.restaurant_tables (restaurant_id, label, seats, is_active) values (h, 'Bar', 6, false);
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
end $$;

-- T8: renaming a hand-added table carries the till's word into pos_refs.
do $$
declare
  v uuid := pg_temp.tl_id('T12');
begin
  assert pg_temp.tl_check('c8a', 'T12') = v, 'T8 FAIL: T12 did not find the hand-added T12';
  update public.restaurant_tables set label = 'Corner' where id = v;
  assert (select pos_refs ->> 'csv_import' from public.restaurant_tables where id = v) = 'T12',
    'T8 FAIL: pos_refs did not gain csv_import:T12 on the rename';
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
do $$
declare
  v uuid := pg_temp.tl_id('Bar');
begin
  assert pg_temp.tl_check('c10', 'bar') is null, 'T10 FAIL: a retired table caught a check';
  assert pg_temp.tl_tables('bar') = 1, 'T10 FAIL: a retired table''s word learned a duplicate';
  update public.restaurant_tables set is_active = true where id = v;
  assert pg_temp.tl_link('c10') = v, 'T10 FAIL: re-activating "Bar" did not link its check';
end $$;

-- T11: one INSERT ... ON CONFLICT DO UPDATE batch carrying a new Deck check
-- (it learns Deck) and then a re-import of a stored unlinked Deck check. An
-- immediate re-link on the learned insert would touch the second row inside
-- the same command and abort the whole import ("ON CONFLICT DO UPDATE command
-- cannot affect row a second time": measured by removing the migration's
-- learned_at condition on restaurant_tables_relink_on_add).
do $$
begin
  perform pg_temp.tl_history('c11a', 'Deck');
  insert into public.pos_checks (restaurant_id, source, external_check_id, opened_at, table_ref)
  values (pg_temp.tl_house(), 'csv_import', 'c11b', now(), 'Deck'),
         (pg_temp.tl_house(), 'csv_import', 'c11a', now(), 'Deck')
  on conflict (restaurant_id, source, external_check_id)
  do update set table_ref = excluded.table_ref, table_id = excluded.table_id;
  assert pg_temp.tl_tables('Deck') = 1, 'T11 FAIL: Deck was not learned exactly once';
  assert pg_temp.tl_link('c11a') = pg_temp.tl_id('Deck') and pg_temp.tl_link('c11b') = pg_temp.tl_id('Deck'),
    'T11 FAIL: both Deck checks are not on the one Deck';
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
  assert pg_temp.tl_check('c12', 'Loft') is null, 'T12 FAIL: the check got a table while learning failed';
  assert exists (select 1 from public.pos_checks
                  where restaurant_id = pg_temp.tl_house() and external_check_id = 'c12'
                    and table_ref = 'Loft'),
    'T12 FAIL: the check was not stored';
  assert pg_temp.tl_tables('Loft') = 0, 'T12 FAIL: a Loft table exists';
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

  perform pg_temp.tl_history('h13a', null, '{"tableRef": "Garden"}');
  perform pg_temp.tl_history('h13b', null, '{"table": "garden "}');
  perform pg_temp.tl_history('h13c', null, '{"tableRef": null}');
  perform pg_temp.tl_history('h13d', null, '{"orderType": {"label": "Dine In"}}', 'clover');

  -- Verbatim from the migration, step 6.
  UPDATE public.pos_checks
     SET table_ref = public.pos_table_ref_from_raw(source, raw)
   WHERE table_ref IS NULL
     AND raw IS NOT NULL
     AND public.pos_table_ref_from_raw(source, raw) IS NOT NULL;

  assert pg_temp.tl_tables('garden') = 1, 'T13 FAIL: the backfill did not learn Garden exactly once';
  assert (select learned_at is not null and seats is null from public.restaurant_tables
           where restaurant_id = pg_temp.tl_house() and lower(label) = 'garden'),
    'T13 FAIL: the backfilled table is not a learned one';
  assert pg_temp.tl_link('h13a') is not null and pg_temp.tl_link('h13a') = pg_temp.tl_link('h13b'),
    'T13 FAIL: the backfill did not link both Garden checks to one table';
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

-- T15: a re-sent check keeps its table when nothing answers to its unchanged
-- word (here: the table was retired after the check landed on it).
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
  perform pg_temp.tl_history('c16a', 'Mezz');
  v := pg_temp.tl_check('c16b', 'Mezz');
  assert v is not null, 'T16 FAIL: Mezz was not learned';
  assert pg_temp.tl_link('c16a') is null, 'T16 FAIL: the learned insert re-linked inside the command';
  set constraints public.restaurant_tables_relink_on_learn immediate;
  assert pg_temp.tl_link('c16a') = v, 'T16 FAIL: the deferred re-link did not reach the earlier Mezz check';
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
  assert pg_temp.tl_hub('c17a', '{"tableRef": " Terrace "}') = pg_temp.tl_id('Terrace'),
    'T17 FAIL: a check written as pos-hub writes it did not learn Terrace from raw';
  assert pg_temp.tl_ref('c17a') = 'Terrace',
    'T17 FAIL: table_ref was not read from raw: ' || coalesce(pg_temp.tl_ref('c17a'), 'NULL');
  assert pg_temp.tl_hub('c17b', '{"table": "terrace"}') = pg_temp.tl_id('Terrace'),
    'T17 FAIL: the same word under another key did not reach Terrace';
  assert pg_temp.tl_hub('c17e', '{"tableRef": "table 5"}', 'csv_import', pg_temp.tl_id('5')) = pg_temp.tl_id('5')
     and pg_temp.tl_ref('c17e') = 'table 5',
    'T17 FAIL: the word was not kept beside the gateway''s own resolve';
  n := pg_temp.tl_tables();
  assert pg_temp.tl_hub('c17c', '{"orderType": {"label": "Dine In"}, "tableRef": "Dine In"}', 'clover') is null,
    'T17 FAIL: a Clover order type found a table';
  assert pg_temp.tl_ref('c17c') is null, 'T17 FAIL: a Clover order type became a table word';
  assert pg_temp.tl_tables() = n, 'T17 FAIL: a Clover order type learned a table';
  insert into public.pos_checks (restaurant_id, source, external_check_id, opened_at, table_ref, raw)
  values (pg_temp.tl_house(), 'csv_import', 'c17d', now(), 'Nook', '{"tableRef": "Terrace"}');
  assert pg_temp.tl_ref('c17d') = 'Terrace' and pg_temp.tl_link('c17d') = pg_temp.tl_id('Terrace'),
    'T17 FAIL: a given table_ref beat the word raw carries';
  assert pg_temp.tl_tables('Nook') = 0, 'T17 FAIL: the overridden word learned a table';
end $$;

-- T18: the word follows the till on a re-send. The same payload keeps word and
-- link; a payload naming Snug moves both; a payload naming no table clears
-- both; an update writing only raw re-resolves a changed word; and a word a
-- writer set itself stands when raw, carrying none, is written again.
do $$
declare
  terrace uuid := pg_temp.tl_id('Terrace');
  n bigint := pg_temp.tl_tables();
begin
  assert pg_temp.tl_hub('c17a', '{"tableRef": " Terrace "}') = terrace and pg_temp.tl_ref('c17a') = 'Terrace',
    'T18 FAIL: an unchanged re-send moved the check or its word';
  assert pg_temp.tl_tables() = n, 'T18 FAIL: an unchanged re-send learned a table';

  assert pg_temp.tl_hub('c17a', '{"tableRef": "Snug", "closed": true}') = pg_temp.tl_id('Snug'),
    'T18 FAIL: a re-send naming Snug did not move the check there';
  assert pg_temp.tl_ref('c17a') = 'Snug', 'T18 FAIL: table_ref did not follow raw to Snug';

  assert pg_temp.tl_hub('c17a', '{"closed": true}') is null,
    'T18 FAIL: a re-send naming no table kept a table';
  assert pg_temp.tl_ref('c17a') is null,
    'T18 FAIL: a re-send naming no table kept the old word ' || coalesce(pg_temp.tl_ref('c17a'), '');

  update public.pos_checks set raw = '{"tableRef": "Snug"}'
   where restaurant_id = pg_temp.tl_house() and external_check_id = 'c17b';
  assert pg_temp.tl_ref('c17b') = 'Snug' and pg_temp.tl_link('c17b') = pg_temp.tl_id('Snug'),
    'T18 FAIL: an update writing only raw left the link on the old word''s table';

  insert into public.pos_checks (restaurant_id, source, external_check_id, opened_at, table_ref, raw)
  values (pg_temp.tl_house(), 'csv_import', 'c18', now(), 'Terrace', '{"note": 1}');
  update public.pos_checks set raw = '{"note": 2}'
   where restaurant_id = pg_temp.tl_house() and external_check_id = 'c18';
  assert pg_temp.tl_ref('c18') = 'Terrace' and pg_temp.tl_link('c18') = terrace,
    'T18 FAIL: a writer''s own word went when raw, naming none, was written again';
end $$;

rollback;

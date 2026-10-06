-- ADR 0281, fork F2: migration old_pos_rows_carry_their_check_date re-dates
-- the POS stock and consumption rows written before a_pos_sale_is_dated_by_its_check
-- (#603) to LEAST(their check's closed_at, their created_at), logs every old
-- value first, and can put them back.
--
-- Self-asserting: every block raises on a failure (assert -> P0004, or the
-- error itself), so `psql -v ON_ERROR_STOP=1 -f` stops at the first one. Run it
-- on a database built from supabase/migrations. It must FAIL on a build without
-- that migration (T0: no undo table, no functions) and PASS with it. One
-- transaction, rolled back: it leaves nothing behind. All fixtures are
-- SYNTHETIC under two houses of their own (ids f2ed0000-…); counts that the
-- functions report for the whole database are compared with what the
-- classification saw outside the fixtures, so a populated database does not
-- break them.
--
-- The fixtures cover every outcome (change, already, no check, check open,
-- unreadable, ambiguous, out of scope), each row kind (keyed ledger, glass-pour
-- ledger, consumption), a void, a legacy 'pos:pos:' note, a zone-less till
-- string, a check whose raw keeps no string, Square, Clover and Toast checks,
-- rows from the REAL apply_stock_movement and record_glass_pour both before
-- #603 (no p_occurred_at) and after it, and two non-POS rows that must never
-- be touched.
--
-- now() is the transaction's start time and does not move inside it, so every
-- row the real functions write here shares one created_at. Each real glass
-- pour therefore gets an item of its own: two pours of one item at one
-- instant would link to each other's pour events and read 'ambiguous'.
--
-- Never later (ADR 0281 F2, fork 1, founder 2026-10-05: "Never move a row
-- later (Recommended)"): a row whose every date is at or before its target
-- reads 'already' and is never written, and a 'change' row's dates each become
-- the earlier of themselves and the target. Three cases pin it, each read
-- 'change' or written later by the build before it (20d0bc79a):
--   * a check re-sent with a LATER closed_at after its rows were booked (L19
--     and its consumption row C15): neither moves (T8);
--   * a check whose closed_at is a few ms ahead of the row's created_at, booked
--     by the real functions with the gateway's clock 20 ms behind the
--     database's now() (L23, G6 and consumption C17): all read 'already' (T1);
--   * a consumption row whose recorded_at is already before its target while
--     its created_at is late (C16): created_at moves, recorded_at stays (T3).
--
--   T0  the undo table, RLS on, no client grants; the functions closed; no trigger
--   T1  every fixture row's outcome, target and check
--   T2  snapshots
--   T3  run 1 writes exactly the targets, and no date later than it was
--   T4  nothing else on any row moves; non-change rows are byte-identical
--   T5  pos_checks, pour_events and lots are not written
--   T6  the undo log holds the exact old values
--   T7  run 2 changes nothing (idempotent)
--   T8  re-sent checks: an earlier close moves that check's rows, a later one
--       moves none
--   T9  undo, newest run first; a row edited since is left as is
--   T10 every other row is back byte-identical; a second undo restores nothing

begin;

create function pg_temp.row_j(p_tbl text, p_id uuid) returns jsonb
language sql stable as $$
  select case p_tbl
           when 'it' then (select to_jsonb(x) from public.inventory_transactions x where x.id = p_id)
           else (select to_jsonb(x) from public.wine_consumption_log x where x.id = p_id)
         end
$$;

-- ---------------------------------------------------------------------------
-- T0 the objects, closed
-- ---------------------------------------------------------------------------
do $$
declare
  v_role text;
  v_fn text;
  n int;
begin
  assert to_regclass('public.pos_row_redate_undo') is not null,
    'T0 FAIL public.pos_row_redate_undo does not exist';
  assert (select c.relrowsecurity from pg_class c where c.oid = 'public.pos_row_redate_undo'::regclass),
    'T0 FAIL pos_row_redate_undo has RLS off';
  -- A local build has none of Supabase's default grants, so the role checks
  -- below cannot see a missing REVOKE on the table; an ACL that names only its
  -- owner shows the REVOKE ran (check_new_tables_are_locked_down.py reads the
  -- role list itself).
  assert (select c.relacl is not null
                 and not exists (select 1 from aclexplode(c.relacl) a where a.grantee <> c.relowner)
            from pg_class c where c.oid = 'public.pos_row_redate_undo'::regclass),
    'T0 FAIL pos_row_redate_undo carries a grant to a role other than its owner, or was never revoked';
  foreach v_fn in array array['public.pos_row_date_by_check()', 'public.redate_pos_rows_by_check()',
                               'public.undo_pos_rows_redate(uuid)'] loop
    assert to_regprocedure(v_fn) is not null, format('T0 FAIL %s does not exist', v_fn);
    assert not (select p.prosecdef from pg_proc p where p.oid = to_regprocedure(v_fn)),
      format('T0 FAIL %s is SECURITY DEFINER', v_fn);
  end loop;
  foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
    continue when not exists (select 1 from pg_roles where rolname = v_role);
    assert not has_table_privilege(v_role, 'public.pos_row_redate_undo', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'),
      format('T0 FAIL %s holds a privilege on pos_row_redate_undo', v_role);
    foreach v_fn in array array['public.pos_row_date_by_check()', 'public.redate_pos_rows_by_check()',
                                 'public.undo_pos_rows_redate(uuid)'] loop
      assert not has_function_privilege(v_role, v_fn, 'EXECUTE'),
        format('T0 FAIL %s may execute %s', v_role, v_fn);
    end loop;
  end loop;
  select count(*) into n from pg_trigger t
   where t.tgrelid in ('public.inventory_transactions'::regclass, 'public.wine_consumption_log'::regclass)
     and not t.tgisinternal;
  assert n = 0, format('T0 FAIL %s triggers on the two re-dated tables; the migration assumes none', n);
end $$;

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
insert into public.restaurants (id, name, slug, timezone) values
  ('f2ed0000-0000-4000-8000-000000000001', 'SYNTHETIC f2redate H1 Istanbul',    'syn-f2redate-1', 'Europe/Istanbul'),
  ('f2ed0000-0000-4000-8000-000000000002', 'SYNTHETIC f2redate H2 Los Angeles', 'syn-f2redate-2', 'America/Los_Angeles');

-- One wine per item: a house holds one item per wine.
insert into public.master_wine_library (id, wine_id, name, primary_type)
select ('f2ed0000-0000-4000-8000-0000000000a' || n)::uuid, 'SYN-F2REDATE-' || n,
       'SYNTHETIC F2 redate wine ' || n, 'red'
  from generate_series(1, 8) n;

-- b1 H1 direct rows; b2 H2 direct rows; b3 real pour before #603; b4 real pour
-- after #603; b5 real Toast pour; b6 real bottle sales; b7 non-POS rows; b8
-- real pour after #603 on a check closing ahead of the database's clock.
insert into public.restaurant_inventory (id, restaurant_id, master_wine_id, bottle_size_ml, pour_size_ml)
select ('f2ed0000-0000-4000-8000-0000000000b' || n)::uuid,
       (case when n = 2 then 'f2ed0000-0000-4000-8000-000000000002'
             else 'f2ed0000-0000-4000-8000-000000000001' end)::uuid,
       ('f2ed0000-0000-4000-8000-0000000000a' || n)::uuid, 750, 150
  from generate_series(1, 8) n;

insert into public.inventory_lots (restaurant_id, inventory_id, master_wine_id, qty, open_bottle_ml, received_at)
select 'f2ed0000-0000-4000-8000-000000000001', ('f2ed0000-0000-4000-8000-0000000000b' || n)::uuid,
       ('f2ed0000-0000-4000-8000-0000000000a' || n)::uuid, 10, 0, now() - interval '60 days'
  from unnest(array[3, 4, 5, 6, 8]) n;

-- Checks. closed_at is what Postgres stored from the till's string; raw keeps
-- the till's string as each adapter does.
insert into public.pos_checks (restaurant_id, source, external_check_id, opened_at, closed_at, raw)
select ('f2ed0000-0000-4000-8000-00000000000' || h)::uuid, src, ext,
       coalesce(closed::timestamptz, '2026-07-01T00:00:00Z'), closed::timestamptz, raw::jsonb
  from (values
    (1, 'csv_import', 'f2t-right',  '2026-07-10T18:00:00Z', '{"closedAt": "2026-07-10T18:00:00Z"}'),
    (1, 'csv_import', 'f2t-one',    '2026-10-01T20:30:00Z', '{"closedAt": "2026-10-01T20:30:00Z"}'),
    (1, 'csv_import', 'f2t-forty',  '2026-08-23T18:00:00Z', '{"closedAt": "2026-08-23T18:00:00Z"}'),
    (1, 'csv_import', 'f2t-ddmm',   '2026-03-10T00:00:00Z', '{"closedAt": "03.10.2026"}'),
    (1, 'csv_import', 'f2t-open',   null,                   '{"closedAt": null}'),
    (1, 'csv_import', 'amb-f2t',    '2026-09-25T10:00:00Z', '{"closedAt": "2026-09-25T10:00:00Z"}'),
    (1, 'csv_import', 'amb-f2t:x',  '2026-09-25T11:00:00Z', '{"closedAt": "2026-09-25T11:00:00Z"}'),
    (1, 'csv_import', 'f2t-future', '2026-10-05T12:00:00Z', '{"closedAt": "2026-10-05T12:00:00Z"}'),
    (1, 'csv_import', 'f2t-nozone', '2026-09-20T21:00:00Z', '{"closedAt": "2026-09-20 21:00"}'),
    (1, 'csv_import', 'f2t-noraw',  '2026-09-30T12:00:00Z', null),
    (1, 'csv_import', 'f2t-epoch',  '2026-09-21T12:00:00Z', '{"closedAt": 1790000000}'),
    (1, 'csv_import', 'f2t-off15',  '2026-09-29T19:00:00Z', '{"closedAt": "2026-09-30T10:00:00+15:00"}'),
    (1, 'csv_import', 'f2t-resend', '2026-09-10T18:00:00Z', '{"closedAt": "2026-09-10T18:00:00Z"}'),
    (1, 'square',     'f2t-sq',     '2026-09-12T18:00:00Z', '{"closed_at": "2026-09-12T18:00:00Z"}'),
    (1, 'clover',     'f2t-cl',     '2026-09-13T18:00:00Z', '{}'),
    (1, 'toast',      'f2t-tt',     '2026-09-14T00:00:00Z', '{"closedDate": "14/09/2026"}'),
    (2, 'csv_import', 'f2t-h2only', '2026-09-30T19:00:00Z', '{"closedAt": "2026-09-30T19:00:00Z"}'),
    (2, 'csv_import', 'f2t-h2pour', '2026-10-01T16:00:00Z', '{"closedAt": "2026-10-01T16:00:00Z"}')
  ) v(h, src, ext, closed, raw);

insert into public.pos_checks (restaurant_id, source, external_check_id, opened_at, closed_at, raw)
select 'f2ed0000-0000-4000-8000-000000000001', 'csv_import', e, c - interval '2 hours', c,
       jsonb_build_object('closedAt', to_char(c at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
  from (values ('f2t-rpc-bottle',  now() - interval '1 day'),
               ('f2t-post-bottle', now() - interval '3 days'),
               ('f2t-rpc-pour',    now() - interval '40 days'),
               ('f2t-post-pour',   now() - interval '5 days'),
               -- closes 30 ms after the database's now(), the rows' created_at
               ('f2t-ahead',       now() + interval '30 milliseconds')) v(e, c);

create function pg_temp.closed(p_ext text) returns timestamptz language sql stable as $$
  select c.closed_at from public.pos_checks c
   where c.restaurant_id in ('f2ed0000-0000-4000-8000-000000000001', 'f2ed0000-0000-4000-8000-000000000002')
     and c.external_check_id = p_ext
$$;

-- One line per fixture row: what it must classify as, its target, its check
-- and the key the undo log must name.
create temporary table t_row (
  name   text primary key,
  tbl    text not null check (tbl in ('it', 'wcl')),
  house  int not null,
  id     uuid not null unique,
  expect text not null,
  target timestamptz,
  chk    text,
  pkey   text
) on commit drop;

-- Ledger rows keyed 'pos:' (apply_stock_movement's shape) and two glass-pour
-- rows (record_glass_pour's: no key, metadata pours/bottles_opened). Import
-- instants: H1 2026-10-02 07:00Z, H2 2026-10-02 17:00Z. transaction_date is
-- the import instant unless given (the pre-#603 bodies wrote now()).
with v(name, n, h, item, ty, src, k, td, ca, md, expect, target, chk, pkey) as (values
  ('L0',  '100', 1, 7, 'purchase', 'manual', null, '2026-09-01T09:00:00Z', '2026-09-01T09:00:00Z', null, 'not pos', null, null, null),
  ('L1',  '101', 1, 1, 'sale',   'pos', 'pos:csv_import:f2t-right:w:1',      '2026-07-10T18:00:00Z', '2026-10-02T07:00:00Z', null, 'already',    '2026-07-10T18:00:00Z', 'f2t-right',  null),
  ('L2',  '102', 1, 1, 'sale',   'pos', 'pos:csv_import:f2t-one:w:1',        null, '2026-10-02T07:00:00Z', null, 'change',     '2026-10-01T20:30:00Z', 'f2t-one',    null),
  ('L3',  '103', 1, 1, 'sale',   'pos', 'pos:csv_import:f2t-forty:w:1',      null, '2026-10-02T07:00:00Z', null, 'change',     '2026-08-23T18:00:00Z', 'f2t-forty',  null),
  ('L4',  '104', 1, 1, 'return', 'pos', 'pos:csv_import:f2t-forty:w:1:void', null, '2026-10-02T07:00:00Z', null, 'change',     '2026-08-23T18:00:00Z', 'f2t-forty',  null),
  ('L5',  '105', 1, 1, 'sale',   'pos', 'pos:csv_import:f2t-ddmm:w:1',       null, '2026-10-03T07:00:00Z', null, 'unreadable', null, null, null),
  ('L6',  '106', 1, 1, 'sale',   'pos', 'pos:csv_import:f2t-open:w:1',       null, '2026-10-02T07:00:00Z', null, 'check open', null, null, null),
  ('L7',  '107', 1, 1, 'sale',   'pos', 'pos:csv_import:f2t-gone:w:1',       null, '2026-10-02T07:00:00Z', null, 'no check',   null, null, null),
  ('L8',  '108', 1, 1, 'sale',   'pos', 'pos:csv_import:amb-f2t:x:w:1',      null, '2026-10-02T07:00:00Z', null, 'ambiguous',  null, null, null),
  ('L9',  '109', 1, 1, 'sale',   'pos', 'pos:csv_import:amb-f2t:w:2',        null, '2026-10-02T07:00:00Z', null, 'change',     '2026-09-25T10:00:00Z', 'amb-f2t',    null),
  ('L10', '110', 1, 1, 'sale',   'pos', 'pos:csv_import:f2t-h2only:w:1',     null, '2026-10-02T07:00:00Z', null, 'no check',   null, null, null),
  ('L11', '111', 1, 1, 'sale',   'pos', 'pos:csv_import:f2t-future:w:1',     null, '2026-10-02T07:00:00Z', null, 'already',    '2026-10-02T07:00:00Z', 'f2t-future', null),
  ('L12', '112', 1, 1, 'sale',   'pos', 'pos:csv_import:f2t-nozone:w:1',     null, '2026-10-02T07:00:00Z', null, 'change',     '2026-09-20T21:00:00Z', 'f2t-nozone', null),
  ('L13', '113', 1, 1, 'sale',   'pos', 'pos:csv_import:f2t-noraw:w:1',      null, '2026-10-02T07:00:00Z', null, 'change',     '2026-09-30T12:00:00Z', 'f2t-noraw',  null),
  ('L14', '114', 1, 1, 'sale',   'pos', 'pos:csv_import:f2t-epoch:w:1',      null, '2026-10-02T07:00:00Z', null, 'unreadable', null, null, null),
  ('L15', '115', 1, 1, 'sale',   'pos', 'pos:csv_import:f2t-off15:w:1',      null, '2026-10-02T07:00:00Z', null, 'unreadable', null, null, null),
  ('L16', '116', 1, 1, 'sale',   'pos', 'pos:square:f2t-sq:w:1',             null, '2026-10-02T07:00:00Z', null, 'change',     '2026-09-12T18:00:00Z', 'f2t-sq',     null),
  ('L17', '117', 1, 1, 'sale',   'pos', 'pos:clover:f2t-cl:w:1',             null, '2026-10-02T07:00:00Z', null, 'change',     '2026-09-13T18:00:00Z', 'f2t-cl',     null),
  ('L18', '118', 1, 1, 'sale',   'pos', 'pos:toast:f2t-tt:w:1',              null, '2026-10-02T07:00:00Z', null, 'unreadable', null, null, null),
  ('L19', '119', 1, 1, 'sale',   'pos', 'pos:csv_import:f2t-resend:w:1',     '2026-09-10T18:00:00Z', '2026-09-11T07:00:00Z', null, 'already', '2026-09-10T18:00:00Z', 'f2t-resend', null),
  ('L20', '120', 2, 2, 'sale',   'pos', 'pos:csv_import:f2t-h2only:w:2',     null, '2026-10-02T17:00:00Z', null, 'change',     '2026-09-30T19:00:00Z', 'f2t-h2only', null),
  ('G1',  '131', 2, 2, 'sale',   'pos', null, null, '2026-10-02T17:00:00Z', '{"pours": 5, "pour_ml": 150, "bottles_opened": 1}', 'change', '2026-10-01T16:00:00Z', 'f2t-h2pour', 'pos:csv_import:f2t-h2pour:w:1'),
  ('G2',  '132', 2, 2, 'sale',   'pos', null, null, '2026-10-02T17:05:00Z', '{"pours": 5, "pour_ml": 150, "bottles_opened": 1}', 'ambiguous', null, null, null)
), ins as (
  insert into public.inventory_transactions
    (id, restaurant_id, inventory_id, wine_id, transaction_type, source, quantity_change,
     quantity_before, quantity_after, metadata, transaction_date, created_at, idempotency_key)
  select ('f2ed0000-0000-4000-8000-000000000' || v.n)::uuid,
         ('f2ed0000-0000-4000-8000-00000000000' || v.h)::uuid,
         ('f2ed0000-0000-4000-8000-0000000000b' || v.item)::uuid,
         ('f2ed0000-0000-4000-8000-0000000000a' || v.item)::uuid,
         v.ty::public.inventory_transaction_type, v.src::public.inventory_transaction_source,
         case when v.ty in ('return', 'purchase') then 1 else -1 end, 10,
         case when v.ty in ('return', 'purchase') then 11 else 9 end,
         coalesce(v.md::jsonb, '{}'::jsonb), coalesce(v.td, v.ca)::timestamptz, v.ca::timestamptz, v.k
    from v
  returning 1
)
insert into t_row (name, tbl, house, id, expect, target, chk, pkey)
select v.name, 'it', v.h, ('f2ed0000-0000-4000-8000-000000000' || v.n)::uuid, v.expect,
       v.target::timestamptz, v.chk, coalesce(v.pkey, case when v.expect = 'change' then v.k end)
  from v;

-- The glass-pour rows' keys live on pour_events, at the ledger row's instant.
-- G2's instant carries two pour events: ambiguous.
insert into public.pour_events (restaurant_id, inventory_id, pours, pour_ml, bottles_opened, source, idempotency_key, created_at) values
  ('f2ed0000-0000-4000-8000-000000000002', 'f2ed0000-0000-4000-8000-0000000000b2', 5, 150, 1, 'pos', 'pos:csv_import:f2t-h2pour:w:1', '2026-10-02T17:00:00Z'),
  ('f2ed0000-0000-4000-8000-000000000002', 'f2ed0000-0000-4000-8000-0000000000b2', 5, 150, 1, 'pos', 'pos:csv_import:f2t-h2pour:w:2', '2026-10-02T17:05:00Z'),
  ('f2ed0000-0000-4000-8000-000000000002', 'f2ed0000-0000-4000-8000-0000000000b2', 5, 150, 1, 'pos', 'pos:csv_import:f2t-h2pour:w:3', '2026-10-02T17:05:00Z');

-- Consumption rows (notes = the key). recorded_at is created_at unless given.
with v(name, n, h, item, src, k, ra, ca, expect, target, chk) as (values
  ('C0',  '200', 1, 7, 'manual', null, '2026-09-01T09:00:00Z', '2026-09-01T09:00:00Z', 'not pos', null, null),
  ('C1',  '201', 1, 1, 'pos', 'pos:csv_import:f2t-right:w:1',     '2026-07-10T18:00:00Z', '2026-07-10T18:00:00Z', 'already',    '2026-07-10T18:00:00Z', 'f2t-right'),
  ('C2',  '202', 1, 1, 'pos', 'pos:csv_import:f2t-one:w:1',       null, '2026-10-02T07:00:00Z', 'change',     '2026-10-01T20:30:00Z', 'f2t-one'),
  ('C3',  '203', 1, 1, 'pos', 'pos:pos:csv_import:f2t-forty:w:1', null, '2026-10-02T07:00:00Z', 'change',     '2026-08-23T18:00:00Z', 'f2t-forty'),
  ('C4',  '204', 1, 1, 'pos', 'pos:csv_import:f2t-ddmm:w:1',      null, '2026-10-03T07:00:00Z', 'unreadable', null, null),
  ('C5',  '205', 1, 1, 'pos', 'pos:csv_import:f2t-gone:w:1',      null, '2026-10-02T07:00:00Z', 'no check',   null, null),
  ('C6',  '206', 1, 1, 'pos', 'pos:csv_import:f2t-future:w:1',    null, '2026-10-02T07:00:00Z', 'already',    '2026-10-02T07:00:00Z', 'f2t-future'),
  ('C7',  '207', 1, 1, 'pos', 'pos:csv_import:f2t-nozone:w:1',    '2026-10-02T06:55:00Z', '2026-10-02T07:00:00Z', 'change', '2026-09-20T21:00:00Z', 'f2t-nozone'),
  ('C8',  '208', 1, 1, 'pos', 'pos:csv_import:f2t-open:w:1',      null, '2026-10-02T07:00:00Z', 'check open', null, null),
  ('C9',  '209', 1, 1, 'pos', 'pos:csv_import:amb-f2t:x:w:1',     null, '2026-10-02T07:00:00Z', 'ambiguous',  null, null),
  ('C12', '212', 2, 2, 'pos', 'pos:csv_import:f2t-h2only:w:2',    null, '2026-10-02T17:00:00Z', 'change',     '2026-09-30T19:00:00Z', 'f2t-h2only'),
  -- created_at already on the check; only recorded_at is late.
  ('C14', '214', 2, 2, 'pos', 'pos:csv_import:f2t-h2pour:w:9',    '2026-10-02T17:00:00Z', '2026-10-01T16:00:00Z', 'change', '2026-10-01T16:00:00Z', 'f2t-h2pour'),
  -- L19's consumption row, booked after #603 on its check's first close (T8
  -- re-sends that check to a later close).
  ('C15', '215', 1, 1, 'pos', 'pos:csv_import:f2t-resend:w:1',    '2026-09-10T18:00:00Z', '2026-09-10T18:00:00Z', 'already', '2026-09-10T18:00:00Z', 'f2t-resend'),
  -- created_at late, recorded_at already before the check closed: created_at
  -- moves to the target, recorded_at is never moved later.
  ('C16', '216', 1, 1, 'pos', 'pos:csv_import:f2t-forty:w:3',     '2026-08-20T12:00:00Z', '2026-10-02T07:00:00Z', 'change', '2026-08-23T18:00:00Z', 'f2t-forty')
), ins as (
  insert into public.wine_consumption_log
    (id, restaurant_id, inventory_id, wine_name, consumption_type, quantity, volume_ml, source, notes, recorded_at, created_at)
  select ('f2ed0000-0000-4000-8000-000000000' || v.n)::uuid,
         ('f2ed0000-0000-4000-8000-00000000000' || v.h)::uuid,
         ('f2ed0000-0000-4000-8000-0000000000b' || v.item)::uuid,
         'SYNTHETIC F2 redate', 'bottle', 1, 750, v.src, v.k,
         coalesce(v.ra, v.ca)::timestamptz, v.ca::timestamptz
    from v
  returning 1
)
insert into t_row (name, tbl, house, id, expect, target, chk, pkey)
select v.name, 'wcl', v.h, ('f2ed0000-0000-4000-8000-000000000' || v.n)::uuid, v.expect,
       v.target::timestamptz, v.chk,
       case when v.expect = 'change' then
         case when starts_with(v.k, 'pos:pos:') then substr(v.k, 5) else v.k end end
  from v;

-- Rows from the REAL functions: before #603 (no p_occurred_at, so dated now())
-- and after it (p_occurred_at = the check's closed_at).
do $$
declare
  v_house constant uuid := 'f2ed0000-0000-4000-8000-000000000001';
  v_id uuid;
  j jsonb;
begin
  v_id := public.apply_stock_movement(
    p_inventory_id => 'f2ed0000-0000-4000-8000-0000000000b6', p_stock_state => 'live', p_delta => -1,
    p_transaction_type => 'sale', p_source => 'pos', p_reason => 'SYNTHETIC F2 redate bottle, pre-#603',
    p_idempotency_key => 'pos:csv_import:f2t-rpc-bottle:w:1', p_restaurant_id => v_house);
  insert into t_row values ('L21', 'it', 1, v_id, 'change', pg_temp.closed('f2t-rpc-bottle'),
                            'f2t-rpc-bottle', 'pos:csv_import:f2t-rpc-bottle:w:1');

  v_id := public.apply_stock_movement(
    p_inventory_id => 'f2ed0000-0000-4000-8000-0000000000b6', p_stock_state => 'live', p_delta => -1,
    p_transaction_type => 'sale', p_source => 'pos', p_reason => 'SYNTHETIC F2 redate bottle, post-#603',
    p_idempotency_key => 'pos:csv_import:f2t-post-bottle:w:1', p_restaurant_id => v_house,
    p_occurred_at => pg_temp.closed('f2t-post-bottle'));
  insert into t_row values ('L22', 'it', 1, v_id, 'already', pg_temp.closed('f2t-post-bottle'),
                            'f2t-post-bottle', null);

  j := public.record_glass_pour(
    p_inventory_id => 'f2ed0000-0000-4000-8000-0000000000b3', p_pours => 1, p_pour_ml => 150,
    p_source => 'pos', p_reason => 'SYNTHETIC F2 redate pour, pre-#603',
    p_idempotency_key => 'pos:csv_import:f2t-rpc-pour:w:1');
  assert (j ->> 'txn') is not null, format('fixture: the pre-#603 pour wrote no ledger row: %s', j);
  insert into t_row values ('G3', 'it', 1, (j ->> 'txn')::uuid, 'change', pg_temp.closed('f2t-rpc-pour'),
                            'f2t-rpc-pour', 'pos:csv_import:f2t-rpc-pour:w:1');

  j := public.record_glass_pour(
    p_inventory_id => 'f2ed0000-0000-4000-8000-0000000000b4', p_pours => 1, p_pour_ml => 150,
    p_source => 'pos', p_reason => 'SYNTHETIC F2 redate pour, post-#603',
    p_idempotency_key => 'pos:csv_import:f2t-post-pour:w:1',
    p_occurred_at => pg_temp.closed('f2t-post-pour'));
  assert (j ->> 'txn') is not null, format('fixture: the post-#603 pour wrote no ledger row: %s', j);
  insert into t_row values ('G4', 'it', 1, (j ->> 'txn')::uuid, 'already', pg_temp.closed('f2t-post-pour'),
                            'f2t-post-pour', null);

  -- Toast's own key on the pour event: not a 'pos:' key, so out of scope.
  j := public.record_glass_pour(
    p_inventory_id => 'f2ed0000-0000-4000-8000-0000000000b5', p_pours => 1, p_pour_ml => 150,
    p_source => 'pos', p_reason => 'SYNTHETIC F2 redate Toast pour',
    p_idempotency_key => 'toast_sale_f2t_x');
  assert (j ->> 'txn') is not null, format('fixture: the Toast pour wrote no ledger row: %s', j);
  insert into t_row values ('G5', 'it', 1, (j ->> 'txn')::uuid, 'out of scope', null, null, null);

  -- The consumption rows the gateway writes beside them: before #603 at entry
  -- time, after it at the sale instant.
  insert into public.wine_consumption_log
    (id, restaurant_id, inventory_id, wine_name, consumption_type, quantity, volume_ml, source, notes, recorded_at, created_at)
  values
    ('f2ed0000-0000-4000-8000-000000000210', v_house, 'f2ed0000-0000-4000-8000-0000000000b6',
     'SYNTHETIC F2 redate', 'bottle', 1, 750, 'pos', 'pos:csv_import:f2t-rpc-bottle:w:1', now(), now()),
    ('f2ed0000-0000-4000-8000-000000000211', v_house, 'f2ed0000-0000-4000-8000-0000000000b6',
     'SYNTHETIC F2 redate', 'bottle', 1, 750, 'pos', 'pos:csv_import:f2t-post-bottle:w:1',
     pg_temp.closed('f2t-post-bottle'), pg_temp.closed('f2t-post-bottle'));
  insert into t_row values
    ('C10', 'wcl', 1, 'f2ed0000-0000-4000-8000-000000000210', 'change', pg_temp.closed('f2t-rpc-bottle'),
     'f2t-rpc-bottle', 'pos:csv_import:f2t-rpc-bottle:w:1'),
    ('C11', 'wcl', 1, 'f2ed0000-0000-4000-8000-000000000211', 'already', pg_temp.closed('f2t-post-bottle'),
     'f2t-post-bottle', null);

  -- A check closing 30 ms ahead of the database's now(), booked after #603:
  -- the gateway's clock read 20 ms before the database's now(), so it sent
  -- p_occurred_at = that reading and the rows are dated 20 ms before their
  -- created_at. Their target, LEAST(closed_at, created_at), is created_at,
  -- later than their date: never moved later, so 'already'.
  v_id := public.apply_stock_movement(
    p_inventory_id => 'f2ed0000-0000-4000-8000-0000000000b6', p_stock_state => 'live', p_delta => -1,
    p_transaction_type => 'sale', p_source => 'pos', p_reason => 'SYNTHETIC F2 redate bottle, check ahead',
    p_idempotency_key => 'pos:csv_import:f2t-ahead:w:1', p_restaurant_id => v_house,
    p_occurred_at => now() - interval '20 milliseconds');
  assert (pg_temp.row_j('it', v_id) ->> 'transaction_date')::timestamptz = now() - interval '20 milliseconds',
    'fixture: the check-ahead bottle sale is not dated 20 ms before now()';
  insert into t_row values ('L23', 'it', 1, v_id, 'already', now(), 'f2t-ahead', null);

  j := public.record_glass_pour(
    p_inventory_id => 'f2ed0000-0000-4000-8000-0000000000b8', p_pours => 1, p_pour_ml => 150,
    p_source => 'pos', p_reason => 'SYNTHETIC F2 redate pour, check ahead',
    p_idempotency_key => 'pos:csv_import:f2t-ahead:w:2',
    p_occurred_at => now() - interval '20 milliseconds');
  assert (j ->> 'txn') is not null, format('fixture: the check-ahead pour wrote no ledger row: %s', j);
  insert into t_row values ('G6', 'it', 1, (j ->> 'txn')::uuid, 'already', now(), 'f2t-ahead', null);

  insert into public.wine_consumption_log
    (id, restaurant_id, inventory_id, wine_name, consumption_type, quantity, volume_ml, source, notes, recorded_at, created_at)
  values
    ('f2ed0000-0000-4000-8000-000000000217', v_house, 'f2ed0000-0000-4000-8000-0000000000b6',
     'SYNTHETIC F2 redate', 'bottle', 1, 750, 'pos', 'pos:csv_import:f2t-ahead:w:1',
     now() - interval '20 milliseconds', now() - interval '20 milliseconds');
  insert into t_row values
    ('C17', 'wcl', 1, 'f2ed0000-0000-4000-8000-000000000217', 'already', now() - interval '20 milliseconds',
     'f2t-ahead', null);
end $$;

-- The fixture itself: every outcome class and every row kind is present.
do $$
declare
  n int;
begin
  select count(*) into n from t_row; assert n = 47, format('fixture: %s rows, expected 47', n);
  select count(*) into n from t_row where expect = 'change';       assert n = 19, format('fixture: %s change', n);
  select count(*) into n from t_row where expect = 'already';      assert n = 12, format('fixture: %s already', n);
  select count(*) into n from t_row where expect = 'no check';     assert n = 3,  format('fixture: %s no check', n);
  select count(*) into n from t_row where expect = 'check open';   assert n = 2,  format('fixture: %s check open', n);
  select count(*) into n from t_row where expect = 'unreadable';   assert n = 5,  format('fixture: %s unreadable', n);
  select count(*) into n from t_row where expect = 'ambiguous';    assert n = 3,  format('fixture: %s ambiguous', n);
  select count(*) into n from t_row where expect = 'out of scope'; assert n = 1,  format('fixture: %s out of scope', n);
  select count(*) into n from t_row where expect = 'not pos';      assert n = 2,  format('fixture: %s not pos', n);
  select count(distinct left(name, 1)) into n from t_row where expect = 'change';
  assert n = 3, 'fixture: change rows do not cover keyed, glass-pour and consumption';
  -- Never later: an 'already' row of each kind whose date is BEFORE its target.
  select count(distinct left(t.name, 1)) into n
    from t_row t
   where t.expect = 'already'
     and (case t.tbl when 'it' then (pg_temp.row_j(t.tbl, t.id) ->> 'transaction_date')
                     else (pg_temp.row_j(t.tbl, t.id) ->> 'created_at') end)::timestamptz < t.target;
  assert n = 2, format('fixture: %s kinds of ledger row sit before their target, expected keyed and glass pour', n);
end $$;

-- ---------------------------------------------------------------------------
-- T1 the classification
-- ---------------------------------------------------------------------------
create temporary table t_cls1 on commit drop as select * from public.pos_row_date_by_check();

-- Every mismatch is collected and named in one failure.
do $$
declare
  r record;
  bad text[] := '{}';
begin
  for r in
    select t.*, x.n, x.outcome, x.got, x.row_table, x.row_kind, x.pos_check_id, x.pos_key,
           (select c.id from public.pos_checks c
             where c.restaurant_id = ('f2ed0000-0000-4000-8000-00000000000' || t.house)::uuid
               and c.external_check_id = t.chk) as want_check
      from t_row t
      left join lateral (
        select count(*) as n, min(y.outcome) as outcome, min(y.target) as got,
               min(y.row_table) as row_table, min(y.row_kind) as row_kind,
               min(y.pos_check_id::text)::uuid as pos_check_id, min(y.pos_key) as pos_key
          from t_cls1 y where y.row_id = t.id) x on true
     order by t.name
  loop
    if r.expect = 'not pos' then
      if r.n <> 0 then bad := bad || format('%s is not a POS row but is listed as %s', r.name, r.outcome); end if;
      continue;
    end if;
    if r.n <> 1 then bad := bad || format('%s is listed %s times, expected once', r.name, r.n); continue; end if;
    if r.outcome <> r.expect then bad := bad || format('%s is %s, expected %s', r.name, r.outcome, r.expect); end if;
    if r.got is distinct from r.target then
      bad := bad || format('%s target %s, expected %s', r.name, r.got, r.target);
    end if;
    if r.row_table <> (case r.tbl when 'it' then 'inventory_transactions' else 'wine_consumption_log' end) then
      bad := bad || format('%s row_table %s', r.name, r.row_table);
    end if;
    if r.row_kind <> (case left(r.name, 1) when 'L' then 'ledger (key)'
                                           when 'G' then 'ledger (glass pour)' else 'consumption' end) then
      bad := bad || format('%s row_kind %s', r.name, r.row_kind);
    end if;
    if r.expect in ('change', 'already') and r.pos_check_id is distinct from r.want_check then
      bad := bad || format('%s matched check %s, expected %s (%s)', r.name, r.pos_check_id, r.want_check, r.chk);
    end if;
    if r.expect = 'change' and r.pos_key is distinct from r.pkey then
      bad := bad || format('%s key %s, expected %s', r.name, r.pos_key, r.pkey);
    end if;
  end loop;
  assert cardinality(bad) = 0, 'T1 FAIL ' || array_to_string(bad, '; ');
end $$;

-- ---------------------------------------------------------------------------
-- T2 snapshots
-- ---------------------------------------------------------------------------
create temporary table t_snap on commit drop as
select t.name, t.tbl, pg_temp.row_j(t.tbl, t.id) as j from t_row t;

create function pg_temp.side() returns jsonb language sql stable as $$
  select jsonb_build_object(
    'pos_checks', (select jsonb_agg(to_jsonb(c) order by c.id) from public.pos_checks c
                    where c.restaurant_id in ('f2ed0000-0000-4000-8000-000000000001', 'f2ed0000-0000-4000-8000-000000000002')),
    'pour_events', (select jsonb_agg(to_jsonb(p) order by p.id) from public.pour_events p
                     where p.restaurant_id in ('f2ed0000-0000-4000-8000-000000000001', 'f2ed0000-0000-4000-8000-000000000002')),
    'lots', (select jsonb_agg(to_jsonb(l) order by l.id) from public.inventory_lots l
              where l.restaurant_id in ('f2ed0000-0000-4000-8000-000000000001', 'f2ed0000-0000-4000-8000-000000000002')))
$$;

create temporary table t_side on commit drop as select pg_temp.side() as j;

-- What the classification saw outside the fixtures (0 on a fresh build).
create temporary table t_other on commit drop as
select count(*) filter (where y.outcome = 'change') as change_n,
       (select count(*) from public.pos_row_redate_undo u where u.undone_at is null) as open_before
  from t_cls1 y
 where y.row_id not in (select t.id from t_row t);

do $$
begin
  assert (select count(*) from t_snap where j is null) = 0, 'T2 FAIL a fixture row has no snapshot';
end $$;

-- ---------------------------------------------------------------------------
-- T3 run 1 writes exactly the targets
-- ---------------------------------------------------------------------------
create temporary table t_runs (run_no int primary key, res jsonb not null) on commit drop;
insert into t_runs select 1, public.redate_pos_rows_by_check();

-- A change row's dates each become the earlier of themselves and the target,
-- and no fixture row ends with any date later than it had. Every mismatch is
-- named in one failure.
do $$
declare
  v jsonb := (select res from t_runs where run_no = 1);
  v_other bigint := (select change_n from t_other);
  r record;
  bad text[] := '{}';
begin
  if (v ->> 'changed')::bigint <> 19 + v_other then
    bad := bad || format('run 1 changed %s rows, expected 19 fixture + %s other', v ->> 'changed', v_other);
  end if;
  if (v ->> 'logged')::bigint <> (v ->> 'changed')::bigint then
    bad := bad || format('run 1 logged %s', v ->> 'logged');
  end if;
  if (v ->> 'ledger_updated')::bigint + (v ->> 'consumption_updated')::bigint <> (v ->> 'changed')::bigint then
    bad := bad || format('run 1 updated %s + %s', v ->> 'ledger_updated', v ->> 'consumption_updated');
  end if;
  for r in select t.name, t.tbl, t.target, s.j as was, pg_temp.row_j(t.tbl, t.id) as j
             from t_row t join t_snap s using (name) where t.expect = 'change' loop
    if r.tbl = 'it' then
      if (r.j ->> 'transaction_date')::timestamptz is distinct from r.target then
        bad := bad || format('%s transaction_date %s, expected %s', r.name, r.j ->> 'transaction_date', r.target);
      end if;
    elsif (r.j ->> 'recorded_at')::timestamptz
            is distinct from least((r.was ->> 'recorded_at')::timestamptz, r.target)
       or (r.j ->> 'created_at')::timestamptz
            is distinct from least((r.was ->> 'created_at')::timestamptz, r.target) then
      bad := bad || format('%s recorded_at %s created_at %s, expected %s and %s', r.name,
                           r.j ->> 'recorded_at', r.j ->> 'created_at',
                           least((r.was ->> 'recorded_at')::timestamptz, r.target),
                           least((r.was ->> 'created_at')::timestamptz, r.target));
    end if;
  end loop;
  for r in select t.name, t.tbl, s.j as was, pg_temp.row_j(t.tbl, t.id) as j
             from t_row t join t_snap s using (name) loop
    if (r.tbl = 'it' and (r.j ->> 'transaction_date')::timestamptz > (r.was ->> 'transaction_date')::timestamptz)
       or (r.tbl = 'wcl' and ((r.j ->> 'recorded_at')::timestamptz > (r.was ->> 'recorded_at')::timestamptz
                           or (r.j ->> 'created_at')::timestamptz > (r.was ->> 'created_at')::timestamptz)) then
      bad := bad || format('%s moved later', r.name);
    end if;
  end loop;
  assert cardinality(bad) = 0, 'T3 FAIL ' || array_to_string(bad, '; ');
end $$;

-- ---------------------------------------------------------------------------
-- T4 nothing else on any row moves
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in select t.name, t.tbl, t.expect, s.j as was, pg_temp.row_j(t.tbl, t.id) as now_
             from t_row t join t_snap s using (name) loop
    if r.expect <> 'change' then
      assert r.now_ = r.was, format('T4 FAIL %s (%s) was written: %s -> %s', r.name, r.expect, r.was, r.now_);
    elsif r.tbl = 'it' then
      assert (r.now_ - 'transaction_date') = (r.was - 'transaction_date'),
        format('T4 FAIL %s moved more than transaction_date', r.name);
    else
      assert (r.now_ - 'recorded_at' - 'created_at') = (r.was - 'recorded_at' - 'created_at'),
        format('T4 FAIL %s moved more than recorded_at and created_at', r.name);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- T5 checks, pour events and lots are not written
-- ---------------------------------------------------------------------------
do $$
begin
  assert pg_temp.side() = (select j from t_side), 'T5 FAIL pos_checks, pour_events or inventory_lots changed';
end $$;

-- ---------------------------------------------------------------------------
-- T6 the undo log holds the exact old values
-- ---------------------------------------------------------------------------
do $$
declare
  v_run uuid := (select (res ->> 'run_id')::uuid from t_runs where run_no = 1);
  r record;
  n bigint;
begin
  select count(*) into n from public.pos_row_redate_undo u where u.run_id = v_run;
  assert n = 19 + (select change_n from t_other), format('T6 FAIL run 1 logged %s lines', n);
  select count(*) into n from public.pos_row_redate_undo u
   where u.run_id = v_run and u.row_id in (select t.id from t_row t where t.expect <> 'change');
  assert n = 0, format('T6 FAIL %s non-change fixture rows were logged', n);
  for r in
    select t.name, t.tbl, t.target, t.pkey, s.j as was, u.*,
           (select c.id from public.pos_checks c
             where c.restaurant_id = ('f2ed0000-0000-4000-8000-00000000000' || t.house)::uuid
               and c.external_check_id = t.chk) as want_check
      from t_row t
      join t_snap s using (name)
      left join public.pos_row_redate_undo u on u.run_id = v_run and u.row_id = t.id
     where t.expect = 'change'
  loop
    assert r.id is not null, format('T6 FAIL %s has no undo line', r.name);
    assert r.row_table = case r.tbl when 'it' then 'inventory_transactions' else 'wine_consumption_log' end
       and r.row_kind = case left(r.name, 1) when 'L' then 'ledger (key)'
                                             when 'G' then 'ledger (glass pour)' else 'consumption' end,
      format('T6 FAIL %s logged as %s / %s', r.name, r.row_table, r.row_kind);
    assert r.restaurant_id = ('f2ed0000-0000-4000-8000-00000000000' || (select house from t_row where name = r.name))::uuid,
      format('T6 FAIL %s logged restaurant %s', r.name, r.restaurant_id);
    assert r.pos_check_id = r.want_check and r.pos_key = r.pkey,
      format('T6 FAIL %s logged check %s key %s', r.name, r.pos_check_id, r.pos_key);
    assert r.new_date = r.target and r.undone_at is null and r.redated_at = (select (x.res ->> 'redated_at')::timestamptz from t_runs x where x.run_no = 1),
      format('T6 FAIL %s logged new_date %s undone_at %s', r.name, r.new_date, r.undone_at);
    if r.tbl = 'it' then
      assert r.old_transaction_date = (r.was ->> 'transaction_date')::timestamptz
         and r.old_recorded_at is null and r.old_created_at is null,
        format('T6 FAIL %s logged %s / %s / %s, was %s', r.name, r.old_transaction_date,
               r.old_recorded_at, r.old_created_at, r.was ->> 'transaction_date');
    else
      assert r.old_transaction_date is null
         and r.old_recorded_at = (r.was ->> 'recorded_at')::timestamptz
         and r.old_created_at = (r.was ->> 'created_at')::timestamptz,
        format('T6 FAIL %s logged %s / %s / %s', r.name, r.old_transaction_date, r.old_recorded_at, r.old_created_at);
    end if;
  end loop;
end $$;


-- ---------------------------------------------------------------------------
-- T7 run 2 changes nothing: every row run 1 moved now reads 'already'
-- ---------------------------------------------------------------------------
insert into t_runs select 2, public.redate_pos_rows_by_check();

do $$
declare
  v jsonb := (select res from t_runs where run_no = 2);
  r record;
begin
  assert (v ->> 'changed')::bigint = 0 and (v ->> 'logged')::bigint = 0,
    format('T7 FAIL run 2 changed %s and logged %s; a re-run must change nothing', v ->> 'changed', v ->> 'logged');
  assert (select count(*) from public.pos_row_redate_undo u
           where u.run_id = (v ->> 'run_id')::uuid) = 0, 'T7 FAIL run 2 wrote undo lines';
  for r in select t.name, t.expect, y.outcome, y.target
             from t_row t join public.pos_row_date_by_check() y on y.row_id = t.id loop
    assert r.outcome = case r.expect when 'change' then 'already' else r.expect end,
      format('T7 FAIL after run 1, %s reads %s (was %s)', r.name, r.outcome, r.expect);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- T8 checks re-sent with another closed_at after their rows were booked.
-- f2t-one goes to an EARLIER close: the next run moves its ledger and
-- consumption rows together (L2, C2). f2t-resend goes to a LATER close: its
-- rows (L19, C15) already sit at or before their targets, so neither is
-- written (never later, fork 1). Nothing else moves.
-- ---------------------------------------------------------------------------
update public.pos_checks
   set closed_at = '2026-09-10T20:00:00Z', raw = '{"closedAt": "2026-09-10T20:00:00Z"}'
 where restaurant_id = 'f2ed0000-0000-4000-8000-000000000001' and external_check_id = 'f2t-resend';
update public.pos_checks
   set closed_at = '2026-10-01T19:00:00Z', raw = '{"closedAt": "2026-10-01T19:00:00Z"}'
 where restaurant_id = 'f2ed0000-0000-4000-8000-000000000001' and external_check_id = 'f2t-one';

create temporary table t_cls3 on commit drop as select * from public.pos_row_date_by_check();
insert into t_runs select 3, public.redate_pos_rows_by_check();

do $$
declare
  v jsonb := (select res from t_runs where run_no = 3);
  v_run uuid := (select (res ->> 'run_id')::uuid from t_runs where run_no = 3);
  l2 uuid := (select id from t_row where name = 'L2');
  c2 uuid := (select id from t_row where name = 'C2');
  l19 uuid := (select id from t_row where name = 'L19');
  c15 uuid := (select id from t_row where name = 'C15');
  n bigint;
  bad text[] := '{}';
begin
  if (v ->> 'changed')::bigint <> 2 then
    bad := bad || format('run 3 changed %s rows, expected L2 and C2', v ->> 'changed');
  end if;
  -- L19's target is the new close (its created_at is later); C15's is its
  -- created_at, the old close. Each date sits at or before its target.
  select count(*) into n from t_cls3 y
   where (y.row_id = l19 and y.outcome = 'already' and y.target = '2026-09-10T20:00:00Z')
      or (y.row_id = c15 and y.outcome = 'already' and y.target = '2026-09-10T18:00:00Z');
  if n <> 2 then
    bad := bad || format('after the later re-send, %s of L19 (target 20:00Z) and C15 (target 18:00Z) read already', n);
  end if;
  if (pg_temp.row_j('it', l19) ->> 'transaction_date')::timestamptz <> '2026-09-10T18:00:00Z' then
    bad := bad || format('L19 moved to %s on a later re-send', pg_temp.row_j('it', l19) ->> 'transaction_date');
  end if;
  if (pg_temp.row_j('wcl', c15) ->> 'recorded_at')::timestamptz <> '2026-09-10T18:00:00Z'
     or (pg_temp.row_j('wcl', c15) ->> 'created_at')::timestamptz <> '2026-09-10T18:00:00Z' then
    bad := bad || 'C15 moved on a later re-send';
  end if;
  if (pg_temp.row_j('it', l2) ->> 'transaction_date')::timestamptz <> '2026-10-01T19:00:00Z' then
    bad := bad || 'L2 does not carry its earlier re-sent close';
  end if;
  if (pg_temp.row_j('wcl', c2) ->> 'recorded_at')::timestamptz <> '2026-10-01T19:00:00Z'
     or (pg_temp.row_j('wcl', c2) ->> 'created_at')::timestamptz <> '2026-10-01T19:00:00Z' then
    bad := bad || 'C2 does not carry its earlier re-sent close';
  end if;
  select count(*) into n from public.pos_row_redate_undo u where u.run_id = v_run;
  if n <> 2 then bad := bad || format('run 3 logged %s lines, expected 2', n); end if;
  select count(*) into n from public.pos_row_redate_undo u
   where u.run_id = v_run
     and ((u.row_id = l2 and u.old_transaction_date = '2026-10-01T20:30:00Z')
       or (u.row_id = c2 and u.old_recorded_at = '2026-10-01T20:30:00Z' and u.old_created_at = '2026-10-01T20:30:00Z'));
  if n <> 2 then bad := bad || format('run 3 logged %s of L2 and C2 with their run-1 values', n); end if;
  assert cardinality(bad) = 0, 'T8 FAIL ' || array_to_string(bad, '; ');
end $$;

-- ---------------------------------------------------------------------------
-- T9 undo, newest run first. L3's date and C7's created_at are edited by
-- hand after run 1: the undo must leave both rows whole, and say so.
-- ---------------------------------------------------------------------------
update public.inventory_transactions set transaction_date = '2026-08-01T00:00:00Z'
 where id = (select id from t_row where name = 'L3');
update public.wine_consumption_log set created_at = '2026-09-01T00:00:00Z'
 where id = (select id from t_row where name = 'C7');

create temporary table t_undo (undo_no int primary key, res jsonb not null, open_lines bigint, open_runs bigint,
                               other_open bigint) on commit drop;
insert into t_undo
select 1, public.undo_pos_rows_redate(), o.lines, o.runs, o.other
  from (select count(*) as lines, count(distinct u.run_id) as runs,
               count(*) filter (where u.row_id not in (select t.id from t_row t)) as other
          from public.pos_row_redate_undo u where u.undone_at is null) o;

do $$
declare
  x record;
  n bigint;
begin
  select * into x from t_undo where undo_no = 1;
  assert (x.res ->> 'runs')::bigint = x.open_runs,
    format('T9 FAIL undo went through %s runs, %s were open', x.res ->> 'runs', x.open_runs);
  assert (x.res ->> 'ledger_restored')::bigint + (x.res ->> 'consumption_restored')::bigint
         + (x.res ->> 'left_as_is')::bigint = x.open_lines,
    format('T9 FAIL undo accounted for %s of %s open lines', x.res, x.open_lines);
  if x.other_open = 0 then
    -- run 3: L2 and C2; run 1: 12 ledger and 7 consumption, less L3 and C7.
    assert (x.res ->> 'ledger_restored')::bigint = 12 and (x.res ->> 'consumption_restored')::bigint = 7
       and (x.res ->> 'left_as_is')::bigint = 2,
      format('T9 FAIL undo reported %s, expected 12 ledger, 7 consumption, 2 left as is', x.res);
  end if;
  -- Every fixture line is closed, except L3's and C7's.
  select count(*) into n from public.pos_row_redate_undo u
   where u.row_id in (select t.id from t_row t) and u.undone_at is null;
  assert n = 2, format('T9 FAIL %s fixture undo lines still open, expected L3''s and C7''s', n);
  assert (select count(*) from public.pos_row_redate_undo u
           where u.row_id in (select id from t_row where name in ('L3', 'C7')) and u.undone_at is null) = 2,
    'T9 FAIL an undo line was closed though its row was not restored';
  assert (pg_temp.row_j('it', (select id from t_row where name = 'L3')) ->> 'transaction_date')::timestamptz
         = '2026-08-01T00:00:00Z', 'T9 FAIL undo overwrote L3''s later edit';
  assert (pg_temp.row_j('wcl', (select id from t_row where name = 'C7')) ->> 'created_at')::timestamptz
         = '2026-09-01T00:00:00Z'
     and (pg_temp.row_j('wcl', (select id from t_row where name = 'C7')) ->> 'recorded_at')::timestamptz
         = (select target from t_row where name = 'C7'),
    'T9 FAIL undo touched C7, whose created_at was edited since';
end $$;

-- ---------------------------------------------------------------------------
-- T10 every other row is back exactly; a second undo restores nothing
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in select t.name, t.tbl, s.j as was, pg_temp.row_j(t.tbl, t.id) as now_
             from t_row t join t_snap s using (name) loop
    if r.name = 'L3' then
      assert (r.now_ - 'transaction_date') = (r.was - 'transaction_date'), 'T10 FAIL L3 moved more than its date';
    elsif r.name = 'C7' then
      assert (r.now_ - 'recorded_at' - 'created_at') = (r.was - 'recorded_at' - 'created_at'),
        'T10 FAIL C7 moved more than its dates';
    else
      assert r.now_ = r.was, format('T10 FAIL %s is not back to its old value: %s -> %s', r.name, r.was, r.now_);
    end if;
  end loop;
end $$;

insert into t_undo
select 2, public.undo_pos_rows_redate(), null, null, null;

do $$
declare
  v jsonb := (select res from t_undo where undo_no = 2);
  r record;
begin
  assert (v ->> 'ledger_restored')::bigint = 0 and (v ->> 'consumption_restored')::bigint = 0,
    format('T10 FAIL a second undo restored rows: %s', v);
  assert (v ->> 'left_as_is')::bigint = (select (x.res ->> 'left_as_is')::bigint from t_undo x where x.undo_no = 1),
    format('T10 FAIL a second undo left %s rows, the first left %s', v ->> 'left_as_is',
           (select x.res ->> 'left_as_is' from t_undo x where x.undo_no = 1));
  for r in select t.name, t.tbl, s.j as was, pg_temp.row_j(t.tbl, t.id) as now_
             from t_row t join t_snap s using (name) where t.name not in ('L3', 'C7') loop
    assert r.now_ = r.was, format('T10 FAIL the second undo moved %s', r.name);
  end loop;
end $$;

rollback;

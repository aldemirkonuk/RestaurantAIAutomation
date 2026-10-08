-- Synthetic fixtures for the ADR 0281 F2 dry-run proof (postime-f2-dryrun.sql).
-- Scratch database only (a clone of main_tpl with the two later migrations applied,
-- i.e. main 2b6782291's schema). Never production. Four houses:
--   H1 Europe/Istanbul (UTC+3, no DST)   H2 America/Los_Angeles (PDT, UTC-7)
--   H3 zone not set (NULL)               H4 a zone Postgres does not know
-- Rows written "before #603" are inserted with transaction_date = created_at (and, for
-- consumption, recorded_at = created_at) = the import instant, as the old bodies did
-- (now() on both). Three rows are written by the REAL functions with p_occurred_at
-- omitted (the pre-#603 gateway's call), to prove the shape and the pour link.
-- Expected outcome per row is in the trailing comment; postime-f2-dryrun-local.txt
-- checks every number against these.
\set ON_ERROR_STOP 1

insert into public.restaurants (id, name, slug, timezone) values
  ('d0f20000-0000-4000-8000-000000000001', 'dry-f2 H1 Istanbul',    'dry-f2-1', 'Europe/Istanbul'),
  ('d0f20000-0000-4000-8000-000000000002', 'dry-f2 H2 Los Angeles', 'dry-f2-2', 'America/Los_Angeles'),
  ('d0f20000-0000-4000-8000-000000000003', 'dry-f2 H3 no zone',     'dry-f2-3', null),
  ('d0f20000-0000-4000-8000-000000000004', 'dry-f2 H4 bad zone',    'dry-f2-4', 'Mars/Olympus_Mons');

insert into public.master_wine_library (id, wine_id, name, primary_type) values
  ('d0f20000-0000-4000-8000-0000000000a1', 'SYN-F2-1', 'SYNTHETIC F2 Kalecik', 'red');

insert into public.restaurant_inventory (id, restaurant_id, master_wine_id, bottle_size_ml, pour_size_ml)
select ('d0f20000-0000-4000-8000-0000000000b' || n)::uuid,
       ('d0f20000-0000-4000-8000-00000000000' || n)::uuid,
       'd0f20000-0000-4000-8000-0000000000a1', 750, 150
  from generate_series(1, 4) n;

-- Checks. closed_at is what Postgres stored from the till's string (session zone UTC,
-- DateStyle ISO, MDY), raw keeps the till's string as the generic/csv adapter does.
insert into public.pos_checks (restaurant_id, source, external_check_id, opened_at, closed_at, raw)
select ('d0f20000-0000-4000-8000-00000000000' || h)::uuid, 'csv_import', ext,
       coalesce(closed::timestamptz, '2026-08-01T00:00:00Z'), closed::timestamptz, raw::jsonb
  from (values
    (1, 'h1-right',  '2026-07-10T18:00:00Z', '{"closedAt": "2026-07-10T18:00:00Z"}'),
    (1, 'h1-one',    '2026-10-01T20:30:00Z', '{"closedAt": "2026-10-01T20:30:00Z"}'),
    (1, 'h1-same',   '2026-10-01T22:30:00Z', '{"closedAt": "2026-10-01T22:30:00Z"}'),
    (1, 'h1-forty',  '2026-08-23T18:00:00Z', '{"closedAt": "2026-08-23T18:00:00Z"}'),
    (1, 'h1-ddmm',   '2026-03-10T00:00:00Z', '{"closedAt": "03.10.2026"}'),            -- Postgres read 10 March
    (1, 'h1-open',   null,                   '{"closedAt": null}'),                     -- re-sent open
    (1, 'amb',       '2026-09-25T10:00:00Z', '{"closedAt": "2026-09-25T10:00:00Z"}'),
    (1, 'amb:x',     '2026-09-25T11:00:00Z', '{"closedAt": "2026-09-25T11:00:00Z"}'),
    (1, 'h1-future', '2026-10-05T12:00:00Z', '{"closedAt": "2026-10-05T12:00:00Z"}'),
    (1, 'h1-nozone', '2026-09-20T21:00:00Z', '{"closedAt": "2026-09-20 21:00"}'),        -- zone-less, read in UTC
    (1, 'h1-noraw',  '2026-09-30T12:00:00Z', null),                                     -- till string not kept
    (1, 'h1-epoch',  '2026-09-21T12:00:00Z', '{"closedAt": 1790000000}'),               -- not a string
    (1, 'h1-off15',  '2026-09-29T19:00:00Z', '{"closedAt": "2026-09-30T10:00:00+15:00"}'), -- offset > 14 h
    (1, 'h1-off3',   '2026-09-30T18:00:00Z', '{"closed_at": "2026-09-30T21:00:00+03:00"}'),
    (2, 'h2-right',  '2026-09-15T02:00:00Z', '{"closedAt": "2026-09-15T02:00:00Z"}'),
    (2, 'h2-five',   '2026-09-28T03:00:00Z', '{"closedAt": "2026-09-28T03:00:00Z"}'),
    (2, 'h2-thirteen','2026-09-20T06:30:00Z','{"closedAt": "2026-09-20T06:30:00Z"}'),
    (2, 'h2-only',   '2026-09-30T19:00:00Z', '{"closedAt": "2026-09-30T19:00:00Z"}'),
    (2, 'h2-pour',   '2026-10-01T16:00:00Z', '{"closedAt": "2026-10-01T16:00:00Z"}'),
    (3, 'h3-forty',  '2026-08-23T18:00:00Z', '{"closedAt": "2026-08-23T18:00:00Z"}'),
    (3, 'h3-short',  '2026-10-02T05:30:00Z', '{"closedAt": "2026-10-02T05:30:00Z"}'),
    (3, 'h3-30h',    '2026-10-01T01:00:00Z', '{"closedAt": "2026-10-01T01:00:00Z"}'),
    (4, 'h4-30h',    '2026-10-01T01:00:00Z', '{"closedAt": "2026-10-01T01:00:00Z"}')
  ) v(h, ext, closed, raw);

-- Ledger rows keyed 'pos:' (apply_stock_movement shape). cur = transaction_date.
-- Import instants: H1/H3/H4 2026-10-02 07:00Z (Istanbul 10:00), H2 2026-10-02 17:00Z (LA 10:00).
insert into public.inventory_transactions
  (restaurant_id, inventory_id, wine_id, transaction_type, source, quantity_change,
   quantity_before, quantity_after, transaction_date, created_at, idempotency_key)
select ('d0f20000-0000-4000-8000-00000000000' || h)::uuid,
       ('d0f20000-0000-4000-8000-0000000000b' || h)::uuid,
       'd0f20000-0000-4000-8000-0000000000a1',
       case when k like '%:void' then 'return' else 'sale' end::public.inventory_transaction_type,
       'pos', case when k like '%:void' then 1 else -1 end, 10,
       case when k like '%:void' then 11 else 9 end,
       coalesce(td, ca)::timestamptz, ca::timestamptz, k
  from (values
    (1, 'pos:csv_import:h1-right:w:1',     '2026-07-10T18:00:00Z', '2026-10-02T07:00:00Z'), -- already (post-#603 shape)
    (1, 'pos:csv_import:h1-one:w:1',       null, '2026-10-02T07:00:00Z'),  -- change, 1 house day, -10:30
    (1, 'pos:csv_import:h1-same:w:1',      null, '2026-10-02T07:00:00Z'),  -- change, 0 house days, -08:30
    (1, 'pos:csv_import:h1-forty:w:1',     null, '2026-10-02T07:00:00Z'),  -- change, 40 house days, -39d13h
    (1, 'pos:csv_import:h1-forty:w:1:void',null, '2026-10-02T07:00:00Z'),  -- change, 40, void
    (1, 'pos:csv_import:h1-ddmm:w:1',      null, '2026-10-03T07:00:00Z'),  -- unreadable
    (1, 'pos:csv_import:h1-open:w:1',      null, '2026-10-02T07:00:00Z'),  -- check open
    (1, 'pos:csv_import:h1-gone:w:1',      null, '2026-10-02T07:00:00Z'),  -- no check
    (1, 'pos:csv_import:amb:x:w:1',        null, '2026-10-02T07:00:00Z'),  -- ambiguous (amb, amb:x)
    (1, 'pos:csv_import:amb:w:2',          null, '2026-10-02T07:00:00Z'),  -- change, 7 house days, -6d21h
    (1, 'pos:csv_import:h2-only:w:1',      null, '2026-10-02T07:00:00Z'),  -- no check, other house
    (1, 'pos:csv_import:h1-future:w:1',    null, '2026-10-02T07:00:00Z'),  -- already (clamped)
    (1, 'pos:csv_import:h1-nozone:w:1',    null, '2026-10-02T07:00:00Z'),  -- change, 11 house days, no-zone caveat
    (1, 'pos:csv_import:h1-noraw:w:1',     null, '2026-10-02T07:00:00Z'),  -- change, 2 house days, not-kept caveat
    (1, 'pos:csv_import:h1-epoch:w:1',     null, '2026-10-02T07:00:00Z'),  -- unreadable (number)
    (1, 'pos:csv_import:h1-off15:w:1',     null, '2026-10-02T07:00:00Z'),  -- unreadable (+15:00)
    (1, 'pos:csv_import:h1-off3:w:1',      null, '2026-10-02T07:00:00Z'),  -- change, 2 house days
    (2, 'pos:csv_import:h2-right:w:1',     '2026-09-15T02:00:00Z', '2026-10-02T17:00:00Z'), -- already
    (2, 'pos:csv_import:h2-five:w:1',      null, '2026-10-02T17:00:00Z'),  -- change, 5 LA days (4 UTC days)
    (2, 'pos:csv_import:h2-thirteen:w:1',  null, '2026-10-02T17:00:00Z'),  -- change, 13 LA days
    (2, 'pos:csv_import:h2-only:w:2',      null, '2026-10-02T17:00:00Z'),  -- change, 2 LA days, -1d22h
    (3, 'pos:csv_import:h3-forty:w:1',     null, '2026-10-02T07:00:00Z'),  -- change, 949 h
    (3, 'pos:csv_import:h3-short:w:1',     null, '2026-10-02T07:00:00Z'),  -- change, 1.5 h
    (3, 'pos:csv_import:h3-30h:w:1',       null, '2026-10-02T07:00:00Z'),  -- change, 30 h
    (4, 'pos:csv_import:h4-30h:w:1',       null, '2026-10-02T07:00:00Z')   -- change, 30 h (zone unknown)
  ) v(h, k, td, ca);

-- Glass-pour ledger rows, pre-#603 shape: no idempotency_key on the ledger row; the
-- key is on pour_events, which shares the RPC's now() as created_at.
insert into public.pour_events (restaurant_id, inventory_id, pours, pour_ml, bottles_opened, source, idempotency_key, created_at) values
  ('d0f20000-0000-4000-8000-000000000002', 'd0f20000-0000-4000-8000-0000000000b2', 5, 150, 1, 'pos', 'pos:csv_import:h2-pour:w:1', '2026-10-02T17:00:00Z'),
  ('d0f20000-0000-4000-8000-000000000002', 'd0f20000-0000-4000-8000-0000000000b2', 5, 150, 1, 'pos', 'pos:csv_import:h2-pour:w:2', '2026-10-02T17:05:00Z'),
  ('d0f20000-0000-4000-8000-000000000002', 'd0f20000-0000-4000-8000-0000000000b2', 5, 150, 1, 'pos', 'pos:csv_import:h2-pour:w:3', '2026-10-02T17:05:00Z');
insert into public.inventory_transactions
  (restaurant_id, inventory_id, wine_id, transaction_type, source, quantity_change,
   quantity_before, quantity_after, metadata, transaction_date, created_at)
values
  ('d0f20000-0000-4000-8000-000000000002', 'd0f20000-0000-4000-8000-0000000000b2', 'd0f20000-0000-4000-8000-0000000000a1',
   'sale', 'pos', -1, 10, 9, '{"pours": 5, "pour_ml": 150, "bottles_opened": 1}',
   '2026-10-02T17:00:00Z', '2026-10-02T17:00:00Z'),   -- change, 1 LA day, -1d01h
  ('d0f20000-0000-4000-8000-000000000002', 'd0f20000-0000-4000-8000-0000000000b2', 'd0f20000-0000-4000-8000-0000000000a1',
   'sale', 'pos', -1, 9, 8, '{"pours": 5, "pour_ml": 150, "bottles_opened": 1}',
   '2026-10-02T17:05:00Z', '2026-10-02T17:05:00Z');   -- ambiguous: two pour events share its instant

-- Consumption rows (notes = the key). cur = created_at, cur2 = recorded_at.
insert into public.wine_consumption_log
  (restaurant_id, inventory_id, wine_name, consumption_type, quantity, volume_ml, source, notes, recorded_at, created_at)
select ('d0f20000-0000-4000-8000-00000000000' || h)::uuid,
       ('d0f20000-0000-4000-8000-0000000000b' || h)::uuid,
       'SYNTHETIC F2', 'bottle', 1, 750, 'pos', k, coalesce(ra, ca)::timestamptz, ca::timestamptz
  from (values
    (1, 'pos:csv_import:h1-right:w:1',     '2026-07-10T18:00:00Z', '2026-07-10T18:00:00Z'), -- already
    (1, 'pos:csv_import:h1-one:w:1',       null, '2026-10-02T07:00:00Z'),  -- change, 1 day
    (1, 'pos:pos:csv_import:h1-same:w:1',  null, '2026-10-02T07:00:00Z'),  -- change, 0 days, legacy note
    (1, 'pos:csv_import:h1-forty:w:1',     null, '2026-10-02T07:00:00Z'),  -- change, 40 days
    (1, 'pos:csv_import:h1-ddmm:w:1',      null, '2026-10-03T07:00:00Z'),  -- unreadable
    (1, 'pos:csv_import:h1-gone:w:1',      null, '2026-10-02T07:00:00Z'),  -- no check
    (1, 'pos:csv_import:h1-future:w:1',    null, '2026-10-02T07:00:00Z'),  -- already (clamped)
    (1, 'pos:csv_import:h1-nozone:w:1',    '2026-10-02T06:55:00Z', '2026-10-02T07:00:00Z'), -- change, 11 days, recorded<>created
    (2, 'pos:csv_import:h2-right:w:1',     '2026-09-15T02:00:00Z', '2026-09-15T02:00:00Z'), -- already
    (2, 'pos:csv_import:h2-five:w:1',      null, '2026-10-02T17:00:00Z'),  -- change, 5 LA days
    (2, 'pos:csv_import:h2-thirteen:w:1',  null, '2026-10-02T17:00:00Z'),  -- change, 13 LA days
    (3, 'pos:csv_import:h3-forty:w:1',     null, '2026-10-02T07:00:00Z'),  -- change, 949 h
    (3, 'pos:csv_import:h3-short:w:1',     null, '2026-10-02T07:00:00Z')   -- change, 1.5 h
  ) v(h, k, ra, ca);

-- Three rows from the REAL functions, called as the pre-#603 gateway called them
-- (no p_occurred_at), so transaction_date = created_at = now() of the call.
insert into public.inventory_lots (restaurant_id, inventory_id, master_wine_id, qty, open_bottle_ml, received_at)
values ('d0f20000-0000-4000-8000-000000000001', 'd0f20000-0000-4000-8000-0000000000b1',
        'd0f20000-0000-4000-8000-0000000000a1', 10, 0, now() - interval '60 days');
insert into public.pos_checks (restaurant_id, source, external_check_id, opened_at, closed_at, raw)
select 'd0f20000-0000-4000-8000-000000000001', 'csv_import', e, c - interval '2 hours', c,
       jsonb_build_object('closedAt', c::text)
  from (values ('h1-rpc-bottle', now() - interval '1 day'),
               ('h1-rpc-pour',   now() - interval '40 days')) v(e, c);
select public.apply_stock_movement(                                   -- change, 1 house day, -1 day
  p_inventory_id => 'd0f20000-0000-4000-8000-0000000000b1', p_stock_state => 'live', p_delta => -1,
  p_transaction_type => 'sale', p_source => 'pos', p_reason => 'SYNTHETIC F2 bottle',
  p_idempotency_key => 'pos:csv_import:h1-rpc-bottle:w:1',
  p_restaurant_id => 'd0f20000-0000-4000-8000-000000000001');
select public.record_glass_pour(                                      -- glass pour: change, 40 house days
  p_inventory_id => 'd0f20000-0000-4000-8000-0000000000b1', p_pours => 1, p_pour_ml => 150,
  p_location_id => null, p_source => 'pos', p_reason => 'SYNTHETIC F2 pour',
  p_idempotency_key => 'pos:csv_import:h1-rpc-pour:w:1');
select public.record_glass_pour(                                      -- glass pour, Toast key: out of scope
  p_inventory_id => 'd0f20000-0000-4000-8000-0000000000b1', p_pours => 5, p_pour_ml => 150,
  p_location_id => null, p_source => 'pos', p_reason => 'SYNTHETIC F2 toast pour',
  p_idempotency_key => 'toast_sale_f2_x');

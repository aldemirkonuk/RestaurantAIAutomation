-- Supplement to postime-f2-dryrun-fixtures.sql for ADR 0281 F2 fork 1
-- ("Never move a row later (Recommended)", founder 2026-10-05 ~16:00Z).
-- Load AFTER postime-f2-dryrun-fixtures.sql, on the same scratch database. Never production.
-- Four rows, expected outcome under fork 1 in the trailing comment (pre-fork-1 in brackets):
\set ON_ERROR_STOP 1

insert into public.pos_checks (restaurant_id, source, external_check_id, opened_at, closed_at, raw) values
  -- re-sent with a LATER close after its rows were booked at the first close (09-10 18:00Z)
  ('d0f20000-0000-4000-8000-000000000001', 'csv_import', 'h1-later',  '2026-09-11T16:00:00Z',
   '2026-09-11T18:00:00Z', '{"closedAt": "2026-09-11T18:00:00Z"}'),
  -- a consumption row whose recorded_at is already before its target, created_at late
  ('d0f20000-0000-4000-8000-000000000001', 'csv_import', 'h1-mixed',  '2026-08-23T16:00:00Z',
   '2026-08-23T18:00:00Z', '{"closedAt": "2026-08-23T18:00:00Z"}'),
  -- a consumption row with no recorded_at
  ('d0f20000-0000-4000-8000-000000000001', 'csv_import', 'h1-nullrec', '2026-09-05T16:00:00Z',
   '2026-09-05T18:00:00Z', '{"closedAt": "2026-09-05T18:00:00Z"}'),
  -- the till's close 30 ms ahead of the database's clock when the pour was booked
  ('d0f20000-0000-4000-8000-000000000002', 'csv_import', 'h2-ahead',  '2026-10-02T16:00:00Z',
   '2026-10-02T18:00:00.030Z', '{"closedAt": "2026-10-02T18:00:00.030Z"}');

-- keyed ledger row booked after #603 on the first close; target LEAST(09-11 18:00, 09-11 07:00) = 09-11 07:00
insert into public.inventory_transactions
  (restaurant_id, inventory_id, wine_id, transaction_type, source, quantity_change,
   quantity_before, quantity_after, transaction_date, created_at, idempotency_key)
values
  ('d0f20000-0000-4000-8000-000000000001', 'd0f20000-0000-4000-8000-0000000000b1', 'd0f20000-0000-4000-8000-0000000000a1',
   'sale', 'pos', -1, 10, 9, '2026-09-10T18:00:00Z', '2026-09-11T07:00:00Z',
   'pos:csv_import:h1-later:w:1');                      -- already [change, +13 h: later]

-- glass pour booked after #603: transaction_date = the gateway's clock clamped, 20 ms before
-- the RPC's now() (created_at, also the pour event's); target LEAST(18:00:00.030, 18:00:00) = 18:00:00
insert into public.pour_events (restaurant_id, inventory_id, pours, pour_ml, bottles_opened, source, idempotency_key, created_at) values
  ('d0f20000-0000-4000-8000-000000000002', 'd0f20000-0000-4000-8000-0000000000b2', 5, 150, 1, 'pos',
   'pos:csv_import:h2-ahead:w:1', '2026-10-02T18:00:00Z');
insert into public.inventory_transactions
  (restaurant_id, inventory_id, wine_id, transaction_type, source, quantity_change,
   quantity_before, quantity_after, metadata, transaction_date, created_at)
values
  ('d0f20000-0000-4000-8000-000000000002', 'd0f20000-0000-4000-8000-0000000000b2', 'd0f20000-0000-4000-8000-0000000000a1',
   'sale', 'pos', -1, 8, 7, '{"pours": 5, "pour_ml": 150, "bottles_opened": 1}',
   '2026-10-02T17:59:59.980Z', '2026-10-02T18:00:00Z'); -- already [change, +20 ms: later]

insert into public.wine_consumption_log
  (restaurant_id, inventory_id, wine_name, consumption_type, quantity, volume_ml, source, notes, recorded_at, created_at)
values
  -- h1-later's consumption row; target LEAST(09-11 18:00, 09-10 18:00) = 09-10 18:00
  ('d0f20000-0000-4000-8000-000000000001', 'd0f20000-0000-4000-8000-0000000000b1', 'SYNTHETIC F2', 'bottle', 1, 750, 'pos',
   'pos:csv_import:h1-later:w:1', '2026-09-10T18:00:00Z', '2026-09-10T18:00:00Z'),   -- already [already]
  -- target 08-23 18:00: created_at moves there, recorded_at (08-20 12:00) stays
  ('d0f20000-0000-4000-8000-000000000001', 'd0f20000-0000-4000-8000-0000000000b1', 'SYNTHETIC F2', 'bottle', 1, 750, 'pos',
   'pos:csv_import:h1-mixed:w:1', '2026-08-20T12:00:00Z', '2026-10-02T07:00:00Z'),   -- change [change, recorded_at moved later]
  -- target 09-05 18:00: both dates set to it, as before
  ('d0f20000-0000-4000-8000-000000000001', 'd0f20000-0000-4000-8000-0000000000b1', 'SYNTHETIC F2', 'bottle', 1, 750, 'pos',
   'pos:csv_import:h1-nullrec:w:1', null, '2026-10-02T07:00:00Z');                   -- change [change]

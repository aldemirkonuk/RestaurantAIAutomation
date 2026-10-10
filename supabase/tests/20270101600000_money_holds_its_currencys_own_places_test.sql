-- F-452: an order, its line, a credit claim, an invoice and a price-history row
-- keep a dinar's third decimal place and hold a dong order past 99,999,999.99.
-- Migration money_holds_its_currencys_own_places widens those money columns
-- to numeric(18,4) and re-issues the two header-price echo triggers.
--
-- Self-asserting: every block raises on a failure (assert -> P0004, or the
-- error itself), so `psql -v ON_ERROR_STOP=1 -f` stops at the first one.
-- Synthetic fixtures only, one transaction, rolled back. Every name starts
-- with "Zqfm", so rows already in a populated database cannot match.
--
-- On a build WITHOUT the migration: T1 FAILS (1.255 is stored as 1.26), T2
-- FAILS with 22003 (104,400,000 overflows numeric(10,2)), T4 and T5 fail on
-- their rounded values too. T3 is the echo trigger on the widened
-- columns: it FAILS on a build that widens the columns but keeps the
-- functions' numeric(10,2) variable (the header refuses its own 1.26 echo).

begin;

insert into public.restaurants (id, name, slug) values
  ('f4520000-0000-4000-8000-000000000001', 'Zqfm Manama house', 'zqfm-manama-house');
insert into public.providers (id, name, primary_contact, restaurant_id) values
  ('f4520000-0000-4000-8000-0000000000b1', 'Zqfm Vendor', '{}'::jsonb, 'f4520000-0000-4000-8000-000000000001');
insert into public.restaurant_inventory (id, restaurant_id, kind, uom, display_name, identity_provenance) values
  ('f4520000-0000-4000-8000-0000000000c1', 'f4520000-0000-4000-8000-000000000001', 'wine', 'bottle', 'Zqfm Shelf', 'house_declared');

-- T1: a dinar order keeps its third place on the header.
insert into public.procurement_orders
  (id, order_number, restaurant_id, inventory_id, provider_id, quantity, bottles_total,
   final_price, total_cost, status, requested_at, currency, currency_source) values
  ('f4520000-0000-4000-8000-000000000101', 'ZQFM-1', 'f4520000-0000-4000-8000-000000000001',
   'f4520000-0000-4000-8000-0000000000c1', 'f4520000-0000-4000-8000-0000000000b1',
   12, 12, 1.255, 15.060, 'PENDING', now(), 'KWD', 'typed');

do $$
declare r record;
begin
  select final_price, total_cost into r from public.procurement_orders
   where id = 'f4520000-0000-4000-8000-000000000101';
  assert r.final_price = 1.255, format('T1: final_price stored as %s, not 1.255', r.final_price);
  assert r.total_cost = 15.060, format('T1: total_cost stored as %s, not 15.060', r.total_cost);
end $$;

-- T2: a dong order past 99,999,999.99 is placed, header and line.
insert into public.procurement_orders
  (id, order_number, restaurant_id, inventory_id, provider_id, quantity, bottles_total,
   final_price, total_cost, status, requested_at, currency, currency_source) values
  ('f4520000-0000-4000-8000-000000000102', 'ZQFM-2', 'f4520000-0000-4000-8000-000000000001',
   'f4520000-0000-4000-8000-0000000000c1', 'f4520000-0000-4000-8000-0000000000b1',
   72, 72, 1450000, 104400000, 'PENDING', now(), 'VND', 'typed');
insert into public.procurement_order_items
  (id, order_id, restaurant_id, wine_name, quantity, final_unit_price, line_total) values
  ('f4520000-0000-4000-8000-000000000202', 'f4520000-0000-4000-8000-000000000102',
   'f4520000-0000-4000-8000-000000000001', 'Zqfm Dong Red', 72, 1450000, 104400000);

do $$
declare r record;
begin
  select o.total_cost, i.line_total into r
    from public.procurement_orders o join public.procurement_order_items i on i.order_id = o.id
   where o.id = 'f4520000-0000-4000-8000-000000000102';
  assert r.total_cost = 104400000 and r.line_total = 104400000,
    format('T2: stored %s / %s', r.total_cost, r.line_total);
end $$;

-- T3: the line's 1.255 echoes to the header unrounded, and the header check
-- accepts it (the trigger functions no longer hold the price in numeric(10,2)).
insert into public.procurement_order_items
  (id, order_id, restaurant_id, wine_name, quantity, final_unit_price, line_total, deposit) values
  ('f4520000-0000-4000-8000-000000000201', 'f4520000-0000-4000-8000-000000000101',
   'f4520000-0000-4000-8000-000000000001', 'Zqfm Dinar White', 12, 1.257, 15.084, 0.125);
update public.procurement_orders set final_price = 1.257
 where id = 'f4520000-0000-4000-8000-000000000101';

do $$
declare r record;
begin
  select o.final_price, i.final_unit_price, i.deposit into r
    from public.procurement_orders o join public.procurement_order_items i on i.order_id = o.id
   where o.id = 'f4520000-0000-4000-8000-000000000101';
  assert r.final_unit_price = 1.257, format('T3: line price stored as %s', r.final_unit_price);
  assert r.final_price = 1.257, format('T3: header echoed %s, not the line''s 1.257', r.final_price);
  assert r.deposit = 0.125, format('T3: deposit stored as %s', r.deposit);
end $$;

-- T4: a credit claim and a price-history row keep fils.
insert into public.procurement_credits (id, restaurant_id, reason, claimed_amount, currency, state) values
  ('f4520000-0000-4000-8000-000000000301', 'f4520000-0000-4000-8000-000000000001', 'qty_short', 2.515, 'KWD', 'open');
insert into public.price_history (restaurant_id, provider_id, price, quantity, unit, effective_date, source, currency) values
  ('f4520000-0000-4000-8000-000000000001', 'f4520000-0000-4000-8000-0000000000b1', 1.255, 12, 'bottle', current_date, 'receipt_verified', 'KWD');

do $$
declare c numeric; p numeric;
begin
  select claimed_amount into c from public.procurement_credits where id = 'f4520000-0000-4000-8000-000000000301';
  select price into p from public.price_history
   where restaurant_id = 'f4520000-0000-4000-8000-000000000001' and currency = 'KWD';
  assert c = 2.515, format('T4: claim stored as %s', c);
  assert p = 1.255, format('T4: price_history stored as %s', p);
end $$;

-- T5: every widened column is numeric(18,4) — a column missed here would keep
-- rounding to two.
do $$
declare bad text;
begin
  select string_agg(attrelid::regclass || '.' || attname || ' ' || format_type(atttypid, atttypmod), ', ')
    into bad
    from pg_attribute
   where not attisdropped and attnum > 0
     and (attrelid::regclass::text, attname::text) in (
       ('procurement_orders','quoted_price'), ('procurement_orders','negotiated_price'),
       ('procurement_orders','final_price'), ('procurement_orders','total_cost'),
       ('procurement_orders','total_estimated_cost'), ('procurement_orders','final_confirmed_cost'),
       ('procurement_orders','invoice_unit_price'), ('procurement_orders','prefilled_invoice_unit_price'),
       ('procurement_order_items','quoted_unit_price'), ('procurement_order_items','negotiated_unit_price'),
       ('procurement_order_items','final_unit_price'), ('procurement_order_items','line_total'),
       ('procurement_order_items','allowance'), ('procurement_order_items','deposit'),
       ('procurement_order_items','freight'),
       ('procurement_documents','subtotal'), ('procurement_documents','freight'),
       ('procurement_documents','fuel_surcharge'), ('procurement_documents','split_case_fee'),
       ('procurement_documents','delivery_fee'), ('procurement_documents','deposit_total'),
       ('procurement_documents','tax'), ('procurement_documents','other_charges'),
       ('procurement_documents','discount_total'), ('procurement_documents','total'),
       ('procurement_documents','computed_lines_total'), ('procurement_documents','tie_out_delta'),
       ('procurement_document_lines','unit_price'), ('procurement_document_lines','line_total'),
       ('procurement_document_lines','allowance'), ('procurement_document_lines','deposit'),
       ('procurement_credits','claimed_amount'), ('procurement_credits','credited_amount'),
       ('price_history','price'))
     and format_type(atttypid, atttypmod) <> 'numeric(18,4)';
  assert bad is null, format('T5: not widened: %s', bad);
end $$;

rollback;

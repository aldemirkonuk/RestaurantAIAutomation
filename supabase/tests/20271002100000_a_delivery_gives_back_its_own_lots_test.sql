-- a_delivery_gives_back_its_own_lots: psql -v ON_ERROR_STOP=1 -f on a migrated DB.
-- r28 invoices audit G2. Every id is synthetic.
begin;
do $$ begin assert false; raise exception 'plpgsql.check_asserts is off'; exception when assert_failure then null; end $$;
create function pg_temp.u(s text) returns uuid language sql immutable as $$ select ('c0b20000-0000-4000-8000-' || lpad(s, 12, '0'))::uuid $$;
create function pg_temp.i(x text) returns uuid language sql immutable as $$ select pg_temp.u('2' || x || '0') $$;
create function pg_temp.d(x text) returns uuid language sql immutable as $$ select pg_temp.u('3' || x || '0') $$;
-- One movement of item x; `dl` names the delivery it belongs to, or none.
create function pg_temp.mv(x text, q int, ty text, dl text default null, k text default null)
returns uuid language sql as $$
  select public.apply_stock_movement(p_inventory_id => pg_temp.i(x), p_stock_state => 'live', p_delta => q,
    p_transaction_type => ty, p_source => 'order', p_idempotency_key => k,
    p_reference_type => case when dl is not null then 'delivery' end,
    p_reference_id => case when dl is not null then pg_temp.d(dl) end,
    p_restaurant_id => pg_temp.u('1')) $$;
-- What delivery dl's lot of item x holds now.
create function pg_temp.held(x text, dl text) returns int language sql as $$
  select coalesce(sum(qty), 0)::int from public.inventory_lots where inventory_id = pg_temp.i(x) and delivery_id = pg_temp.d(dl) $$;
-- Make every lot of delivery dl look received `days` ago.
create function pg_temp.age(dl text, days int) returns void language sql as $$
  update public.inventory_lots set received_at = now() - make_interval(days => days), created_at = now() - make_interval(days => days)
   where delivery_id = pg_temp.d(dl) $$;

do $$ declare x text; begin
  insert into public.restaurants (id, name, slug) values (pg_temp.u('1'), 'DG', 'dg-1');
  foreach x in array array['a', 'b', 'c', 'e', 'f', 'd'] loop
    insert into public.master_wine_library (id, wine_id, name, primary_type) values (pg_temp.u('1' || x || '0'), 'DG-' || x, 'DG ' || x, 'red');
    insert into public.restaurant_inventory (id, restaurant_id, master_wine_id, bottle_size_ml, pour_size_ml)
      values (pg_temp.i(x), pg_temp.u('1'), pg_temp.u('1' || x || '0'), 750, 150);
  end loop;
  foreach x in array array['0', '1', '2', '5', '6', '7', '8'] loop
    insert into public.deliveries (id, restaurant_id, state) values (pg_temp.d(x), pg_temp.u('1'), 'DELIVERED');
  end loop;
end $$;

-- G2a a rejected delivery's reversal empties its own lot; the older, costed lot is untouched.
do $$ declare r uuid; w record; begin
  perform pg_temp.mv('a', 12, 'purchase', '0');
  perform pg_temp.age('0', 3);
  perform pg_temp.mv('a', 6, 'purchase', '1');
  r := pg_temp.mv('a', -6, 'adjustment', '1', 'dg-reverse-a');
  assert pg_temp.held('a', '1') = 0 and pg_temp.held('a', '0') = 12,
    format('G2a FAIL: own lot %s, older lot %s', pg_temp.held('a', '1'), pg_temp.held('a', '0'));
  select count(*) n, sum(d.qty) q, bool_and(l.delivery_id = pg_temp.d('1')) own into w
    from public.inventory_lot_draws d join public.inventory_lots l on l.id = d.lot_id where d.txn_id = r;
  assert w.n = 1 and w.q = 6 and w.own, format('G2a FAIL: draws %s', row_to_json(w));
  assert (select delivery_id from public.inventory_transactions where id = r) = pg_temp.d('1'), 'G2a FAIL: the row lost its delivery';
end $$;

-- G2b a lower recount gives back from its own lot.
do $$ begin
  perform pg_temp.mv('b', 12, 'purchase', '2');
  perform pg_temp.age('2', 3);
  perform pg_temp.mv('b', 6, 'purchase', '5');
  perform pg_temp.mv('b', -2, 'adjustment', '5', 'dg-recount-b');
  assert pg_temp.held('b', '5') = 4 and pg_temp.held('b', '2') = 12,
    format('G2b FAIL: own lot %s, older lot %s', pg_temp.held('b', '5'), pg_temp.held('b', '2'));
end $$;

-- G2c the delivery's bottles were partly sold: its lot is emptied first, the rest is first-in-first-out.
do $$ begin
  perform pg_temp.mv('c', 12, 'purchase', '6');
  perform pg_temp.age('6', 5);
  perform pg_temp.mv('c', 6, 'purchase', '7');
  perform pg_temp.age('7', 3);
  perform pg_temp.mv('c', -13, 'sale', null, 'dg-sale-c');
  assert pg_temp.held('c', '6') = 0 and pg_temp.held('c', '7') = 5, 'G2c FAIL: the sale did not draw oldest first';
  perform pg_temp.mv('c', 10, 'purchase', '8');
  perform pg_temp.mv('c', -6, 'adjustment', '7', 'dg-reverse-c');
  assert pg_temp.held('c', '7') = 0 and pg_temp.held('c', '8') = 9,
    format('G2c FAIL: own lot %s, newest lot %s', pg_temp.held('c', '7'), pg_temp.held('c', '8'));
end $$;

-- G2d a movement that names no delivery still draws oldest first, past a newer delivery's lot.
do $$ begin
  perform pg_temp.mv('e', 4, 'purchase', '0');
  perform pg_temp.age('0', 3);
  perform pg_temp.mv('e', 4, 'purchase', '1');
  perform pg_temp.mv('e', -3, 'sale', null, 'dg-sale-e');
  assert pg_temp.held('e', '0') = 1 and pg_temp.held('e', '1') = 4,
    format('G2d FAIL: oldest %s, newer %s', pg_temp.held('e', '0'), pg_temp.held('e', '1'));
end $$;

-- G2e a negative naming a delivery that holds none of this item draws oldest first, as before.
do $$ begin
  perform pg_temp.mv('f', 4, 'purchase', '0');
  perform pg_temp.age('0', 3);
  perform pg_temp.mv('f', 4, 'purchase', '1');
  perform pg_temp.mv('f', -3, 'adjustment', '2', 'dg-other-f');
  assert pg_temp.held('f', '0') = 1 and pg_temp.held('f', '1') = 4,
    format('G2e FAIL: oldest %s, newer %s', pg_temp.held('f', '0'), pg_temp.held('f', '1'));
end $$;

-- G2f a sale (no delivery) does not jump to a newer lot that has no delivery either.
do $$ declare hand int; begin
  perform pg_temp.mv('d', 4, 'purchase', '0');
  perform pg_temp.age('0', 3);
  perform pg_temp.mv('d', 4, 'purchase');
  perform pg_temp.mv('d', -3, 'sale', null, 'dg-sale-d');
  select coalesce(sum(qty), 0)::int into hand from public.inventory_lots where inventory_id = pg_temp.i('d') and delivery_id is null;
  assert pg_temp.held('d', '0') = 1 and hand = 4, format('G2f FAIL: delivered %s, hand-booked %s', pg_temp.held('d', '0'), hand);
end $$;

rollback;

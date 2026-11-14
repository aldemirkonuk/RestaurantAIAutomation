-- the_settled_cost_reads_only_its_rows (r41 invoices audit, gap 5): the
-- settled-cost view gives the same rows as before, and a read of one house's
-- till rows sums only that house's settlements and draws.
--
-- Self-asserting (assert -> P0004); run with `psql -v ON_ERROR_STOP=1 -f` on a
-- database built from supabase/migrations. CI runs no supabase/tests file
-- (claim SUPABASE-TESTS-RUN-IN-CI). Synthetic fixtures, rolled back.

begin;
set local timezone = 'UTC';
do $$ begin
  if current_setting('plpgsql.check_asserts') <> 'on' then raise exception 'plpgsql.check_asserts is off'; end if;
end $$;

create function pg_temp.u(s text) returns uuid language sql immutable as $$
  select ('c41a0000-0000-4000-8000-' || lpad(s, 12, '0'))::uuid
$$;
create function pg_temp.house(h text) returns uuid language sql immutable as $$ select pg_temp.u('1' || h) $$;
create function pg_temp.i(x text) returns uuid language sql immutable as $$ select pg_temp.u('2' || x || '0') $$;
create function pg_temp.book(x text, q int, c numeric default null) returns void language plpgsql as $$
begin
  perform public.apply_stock_movement(p_inventory_id => pg_temp.i(x), p_stock_state => 'live', p_delta => q,
    p_transaction_type => 'purchase', p_source => 'manual', p_reason => 'settled view test', p_unit_cost => c,
    p_cost_provenance => case when c is null then null else 'estimated' end,
    p_reference_type => 'delivery', p_reference_id => pg_temp.u('3' || x || '0'));
end $$;
create function pg_temp.sell(x text, q int, k text) returns uuid language sql as $$
  select public.apply_stock_movement(p_inventory_id => pg_temp.i(x), p_stock_state => 'live', p_delta => -q,
    p_transaction_type => 'sale', p_source => 'pos', p_idempotency_key => k)
$$;
create function pg_temp.void(x text, q int, k text, sale text) returns uuid language sql as $$
  select public.apply_stock_movement(p_inventory_id => pg_temp.i(x), p_stock_state => 'live', p_delta => q,
    p_transaction_type => 'return', p_source => 'pos', p_idempotency_key => k,
    p_metadata => jsonb_build_object('sale_key', sale))
$$;
create function pg_temp.fin(x text, c numeric) returns jsonb language sql as $$
  select public.finalise_delivery_cost(pg_temp.u('3' || x || '0'), pg_temp.i(x), c, 'invoice')
$$;

-- The view as a_settlement_keeps_six_places defined it, kept here as the
-- reference the new definition must equal row for row.
create view pg_temp.settled_before as
SELECT t.id AS txn_id,
       t.restaurant_id,
       t.inventory_id,
       t.cost_total,
       COALESCE(s.difference, 0)::numeric(16,6) AS settled_difference,
       (CASE WHEN t.cost_total IS NULL AND s.txn_id IS NULL THEN NULL
             ELSE COALESCE(t.cost_total, 0) + COALESCE(s.difference, 0)
        END)::numeric(16,6) AS settled_cost_total,
       t.unpriced_qty,
       (t.unpriced_qty - COALESCE(u.qty, 0))::integer AS unpriced_qty_remaining
  FROM public.inventory_transactions t
  LEFT JOIN (SELECT txn_id, sum(difference) AS difference
               FROM public.inventory_lot_draw_settlements GROUP BY txn_id) s ON s.txn_id = t.id
  LEFT JOIN (SELECT d.txn_id, sum(abs(d.qty)) AS qty
               FROM public.inventory_lot_draws d
              WHERE d.unit_cost IS NULL
                AND EXISTS (SELECT 1 FROM public.inventory_lot_draw_settlements x WHERE x.draw_id = d.id)
              GROUP BY d.txn_id) u ON u.txn_id = t.id;

-- Rows READ from one relation in an EXPLAIN ANALYZE plan: what each scan
-- returned plus what its filter threw away, times its loops.
create function pg_temp.rows_read(plan jsonb, rel text) returns numeric language sql as $$
  with recursive n(node) as (
    select plan -> 0 -> 'Plan'
    union all
    select c from n, jsonb_array_elements(coalesce(n.node -> 'Plans', '[]'::jsonb)) c
  )
  select coalesce(sum(((node ->> 'Actual Rows')::numeric
                       + coalesce((node ->> 'Rows Removed by Filter')::numeric, 0)
                       + coalesce((node ->> 'Rows Removed by Index Recheck')::numeric, 0))
                      * coalesce((node ->> 'Actual Loops')::numeric, 1)), 0)
    from n where node ->> 'Relation Name' = rel
$$;

-- House a: four goods: priced sales and a void (a), unpriced sales settled
-- late (b), estimated sales settled at a new price (d: settled draws that
-- were priced), unpriced sales never settled (e).
-- House b: one good sold 40 times unpriced, then settled: 40 settlements and
-- 40 unpriced draws that a read of house a must never sum.
do $$
declare x text; h text; k int;
begin
  foreach h in array array['a', 'b'] loop
    insert into public.restaurants (id, name, slug) values (pg_temp.house(h), 'Settled view house ' || h, 'settled-view-house-' || h);
  end loop;
  foreach x in array array['a', 'b', 'c', 'd', 'e'] loop
    h := case when x = 'c' then 'b' else 'a' end;
    insert into public.master_wine_library (id, wine_id, name, primary_type)
      values (pg_temp.u('1' || x || '0'), 'SV-' || upper(x), 'Settled view wine ' || upper(x), 'red');
    insert into public.restaurant_inventory (id, restaurant_id, master_wine_id, bottle_size_ml, pour_size_ml)
      values (pg_temp.i(x), pg_temp.house(h), pg_temp.u('1' || x || '0'), 750, 150);
    insert into public.deliveries (id, restaurant_id, state) values (pg_temp.u('3' || x || '0'), pg_temp.house(h), 'DELIVERED');
  end loop;

  -- a: priced stock, two sales, one voided against its sale.
  perform pg_temp.book('a', 6, 10.00);
  perform pg_temp.sell('a', 2, 'sv-a-1');
  perform pg_temp.sell('a', 1, 'sv-a-2');
  perform pg_temp.void('a', 1, 'sv-a-2-v', 'sv-a-2');
  -- b: unpriced stock sold, then the invoice prices it (settlements).
  perform pg_temp.book('b', 3);
  perform pg_temp.sell('b', 1, 'sv-b-1');
  perform pg_temp.sell('b', 2, 'sv-b-2');
  perform pg_temp.void('b', 1, 'sv-b-2-v', 'sv-b-2');
  perform pg_temp.fin('b', 7.25);
  -- d: an estimate, two sales, then the invoice prices it differently.
  perform pg_temp.book('d', 4, 9.00);
  perform pg_temp.sell('d', 1, 'sv-d-1');
  perform pg_temp.sell('d', 1, 'sv-d-2');
  perform pg_temp.fin('d', 9.50);
  -- e: unpriced, one sale, no invoice yet.
  perform pg_temp.book('e', 2);
  perform pg_temp.sell('e', 1, 'sv-e-1');
  -- c (house b): forty unpriced sales, then settled.
  perform pg_temp.book('c', 40);
  for k in 1..40 loop
    perform pg_temp.sell('c', 1, 'sv-c-' || k);
  end loop;
  perform pg_temp.fin('c', 5.10);
end $$;

-- F0: the fixture made what the read below must skip.
do $$
declare n_b int; n_a int;
begin
  select count(*) into n_b from public.inventory_lot_draw_settlements where restaurant_id = pg_temp.house('b');
  select count(*) into n_a from public.inventory_lot_draw_settlements where restaurant_id = pg_temp.house('a');
  assert n_b >= 40 and n_a >= 1, format('F0 FAIL: settlements a=%s b=%s', n_a, n_b);
end $$;

-- F1: the fixture holds each case the view tells apart, so E1 compares them:
-- a row with no cost and no settlement, a settled draw that had a price, and
-- an unpriced draw nobody has settled.
do $$
begin
  assert exists (select 1 from public.inventory_transactions t
                  where t.restaurant_id = pg_temp.house('a') and t.cost_total is null
                    and not exists (select 1 from public.inventory_lot_draw_settlements x where x.txn_id = t.id)),
    'F1 FAIL: no row without cost or settlement';
  assert exists (select 1 from public.inventory_lot_draws d
                  where d.restaurant_id = pg_temp.house('a') and d.unit_cost is not null
                    and exists (select 1 from public.inventory_lot_draw_settlements x where x.draw_id = d.id)),
    'F1 FAIL: no settled draw that had a price';
  assert exists (select 1 from public.inventory_lot_draws d
                  where d.restaurant_id = pg_temp.house('a') and d.unit_cost is null
                    and not exists (select 1 from public.inventory_lot_draw_settlements x where x.draw_id = d.id)),
    'F1 FAIL: no unpriced draw left unsettled';
  assert exists (select 1 from public.inventory_lot_draws d
                  where d.restaurant_id = pg_temp.house('a') and d.unit_cost is null and d.qty < 0
                    and exists (select 1 from public.inventory_lot_draw_settlements x where x.draw_id = d.id)),
    'F1 FAIL: no settled draw a void gave back';
end $$;

-- E1: the new definition gives the old one's rows exactly, both houses.
do $$
declare d int; n int;
begin
  select count(*) into n from public.inventory_transaction_settled_cost
   where restaurant_id in (pg_temp.house('a'), pg_temp.house('b'));
  select count(*) into d from (
    (select * from public.inventory_transaction_settled_cost
      where restaurant_id in (pg_temp.house('a'), pg_temp.house('b'))
     except all
     select * from pg_temp.settled_before
      where restaurant_id in (pg_temp.house('a'), pg_temp.house('b')))
    union all
    (select * from pg_temp.settled_before
      where restaurant_id in (pg_temp.house('a'), pg_temp.house('b'))
     except all
     select * from public.inventory_transaction_settled_cost
      where restaurant_id in (pg_temp.house('a'), pg_temp.house('b')))) z;
  assert n >= 54 and d = 0, format('E1 FAIL: %s of %s rows differ from the old definition', d, n);
end $$;

-- E2: the late settlement and the unpriced bottles still read through: b's
-- two sales were unpriced (3 bottles), one bottle came back on a void, and
-- the two left sold are now settled at 7.25 each.
do $$
declare v record;
begin
  select sum(settled_cost_total) as c, sum(unpriced_qty_remaining) as r into v
    from public.inventory_transaction_settled_cost
   where inventory_id = pg_temp.i('b') and txn_id in (
     select id from public.inventory_transactions where inventory_id = pg_temp.i('b') and source = 'pos');
  assert v.c = 14.50 and v.r = 0, format('E2 FAIL: settled %s, unpriced left %s', v.c, v.r);
end $$;

-- R1: a read of house a's till rows reads no more settlements or draws than
-- house a has. Before, the grouped sums read every house's (house b's 40+).
-- Sequential scans are switched off so the planner plans as it would at
-- production size, not as it would for a table of a few dozen rows.
do $$
declare p jsonb; s numeric; dr numeric; own_s int; own_d int;
begin
  set local enable_seqscan = off;
  execute format($q$explain (analyze, format json)
    select v.* from public.inventory_transactions r
      join public.inventory_transaction_settled_cost v on v.txn_id = r.id
     where r.restaurant_id = %L and r.source = 'pos'$q$, pg_temp.house('a')) into p;
  s := pg_temp.rows_read(p, 'inventory_lot_draw_settlements');
  dr := pg_temp.rows_read(p, 'inventory_lot_draws');
  select count(*) into own_s from public.inventory_lot_draw_settlements where restaurant_id = pg_temp.house('a');
  select count(*) into own_d from public.inventory_lot_draws where restaurant_id = pg_temp.house('a');
  -- A settlement is read for its row's sum and again for the settled-draw test
  -- of its draw, and an index probe can count a row it then skips: a few
  -- times house a's own, never in proportion to house b's.
  assert s <= 3 * own_s and dr <= 2 * own_d,
    format('R1 FAIL: read %s settlements (house a has %s) and %s draws (house a has %s)', s, own_s, dr, own_d);
  reset enable_seqscan;
end $$;

-- R2: the same for pos_cost_of_goods' own shape, house a's window.
do $$
declare p jsonb; s numeric; own_s int;
begin
  set local enable_seqscan = off;
  execute format($q$explain (analyze, format json)
    with rows_ as (select t.id from public.inventory_transactions t
                    where t.restaurant_id = %L and t.source = 'pos'
                      and t.transaction_type in ('sale', 'return') and t.stock_type = 'live')
    select r.id, v.unpriced_qty_remaining from rows_ r
      left join public.inventory_transaction_settled_cost v on v.txn_id = r.id$q$, pg_temp.house('a')) into p;
  s := pg_temp.rows_read(p, 'inventory_lot_draw_settlements');
  select count(*) into own_s from public.inventory_lot_draw_settlements where restaurant_id = pg_temp.house('a');
  assert s <= 3 * own_s, format('R2 FAIL: read %s settlements, house a has %s', s, own_s);
  reset enable_seqscan;
end $$;

rollback;

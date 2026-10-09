-- F-443 (sim S64 residual of F-428). finalise_delivery_cost matched only
-- `qty > 0` lots, so a lot of the delivery held only as an open bottle
-- (qty 0, open_bottle_ml > 0) kept its provisional price at VERIFIED.
-- Migration an_open_bottle_is_priced_at_verified widens the filter to
-- `qty > 0 OR open_bottle_ml > 0`.
--
-- Self-asserting: every block raises on a failure, so `psql -v ON_ERROR_STOP=1`
-- stops at the first one. Synthetic fixtures only, one transaction, rolled back.
--
-- On a build WITHOUT the migration, T1 and T2 FAIL. T3 and T4 pass on both
-- builds: they pin what the migration keeps (a sealed lot is priced, a re-verify
-- writes no history row, an empty lot and another delivery's lot are untouched).

begin;

do $$
declare
  h uuid := 'f4430000-0000-4000-8000-000000000001';
  i int;
begin
  insert into public.restaurants (id, name, slug) values (h, 'F443 test house', 'f443-test-house');
  for i in 1..2 loop
    insert into public.master_wine_library (id, wine_id, name, primary_type)
    values (('f4430000-0000-4000-8000-0000000001' || lpad(i::text, 2, '0'))::uuid,
            'F443-TEST-' || i, 'F443 test wine ' || i, 'red');
    insert into public.restaurant_inventory (id, restaurant_id, master_wine_id, bottle_size_ml, pour_size_ml)
    values (('f4430000-0000-4000-8000-0000000002' || lpad(i::text, 2, '0'))::uuid, h,
            ('f4430000-0000-4000-8000-0000000001' || lpad(i::text, 2, '0'))::uuid, 750, 150);
  end loop;
  insert into public.deliveries (id, restaurant_id, state) values
    ('f4430000-0000-4000-8000-000000000401', h, 'DELIVERED'),
    ('f4430000-0000-4000-8000-000000000402', h, 'DELIVERED');

  -- Item 1, delivery 401: an open bottle whose sealed ones are gone (qty 0,
  -- 450 ml), a sealed lot (3), and an empty lot (0 + 0) that should not exist
  -- but must not be priced if it does. All provisional at an estimate of 9.
  -- Plus an open-bottle lot of ANOTHER delivery (402), which stays as it is.
  insert into public.inventory_lots (id, restaurant_id, inventory_id, master_wine_id, qty, open_bottle_ml,
                                     received_at, delivery_id, cost_state, cost_provenance, unit_cost)
  select x.id, h, ri.id, ri.master_wine_id, x.q, x.ml, now() - make_interval(days => x.d), x.dl,
         'provisional', 'estimated', 9.00
    from public.restaurant_inventory ri,
         (values ('f4430000-0000-4000-8000-000000000501'::uuid, 0, 450, 20, 'f4430000-0000-4000-8000-000000000401'::uuid),
                 ('f4430000-0000-4000-8000-000000000502'::uuid, 3,   0, 20, 'f4430000-0000-4000-8000-000000000401'::uuid),
                 ('f4430000-0000-4000-8000-000000000503'::uuid, 0,   0, 20, 'f4430000-0000-4000-8000-000000000401'::uuid),
                 ('f4430000-0000-4000-8000-000000000504'::uuid, 0, 300, 10, 'f4430000-0000-4000-8000-000000000402'::uuid)) x(id, q, ml, d, dl)
   where ri.id = 'f4430000-0000-4000-8000-000000000201';
  -- Item 2, delivery 401: ONLY an open bottle is left of it.
  insert into public.inventory_lots (id, restaurant_id, inventory_id, master_wine_id, qty, open_bottle_ml,
                                     received_at, delivery_id, cost_state, cost_provenance)
  select 'f4430000-0000-4000-8000-000000000505', h, ri.id, ri.master_wine_id, 0, 600,
         now() - interval '20 days', 'f4430000-0000-4000-8000-000000000401', 'provisional', 'estimated'
    from public.restaurant_inventory ri where ri.id = 'f4430000-0000-4000-8000-000000000202';
end $$;

-- T1 VERIFIED prices the open bottle as well as the sealed lot, and keeps the
-- price it replaced.
do $$
declare
  it uuid := 'f4430000-0000-4000-8000-000000000201';
  r jsonb;
  l record;
  v record;
begin
  r := public.finalise_delivery_cost('f4430000-0000-4000-8000-000000000401', it, 15.00, 'invoice', null, 'f443 t1');
  select * into l from public.inventory_lots where id = 'f4430000-0000-4000-8000-000000000501';
  assert l.cost_state = 'final' and l.unit_cost = 15.00 and l.cost_provenance = 'invoice',
    format('T1 FAIL the open bottle kept its provisional price: %s %s %s (receipt %s)',
           l.cost_state, l.unit_cost, l.cost_provenance, r);
  assert l.qty = 0 and l.open_bottle_ml = 450, format('T1 FAIL pricing moved stock: qty %s ml %s', l.qty, l.open_bottle_ml);
  select * into l from public.inventory_lots where id = 'f4430000-0000-4000-8000-000000000502';
  assert l.cost_state = 'final' and l.unit_cost = 15.00, format('T1 FAIL sealed lot %s %s', l.cost_state, l.unit_cost);
  assert (r->>'lots_matched')::int = 2 and (r->>'lots_finalised')::int = 2
     and (r->>'bottles_matched')::int = 3 and (r->>'bottles_finalised')::int = 3,
    format('T1 FAIL receipt %s', r);
  select * into v from public.inventory_lot_revaluations where lot_id = 'f4430000-0000-4000-8000-000000000501';
  assert v.id is not null and v.qty_at_revaluation = 0 and v.prior_unit_cost = 9.00
     and v.prior_cost_provenance = 'estimated' and v.new_unit_cost = 15.00,
    format('T1 FAIL the open bottle''s prior price was not kept: %s', to_jsonb(v));
end $$;

-- T2 an item of which only an open bottle is left: the receipt says it
-- reached one lot, not zero.
do $$
declare
  it uuid := 'f4430000-0000-4000-8000-000000000202';
  r jsonb;
begin
  r := public.finalise_delivery_cost('f4430000-0000-4000-8000-000000000401', it, 22.50, 'manual', null, 'f443 t2');
  assert (r->>'lots_matched')::int = 1 and (r->>'lots_finalised')::int = 1 and (r->>'bottles_finalised')::int = 0,
    format('T2 FAIL receipt %s', r);
  assert (select cost_state = 'final' and unit_cost = 22.50 and cost_provenance = 'manual'
            from public.inventory_lots where id = 'f4430000-0000-4000-8000-000000000505'),
    'T2 FAIL the open-bottle-only lot was not priced';
end $$;

-- T3 a re-verify at the same price writes no history row (idempotent).
do $$
declare
  it uuid := 'f4430000-0000-4000-8000-000000000201';
  r jsonb;
  n0 int; n1 int;
begin
  select count(*) into n0 from public.inventory_lot_revaluations where inventory_id = it;
  r := public.finalise_delivery_cost('f4430000-0000-4000-8000-000000000401', it, 15.00, 'invoice', null, 'f443 t3');
  select count(*) into n1 from public.inventory_lot_revaluations where inventory_id = it;
  assert n1 = n0 and (r->>'lots_finalised')::int = 0, format('T3 FAIL re-verify wrote %s row(s), receipt %s', n1 - n0, r);
end $$;

-- T4 an empty lot and another delivery's open bottle are not touched.
do $$
declare
  l record;
begin
  select * into l from public.inventory_lots where id = 'f4430000-0000-4000-8000-000000000503';
  assert l.cost_state = 'provisional' and l.unit_cost = 9.00, format('T4 FAIL empty lot priced: %s %s', l.cost_state, l.unit_cost);
  select * into l from public.inventory_lots where id = 'f4430000-0000-4000-8000-000000000504';
  assert l.cost_state = 'provisional' and l.unit_cost = 9.00,
    format('T4 FAIL another delivery''s lot priced: %s %s', l.cost_state, l.unit_cost);
end $$;

rollback;

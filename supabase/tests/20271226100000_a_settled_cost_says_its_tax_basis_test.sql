-- SQL tests for 20271226100000_a_settled_cost_says_its_tax_basis.sql.
-- Plain psql assertions against a throwaway Postgres built from
-- supabase/migrations (see 20260905232000_..._test.sql for the recipe):
--     psql -v ON_ERROR_STOP=1 -f supabase/tests/20271226100000_a_settled_cost_says_its_tax_basis_test.sql
-- Every assertion RAISEs on failure; the file runs in one transaction that is
-- ROLLED BACK. NEVER run it against production. All fixtures are SYNTHETIC.
-- The stamp under test is ADR 0359 C3's stamp_delivery_cost_tax_basis (#1459):
-- this file only proves the settlement row keeps what the lot was stamped with.
begin;

insert into public.restaurants (id, name, slug) values
  ('a8100000-0000-4000-8000-000000000001', 'SYNTHETIC Basis House', 'synthetic-basis'),
  ('a8100000-0000-4000-8000-000000000002', 'SYNTHETIC Other House', 'synthetic-basis-other');
insert into public.restaurant_inventory (id, restaurant_id, kind, uom, display_name, identity_provenance) values
  ('a8200000-0000-4000-8000-000000000001', 'a8100000-0000-4000-8000-000000000001', 'wine', 'bottle', 'SYNTHETIC Red', 'house_declared');
insert into public.deliveries (id, restaurant_id, state) values
  ('a8300000-0000-4000-8000-000000000001', 'a8100000-0000-4000-8000-000000000001', 'VERIFIED'),
  ('a8300000-0000-4000-8000-000000000002', 'a8100000-0000-4000-8000-000000000001', 'VERIFIED');
-- lot 1: delivery 1 at 10; lot 2: delivery 2 at 12; lot 3: delivery 2 at 10; lot 4: delivery 1 at 7
insert into public.inventory_lots (id, restaurant_id, inventory_id, delivery_id, qty, unit_cost, cost_state) values
  ('a8400000-0000-4000-8000-000000000001', 'a8100000-0000-4000-8000-000000000001', 'a8200000-0000-4000-8000-000000000001', 'a8300000-0000-4000-8000-000000000001', 6, 10, 'final'),
  ('a8400000-0000-4000-8000-000000000002', 'a8100000-0000-4000-8000-000000000001', 'a8200000-0000-4000-8000-000000000001', 'a8300000-0000-4000-8000-000000000002', 6, 12, 'final'),
  ('a8400000-0000-4000-8000-000000000003', 'a8100000-0000-4000-8000-000000000001', 'a8200000-0000-4000-8000-000000000001', 'a8300000-0000-4000-8000-000000000002', 6, 10, 'final'),
  ('a8400000-0000-4000-8000-000000000004', 'a8100000-0000-4000-8000-000000000001', 'a8200000-0000-4000-8000-000000000001', 'a8300000-0000-4000-8000-000000000001', 6, 7, 'final');
insert into public.inventory_lot_revaluations (id, restaurant_id, inventory_id, lot_id, qty_at_revaluation, new_unit_cost, new_cost_provenance, created_at) values
  -- lot 1's settlement at 10 (newest of this house), what finalise_delivery_cost writes
  ('a8500000-0000-4000-8000-000000000001', 'a8100000-0000-4000-8000-000000000001', 'a8200000-0000-4000-8000-000000000001', 'a8400000-0000-4000-8000-000000000001', 6, 10, 'invoice', now() - interval '1 minute'),
  -- lot 1, an older estimate at 9, and an older settlement at the same 10: neither is this stamp's
  ('a8500000-0000-4000-8000-000000000003', 'a8100000-0000-4000-8000-000000000001', 'a8200000-0000-4000-8000-000000000001', 'a8400000-0000-4000-8000-000000000001', 6, 9, 'estimated', now() - interval '2 days'),
  ('a8500000-0000-4000-8000-000000000005', 'a8100000-0000-4000-8000-000000000001', 'a8200000-0000-4000-8000-000000000001', 'a8400000-0000-4000-8000-000000000001', 6, 10, 'invoice', now() - interval '3 days'),
  -- another house's row pointing at lot 1, newer than all: never this house's to stamp
  ('a8500000-0000-4000-8000-000000000006', 'a8100000-0000-4000-8000-000000000002', 'a8200000-0000-4000-8000-000000000001', 'a8400000-0000-4000-8000-000000000001', 6, 10, 'invoice', now()),
  -- lot 2's newest row is a hand cost at 12: a person's price is never stamped
  ('a8500000-0000-4000-8000-000000000002', 'a8100000-0000-4000-8000-000000000001', 'a8200000-0000-4000-8000-000000000001', 'a8400000-0000-4000-8000-000000000002', 6, 12, 'manual', now() - interval '1 minute'),
  -- lot 3's newest row settled at 11, not the lot's 10
  ('a8500000-0000-4000-8000-000000000004', 'a8100000-0000-4000-8000-000000000001', 'a8200000-0000-4000-8000-000000000001', 'a8400000-0000-4000-8000-000000000003', 6, 11, 'invoice', now() - interval '1 minute'),
  -- lot 4's settlement at 7
  ('a8500000-0000-4000-8000-000000000007', 'a8100000-0000-4000-8000-000000000001', 'a8200000-0000-4000-8000-000000000001', 'a8400000-0000-4000-8000-000000000004', 6, 7, 'invoice', now() - interval '1 minute');

create function pg_temp.b(p uuid) returns text language sql as $$
  select cost_tax_basis from public.inventory_lot_revaluations where id = p $$;

-- T1: the column exists, and every row starts NULL (no backfill).
do $$ begin
  if (select count(*) from public.inventory_lot_revaluations where cost_tax_basis is not null) <> 0 then
    raise exception 'T1: rows must start with no stated basis';
  end if;
end $$;

-- T2: only net, gross_cost or NULL is held.
do $$ begin
  begin
    update public.inventory_lot_revaluations set cost_tax_basis = 'included'
     where id = 'a8500000-0000-4000-8000-000000000001';
    raise exception 'T2: an unknown word was accepted';
  exception when check_violation then null;
  end;
end $$;

-- T3: ADR 0359 C3's stamp on lot 1 reaches lot 1's newest settlement, and no
-- older row, no estimate, no other house's row.
do $$ declare out jsonb; begin
  out := public.stamp_delivery_cost_tax_basis('a8100000-0000-4000-8000-000000000001', 'a8300000-0000-4000-8000-000000000001',
                                              'a8200000-0000-4000-8000-000000000001', 10, 'gross_cost');
  if (out->>'lots_stamped')::int <> 1 then raise exception 'T3: expected lot 1 stamped, got %', out; end if;
  if pg_temp.b('a8500000-0000-4000-8000-000000000001') is distinct from 'gross_cost' then
    raise exception 'T3: lot 1''s settlement did not keep its lot''s basis';
  end if;
  if (select count(*) from public.inventory_lot_revaluations where cost_tax_basis is not null) <> 1 then
    raise exception 'T3: an older row, an estimate or another house''s row was stamped';
  end if;
end $$;

-- T4: the lot is used up and deleted; the settlement still says its basis.
do $$ begin
  delete from public.inventory_lots where id = 'a8400000-0000-4000-8000-000000000001';
  if (select lot_id from public.inventory_lot_revaluations where id = 'a8500000-0000-4000-8000-000000000001') is not null then
    raise exception 'T4: fixture: lot_id should go NULL';
  end if;
  if pg_temp.b('a8500000-0000-4000-8000-000000000001') is distinct from 'gross_cost' then
    raise exception 'T4: the settlement lost its basis with its lot';
  end if;
end $$;

-- T5: a hand cost is never stamped, nor a settlement at another cost, even
-- when the lot itself is.
do $$ begin
  perform public.stamp_delivery_cost_tax_basis('a8100000-0000-4000-8000-000000000001', 'a8300000-0000-4000-8000-000000000002',
                                               'a8200000-0000-4000-8000-000000000001', 12, 'net');
  perform public.stamp_delivery_cost_tax_basis('a8100000-0000-4000-8000-000000000001', 'a8300000-0000-4000-8000-000000000002',
                                               'a8200000-0000-4000-8000-000000000001', 10, 'net');
  if (select count(*) from public.inventory_lots where id in ('a8400000-0000-4000-8000-000000000002', 'a8400000-0000-4000-8000-000000000003')
       and cost_tax_basis = 'net') <> 2 then
    raise exception 'T5: fixture: lots 2 and 3 should be stamped';
  end if;
  if pg_temp.b('a8500000-0000-4000-8000-000000000002') is not null then raise exception 'T5: a hand cost was stamped'; end if;
  if pg_temp.b('a8500000-0000-4000-8000-000000000004') is not null then raise exception 'T5: a settlement at another cost was stamped'; end if;
end $$;

-- T6: a stated settlement is never restated, and clearing the lot's stamp
-- leaves the settlement's alone.
do $$ begin
  update public.inventory_lots set cost_tax_basis = 'gross_cost' where id = 'a8400000-0000-4000-8000-000000000004';
  update public.inventory_lots set cost_tax_basis = 'net' where id = 'a8400000-0000-4000-8000-000000000004';
  if pg_temp.b('a8500000-0000-4000-8000-000000000007') is distinct from 'gross_cost' then
    raise exception 'T6: a stated settlement was restated';
  end if;
  update public.inventory_lots set cost_tax_basis = null where id = 'a8400000-0000-4000-8000-000000000004';
  if pg_temp.b('a8500000-0000-4000-8000-000000000007') is distinct from 'gross_cost' then
    raise exception 'T6: clearing the lot cleared the settlement';
  end if;
end $$;

-- T7: no client role may call the trigger function.
do $$ begin
  if has_function_privilege('authenticated', 'public.settled_cost_keeps_its_lots_tax_basis()', 'execute')
     or has_function_privilege('anon', 'public.settled_cost_keeps_its_lots_tax_basis()', 'execute') then
    raise exception 'T7: a client role may call the copy';
  end if;
end $$;

rollback;

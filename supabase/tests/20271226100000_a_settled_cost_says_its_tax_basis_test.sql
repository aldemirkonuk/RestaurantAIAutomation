-- SQL tests for 20271226100000_a_settled_cost_says_its_tax_basis.sql.
-- Plain psql assertions against a throwaway Postgres built from
-- supabase/migrations (see 20260905232000_..._test.sql for the recipe):
--     psql -v ON_ERROR_STOP=1 -f supabase/tests/20271226100000_a_settled_cost_says_its_tax_basis_test.sql
-- Every assertion RAISEs on failure; the file runs in one transaction that is
-- ROLLED BACK. NEVER run it against production. All fixtures are SYNTHETIC.
begin;

insert into public.restaurants (id, name, slug) values
  ('a8100000-0000-4000-8000-000000000001', 'SYNTHETIC Basis House', 'synthetic-basis'),
  ('a8100000-0000-4000-8000-000000000002', 'SYNTHETIC Other House', 'synthetic-basis-other');
insert into public.restaurant_inventory (id, restaurant_id, kind, uom, display_name, identity_provenance) values
  ('a8200000-0000-4000-8000-000000000001', 'a8100000-0000-4000-8000-000000000001', 'wine', 'bottle', 'SYNTHETIC Red', 'house_declared'),
  ('a8200000-0000-4000-8000-000000000002', 'a8100000-0000-4000-8000-000000000002', 'wine', 'bottle', 'SYNTHETIC Other', 'house_declared');
insert into public.deliveries (id, restaurant_id, state) values
  ('a8300000-0000-4000-8000-000000000001', 'a8100000-0000-4000-8000-000000000001', 'VERIFIED'),
  ('a8300000-0000-4000-8000-000000000002', 'a8100000-0000-4000-8000-000000000001', 'VERIFIED');
insert into public.inventory_lots (id, restaurant_id, inventory_id, delivery_id, qty, unit_cost) values
  ('a8400000-0000-4000-8000-000000000001', 'a8100000-0000-4000-8000-000000000001', 'a8200000-0000-4000-8000-000000000001', 'a8300000-0000-4000-8000-000000000001', 6, 10),
  ('a8400000-0000-4000-8000-000000000002', 'a8100000-0000-4000-8000-000000000001', 'a8200000-0000-4000-8000-000000000001', 'a8300000-0000-4000-8000-000000000002', 6, 12),
  ('a8400000-0000-4000-8000-000000000003', 'a8100000-0000-4000-8000-000000000001', 'a8200000-0000-4000-8000-000000000001', 'a8300000-0000-4000-8000-000000000002', 6, 10);
insert into public.inventory_lot_revaluations (id, restaurant_id, inventory_id, lot_id, qty_at_revaluation, new_unit_cost, new_cost_provenance) values
  ('a8500000-0000-4000-8000-000000000001', 'a8100000-0000-4000-8000-000000000001', 'a8200000-0000-4000-8000-000000000001', 'a8400000-0000-4000-8000-000000000001', 6, 10, 'invoice'),
  ('a8500000-0000-4000-8000-000000000002', 'a8100000-0000-4000-8000-000000000001', 'a8200000-0000-4000-8000-000000000001', 'a8400000-0000-4000-8000-000000000002', 6, 12, 'invoice'),
  -- another delivery's lot at the same cost: not this paper's
  ('a8500000-0000-4000-8000-000000000004', 'a8100000-0000-4000-8000-000000000001', 'a8200000-0000-4000-8000-000000000001', 'a8400000-0000-4000-8000-000000000003', 6, 10, 'invoice'),
  -- same delivery's lot, an older cost: not the cost the stamp is about
  ('a8500000-0000-4000-8000-000000000003', 'a8100000-0000-4000-8000-000000000001', 'a8200000-0000-4000-8000-000000000001', 'a8400000-0000-4000-8000-000000000001', 6, 9, 'estimated');

-- T1: the column exists, is nullable, and every row starts NULL (no backfill).
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

-- T3: the stamp marks only this delivery's row at this very cost.
do $$ declare out jsonb; begin
  out := public.stamp_settled_cost_tax_basis('a8100000-0000-4000-8000-000000000001', 'a8300000-0000-4000-8000-000000000001',
                                             'a8200000-0000-4000-8000-000000000001', 10, 'gross_cost');
  if (out->>'rows_stamped')::int <> 1 then raise exception 'T3: expected 1 row stamped, got %', out; end if;
  if (select cost_tax_basis from public.inventory_lot_revaluations where id = 'a8500000-0000-4000-8000-000000000001') <> 'gross_cost' then
    raise exception 'T3: the row was not stamped';
  end if;
  if (select count(*) from public.inventory_lot_revaluations where cost_tax_basis is not null) <> 1 then
    raise exception 'T3: another delivery''s row or an older cost was stamped';
  end if;
end $$;

-- T4: a row already stated is never restated by a later stamp.
do $$ declare out jsonb; begin
  out := public.stamp_settled_cost_tax_basis('a8100000-0000-4000-8000-000000000001', 'a8300000-0000-4000-8000-000000000001',
                                             'a8200000-0000-4000-8000-000000000001', 10, 'net');
  if (out->>'rows_stamped')::int <> 0 then raise exception 'T4: a stated row was restated'; end if;
end $$;

-- T5: another house's item is refused, and NULL or an unknown word is refused.
do $$ begin
  begin
    perform public.stamp_settled_cost_tax_basis('a8100000-0000-4000-8000-000000000001', 'a8300000-0000-4000-8000-000000000001',
                                                'a8200000-0000-4000-8000-000000000002', 10, 'net');
    raise exception 'T5: another house''s item was stamped';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.stamp_settled_cost_tax_basis('a8100000-0000-4000-8000-000000000001', 'a8300000-0000-4000-8000-000000000002',
                                                'a8200000-0000-4000-8000-000000000001', 12, null);
    raise exception 'T5: a NULL stamp was accepted';
  exception when invalid_parameter_value then null;
  end;
end $$;

-- T6: neither anon nor authenticated may call the stamp.
do $$ begin
  if has_function_privilege('authenticated', 'public.stamp_settled_cost_tax_basis(uuid, uuid, uuid, numeric, text)', 'execute')
     or has_function_privilege('anon', 'public.stamp_settled_cost_tax_basis(uuid, uuid, uuid, numeric, text)', 'execute') then
    raise exception 'T6: a client role may stamp a cost';
  end if;
end $$;

rollback;

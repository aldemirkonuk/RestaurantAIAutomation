-- ADR 0359 C2/C3, lane 3.5a: a house says whether it reclaims the tax it
-- pays, and a lot's cost says whether tax is inside it.
--
-- Self-asserting: every block raises on a failure, so `psql -v ON_ERROR_STOP=1`
-- stops at the first one. Without the migration, T1 fails (no column). One
-- transaction, rolled back. Fixtures are SYNTHETIC, keyed by fresh uuids.
--
--   T1 every existing house reads unset, with no reclaim answer.
--   T2 an answer needs its author; a no-VAT house cannot reclaim.
--   T3 the switch date is set by the first answer and never moves.
--   T4 a stamp lands only on this delivery's final lots at this cost.
--   T5 a changed cost clears its stamp; restating the stamp keeps it.
--   T6 the stamp refuses another house's item and a value that is not a basis.

begin;

create temporary table t_fx (k text primary key, v uuid) on commit drop;
insert into t_fx values
  ('house', gen_random_uuid()), ('other', gen_random_uuid()), ('user', gen_random_uuid()),
  ('item', gen_random_uuid()), ('other_item', gen_random_uuid()),
  ('del', gen_random_uuid()), ('del2', gen_random_uuid()),
  ('lot_final', gen_random_uuid()), ('lot_prov', gen_random_uuid()),
  ('lot_other_del', gen_random_uuid()), ('lot_revalued', gen_random_uuid());

insert into public.restaurants (id, name, slug)
select v, 'SYNTHETIC tax house ' || k, 'syn-tax-' || left(replace(v::text, '-', ''), 16)
  from t_fx where k in ('house', 'other');

insert into public.users (user_id, email, name, restaurant_id, role)
select v, 'synthetic-' || left(replace(v::text, '-', ''), 12) || '@example.invalid',
       'SYNTHETIC owner', (select v from t_fx where k = 'house'), 'owner'
  from t_fx where k = 'user';

insert into public.restaurant_inventory
  (id, restaurant_id, master_wine_id, kind, uom, display_name, identity_provenance)
select (select v from t_fx where k = i), (select v from t_fx where k = h),
       null, 'food', 'g', n, 'house_declared'
  from (values ('item', 'house', 'SYNTHETIC flour'), ('other_item', 'other', 'SYNTHETIC salt')) as x(i, h, n);

-- Four lots of the one item: this delivery's final lot at 100, a provisional
-- lot of the same delivery, a final lot of another delivery at 100, and a lot
-- of this delivery revalued to 90 since.
insert into public.inventory_lots
  (id, restaurant_id, inventory_id, master_wine_id, qty, unit_cost, cost_provenance, cost_state, delivery_id)
values
  ((select v from t_fx where k = 'lot_final'), (select v from t_fx where k = 'house'), (select v from t_fx where k = 'item'),
   null, 6, 100, 'invoice', 'final', (select v from t_fx where k = 'del')),
  ((select v from t_fx where k = 'lot_prov'), (select v from t_fx where k = 'house'), (select v from t_fx where k = 'item'),
   null, 2, 100, 'invoice', 'provisional', (select v from t_fx where k = 'del')),
  ((select v from t_fx where k = 'lot_other_del'), (select v from t_fx where k = 'house'), (select v from t_fx where k = 'item'),
   null, 4, 100, 'invoice', 'final', (select v from t_fx where k = 'del2')),
  ((select v from t_fx where k = 'lot_revalued'), (select v from t_fx where k = 'house'), (select v from t_fx where k = 'item'),
   null, 3, 90, 'manual', 'final', (select v from t_fx where k = 'del'));

-- T1
do $$
declare r record;
begin
  select tax_basis, reclaims_input_tax, tax_basis_since into r
    from public.restaurants where id = (select v from t_fx where k = 'house');
  assert r.tax_basis = 'unset', format('T1 FAIL tax_basis is %s, expected unset', r.tax_basis);
  assert r.reclaims_input_tax is null, 'T1 FAIL reclaims_input_tax is not null';
  assert r.tax_basis_since is null, 'T1 FAIL a house that never answered has a switch date';
  assert (select cost_tax_basis from public.inventory_lots where id = (select v from t_fx where k = 'lot_final')) is null,
    'T1 FAIL an existing lot carries a stamp';
end $$;

-- T2
do $$
declare v_house uuid := (select v from t_fx where k = 'house');
begin
  begin
    update public.restaurants set tax_basis = 'prices_include_tax', reclaims_input_tax = true where id = v_house;
    raise exception 'T2 FAIL an answer with no author was stored';
  exception when check_violation then null;
  end;
  begin
    update public.restaurants set reclaims_input_tax = true where id = v_house;
    raise exception 'T2 FAIL a reclaim answer was stored with no basis';
  exception when check_violation then null;
  end;
  begin
    update public.restaurants
       set tax_basis = 'not_vat_charging', reclaims_input_tax = true,
           tax_basis_set_by = (select v from t_fx where k = 'user'), tax_basis_set_at = now()
     where id = v_house;
    raise exception 'T2 FAIL a house that charges no VAT was stored as reclaiming it';
  exception when check_violation then null;
  end;
  begin
    update public.restaurants
       set tax_basis = 'kdv_inside',
           tax_basis_set_by = (select v from t_fx where k = 'user'), tax_basis_set_at = now()
     where id = v_house;
    raise exception 'T2 FAIL a basis outside the four was stored';
  exception when check_violation then null;
  end;
end $$;

-- T3
do $$
declare
  v_house uuid := (select v from t_fx where k = 'house');
  v_user uuid := (select v from t_fx where k = 'user');
  first_since timestamptz;
  later_since timestamptz;
begin
  update public.restaurants
     set tax_basis = 'prices_include_tax', reclaims_input_tax = true,
         tax_basis_set_by = v_user, tax_basis_set_at = '2027-01-05T09:00:00Z'
   where id = v_house;
  select tax_basis_since into first_since from public.restaurants where id = v_house;
  assert first_since = '2027-01-05T09:00:00Z'::timestamptz,
    format('T3 FAIL the switch date is %s, expected the first answer''s moment', first_since);

  update public.restaurants
     set tax_basis = 'prices_exclude_tax', reclaims_input_tax = false,
         tax_basis_set_at = '2027-03-01T09:00:00Z', tax_basis_since = '2027-03-01T09:00:00Z'
   where id = v_house;
  select tax_basis_since into later_since from public.restaurants where id = v_house;
  assert later_since = first_since,
    format('T3 FAIL a later answer moved the switch date to %s', later_since);
end $$;

-- T4
do $$
declare
  j jsonb;
begin
  j := public.stamp_delivery_cost_tax_basis(
    (select v from t_fx where k = 'house'), (select v from t_fx where k = 'del'),
    (select v from t_fx where k = 'item'), 100, 'net');
  assert (j->>'lots_stamped')::int = 1, format('T4 FAIL stamped %s lots, expected 1', j->>'lots_stamped');
  assert (select cost_tax_basis from public.inventory_lots where id = (select v from t_fx where k = 'lot_final')) = 'net',
    'T4 FAIL the delivery''s final lot at 100 was not stamped';
  assert (select cost_tax_basis from public.inventory_lots where id = (select v from t_fx where k = 'lot_prov')) is null,
    'T4 FAIL a provisional lot was stamped';
  assert (select cost_tax_basis from public.inventory_lots where id = (select v from t_fx where k = 'lot_other_del')) is null,
    'T4 FAIL another delivery''s lot was stamped';
  assert (select cost_tax_basis from public.inventory_lots where id = (select v from t_fx where k = 'lot_revalued')) is null,
    'T4 FAIL a lot at another cost was stamped';
  -- Idempotent: the same stamp again stamps nothing new.
  j := public.stamp_delivery_cost_tax_basis(
    (select v from t_fx where k = 'house'), (select v from t_fx where k = 'del'),
    (select v from t_fx where k = 'item'), 100, 'net');
  assert (j->>'lots_stamped')::int = 0, format('T4 FAIL a repeat stamped %s lots', j->>'lots_stamped');
end $$;

-- T5
do $$
declare v_lot uuid := (select v from t_fx where k = 'lot_final');
begin
  update public.inventory_lots set qty = 5 where id = v_lot;
  assert (select cost_tax_basis from public.inventory_lots where id = v_lot) = 'net',
    'T5 FAIL a quantity change cleared the stamp';
  update public.inventory_lots set unit_cost = 100 where id = v_lot;
  assert (select cost_tax_basis from public.inventory_lots where id = v_lot) = 'net',
    'T5 FAIL rewriting the same cost cleared the stamp';
  update public.inventory_lots set unit_cost = 110, cost_tax_basis = 'gross_cost' where id = v_lot;
  assert (select cost_tax_basis from public.inventory_lots where id = v_lot) = 'gross_cost',
    'T5 FAIL a new cost written with its own stamp lost it';
  update public.inventory_lots set unit_cost = 95 where id = v_lot;
  assert (select cost_tax_basis from public.inventory_lots where id = v_lot) is null,
    'T5 FAIL a new cost kept the old cost''s stamp';
end $$;

-- T6
do $$
begin
  begin
    perform public.stamp_delivery_cost_tax_basis(
      (select v from t_fx where k = 'house'), (select v from t_fx where k = 'del'),
      (select v from t_fx where k = 'other_item'), 100, 'net');
    raise exception 'T6 FAIL another house''s item was stamped';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.stamp_delivery_cost_tax_basis(
      (select v from t_fx where k = 'house'), (select v from t_fx where k = 'del'),
      (select v from t_fx where k = 'item'), 100, 'includes_tax');
    raise exception 'T6 FAIL a value that is not a cost basis was accepted';
  exception when invalid_parameter_value then null;
  end;
end $$;

select 'ALL OK' as result;

rollback;

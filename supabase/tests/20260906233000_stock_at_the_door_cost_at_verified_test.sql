-- SQL tests for 20260906233000_stock_at_the_door_cost_at_verified.sql
-- (ADR 0103 A1 + A5; v3.0-TECH-DEBT.md 2026-09-06 finding 2 / V2).
--
-- HOW TO RUN. Plain psql assertions against a throwaway Postgres built from
-- supabase/migrations in filename order (recipe: pgvector/pgvector:pg17 +
-- postgresql-17-postgis-3, the Supabase roles and schemas, pgcrypto/uuid-ossp in
-- `extensions`, pg_trgm/btree_gist/vector/postgis in `public`, an `auth.users`
-- stub, the PostGIS revokes). Then:
--
--     psql -v ON_ERROR_STOP=1 -f supabase/tests/20260906233000_stock_at_the_door_cost_at_verified_test.sql
--
-- Every assertion RAISEs on failure. The whole file runs in one transaction that
-- is ROLLED BACK. NEVER run it against production. All fixtures are SYNTHETIC.
--
-- FAILING-FIRST. Each assertion was run against a CONTROL database built from
-- the same tree MINUS this migration; the control results are recorded in the
-- PR body. A1–A3 and A5–A8 are false or error there.

begin;

insert into public.restaurants (id, name, slug)
values ('a5000000-0000-0000-0000-000000000a01'::uuid, 'SYNTHETIC A5 Meyhane', 'synthetic-a5')
on conflict do nothing;

insert into public.master_wine_library (id, wine_id, name, primary_type)
values ('a5000000-0000-0000-0000-000000000b01'::uuid, 'SYN-A5-001', 'SYNTHETIC Öküzgözü', 'red');

insert into public.restaurant_inventory (id, restaurant_id, master_wine_id)
values ('a5000000-0000-0000-0000-000000000c01'::uuid,
        'a5000000-0000-0000-0000-000000000a01'::uuid,
        'a5000000-0000-0000-0000-000000000b01'::uuid);

insert into public.deliveries (id, restaurant_id, state, provenance)
values ('a5000000-0000-0000-0000-000000000d01'::uuid,
        'a5000000-0000-0000-0000-000000000a01'::uuid, 'DELIVERED', 'UNORDERED');

-- ---------------------------------------------------------------------------
-- A1 — the default no longer certifies
-- ---------------------------------------------------------------------------
do $$
declare d text;
begin
  select column_default into d
    from information_schema.columns
   where table_name = 'inventory_lots' and column_name = 'cost_state';
  if d is null or d not like '%provisional%' then
    raise exception 'A1 FAILED: inventory_lots.cost_state default is % (want provisional)', d;
  end if;
  raise notice 'A1 ok — cost_state defaults to provisional';
end;
$$;

-- ---------------------------------------------------------------------------
-- A2 — a lot knows its delivery
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_name = 'inventory_lots' and column_name = 'delivery_id') then
    raise exception 'A2 FAILED: inventory_lots.delivery_id does not exist';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'inventory_lots_delivery_id_fkey') then
    raise exception 'A2 FAILED: inventory_lots.delivery_id has no FK to deliveries';
  end if;
  raise notice 'A2 ok — inventory_lots.delivery_id exists with its FK';
end;
$$;

-- ---------------------------------------------------------------------------
-- A3 — a movement that names a delivery books a PROVISIONAL lot against it,
--      and stamps the ledger row with the same delivery
-- ---------------------------------------------------------------------------
do $$
declare v_txn uuid; v_lot record; v_delivery_on_txn uuid;
begin
  v_txn := public.apply_stock_movement(
    p_inventory_id     => 'a5000000-0000-0000-0000-000000000c01'::uuid,
    p_stock_state      => 'live',
    p_delta            => 10,
    p_transaction_type => 'purchase',
    p_source           => 'order',
    p_reason           => 'SYNTHETIC door count',
    p_idempotency_key  => 'delivery-line:a5000000-0000-0000-0000-000000000d01:doc:1',
    p_reference_type   => 'delivery',
    p_reference_id     => 'a5000000-0000-0000-0000-000000000d01'::uuid
  );
  if v_txn is null then raise exception 'A3 FAILED: no transaction written'; end if;

  select * into v_lot from inventory_lots
   where inventory_id = 'a5000000-0000-0000-0000-000000000c01'::uuid;
  if v_lot.delivery_id is distinct from 'a5000000-0000-0000-0000-000000000d01'::uuid then
    raise exception 'A3 FAILED: lot delivery_id is %', v_lot.delivery_id;
  end if;
  if v_lot.cost_state <> 'provisional' then
    raise exception 'A3 FAILED: a door-booked lot is % (want provisional)', v_lot.cost_state;
  end if;
  if v_lot.unit_cost is not null then
    raise exception 'A3 FAILED: a door-booked lot carries a price of % — nobody read an invoice (A6)', v_lot.unit_cost;
  end if;

  select delivery_id into v_delivery_on_txn from inventory_transactions where id = v_txn;
  if v_delivery_on_txn is distinct from 'a5000000-0000-0000-0000-000000000d01'::uuid then
    raise exception 'A3 FAILED: inventory_transactions.delivery_id is %', v_delivery_on_txn;
  end if;
  raise notice 'A3 ok — the door books provisional stock against the delivery, priced at nothing rather than at zero';
end;
$$;

-- ---------------------------------------------------------------------------
-- A4 — the idempotency key is the door's, and a second identical booking is
--      the SAME transaction, not a second one
-- ---------------------------------------------------------------------------
do $$
declare v_txn uuid; n int;
begin
  v_txn := public.apply_stock_movement(
    p_inventory_id     => 'a5000000-0000-0000-0000-000000000c01'::uuid,
    p_stock_state      => 'live',
    p_delta            => 10,
    p_transaction_type => 'purchase',
    p_source           => 'order',
    p_idempotency_key  => 'delivery-line:a5000000-0000-0000-0000-000000000d01:doc:1',
    p_reference_type   => 'delivery',
    p_reference_id     => 'a5000000-0000-0000-0000-000000000d01'::uuid
  );
  select count(*) into n from inventory_transactions
   where inventory_id = 'a5000000-0000-0000-0000-000000000c01'::uuid;
  if n <> 1 then raise exception 'A4 FAILED: % ledger rows after a repeated booking', n; end if;
  select coalesce(sum(qty),0) into n from inventory_lots
   where inventory_id = 'a5000000-0000-0000-0000-000000000c01'::uuid;
  if n <> 10 then raise exception 'A4 FAILED: % bottles on the shelf after a repeated booking', n; end if;
  raise notice 'A4 ok — one (delivery, document, line) books once';
end;
$$;

-- ---------------------------------------------------------------------------
-- A5 — VERIFIED finalises the COST and never the quantity
-- ---------------------------------------------------------------------------
do $$
declare r jsonb; v_lot record; n int;
begin
  r := public.finalise_delivery_cost(
    'a5000000-0000-0000-0000-000000000d01'::uuid,
    'a5000000-0000-0000-0000-000000000c01'::uuid,
    142.50, 'invoice', null, 'SYNTHETIC verify');
  if (r->>'lots_finalised')::int <> 1 then
    raise exception 'A5 FAILED: lots_finalised = %', r->>'lots_finalised';
  end if;
  select * into v_lot from inventory_lots
   where inventory_id = 'a5000000-0000-0000-0000-000000000c01'::uuid;
  if v_lot.cost_state <> 'final' then raise exception 'A5 FAILED: cost_state is %', v_lot.cost_state; end if;
  if v_lot.unit_cost <> 142.50 then raise exception 'A5 FAILED: unit_cost is %', v_lot.unit_cost; end if;
  if v_lot.qty <> 10 then raise exception 'A5 FAILED: verification moved the quantity to %', v_lot.qty; end if;
  select count(*) into n from inventory_transactions
   where inventory_id = 'a5000000-0000-0000-0000-000000000c01'::uuid;
  if n <> 1 then raise exception 'A5 FAILED: finalising cost wrote a ledger row (% rows)', n; end if;
  select count(*) into n from inventory_lot_revaluations where lot_id = v_lot.id;
  if n <> 1 then raise exception 'A5 FAILED: the prior cost was not recorded (% revaluations)', n; end if;
  raise notice 'A5 ok — cost finalises at VERIFIED, quantity untouched, prior cost kept';
end;
$$;

-- ---------------------------------------------------------------------------
-- A6 — finalising to NULL is refused rather than stamping `final` on nothing
-- ---------------------------------------------------------------------------
do $$
declare ok boolean := false;
begin
  begin
    perform public.finalise_delivery_cost(
      'a5000000-0000-0000-0000-000000000d01'::uuid,
      'a5000000-0000-0000-0000-000000000c01'::uuid,
      null, 'invoice');
  exception when others then ok := true;
  end;
  if not ok then
    raise exception 'A6 FAILED: a NULL price was accepted as a final cost';
  end if;
  raise notice 'A6 ok — a lot with no agreed price does not become a final cost of nothing';
end;
$$;

-- ---------------------------------------------------------------------------
-- A7 — a movement that names NO delivery still refuses to certify an estimate
-- ---------------------------------------------------------------------------
do $$
declare v_lot record;
begin
  insert into public.master_wine_library (id, wine_id, name, primary_type)
  values ('a5000000-0000-0000-0000-000000000b02'::uuid, 'SYN-A5-002', 'SYNTHETIC Boğazkere', 'red');
  insert into public.restaurant_inventory (id, restaurant_id, master_wine_id)
  values ('a5000000-0000-0000-0000-000000000c02'::uuid,
          'a5000000-0000-0000-0000-000000000a01'::uuid,
          'a5000000-0000-0000-0000-000000000b02'::uuid);
  perform public.apply_stock_movement(
    p_inventory_id     => 'a5000000-0000-0000-0000-000000000c02'::uuid,
    p_stock_state      => 'live',
    p_delta            => 4,
    p_transaction_type => 'purchase',
    p_source           => 'manual',
    p_unit_cost        => 90,
    p_cost_provenance  => 'estimated',
    p_idempotency_key  => 'a5-estimated-1'
  );
  select * into v_lot from inventory_lots
   where inventory_id = 'a5000000-0000-0000-0000-000000000c02'::uuid;
  if v_lot.cost_state <> 'provisional' then
    raise exception 'A7 FAILED: an ESTIMATED price produced cost_state %', v_lot.cost_state;
  end if;

  perform public.apply_stock_movement(
    p_inventory_id     => 'a5000000-0000-0000-0000-000000000c02'::uuid,
    p_stock_state      => 'live',
    p_delta            => 2,
    p_transaction_type => 'purchase',
    p_source           => 'manual',
    p_unit_cost        => 90,
    p_cost_provenance  => 'manual',
    p_idempotency_key  => 'a5-manual-1'
  );
  select * into v_lot from inventory_lots
   where inventory_id = 'a5000000-0000-0000-0000-000000000c02'::uuid and qty = 2;
  if v_lot.cost_state <> 'final' then
    raise exception 'A7 FAILED: a price a person typed produced cost_state %', v_lot.cost_state;
  end if;
  raise notice 'A7 ok — estimated is provisional, stated is final';
end;
$$;

-- ---------------------------------------------------------------------------
-- A8 — a reversal takes the bottles back off the shelf
-- ---------------------------------------------------------------------------
do $$
declare n int;
begin
  perform public.apply_stock_movement(
    p_inventory_id     => 'a5000000-0000-0000-0000-000000000c01'::uuid,
    p_stock_state      => 'live',
    p_delta            => -10,
    p_transaction_type => 'adjustment',
    p_source           => 'order',
    p_reason           => 'SYNTHETIC delivery rejected',
    p_idempotency_key  => 'delivery-reversal:a5000000-0000-0000-0000-000000000d01:doc:1',
    p_reference_type   => 'delivery',
    p_reference_id     => 'a5000000-0000-0000-0000-000000000d01'::uuid
  );
  select coalesce(sum(qty),0) into n from inventory_lots
   where inventory_id = 'a5000000-0000-0000-0000-000000000c01'::uuid;
  if n <> 0 then raise exception 'A8 FAILED: % bottles remain after the reversal', n; end if;
  raise notice 'A8 ok — a rejected delivery gives the bottles back';
end;
$$;

rollback;

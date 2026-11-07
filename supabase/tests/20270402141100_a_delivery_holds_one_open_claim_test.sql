-- uq_pc_order_one_open_claim, migration a_delivery_holds_one_open_claim (QA
-- round 9c on #821): a delivery holds at most one OPEN order-level claim,
-- whatever its reason.
--
-- Run against a database built from supabase/migrations (the Docker recipe,
-- `pgtest.sh`). One transaction, ROLLED BACK. It prints one row per test (id,
-- ok, detail), then RAISES unless all nine ran and every "ok" is true. CI runs
-- no supabase/tests file (claim SUPABASE-TESTS-RUN-IN-CI).
--
-- The control: against the corpus WITHOUT a_delivery_holds_one_open_claim, T1
-- and T9 come out false (the second open claim with another reason is stored).
-- T2-T8 hold on the control too: they pin what the index must NOT refuse --
-- the service's restate, a raise after a set-aside, a draft beside a claim
-- with the vendor, never_arrived, document claims and another order.
--
-- Fixtures are synthetic: one house, one vendor, one item, three orders; the
-- claims are written in the shape `openCreditClaim` writes (order-level:
-- document and line NULL).

begin;

create temp table _t (id text primary key, ok boolean, detail text) on commit drop;

do $$
declare
  h uuid; p uuid; i uuid; o1 uuid; o2 uuid; o3 uuid; d uuid; c1 uuid;
  st text; msg text; n int;
begin
  insert into public.restaurants (name, slug)
    values ('T9C House', 't9c-' || left(gen_random_uuid()::text, 8)) returning id into h;
  insert into public.providers (name, primary_contact, restaurant_id) values ('T9C Vendor', '{}'::jsonb, h) returning id into p;
  insert into public.restaurant_inventory (restaurant_id, kind, uom, display_name, identity_provenance)
    values (h, 'wine', 'bottle', 'T9C Wine', 'house_declared') returning id into i;
  insert into public.procurement_orders (order_number, restaurant_id, inventory_id, provider_id, quantity, bottles_total, final_price, total_cost, status)
    values ('T-9C-1', h, i, p, 10, 10, 40, 400, 'DELIVERED') returning id into o1;
  insert into public.procurement_orders (order_number, restaurant_id, inventory_id, provider_id, quantity, bottles_total, final_price, total_cost, status)
    values ('T-9C-2', h, i, p, 10, 10, 40, 400, 'DELIVERED') returning id into o2;
  insert into public.procurement_orders (order_number, restaurant_id, inventory_id, provider_id, quantity, bottles_total, final_price, total_cost, status)
    values ('T-9C-3', h, i, p, 10, 10, 40, 400, 'DELIVERED') returning id into o3;
  insert into public.procurement_documents (restaurant_id, doc_type, source_channel) values (h, 'invoice', 'upload') returning id into d;

  -- The first count: 2 of 10 refused as cracked, $80.
  insert into public.procurement_credits (restaurant_id, order_id, provider_id, reason, summary, claimed_amount, state)
    values (h, o1, p, 'damaged', '2 of 10 rejected on arrival', 80, 'open') returning id into c1;

  -- T1 (QA 9c break b): the correction "2 never shipped" (qty_short) cannot
  -- stand as a second open claim beside the damaged one.
  st := 'stored';
  begin
    insert into public.procurement_credits (restaurant_id, order_id, provider_id, reason, claimed_amount, state)
      values (h, o1, p, 'qty_short', 80, 'open');
  exception when unique_violation then
    st := 'refused'; get stacked diagnostics msg = constraint_name;
  end;
  insert into _t values ('T1', st = 'refused' and msg = 'uq_pc_order_one_open_claim',
    format('second open claim with another reason: %s (%s)', st, coalesce(msg, '-')));
  -- On the control the stray claim was stored; T9 counts it, then it goes so
  -- the restate below meets the same table on both builds.
  select count(*) into n from public.procurement_credits where order_id = o1 and state = 'open';
  insert into _t values ('T9', n = 1, format('open claims on the corrected order: %s', n));
  delete from public.procurement_credits where order_id = o1 and id <> c1;

  -- T2: the service's restate (same row, new reason and amount) is allowed.
  update public.procurement_credits set reason = 'qty_short', claimed_amount = 120, summary = 'restated'
    where id = c1 and state = 'open';
  get diagnostics n = row_count;
  insert into _t values ('T2', n = 1, format('restated rows: %s', n));

  -- T3: once set aside (written_off), a fresh open claim may be raised.
  update public.procurement_credits set state = 'written_off', settled_at = now() where id = c1;
  st := 'stored';
  begin
    insert into public.procurement_credits (restaurant_id, order_id, provider_id, reason, claimed_amount, state)
      values (h, o1, p, 'damaged', 40, 'open');
  exception when unique_violation then st := 'refused';
  end;
  insert into _t values ('T3', st = 'stored', format('open claim after a set-aside: %s', st));

  -- T4: a claim with the vendor (requested) does not count; a draft with
  -- another reason may stand beside it.
  update public.procurement_credits set state = 'requested', requested_at = now()
    where order_id = o1 and state = 'open';
  st := 'stored';
  begin
    insert into public.procurement_credits (restaurant_id, order_id, provider_id, reason, claimed_amount, state)
      values (h, o1, p, 'qty_short', 40, 'open');
  exception when unique_violation then st := 'refused';
  end;
  insert into _t values ('T4', st = 'stored', format('open draft beside a requested claim: %s', st));

  -- T5: never_arrived is its own index's business.
  insert into public.procurement_credits (restaurant_id, order_id, provider_id, reason, claimed_amount, state)
    values (h, o2, p, 'damaged', 80, 'open');
  st := 'stored';
  begin
    insert into public.procurement_credits (restaurant_id, order_id, provider_id, reason, claimed_amount, state)
      values (h, o2, p, 'never_arrived', 400, 'open');
  exception when unique_violation then st := 'refused';
  end;
  insert into _t values ('T5', st = 'stored', format('never_arrived beside an open match claim: %s', st));

  -- T6: a claim against a document is not an order-level claim.
  st := 'stored';
  begin
    insert into public.procurement_credits (restaurant_id, order_id, document_id, provider_id, reason, claimed_amount, state)
      values (h, o2, d, p, 'price_variance', 12, 'open');
  exception when unique_violation then st := 'refused';
  end;
  insert into _t values ('T6', st = 'stored', format('document claim beside an open order claim: %s', st));

  -- T7: another order holds its own open claim.
  st := 'stored';
  begin
    insert into public.procurement_credits (restaurant_id, order_id, provider_id, reason, claimed_amount, state)
      values (h, o3, p, 'damaged', 80, 'open');
  exception when unique_violation then st := 'refused';
  end;
  insert into _t values ('T7', st = 'stored', format('open claim on another order: %s', st));

  -- T8: moving an open claim on to the vendor frees the slot for a new draft.
  update public.procurement_credits set state = 'requested', requested_at = now()
    where order_id = o3 and state = 'open';
  st := 'stored';
  begin
    insert into public.procurement_credits (restaurant_id, order_id, provider_id, reason, claimed_amount, state)
      values (h, o3, p, 'qty_short', 40, 'open');
  exception when unique_violation then st := 'refused';
  end;
  insert into _t values ('T8', st = 'stored', format('open draft after the first went to the vendor: %s', st));
end $$;

select id, ok, detail from _t order by length(id), id;

do $$
declare
  n   integer;
  bad text;
begin
  select count(*), string_agg(id, ', ' order by length(id), id) filter (where ok is not true)
    into n, bad
    from _t;
  if n <> 9 or bad is not null then
    raise exception 'a_delivery_holds_one_open_claim test FAILED: % of 9 tests ran; not true: %', n, coalesce(bad, 'none');
  end if;
end $$;

rollback;

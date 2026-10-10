-- F-465: migration one_open_vendor_claim_per_order_and_reason adds
-- uq_pc_order_reason_open — at most one OPEN claim per order and reason that
-- is tied to no document.
--
-- Self-asserting; one transaction, rolled back. It must FAIL on a build
-- without that migration (T1: a second open claim is admitted) and PASS with it.
-- Foreign keys are switched off for this transaction only (replica role), so
-- the claims need no real order, provider or house rows; the unique index is
-- not a trigger and still holds.

begin;
set local session_replication_role = replica;

-- T1 a second open claim for the same order and reason, no document, is refused.
do $$
declare
  o uuid := 'f4650000-0000-4000-8000-000000000001';
  h uuid := 'f4650000-0000-4000-8000-0000000000aa';
  refused boolean := false;
begin
  insert into public.procurement_credits (restaurant_id, order_id, reason, claimed_amount, state)
  values (h, o, 'qty_short', 40, 'open');
  begin
    insert into public.procurement_credits (restaurant_id, order_id, reason, claimed_amount, state)
    values (h, o, 'qty_short', 40, 'open');
  exception when unique_violation then
    refused := true;
  end;
  assert refused, 'T1 FAIL a second open qty_short claim on the same order was admitted';
end $$;

-- T2 what stays allowed: another reason on the same order; the same reason
-- once the first is asked of the vendor or written off; a claim tied to a
-- document line.
do $$
declare
  o uuid := 'f4650000-0000-4000-8000-000000000002';
  h uuid := 'f4650000-0000-4000-8000-0000000000aa';
  n integer;
begin
  insert into public.procurement_credits (restaurant_id, order_id, reason, claimed_amount, state)
  values (h, o, 'qty_short', 40, 'requested'),
         (h, o, 'qty_short', 20, 'open'),
         (h, o, 'damaged', 10, 'open'),
         (h, o, 'damaged', 10, 'written_off');
  insert into public.procurement_credits (restaurant_id, order_id, document_line_id, reason, claimed_amount, state)
  values (h, o, 'f4650000-0000-4000-8000-0000000000d1', 'qty_short', 5, 'open');
  select count(*) into n from public.procurement_credits where order_id = o;
  assert n = 5, format('T2 FAIL expected 5 claims on the order, found %s', n);
end $$;

rollback;

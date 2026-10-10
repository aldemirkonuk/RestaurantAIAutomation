-- W25 / ADR 0313 (4a-i): migration an_order_request_is_a_letter_kind admits
-- 'ORDER_REQUEST' to procurement_conversations.chk_outbound_email_type by
-- read-and-append.
--
-- Self-asserting: every block raises on a failure, so `psql -v ON_ERROR_STOP=1
-- -f` stops at the first one. Run it on a database built from
-- supabase/migrations. Synthetic fixtures only, one transaction, rolled back.
--
-- On a build WITHOUT the migration, T1 and T2 FAIL (23514 on the
-- ORDER_REQUEST insert and on the door's insert). T3 (every prior kind still
-- admitted, and NULL) and T4 (junk still refused) are pins: they pass on that
-- build too, and fail on a rebuild that lost a kind or dropped the CHECK.
-- T5 and T6 (a CHECK the migration must refuse) need psql; see T5.

begin;

insert into public.restaurants (id, name, slug) values
  ('a2513000-0000-4000-8000-000000000001', 'W25 kind house', 'w25-kind-house');
insert into public.providers (id, name, primary_contact, restaurant_id) values
  ('a2513000-0000-4000-8000-0000000000b1', 'Zqor Vendor', '{}'::jsonb, 'a2513000-0000-4000-8000-000000000001');
insert into public.restaurant_inventory (id, restaurant_id, kind, uom, display_name, identity_provenance) values
  ('a2513000-0000-4000-8000-0000000000c1', 'a2513000-0000-4000-8000-000000000001', 'wine', 'bottle', 'Zqor Shelf', 'house_declared');
insert into public.procurement_orders
  (id, order_number, restaurant_id, inventory_id, provider_id, quantity, bottles_total, final_price, total_cost) values
  ('a2513000-0000-4000-8000-000000000101', 'ZQOR-1', 'a2513000-0000-4000-8000-000000000001',
   'a2513000-0000-4000-8000-0000000000c1', 'a2513000-0000-4000-8000-0000000000b1', 1, 1, 0, 0);

-- T1. A plain insert of an ORDER_REQUEST row is admitted.
insert into public.procurement_conversations
  (restaurant_id, provider_id, direction, channel, message_text, outbound_email_type)
values
  ('a2513000-0000-4000-8000-000000000001', 'a2513000-0000-4000-8000-0000000000b1',
   'outbound', 'email', 'T1', 'ORDER_REQUEST');

-- T2. Through the door, as the gateway stages it: staged once, then refused
-- by kind (staged:false, the same id).
do $$
declare
  first jsonb;
  second jsonb;
  row_ jsonb := jsonb_build_object(
    'order_id', 'a2513000-0000-4000-8000-000000000101',
    'restaurant_id', 'a2513000-0000-4000-8000-000000000001',
    'provider_id', 'a2513000-0000-4000-8000-0000000000b1',
    'direction', 'outbound', 'channel', 'email',
    'message_text', 'T2', 'content', 'T2', 'status', 'PENDING_APPROVAL',
    'outbound_email_type', 'ORDER_REQUEST', 'disclaimer_appended', true,
    'email_headers', jsonb_build_object('template_key', 'order_request'));
begin
  first := public.stage_order_letter(row_, 'ORDER_REQUEST');
  assert (first->>'staged')::boolean, 'T2: the first ORDER_REQUEST was not staged: ' || first::text;
  second := public.stage_order_letter(row_, 'ORDER_REQUEST');
  assert not (second->>'staged')::boolean and second->>'id' = first->>'id',
    'T2: a second ORDER_REQUEST for the order was staged: ' || second::text;
  assert (select outbound_email_type from public.procurement_conversations
           where id = (first->>'id')::uuid) = 'ORDER_REQUEST',
    'T2: the staged row is not an ORDER_REQUEST';
end
$$;

-- T3. Every kind admitted before, and NULL, is still admitted.
do $$
declare
  k text;
begin
  foreach k in array array[
    'PRICE_INQUIRY', 'DEMAND_OFFER', 'PROMO_INQUIRY', 'WINE_INQUIRY',
    'MANUAL_REPLY', 'ORDER_CONFIRMATION', 'ACCEPTANCE_CONFIRM_REQUEST',
    'CLARIFICATION', 'COUNTER_OFFER', 'ESCALATION', 'HOUSE_LETTER'
  ] loop
    insert into public.procurement_conversations
      (restaurant_id, provider_id, direction, channel, message_text, outbound_email_type)
    values
      ('a2513000-0000-4000-8000-000000000001', 'a2513000-0000-4000-8000-0000000000b1',
       'outbound', 'email', 'T3 ' || k, k);
  end loop;
  insert into public.procurement_conversations
    (restaurant_id, provider_id, direction, channel, message_text, outbound_email_type)
  values
    ('a2513000-0000-4000-8000-000000000001', 'a2513000-0000-4000-8000-0000000000b1',
     'inbound', 'email', 'T3 null', null);
end
$$;

-- T4. Junk is still refused, by this constraint.
do $$
declare
  c text;
begin
  begin
    insert into public.procurement_conversations
      (restaurant_id, provider_id, direction, channel, message_text, outbound_email_type)
    values
      ('a2513000-0000-4000-8000-000000000001', 'a2513000-0000-4000-8000-0000000000b1',
       'outbound', 'email', 'T4', 'ORDER_REQUESTX');
    raise exception 'T4: a junk outbound_email_type was admitted';
  exception when check_violation then
    get stacked diagnostics c = constraint_name;
    assert c = 'chk_outbound_email_type', 'T4: refused by ' || coalesce(c, '?') || ', not chk_outbound_email_type';
  end;
end
$$;


-- T5 and T6 re-run the migration on a CHECK it must refuse, and assert the
-- CHECK is left as it was. They need psql (\ir, ON_ERROR_STOP and
-- ON_ERROR_ROLLBACK): the migration is expected to raise, so for the \ir
-- only, errors do not stop the file and each statement rolls back on its
-- own; the migration's own assertion block then raises too (ORDER_REQUEST
-- not admitted), which is expected. The DO block after each \ir is the test.

-- T5. A CHECK with an extra condition is refused, never rebuilt: the rebuild
-- keeps only the literals, so it would drop "direction = 'outbound'" and
-- admit 'outbound' as a kind.
savepoint t5;
alter table public.procurement_conversations drop constraint chk_outbound_email_type;
alter table public.procurement_conversations add constraint chk_outbound_email_type check (
  outbound_email_type is null or (direction = 'outbound' and outbound_email_type::text = any (array[
      'PRICE_INQUIRY', 'DEMAND_OFFER', 'PROMO_INQUIRY', 'WINE_INQUIRY',
      'MANUAL_REPLY', 'ORDER_CONFIRMATION', 'ACCEPTANCE_CONFIRM_REQUEST',
      'CLARIFICATION', 'COUNTER_OFFER', 'ESCALATION', 'HOUSE_LETTER'
  ]))) not valid;
\set ON_ERROR_STOP 0
\set ON_ERROR_ROLLBACK on
\ir ../migrations/20261227070000_an_order_request_is_a_letter_kind.sql
\set ON_ERROR_ROLLBACK off
\set ON_ERROR_STOP 1
do $$
declare
  d text;
begin
  select pg_catalog.pg_get_constraintdef(c.oid) into d
    from pg_catalog.pg_constraint c
   where c.conrelid = 'public.procurement_conversations'::regclass
     and c.conname = 'chk_outbound_email_type';
  assert pg_catalog.strpos(d, 'direction') > 0, 'T5: the extra condition was dropped: ' || d;
  assert pg_catalog.strpos(d, '''ORDER_REQUEST''') = 0, 'T5: a CHECK with an extra condition was rebuilt: ' || d;
end
$$;
rollback to savepoint t5;

-- T6. A CHECK that is not a membership test at all is refused, never rebuilt.
savepoint t6;
alter table public.procurement_conversations drop constraint chk_outbound_email_type;
alter table public.procurement_conversations add constraint chk_outbound_email_type check (
  outbound_email_type is null or pg_catalog.length(outbound_email_type) < 40) not valid;
\set ON_ERROR_STOP 0
\set ON_ERROR_ROLLBACK on
\ir ../migrations/20261227070000_an_order_request_is_a_letter_kind.sql
\set ON_ERROR_ROLLBACK off
\set ON_ERROR_STOP 1
do $$
declare
  d text;
begin
  select pg_catalog.pg_get_constraintdef(c.oid) into d
    from pg_catalog.pg_constraint c
   where c.conrelid = 'public.procurement_conversations'::regclass
     and c.conname = 'chk_outbound_email_type';
  assert pg_catalog.strpos(d, 'length') > 0 and pg_catalog.strpos(d, '''ORDER_REQUEST''') = 0,
    'T6: a CHECK that is not a membership test was rebuilt: ' || d;
end
$$;
rollback to savepoint t6;

rollback;

-- F-307: a monthly or quarterly order can be anchored to the last day of the
-- month. Migration an_order_can_repeat_on_the_last_day widens
-- procurement_orders_recurrence_anchor_day_check from 1..28 to 1..31 (31 =
-- the last day) and changes nothing else about it.
--
-- Self-asserting: every block raises on a failure, so `psql -v ON_ERROR_STOP=1
-- -f` stops at the first one. It must FAIL on a build without that migration
-- (T2: an anchor of 31 is refused) and PASS with it. One transaction, rolled
-- back: it leaves nothing behind.

begin;

-- T1 the constraint is still there, under its name, validated.
do $$
declare
  def text;
begin
  select pg_get_constraintdef(c.oid) into def
    from pg_constraint c
   where c.conrelid = 'public.procurement_orders'::regclass
     and c.conname = 'procurement_orders_recurrence_anchor_day_check'
     and c.contype = 'c' and c.convalidated;
  assert def is not null, 'T1 FAIL procurement_orders_recurrence_anchor_day_check is missing or not validated';
end $$;

create temp table _fx (k text primary key, id uuid) on commit drop;

do $$
declare
  h uuid; p uuid; i uuid;
begin
  insert into public.restaurants (name, slug, timezone)
    values ('F307 house', 'f307-' || left(gen_random_uuid()::text, 8), 'America/New_York') returning id into h;
  insert into public.providers (name, primary_contact, restaurant_id)
    values ('F307 Vendor', '{}'::jsonb, h) returning id into p;
  insert into public.restaurant_inventory (restaurant_id, kind, uom, display_name, identity_provenance)
    values (h, 'wine', 'bottle', 'F307 Wine', 'house_declared') returning id into i;
  insert into _fx values ('h', h), ('p', p), ('i', i);
end $$;

-- One order per case, with the rule written on it. Returns true when the row
-- is accepted, false when the anchor CHECK refuses it; any other error raises.
create function pg_temp.f307_accepts(freq text, anchor integer, tag text) returns boolean
language plpgsql as $$
begin
  insert into public.procurement_orders (
    order_number, restaurant_id, inventory_id, provider_id, quantity, bottles_total,
    final_price, total_cost, status, recurrence_frequency, recurrence_anchor_day,
    recurrence_anchored_on, recurrence_next_due_on, recurrence_status)
  values (
    'T-F307-' || tag,
    (select id from _fx where k = 'h'), (select id from _fx where k = 'i'), (select id from _fx where k = 'p'),
    12, 12, 10, 120, 'APPROVED', freq, anchor, date '2026-01-31', date '2026-01-31', 'active');
  return true;
exception when check_violation then
  if sqlerrm !~ 'procurement_orders_recurrence_anchor_day_check' then raise; end if;
  return false;
end $$;

-- T2 the measured case: "monthly on the last day" (31) is stored, for monthly
-- and quarterly, and so are 29 and 30.
do $$
begin
  assert pg_temp.f307_accepts('monthly', 31, 'm31'), 'T2 FAIL a monthly order anchored to 31 (the last day) is refused';
  assert pg_temp.f307_accepts('quarterly', 31, 'q31'), 'T2 FAIL a quarterly order anchored to 31 (the last day) is refused';
  assert pg_temp.f307_accepts('monthly', 29, 'm29'), 'T2 FAIL a monthly order anchored to 29 is refused';
  assert pg_temp.f307_accepts('monthly', 30, 'm30'), 'T2 FAIL a monthly order anchored to 30 is refused';
end $$;

-- T3 nothing else widened: 0 and 32 for a month day, 7 or 31 for a weekday,
-- any anchor on a daily rule, and an anchor with no rule are still refused;
-- what was accepted before still is.
do $$
begin
  assert not pg_temp.f307_accepts('monthly', 32, 'm32'), 'T3 FAIL a month day of 32 is accepted';
  assert not pg_temp.f307_accepts('monthly', 0, 'm0'), 'T3 FAIL a month day of 0 is accepted';
  assert not pg_temp.f307_accepts('weekly', 7, 'w7'), 'T3 FAIL a weekday of 7 is accepted';
  assert not pg_temp.f307_accepts('biweekly', 31, 'b31'), 'T3 FAIL a weekday of 31 is accepted';
  assert not pg_temp.f307_accepts('daily', 1, 'd1'), 'T3 FAIL a daily rule takes an anchor';
  assert pg_temp.f307_accepts('monthly', 1, 'm1'), 'T3 FAIL a month day of 1 is refused';
  assert pg_temp.f307_accepts('monthly', 28, 'm28'), 'T3 FAIL a month day of 28 is refused';
  assert pg_temp.f307_accepts('weekly', 0, 'w0'), 'T3 FAIL a weekday of 0 is refused';
  assert pg_temp.f307_accepts('monthly', null, 'mn'), 'T3 FAIL an unanchored monthly rule is refused';
end $$;

-- T4 an anchor on an order with no rule is still refused (the COALESCE).
do $$
begin
  begin
    insert into public.procurement_orders (
      order_number, restaurant_id, inventory_id, provider_id, quantity, bottles_total,
      final_price, total_cost, status, recurrence_anchor_day)
    values ('T-F307-norule',
      (select id from _fx where k = 'h'), (select id from _fx where k = 'i'), (select id from _fx where k = 'p'),
      12, 12, 10, 120, 'APPROVED', 31);
    raise exception 'T4 FAIL an anchor of 31 with no rule was accepted';
  exception when check_violation then
    assert sqlerrm ~ 'procurement_orders_recurrence_anchor_day_check',
      format('T4 FAIL refused by the wrong constraint: %s', sqlerrm);
  end;
end $$;

rollback;

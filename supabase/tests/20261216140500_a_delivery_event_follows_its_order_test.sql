-- ADR 0284: a delivery event follows its order, and the table keeps it so.
--
-- Run against a database built from supabase/migrations (PGlite over the whole
-- corpus, or the Docker recipe). Every row it writes is inside one transaction
-- that is ROLLED BACK at the end, so it leaves nothing behind. It prints one
-- row per test: id, ok, detail. Every "ok" must be true.
--
-- The control: against the corpus WITHOUT migration
-- a_delivery_event_follows_its_order, T1-T9 and T11-T13 must come out false
-- (no trigger closes or moves anything). T10 (other rows untouched), T14 (an
-- open order's event stays) and T15 (the order write survives a failing
-- calendar write) hold on the control too: they pin what the fix must NOT do,
-- and a build without it cannot break them.
--
-- Fixtures are synthetic: three houses (Europe/Istanbul, another house, and a
-- zone Postgres cannot read), one vendor and one item each, and orders written
-- APPROVED (or already closed) with a pending delivery event on 9 October at
-- 10:00, the shape approveDraft writes.

begin;

create temp table _t (id text primary key, ok boolean, detail text) on commit drop;
create temp table _fx (k text primary key, v uuid) on commit drop;

do $$
declare
  hi uuid; hb uuid; hz uuid;
  pi uuid; pb uuid; pz uuid;
  ii uuid; ib uuid; iz uuid;
  o uuid;
  nm text;
begin
  insert into public.restaurants (name, slug, timezone)
    values ('T0284 Istanbul', 't0284-i-' || left(gen_random_uuid()::text, 8), 'Europe/Istanbul') returning id into hi;
  insert into public.restaurants (name, slug, timezone)
    values ('T0284 Other', 't0284-b-' || left(gen_random_uuid()::text, 8), 'Europe/Istanbul') returning id into hb;
  insert into public.restaurants (name, slug, timezone)
    values ('T0284 No zone', 't0284-z-' || left(gen_random_uuid()::text, 8), 'Mars/Olympus') returning id into hz;
  insert into public.providers (name, primary_contact, restaurant_id) values ('T0284 Vendor I', '{}'::jsonb, hi) returning id into pi;
  insert into public.providers (name, primary_contact, restaurant_id) values ('T0284 Vendor B', '{}'::jsonb, hb) returning id into pb;
  insert into public.providers (name, primary_contact, restaurant_id) values ('T0284 Vendor Z', '{}'::jsonb, hz) returning id into pz;
  insert into public.restaurant_inventory (restaurant_id, kind, uom, display_name, identity_provenance)
    values (hi, 'wine', 'bottle', 'T0284 Wine I', 'house_declared') returning id into ii;
  insert into public.restaurant_inventory (restaurant_id, kind, uom, display_name, identity_provenance)
    values (hb, 'wine', 'bottle', 'T0284 Wine B', 'house_declared') returning id into ib;
  insert into public.restaurant_inventory (restaurant_id, kind, uom, display_name, identity_provenance)
    values (hz, 'wine', 'bottle', 'T0284 Wine Z', 'house_declared') returning id into iz;
  insert into _fx values ('hi', hi), ('hb', hb), ('hz', hz);

  -- Open orders in the Istanbul house, each with a pending delivery event.
  foreach nm in array array['o1','o2','o3','o4','o5','o8','o9','o10','o11'] loop
    insert into public.procurement_orders (order_number, restaurant_id, inventory_id, provider_id, quantity, bottles_total, final_price, total_cost, status)
      values ('T-0284-' || nm, hi, ii, pi, 12, 12, 10, 120, 'APPROVED') returning id into o;
    insert into _fx values (nm, o);
    with x as (
      insert into public.calendar_events (restaurant_id, order_id, provider_id, title, description, event_type, event_date, event_time, all_day, source, status, reminder_enabled, reminder_days_before)
        values (hi, o, pi, 'Delivery: T-0284-' || nm, 'Expected delivery for order T-0284-' || nm, 'delivery', '2026-10-09', '10:00', false, 'system_generated', 'pending', true, 1)
        returning id)
    insert into _fx select 'e_' || nm, id from x;
  end loop;

  -- The house with an unreadable zone.
  insert into public.procurement_orders (order_number, restaurant_id, inventory_id, provider_id, quantity, bottles_total, final_price, total_cost, status)
    values ('T-0284-o7', hz, iz, pz, 12, 12, 10, 120, 'APPROVED') returning id into o;
  insert into _fx values ('o7', o);
  with x as (
    insert into public.calendar_events (restaurant_id, order_id, provider_id, title, event_type, event_date, event_time, all_day, source, status, reminder_enabled)
      values (hz, o, pz, 'Delivery: T-0284-o7', 'delivery', '2026-10-09', '10:00', false, 'system_generated', 'pending', true)
      returning id)
  insert into _fx select 'e_o7', id from x;

  -- Rows that must not move when o1 arrives or o2 is cancelled: another
  -- house's delivery event naming o1, a non-delivery event on o1, and a
  -- manually written delivery event on o2.
  with x as (
    insert into public.calendar_events (restaurant_id, order_id, title, event_type, event_date, event_time, all_day, source, status)
      values (hb, (select v from _fx where k = 'o1'), 'Elsewhere', 'delivery', '2026-10-09', '10:00', false, 'system_generated', 'pending')
      returning id)
  insert into _fx select 'e_other_house', id from x;
  with x as (
    insert into public.calendar_events (restaurant_id, order_id, title, event_type, event_date, event_time, all_day, source, status)
      values (hi, (select v from _fx where k = 'o1'), 'Order placed', 'order', '2026-10-01', '09:00', false, 'system_generated', 'pending')
      returning id)
  insert into _fx select 'e_not_delivery', id from x;
  with x as (
    insert into public.calendar_events (restaurant_id, order_id, title, event_type, event_date, all_day, source, status)
      values (hi, (select v from _fx where k = 'o2'), 'Typed by hand', 'delivery', '2026-10-11', true, 'manual', 'pending')
      returning id)
  insert into _fx select 'e_manual', id from x;
end $$;

-- T1 the door: APPROVED -> PARTIALLY_RECEIVED with delivered_at 21:30Z closes
-- the event on the house's own clock (Istanbul, +03): 3 October at 00:30, both
-- column pairs equal, all_day off, reminder off.
do $$ declare o uuid := (select v from _fx where k = 'o1'); e uuid := (select v from _fx where k = 'e_o1'); r record; begin
  update public.procurement_orders set status = 'PARTIALLY_RECEIVED', delivered_at = '2026-10-02T21:30:00Z' where id = o;
  select * into r from public.calendar_events where id = e;
  insert into _t values ('T1',
    r.status = 'completed' and r.start_date = date '2026-10-03' and r.event_date = date '2026-10-03'
      and r.start_time = time '00:30' and r.event_time = time '00:30' and r.all_day = false and r.reminder_enabled = false,
    format('status=%s start=%s %s event=%s %s all_day=%s reminder=%s', r.status, r.start_date, r.start_time, r.event_date, r.event_time, r.all_day, r.reminder_enabled));
end $$;

-- T2 the text says when it arrived, in which zone, and names the order.
do $$ declare d text := (select description from public.calendar_events where id = (select v from _fx where k = 'e_o1')); begin
  insert into _t values ('T2', d = 'Delivered: T-0284-o1, arrived 2026-10-03 00:30 (Europe/Istanbul).', coalesce(d, '<null>'));
end $$;

-- T3 verify: PARTIALLY_RECEIVED -> COMPLETED with the same delivered_at does
-- not write the event again (the tuple is the one T1 left).
do $$ declare o uuid := (select v from _fx where k = 'o1'); e uuid := (select v from _fx where k = 'e_o1'); before tid; after tid; st text; begin
  select ctid into before from public.calendar_events where id = e;
  update public.procurement_orders set status = 'COMPLETED' where id = o;
  select ctid, status into after, st from public.calendar_events where id = e;
  insert into _t values ('T3', st = 'completed' and before = after, format('status=%s ctid %s -> %s', st, before, after));
end $$;

-- T4 a corrected arrival time moves an already-completed event with it.
do $$ declare o uuid := (select v from _fx where k = 'o1'); e uuid := (select v from _fx where k = 'e_o1'); r record; begin
  update public.procurement_orders set delivered_at = '2026-10-03T07:15:00Z' where id = o;
  select * into r from public.calendar_events where id = e;
  insert into _t values ('T4',
    r.status = 'completed' and r.event_date = date '2026-10-03' and r.start_time = time '10:15' and r.event_time = time '10:15',
    format('status=%s event=%s %s start_time=%s', r.status, r.event_date, r.event_time, r.start_time));
end $$;

-- T5-T7 not coming: CANCELLED, REJECTED, FAILED each cancel the event and keep
-- its date; the text names the order and what happened to it.
do $$
declare
  c record; r record;
begin
  for c in select * from (values ('T5', 'o2', 'CANCELLED', 'Order T-0284-o2 was cancelled; this delivery is not coming.'),
                                 ('T6', 'o3', 'REJECTED',  'Order T-0284-o3 was rejected; this delivery is not coming.'),
                                 ('T7', 'o4', 'FAILED',    'Order T-0284-o4 failed; this delivery is not coming.')) v(t, k, s, d) loop
    update public.procurement_orders set status = c.s where id = (select v from _fx where k = c.k);
    select * into r from public.calendar_events where id = (select v from _fx where k = 'e_' || c.k);
    insert into _t values (c.t,
      r.status = 'cancelled' and r.event_date = date '2026-10-09' and r.event_time = time '10:00'
        and r.reminder_enabled = false and r.description = c.d,
      format('%s: status=%s date=%s %s reminder=%s text=%s', c.s, r.status, r.event_date, r.event_time, r.reminder_enabled, r.description));
  end loop;
end $$;

-- T8 an arrival is a fact a later failure does not erase: DELIVERED closes the
-- event, then DELIVERED -> FAILED leaves it completed (and unwritten).
do $$ declare o uuid := (select v from _fx where k = 'o5'); e uuid := (select v from _fx where k = 'e_o5'); st1 text; st2 text; t1 tid; t2 tid; begin
  update public.procurement_orders set status = 'DELIVERED', delivered_at = '2026-10-05T08:00:00Z' where id = o;
  select status, ctid into st1, t1 from public.calendar_events where id = e;
  update public.procurement_orders set status = 'FAILED' where id = o;
  select status, ctid into st2, t2 from public.calendar_events where id = e;
  insert into _t values ('T8', st1 = 'completed' and st2 = 'completed' and t1 = t2, format('after DELIVERED %s, after FAILED %s, ctid %s -> %s', st1, st2, t1, t2));
end $$;

-- T9 an event written for an order that has already arrived is completed at
-- birth, on the arrival; one written for an order already cancelled is
-- cancelled at birth, date kept.
do $$
declare
  hi uuid := (select v from _fx where k = 'hi');
  i uuid := (select id from public.restaurant_inventory where restaurant_id = hi limit 1);
  p uuid := (select id from public.providers where restaurant_id = hi limit 1);
  oc uuid; ox uuid; ec uuid; ex uuid; rc record; rx record;
begin
  insert into public.procurement_orders (order_number, restaurant_id, inventory_id, provider_id, quantity, bottles_total, final_price, total_cost, status, delivered_at)
    values ('T-0284-o6', hi, i, p, 12, 12, 10, 120, 'COMPLETED', '2026-10-01T06:00:00Z') returning id into oc;
  insert into public.procurement_orders (order_number, restaurant_id, inventory_id, provider_id, quantity, bottles_total, final_price, total_cost, status)
    values ('T-0284-o12', hi, i, p, 12, 12, 10, 120, 'CANCELLED') returning id into ox;
  insert into public.calendar_events (restaurant_id, order_id, title, event_type, event_date, event_time, all_day, source, status, reminder_enabled)
    values (hi, oc, 'Delivery: T-0284-o6', 'delivery', '2026-10-09', '10:00', false, 'system_generated', 'pending', true) returning id into ec;
  insert into public.calendar_events (restaurant_id, order_id, title, event_type, event_date, event_time, all_day, source, status, reminder_enabled)
    values (hi, ox, 'Delivery: T-0284-o12', 'delivery', '2026-10-09', '10:00', false, 'system_generated', 'pending', true) returning id into ex;
  select * into rc from public.calendar_events where id = ec;
  select * into rx from public.calendar_events where id = ex;
  insert into _t values ('T9',
    rc.status = 'completed' and rc.event_date = date '2026-10-01' and rc.start_time = time '09:00' and rc.event_time = time '09:00'
      and rx.status = 'cancelled' and rx.event_date = date '2026-10-09',
    format('arrived: %s %s %s; cancelled: %s %s', rc.status, rc.event_date, rc.event_time, rx.status, rx.event_date));
end $$;

-- T10 untouched: another house's event naming o1 stays pending on its date; a
-- non-delivery event on o1 stays as written; the hand-written delivery event on
-- o2 is closed but keeps its source 'manual'.
do $$ declare a record; b record; m record; begin
  select * into a from public.calendar_events where id = (select v from _fx where k = 'e_other_house');
  select * into b from public.calendar_events where id = (select v from _fx where k = 'e_not_delivery');
  select * into m from public.calendar_events where id = (select v from _fx where k = 'e_manual');
  insert into _t values ('T10',
    a.status = 'pending' and a.event_date = date '2026-10-09' and a.event_time = time '10:00'
      and b.status = 'pending' and b.event_date = date '2026-10-01' and b.event_time = time '09:00'
      and m.source = 'manual',
    format('other house %s %s; order event %s %s; manual source=%s status=%s', a.status, a.event_date, b.status, b.event_date, m.source, m.status));
end $$;

-- T11 a house zone Postgres cannot read falls back to UTC, says so, and does
-- not fail the order.
do $$ declare o uuid := (select v from _fx where k = 'o7'); e uuid := (select v from _fx where k = 'e_o7'); st text; msg text; r record; begin
  begin
    update public.procurement_orders set status = 'DELIVERED', delivered_at = '2026-10-02T21:30:00Z' where id = o;
  exception when others then get stacked diagnostics st = returned_sqlstate, msg = message_text;
  end;
  select * into r from public.calendar_events where id = e;
  insert into _t values ('T11',
    st is null and (select status from public.procurement_orders where id = o) = 'DELIVERED'
      and r.status = 'completed' and r.event_date = date '2026-10-02' and r.event_time = time '21:30'
      and r.description like '%(UTC; the house''s time zone could not be read).',
    format('error=%s status=%s date=%s %s text=%s', coalesce(st || ' ' || msg, 'none'), r.status, r.event_date, r.event_time, r.description));
end $$;

-- T12 arrived with no recorded time: closed, reminder off, the date not
-- invented, and the text says so.
do $$ declare o uuid := (select v from _fx where k = 'o9'); r record; begin
  update public.procurement_orders set status = 'DELIVERED' where id = o;
  select * into r from public.calendar_events where id = (select v from _fx where k = 'e_o9');
  insert into _t values ('T12',
    r.status = 'completed' and r.event_date = date '2026-10-09' and r.event_time = time '10:00' and r.reminder_enabled = false
      and r.description like 'Delivered: T-0284-o9. The order does not record when it arrived%',
    format('status=%s date=%s %s reminder=%s text=%s', r.status, r.event_date, r.event_time, r.reminder_enabled, r.description));
end $$;

-- T13 ADR 0073's asymmetry: an event a person cancelled while the order was
-- open is completed when the goods arrive.
do $$ declare o uuid := (select v from _fx where k = 'o10'); e uuid := (select v from _fx where k = 'e_o10'); st text; begin
  update public.calendar_events set status = 'cancelled' where id = e;
  update public.procurement_orders set status = 'DELIVERED', delivered_at = '2026-10-06T09:00:00Z' where id = o;
  select status into st from public.calendar_events where id = e;
  insert into _t values ('T13', st = 'completed', 'status=' || coalesce(st, '<null>'));
end $$;

-- T14 an order that moves but stays open (APPROVED -> CONFIRMED) leaves its
-- event where it was placed.
do $$ declare o uuid := (select v from _fx where k = 'o11'); r record; begin
  update public.procurement_orders set status = 'CONFIRMED' where id = o;
  select * into r from public.calendar_events where id = (select v from _fx where k = 'e_o11');
  insert into _t values ('T14', r.status = 'pending' and r.event_date = date '2026-10-09' and r.event_time = time '10:00' and r.reminder_enabled,
    format('status=%s date=%s %s reminder=%s', r.status, r.event_date, r.event_time, r.reminder_enabled));
end $$;

-- T15 the order write never fails over a calendar row: with every calendar
-- update forced to raise, cancelling o8 still succeeds and its event is as it
-- was (the failed write rolled back to the trigger's own savepoint).
create function pg_temp.t0284_refuse() returns trigger language plpgsql as $f$
begin
  raise exception 't0284: calendar writes are refused for this test';
end $f$;
create trigger t0284_refuse before update on public.calendar_events
  for each row execute function pg_temp.t0284_refuse();
do $$ declare o uuid := (select v from _fx where k = 'o8'); st text; msg text; os text; es text; begin
  begin
    update public.procurement_orders set status = 'CANCELLED' where id = o;
  exception when others then get stacked diagnostics st = returned_sqlstate, msg = message_text;
  end;
  select status into os from public.procurement_orders where id = o;
  select status into es from public.calendar_events where id = (select v from _fx where k = 'e_o8');
  insert into _t values ('T15', st is null and os = 'CANCELLED' and es = 'pending',
    format('error=%s order=%s event=%s', coalesce(st || ' ' || msg, 'none'), os, es));
end $$;
drop trigger t0284_refuse on public.calendar_events;

select id, ok, detail from _t order by length(id), id;

rollback;

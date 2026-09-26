-- ADR 0227: the door record is append-only in the database.
--
-- Run against a database built from supabase/migrations (the W3-receiving
-- lane ran it in PGlite over the whole corpus, 2026-09-25). Every row it
-- writes is inside one transaction that is ROLLED BACK at the end, so it
-- leaves nothing behind. It prints one row per test: id, ok, detail.
-- Every "ok" must be true. Against the corpus WITHOUT
-- 20260927120000_the_door_record_is_append_only.sql, T1-T3, T5, T6 and T9 must
-- come out false (the control that shows the tests can fail); T10 and T11 then
-- fail too, because the control's cascades already removed their rows.
-- Measured 2026-09-25: with the migration 11/11; control 3/11; the migration
-- with its foreign keys left cascading fails T5 T6 T9; with no row trigger it
-- fails T1-T3 (and the rows those removed); with no TRUNCATE trigger, T3.
--
-- Both refusals answer SQLSTATE 23001 (restrict_violation): the trigger's, and
-- an ON DELETE RESTRICT foreign key's ("violates RESTRICT setting"). They are
-- told apart by the message (the trigger names ADR 0227) and by the
-- constraint name the FK reports.

begin;

create temp table _t (id text primary key, ok boolean, detail text) on commit drop;
create temp table _fx (k text primary key, v uuid) on commit drop;

-- Fixtures: house A has an order with two door receipts and a document one of
-- them cites; house B has an order and no receipts; house C is empty (the
-- shape a rollback deletes).
do $$
declare
  a uuid; b uuid; c uuid; pa uuid; pb uuid; ia uuid; ib uuid;
  oa uuid; oa2 uuid; ob uuid; d uuid; d2 uuid; e1 uuid; e2 uuid;
begin
  insert into public.restaurants (name, slug) values ('T House A', 't-house-a-0227') returning id into a;
  insert into public.restaurants (name, slug) values ('T House B', 't-house-b-0227') returning id into b;
  insert into public.restaurants (name, slug) values ('T House C', 't-house-c-0227') returning id into c;
  insert into public.providers (name, primary_contact, restaurant_id) values ('T Vendor A', '{}'::jsonb, a) returning id into pa;
  insert into public.providers (name, primary_contact, restaurant_id) values ('T Vendor B', '{}'::jsonb, b) returning id into pb;
  insert into public.restaurant_inventory (restaurant_id, kind, uom, display_name, identity_provenance)
    values (a, 'wine', 'bottle', 'T Wine A', 'house_declared') returning id into ia;
  insert into public.restaurant_inventory (restaurant_id, kind, uom, display_name, identity_provenance)
    values (b, 'wine', 'bottle', 'T Wine B', 'house_declared') returning id into ib;
  insert into public.procurement_orders (order_number, restaurant_id, inventory_id, provider_id, quantity, bottles_total, final_price, total_cost)
    values ('T-0227-A', a, ia, pa, 12, 12, 10, 120) returning id into oa;
  insert into public.procurement_orders (order_number, restaurant_id, inventory_id, provider_id, quantity, bottles_total, final_price, total_cost)
    values ('T-0227-A2', a, ia, pa, 6, 6, 10, 60) returning id into oa2;
  insert into public.procurement_orders (order_number, restaurant_id, inventory_id, provider_id, quantity, bottles_total, final_price, total_cost)
    values ('T-0227-B', b, ib, pb, 6, 6, 10, 60) returning id into ob;
  insert into public.procurement_documents (restaurant_id, doc_type, source_channel) values (a, 'invoice', 'upload') returning id into d;
  insert into public.procurement_documents (restaurant_id, doc_type, source_channel) values (a, 'invoice', 'upload') returning id into d2;
  insert into public.procurement_receipt_events (restaurant_id, order_id, document_id, stage, counted_qty, counted_uom, counted_qty_bottles, idempotency_key)
    values (a, oa, d, 'case_count', 1, 'case', 12, 't-0227-door') returning id into e1;
  insert into public.procurement_receipt_events (restaurant_id, order_id, stage, counted_qty, counted_uom, counted_qty_bottles)
    values (a, oa, 'reconciled', 11, 'bottle', 11) returning id into e2;
  insert into _fx values ('a', a), ('b', b), ('c', c), ('oa', oa), ('oa2', oa2), ('ob', ob), ('d', d), ('d2', d2), ('e1', e1), ('e2', e2);
end $$;

-- T1 an UPDATE of a receipt is refused, and the row is as it was
do $$ declare e uuid := (select v from _fx where k = 'e1'); st text; msg text; cn text; begin
  begin
    update public.procurement_receipt_events set counted_qty_bottles = 999 where id = e;
    insert into _t values ('T1', false, 'the update was accepted');
  exception when others then get stacked diagnostics st = returned_sqlstate, msg = message_text, cn = constraint_name;
    insert into _t values ('T1', st = '23001' and msg like '%append-only (ADR 0227)%' and (select counted_qty_bottles from public.procurement_receipt_events where id = e) = 12, 'refused with ' || st || coalesce(' by ' || nullif(cn, ''), '') || ': ' || left(msg, 60));
  end;
end $$;

-- T2 a DELETE of a receipt is refused, and the row is still there
do $$ declare e uuid := (select v from _fx where k = 'e2'); st text; msg text; cn text; begin
  begin
    delete from public.procurement_receipt_events where id = e;
    insert into _t values ('T2', false, 'the delete was accepted');
  exception when others then get stacked diagnostics st = returned_sqlstate, msg = message_text, cn = constraint_name;
    insert into _t values ('T2', st = '23001' and msg like '%append-only (ADR 0227)%' and exists (select 1 from public.procurement_receipt_events where id = e), 'refused with ' || st || coalesce(' by ' || nullif(cn, ''), '') || ': ' || left(msg, 60));
  end;
end $$;

-- T3 TRUNCATE is refused
do $$ declare st text; msg text; cn text; begin
  begin
    truncate public.procurement_receipt_events;
    insert into _t values ('T3', false, 'the truncate was accepted');
  exception when others then get stacked diagnostics st = returned_sqlstate, msg = message_text, cn = constraint_name;
    insert into _t values ('T3', st = '23001' and msg like '%append-only (ADR 0227)%' and (select count(*) from public.procurement_receipt_events where id in (select v from _fx where k in ('e1','e2'))) = 2, 'refused with ' || st || coalesce(' by ' || nullif(cn, ''), '') || ': ' || left(msg, 60));
  end;
end $$;

-- T4 appending still works: a new receipt row is accepted
do $$ declare a uuid := (select v from _fx where k = 'a'); o uuid := (select v from _fx where k = 'oa'); n uuid; begin
  insert into public.procurement_receipt_events (restaurant_id, order_id, stage, counted_qty, counted_uom, counted_qty_bottles)
    values (a, o, 'reconciled', 12, 'bottle', 12) returning id into n;
  insert into _t values ('T4', n is not null, 'inserted');
end $$;

-- T5 deleting an order that has receipts is refused whole: order and receipts stay
do $$ declare o uuid := (select v from _fx where k = 'oa'); st text; msg text; cn text; begin
  begin
    delete from public.procurement_orders where id = o;
    insert into _t values ('T5', false, 'the order was deleted');
  exception when others then get stacked diagnostics st = returned_sqlstate, msg = message_text, cn = constraint_name;
    insert into _t values ('T5', st = '23001' and cn = 'procurement_receipt_events_order_id_fkey'
      and exists (select 1 from public.procurement_orders where id = o)
      and (select count(*) from public.procurement_receipt_events where order_id = o) = 3, 'refused with ' || st || coalesce(' by ' || nullif(cn, ''), '') || ': ' || left(msg, 60));
  end;
end $$;

-- T6 deleting a house that has receipts is refused whole: house, orders, receipts stay
do $$ declare a uuid := (select v from _fx where k = 'a'); st text; msg text; cn text; begin
  begin
    delete from public.restaurants where id = a;
    insert into _t values ('T6', false, 'the house was deleted');
  exception when others then get stacked diagnostics st = returned_sqlstate, msg = message_text, cn = constraint_name;
    insert into _t values ('T6', st = '23001' and cn in ('procurement_receipt_events_order_id_fkey', 'procurement_receipt_events_restaurant_id_fkey')
      and exists (select 1 from public.restaurants where id = a)
      and (select count(*) from public.procurement_orders where restaurant_id = a) = 2
      and (select count(*) from public.procurement_receipt_events where restaurant_id = a) = 3, 'refused with ' || st || coalesce(' by ' || nullif(cn, ''), '') || ': ' || left(msg, 60));
  end;
end $$;

-- T7 an order with no receipts still deletes (even in a house that has some)
do $$ declare o uuid := (select v from _fx where k = 'oa2'); begin
  delete from public.procurement_orders where id = o;
  insert into _t values ('T7', not exists (select 1 from public.procurement_orders where id = o), 'deleted');
end $$;

-- T8 a house with no receipts still deletes, and its order still cascades with it;
--    an empty house (what a createHouse / registerRestaurant / createLocation
--    rollback deletes) deletes too
do $$ declare b uuid := (select v from _fx where k = 'b'); c uuid := (select v from _fx where k = 'c'); ob uuid := (select v from _fx where k = 'ob'); begin
  delete from public.restaurants where id = b;
  delete from public.restaurants where id = c;
  insert into _t values ('T8', not exists (select 1 from public.restaurants where id in (b, c))
    and not exists (select 1 from public.procurement_orders where id = ob), 'deleted, order cascaded');
end $$;

-- T9 a document a receipt cites cannot be deleted from under it (SET NULL would
--    have rewritten the receipt); a document no receipt cites still deletes
do $$ declare d uuid := (select v from _fx where k = 'd'); d2 uuid := (select v from _fx where k = 'd2'); st text; msg text; cn text; ok9 boolean; begin
  begin
    delete from public.procurement_documents where id = d;
    ok9 := false; st := 'the cited document was deleted';
  exception when others then get stacked diagnostics st = returned_sqlstate, msg = message_text, cn = constraint_name;
    ok9 := st = '23001' and cn = 'procurement_receipt_events_document_id_fkey' and (select document_id from public.procurement_receipt_events where id = (select v from _fx where k = 'e1')) = d;
    st := st || ' by ' || cn;
  end;
  delete from public.procurement_documents where id = d2;
  insert into _t values ('T9', ok9 and not exists (select 1 from public.procurement_documents where id = d2), 'cited: ' || st || '; uncited: deleted');
end $$;

-- T10 removing a house with a door history is a soft delete, and it works
do $$ declare a uuid := (select v from _fx where k = 'a'); begin
  update public.restaurants set deleted_at = now(), is_active = false where id = a;
  insert into _t values ('T10', (select deleted_at is not null from public.restaurants where id = a)
    and (select count(*) from public.procurement_receipt_events where restaurant_id = a) = 3, 'soft-deleted, receipts kept');
end $$;

-- T11 a retried door tap still collides on its idempotency key (read back, not rewritten)
do $$ declare a uuid := (select v from _fx where k = 'a'); o uuid := (select v from _fx where k = 'oa'); st text; msg text; cn text; begin
  begin
    insert into public.procurement_receipt_events (restaurant_id, order_id, stage, counted_qty, counted_uom, counted_qty_bottles, idempotency_key)
      values (a, o, 'case_count', 1, 'case', 12, 't-0227-door');
    insert into _t values ('T11', false, 'a duplicate key was accepted');
  exception when others then get stacked diagnostics st = returned_sqlstate, msg = message_text, cn = constraint_name;
    insert into _t values ('T11', st = '23505', 'refused with ' || st || coalesce(' by ' || nullif(cn, ''), '') || ': ' || left(msg, 60));
  end;
end $$;

select id, ok, detail from _t order by length(id), id;

rollback;

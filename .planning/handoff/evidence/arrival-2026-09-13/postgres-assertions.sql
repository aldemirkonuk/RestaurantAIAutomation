DO $$
DECLARE
 house uuid:='22222222-2222-4222-8222-222222222222'; person uuid:='11111111-1111-4111-8111-111111111111';
 batch_id uuid:=gen_random_uuid(); row_id uuid:=gen_random_uuid(); prior jsonb; expected jsonb; entries jsonb; failed boolean; inventory uuid; menu uuid;
BEGIN
 PERFORM public.arrival_record_folio(house,person,'evidence','skipped','{"offered":["evidence"],"answered":[]}'::jsonb);
 IF (SELECT state FROM arrival_folios WHERE restaurant_id=house AND folio='evidence')<>'skipped' THEN RAISE EXCEPTION 'skip not persisted'; END IF;
 IF NOT EXISTS(SELECT 1 FROM system_audit_log WHERE restaurant_id=house AND action='configuration_step_skipped') THEN RAISE EXCEPTION 'skip unaudited'; END IF;
 IF (SELECT currency FROM restaurants WHERE id=house) IS NOT NULL THEN RAISE EXCEPTION 'skip changed currency'; END IF;
 -- A forced audit failure must also roll back the folio's state.
 ALTER TABLE system_audit_log ADD CONSTRAINT fixture_no_posted CHECK(action<>'configuration_folio_recorded');
 failed:=false;
 BEGIN PERFORM public.arrival_record_folio(house,person,'evidence','posted','{}'); EXCEPTION WHEN check_violation THEN failed:=true; END;
 IF NOT failed OR (SELECT state FROM arrival_folios WHERE restaurant_id=house AND folio='evidence')<>'skipped' THEN RAISE EXCEPTION 'folio survived failed audit'; END IF;
 ALTER TABLE system_audit_log DROP CONSTRAINT fixture_no_posted;
 SELECT jsonb_build_object('currency',currency,'updated_at',updated_at) INTO prior FROM restaurants WHERE id=house;
 UPDATE restaurants SET currency='TRY' WHERE id=house;
 SELECT jsonb_build_object('currency',currency,'updated_at',updated_at) INTO expected FROM restaurants WHERE id=house;
 entries:=jsonb_build_array(jsonb_build_object('id',row_id,'target','currency','field','code','value','TRY','before',prior,'after',expected,'status','written'));
 INSERT INTO configuration_batches(id,restaurant_id,user_id,status,rows,sealed_at,undo_until) VALUES(batch_id,house,person,'undoing',entries,now(),now()+interval '7 days');
 PERFORM public.arrival_restore_entry(house,person,batch_id,row_id,'currency');
 IF (SELECT currency FROM restaurants WHERE id=house) IS NOT NULL THEN RAISE EXCEPTION 'currency undo did not restore absence'; END IF;
 UPDATE restaurants SET currency='EUR' WHERE id=house;
 failed:=false; BEGIN PERFORM public.arrival_restore_entry(house,person,batch_id,row_id,'currency'); EXCEPTION WHEN raise_exception THEN failed:=true; END;
 IF NOT failed OR (SELECT currency FROM restaurants WHERE id=house)<>'EUR' THEN RAISE EXCEPTION 'undo overwrote a later currency'; END IF;
 -- An absent personal preferences row is restored as absence, not defaults falsely labelled stated.
 INSERT INTO notification_preferences(user_id,email_enabled) VALUES(person,false);
 SELECT to_jsonb(p) INTO expected FROM notification_preferences p WHERE user_id=person;
 entries:=jsonb_build_array(jsonb_build_object('id',row_id,'target','notifications','field','email','value',false,'before',null,'after',expected,'status','written'));
 UPDATE configuration_batches SET rows=entries WHERE id=batch_id;
 PERFORM public.arrival_restore_entry(house,person,batch_id,row_id,'notifications');
 IF EXISTS(SELECT 1 FROM notification_preferences WHERE user_id=person) THEN RAISE EXCEPTION 'undo kept an unstated preferences row'; END IF;
 -- Two fields of one preferences row can be restored in reverse order.
 INSERT INTO notification_preferences(user_id,email_enabled) VALUES(person,false);
 SELECT to_jsonb(p) INTO prior FROM notification_preferences p WHERE user_id=person;
 UPDATE notification_preferences SET push_enabled=false WHERE user_id=person;
 SELECT to_jsonb(p) INTO expected FROM notification_preferences p WHERE user_id=person;
 entries:=jsonb_build_array(jsonb_build_object('id',row_id,'target','notifications','field','push','value',false,'before',prior,'after',expected,'status','written'));
 UPDATE configuration_batches SET rows=entries WHERE id=batch_id;
 PERFORM public.arrival_restore_entry(house,person,batch_id,row_id,'notifications');
 SELECT to_jsonb(p) INTO expected FROM notification_preferences p WHERE user_id=person;
 IF expected IS DISTINCT FROM prior THEN RAISE EXCEPTION 'sibling preference did not restore exact previous row'; END IF;
 -- An unused house item and its zero-stock seed can be reversed.
 inventory:=gen_random_uuid();menu:=gen_random_uuid();
 INSERT INTO restaurant_inventory(id,restaurant_id) VALUES(inventory,house);
 INSERT INTO menu_items(id,restaurant_id,name,inventory_item_id) VALUES(menu,house,'Fixture wine',inventory);
 SELECT jsonb_build_object('menu',(SELECT to_jsonb(m) FROM menu_items m WHERE id=menu),'inventory',(SELECT to_jsonb(i) FROM restaurant_inventory i WHERE id=inventory)) INTO expected;
 entries:=jsonb_build_array(jsonb_build_object('id',row_id,'target','menu_item','field','entry','value','Fixture wine','before',null,'after',expected,'status','written'));
 UPDATE configuration_batches SET rows=entries WHERE id=batch_id;
 PERFORM public.arrival_restore_entry(house,person,batch_id,row_id,'menu_item');
 IF EXISTS(SELECT 1 FROM menu_items WHERE id=menu) OR EXISTS(SELECT 1 FROM restaurant_inventory WHERE id=inventory) THEN RAISE EXCEPTION 'unused house additions remained'; END IF;
 -- A later FK reference must block even when physical quantity is still zero.
 INSERT INTO restaurant_inventory(id,restaurant_id) VALUES(inventory,house);
 INSERT INTO menu_items(id,restaurant_id,name,inventory_item_id) VALUES(menu,house,'Fixture wine',inventory);
 SELECT jsonb_build_object('menu',(SELECT to_jsonb(m) FROM menu_items m WHERE id=menu),'inventory',(SELECT to_jsonb(i) FROM restaurant_inventory i WHERE id=inventory)) INTO expected;
 UPDATE configuration_batches SET rows=jsonb_build_array(jsonb_build_object('id',row_id,'target','menu_item','field','entry','value','Fixture wine','before',null,'after',expected,'status','written')) WHERE id=batch_id;
 INSERT INTO later_inventory_use VALUES(gen_random_uuid(),inventory,0);
 failed:=false;BEGIN PERFORM public.arrival_restore_entry(house,person,batch_id,row_id,'menu_item');EXCEPTION WHEN raise_exception THEN failed:=true;END;
 IF NOT failed OR NOT EXISTS(SELECT 1 FROM menu_items WHERE id=menu) THEN RAISE EXCEPTION 'later inventory use was removed'; END IF;
 -- Menu FK use must block even when the FK would otherwise cascade.
 DELETE FROM later_inventory_use;
 INSERT INTO later_menu_use VALUES(gen_random_uuid(),menu);
 failed:=false;BEGIN PERFORM public.arrival_restore_entry(house,person,batch_id,row_id,'menu_item');EXCEPTION WHEN raise_exception THEN failed:=true;END;
 IF NOT failed OR NOT EXISTS(SELECT 1 FROM later_menu_use WHERE menu_item_id=menu) THEN RAISE EXCEPTION 'later menu use was removed';END IF;
 DELETE FROM later_menu_use;
 INSERT INTO composite_inventory_use VALUES(gen_random_uuid(),inventory,house);
 failed:=false;BEGIN PERFORM public.arrival_restore_entry(house,person,batch_id,row_id,'menu_item');EXCEPTION WHEN raise_exception THEN failed:=true;END;
 IF NOT failed OR NOT EXISTS(SELECT 1 FROM composite_inventory_use WHERE inventory_id=inventory) THEN RAISE EXCEPTION 'composite inventory use was removed';END IF;
 IF NOT EXISTS(SELECT 1 FROM system_audit_log a JOIN configuration_batches b ON a.entity_id=b.id WHERE a.action='configuration_batch_undone' AND a.correlation_id=b.undo_correlation_id AND a.correlation_id<>b.id) THEN RAISE EXCEPTION 'undo audit did not have a separate correlation';END IF;
 UPDATE configuration_batches SET undo_until=now()-interval '1 second' WHERE id=batch_id;
 failed:=false;BEGIN PERFORM public.arrival_restore_entry(house,person,batch_id,row_id,'menu_item');EXCEPTION WHEN raise_exception THEN failed:=true;END;
 IF NOT failed THEN RAISE EXCEPTION 'expired undo was allowed';END IF;
 failed:=false;BEGIN PERFORM public.arrival_restore_entry('99999999-9999-4999-8999-999999999999',person,batch_id,row_id,'menu_item');EXCEPTION WHEN raise_exception THEN failed:=true;END;
 IF NOT failed THEN RAISE EXCEPTION 'foreign-house undo was allowed';END IF;
END $$;
SET ROLE service_role;
SELECT public.arrival_record_folio('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111','assistant','skipped','{}');
RESET ROLE;
SELECT 'ARRIVAL_POSTGRES_ASSERTIONS_PASS';

-- Slice 4 SQL assertions. Every one must FAIL (or error) on the 107-migration
-- control and PASS on the 108-migration build.
\set ON_ERROR_STOP 0

-- T1 the table exists
select 'T1' id, (to_regclass('public.document_line_mappings') is not null) ok;

-- T2 it is append-only by trigger (the same one document_corrections uses)
select 'T2' id, exists(
  select 1 from pg_trigger
  where tgrelid = 'public.document_line_mappings'::regclass
    and tgname = 'document_line_mappings_append_only') ok;

-- T3 linked_by points at public.users, NOT auth.users
select 'T3' id, exists(
  select 1 from information_schema.constraint_column_usage ccu
  join information_schema.table_constraints tc on tc.constraint_name = ccu.constraint_name
  where tc.table_name = 'document_line_mappings' and tc.constraint_type = 'FOREIGN KEY'
    and ccu.table_schema = 'public' and ccu.table_name = 'users'
    and ccu.column_name = 'user_id') ok;

-- T3b no FK from this table reaches auth.users
select 'T3b' id, not exists(
  select 1 from pg_constraint
  where conrelid = 'public.document_line_mappings'::regclass and contype = 'f'
    and confrelid = 'auth.users'::regclass) ok;

-- T4 a `linked` act with no shelf is refused
do $$ begin
  begin
    insert into public.document_line_mappings
      (restaurant_id, provider_id, key_kind, key_value, action, inventory_id)
    values (gen_random_uuid(), gen_random_uuid(), 'vendor_sku', 'X|2021', 'linked', null);
    raise notice 'T4 FAIL a linked act with no shelf was accepted';
  exception when check_violation then raise notice 'T4 ok refused by the CHECK';
            when others then raise notice 'T4 refused, but by % (not the check)', sqlstate;
  end;
end $$;

-- T5 an `unlinked` act naming a shelf is refused (an un-link asserts no item)
do $$ begin
  begin
    insert into public.document_line_mappings
      (restaurant_id, provider_id, key_kind, key_value, action, inventory_id)
    values (gen_random_uuid(), gen_random_uuid(), 'vendor_sku', 'X|2021', 'unlinked', gen_random_uuid());
    raise notice 'T5 FAIL an unlinked act naming a shelf was accepted';
  exception when check_violation then raise notice 'T5 ok refused by the CHECK';
            when others then raise notice 'T5 refused, but by % (not the check)', sqlstate;
  end;
end $$;

-- T6 a key_kind outside the two named kinds is refused
do $$ begin
  begin
    insert into public.document_line_mappings
      (restaurant_id, provider_id, key_kind, key_value, action, inventory_id)
    values (gen_random_uuid(), gen_random_uuid(), 'guessed', 'X', 'unlinked', null);
    raise notice 'T6 FAIL an unnamed key_kind was accepted';
  exception when check_violation then raise notice 'T6 ok refused by the CHECK';
            when others then raise notice 'T6 refused, but by % (not the check)', sqlstate;
  end;
end $$;

-- T7/T8/T9 a real row can be written, and cannot then be UPDATEd or DELETEd.
do $$
declare r uuid; p uuid; i uuid; m uuid; w uuid;
begin
  select id into r from public.restaurants limit 1;
  if r is null then
    insert into public.restaurants (id, name) values (gen_random_uuid(), 'T7 venue') returning id into r;
  end if;
  select id into i from public.restaurant_inventory where restaurant_id = r limit 1;
  if i is null then
    select id into w from public.master_wine_library limit 1;
    if w is null then
      insert into public.master_wine_library (wine_id, name, primary_type)
        values ('T7WINE', 'T7 wine', 'red') returning id into w;
    end if;
    insert into public.restaurant_inventory (id, restaurant_id, master_wine_id)
      values (gen_random_uuid(), r, w) returning id into i;
  end if;
  p := gen_random_uuid();

  insert into public.document_line_mappings
    (restaurant_id, provider_id, key_kind, key_value, action, inventory_id, source)
  values (r, p, 'vendor_sku', 'SYN-1|2021', 'linked', i, 'chosen') returning id into m;
  raise notice 'T7 ok a pairing was written';

  begin
    update public.document_line_mappings set source = 'remembered' where id = m;
    raise notice 'T8 FAIL the memory was UPDATEd';
  exception when others then raise notice 'T8 ok update refused: %', sqlerrm;
  end;

  begin
    delete from public.document_line_mappings where id = m;
    raise notice 'T9 FAIL the memory was DELETEd';
  exception when others then raise notice 'T9 ok delete refused: %', sqlerrm;
  end;
end $$;

-- T10 the read index the proposal uses exists, tenant-first
select 'T10' id, exists(
  select 1 from pg_indexes
  where tablename = 'document_line_mappings'
    and indexdef like '%restaurant_id, provider_id, key_kind, key_value%') ok;

-- T11 RLS is on (the new-tables-are-locked-down rule)
select 'T11' id, relrowsecurity ok
  from pg_class where oid = 'public.document_line_mappings'::regclass;

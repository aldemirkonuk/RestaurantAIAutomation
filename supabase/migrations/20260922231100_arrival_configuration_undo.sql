-- Version note (PR #414 BLOCK): earlier drafts shipped this file as
-- 20260913190600, behind main's applied ceiling. Renamed past 20260921114400 so
-- the runner actually applies it.
--
-- Seven-day, conflict-aware undo. The owning register services call this
-- backend-only function; it can restore ONLY a sealed row from this actor's
-- batch. Its before/after values come from that durable receipt, never HTTP.
create or replace function public.arrival_restore_entry(p_restaurant_id uuid, p_actor_id uuid, p_batch_id uuid, p_row_id uuid, p_target text)
returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  batch public.configuration_batches%rowtype;
  entry jsonb;
  current_row jsonb;
  prior jsonb;
  expected jsonb;
  provider uuid;
  menu_id uuid;
  inventory_id uuid;
  inventory_row jsonb;
  dependency record;
  referenced boolean;
  join_columns text;
begin
  select * into batch from public.configuration_batches where id=p_batch_id and restaurant_id=p_restaurant_id and user_id=p_actor_id for update;
  if not found or batch.status <> 'undoing' or batch.undo_until is null or now() > batch.undo_until then raise exception 'This batch is not available for undo'; end if;
  select value into entry from jsonb_array_elements(batch.rows) where value->>'id'=p_row_id::text;
  if entry is null or entry->>'status'<>'written' or entry->>'target'<>p_target or entry->'after' is null then raise exception 'This entry has no confirmed write to restore'; end if;
  prior:=entry->'before'; expected:=entry->'after'; provider:=(entry->>'subjectId')::uuid;
  if p_target='currency' then
    select jsonb_build_object('currency',currency,'updated_at',updated_at) into current_row from public.restaurants where id=p_restaurant_id for update;
    if current_row is distinct from expected then raise exception 'Currency changed after this batch; the newer entry was left intact'; end if;
    update public.restaurants set currency=prior->>'currency' where id=p_restaurant_id;
  elsif p_target='threshold' then
    select jsonb_build_object('default_threshold_min',default_threshold_min,'threshold_configured',threshold_configured,'updated_at',updated_at) into current_row from public.restaurants where id=p_restaurant_id for update;
    if current_row is distinct from expected then raise exception 'The low-stock default changed after this batch'; end if;
    update public.restaurants set default_threshold_min=(prior->>'default_threshold_min')::integer,threshold_configured=(prior->>'threshold_configured')::boolean where id=p_restaurant_id;
  elsif p_target='vendor_currency' then
    select jsonb_build_object('usual_currency',usual_currency,'usual_currency_set_by',usual_currency_set_by,'usual_currency_set_at',usual_currency_set_at,'updated_at',updated_at) into current_row from public.providers where id=provider and restaurant_id=p_restaurant_id for update;
    if current_row is distinct from expected then raise exception 'The vendor currency changed after this batch'; end if;
    update public.providers set usual_currency=prior->>'usual_currency',usual_currency_set_by=(prior->>'usual_currency_set_by')::uuid,usual_currency_set_at=(prior->>'usual_currency_set_at')::timestamptz where id=provider and restaurant_id=p_restaurant_id;
  elsif p_target='cellar' then
    select to_jsonb(r) into current_row from public.restaurant_cellar_registers r where restaurant_id=p_restaurant_id and register=entry->>'field' for update;
    if current_row is distinct from expected then raise exception 'This cellar register changed after the batch'; end if;
    delete from public.restaurant_cellar_registers where restaurant_id=p_restaurant_id and register=entry->>'field';
    if prior is distinct from 'null'::jsonb then insert into public.restaurant_cellar_registers select * from jsonb_populate_record(null::public.restaurant_cellar_registers,prior); end if;
  elsif p_target='vendor_terms' then
    select to_jsonb(r) into current_row from public.restaurant_vendor_terms r where restaurant_id=p_restaurant_id and provider_id=provider for update;
    if current_row is distinct from expected then raise exception 'Vendor terms changed after this batch'; end if;
    delete from public.restaurant_vendor_terms where restaurant_id=p_restaurant_id and provider_id=provider;
    if prior is distinct from 'null'::jsonb then insert into public.restaurant_vendor_terms select * from jsonb_populate_record(null::public.restaurant_vendor_terms,prior); end if;
  elsif p_target='notifications' then
    -- Keyed on the row's OWN id, taken from the very snapshot this batch
    -- recorded, never on user_id alone. notification_preferences is unique on
    -- (restaurant_id, user_id) in production (20260813090000:69-91), and a
    -- person can hold one row per house; `where user_id=p_actor_id` with no
    -- further key matched an arbitrary one of them and could DELETE the
    -- other house's row outright (measured 2026-09-17, codex-audit/C2-adopt.md
    -- #5). Whether preferences are ultimately per-user or per-(restaurant,user)
    -- is the open product question 20260813090000 already declined to guess
    -- at; keying by this specific row's id sidesteps it rather than answering
    -- it — the restore only ever touches the one row it snapshotted.
    if expected->>'id' is null then raise exception 'This entry has no row identity to restore'; end if;
    select to_jsonb(r) into current_row from public.notification_preferences r where id=(expected->>'id')::uuid for update;
    if current_row is distinct from expected then raise exception 'Your notification preferences changed after this batch'; end if;
    delete from public.notification_preferences where id=(expected->>'id')::uuid;
    if prior is distinct from 'null'::jsonb then insert into public.notification_preferences select * from jsonb_populate_record(null::public.notification_preferences,prior); end if;
  elsif p_target='menu_item' then
    menu_id:=(expected->'menu'->>'id')::uuid;
    select to_jsonb(r) into current_row from public.menu_items r where id=menu_id and restaurant_id=p_restaurant_id for update;
    if current_row is distinct from expected->'menu' then raise exception 'This menu item changed after its import'; end if;
    if expected->'inventory' is distinct from 'null'::jsonb then
      inventory_id:=(expected->'inventory'->>'id')::uuid;
      select to_jsonb(r) into inventory_row from public.restaurant_inventory r where id=inventory_id and restaurant_id=p_restaurant_id for update;
      if inventory_row is distinct from expected->'inventory' then raise exception 'This stock record changed after its import'; end if;
      if coalesce((inventory_row->>'stock_live')::numeric,0)<>0 or coalesce((inventory_row->>'physical_stock')::numeric,0)<>0 or coalesce((inventory_row->>'shadow_stock')::numeric,0)<>0 or coalesce((inventory_row->>'expected_stock')::numeric,0)<>0 or coalesce((inventory_row->>'in_transit_quantity')::numeric,0)<>0 then raise exception 'This item now carries stock and cannot be removed by setup undo'; end if;
    end if;
    -- Check every incoming FK, including composite keys and future tables,
    -- before either house row is removed. FOR UPDATE above also serializes
    -- concurrent FK references against the row being considered for removal.
    for dependency in
      select c.conrelid::regclass as relation,c.confrelid::regclass as parent_relation,c.conkey,c.confkey
      from pg_constraint c where c.contype='f' and
        (c.confrelid='public.menu_items'::regclass or (inventory_id is not null and c.confrelid='public.restaurant_inventory'::regclass))
    loop
      select string_agg(format('child.%I=parent.%I',child_col.attname,parent_col.attname),' and ' order by keys.n)
      into join_columns
      from unnest(dependency.conkey,dependency.confkey) with ordinality as keys(child_key,parent_key,n)
      join pg_attribute child_col on child_col.attrelid=dependency.relation and child_col.attnum=keys.child_key
      join pg_attribute parent_col on parent_col.attrelid=dependency.parent_relation and parent_col.attnum=keys.parent_key;
      execute format('select exists(select 1 from %s child join %s parent on %s where parent.id=$1%s)',
        dependency.relation,dependency.parent_relation,join_columns,
        case when dependency.parent_relation='public.restaurant_inventory'::regclass and dependency.relation='public.menu_items'::regclass then ' and child.id<>$2' else '' end)
      into referenced using case when dependency.parent_relation='public.menu_items'::regclass then menu_id else inventory_id end,menu_id;
      if referenced then raise exception 'This menu or stock record has subsequent use and was left intact'; end if;
    end loop;
    delete from public.menu_items where id=menu_id and restaurant_id=p_restaurant_id;
    if inventory_id is not null then delete from public.restaurant_inventory where id=inventory_id and restaurant_id=p_restaurant_id; end if;
    -- Shared library identities and their submission evidence are deliberately
    -- retained; another house may already reference them. No catalogue delete.
  else raise exception 'This register does not have a setup undo writer';
  end if;
  insert into public.system_audit_log(actor_type,actor_id,action,entity_type,entity_id,changes,restaurant_id,correlation_id)
  values('user',p_actor_id,'configuration_batch_undone','configuration_batch',p_batch_id,jsonb_build_object('register',p_target,'rowId',p_row_id,'reverses',p_batch_id,'fields',jsonb_build_object(entry->>'field',jsonb_build_object('from',entry->'value','to',entry->'beforeValue'))),p_restaurant_id,batch.undo_correlation_id);
  return jsonb_build_object('restored',true,'sharedCatalogueRetained',p_target='menu_item');
end $$;
revoke all on function public.arrival_restore_entry(uuid,uuid,uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.arrival_restore_entry(uuid,uuid,uuid,uuid,text) to service_role;

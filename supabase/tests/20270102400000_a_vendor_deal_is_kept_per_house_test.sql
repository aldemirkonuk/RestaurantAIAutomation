-- F-535: vendor_promotions dedup is per house. Migration
-- a_vendor_deal_is_kept_per_house swaps UNIQUE (dedup_hash) for
-- UNIQUE (restaurant_id, dedup_hash).
--
-- Self-asserting: every block raises on a failure, so
-- `psql -v ON_ERROR_STOP=1 -f` stops at the first one. It must FAIL on a build
-- without that migration (T1: the global key is still there) and PASS with it.
-- One transaction, rolled back: it leaves nothing behind.

begin;

-- T1 the global key is gone and the per-house key is in its place.
do $$
declare
  def text;
begin
  assert not exists (
    select 1 from pg_constraint
     where conrelid = 'public.vendor_promotions'::regclass
       and conname = 'vendor_promotions_dedup_hash_key'
  ), 'T1 FAIL vendor_promotions_dedup_hash_key (global dedup) still exists';
  select pg_get_constraintdef(c.oid) into def
    from pg_constraint c
   where c.conrelid = 'public.vendor_promotions'::regclass
     and c.conname = 'vendor_promotions_restaurant_dedup_hash_key'
     and c.contype = 'u';
  assert def = 'UNIQUE (restaurant_id, dedup_hash)',
    format('T1 FAIL per-house key is %s', coalesce(def, 'absent'));
end $$;

-- T2 behaviour: the same hash lands once in each of two houses, and a second
-- copy in the same house is still refused. FKs are not the subject here.
set local session_replication_role = replica;

do $$
declare
  house_a uuid := gen_random_uuid();
  house_b uuid := gen_random_uuid();
  vendor uuid := gen_random_uuid();
begin
  insert into public.vendor_promotions (provider_id, restaurant_id, dedup_hash)
  values (vendor, house_a, 'same-blast'), (vendor, house_b, 'same-blast');

  begin
    insert into public.vendor_promotions (provider_id, restaurant_id, dedup_hash)
    values (vendor, house_a, 'same-blast');
    raise exception 'T2 FAIL a second copy in the same house was accepted';
  exception when unique_violation then
    null;
  end;
end $$;

rollback;

-- F-568 residual (owner-quarter sim, wave 16): two outreach taps at the same
-- instant could both insert an active conversation for the same vendor and
-- kind. Migration one_open_vendor_conversation_per_kind adds a unique partial
-- index.
--
-- Self-asserting: every block raises on a failure. It must FAIL on a build
-- without that migration (T1, T2) and PASS with it. One transaction, rolled
-- back: it leaves nothing behind.

begin;

insert into public.restaurants (id, name, slug)
values ('7b000000-0000-4000-8000-000000000001', 'Vendor Talk House', 'f568-vendor-talk-house');
insert into public.providers (id, name, primary_contact, is_custom, restaurant_id)
values ('7b000000-0000-4000-8000-0000000000b1', 'SYNTHETIC Wine Co',
        '{"email":"ops@example.invalid"}'::jsonb, true, '7b000000-0000-4000-8000-000000000001');
insert into public.provider_conversation_sessions
  (provider_id, restaurant_id, session_type, status, initiated_by)
values ('7b000000-0000-4000-8000-0000000000b1', '7b000000-0000-4000-8000-000000000001',
        'onboarding', 'active', 'onboarding');

-- T1 the index is there, unique, and only over active rows.
do $$
begin
  assert exists (
    select 1 from pg_indexes
     where schemaname = 'public' and indexname = 'uq_pcs_one_active_per_kind'
       and indexdef ilike '%unique%' and indexdef ilike '%status = ''active''%'),
    'T1 FAIL no unique partial index on active vendor conversations';
end $$;

-- T2 a second active conversation of the same kind for the same vendor is refused.
do $$
begin
  begin
    insert into public.provider_conversation_sessions
      (provider_id, restaurant_id, session_type, status, initiated_by)
    values ('7b000000-0000-4000-8000-0000000000b1', '7b000000-0000-4000-8000-000000000001',
            'onboarding', 'active', 'onboarding');
    raise exception 'T2 FAIL a second active onboarding for the same vendor was accepted';
  exception when unique_violation then null;
  end;
end $$;

-- T3 a different kind, and any number of closed ones, are still allowed.
insert into public.provider_conversation_sessions
  (provider_id, restaurant_id, session_type, status, initiated_by)
values ('7b000000-0000-4000-8000-0000000000b1', '7b000000-0000-4000-8000-000000000001',
        'relationship_building', 'active', 'manual_outreach'),
       ('7b000000-0000-4000-8000-0000000000b1', '7b000000-0000-4000-8000-000000000001',
        'onboarding', 'completed', 'onboarding'),
       ('7b000000-0000-4000-8000-0000000000b1', '7b000000-0000-4000-8000-000000000001',
        'onboarding', 'abandoned', 'onboarding');
do $$
declare n int;
begin
  select count(*) into n from public.provider_conversation_sessions
   where provider_id = '7b000000-0000-4000-8000-0000000000b1';
  assert n = 4, format('T3 FAIL expected 4 conversations, found %s', n);
end $$;

rollback;

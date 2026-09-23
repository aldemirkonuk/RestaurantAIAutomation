-- Version note (PR #414 BLOCK): earlier drafts shipped this file as
-- 20260913190500, behind main's applied ceiling. Renamed past 20260921114400 so
-- the runner actually applies it.
--
-- ADR0143/0144: the house's folios and one proposal batch survive a closed tab.
-- Backend only. Public/anon/authenticated cannot call these SECURITY INVOKER
-- functions or access proposal rows; the JWT gateway supplies actor + tenant.
create table if not exists public.arrival_folios (
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  scope_id uuid not null,
  folio text not null check (folio in ('evidence','currency','pour','vendors','notifications','assistant')),
  state text not null check (state in ('open','posted','skipped')),
  actor_id uuid not null,
  updated_at timestamptz not null default now(),
  primary key (restaurant_id, scope_id, folio)
);
alter table public.arrival_folios enable row level security;
revoke all on public.arrival_folios from public, anon, authenticated;
grant all on public.arrival_folios to service_role;

create table if not exists public.configuration_batches (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  user_id uuid not null,
  revision integer not null default 0,
  -- 'applied_with_issues'/'undone_with_issues' (codex-audit/C2-adopt.md #4):
  -- apply()/undo() used to always land on 'applied'/'undone' even when every
  -- row in the batch was refused, unconfirmed, or failed to restore — the
  -- rows carried the truth (each has its own status) and the header did not.
  status text not null default 'draft' check (status in ('draft','applying','applied','applied_with_issues','undoing','undone','undone_with_issues')),
  rows jsonb not null default '[]'::jsonb check (jsonb_typeof(rows) = 'array' and jsonb_array_length(rows) <= 500),
  created_at timestamptz not null default now(),
  sealed_at timestamptz,
  undo_correlation_id uuid not null default gen_random_uuid(),
  undo_until timestamptz
);
create unique index if not exists configuration_batches_one_open on public.configuration_batches(restaurant_id, user_id) where status in ('draft','applying','undoing');
create index if not exists configuration_batches_house_date on public.configuration_batches(restaurant_id, user_id, created_at desc);
alter table public.configuration_batches enable row level security;
revoke all on public.configuration_batches from public, anon, authenticated;
grant all on public.configuration_batches to service_role;

create or replace function public.arrival_record_folio(p_restaurant_id uuid, p_actor_id uuid, p_folio text, p_state text, p_changes jsonb, p_correlation_id uuid default null)
returns void language plpgsql security invoker set search_path = public, pg_temp as $$
declare scope uuid;
begin
  if p_restaurant_id is null or p_actor_id is null then raise exception 'Arrival needs a house and a person'; end if;
  scope := case when p_folio in ('notifications','assistant') then p_actor_id else '00000000-0000-0000-0000-000000000000'::uuid end;
  insert into public.arrival_folios(restaurant_id,scope_id,folio,state,actor_id,updated_at)
  values(p_restaurant_id,scope,p_folio,p_state,p_actor_id,now())
  on conflict(restaurant_id,scope_id,folio) do update set state=excluded.state,actor_id=excluded.actor_id,updated_at=excluded.updated_at;
  insert into public.system_audit_log(actor_type,actor_id,action,entity_type,entity_id,changes,restaurant_id,correlation_id)
  values('user',p_actor_id,case when p_state='skipped' then 'configuration_step_skipped' else 'configuration_folio_recorded' end,'arrival_folio',p_restaurant_id,p_changes || jsonb_build_object('register',p_folio),p_restaurant_id,p_correlation_id);
end $$;
revoke all on function public.arrival_record_folio(uuid,uuid,text,text,jsonb,uuid) from public, anon, authenticated;
grant execute on function public.arrival_record_folio(uuid,uuid,text,text,jsonb,uuid) to service_role;

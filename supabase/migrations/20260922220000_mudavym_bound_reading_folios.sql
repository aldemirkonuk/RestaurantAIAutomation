-- ADR 0145: a personal, house-scoped folio is recorded BEFORE model execution.
-- Created with `supabase migration new`, then assigned the coordinated version.
create table if not exists public.ask_reading_folios (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  user_id uuid not null references public.users(user_id) on delete cascade,
  request_id uuid not null,
  correlation_id uuid not null,
  origin text not null check (origin in ('page', 'panel', 'standing')),
  utterance text not null check (char_length(utterance) between 1 and 2000),
  status text not null default 'pending' check (status in ('pending', 'complete', 'failed')),
  reading_id text,
  reading_version integer check (reading_version > 0),
  reading_args jsonb not null default '{}'::jsonb check (jsonb_typeof(reading_args) = 'object'),
  finding jsonb check (finding is null or jsonb_typeof(finding) = 'object'),
  -- could_not_read is a SOURCE that did not answer; could_not_answer is the
  -- MODEL side (unavailable, spend ceiling, or a reply that failed validation).
  -- Different causes are different types (ADR 0145; KL audit J5).
  reply_kind text check (reply_kind in ('reading', 'model_knowledge', 'clarify', 'not_built', 'no_reading_matched', 'requirements_unsatisfied', 'not_in_your_books', 'could_not_read', 'could_not_answer')),
  answer jsonb check (answer is null or jsonb_typeof(answer) = 'object'),
  failure_reason text,
  proposal_id uuid references public.ai_proposed_actions(id) on delete set null,
  previous_folio_id uuid,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (restaurant_id, user_id, request_id),
  unique (id, restaurant_id),
  -- SET NULL on the pointer column only (PG 15+ column list; production is 17).
  -- A plain SET NULL would null restaurant_id too, which is NOT NULL.
  foreign key (previous_folio_id, restaurant_id) references public.ask_reading_folios(id, restaurant_id)
    on delete set null (previous_folio_id),
  check ((status = 'pending' and completed_at is null) or (status <> 'pending' and completed_at is not null)),
  check (status <> 'complete' or (answer is not null and reply_kind is not null)),
  check (finding is null or (reading_id is not null and reading_version is not null))
);
create index if not exists ask_reading_folios_person_house_created
  on public.ask_reading_folios (restaurant_id, user_id, created_at desc, id desc);
create index if not exists ask_reading_folios_outcomes
  on public.ask_reading_folios (restaurant_id, created_at desc, reply_kind);
create index if not exists ask_reading_folios_pending
  on public.ask_reading_folios (created_at) where status = 'pending';

alter table public.ask_reading_folios enable row level security;
revoke all on public.ask_reading_folios from public, anon, authenticated;
grant select, insert, update, delete on public.ask_reading_folios to service_role;
drop policy if exists ask_reading_folios_service_only on public.ask_reading_folios;
create policy ask_reading_folios_service_only on public.ask_reading_folios
  for all to service_role using (true) with check (true);

alter table public.ai_proposed_actions
  add column if not exists reading_folio_id uuid,
  add column if not exists finding jsonb,
  add column if not exists field_provenance jsonb,
  add column if not exists correlation_id uuid;

-- `add constraint` has no `if not exists`, so the DO block (same idiom as
-- 20260902210000) makes a re-run a no-op rather than a 42710.
do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.ai_proposed_actions'::regclass
       and conname  = 'ai_proposed_actions_folio_house_fk'
  ) then
    -- A proposal is a house record (created_by carries no user FK) and a folio
    -- is personal (ON DELETE CASCADE with its user). SET NULL on the folio
    -- pointer only, so deleting a person never fails with 23503 on a proposal
    -- their Reading backed (KL audit J11).
    alter table public.ai_proposed_actions
      add constraint ai_proposed_actions_folio_house_fk foreign key (reading_folio_id, restaurant_id)
      references public.ask_reading_folios(id, restaurant_id) on delete set null (reading_folio_id);
  end if;
end
$$;

create index if not exists ai_proposed_actions_reading_folio on public.ai_proposed_actions (reading_folio_id)
  where reading_folio_id is not null;
comment on column public.ai_proposed_actions.idempotency_key is
  'Server-generated proposal identity; execution ownership comes from the conditional proposed-to-confirmed update, not from a client-supplied key.';
comment on table public.ask_reading_folios is
  'Mudavym bound Reading record. Inserted before paid execution; pending after an interrupted worker is unknown, never a fabricated completed answer. Gateway reads require BOTH user_id and restaurant_id. No direct browser grants.';

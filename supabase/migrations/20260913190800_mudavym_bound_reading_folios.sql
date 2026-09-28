-- ADR 0145: a personal, house-scoped folio is recorded BEFORE model execution.
-- Created with `supabase migration new`, then assigned the coordinated version.
create table public.ask_reading_folios (
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
  reply_kind text check (reply_kind in ('reading', 'model_knowledge', 'clarify', 'not_built', 'no_reading_matched', 'requirements_unsatisfied', 'not_in_your_books', 'could_not_read')),
  answer jsonb check (answer is null or jsonb_typeof(answer) = 'object'),
  failure_reason text,
  proposal_id uuid references public.ai_proposed_actions(id) on delete set null,
  previous_folio_id uuid,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (restaurant_id, user_id, request_id),
  unique (id, restaurant_id),
  foreign key (previous_folio_id, restaurant_id) references public.ask_reading_folios(id, restaurant_id),
  check ((status = 'pending' and completed_at is null) or (status <> 'pending' and completed_at is not null)),
  check (status <> 'complete' or (answer is not null and reply_kind is not null)),
  check (finding is null or (reading_id is not null and reading_version is not null))
);
create index ask_reading_folios_person_house_created
  on public.ask_reading_folios (restaurant_id, user_id, created_at desc, id desc);
create index ask_reading_folios_outcomes
  on public.ask_reading_folios (restaurant_id, created_at desc, reply_kind);
create index ask_reading_folios_pending
  on public.ask_reading_folios (created_at) where status = 'pending';

alter table public.ask_reading_folios enable row level security;
revoke all on public.ask_reading_folios from public, anon, authenticated;
grant select, insert, update, delete on public.ask_reading_folios to service_role;
create policy ask_reading_folios_service_only on public.ask_reading_folios
  for all to service_role using (true) with check (true);

alter table public.ai_proposed_actions
  add column reading_folio_id uuid,
  add column finding jsonb,
  add column field_provenance jsonb,
  add column correlation_id uuid,
  add constraint ai_proposed_actions_folio_house_fk foreign key (reading_folio_id, restaurant_id)
    references public.ask_reading_folios(id, restaurant_id);
create index ai_proposed_actions_reading_folio on public.ai_proposed_actions (reading_folio_id)
  where reading_folio_id is not null;
comment on column public.ai_proposed_actions.idempotency_key is
  'Server-generated proposal identity; execution ownership comes from the conditional proposed-to-confirmed update, not from a client-supplied key.';
comment on table public.ask_reading_folios is
  'Mudavym bound Reading record. Inserted before paid execution; pending after an interrupted worker is unknown, never a fabricated completed answer. Gateway reads require BOTH user_id and restaurant_id. No direct browser grants.';

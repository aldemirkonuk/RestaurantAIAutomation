-- ADR 0145, 2026-09-21 amendment. The founder chose the option "Rules in code,
-- label rows": permissions and spend never live in the model, and every ask is
-- one complete row a later evaluation can use as-is. No training is built here.
--
-- Four parts, all additive and idempotent:
--   1. capture columns on ask_reading_folios, written once (a trigger refuses
--      any later change);
--   2. ask_folio_labels -- a person's label on ONE step of their own ask, plus
--      the pick label a re-ask derives (written by trigger, in the re-ask's own
--      insert transaction);
--   3. ask_redact_utterance() -- pattern redaction for the export;
--   4. ask_folio_training_export -- a VIEW keyed by folio id, never a copy, so
--      a deleted person drops out of every future export.

-- 1. Capture ------------------------------------------------------------------
alter table public.ask_reading_folios
  add column if not exists asked_as_role text,
  add column if not exists reading_chosen_by text,
  add column if not exists pick_class text,
  add column if not exists pick_args jsonb,
  add column if not exists pick_model text,
  add column if not exists pick_prompt_sha text,
  add column if not exists compose_model text,
  add column if not exists compose_prompt_sha text,
  add column if not exists catalogue_sha text,
  add column if not exists policy_sha text;

alter table public.ask_reading_folios drop constraint if exists ask_reading_folios_capture_shape;
alter table public.ask_reading_folios add constraint ask_reading_folios_capture_shape check (
  (asked_as_role is null or char_length(asked_as_role) between 1 and 40)
  and (reading_chosen_by is null or reading_chosen_by in ('page', 'model'))
  -- The model did not pick what the page chose.
  and (reading_chosen_by is distinct from 'page' or (pick_class is null and pick_args is null and pick_model is null and pick_prompt_sha is null))
  and (pick_class is null or char_length(pick_class) between 1 and 80)
  and (pick_args is null or jsonb_typeof(pick_args) = 'object')
  and (pick_model is null or char_length(pick_model) between 1 and 120)
  and (compose_model is null or char_length(compose_model) between 1 and 120)
  and (pick_prompt_sha is null or pick_prompt_sha ~ '^[0-9a-f]{64}$')
  and (compose_prompt_sha is null or compose_prompt_sha ~ '^[0-9a-f]{64}$')
  and (catalogue_sha is null or catalogue_sha ~ '^[0-9a-f]{64}$')
  and (policy_sha is null or policy_sha ~ '^[0-9a-f]{64}$')
);

comment on column public.ask_reading_folios.asked_as_role is
  'The asker''s role in this house as their token resolved it AT ASK TIME. A snapshot: never re-derived by join, because standing changes.';
comment on column public.ask_reading_folios.reading_chosen_by is
  'page when the request named the Reading; model when the pick model chose it. Keeps page choices out of a pick dataset.';
comment on column public.ask_reading_folios.pick_class is
  'The pick model''s validated question class, before a disposition collapses it (forecast, landed_cost, sales_revenue and lot_expiry all answer not_built).';
comment on column public.ask_reading_folios.catalogue_sha is
  'sha256 of the Reading catalogue in force, computed from its content at ask time -- never a hand-bumped version.';
comment on column public.ask_reading_folios.policy_sha is
  'sha256 of the field classes and role-policy table in force at ask time.';

-- Written once. The snapshot half is set by the insert and never changes; the
-- model half is set by the one update that moves a folio out of pending.
create or replace function public.ask_reading_folios_capture_is_written_once()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.asked_as_role is distinct from old.asked_as_role
     or new.reading_chosen_by is distinct from old.reading_chosen_by
     or new.catalogue_sha is distinct from old.catalogue_sha
     or new.policy_sha is distinct from old.policy_sha then
    raise exception 'ask folio % capture is written once: the ask-time snapshot cannot change', old.id
      using errcode = 'check_violation';
  end if;
  if old.status <> 'pending' and (
       new.pick_class is distinct from old.pick_class
       or new.pick_args is distinct from old.pick_args
       or new.pick_model is distinct from old.pick_model
       or new.pick_prompt_sha is distinct from old.pick_prompt_sha
       or new.compose_model is distinct from old.compose_model
       or new.compose_prompt_sha is distinct from old.compose_prompt_sha) then
    raise exception 'ask folio % capture is written once: a finished ask''s model capture cannot change', old.id
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;
revoke all on function public.ask_reading_folios_capture_is_written_once() from public, anon, authenticated;

drop trigger if exists ask_reading_folios_capture_is_written_once on public.ask_reading_folios;
create trigger ask_reading_folios_capture_is_written_once
  before update on public.ask_reading_folios
  for each row execute function public.ask_reading_folios_capture_is_written_once();

-- 2. Labels -------------------------------------------------------------------
create table if not exists public.ask_folio_labels (
  id uuid primary key default gen_random_uuid(),
  folio_id uuid not null,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  -- Which step the label is about. "Wrong" means different things per step,
  -- and `books` (the house's records are wrong) is data quality, never a
  -- training label: the export view omits it.
  step text not null check (step in ('pick', 'compose', 'knowledge', 'books')),
  label text not null check (label in ('correct', 'incorrect')),
  -- The question class the person meant (pick only).
  gold_class text check (gold_class is null or char_length(gold_class) between 1 and 80),
  gold_args jsonb check (gold_args is null or jsonb_typeof(gold_args) = 'object'),
  -- person: an explicit label from the person who asked. re_ask: derived from
  -- that person's own re-ask naming a Reading (previous_folio_id).
  basis text not null check (basis in ('person', 're_ask')),
  from_folio_id uuid,
  labeled_by uuid not null references public.users(user_id) on delete cascade,
  labeled_by_role text check (labeled_by_role is null or char_length(labeled_by_role) between 1 and 40),
  at timestamptz not null default now(),
  foreign key (folio_id, restaurant_id) references public.ask_reading_folios(id, restaurant_id) on delete cascade,
  foreign key (from_folio_id, restaurant_id) references public.ask_reading_folios(id, restaurant_id) on delete cascade,
  check ((gold_class is null and gold_args is null) or step = 'pick'),
  check (
    (basis = 'person' and from_folio_id is null)
    or (basis = 're_ask' and from_folio_id is not null and step = 'pick' and gold_class is not null)
  ),
  unique (from_folio_id)
);
create index if not exists ask_folio_labels_folio_step
  on public.ask_folio_labels (restaurant_id, folio_id, step, at desc);

alter table public.ask_folio_labels enable row level security;
revoke all on public.ask_folio_labels from public, anon, authenticated;
grant select, insert, update, delete on public.ask_folio_labels to service_role;
drop policy if exists ask_folio_labels_service_only on public.ask_folio_labels;
create policy ask_folio_labels_service_only on public.ask_folio_labels
  for all to service_role using (true) with check (true);
comment on table public.ask_folio_labels is
  'ADR 0145 (2026-09-21): labels on one step of an ask, keyed by the folio (the interaction), not by a neural_footprint_event row -- a refusal or a page-chosen Reading makes no NF row to hang a label on. Cascades with the folio, so erasure removes labels too.';

-- A re-ask that NAMES its Reading (the page chose it, previous_folio_id points
-- at a model-picked folio of the same person) is a free pick label on the
-- folio it follows: a different Reading says the pick was wrong and which
-- class was meant; the same Reading (a clarification follow-up) says the
-- class was right. Written here, in the re-ask's insert transaction, so it
-- cannot be lost between two round trips. A previous folio still pending has
-- no pick to label and gets none.
create or replace function public.ask_reading_folios_reask_labels_the_pick()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  prev record;
begin
  if new.previous_folio_id is null or new.reading_chosen_by is distinct from 'page' or new.reading_id is null then
    return new;
  end if;
  select f.id, f.restaurant_id, f.reading_chosen_by, f.pick_class
    into prev
    from public.ask_reading_folios f
   where f.id = new.previous_folio_id
     and f.restaurant_id = new.restaurant_id
     and f.user_id = new.user_id;
  if not found or prev.reading_chosen_by is distinct from 'model' or prev.pick_class is null then
    return new;
  end if;
  insert into public.ask_folio_labels
    (folio_id, restaurant_id, step, label, gold_class, gold_args, basis, from_folio_id, labeled_by, labeled_by_role)
  values
    (prev.id, prev.restaurant_id, 'pick',
     case when prev.pick_class = new.reading_id then 'correct' else 'incorrect' end,
     new.reading_id,
     case when prev.pick_class = new.reading_id then null else new.reading_args end,
     're_ask', new.id, new.user_id, new.asked_as_role)
  on conflict (from_folio_id) do nothing;
  return new;
end
$$;
revoke all on function public.ask_reading_folios_reask_labels_the_pick() from public, anon, authenticated;

drop trigger if exists ask_reading_folios_reask_labels_the_pick on public.ask_reading_folios;
create trigger ask_reading_folios_reask_labels_the_pick
  after insert on public.ask_reading_folios
  for each row execute function public.ask_reading_folios_reask_labels_the_pick();

-- 3. Redaction ----------------------------------------------------------------
-- Masks what a pattern CAN find: e-mail addresses, links, and digit runs of
-- seven or more (phone, card, account and tax numbers). ISO dates
-- (YYYY-MM-DD) are kept: they are the pick's date spans. It does NOT find
-- names -- a guest or staff name in an utterance survives this function --
-- which is why the export is not a training set and consent for any training
-- use is an open founder/legal question (ADR 0145, 2026-09-21).
create or replace function public.ask_redact_utterance(p_text text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  date_re constant text := '(?<![0-9])[0-9]{4}-[0-9]{2}-[0-9]{2}(?![0-9])';
  parts text[];
  dates text[];
  seg text;
  result text := '';
  i integer;
begin
  if p_text is null then
    return null;
  end if;
  parts := regexp_split_to_array(p_text, date_re);
  select coalesce(array_agg(m.match[1] order by m.n), array[]::text[])
    into dates
    from regexp_matches(p_text, '(' || date_re || ')', 'g') with ordinality as m(match, n);
  for i in 1 .. coalesce(array_length(parts, 1), 0) loop
    seg := parts[i];
    seg := regexp_replace(seg, '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', '[email]', 'g');
    seg := regexp_replace(seg, '(https?://|www\.)[^[:space:]]+', '[link]', 'gi');
    seg := regexp_replace(seg, '\+?[0-9]([ ().-]?[0-9]){6,}', '[number]', 'g');
    result := result || seg;
    if i <= coalesce(array_length(dates, 1), 0) then
      result := result || dates[i];
    end if;
  end loop;
  return result;
end
$$;
revoke all on function public.ask_redact_utterance(text) from public, anon, authenticated;
grant execute on function public.ask_redact_utterance(text) to service_role;

-- 4. Export -------------------------------------------------------------------
-- Keyed by folio id and computed on read: a person deleted from public.users
-- is gone from it at once (their folios cascade, and the inner join says so
-- again). It carries no user id, no raw utterance, no answer text and no
-- Finding (house cells name vendors and calendar entries). `books` labels are
-- omitted -- they are about the house's records, not the model. An explicit
-- label from the person outranks one a re-ask derived.
create or replace view public.ask_folio_training_export
with (security_invoker = true)
as
select
  f.id as folio_id,
  f.restaurant_id,
  f.created_at,
  f.origin,
  f.asked_as_role,
  f.reading_chosen_by,
  public.ask_redact_utterance(f.utterance) as utterance_redacted,
  f.catalogue_sha,
  f.policy_sha,
  f.pick_model,
  f.pick_prompt_sha,
  f.pick_class,
  case when f.pick_args is null then null else jsonb_strip_nulls(jsonb_build_object(
    'subjectText', public.ask_redact_utterance(f.pick_args ->> 'subjectText'),
    'from', f.pick_args ->> 'from',
    'to', f.pick_args ->> 'to')) end as pick_args_redacted,
  f.compose_model,
  f.compose_prompt_sha,
  f.reply_kind,
  f.reading_id,
  pick.label as pick_label,
  pick.gold_class,
  pick.basis as pick_label_basis,
  compose.label as compose_label,
  knowledge.label as knowledge_label
from public.ask_reading_folios f
join public.users u on u.user_id = f.user_id
left join lateral (
  select l.label, l.gold_class, l.basis
    from public.ask_folio_labels l
   where l.folio_id = f.id and l.restaurant_id = f.restaurant_id and l.step = 'pick'
   order by (l.basis = 'person') desc, l.at desc, l.id desc
   limit 1
) pick on true
left join lateral (
  select l.label
    from public.ask_folio_labels l
   where l.folio_id = f.id and l.restaurant_id = f.restaurant_id and l.step = 'compose'
   order by l.at desc, l.id desc
   limit 1
) compose on true
left join lateral (
  select l.label
    from public.ask_folio_labels l
   where l.folio_id = f.id and l.restaurant_id = f.restaurant_id and l.step = 'knowledge'
   order by l.at desc, l.id desc
   limit 1
) knowledge on true
where f.status <> 'pending';

revoke all on public.ask_folio_training_export from public, anon, authenticated;
grant select on public.ask_folio_training_export to service_role;
comment on view public.ask_folio_training_export is
  'ADR 0145 (2026-09-21): the redacted, erasure-safe export of asks, keyed by folio id. Read by nothing yet: no training is built, and none may run until an eval set exists and consent for training use is decided.';

-- ADR 0145, 2026-09-21, round 6r. Two founder picks, verbatim:
--   "Same as the wine pool (Recommended)" -- asks may be used for training
--     only under a notice in our Terms and on /ask, an owner opt-out per
--     house, and names removed before any export; a lawyer (KVKK/GDPR) is
--     asked before the first real training run.
--   "Two labels (Recommended)" -- a page follow-up to a DIFFERENT Reading and
--     a correction to the SAME Reading are stored as two labels, follow_up and
--     correction, because corrections are where Mudavym misread the ask.
--
-- Four parts, all additive and idempotent:
--   1. ask_training_opt_outs -- one row per house that has answered; no row
--      means not opted out (his default). Written only by the gateway, which
--      lets only the house's owner change it and files a system_audit_log row.
--   2. ask_reading_folios.reask_kind -- follow_up | correction, derived by the
--      database at insert and written once.
--   3. ask_folio_labels -- a re-ask's derived label is follow_up | correction,
--      never correct | incorrect; a person's own label stays correct | incorrect.
--   4. ask_folio_training_export -- drops every opted-out house and carries no
--      free text at all, because nothing here can find a name.

-- 1. The per-house opt-out ------------------------------------------------------
create table if not exists public.ask_training_opt_outs (
  restaurant_id uuid primary key references public.restaurants(id) on delete cascade,
  opted_out boolean not null,
  -- Who answered. Kept when the person is later deleted: the choice is the
  -- house's, not theirs, so the row stays and the name goes.
  set_by uuid references public.users(user_id) on delete set null,
  -- The gateway refuses anyone but the house's owner; the row says so too.
  set_by_role text not null check (set_by_role = 'owner'),
  set_at timestamptz not null default now()
);
alter table public.ask_training_opt_outs enable row level security;
revoke all on public.ask_training_opt_outs from public, anon, authenticated;
grant select, insert, update, delete on public.ask_training_opt_outs to service_role;
drop policy if exists ask_training_opt_outs_service_only on public.ask_training_opt_outs;
create policy ask_training_opt_outs_service_only on public.ask_training_opt_outs
  for all to service_role using (true) with check (true);
comment on table public.ask_training_opt_outs is
  'ADR 0145 (2026-09-21, founder: "Same as the wine pool (Recommended)"): whether a house has opted its /ask questions out of any training use. No row = not opted out, his default. Only the house''s owner may change it (the gateway checks the role in the house and files a system_audit_log row, action ask_training_opt_out_changed). ask_folio_training_export leaves out every house whose row says opted_out.';

-- 2. Which kind of re-ask a folio is ---------------------------------------------
alter table public.ask_reading_folios add column if not exists reask_kind text;
alter table public.ask_reading_folios drop constraint if exists ask_reading_folios_reask_kind_shape;
alter table public.ask_reading_folios add constraint ask_reading_folios_reask_kind_shape check (
  reask_kind is null
  or (reask_kind in ('follow_up', 'correction') and previous_folio_id is not null and reading_chosen_by = 'page' and reading_id is not null)
);
comment on column public.ask_reading_folios.reask_kind is
  'ADR 0145 (2026-09-21, founder: "Two labels (Recommended)"): for a re-ask that names its Reading (previous_folio_id + a page-chosen reading), correction when it names the SAME Reading as the folio it follows (the person re-ran it with other arguments: "no, I meant last week"), follow_up when it names a DIFFERENT one (a new question building on the last). Derived by the database at insert, never sent by a client, written once. Null when the folio it follows has no Reading to compare yet (still pending, or a pick not yet made).';

-- Existing re-asks, if any, get their kind before the column is frozen below.
-- Once only: after the first run the written-once trigger guards the column,
-- and a re-run must not try to fill a kind the insert left empty.
do $$
begin
  if not exists (
    select 1 from pg_trigger
     where tgname = 'ask_reading_folios_reask_kind_is_derived'
       and tgrelid = 'public.ask_reading_folios'::regclass
  ) then
    update public.ask_reading_folios n
       set reask_kind = case when p.reading = n.reading_id then 'correction' else 'follow_up' end
      from (
        select f.id, f.restaurant_id, f.user_id,
               case when f.reading_chosen_by = 'model' then f.pick_class else f.reading_id end as reading
          from public.ask_reading_folios f
      ) p
     where n.reask_kind is null
       and n.previous_folio_id = p.id and p.restaurant_id = n.restaurant_id and p.user_id = n.user_id
       and n.reading_chosen_by = 'page' and n.reading_id is not null and p.reading is not null;
  end if;
end
$$;

create or replace function public.ask_reading_folios_reask_kind_is_derived()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  prev_reading text;
begin
  -- Never a client's word: the kind is what the two folios say.
  new.reask_kind := null;
  if new.previous_folio_id is null or new.reading_chosen_by is distinct from 'page' or new.reading_id is null then
    return new;
  end if;
  select case when f.reading_chosen_by = 'model' then f.pick_class else f.reading_id end
    into prev_reading
    from public.ask_reading_folios f
   where f.id = new.previous_folio_id
     and f.restaurant_id = new.restaurant_id
     and f.user_id = new.user_id;
  if prev_reading is null then
    return new;
  end if;
  new.reask_kind := case when prev_reading = new.reading_id then 'correction' else 'follow_up' end;
  return new;
end
$$;
revoke all on function public.ask_reading_folios_reask_kind_is_derived() from public, anon, authenticated;

drop trigger if exists ask_reading_folios_reask_kind_is_derived on public.ask_reading_folios;
create trigger ask_reading_folios_reask_kind_is_derived
  before insert on public.ask_reading_folios
  for each row execute function public.ask_reading_folios_reask_kind_is_derived();

-- Written once: reask_kind joins the ask-time snapshot half (20260921115310).
create or replace function public.ask_reading_folios_capture_is_written_once()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.asked_as_role is distinct from old.asked_as_role
     or new.reading_chosen_by is distinct from old.reading_chosen_by
     or new.catalogue_sha is distinct from old.catalogue_sha
     or new.policy_sha is distinct from old.policy_sha
     or new.reask_kind is distinct from old.reask_kind then
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

-- 3. Two labels ------------------------------------------------------------------
-- The re-ask rule of 20260921115310 wrote correct | incorrect: a different
-- Reading said the pick was wrong. A follow-up to a different Reading is a new
-- question, not a verdict on the last one, so it is now its own label; the
-- same Reading is a correction, and its gold arguments are the ones the person
-- re-ran with. A person's own label is unchanged: correct | incorrect.
-- The two CHECKs 20260921115310 wrote without names: the label column's
-- (correct | incorrect) and the basis rule (a re-ask label names a gold class).
do $$
declare
  c record;
begin
  for c in
    select con.conname, pg_get_constraintdef(con.oid) as def
      from pg_constraint con
     where con.conrelid = 'public.ask_folio_labels'::regclass
       and con.contype = 'c'
       and con.conname <> 'ask_folio_labels_label_by_basis'
  loop
    if c.def like '%''incorrect''%' or (c.def like '%from_folio_id%' and c.def like '%re_ask%') then
      execute format('alter table public.ask_folio_labels drop constraint %I', c.conname);
    end if;
  end loop;
end
$$;
-- Existing re-ask labels take the new words once the old CHECKs are gone.
-- 20260921115310 wrote a same-Reading re-ask as `correct` with NO gold
-- arguments; a correction carries the arguments the person re-ran with, which
-- are the re-ask folio's own (`from_folio_id`), so they are read from it here.
-- Every right-hand side sees the row as it was, so `l.label` is the old label.
update public.ask_folio_labels l
   set label = case when l.label = 'correct' then 'correction' else 'follow_up' end,
       gold_class = case when l.label = 'correct' then l.gold_class else null end,
       gold_args = case when l.label = 'correct'
                        then (select n.reading_args from public.ask_reading_folios n
                               where n.id = l.from_folio_id and n.restaurant_id = l.restaurant_id)
                        else null end
 where l.basis = 're_ask' and l.label in ('correct', 'incorrect');

alter table public.ask_folio_labels drop constraint if exists ask_folio_labels_label_by_basis;
alter table public.ask_folio_labels add constraint ask_folio_labels_label_by_basis check (
  (basis = 'person' and from_folio_id is null and label in ('correct', 'incorrect'))
  or (basis = 're_ask' and from_folio_id is not null and step = 'pick' and (
        (label = 'correction' and gold_class is not null)
        or (label = 'follow_up' and gold_class is null and gold_args is null)))
);

create or replace function public.ask_reading_folios_reask_labels_the_pick()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  prev record;
begin
  -- reask_kind was derived by the BEFORE INSERT trigger above.
  if new.reask_kind is null then
    return new;
  end if;
  select f.id, f.restaurant_id, f.reading_chosen_by, f.pick_class
    into prev
    from public.ask_reading_folios f
   where f.id = new.previous_folio_id
     and f.restaurant_id = new.restaurant_id
     and f.user_id = new.user_id;
  -- Only a model's pick has a pick step to label.
  if not found or prev.reading_chosen_by is distinct from 'model' or prev.pick_class is null then
    return new;
  end if;
  insert into public.ask_folio_labels
    (folio_id, restaurant_id, step, label, gold_class, gold_args, basis, from_folio_id, labeled_by, labeled_by_role)
  values
    (prev.id, prev.restaurant_id, 'pick', new.reask_kind,
     case when new.reask_kind = 'correction' then new.reading_id end,
     case when new.reask_kind = 'correction' then new.reading_args end,
     're_ask', new.id, new.user_id, new.asked_as_role)
  on conflict (from_folio_id) do nothing;
  return new;
end
$$;
revoke all on function public.ask_reading_folios_reask_labels_the_pick() from public, anon, authenticated;

-- 4. The export -----------------------------------------------------------------
-- Replaced, not amended: its columns change. Still keyed by folio id, still a
-- security_invoker view, still inner-joined to public.users (a deleted person
-- is gone at once). Changed:
--   * an opted-out house is left out entirely;
--   * NO free text: the redacted utterance and the pick's subject span are
--     gone, because ask_redact_utterance masks e-mails, links and numbers and
--     cannot find a name, and his rule is names removed before any export. A
--     pick's from/to are kept only when each is an ISO date (the pick model
--     may return any ten-character span of the question there);
--   * the person's own pick label (correct | incorrect) and the re-ask's
--     (follow_up | correction) are two columns, never one.
drop view if exists public.ask_folio_training_export;
create view public.ask_folio_training_export
with (security_invoker = true)
as
select
  f.id as folio_id,
  f.restaurant_id,
  f.created_at,
  f.origin,
  f.asked_as_role,
  f.reading_chosen_by,
  f.catalogue_sha,
  f.policy_sha,
  f.pick_model,
  f.pick_prompt_sha,
  f.pick_class,
  case when f.pick_args is null then null else jsonb_strip_nulls(jsonb_build_object(
    'from', case when (f.pick_args ->> 'from') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then f.pick_args ->> 'from' end,
    'to', case when (f.pick_args ->> 'to') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then f.pick_args ->> 'to' end)) end as pick_dates,
  f.compose_model,
  f.compose_prompt_sha,
  f.reply_kind,
  f.reading_id,
  f.reask_kind,
  pick.label as pick_label,
  pick.gold_class,
  reask.label as reask_label,
  reask.gold_class as reask_gold_class,
  compose.label as compose_label,
  knowledge.label as knowledge_label
from public.ask_reading_folios f
join public.users u on u.user_id = f.user_id
left join lateral (
  select l.label, l.gold_class
    from public.ask_folio_labels l
   where l.folio_id = f.id and l.restaurant_id = f.restaurant_id and l.step = 'pick' and l.basis = 'person'
   order by l.at desc, l.id desc
   limit 1
) pick on true
left join lateral (
  select l.label, l.gold_class
    from public.ask_folio_labels l
   where l.folio_id = f.id and l.restaurant_id = f.restaurant_id and l.step = 'pick' and l.basis = 're_ask'
   order by l.at desc, l.id desc
   limit 1
) reask on true
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
where f.status <> 'pending'
  and not exists (
    select 1 from public.ask_training_opt_outs o
     where o.restaurant_id = f.restaurant_id and o.opted_out
  );

revoke all on public.ask_folio_training_export from public, anon, authenticated;
grant select on public.ask_folio_training_export to service_role;
comment on view public.ask_folio_training_export is
  'ADR 0145 (2026-09-21, founder: "Same as the wine pool (Recommended)", "Two labels (Recommended)"): the erasure-safe export of asks, keyed by folio id. Leaves out every opted-out house (ask_training_opt_outs) and carries no free text, because nothing yet removes names. Read by nothing: no training is built, and none may run before a lawyer (KVKK/GDPR) is asked.';

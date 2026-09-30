-- ADR 0145, round 6z (answered 2026-09-22, built 2026-09-28). Founder's pick,
-- verbatim: "Leave it out (Recommended)". What the pick means, in the brief's
-- words (not his): feedback labels (thumbs up/down) record the house's
-- training choice at the moment THEY are given, not at the moment the
-- question they label was asked, and the export leaves out any label given
-- while opted out -- even one on a question that was itself asked while
-- opted in.
--
-- Carried from the preserved snapshot 2f9a1e0d3 (branch r5/KL, where it was
-- 20260922023000). Renumbered to 20261203100000, past every version on every
-- origin ref (ceiling 20261201120000 on 2026-09-28), and its header rewritten:
-- the snapshot said no production row could exist; that is no longer true.
-- /ask is live (#475, ASK_LAUNCHED set on Railway by the founder, ADR 0145
-- round 5), so production may already hold person labels. See the backfill.
--
-- The gap this closes: 20260922220600 snapshots a QUESTION's opt-out state at
-- ask time (asked_while_opted_out) and the export already honours it. It says
-- nothing about a LABEL given later, by a person, on a step of that question
-- (POST /ask/folios/:id/feedback -- basis = 'person'). A question asked while
-- opted in, then labelled while the house is opted out, then opted back in:
-- the question's own snapshot is false, so nothing stopped that label from
-- reaching the export. Recorded, not decided, by the KL5 last-call report
-- (ADR 0145's round-6y amendment, "Not built, not verified").
--
-- The fix, modelled on asked_while_opted_out (20260922220600), itself
-- modelled on asked_as_role (20260922220400): a new column on
-- ask_folio_labels snapshots the house's opt-out answer AT INSERT, derived by
-- the database from ask_training_opt_outs -- never sent by a client. No
-- written-once trigger: ask_folio_labels has no UPDATE code path (a relabel
-- inserts a new row; ReadingFolioStore.label() only ever .insert()s,
-- ask-readings/reading-folio.store.ts), so a trigger guarding an update
-- nothing performs would guard nothing real.
--
-- The export's three PERSON-basis label columns (pick_label when
-- basis = 'person', compose_label, knowledge_label -- compose and knowledge
-- steps are person-basis by construction: ask_folio_labels_label_by_basis
-- requires basis = 're_ask' to carry step = 'pick') each gain the same
-- filter, so an EARLIER label given while opted in still surfaces if a later
-- one was given opted out. Deliberately NOT reask_label/reask_gold_class:
-- those are a re-ask's DERIVED label (basis = 're_ask'), already gated by
-- 20260922220600's check on the folio that wrote them.
--
-- Two parts, both additive and idempotent:
--   1. ask_folio_labels.given_while_opted_out -- derived at insert,
--      backfilled once for pre-existing rows (see the backfill's comment).
--   2. ask_folio_training_export -- the pick(person)/compose/knowledge
--      lateral joins each gain "and not l.given_while_opted_out".

-- 1. The per-label snapshot ---------------------------------------------------
alter table public.ask_folio_labels
  add column if not exists given_while_opted_out boolean;

-- Backfill, once. A label written before this migration has no insert-time
-- snapshot, and production may hold some (/ask is live). What can be known
-- from ask_training_opt_outs alone: its one row per house carries the
-- CURRENT answer and set_at, when that answer was given.
--   - No row: the house has never answered, so it was opted in (no row = not
--     opted out, the founder's default) when every label was given -> false.
--   - A row set at or before the label: that answer was in force when the
--     label was given -> the row's opted_out.
--   - A row set AFTER the label: what the house had answered before is not
--     in this table -> true, left out. Guessing false here could export a
--     label given while opted out, which is exactly what "Leave it out"
--     forbids; guessing true can only keep an opted-in label out.
-- The switch's full history is in system_audit_log
-- (ask_training_opt_out_changed), but the audit row is written after the
-- upsert and can be missing, so it is not relied on here.
do $$
begin
  if not exists (
    select 1 from pg_trigger
     where tgname = 'ask_folio_labels_opt_out_is_derived'
       and tgrelid = 'public.ask_folio_labels'::regclass
  ) then
    update public.ask_folio_labels l
       set given_while_opted_out = coalesce(
         (select o.opted_out or o.set_at > l.at
            from public.ask_training_opt_outs o where o.restaurant_id = l.restaurant_id),
         false)
     where l.given_while_opted_out is null;
  end if;
end
$$;

alter table public.ask_folio_labels alter column given_while_opted_out set default false;
alter table public.ask_folio_labels alter column given_while_opted_out set not null;

comment on column public.ask_folio_labels.given_while_opted_out is
  'ADR 0145 (2026-09-22, round 6z, founder: "Leave it out (Recommended)"): whether the house had opted its /ask questions out of training AT THE MOMENT this label was given -- independent of whether the QUESTION it labels (ask_reading_folios.asked_while_opted_out) was asked while opted in or out. Derived by a database trigger from ask_training_opt_outs, never sent by a client. No written-once trigger: this table has no UPDATE code path, so nothing can change the value after insert. ask_folio_training_export excludes a label with this set to true from its most-recent-label lookup, even when the question it labels was itself asked while opted in.';

create or replace function public.ask_folio_labels_opt_out_is_derived()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Never a client's word: the snapshot is what the house's opt-out table
  -- says right now, read inside this same insert -- true for a label a
  -- person gives through the feedback endpoint AND for the label a re-ask
  -- derives (ask_reading_folios_reask_labels_the_pick's own insert), though
  -- only the person-basis columns are filtered by it in the export today
  -- (see the view comment below).
  new.given_while_opted_out := coalesce(
    (select o.opted_out from public.ask_training_opt_outs o where o.restaurant_id = new.restaurant_id),
    false);
  return new;
end
$$;
revoke all on function public.ask_folio_labels_opt_out_is_derived() from public, anon, authenticated;

drop trigger if exists ask_folio_labels_opt_out_is_derived on public.ask_folio_labels;
create trigger ask_folio_labels_opt_out_is_derived
  before insert on public.ask_folio_labels
  for each row execute function public.ask_folio_labels_opt_out_is_derived();

-- 2. The export -----------------------------------------------------------------
-- Replaced, not amended: same columns and clauses as 20260922220600, three
-- lateral joins each gain one more filter. The re-ask lateral (reask_label /
-- reask_gold_class) and its existing check on the folio that wrote the label
-- are untouched -- that gap was already closed by 20260922220600 and is not
-- what this round's founder answer is about (see the file header above).
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
  case when f.reask_kind is not null and exists (
         select 1 from public.ask_reading_folios p
          where p.id = f.previous_folio_id and p.restaurant_id = f.restaurant_id
            and not p.asked_while_opted_out)
       then f.reask_kind end as reask_kind,
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
     and not l.given_while_opted_out
   order by l.at desc, l.id desc
   limit 1
) pick on true
left join lateral (
  select l.label, l.gold_class
    from public.ask_folio_labels l
   where l.folio_id = f.id and l.restaurant_id = f.restaurant_id and l.step = 'pick' and l.basis = 're_ask'
     and exists (
       select 1 from public.ask_reading_folios n
        where n.id = l.from_folio_id and n.restaurant_id = l.restaurant_id
          and not n.asked_while_opted_out)
   order by l.at desc, l.id desc
   limit 1
) reask on true
left join lateral (
  select l.label
    from public.ask_folio_labels l
   where l.folio_id = f.id and l.restaurant_id = f.restaurant_id and l.step = 'compose'
     and not l.given_while_opted_out
   order by l.at desc, l.id desc
   limit 1
) compose on true
left join lateral (
  select l.label
    from public.ask_folio_labels l
   where l.folio_id = f.id and l.restaurant_id = f.restaurant_id and l.step = 'knowledge'
     and not l.given_while_opted_out
   order by l.at desc, l.id desc
   limit 1
) knowledge on true
where f.status <> 'pending'
  and not f.asked_while_opted_out
  and not exists (
    select 1 from public.ask_training_opt_outs o
     where o.restaurant_id = f.restaurant_id and o.opted_out
  );

revoke all on public.ask_folio_training_export from public, anon, authenticated;
grant select on public.ask_folio_training_export to service_role;
comment on view public.ask_folio_training_export is
  'ADR 0145 (2026-09-21 "Same as the wine pool", 2026-09-22 "Never", 2026-09-22 round 6z "Leave it out"): the erasure-safe export of asks, keyed by folio id. Excludes a folio when the house is opted out right now, OR when the house was opted out at the moment that folio was asked (asked_while_opted_out); a re-ask label or reask_kind appears only when the other folio it comes from was asked while opted in; a PERSON-given label (pick when basis = person, compose, knowledge) appears only when THAT LABEL was itself given while the house was opted in, independent of the question''s own snapshot. Carries no free text, because nothing yet removes names. Read by nothing: no training is built, and none may run before a lawyer (KVKK/GDPR) is asked.';

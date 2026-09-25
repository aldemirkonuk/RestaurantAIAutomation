-- ADR 0145, 2026-09-22, round 6y. Founder's pick, verbatim: "Never
-- (Recommended)". What the pick means, in the brief's words (not his): each
-- ask folio records the house's training choice at the moment of asking,
-- like asked_as_role; the export leaves out anything asked while opted out,
-- even after opting back in.
--
-- The gap this closes: 20260922220500's export excluded an opted-out house
-- at READ time only (`not exists (... where opted_out)`). An owner who
-- turned training off, then back on, put every question asked in between
-- back into the export, because the view re-checks the house's CURRENT
-- answer on every read and nothing recorded what it was when each folio was
-- created. Recorded, not decided, in that migration's own amendment
-- ("Not built, not verified (round 6r)") and put to the founder by the KL4b
-- last-call report.
--
-- The fix, modelled line for line on `asked_as_role` (20260922220400): a
-- new column snapshots the house's opt-out answer AT INSERT, derived by the
-- database from `ask_training_opt_outs` -- never sent by a client, so a
-- folio cannot forge its way back into training by lying about when it was
-- asked -- and frozen by the existing written-once trigger. The export gains
-- a second, independent filter on that snapshot: a folio asked while opted
-- out is excluded forever, on top of (not instead of) the existing
-- current-state check, which still excludes every folio -- snapshot or not
-- -- while the house is opted out right now. Together: opted out now hides
-- everything; asked-while-opted-out hides that folio even after opting back
-- in.
--
-- Two parts, both additive and idempotent:
--   1. ask_reading_folios.asked_while_opted_out -- derived at insert,
--      written once, backfilled for existing rows from the house's current
--      answer.
--   2. ask_folio_training_export -- three new clauses. One leaves out a folio
--      asked while opted out. Two more stop a re-ask from carrying one
--      folio's content onto ANOTHER folio's export row (KL5 last call,
--      2026-09-22): the re-ask trigger writes a correction/follow_up label on
--      the EARLIER folio from the LATER question, and the later folio's own
--      reask_kind is derived from the earlier folio's pick. So a label is
--      exported only when the re-ask that wrote it was asked while opted in,
--      and a reask_kind only when the folio it compares against was.

-- 1. The per-folio snapshot -------------------------------------------------
alter table public.ask_reading_folios
  add column if not exists asked_while_opted_out boolean;

-- Backfill, once: a row written before this migration has no ask-time
-- snapshot, so it takes the house's CURRENT opt-out state. That matches what
-- the old export view showed for these rows at this moment (it filtered on
-- current state too). It is not a reconstruction: the history of the switch
-- sits in system_audit_log (ask_training_opt_out_changed), and a row asked
-- during an earlier opt-out in a house that has since opted back in is
-- backfilled false. No such row can exist in production: ask_reading_folios
-- (20260922220000) is not on main and ships in the same PR as this file, and
-- ASK_LAUNCHED is unset, so production runs this update on zero rows. It
-- exists for a branch or local database that already ran the earlier files.
do $$
begin
  if not exists (
    select 1 from pg_trigger
     where tgname = 'ask_reading_folios_opt_out_is_derived'
       and tgrelid = 'public.ask_reading_folios'::regclass
  ) then
    update public.ask_reading_folios f
       set asked_while_opted_out = coalesce(
         (select o.opted_out from public.ask_training_opt_outs o where o.restaurant_id = f.restaurant_id),
         false)
     where f.asked_while_opted_out is null;
  end if;
end
$$;

alter table public.ask_reading_folios alter column asked_while_opted_out set default false;
alter table public.ask_reading_folios alter column asked_while_opted_out set not null;

comment on column public.ask_reading_folios.asked_while_opted_out is
  'ADR 0145 (2026-09-22, founder: "Never (Recommended)"): whether the house had opted its /ask questions out of training AT THE MOMENT this folio was created. Derived by a database trigger from ask_training_opt_outs, never sent by a client, and frozen by the existing written-once trigger (20260922220400) -- a snapshot exactly like asked_as_role. ask_folio_training_export excludes a folio with this set to true FOREVER, even after the house opts back in, because opting back in changes the house''s CURRENT answer, never the answer it gave when this question was asked.';

create or replace function public.ask_reading_folios_opt_out_is_derived()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Never a client's word: the snapshot is what the house's opt-out table
  -- says right now, read inside this same insert.
  new.asked_while_opted_out := coalesce(
    (select o.opted_out from public.ask_training_opt_outs o where o.restaurant_id = new.restaurant_id),
    false);
  return new;
end
$$;
revoke all on function public.ask_reading_folios_opt_out_is_derived() from public, anon, authenticated;

drop trigger if exists ask_reading_folios_opt_out_is_derived on public.ask_reading_folios;
create trigger ask_reading_folios_opt_out_is_derived
  before insert on public.ask_reading_folios
  for each row execute function public.ask_reading_folios_opt_out_is_derived();

-- Written once: asked_while_opted_out joins the ask-time snapshot half
-- (20260922220400, extended by 20260922220500 with reask_kind).
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
     or new.reask_kind is distinct from old.reask_kind
     or new.asked_while_opted_out is distinct from old.asked_while_opted_out then
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

-- 2. The export ---------------------------------------------------------------
-- Replaced, not amended: same columns as 20260922220500, three more clauses.
-- Both row checks stay: the current-state check (unchanged) still hides every
-- folio of a house that is opted out RIGHT NOW, snapshot or not; the new
-- snapshot check hides a folio asked while opted out even once the house's
-- current answer has moved on. The re-ask label and reask_kind each carry
-- ANOTHER folio's content, so each is exported only when that other folio
-- exists and was asked while opted in (a deleted one fails closed).
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
  and not f.asked_while_opted_out
  and not exists (
    select 1 from public.ask_training_opt_outs o
     where o.restaurant_id = f.restaurant_id and o.opted_out
  );

revoke all on public.ask_folio_training_export from public, anon, authenticated;
grant select on public.ask_folio_training_export to service_role;
comment on view public.ask_folio_training_export is
  'ADR 0145 (2026-09-21 "Same as the wine pool", 2026-09-22 "Never"): the erasure-safe export of asks, keyed by folio id. Excludes a folio when the house is opted out right now, OR when the house was opted out at the moment that folio was asked (asked_while_opted_out) -- so opting back in never releases a question asked while opted out; a re-ask label or reask_kind appears only when the other folio it comes from was asked while opted in. Carries no free text, because nothing yet removes names. Read by nothing: no training is built, and none may run before a lawyer (KVKK/GDPR) is asked.';

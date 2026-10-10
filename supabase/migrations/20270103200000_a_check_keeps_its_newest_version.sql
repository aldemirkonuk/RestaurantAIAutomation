-- A CHECK KEEPS ITS NEWEST VERSION, AND A HOUSE CAN UNPLUG ITS TILL.
-- Sim wave 21, F-639 and F-643.
--
-- WHAT BROKE (F-639). The hub upserted the whole pos_checks row on
-- (restaurant_id, source, external_check_id) with nothing to say which copy
-- of a check was newer. A till's late retry of the "closed" event, landing
-- after the "voided" one, wrote voided = false and the voided check counted
-- as takings again (dashboard readMonthTakings filters voided = false). An
-- "open" event landing after the "closed" one wrote closed_at = null and the
-- check read as a live table again.
--
-- THE FIX. Two columns say which copy the till sent, and a BEFORE UPDATE
-- trigger keeps the stored copy when the incoming one is older or would undo
-- a void or a close without being newer:
--   source_version      the till's own version number (Square order.version,
--                       or the canonical `version`), when it sends one.
--   source_modified_at  when the till last changed the check (Toast
--                       modifiedDate, Square updated_at, Clover modifiedTime,
--                       or the canonical `modifiedAt`), when it sends one.
-- "Newer" is decided by version when both copies carry one, else by
-- modified-at when both carry one, else it is not known. The trigger returns
-- NULL (the update is skipped, the row stays as it was) when the incoming copy
-- is older, or is not known to be newer and would turn voided from true to
-- false or closed_at from set to null. The gateway reads the stored copy
-- first and moves no stock for such a copy; this trigger is the same rule at
-- the row, so two deliveries racing each other cannot undo it either.
--
-- NO BACKFILL. Existing rows carry neither column; a copy without either is
-- judged only by the void/close rule above, which is what an existing row
-- needs.
--
-- WHAT BROKE (F-643). Nothing the ingest path reads says a house stopped
-- using a till. Settings > POS "Connector" is a bookmark, and the only way to
-- stop a feed was an operator removing an environment secret.
--
-- THE TABLE. pos_connections holds one row per (house, provider) the owner
-- switched. No row means the feed is accepted, as today; enabled = false
-- means the ingest refuses that provider for that house (the gateway answers
-- 409). Written only by the gateway (service role), from an owner-only route.

alter table public.pos_checks
  add column if not exists source_version bigint,
  add column if not exists source_modified_at timestamp with time zone;

comment on column public.pos_checks.source_version is
  'F-639: the till''s own version number for this check, when it sends one. '
  'An update carrying a lower version than the stored one is skipped '
  '(trigger pos_checks_keep_newest).';
comment on column public.pos_checks.source_modified_at is
  'F-639: when the till last changed this check, when it says. Compared only '
  'when both copies carry no version; an older copy is skipped (trigger '
  'pos_checks_keep_newest).';

create or replace function public.pos_checks_keep_newest()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_newer boolean;  -- null = not known
begin
  if new.source_version is not null and old.source_version is not null then
    if new.source_version < old.source_version then return null; end if;
    v_newer := new.source_version > old.source_version;
  elsif new.source_modified_at is not null and old.source_modified_at is not null then
    if new.source_modified_at < old.source_modified_at then return null; end if;
    v_newer := new.source_modified_at > old.source_modified_at;
  end if;

  if v_newer is not true then
    if old.voided and not coalesce(new.voided, false) then return null; end if;
    if old.closed_at is not null and new.closed_at is null then return null; end if;
  end if;

  -- A copy that names no version or modified-at keeps the stored ones, so the
  -- next copy is still compared against the newest the till has said.
  new.source_version := coalesce(new.source_version, old.source_version);
  new.source_modified_at := coalesce(new.source_modified_at, old.source_modified_at);
  return new;
end
$$;

comment on function public.pos_checks_keep_newest() is
  'BEFORE UPDATE trigger on pos_checks (F-639): skips an update whose copy of '
  'the check is older than the stored one (by source_version, else '
  'source_modified_at), or is not known to be newer and would un-void or '
  're-open the check.';

drop trigger if exists pos_checks_keep_newest on public.pos_checks;
create trigger pos_checks_keep_newest
  before update on public.pos_checks
  for each row
  execute function public.pos_checks_keep_newest();

create table if not exists public.pos_connections (
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  provider      text not null,
  enabled       boolean not null,
  changed_at    timestamp with time zone not null default now(),
  changed_by    uuid,
  constraint pos_connections_pkey primary key (restaurant_id, provider)
);

comment on table public.pos_connections is
  'F-643: whether a house takes a POS provider''s feed. No row = accepted (as '
  'before this table); enabled = false = the ingest refuses that provider for '
  'that house. Written by the gateway from an owner-only route.';

alter table public.pos_connections enable row level security;
revoke all on table public.pos_connections from public, anon, authenticated;

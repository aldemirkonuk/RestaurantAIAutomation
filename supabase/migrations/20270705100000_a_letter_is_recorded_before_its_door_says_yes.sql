-- A letter is recorded before its door says yes (mail software, gap G2).
--
-- Every inbound door (the shared mailbox's Gmail push and its poll, a house's
-- own mailbox reader, the house's Mudavym address webhook) used to hand a
-- letter straight to RabbitMQ and then say "done": advance the Gmail
-- historyId, answer the webhook 200, move the house reader's cursor. The
-- bridge then acked the message before its async handler settled, on a queue
-- with a 5-minute TTL and a 1000-message cap, and a failed insert was only
-- logged. A letter could be lost at four places and nobody would know.
--
-- From here a door first writes the letter into `mail_intake` (one row per
-- door and provider id, so a repeat delivery is one row), and only that write
-- lets the door say yes. The bridge settles the row with what became of the
-- letter (filed, held, prospect, duplicate, not kept) and clears the payload;
-- a row that never settles is published again by the gateway's re-drive tick
-- until it settles or gives up after six tries, and a house can ask for its
-- own held rows to be read again.
--
-- `mail_door_cursors` replaces the Redis key (7-day TTL) that held the shared
-- mailbox's Gmail historyId: a flushed Redis used to make the next push
-- "initialise" and skip everything since. It also records when each door last
-- read and last stored a letter, which is what "is my mail arriving" reads.
--
-- Service role only: no row is readable or writable by `anon` or
-- `authenticated`; the gateway reads per house and says it in words.

create table if not exists public.mail_intake (
  id uuid primary key default gen_random_uuid(),
  door text not null
    check (door in ('shared_mailbox', 'house_mailbox', 'inbound_address')),
  -- The door's own id for the delivery: the Gmail message id, the house
  -- grant plus its Gmail message id, or the inbound provider's message id.
  provider_key text not null,
  restaurant_id uuid null references public.restaurants(id) on delete set null,
  status text not null default 'received'
    check (status in (
      'received',   -- recorded, not yet settled by the bridge
      'filed',      -- stored as a vendor letter
      'held',       -- kept, but not filed under anyone (unread or unconfirmed sender, no house)
      'prospect',   -- kept as a stranger reaching out
      'duplicate',  -- already stored by an earlier delivery
      'not_kept',   -- read and deliberately not kept (unknown sender, not outreach)
      'failed',     -- the bridge tried and could not store it; will be tried again
      'gave_up'     -- six tries failed; kept for a person to read again
    )),
  attempts integer not null default 1,
  last_attempt_at timestamptz not null default now(),
  last_error text null,
  -- The event as published. Cleared when the row settles, so the house's mail
  -- is not kept twice; kept while the letter still needs a home.
  payload jsonb null,
  created_at timestamptz not null default now(),
  settled_at timestamptz null,
  constraint mail_intake_one_row_per_delivery unique (door, provider_key)
);

create index if not exists mail_intake_due_idx
  on public.mail_intake (last_attempt_at)
  where status in ('received', 'failed');

create index if not exists mail_intake_house_idx
  on public.mail_intake (restaurant_id, created_at desc);

alter table public.mail_intake enable row level security;
revoke all on public.mail_intake from anon, authenticated;

create table if not exists public.mail_door_cursors (
  door text primary key,
  cursor text null,
  -- The last read that FINISHED (no error). A resync after Gmail drops the
  -- cursor starts from here, so a read that failed must never move it: the
  -- outage window would fall out of the next resync and be skipped.
  last_read_at timestamptz null,
  last_stored_at timestamptz null,
  last_error text null,
  updated_at timestamptz not null default now()
);

alter table public.mail_door_cursors enable row level security;
revoke all on public.mail_door_cursors from anon, authenticated;

-- Move a door's cursor forward, never back. Two readers (a push and the poll
-- tick) can finish out of order; the slower one must not rewind the cursor
-- and make the faster one's letters be read again forever, nor (worse) the
-- other way round. Gmail historyIds are increasing decimal strings.
--
-- `last_read_at` moves only when the read finished (`p_error` is null). A
-- read that stopped records its error and may still move the cursor past the
-- letters it did record, but it is not a finished read: the resync floor and
-- "when did this door last read" both stay at the last one that was.
create or replace function public.advance_mail_door_cursor(
  p_door text,
  p_cursor text,
  p_stored boolean default false,
  p_error text default null
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cursor text;
begin
  insert into public.mail_door_cursors as c
    (door, cursor, last_read_at, last_stored_at, last_error, updated_at)
  values
    (p_door, p_cursor, case when p_error is null then now() end,
     case when p_stored then now() end, p_error, now())
  on conflict (door) do update set
    cursor = case
      when excluded.cursor is null then c.cursor
      when c.cursor is null then excluded.cursor
      when c.cursor ~ '^[0-9]+$' and excluded.cursor ~ '^[0-9]+$'
        and excluded.cursor::numeric < c.cursor::numeric then c.cursor
      else excluded.cursor
    end,
    last_read_at = case when p_error is null then now() else c.last_read_at end,
    last_stored_at = case when p_stored then now() else c.last_stored_at end,
    last_error = p_error,
    updated_at = now()
  returning cursor into v_cursor;
  return v_cursor;
end;
$$;

-- Claim intake rows that never settled, for the gateway's re-drive tick.
-- SKIP LOCKED so two gateway instances never publish the same row in one
-- pass. A row past its last try becomes `gave_up` and keeps its payload, so a
-- person can still ask for it to be read again.
create or replace function public.claim_mail_intake(
  p_limit integer default 50,
  p_stale_seconds integer default 600,
  p_max_attempts integer default 6
) returns setof public.mail_intake
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.mail_intake m
     set status = 'gave_up', settled_at = now()
   where m.status in ('received', 'failed')
     and m.attempts >= p_max_attempts
     and m.last_attempt_at < now() - make_interval(secs => p_stale_seconds);

  return query
  with due as (
    select m.id
      from public.mail_intake m
     where m.status in ('received', 'failed')
       and m.attempts < p_max_attempts
       and m.payload is not null
       and m.last_attempt_at < now() - make_interval(secs => p_stale_seconds)
     order by m.last_attempt_at
     limit greatest(1, least(coalesce(p_limit, 50), 200))
     for update skip locked
  )
  update public.mail_intake m
     set attempts = m.attempts + 1,
         last_attempt_at = now()
    from due
   where m.id = due.id
  returning m.*;
end;
$$;

revoke all on function public.advance_mail_door_cursor(text, text, boolean, text) from public, anon, authenticated;
revoke all on function public.claim_mail_intake(integer, integer, integer) from public, anon, authenticated;
grant execute on function public.advance_mail_door_cursor(text, text, boolean, text) to service_role;
grant execute on function public.claim_mail_intake(integer, integer, integer) to service_role;

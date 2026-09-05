-- A house may REQUEST a scenario, in words. It may not author one (ADR 0120 Q4).
--
-- THE FOUNDER'S CALL, 2026-09-05 (batch 52): "Not yet; request a scenario
-- instead." The open question was whether a house may add its own row to the
-- book of goal scenarios. The answer is no, and the reason the request exists
-- at all is that "no" on its own loses the information: a manager who wants to
-- hold their room to something this product cannot hold is telling Mudavym
-- exactly which gap to fund next, and today that sentence has nowhere to go.
--
-- WHAT THIS IS NOT
-- ----------------
-- It is NOT a scenario. `analytics/goal-scenarios.ts` stays the one truth: 21
-- rows, each carrying the metric key the goals module serves (or `null` plus
-- the measure it would need), the cutting that draws it, the rules that move
-- it, and a RANGE quoted in an operator source's own words with that source's
-- URL and date. A tenant-authored row could carry none of that -- it cannot
-- invent a metric key, and a range it typed itself would be a number with no
-- source sitting where a sourced one belongs. The catalogue's whole defence is
-- that every figure on it can be checked; a table that could add to it would
-- remove that defence one row at a time.
--
-- So this table holds WORDS. Nothing reads it into the book, no join makes it a
-- scenario, and the gateway route that returns the book does not touch it.
--
-- WHAT A ROW IS
-- -------------
-- Four facts and no state: who asked, when, in what words, and for which house.
--
-- There is deliberately NO status column ('new' / 'seen' / 'funded'). Nothing
-- in this build would ever write one, and a status nobody updates is the
-- repo's standing fault in miniature -- every row would read 'new' forever,
-- which is indistinguishable from a queue nobody has looked at. When a request
-- is answered, the answer is an ADR and a funded metric, and the catalogue
-- itself is where that becomes visible.
--
-- WHY requested_by IS NOT NULL AND RESTRICTS
-- ------------------------------------------
-- The repo's convention for an actor column is `on delete set null`, and it is
-- right where the row is a RECORD OF AN ACT (a count, a verification): the act
-- happened whether or not the actor still exists. This row is different -- it
-- is a PERSON'S WORDS, addressed to Mudavym, and "who asked" is half of what
-- the founder reads. A NULL there would render as "nobody asked", which is the
-- absence-reported-as-health shape this project keeps paying for. So the
-- author is required and the row refuses to outlive them silently.
--
-- The cost, stated: deleting a user who has an outstanding request is REFUSED
-- (23503) until the request is dealt with. Nothing in the gateway or the
-- orchestrator deletes a `public.users` row today (grepped 2026-09-05), so this
-- blocks no existing path; if erasure is ever built, the requests are rows it
-- must handle rather than rows it may silently blank.
--
-- `public.users(user_id)` -- NOT `auth.users(id)`. The two tables share zero
-- ids in this project, and the JWT carries `public.users.user_id`, so an actor
-- FK to `auth.users` 23503s on every write and no CI check can catch it (a
-- fresh database has no rows to violate).
--
-- Additive. No explicit BEGIN/COMMIT: the Supabase CLI wraps each migration
-- file in a transaction.

create table if not exists public.goal_scenario_request (
  id             uuid primary key default gen_random_uuid(),

  -- The house whose manager asked. Cascades: if the restaurant is deleted the
  -- request is not actionable by anyone, and keeping an orphan would mean the
  -- founder's read has to render a request for a house that no longer exists.
  restaurant_id  uuid not null
                 references public.restaurants(id) on delete cascade,

  -- The person. Required, and restricting -- see the header.
  requested_by   uuid not null
                 references public.users(user_id) on delete restrict,

  -- The request itself. Bounded so a paste cannot become a row nobody can
  -- read, and trimmed-empty is refused: an empty request is not a request, and
  -- a blank row in the founder's list is worse than no row.
  words          text not null
                 check (btrim(words) <> '' and length(words) <= 2000),

  requested_at   timestamptz not null default now()
);

comment on table public.goal_scenario_request is
  'What a house asked to be able to hold itself to, in its own words (ADR 0120 '
  'Q4, founder 2026-09-05: "Not yet; request a scenario instead"). NOT a '
  'scenario and never read into one: analytics/goal-scenarios.ts stays the one '
  'catalogue, because every row there carries an operator source a reader can '
  'check and a tenant-authored row could not. Four facts, no status column -- a '
  'state nothing updates would read as a queue nobody looked at.';
comment on column public.goal_scenario_request.requested_by is
  'The person who asked, from public.users(user_id) -- NOT auth.users(id), '
  'which shares zero ids with the table the JWT carries. NOT NULL and ON DELETE '
  'RESTRICT rather than the usual SET NULL: this row is a person''s words, not '
  'a record of an act, and a null author would render as "nobody asked".';
comment on column public.goal_scenario_request.words is
  'The request as typed. Never parsed, never matched to a metric key, never '
  'shown to a model -- it is read by a person at Mudavym.';

-- The founder's read is "newest first, across every house".
create index if not exists idx_goal_scenario_request_recent
  on public.goal_scenario_request (requested_at desc);

-- A house's own list, for the day the page shows one back.
create index if not exists idx_goal_scenario_request_house
  on public.goal_scenario_request (restaurant_id, requested_at desc);

-- ---------------------------------------------------------------------------
-- Locked down in the SAME migration that creates it (OD-72 / OD-73 house rule).
-- ---------------------------------------------------------------------------
alter table public.goal_scenario_request enable row level security;

drop policy if exists goal_scenario_request_service_role
  on public.goal_scenario_request;
create policy goal_scenario_request_service_role
  on public.goal_scenario_request
  for all to service_role using (true) with check (true);

-- No `authenticated` policy. The browser reaches this only through the gateway:
-- the write is scoped to the restaurant on the token and names the actor from
-- the token, and the read is the founder's alone (X-Admin-Key / ServiceKeyGuard,
-- ADR 0099). The REVOKE is belt as well as braces -- OD-72's default-privileges
-- ratchet runs as `postgres` and cannot reach `supabase_admin`'s defaults, which
-- OD-94 records as ordering luck rather than a control.
revoke all on public.goal_scenario_request from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Assert the outcome rather than report success.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  rls     boolean;
  grants  int;
  parent  text;
  house   uuid;
  person  uuid;
  probe   uuid;
  refused boolean;
BEGIN
  IF to_regclass('public.goal_scenario_request') IS NULL THEN
    RAISE EXCEPTION 'goal_scenario_request was not created';
  END IF;

  SELECT relrowsecurity INTO rls
    FROM pg_class WHERE oid = to_regclass('public.goal_scenario_request');
  IF NOT rls THEN
    RAISE EXCEPTION 'goal_scenario_request has row level security OFF';
  END IF;

  SELECT count(*) INTO grants
    FROM information_schema.role_table_grants
   WHERE table_schema = 'public'
     AND table_name = 'goal_scenario_request'
     AND grantee IN ('anon', 'authenticated');
  IF grants > 0 THEN
    RAISE EXCEPTION
      'goal_scenario_request still holds % client grant(s) for anon/authenticated',
      grants;
  END IF;

  -- The actor's parent, named explicitly: an actor-shaped uuid column in this
  -- codebase has twice been pointed at auth.users, which shares zero ids with
  -- the table the JWT carries, and every write then 23503s in production while
  -- CI stays green because a fresh database has no rows to violate.
  SELECT confrelid::regclass::text INTO parent
    FROM pg_constraint
   WHERE conrelid = to_regclass('public.goal_scenario_request')
     AND contype = 'f'
     AND pg_get_constraintdef(oid) ILIKE '%(requested_by)%';
  IF parent IS NULL THEN
    RAISE EXCEPTION 'goal_scenario_request.requested_by has no parent key';
  END IF;
  IF parent <> 'users' AND parent <> 'public.users' THEN
    RAISE EXCEPTION
      'goal_scenario_request.requested_by points at %, not public.users', parent;
  END IF;

  IF (SELECT is_nullable FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'goal_scenario_request'
         AND column_name = 'requested_by') <> 'NO' THEN
    RAISE EXCEPTION
      'goal_scenario_request.requested_by is nullable -- a null author renders as "nobody asked"';
  END IF;

  -- PROVE the two rules on probes, then remove them. A constraint nobody
  -- exercised is a constraint nobody has.
  SELECT id INTO house FROM public.restaurants LIMIT 1;
  SELECT user_id INTO person FROM public.users LIMIT 1;

  IF house IS NOT NULL AND person IS NOT NULL THEN
    INSERT INTO public.goal_scenario_request (restaurant_id, requested_by, words)
    VALUES (house, person, 'probe: we want to hold our pour cost under something')
    RETURNING id INTO probe;

    IF (SELECT requested_at FROM public.goal_scenario_request WHERE id = probe) IS NULL THEN
      RAISE EXCEPTION 'a request was stored with no time on it';
    END IF;

    refused := false;
    BEGIN
      INSERT INTO public.goal_scenario_request (restaurant_id, requested_by, words)
      VALUES (house, person, '    ');
    EXCEPTION WHEN check_violation THEN
      refused := true;
    END;
    IF NOT refused THEN
      RAISE EXCEPTION 'a request of nothing but whitespace was accepted';
    END IF;

    refused := false;
    BEGIN
      INSERT INTO public.goal_scenario_request (restaurant_id, requested_by, words)
      VALUES (house, person, repeat('x', 2001));
    EXCEPTION WHEN check_violation THEN
      refused := true;
    END;
    IF NOT refused THEN
      RAISE EXCEPTION 'a 2001-character request was accepted';
    END IF;

    DELETE FROM public.goal_scenario_request WHERE id = probe;
  END IF;

  RAISE NOTICE 'a house may request a scenario in words: goal_scenario_request exists, RLS on, no client grants, author required and pointed at public.users, empty and oversized requests refused; % row(s) present.',
    (SELECT count(*) FROM public.goal_scenario_request);
END
$$;

-- restaurant_cellar_registers — which registers this house actually carries.
--
-- WHY THIS TABLE EXISTS
-- ---------------------
-- The cellar surface (/cellar and its children) shipped with four registers
-- hard-coded into the client: Wines, Beer, Whiskey, Cocktails, drawn for every
-- tenant identically. The founder's review of 2026-09-03 named the fault:
--
--     "each restaurant will be different — maybe it's a non-alcoholic
--      restaurant with only soft drinks — so we adapt to that."
--
-- A fixed four-register cellar makes two false statements at once to a house
-- that carries none of them: it asserts the house HAS a whiskey programme,
-- and (once the register is empty) it asserts that programme is EMPTY. That is
-- the `absence-reported-as-health` shape with the sign flipped — presence
-- reported where there is none — and no amount of em dashes on the child page
-- repairs a parent that should not have drawn the card at all.
--
-- THE DECISION THIS TABLE IMPLEMENTS (founder, 2026-09-03)
-- -------------------------------------------------------
-- **Infer, then confirm at onboarding**, with a manual override afterwards.
-- Three acts produce a row, and `source` keeps them apart forever:
--
--   inferred  — the machine's proposal, recorded so the page is stable across
--               sessions. `confirmed_at IS NULL`. Nobody has agreed with it.
--   confirmed — a human accepted or edited the proposal at onboarding.
--   manual    — a human switched the register on or off later, from Settings.
--
-- `source = 'inferred'` with a null `confirmed_at` is the one row shape that
-- says "this is a guess we wrote down", and the read model renders it as a
-- guess. Collapsing it into the other two is the whole failure this column
-- exists to prevent: a proposal that becomes indistinguishable from an answer
-- one week later is worse than no proposal.
--
-- THE CHANGE-OVER-TIME CASE, which the founder raised in the same breath: a
-- house may start carrying whiskey next month, and there will be no menu row
-- and no inventory row to sense it with. So `manual` is a first-class source,
-- not a repair — a register switched on manually is ON, and the surface asks
-- the house to add the menu or the inventory items so the books can see the
-- change too. `evidence` below records that the inference disagreed at the
-- moment of the switch, which is exactly the pair a later audit needs.
--
-- THE REGISTER VOCABULARY
-- -----------------------
-- The seven names are the founder's own list. Two of them overlap deliberately
-- and the overlap is recorded rather than resolved:
--
--   * `whiskey` is a subset of `spirits`. The founder names both because a
--     whiskey bar is a different house from a cocktail bar that stocks bourbon.
--     `master_wine_library.beverage_kind` cannot separate them (it emits
--     `spirit`), so whiskey is only ever inferred from a NAME or a menu
--     section, at lower confidence, and the read model says so.
--   * `soft_drinks` is a subset of `non_alcoholic`. A house may carry coffee
--     and tea and no sodas at all.
--
-- Neither is normalised away: a house that says "we carry whiskey" and "we
-- carry spirits" is stating two true things.

create table if not exists public.restaurant_cellar_registers (
  restaurant_id  uuid not null
                 references public.restaurants(id) on delete cascade,

  register       text not null check (register in (
                   'wines', 'beer', 'whiskey', 'cocktails',
                   'spirits', 'non_alcoholic', 'soft_drinks'
                 )),

  -- The answer. `false` is a real answer — "we do not carry beer" — and is NOT
  -- the same as having no row (nobody has been asked, nothing was inferred).
  -- The read model keeps those apart end to end; a NOT NULL boolean plus the
  -- absence of a row is the only shape that can.
  carried        boolean not null,

  source         text not null check (source in ('inferred', 'confirmed', 'manual')),

  -- Set exactly when a human agreed. NULL is the load-bearing state: it is the
  -- difference between a proposal and an answer, and every surface that reads
  -- this table renders that difference.
  confirmed_at   timestamptz,

  -- public.users(user_id). NOT auth.users: the two tables share ZERO ids in
  -- this database and the JWT carries public.users.user_id, so an actor FK to
  -- auth.users 23503s on every write and CI cannot catch it (a fresh database
  -- has no rows to violate). See the project memory
  -- `auth-users-and-public-users-are-disjoint`.
  --
  -- ON DELETE SET NULL, not CASCADE: removing a person must not silently
  -- delete the house's answer about what it sells.
  confirmed_by   uuid references public.users(user_id) on delete set null,

  -- What the inference said at the instant this row was written. Shape:
  --   { "carried": bool, "confidence": "certain|likely|none|unknown",
  --     "inventoryRows": int|null, "menuRows": int|null, "at": timestamptz }
  -- The only way "was the machine right?" stays answerable — the same posture
  -- photo_count_suggestions (20260827100000) takes for the machine's count.
  evidence       jsonb,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  primary key (restaurant_id, register),

  -- A confirmation must carry its timestamp, and a proposal must not pretend to
  -- one. Enforced here rather than in the writer because a read model that has
  -- to defend against `source='confirmed', confirmed_at IS NULL` cannot say
  -- anything reliable about either column.
  constraint restaurant_cellar_registers_confirmed_has_a_time check (
    (source = 'inferred' and confirmed_at is null)
    or (source in ('confirmed', 'manual') and confirmed_at is not null)
  )
);

comment on table public.restaurant_cellar_registers is
  'Which cellar registers a house carries. Founder decision 2026-09-03: infer, '
  'then confirm at onboarding, with a manual switch afterwards for a category '
  'the books cannot yet see. No row = never inferred and never asked, which is '
  'distinct from carried=false.';
comment on column public.restaurant_cellar_registers.carried is
  'A real answer in both directions. Absent row <> false.';
comment on column public.restaurant_cellar_registers.source is
  'inferred: the machine proposed it and nobody has agreed (confirmed_at is '
  'null). confirmed: a human accepted or edited the proposal at onboarding. '
  'manual: a human switched it later, typically for a category with no menu '
  'or inventory rows to sense.';
comment on column public.restaurant_cellar_registers.confirmed_at is
  'Null exactly while the row is still only a proposal. This is the column '
  'that stops a guess from ageing into an answer.';
comment on column public.restaurant_cellar_registers.evidence is
  'What the inference claimed at the moment this row was written, so a manual '
  'override stays auditable against what the books said.';

create index if not exists idx_restaurant_cellar_registers_restaurant
  on public.restaurant_cellar_registers (restaurant_id);

-- updated_at is maintained by the writer (the upsert sets it explicitly). No
-- trigger: this table has exactly one writer, the gateway's
-- CellarRegistersService, and a trigger here would be a second home for it.

alter table public.restaurant_cellar_registers enable row level security;

drop policy if exists restaurant_cellar_registers_service_role
  on public.restaurant_cellar_registers;
create policy restaurant_cellar_registers_service_role
  on public.restaurant_cellar_registers
  for all to service_role using (true) with check (true);

-- No `authenticated` policy. The browser reaches this only through the
-- gateway, which is the posture ADR 0012 settled for generated_reports and
-- 20260827140000 restated for ai_proposed_actions. A direct client read is a
-- decision with an ADR and a restaurant-isolation policy, never a bare
-- `using (true)`.
--
-- No REVOKE: OD-72's `alter default privileges` ratchet
-- (20260825210000:183) means anything created after it arrives with no client
-- grants already.

-- restaurant_cellar_settings — two per-house choices the cellar page now asks
-- for, added by the sketch-110 build (ADR 0160 §110, items 2 and 6).
--
-- WHY ONE TABLE FOR TWO UNRELATED CHOICES
-- ----------------------------------------
-- Both are small, both are set from the same Settings screen
-- (`pages/settings/next/CellarSection.tsx`), both are read by the same page on
-- every load, and neither has enough shape to earn its own table the way
-- `restaurant_cellar_registers` did (that one holds a ROW PER REGISTER with an
-- evidence trail; these are each a single scalar/array per restaurant). A
-- second near-empty table per setting is the same "structures only ratcheted
-- upward" failure CLAUDE.md §4 names for docs, applied to schema.
--
-- 1. HOLD CEREMONY (ADR 0160 §110 item 6). CORRECTED 2026-09-19 (cellar
--    re-verification, blocking) — this table originally shipped a THREE-value
--    CHECK ('hold'/'confirm'/'auto') built from the founder's PRE-correction
--    dictation, which ADR 0160 itself flags as wrong ("correction 9: the
--    original line gave three modes ... his words give two"). His answer once
--    the open question on "auto" was asked settles TWO ceremonies, and the
--    hold is the one deliberate act in BOTH of them — neither ever sends on a
--    bare click with no physical gesture, which is the exact design his
--    correction rules out ("an order with no human hold at all, which would
--    bypass ADR 0112's seal on a money act"):
--      hold — DEFAULT. The press-and-hold gesture (HoldToApprove), then one
--             more "are you sure?" question before the write fires.
--      auto — the SAME press-and-hold gesture, but the write fires the
--             instant the hold completes — no follow-up question.
--    Defaulting to 'hold' is the founder's own instruction ("default to the
--    hold"), not a guess — a house that never visits this setting gets
--    exactly the ceremony it already had before this migration. This
--    migration had not merged past this lane when the mistake was found, so
--    the CHECK below is corrected in place rather than superseded by a second
--    migration — nothing had applied the three-value constraint anywhere.
--
-- 2. GAZETTEER MEASURES (ADR 0160 §110 item 2). The founder: "these boxes with
--    the analytics should be able to be configured based on customer needs,"
--    over the four tiles in `Registers.tsx` ("In the building tonight").
--    `gazetteer_measures` is the ordered list of tile ids to draw; NULL means
--    "never configured", and the page's default four (`bottles`, `titles`,
--    `par`, `offbook`) apply — so a house that never opens this control sees
--    exactly what it always has. The vocabulary (which ids exist) is owned by
--    the gateway's read model, not by a CHECK constraint here: a fixed list in
--    SQL would need a migration every time a new measure is added, and the
--    page already refuses an id it does not recognise.
--
-- WHY NOT A GENERIC KEY-VALUE SETTINGS TABLE. No `restaurant_settings` table
-- exists in this schema today (measured: zero `CREATE TABLE` hits for one, one
-- session's own search before writing this migration) — feature flags are the
-- nearest thing and are a different mechanism (global default + per-restaurant
-- override rows, `restaurant_feature_flags`), built for booleans read by
-- `useMudavymDesign`, not for an enum plus an ordered array read by one page.
-- Inventing a generic settings table as a side effect of two cellar fields
-- would be the bigger, less reversible change; a small additive table scoped
-- to the page that owns both fields is the one CLAUDE.md §2's low-footprint
-- rule and this page's own lane actually call for.

create table if not exists public.restaurant_cellar_settings (
  restaurant_id      uuid primary key
                      references public.restaurants(id) on delete cascade,

  hold_ceremony       text not null default 'hold'
                       check (hold_ceremony in ('hold', 'auto')),

  -- Ordered tile ids for "In the building tonight". NULL = unconfigured, and
  -- the page's own default four apply. An empty array is a real answer too
  -- ("show none of them") and is kept distinct from NULL for that reason, the
  -- same shape `restaurant_cellar_registers.carried` uses for its boolean.
  gazetteer_measures   jsonb,

  -- public.users(user_id), not auth.users — the two tables share zero ids in
  -- this database (see project memory `auth-users-vs-public-users`), and the
  -- JWT carries public.users.user_id. ON DELETE SET NULL: removing a person
  -- must not delete the house's own settings.
  set_by               uuid references public.users(user_id) on delete set null,
  set_at               timestamptz,

  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

comment on table public.restaurant_cellar_settings is
  'Two per-house cellar choices (ADR 0160 sec110): the order-hold ceremony '
  '(hold/auto, default hold) and which "in the building tonight" '
  'tiles to draw (NULL = the page''s default four). One row per restaurant.';
comment on column public.restaurant_cellar_settings.hold_ceremony is
  'hold: press-and-hold (default), then one "are you sure?" question before '
  'the write fires. auto: the same press-and-hold gesture, but the write '
  'fires the instant the hold completes, no follow-up question. Both modes '
  'require the physical hold; neither sends on a bare click (ADR 0160 sec110 '
  'item 6, corrected).';
comment on column public.restaurant_cellar_settings.gazetteer_measures is
  'Ordered tile ids for the cellar overview''s analytics boxes. NULL = never '
  'configured, page draws its own default four. [] = configured to show none.';

alter table public.restaurant_cellar_settings enable row level security;

drop policy if exists restaurant_cellar_settings_service_role
  on public.restaurant_cellar_settings;
create policy restaurant_cellar_settings_service_role
  on public.restaurant_cellar_settings
  for all to service_role using (true) with check (true);

-- No `authenticated` policy, matching `restaurant_cellar_registers`
-- (20260903092000): the browser reaches this only through the gateway, which
-- checks the caller's restaurant against the JWT before either handler runs
-- (`JwtAuthGuard` -> `assertTenantMatch`). A direct client read is a decision
-- with its own ADR, not a default.
--
-- No REVOKE: OD-72's `alter default privileges` ratchet
-- (20260825210000:183) means anything created after it arrives with no client
-- grants already.

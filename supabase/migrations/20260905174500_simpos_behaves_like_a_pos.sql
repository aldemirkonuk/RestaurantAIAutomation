-- SimPOS stops being a wine-only, always-$45, money-free fixture.
--
-- The POS lens run on Sim Meyhouse (2026-09-03) measured four schema-shaped
-- defects behind the SimPOS bridge. Every one of them is a column that either
-- forces a fabricated value or has nowhere to put a true one:
--
--   defect 3  simpos_catalog.price is NOT NULL, so seeding falls back to a
--             hard-coded 45 and 53 of 53 SKUs carried $45.00 with nothing on
--             screen marking them as placeholders. ADR 0020: an unknown price
--             is null and renders as "unpriced", never as a number.
--   defect 4  simpos_checks has nowhere to record covers or the server, so the
--             webhook could not send them and pos_checks.total/subtotal/tip/
--             covers/table_id/server_name were NULL on 44 of 44 rows — every
--             revenue, average-check and covers figure downstream computed over
--             nulls. ADR 0011's contract says a check carries its money.
--   defect 5  simpos_catalog has no category, so simpos.service.ts hard-codes
--             is_wine: true and Haydari, Köpoğlu, Acılı Muhammara and a Turkish
--             coffee became 38 of the 39 permanent "unmapped wine" queue rows.
--   defect 11 nothing records that a check rang outside the venue's published
--             hours. All 44 checks rang 22:29-23:20 PDT against a 22:00 Friday
--             close and nothing warned. ADR 0093 D1 made the hours knowable;
--             this makes the observation storable.
--
-- Everything here is additive and nullable. No backfill: the 53 existing rows
-- keep their $45 rather than being rewritten to null, because a price a human
-- may since have corrected is not ours to erase — and the seeding path that
-- produced them is what changes. Same posture as the rest of the schema: RLS
-- on, no anon/authenticated policies, every access through the service role.

-- ---------------------------------------------------------------------------
-- 1. A POS button may have no price yet (defect 3)
-- ---------------------------------------------------------------------------

alter table public.simpos_catalog
  alter column price drop not null;

comment on column public.simpos_catalog.price is
  'Menu price of this button, or NULL when nobody has set one. NULL renders as '
  '"unpriced" and is never substituted with a figure (ADR 0020). Was NOT NULL '
  'until 2026-09-05, which forced seedCatalogIfEmpty to invent 45 for any SKU '
  'with no menu price — 53 of 53 on the 2026-09-03 lens run.';

-- A line snapshot of an unpriced button has no price either. The snapshot is
-- still a snapshot: it records what the button said AT THE TIME, including
-- that it said nothing.
alter table public.simpos_check_lines
  alter column unit_price_snapshot drop not null;

comment on column public.simpos_check_lines.unit_price_snapshot is
  'The button price at the moment the line was added, or NULL when the button '
  'was unpriced. Never coerced to 0 — a free item and an unpriced one are '
  'different facts.';

-- ---------------------------------------------------------------------------
-- 2. Not everything a restaurant sells is wine (defect 5)
-- ---------------------------------------------------------------------------

alter table public.simpos_catalog
  add column if not exists category text;

comment on column public.simpos_catalog.category is
  'What kind of thing this button sells. Shares master_wine_library.beverage_kind''s '
  'vocabulary deliberately — the seed reads that column, and two spellings of '
  '"this is a beer" is how a classification silently stops matching — plus '
  '"food" and "other", which a beverage classifier has no word for and a POS '
  'button list is full of. Drives is_wine on the outbound webhook line. NULL '
  'means uncategorised, which the bridge treats as NOT wine — the safe '
  'direction: a miscategorised meze dropped from wine matching costs one queue '
  'row, a meze declared wine costs a permanent one. ''unknown'' is stored as '
  'NULL rather than as a category, because it is the absence of an answer.';

-- Deliberately a CHECK over a small closed list rather than an enum: SimPOS is
-- a testbed and a new category should be a one-line migration, not a type
-- rewrite.
alter table public.simpos_catalog
  drop constraint if exists simpos_catalog_category_check;
alter table public.simpos_catalog
  add constraint simpos_catalog_category_check
  check (
    category is null
    or category in (
      'wine', 'beer', 'spirit', 'sake', 'cider', 'cocktail',
      'non_alcoholic', 'food', 'other'
    )
  );

-- ---------------------------------------------------------------------------
-- 3. A check carries money, a table, a server and a cover count (defect 4)
-- ---------------------------------------------------------------------------

alter table public.simpos_checks
  add column if not exists covers integer,
  add column if not exists server_name text;

comment on column public.simpos_checks.covers is
  'How many guests this check seated, or NULL when nobody said. NULL is the '
  'honest value for a check rung without opening a table, and it must reach '
  'pos_checks.covers as NULL rather than 0 (ADR 0105 D5) — a venue that cannot '
  'report covers is not a venue that served nobody.';

comment on column public.simpos_checks.server_name is
  'Who rang the check, or NULL. Sent on the webhook so pos_checks.server_name '
  'stops being NULL on every row, which is what made per-server analytics '
  'compute over nothing.';

alter table public.simpos_checks
  drop constraint if exists simpos_checks_covers_positive;
alter table public.simpos_checks
  add constraint simpos_checks_covers_positive
  check (covers is null or (covers >= 0 and covers <= 200));

-- ---------------------------------------------------------------------------
-- 4. A check knows whether it rang while the venue was open (defect 11)
-- ---------------------------------------------------------------------------
--
-- Two columns, not one, and the reason is the whole point: a boolean alone
-- cannot distinguish "we know it was outside hours" from "we could not tell".
-- `isOpenAt` (common/operating-hours) already answers null-with-a-reason
-- rather than false, and that distinction has to survive the write or the
-- column becomes another absence reported as health — an unknown rendered as
-- "fine".

alter table public.simpos_checks
  add column if not exists hours_state text;

comment on column public.simpos_checks.hours_state is
  'Whether the venue was open when this check closed, as answered by '
  'isOpenAt(restaurants.operating_hours, timezone, closed_at): open, '
  'outside_hours, closed_day, or one of hours_unknown / hours_invalid / '
  'timezone_unknown when the question could not be answered at all. NULL means '
  'the check predates this column. Never a bare boolean: "we could not tell" '
  'and "it was fine" must not render the same (ADR 0093 D1).';

alter table public.simpos_checks
  drop constraint if exists simpos_checks_hours_state_check;
alter table public.simpos_checks
  add constraint simpos_checks_hours_state_check
  check (
    hours_state is null
    or hours_state in (
      'open',
      'outside_hours',
      'closed_day',
      'hours_unknown',
      'hours_invalid',
      'timezone_unknown'
    )
  );

-- The order log reads this to find the checks worth flagging without scanning
-- every row and re-deciding.
create index if not exists idx_simpos_checks_out_of_hours
  on public.simpos_checks (restaurant_id, closed_at desc)
  where hours_state in ('outside_hours', 'closed_day');

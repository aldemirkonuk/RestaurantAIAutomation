-- An order that repeats says so on itself.
--
-- The founder, 2026-09-05 (batch 40): "Build recurrence on the order" — a
-- recurrence rule on the order with its next date and the seal on each
-- recurrence's approval; the station fills from a real column.
--
-- Recorded as an ADDENDUM to ADR 0125 (an order's states), not as a new ADR:
-- recurrence adds no state to the twelve and no edge to the transition table.
-- What it adds is a REASON an order exists, and a rule that mints the next one.
--
-- ===========================================================================
-- WHAT WAS THERE BEFORE THIS FILE — MEASURED, NOT ASSUMED
-- ===========================================================================
-- `procurement_orders` has carried two recurrence columns since the production
-- baseline (`20260805000000_baseline_from_production.sql:39-40`):
--
--     is_recurring   boolean DEFAULT false
--     cron_schedule  character varying(100)
--
-- Neither has ever been written or read. Measured on the tree, 2026-09-05:
--
--     grep -rn "is_recurring\|cron_schedule" apps/api-gateway/src apps/web/src \
--       apps/mobile services/agent-orchestrator packages | grep -v node_modules
--
-- returns 13 lines. TWO of them name `procurement_orders`, and both are column
-- INVENTORIES inside test fixtures (`providers/retroactive-order.spec.ts:248-249`,
-- `procurement/verify-receipt.spec.ts:63,77`). The other eleven are a different
-- table each: `calendar_events.is_recurring`, `scheduled_reminders.is_recurring`,
-- `provider_promotions.is_recurring`. So on the order itself: zero writers, zero
-- readers, in three languages.
--
-- THIS MIGRATION DELIBERATELY DOES NOT USE EITHER, and the reason is not tidiness:
--
--   is_recurring   a boolean cannot say HOW an order recurs, so a second column
--                  would have to, and then two columns can disagree about whether
--                  this order repeats. The rule below is the single fact:
--                  `recurrence_frequency IS NULL` means "does not repeat", and
--                  there is nothing else to contradict.
--   cron_schedule  a cron string is a schedule no operator can read back and no
--                  reader can clamp. "0 8 31 * *" is a monthly order that skips
--                  February entirely, and nothing about the string says so. The
--                  arithmetic this house already trusts
--                  (`recurring-orders.service.ts:calculateNextOrderDate`) clamps
--                  31 January + 1 month to 28/29 February on purpose; a cron
--                  expression cannot express that, and a varchar(100) is where a
--                  schedule goes to stop being checkable.
--
-- Both are tombstoned with a COMMENT below rather than dropped: dropping a
-- baseline column is a separate decision with its own blast radius, and neither
-- costs anything sitting still.
--
-- ===========================================================================
-- WHY EXPLICIT COLUMNS AND NOT AN RRULE
-- ===========================================================================
-- The brief allowed either. Explicit columns win on three counts, all measured:
--
--   1. THE VOCABULARY ALREADY EXISTS. `recurring_orders.frequency` has a CHECK
--      over exactly five members (`20260901180000_recurring_orders_shape.sql`),
--      `RECURRING_FREQUENCIES` in TypeScript is the same five, and
--      `calculateNextOrderDate` is 90 lines of already-tested calendar
--      arithmetic over them — including the two cases an RRULE gets wrong by
--      default (month-end clamping, and UTC-vs-local date drift that made a
--      monthly schedule land on the 2nd west of Greenwich). Reusing the five
--      means the two recurrence surfaces in this house cannot disagree about
--      what "weekly on Tuesday" means.
--   2. AN RRULE NEEDS A PARSER THIS REPO DOES NOT HAVE. `grep -rn "rrule"
--      apps/api-gateway/src` returns nothing. A hand-rolled subset parser is a
--      second implementation of the arithmetic above, in a string.
--   3. AN UNPARSED RULE IS `cron_schedule` WEARING A DIFFERENT HAT — see above.
--
-- ===========================================================================
-- THE NEXT DATE IS DERIVED, NOT TYPED
-- ===========================================================================
-- `recurrence_next_due_on` is stored because the generator finds its work with an
-- index probe on it, and because the day book has to show it without recomputing
-- a series per row. It is never typed by a person after the first: the gateway
-- takes a RULE plus a START date, snaps that start onto the rule's anchor, and
-- every advance thereafter is `nextOccurrenceOn(previous)` — one pure function
-- (`apps/api-gateway/src/procurement/order-recurrence.ts`) whose output the
-- service asserts against the stored value before it writes a child.
--
-- ===========================================================================
-- WHAT THIS MIGRATION IS NOT
-- ===========================================================================
-- It is NOT a second `recurring_orders`. That table is a TEMPLATE — an inventory
-- id, a provider id, a quantity and a frequency — and it can only ever repeat
-- those four facts. An order carries the whole agreement (ADR 0119: the price
-- AND the unit it is stated in, the allowance, the deposit, the freight), and a
-- recurrence on the order repeats THAT. The two are left standing side by side
-- deliberately; which one survives is the founder's call and is filed as an open
-- question in ADR 0125's addendum, not decided here by a builder.
--
-- Additive throughout: nine columns, four CHECKs, two indexes, two comments.
-- No table, no RLS surface, no backfill, no default that changes an existing
-- row's meaning (every column is NULL on every existing order, and NULL is
-- exactly "this order does not repeat").

-- ---------------------------------------------------------------------------
-- The rule
-- ---------------------------------------------------------------------------
ALTER TABLE public.procurement_orders
  -- NULL means this order does not repeat. There is no second flag.
  ADD COLUMN IF NOT EXISTS recurrence_frequency  text,
  -- Weekly / biweekly: 0=Mon .. 6=Sun. Monthly / quarterly: 1..28. NULL means
  -- "no anchor stated", and the series then runs from its start date.
  ADD COLUMN IF NOT EXISTS recurrence_anchor_day smallint,
  -- The date the series is measured from. Set once; never advanced.
  ADD COLUMN IF NOT EXISTS recurrence_anchored_on date,
  -- Derived. See the header.
  ADD COLUMN IF NOT EXISTS recurrence_next_due_on date,
  -- active / paused / ended.
  ADD COLUMN IF NOT EXISTS recurrence_status     text,
  -- Who last moved the recurrence between those three, and when. NOT the same
  -- as created_by: a manager sets a recurrence, an owner may end it.
  ADD COLUMN IF NOT EXISTS recurrence_status_by  uuid,
  ADD COLUMN IF NOT EXISTS recurrence_status_at  timestamp with time zone,
  -- The parent this order was minted from, and the occurrence it was minted
  -- for. Both, or neither.
  ADD COLUMN IF NOT EXISTS recurrence_parent_order_id uuid,
  ADD COLUMN IF NOT EXISTS recurrence_occurrence_on   date;

-- ---------------------------------------------------------------------------
-- The parent link
-- ---------------------------------------------------------------------------
-- ON DELETE SET NULL, matching `procurement_orders_recurring_order_id_fkey`
-- (`20260901150000_order_line_capture_and_units.sql:255`): deleting a parent
-- must never delete an order that was actually placed with a vendor. The child
-- loses its lineage, which is a smaller loss than losing the order.
ALTER TABLE public.procurement_orders
  DROP CONSTRAINT IF EXISTS procurement_orders_recurrence_parent_fkey,
  ADD  CONSTRAINT procurement_orders_recurrence_parent_fkey
       FOREIGN KEY (recurrence_parent_order_id)
       REFERENCES public.procurement_orders(id) ON DELETE SET NULL;

-- `recurrence_status_by` references public.users(user_id) — NOT auth.users(id).
-- The two tables are disjoint in this database: the JWT carries
-- `public.users.user_id`, so an actor FK to `auth.users` raises 23503 on every
-- write and no test on a fresh database can catch it (there are no rows to
-- violate). Same rule `recurring_orders.created_by` follows
-- (`20260901180000_recurring_orders_shape.sql:145`).
ALTER TABLE public.procurement_orders
  DROP CONSTRAINT IF EXISTS procurement_orders_recurrence_status_by_fkey,
  ADD  CONSTRAINT procurement_orders_recurrence_status_by_fkey
       FOREIGN KEY (recurrence_status_by)
       REFERENCES public.users(user_id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- The rules about the rule
-- ---------------------------------------------------------------------------

-- 1. The five members, and only those five. The same set as
--    `recurring_orders_frequency_check`, so the two surfaces cannot drift.
ALTER TABLE public.procurement_orders
  DROP CONSTRAINT IF EXISTS procurement_orders_recurrence_frequency_check,
  ADD  CONSTRAINT procurement_orders_recurrence_frequency_check
       CHECK (recurrence_frequency IS NULL
              OR recurrence_frequency IN
                 ('daily','weekly','biweekly','monthly','quarterly'));

-- 2. A rule and its state travel together, and an ACTIVE rule has a next date.
--    Without the second half, a paused-looking series with no date would sit in
--    the Recurring station forever reading "next: —", which is the absence
--    that reports as health.
--
--    COALESCE(..., false) IS NOT DECORATION, AND THIS WAS MEASURED.
--    A CHECK constraint PASSES when it evaluates to NULL — Postgres refuses only
--    on FALSE. The first draft of this constraint had no `recurrence_status IS
--    NOT NULL` and no COALESCE, so a row with `recurrence_frequency = 'weekly'`
--    and a NULL status made the second branch `NULL IN (...)` → NULL, the whole
--    expression `false OR NULL` → NULL, and the write was ACCEPTED. The probe
--    caught it (`$SP/pglite-probe/p4ay-order-recurrence.mjs`: "a rule with no
--    status is refused — it was ACCEPTED"); no TypeScript test could have,
--    because the arithmetic is Postgres's, not JavaScript's.
--
--    Both belts are kept: the explicit IS NOT NULL makes the expression
--    two-valued on its own, and the COALESCE makes that true even if somebody
--    later adds a nullable term to it.
ALTER TABLE public.procurement_orders
  DROP CONSTRAINT IF EXISTS procurement_orders_recurrence_complete_check,
  ADD  CONSTRAINT procurement_orders_recurrence_complete_check
       CHECK (COALESCE(
         (recurrence_frequency IS NULL
          AND recurrence_status IS NULL
          AND recurrence_anchored_on IS NULL
          AND recurrence_next_due_on IS NULL)
         OR
         (recurrence_frequency IS NOT NULL
          AND recurrence_status IS NOT NULL
          AND recurrence_status IN ('active','paused','ended')
          AND recurrence_anchored_on IS NOT NULL
          AND (recurrence_status <> 'active' OR recurrence_next_due_on IS NOT NULL))
       , false));

-- 3. The anchor is in range FOR ITS FREQUENCY. A weekly rule anchored on day 15
--    is not a weekday; a monthly rule anchored on 31 is a February that never
--    happens (which is why the ceiling is 28, exactly as
--    `recurring_orders.frequency_day` documents it). A DAILY rule takes no
--    anchor at all: anchoring "every day" to a Tuesday is a contradiction, not
--    a narrowing, and it is refused rather than ignored.
--
--    COALESCE for the reason above, and here it closes a second hole: without
--    it, an anchor day set while `recurrence_frequency` is NULL made both
--    branches NULL and the row was accepted — an anchor belonging to no rule.
ALTER TABLE public.procurement_orders
  DROP CONSTRAINT IF EXISTS procurement_orders_recurrence_anchor_day_check,
  ADD  CONSTRAINT procurement_orders_recurrence_anchor_day_check
       CHECK (COALESCE(
         recurrence_anchor_day IS NULL
         OR (recurrence_frequency IS NOT NULL
             AND recurrence_frequency IN ('weekly','biweekly')
             AND recurrence_anchor_day BETWEEN 0 AND 6)
         OR (recurrence_frequency IS NOT NULL
             AND recurrence_frequency IN ('monthly','quarterly')
             AND recurrence_anchor_day BETWEEN 1 AND 28)
       , false));

-- 4. A child that names a parent MUST name the occurrence it was minted for,
--    and is never its own parent.
--
--    ONE DIRECTION, NOT BOTH, AND THE ASYMMETRY WAS MEASURED RATHER THAN
--    CHOSEN. This was first written as "both or neither", which is the shape it
--    looks like it should have. Running the migration on a real Postgres
--    (`$SP/pglite-probe/p4ay-order-recurrence.mjs`) showed what that costs:
--    `ON DELETE SET NULL` on the parent FK rewrites a child's
--    `recurrence_parent_order_id` to NULL and leaves `recurrence_occurrence_on`
--    set, so the symmetric CHECK refused the rewrite and the DELETE failed with
--    23514 — "new row for relation procurement_orders violates check constraint
--    procurement_orders_recurrence_child_check", raised from inside the
--    referential action, naming the CHILD's row for a statement about the
--    PARENT. A parent that had ever produced a child could never be deleted,
--    and the error said nothing about why.
--
--    The one-directional rule is also the truthful one. An orphaned child keeps
--    `recurrence_occurrence_on` because that fact is still true: this order WAS
--    raised for the Tuesday it says. Erasing it to preserve a symmetry would
--    delete the only remaining record of why the order exists. The unique index
--    below is `WHERE recurrence_parent_order_id IS NOT NULL`, so an orphan
--    simply drops out of it — it has no parent left to collide against, and
--    nothing will ever mint another occurrence for a series whose order is gone.
--
--    What the direction still forbids is the state that matters: a parent with
--    no occurrence date, which slips past the unique index and is the only way
--    two orders get raised for one Tuesday.
ALTER TABLE public.procurement_orders
  DROP CONSTRAINT IF EXISTS procurement_orders_recurrence_child_check,
  ADD  CONSTRAINT procurement_orders_recurrence_child_check
       CHECK (
         recurrence_parent_order_id IS NULL
         OR (recurrence_occurrence_on IS NOT NULL
             AND recurrence_parent_order_id <> id)
       );

-- ---------------------------------------------------------------------------
-- Exactly one child per occurrence — decided by the database, not by a check
-- ---------------------------------------------------------------------------
-- The generator reads "which series are due today", mints a child, then advances
-- the parent. Two runs overlapping — a redeploy during the cron window, a manual
-- trigger beside the schedule, a retry after a timeout that actually committed —
-- read the same parent at the same due date and both mint. An application-side
-- "did I already do this?" cannot close that: the read and the write are not one
-- statement, and the window between them is the whole bug.
--
-- A partial unique index closes it in the one place where the two writers are
-- serialised. The second insert raises 23505, the generator counts it as a
-- collision rather than a failure, and the count says so.
CREATE UNIQUE INDEX IF NOT EXISTS ux_procurement_orders_recurrence_occurrence
  ON public.procurement_orders (recurrence_parent_order_id, recurrence_occurrence_on)
  WHERE recurrence_parent_order_id IS NOT NULL;

-- The generator's own probe: active series due on or before today. Partial, so
-- it costs nothing on the 100% of orders that do not recur.
CREATE INDEX IF NOT EXISTS ix_procurement_orders_recurrence_due
  ON public.procurement_orders (recurrence_next_due_on)
  WHERE recurrence_status = 'active';

-- ---------------------------------------------------------------------------
-- Tombstones
-- ---------------------------------------------------------------------------
COMMENT ON COLUMN public.procurement_orders.is_recurring IS
  'TOMBSTONE (2026-09-05). Never written or read on this table in any language; measured across apps/, services/ and packages/. Recurrence is recurrence_frequency IS NOT NULL. Do not write this column: two flags can disagree about one fact.';

COMMENT ON COLUMN public.procurement_orders.cron_schedule IS
  'TOMBSTONE (2026-09-05). Never written or read. A cron string cannot be read back by an operator and cannot clamp a month end — "0 8 31 * *" silently skips February. The rule is recurrence_frequency + recurrence_anchor_day.';

COMMENT ON COLUMN public.procurement_orders.recurrence_next_due_on IS
  'DERIVED, never typed after the series starts. nextOccurrenceOn() in apps/api-gateway/src/procurement/order-recurrence.ts is the only thing that advances it; the service asserts the stored value against that function before minting a child.';

-- ---------------------------------------------------------------------------
-- In-file assertions: this migration proves it did what it says.
-- ---------------------------------------------------------------------------
DO $assert$
DECLARE
  n int;
BEGIN
  -- The nine columns.
  SELECT count(*) INTO n
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name = 'procurement_orders'
     AND column_name IN (
       'recurrence_frequency','recurrence_anchor_day','recurrence_anchored_on',
       'recurrence_next_due_on','recurrence_status','recurrence_status_by',
       'recurrence_status_at','recurrence_parent_order_id','recurrence_occurrence_on');
  IF n <> 9 THEN
    RAISE EXCEPTION 'expected 9 recurrence columns on procurement_orders, found %', n;
  END IF;

  -- The four CHECKs.
  SELECT count(*) INTO n
    FROM pg_constraint
   WHERE conrelid = 'public.procurement_orders'::regclass
     AND contype = 'c'
     AND conname IN (
       'procurement_orders_recurrence_frequency_check',
       'procurement_orders_recurrence_complete_check',
       'procurement_orders_recurrence_anchor_day_check',
       'procurement_orders_recurrence_child_check');
  IF n <> 4 THEN
    RAISE EXCEPTION 'expected 4 recurrence CHECK constraints, found %', n;
  END IF;

  -- The two foreign keys, and the actor one pointing at public.users.
  SELECT count(*) INTO n
    FROM pg_constraint
   WHERE conrelid = 'public.procurement_orders'::regclass
     AND contype = 'f'
     AND conname IN (
       'procurement_orders_recurrence_parent_fkey',
       'procurement_orders_recurrence_status_by_fkey');
  IF n <> 2 THEN
    RAISE EXCEPTION 'expected 2 recurrence foreign keys, found %', n;
  END IF;

  SELECT count(*) INTO n
    FROM pg_constraint
   WHERE conname = 'procurement_orders_recurrence_status_by_fkey'
     AND confrelid = 'public.users'::regclass;
  IF n <> 1 THEN
    RAISE EXCEPTION
      'recurrence_status_by must reference public.users, not auth.users (found % matching)', n;
  END IF;

  -- The unique index that decides "one child per occurrence".
  SELECT count(*) INTO n
    FROM pg_indexes
   WHERE schemaname = 'public'
     AND tablename = 'procurement_orders'
     AND indexname = 'ux_procurement_orders_recurrence_occurrence';
  IF n <> 1 THEN
    RAISE EXCEPTION 'the one-child-per-occurrence unique index was not created (found % of 1)', n;
  END IF;

  SELECT count(*) INTO n
    FROM pg_indexes
   WHERE schemaname = 'public'
     AND tablename = 'procurement_orders'
     AND indexname = 'ix_procurement_orders_recurrence_due';
  IF n <> 1 THEN
    RAISE EXCEPTION 'the due-series index was not created (found % of 1)', n;
  END IF;

  -- No existing order is changed by this migration: every recurrence column is
  -- NULL everywhere, which reads as "does not repeat".
  SELECT count(*) INTO n
    FROM public.procurement_orders
   WHERE recurrence_frequency IS NOT NULL
      OR recurrence_status IS NOT NULL
      OR recurrence_parent_order_id IS NOT NULL;
  IF n <> 0 THEN
    RAISE EXCEPTION
      'this migration is additive and expected 0 orders carrying a recurrence, found %', n;
  END IF;
END;
$assert$;

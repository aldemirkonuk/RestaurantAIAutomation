-- recurring_orders: give the table the shape its only writer already assumes.
--
-- WHY THIS IS A SCHEMA CHANGE AND NOT A CODE CHANGE
-- -------------------------------------------------
-- `RecurringOrdersService` declares a `RecurringOrderRow` with eight columns the
-- table does not have — `inventory_id`, `provider_id`, `wine_name`,
-- `target_price`, `created_by`, `notes`, `last_executed_at`, `execution_count` —
-- and `createRecurringOrder` inserts seven of them. The table's own columns are
-- `wine_id varchar(50)` and `preferred_providers text[]`, which nothing anywhere
-- writes.
--
-- Measured against production 2026-09-01:
--
--   recurring_orders        0 rows
--   procurement_orders      2 rows
--   restaurant_inventory   72 rows
--   providers              21 rows
--
-- The zero is not a coincidence, it is the symptom. Every insert this service
-- has ever attempted named columns that do not exist AND omitted `unit_type`,
-- which is NOT NULL with no default. The feature has never once succeeded, so
-- there is no data to migrate and no behaviour to preserve — which makes this
-- the cheapest possible moment to give the table the shape the materialiser
-- needs, and the most expensive possible moment to skip it.
--
-- WHY THE SERVICE IS NOT REWRITTEN AROUND wine_id/preferred_providers INSTEAD
-- ---------------------------------------------------------------------------
-- Because they cannot reach `createOrder`. `procurement_orders.inventory_id` and
-- `.provider_id` are `uuid NOT NULL`; `wine_id` is a varchar(50) that no table
-- in this schema has a key of, and `preferred_providers` is an array of vendor
-- NAMES (`RecurringOrders.tsx:133` joins it into an email greeting), not ids.
-- Resolving either into a uuid means a name match that can hit zero rows or two,
-- and a schedule that quietly orders from the wrong vendor every Monday is
-- exactly the silent-wrong-answer failure ADR 0011 forbids.
--
-- ADDITIVE. Nothing is dropped and nothing is rewritten. The two superseded
-- columns are kept and commented — see section 5 for why deleting them would
-- introduce a crash rather than remove one.
set local statement_timeout = '120s';

-- ---------------------------------------------------------------------------
-- 1. The columns the materialiser actually reads.
-- ---------------------------------------------------------------------------
-- Six of the eight phantom fields become columns. The other two do not, and the
-- reasons are worth stating because "add all eight" was the obvious move:
--
--   wine_name         NOT ADDED. It is a copy of `restaurant_inventory.wine_name`
--                     reachable through `inventory_id`, and a stored copy goes
--                     stale the first time a wine is renamed. The service now
--                     embeds it (`select("*, inventory:inventory_id(wine_name)")`)
--                     and projects it onto the response, so every reader still
--                     sees `wine_name` and no second truth exists.
--   last_executed_at  NOT ADDED. `last_order_date` (below, already present) is
--                     the same fact, and it is the one `RecurringOrders.tsx`
--                     already renders. Two columns for one fact is the defect
--                     this migration exists to end, not a thing to add more of.
alter table public.recurring_orders
  add column if not exists inventory_id    uuid,
  add column if not exists provider_id     uuid,
  add column if not exists target_price    numeric(10,2),
  add column if not exists created_by      uuid,
  add column if not exists notes           text,
  add column if not exists execution_count integer not null default 0;

alter table public.recurring_orders
  drop constraint if exists recurring_orders_execution_count_check,
  add  constraint recurring_orders_execution_count_check
       check (execution_count >= 0);

alter table public.recurring_orders
  drop constraint if exists recurring_orders_target_price_check,
  add  constraint recurring_orders_target_price_check
       check (target_price is null or target_price > 0);

-- ---------------------------------------------------------------------------
-- 2. NOT NULL, but only if the table can honestly take it.
-- ---------------------------------------------------------------------------
-- A schedule that cannot name what to order, from whom, and for which tenant is
-- not a schedule — it is a row the 8 AM cron will fail on every single day with
-- nobody watching. So all three are NOT NULL.
--
-- The row-count guard is not ceremony. This migration is correct because the
-- table is empty TODAY; if it is applied later against a database where the
-- feature started working, a bare `set not null` raises a bare 23502 naming
-- nothing. Failing legibly, before any damage, naming the rows that stopped it,
-- is the good outcome — and the alternative (back-filling a guessed
-- inventory_id) is the silent-wrong-answer this whole change is about.
do $$
declare
  offenders bigint;
begin
  select count(*)
    into offenders
    from public.recurring_orders
   where inventory_id is null
      or provider_id is null
      or restaurant_id is null;

  if offenders > 0 then
    raise exception
      'Cannot constrain recurring_orders: % row(s) have a null restaurant_id, inventory_id or provider_id. This migration assumes an empty table (production had 0 rows on 2026-09-01). Decide what each row should point at and set it explicitly; do not back-fill a guess — a schedule pointed at the wrong wine or vendor re-orders it forever.',
      offenders;
  end if;
end $$;

alter table public.recurring_orders
  alter column restaurant_id set not null,
  alter column inventory_id  set not null,
  alter column provider_id   set not null;

-- ---------------------------------------------------------------------------
-- 3. Referential integrity, before the table has any rows.
-- ---------------------------------------------------------------------------
-- `recurring_orders` had NO foreign keys at all — not even on `restaurant_id`.
-- That is the shape `pos_item_mappings` was in under OD-71, which is how 92 rows
-- came to point at a tenant that no longer existed. Adding them to an empty
-- table is free; adding them to a populated one is a data audit.
--
-- Delete behaviour follows ADR 0014's rule as applied in
-- `20260901150000_order_line_capture_and_units.sql`: a CLAIM dies with its
-- target, a QUESTION outlives its answer. A recurring order is a standing
-- INSTRUCTION about the future, not a record of the past — with its wine or its
-- vendor gone there is nothing left to instruct, and the alternative (SET NULL
-- on a NOT NULL column) is not available anyway. So both CASCADE.
--
-- Orders already materialised from a deleted schedule are NOT lost: they are
-- their own rows in `procurement_orders`, and that table's
-- `recurring_order_id` FK is SET NULL for exactly this reason — the order
-- happened, and it does not un-happen because the schedule was deleted.
alter table public.recurring_orders
  drop constraint if exists recurring_orders_restaurant_id_fkey,
  add  constraint recurring_orders_restaurant_id_fkey
       foreign key (restaurant_id) references public.restaurants(id) on delete cascade;

alter table public.recurring_orders
  drop constraint if exists recurring_orders_inventory_id_fkey,
  add  constraint recurring_orders_inventory_id_fkey
       foreign key (inventory_id) references public.restaurant_inventory(id) on delete cascade;

alter table public.recurring_orders
  drop constraint if exists recurring_orders_provider_id_fkey,
  add  constraint recurring_orders_provider_id_fkey
       foreign key (provider_id) references public.providers(id) on delete cascade;

-- `created_by` references public.users(user_id) — NOT auth.users(id).
--
-- Same footgun as `procurement_orders.created_by`, and it is live: the two
-- tables are DISJOINT in this database (measured 2026-09-01: auth.users 5 rows,
-- public.users 7, zero shared ids). The value that reaches this column is the
-- same one `createOrder` receives — a `public.users.user_id` returned by
-- `auth/strategies/jwt.strategy.ts:38` — and it is handed straight to
-- `procurement_orders.created_by`, which already has this exact FK. Pointing
-- this one anywhere else would make a schedule insertable that its own
-- materialisation then rejects with 23503.
--
-- SET NULL: a standing order does not stop being real because the person who
-- set it up left the restaurant.
alter table public.recurring_orders
  drop constraint if exists recurring_orders_created_by_fkey,
  add  constraint recurring_orders_created_by_fkey
       foreign key (created_by) references public.users(user_id) on delete set null;

-- ---------------------------------------------------------------------------
-- 4. One unit vocabulary, one frequency vocabulary.
-- ---------------------------------------------------------------------------
-- unit_type was constrained to 'case' | 'bottle' while `createOrder` — the only
-- thing that ever consumes it — accepts all seven of `ORDER_UNIT_TYPES`. A
-- standing weekly keg order was un-expressible for no reason other than that
-- this CHECK predates the vocabulary. The seven singulars are copied verbatim
-- from `procurement_orders_unit_type_check` so all five unit columns in the
-- procurement domain now accept exactly the same words.
alter table public.recurring_orders
  drop constraint if exists recurring_orders_unit_type_check,
  add  constraint recurring_orders_unit_type_check
       check (unit_type::text = any (array[
         'bottle','case','keg','pack','split_case','each','liter'
       ]::text[]));

alter table public.recurring_orders
  alter column unit_type set default 'bottle';

-- frequency had the opposite drift: the DB accepted daily|weekly|biweekly|
-- monthly, the TypeScript type declared weekly|biweekly|monthly|QUARTERLY, and
-- `calculateNextOrderDate` implemented all four TS values plus a `default:` arm
-- that silently returned +1 month. So 'quarterly' was un-insertable, and
-- 'daily' — which the DB and the UI both offer — fell through the default and
-- would have re-ordered MONTHLY. The union of the two lists is the honest set;
-- the service now implements all five and refuses anything else instead of
-- defaulting.
alter table public.recurring_orders
  drop constraint if exists recurring_orders_frequency_check,
  add  constraint recurring_orders_frequency_check
       check (frequency::text = any (array[
         'daily','weekly','biweekly','monthly','quarterly'
       ]::text[]));

-- The query the 8 AM cron makes every morning: active schedules due on or before
-- today. Unindexed it is a seq scan of every schedule every restaurant has.
create index if not exists idx_recurring_orders_due
  on public.recurring_orders (next_order_date)
  where active;

create index if not exists idx_recurring_orders_restaurant
  on public.recurring_orders (restaurant_id, active);

-- "Show me every schedule for this wine" — the question asked when a wine is
-- about to be delisted, i.e. immediately before the CASCADE above fires.
create index if not exists idx_recurring_orders_inventory
  on public.recurring_orders (inventory_id);

-- ---------------------------------------------------------------------------
-- 5. The two superseded columns are KEPT, and tombstoned in place.
-- ---------------------------------------------------------------------------
-- `wine_id` and `preferred_providers` are dead: no code in this repository has
-- ever written either, and the table is empty. Dropping them costs nothing in
-- data — and would introduce a crash.
--
-- `RecurringOrders.tsx:133` does `order.preferred_providers.join(', ')` and
-- `:348` does `order.preferred_providers.length`, both unguarded. Today those
-- lines are unreachable because the list is always empty. The moment this
-- migration and its service fix let the first schedule exist, they run — and
-- against a row with the column dropped they throw on `undefined.join`. A fix
-- for a write bug that ships a render crash is not a fix.
--
-- So the column stays until the page stops reading it, and the comment says so
-- rather than a session six months from now re-deriving it from a git blame.
-- This is the schema's version of ADR 0032's tombstone rule.
comment on column public.recurring_orders.wine_id is
  'SUPERSEDED by inventory_id (2026-09-01). Never written by any code in this repository; a varchar(50) that no table in this schema keys on. Kept, not dropped, because apps/web RecurringOrders.tsx still reads it. Drop it in the same change that stops that read.';

comment on column public.recurring_orders.preferred_providers is
  'SUPERSEDED by provider_id (2026-09-01). An array of vendor NAMES, never ids, and never written by any code here. procurement_orders.provider_id is uuid NOT NULL, so a name list cannot materialise an order without a lookup that may match zero vendors or two. Kept, not dropped, because RecurringOrders.tsx:133 calls .join() on it unguarded and would throw on undefined.';

comment on column public.recurring_orders.inventory_id is
  'The restaurant_inventory row this schedule re-orders. Handed straight to ProcurementService.createOrder, which needs a uuid.';

comment on column public.recurring_orders.execution_count is
  'How many procurement_orders this schedule has materialised. Incremented by executeRecurringOrder; the timestamp of the last one is last_order_date.';

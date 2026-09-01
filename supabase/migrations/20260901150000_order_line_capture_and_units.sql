-- Order-line capture, unit arithmetic, and order provenance.
--
-- WHY NOW, AND WHY THIS IS CHEAP
-- ------------------------------
-- Measured against production on 2026-09-01:
--
--   procurement_orders        2 rows
--   procurement_order_items   1 row
--   procurement_documents     0 rows
--   price_history             0 rows
--
-- There is no legacy data. Every row these tables will ever hold is written by
-- the code this migration accompanies, which is exactly the moment to put the
-- constraints in — a CHECK added against an empty table costs nothing, and the
-- same CHECK added against two years of orders is a data-cleanup project.
--
-- WHAT WAS ACTUALLY BROKEN
-- ------------------------
-- 1. NOTHING wrote `procurement_order_items`. `matchDocumentLines` returns early
--    when an order has no lines (`document-intake.service.ts:449`), so the whole
--    invoice line-matching engine was unreachable code and no order carried a
--    wine identity at line level.
--
-- 2. `procurement_orders.unit_type` had no CHECK, while the sibling columns
--    `procurement_document_lines.uom` (`baseline:4401`) and
--    `procurement_receipt_events.counted_uom` (`baseline:4593`) both did. The
--    column's DEFAULT was the PLURAL 'bottles' and its readers compare against
--    the SINGULAR ('mobile.service.ts:296': `order.unitType === "case"`), so the
--    comparison could never be true and nothing said so.
--
-- 3. `procurement_order_items` had NO foreign keys at all — the same shape as
--    `pos_item_mappings` in OD-71, which is how 92 rows came to point at a
--    tenant that no longer existed. Adding them before the first real write is
--    free; adding them after is a data audit.
--
-- 4. A manual order, an Ask-AI order and a recurring materialisation produced
--    byte-identical rows. "Did the AI place this?" — the first question anyone
--    asks of an autonomous ordering system, and the one a customer asks in a
--    dispute — had no answer anywhere in the schema.
--
-- ADDITIVE. Nothing is dropped. The only writes to existing data are the two
-- unit-vocabulary normalisations in section 1, which are prerequisites for the
-- CHECK they precede and touch at most three rows in total.
set local statement_timeout = '120s';

-- ---------------------------------------------------------------------------
-- 1. One unit vocabulary, enforced.
-- ---------------------------------------------------------------------------
-- The seven singulars are copied verbatim from
-- `procurement_document_lines_uom_check` rather than invented here, so all four
-- unit columns in the procurement domain now accept exactly the same words.
-- `apps/api-gateway/src/procurement/order-units.ts` holds the code half of this
-- pair (ORDER_UNIT_TYPES) and a unit test asserts the two lists agree.

-- Normalise before constraining. Everything ever written to these columns came
-- from a `?? 'bottles'` literal in `createOrder`, so this is the complete set of
-- values in play — but map the other plausible plurals too, because a value that
-- slipped in by another path must not fail the deploy on a technicality.
update public.procurement_orders
   set unit_type = case lower(trim(unit_type))
                     when 'bottles'     then 'bottle'
                     when 'cases'       then 'case'
                     when 'kegs'        then 'keg'
                     when 'packs'       then 'pack'
                     when 'split_cases' then 'split_case'
                     when 'split cases' then 'split_case'
                     when 'liters'      then 'liter'
                     when 'litre'       then 'liter'
                     when 'litres'      then 'liter'
                     else lower(trim(unit_type))
                   end
 where unit_type is not null;

update public.procurement_order_items
   set unit_type = case lower(trim(unit_type))
                     when 'bottles'     then 'bottle'
                     when 'cases'       then 'case'
                     when 'kegs'        then 'keg'
                     when 'packs'       then 'pack'
                     when 'split_cases' then 'split_case'
                     when 'split cases' then 'split_case'
                     when 'liters'      then 'liter'
                     when 'litre'       then 'liter'
                     when 'litres'      then 'liter'
                     else lower(trim(unit_type))
                   end
 where unit_type is not null;

-- Fail LEGIBLY rather than as a bare 23514 if some value we have not anticipated
-- is sitting in the column. A migration that refuses to apply, naming the rows
-- that stopped it, is a good outcome here: it happens before any damage, and the
-- alternative is coercing an unknown unit into a known one, which is precisely
-- the silent-wrong-number failure this whole change exists to end.
do $$
declare
  offenders text;
begin
  select string_agg(distinct quote_literal(unit_type), ', ')
    into offenders
    from (
      select unit_type from public.procurement_orders
      union all
      select unit_type from public.procurement_order_items
    ) u
   where unit_type is not null
     and unit_type not in ('bottle','case','keg','pack','split_case','each','liter');

  if offenders is not null then
    raise exception
      'Cannot constrain unit_type: unrecognised value(s) % are present. Decide what each one means and normalise it explicitly; do not widen the CHECK to accommodate a typo.',
      offenders;
  end if;
end $$;

alter table public.procurement_orders
  alter column unit_type set default 'bottle';

alter table public.procurement_order_items
  alter column unit_type set default 'bottle';

alter table public.procurement_orders
  drop constraint if exists procurement_orders_unit_type_check,
  add  constraint procurement_orders_unit_type_check
       check (unit_type is null or unit_type::text = any (array[
         'bottle','case','keg','pack','split_case','each','liter'
       ]::text[]));

alter table public.procurement_order_items
  drop constraint if exists procurement_order_items_unit_type_check,
  add  constraint procurement_order_items_unit_type_check
       check (unit_type is null or unit_type::text = any (array[
         'bottle','case','keg','pack','split_case','each','liter'
       ]::text[]));

-- A pack size below 1 divides a delivery instead of multiplying it. Mirrors
-- `procurement_document_lines_pack_size_check` (`baseline:4400`).
alter table public.procurement_order_items
  drop constraint if exists procurement_order_items_bottles_per_unit_check,
  add  constraint procurement_order_items_bottles_per_unit_check
       check (bottles_per_unit is null or bottles_per_unit >= 1);

-- ---------------------------------------------------------------------------
-- 2. Referential integrity for the line table, before it has any lines.
-- ---------------------------------------------------------------------------
-- Delete behaviour follows the census established in
-- `20260825140000_pos_referential_integrity.sql`: tenant scoping CASCADEs, and
-- an identity CLAIM about a catalogue entry SET NULLs rather than destroying the
-- row that made the claim (ADR 0014's rule — a claim dies with its target, a
-- question outlives its answer).
--
-- order_id CASCADEs and does NOT set null: a line without an order is not a
-- question anyone can answer, it is an orphan that would make every
-- `procurement_order_items` aggregate silently wrong.
alter table public.procurement_order_items
  drop constraint if exists procurement_order_items_order_id_fkey,
  add  constraint procurement_order_items_order_id_fkey
       foreign key (order_id) references public.procurement_orders(id) on delete cascade;

alter table public.procurement_order_items
  drop constraint if exists procurement_order_items_restaurant_id_fkey,
  add  constraint procurement_order_items_restaurant_id_fkey
       foreign key (restaurant_id) references public.restaurants(id) on delete cascade;

alter table public.procurement_order_items
  drop constraint if exists procurement_order_items_inventory_id_fkey,
  add  constraint procurement_order_items_inventory_id_fkey
       foreign key (inventory_id) references public.restaurant_inventory(id) on delete set null;

alter table public.procurement_order_items
  drop constraint if exists procurement_order_items_master_wine_id_fkey,
  add  constraint procurement_order_items_master_wine_id_fkey
       foreign key (master_wine_id) references public.master_wine_library(id) on delete set null;

-- The lookup the invoice matcher makes on every document: all open lines for a
-- set of orders, scoped to one restaurant. `idx_poi_order` covers order_id alone
-- and `idx_poi_restaurant` restaurant_id alone; neither serves the pair.
create index if not exists idx_poi_restaurant_order
  on public.procurement_order_items (restaurant_id, order_id);

-- ---------------------------------------------------------------------------
-- 3. Provenance on the order header.
-- ---------------------------------------------------------------------------
-- `source` is NULLABLE with no default, and that is deliberate. A default of
-- 'manual' would label the two pre-existing production orders — and any future
-- caller that forgets to state a source — as human decisions. NULL reads
-- correctly as "placed before anyone recorded this", which is the truth.
--
-- 'retroactive' is in the vocabulary because `createRetroactiveOrder`
-- (providers.service.ts / provider-intelligence.service.ts) already writes the
-- literal string `source: 'retroactive'` into a column that did not exist. Those
-- two paths remain broken for other reasons — they also write `wine_name` and
-- `actual_delivery`, which `procurement_orders` does not have, and omit NOT NULL
-- columns — and fixing them is a separate change. This migration makes one of
-- the four things they assume actually true, and no more.
alter table public.procurement_orders
  add column if not exists created_by uuid,
  add column if not exists source varchar(20),
  add column if not exists recurring_order_id uuid;

alter table public.procurement_orders
  drop constraint if exists procurement_orders_source_check,
  add  constraint procurement_orders_source_check
       check (source is null or source::text = any (array[
         'manual','ask_ai','recurring','retroactive','agent'
       ]::text[]));

-- `created_by` references public.users(user_id) — NOT auth.users(id).
--
-- THIS IS A LIVE FOOTGUN AND THE FIRST DRAFT OF THIS MIGRATION FELL INTO IT.
-- Pointed at `auth.users(id)`, this constraint would have raised 23503 on EVERY
-- order creation the moment it was applied, because the id `createOrder`
-- receives is not an `auth.users` id and never has been:
--
--   * `procurement_orders.created_by` is written from `createOrder`'s `userId`.
--   * That value comes from the JWT strategy, which returns
--     `userId: user.user_id` (`auth/strategies/jwt.strategy.ts:38`) after
--     looking the row up — so it is a `public.users.user_id`, and a valid
--     request proves the row exists, which is also why this FK cannot fire
--     spuriously.
--   * `public.users` has PK `user_id` (`users_pkey`, `baseline:8184`).
--   * Measured in production 2026-09-01: `auth.users` 5 rows,
--     `public.users` 7 rows, and **zero** `public.users` ids appear in
--     `auth.users`. The two tables are disjoint. `auth.users` is
--     Supabase-managed and this codebase does not populate it for its own
--     accounts.
--
-- The first draft cited the OD-71 census (`-> auth.users : SET NULL 2 of 2`).
-- That number is accurate for the tables THAT migration touched and is a biased
-- sample of the schema. Counted across all of `supabase/migrations`:
--
--   -> public.users(user_id) : 11 FKs, including every actor-attribution column
--      on the app's own tables — `organization_invites.invited_by`,
--      `organizations.owner_id`, `user_restaurant_access.deactivated_by`
--   -> auth.users(id)        : 5 FKs, on `one_tap_actions` and the two
--      `resolved_by` columns OD-71 itself added
--
-- So the real precedent is the opposite of the one cited. Note also that the
-- sibling actor columns already on this table — `approved_by`, `received_by`,
-- `match_verified_by` — carry NO foreign key at all, which is part of why there
-- was no in-table precedent to copy and the wrong census got reached for. They
-- are deliberately left alone here; constraining columns that already hold data
-- is a different change with a different risk.
--
-- SET NULL is unchanged and stays right for the original reason: an order does
-- not stop being a real order because the person who placed it left. Two of the
-- three `public.users` attribution FKs above use SET NULL as well.
alter table public.procurement_orders
  drop constraint if exists procurement_orders_created_by_fkey,
  add  constraint procurement_orders_created_by_fkey
       foreign key (created_by) references public.users(user_id) on delete set null;

alter table public.procurement_orders
  drop constraint if exists procurement_orders_recurring_order_id_fkey,
  add  constraint procurement_orders_recurring_order_id_fkey
       foreign key (recurring_order_id) references public.recurring_orders(id) on delete set null;

-- "Show me everything the AI ordered" and "show me this schedule's history" are
-- the two questions this section exists to make answerable.
create index if not exists idx_procurement_orders_source
  on public.procurement_orders (restaurant_id, source, requested_at desc)
  where source is not null;

create index if not exists idx_procurement_orders_recurring
  on public.procurement_orders (recurring_order_id)
  where recurring_order_id is not null;

-- ---------------------------------------------------------------------------
-- 4. Pack size on the recurring schedule.
-- ---------------------------------------------------------------------------
-- `recurring_orders.unit_type` is CHECK-constrained to 'case' | 'bottle'
-- (`baseline:4967`) and the materialiser never carried it across, so "five cases
-- every Monday" became five bottles. Carrying it across is now a refusal instead
-- of a silent 12x error, because `createOrder` will not accept a case order with
-- no pack size — so the schedule needs somewhere to hold one. Without this
-- column a case-based schedule would be un-materialisable rather than merely
-- wrong, which trades a silent bug for a loud one that has no fix.
alter table public.recurring_orders
  add column if not exists bottles_per_unit integer;

alter table public.recurring_orders
  drop constraint if exists recurring_orders_bottles_per_unit_check,
  add  constraint recurring_orders_bottles_per_unit_check
       check (bottles_per_unit is null or bottles_per_unit >= 1);

-- ---------------------------------------------------------------------------
-- 5. price_history stays exactly as it is.
-- ---------------------------------------------------------------------------
-- Deliberately no DDL. The table (`baseline:4274`) is already keyed correctly —
-- (restaurant_id, master_wine_id, provider_id, price, effective_date, source,
-- order_id) — already carries `idx_price_history_wine_provider` on
-- (master_wine_id, provider_id, effective_date DESC), and already has foreign
-- keys to all three parents. It had zero writers repo-wide and zero rows, which
-- is a code defect, not a schema one. The fix is in
-- `procurement.service.ts::recordPriceHistory`; changing the schema here would
-- imply the design was at fault when it was the only part that was right.

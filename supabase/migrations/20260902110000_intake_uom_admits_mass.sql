-- =============================================================================
-- Intake admits mass and volume, and an intake quantity may be fractional.
--
-- ADR 0071. Companion to ADR 0070 (the ledger), which locked the OTHER side of
-- this boundary on the same day and explicitly left this side broken:
--
--   "the intake `uom` CHECK still has no mass unit and `@IsInt()` still rejects
--    4.5, so the receiving door stays broken under this decision — a receiver
--    cannot select 'kg' for a flour delivery."
--
-- WHAT WAS ACTUALLY WRONG
--
-- Not "awkward". Impossible. Verified against live production 2026-09-02:
--
--   procurement_document_lines_uom_check
--     CHECK (uom = ANY ('{bottle,case,keg,pack,split_case,each,liter}'))
--
-- There is no mass unit in that set, and the same seven-value vocabulary is
-- repeated across FIVE constraints (document lines, receipt events, orders,
-- order items, recurring orders). A 25 kg sack of flour had no expressible unit
-- anywhere in the system. That is a failure of VOCABULARY, one level below the
-- @IsInt() failure the register recorded — OD-113's "intake is fine" was wrong
-- at both levels.
--
-- WHY THE QUANTITY COLUMNS MOVE TOO, AND WHY THAT IS NOT A CONTRADICTION OF 0070
--
-- ADR 0070 decided ledger quantities stay `integer`. This migration widens
-- several INTAKE quantities to numeric(12,3). Read together those look opposed;
-- they are not, and the difference is the point:
--
--   * The ledger's integers buy an EXACT conservation invariant
--     (before + change = after) and keep a rounding residue out of
--     inventory_lot_rollup's weighted-average-cost divisor. Every one of ADR
--     0070's five arguments is an argument about conservation or WAC.
--   * Intake has neither. A procurement_document_line is a record of WHAT A
--     VENDOR'S PAPER SAID, and vendors write "25.5 kg". There is no
--     valid_quantity_after on any table here and no cost divisor. Nothing that
--     integers were protecting exists on this side.
--
-- procurement_document_lines.qty is ALREADY numeric(12,3) — ADR 0070 cites it
-- approvingly as the source of the qty+uom pairing it adopted. The columns below
-- are simply the ones that were left behind, and the door writes to them:
-- recordDoorReceipt updates procurement_orders.quantity_received, so leaving it
-- `integer` would keep the door broken no matter what the CHECK said.
--
-- WHAT THIS COSTS, COUNTED RATHER THAN ESTIMATED (production, 2026-09-02)
--
--   * 0 views dropped. One view (v_pending_one_tap_actions) references these
--     tables; it selects no quantity column.
--   * 0 functions resignatured, 0 int locals. Exactly one function mentions
--     these tables (set_conversation_thread_key, a trigger); it touches no
--     quantity and declares no int local. This is the check ADR 0070 found
--     expensive on the ledger side (>=11 signatures, >=6 invisible int locals)
--     and it comes back empty here.
--   * Rows at risk: procurement_orders 2, procurement_order_items 1,
--     recurring_orders 0, procurement_document_lines 0,
--     procurement_receipt_events 0. Widening integer -> numeric(12,3) is
--     value-preserving for every one of them.
--
-- GATE: this file must not land before `fix/schema-parity-sees-what-it-claims`.
-- The parity check cannot currently see CHECK constraints and cannot tell
-- numeric(12,3) from bare numeric, so it is blind to BOTH halves of this
-- migration. Founder decision, 2026-09-02.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Refuse to proceed if anything unrecognised is already stored.
--
-- The same shape as 20260901150000's guard, and for the same reason: widening a
-- CHECK to accommodate a value nobody has explained is how a typo becomes a
-- permanent member of the vocabulary. Rows are near-zero today, so this will
-- almost certainly pass — "almost certainly" is why it is checked rather than
-- assumed.
-- -----------------------------------------------------------------------------
do $$
declare
  offenders text;
  known text[] := array[
    'bottle','case','keg','pack','split_case','each','ml','liter','g','kg'
  ];
begin
  select string_agg(distinct quote_literal(u), ', ')
    into offenders
    from (
      select uom          as u from public.procurement_document_lines
      union all
      select counted_uom  as u from public.procurement_receipt_events
      union all
      select unit_type    as u from public.procurement_orders
      union all
      select unit_type    as u from public.procurement_order_items
      union all
      select unit_type    as u from public.recurring_orders
    ) s
   where u is not null
     and u <> all (known);

  if offenders is not null then
    raise exception
      'Cannot widen the unit vocabulary: unrecognised value(s) % are already stored. Normalise each one explicitly; do not widen the CHECK to accommodate a typo.',
      offenders;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 2. One vocabulary, applied to all five columns.
--
-- Ordered by dimension, matching UOMS in
-- apps/api-gateway/src/procurement/documents/document-types.ts. The two halves
-- are held together by scripts/check_intake_units.py, which fails the build when
-- they disagree — the code half used to be duplicated by hand in two files and
-- that is exactly how a vocabulary drifts.
--
-- `ml` and `g` are the base units the ledger counts in (ADR 0070 requires
-- milligram-grade resolution for saffron at 0.1-0.5 g doses); `kg` and `liter`
-- are here because a receiver holding a 25 kg sack should type 25, not 25000.
-- Both spellings convert into the ledger EXACTLY — see toBaseUnits().
-- -----------------------------------------------------------------------------

alter table public.procurement_document_lines
  drop constraint if exists procurement_document_lines_uom_check,
  add  constraint procurement_document_lines_uom_check
       check (uom::text = any (array[
         'bottle','case','keg','pack','split_case','each','ml','liter','g','kg'
       ]::text[]));

alter table public.procurement_receipt_events
  drop constraint if exists procurement_receipt_events_uom_check,
  add  constraint procurement_receipt_events_uom_check
       check (counted_uom::text = any (array[
         'bottle','case','keg','pack','split_case','each','ml','liter','g','kg'
       ]::text[]));

alter table public.procurement_orders
  drop constraint if exists procurement_orders_unit_type_check,
  add  constraint procurement_orders_unit_type_check
       check (unit_type is null or unit_type::text = any (array[
         'bottle','case','keg','pack','split_case','each','ml','liter','g','kg'
       ]::text[]));

alter table public.procurement_order_items
  drop constraint if exists procurement_order_items_unit_type_check,
  add  constraint procurement_order_items_unit_type_check
       check (unit_type is null or unit_type::text = any (array[
         'bottle','case','keg','pack','split_case','each','ml','liter','g','kg'
       ]::text[]));

alter table public.recurring_orders
  drop constraint if exists recurring_orders_unit_type_check,
  add  constraint recurring_orders_unit_type_check
       check (unit_type::text = any (array[
         'bottle','case','keg','pack','split_case','each','ml','liter','g','kg'
       ]::text[]));

-- -----------------------------------------------------------------------------
-- 3. The quantity columns the door and the order path write.
--
-- numeric(12,3) is chosen to MATCH procurement_document_lines.qty exactly, not
-- picked afresh: an order quantity and the document line it is matched against
-- are compared directly, and two different precisions on the two sides of that
-- comparison would manufacture discrepancies out of representation alone.
--
-- Pack sizes (bottles_per_unit, pack_size) deliberately stay `integer`. A pack
-- size is a COUNT of things in a box; a fractional one is not a finer
-- measurement, it is a data-entry error, and integer is the constraint that
-- catches it.
-- -----------------------------------------------------------------------------

alter table public.procurement_orders
  alter column quantity          type numeric(12,3),
  alter column quantity_received type numeric(12,3),
  alter column bottles_total     type numeric(12,3);

-- procurement_order_items.total_bottles is a STORED GENERATED column over the
-- very column being widened:
--
--   total_bottles integer GENERATED ALWAYS AS (quantity * bottles_per_unit) STORED
--
-- Postgres refuses to alter a column a generated column reads:
--   ERROR: cannot alter type of a column used by a generated column
--
-- It appears in no schema-diff summary, in no view dependency list and in no
-- function body, so nothing this repo currently checks would have predicted it.
-- It was found by running this migration inside a transaction that rolled back,
-- which is the only reason it is handled here rather than at 3am on merge.
--
-- Dropping and recreating is safe and cheap: the column is STORED but wholly
-- derived, so recreating it recomputes every row from the two columns beside it.
-- It stays `numeric(12,3)` to match its inputs -- leaving it `integer` would
-- reintroduce exactly the silent rounding this migration exists to remove, one
-- level down and invisibly, since a generated column rounds without any writer
-- ever seeing it.
alter table public.procurement_order_items
  drop column total_bottles;

alter table public.procurement_order_items
  alter column quantity          type numeric(12,3),
  alter column quantity_received type numeric(12,3);

alter table public.procurement_order_items
  add column total_bottles numeric(12,3)
      generated always as (quantity * bottles_per_unit) stored;

alter table public.recurring_orders
  alter column quantity          type numeric(12,3);

-- -----------------------------------------------------------------------------
-- 4. A quantity is still positive, which `numeric` alone stopped guaranteeing.
--
-- `integer` never guaranteed it either, but the DTO's @IsInt()+@Min(1) pair did
-- most of the work and the column type made a whole number certain. Relaxing the
-- validator without adding this would leave 0 and negatives reachable through
-- any path that does not go through the DTO -- the recurring materialiser and
-- the retroactive importer both write these columns directly.
--
-- NOT NULL is preserved separately by the ALTERs above; `type` does not drop it.
-- -----------------------------------------------------------------------------

alter table public.procurement_orders
  drop constraint if exists procurement_orders_quantity_positive,
  add  constraint procurement_orders_quantity_positive
       check (quantity > 0);

alter table public.procurement_order_items
  drop constraint if exists procurement_order_items_quantity_positive,
  add  constraint procurement_order_items_quantity_positive
       check (quantity > 0);

alter table public.recurring_orders
  drop constraint if exists recurring_orders_quantity_positive,
  add  constraint recurring_orders_quantity_positive
       check (quantity > 0);

comment on column public.procurement_document_lines.uom is
  'Unit the VENDOR''S DOCUMENT stated, from the vocabulary in UOMS (document-types.ts). Count units (bottle/case/keg/pack/split_case/each) pair with an integer qty; mass (g/kg) and volume (ml/liter) may be fractional to three decimal places. The quantity is stored in THIS unit, not converted -- the row has to keep matching the paper it was read from.';

comment on column public.procurement_orders.quantity is
  'Quantity ordered, in unit_type. numeric(12,3) because a mass order is legitimately fractional (4.5 kg of flour). Three decimal places is the full precision: a quantity needing more must be restated in a finer unit (0.5 g, not 0.0005 kg), which the gateway refuses rather than rounding.';

commit;

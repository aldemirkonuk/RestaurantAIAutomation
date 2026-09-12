-- The door's facts get columns, and its rejected quantity gets a unit.
--
-- WHY NOW
-- -------
-- Two things were true of `procurement_receipt_events` at the same time:
--
--   1. `rejected_qty` had NO DECLARED UNIT anywhere — not in the column name, not
--      in the DTO, not in the service. `counted_qty` sits beside `counted_uom`
--      and `counted_qty_bottles`; `rejected_qty` sat beside nothing. The door
--      sent it in BOXES (`DoorNext.tsx`, `countedUom: 'case'` for both numbers)
--      and `recordDoorReceipt` subtracted it from a number in BOTTLES. Three
--      refused boxes at pack 12 booked 33 bottles of live stock for wine that was
--      turned away at the door. The row itself stored the mixed pair.
--
--   2. Everything else the door knows — the outcome, the refusal reason, who
--      signed, which driver, what was expected — was flattened into one prose
--      blob in `notes` that nothing has ever read back. `outcome` is a closed set
--      of three values on the client (`DoorModel.ts:219`) and `refusal_reason` a
--      closed set of four (`DoorModel.ts:227`); both arrived as free text.
--
-- This is the move `20260901150000_order_line_capture_and_units.sql` made for
-- `unit_type`: the client already has a closed vocabulary, so the column gets the
-- same vocabulary as a CHECK rather than trusting whatever string arrives.
--
-- MEASURED BEFORE WRITING, 2026-08-25 (`20260825200000_od73_close_anon_dml.sql:45`):
--
--   procurement_receipt_events | 0 rows | empty
--
-- A CHECK and a NOT NULL added to an empty table cost nothing. The same
-- constraints added to two years of door receipts are a data-cleanup project.
-- Nothing outside `receiving.service.ts` writes this table (grepped repo-wide),
-- so there is exactly one writer to keep in step with these columns.
--
-- ADDITIVE. Nothing is dropped. The one write against existing data is the
-- `rejected_qty_bottles` backfill in section 1, which derives each row's own pack
-- ratio from that row's own columns and touches zero rows in production.
set local statement_timeout = '120s';

-- ---------------------------------------------------------------------------
-- 1. The rejected quantity gets a unit, in the column name.
-- ---------------------------------------------------------------------------
-- The pairing that already existed for the counted quantity, completed:
--
--   counted_qty          -- in counted_uom
--   counted_qty_bottles  -- in bottles
--   rejected_qty         -- in counted_uom   <- was undeclared; now stated
--   rejected_qty_bottles -- in bottles       <- new, and the only one arithmetic
--                                               may touch
--
-- `rejected_qty` is NOT dropped and NOT re-scaled. It keeps the meaning the door
-- always intended for it — the number of units the receiver counted as refused,
-- in the unit they counted in — which is now stated in the column comment
-- instead of being inferable only from a comment in a React component.
alter table public.procurement_receipt_events
  add column if not exists rejected_qty_bottles numeric(12,3);

-- Derive the pack ratio from the row itself rather than from any order or
-- catalogue lookup: `counted_qty_bottles / counted_qty` is exactly the factor the
-- door applied to this event's own count, so applying it to this event's own
-- rejected count is arithmetic, not a guess. Rows where counted_qty is absent or
-- zero cannot have a non-zero rejection (the door caps rejected at counted), so
-- the 1:1 branch is unreachable for real rows and is there only so the backfill
-- can never leave a NULL behind before the NOT NULL below.
update public.procurement_receipt_events
   set rejected_qty_bottles =
         coalesce(rejected_qty, 0)
         * case
             when coalesce(counted_qty, 0) > 0 and coalesce(counted_qty_bottles, 0) > 0
               then counted_qty_bottles / counted_qty
             else 1
           end
 where rejected_qty_bottles is null;

alter table public.procurement_receipt_events
  alter column rejected_qty_bottles set default 0;

alter table public.procurement_receipt_events
  alter column rejected_qty_bottles set not null;

-- NOT NULL rather than nullable-with-a-default, deliberately. A nullable bottle
-- count would hand the running-total arithmetic in `recordDoorReceipt` a third
-- state — "rejected something, in an unknown unit" — and the only honest
-- treatments of that state are to refuse the whole receipt or to guess. The
-- table is empty, so the state can simply be made unreachable instead.
alter table public.procurement_receipt_events
  drop constraint if exists procurement_receipt_events_rejected_qty_bottles_check,
  add  constraint procurement_receipt_events_rejected_qty_bottles_check
       check (rejected_qty_bottles >= 0);

comment on column public.procurement_receipt_events.rejected_qty
  is 'Units refused at the door, IN counted_uom. Never in bottles — see rejected_qty_bottles.';
comment on column public.procurement_receipt_events.rejected_qty_bottles
  is 'Units refused at the door, in BOTTLES. The only rejected figure any arithmetic may use.';
comment on column public.procurement_receipt_events.counted_qty
  is 'Units counted at the door, IN counted_uom.';
comment on column public.procurement_receipt_events.counted_qty_bottles
  is 'Units counted at the door, in BOTTLES.';

-- ---------------------------------------------------------------------------
-- 2. The door's structured facts stop being prose.
-- ---------------------------------------------------------------------------
-- Every value below already exists as a closed enum or a bounded field on the
-- client. The vocabularies are copied VERBATIM from `DoorModel.ts` — `DoorOutcome`
-- (:219) and `RefusalReason` (:227) — rather than restated, for the same reason
-- `ORDER_UNIT_TYPES` mirrors its CHECK: two lists that must agree, one of which
-- only a migration can move.
alter table public.procurement_receipt_events
  add column if not exists outcome              varchar(20),
  add column if not exists refusal_reason       varchar(20),
  add column if not exists signed_by_initials   varchar(8),
  add column if not exists driver_name          varchar(120),
  add column if not exists expected_qty_bottles numeric(12,3);

alter table public.procurement_receipt_events
  drop constraint if exists procurement_receipt_events_outcome_check,
  add  constraint procurement_receipt_events_outcome_check
       check (outcome is null or outcome::text = any (array[
         'accepted','short','refused'
       ]::text[]));

alter table public.procurement_receipt_events
  drop constraint if exists procurement_receipt_events_refusal_reason_check,
  add  constraint procurement_receipt_events_refusal_reason_check
       check (refusal_reason is null or refusal_reason::text = any (array[
         'wrong_wine','broken_case','temperature','other'
       ]::text[]));

-- A reason without a refusal is a row that reads as a refusal to anyone
-- filtering on `refusal_reason is not null`. The client only ever offers the
-- reason buttons when the outcome is `refused` (`DoorNext.tsx`, the settle-rows
-- block keyed on `outcome === 'refused'`), so this constraint makes the column
-- pair say exactly what the screen says and nothing wider.
alter table public.procurement_receipt_events
  drop constraint if exists procurement_receipt_events_reason_needs_refusal_check,
  add  constraint procurement_receipt_events_reason_needs_refusal_check
       check (refusal_reason is null or outcome = 'refused');

alter table public.procurement_receipt_events
  drop constraint if exists procurement_receipt_events_expected_qty_bottles_check,
  add  constraint procurement_receipt_events_expected_qty_bottles_check
       check (expected_qty_bottles is null or expected_qty_bottles >= 0);

comment on column public.procurement_receipt_events.outcome
  is 'accepted | short | refused — the receiver''s word, mirroring DoorModel.DoorOutcome.';
comment on column public.procurement_receipt_events.refusal_reason
  is 'wrong_wine | broken_case | temperature | other. Only ever set when outcome = refused.';
comment on column public.procurement_receipt_events.signed_by_initials
  is 'Who signed at the door. Initials, upper-cased, no ceremony.';
comment on column public.procurement_receipt_events.driver_name
  is 'The driver present, as the receiver typed it. Free text by nature — a carrier''s driver is not in any table here.';
comment on column public.procurement_receipt_events.expected_qty_bottles
  is 'What the order expected, in BOTTLES, as the door understood it at the moment of the count.';

-- "Show me every refusal, and why" is the question these columns exist to make
-- answerable without reading prose. Partial, because refusals are the rare case
-- and the index has no business carrying every ordinary delivery.
create index if not exists idx_pre_outcome
  on public.procurement_receipt_events (restaurant_id, outcome, occurred_at desc)
  where outcome is not null;

-- ---------------------------------------------------------------------------
-- 3. The running total the door now derives.
-- ---------------------------------------------------------------------------
-- `recordDoorReceipt` sums accepted bottles across an order's door events rather
-- than trusting `procurement_orders.quantity_received`, so that a second truck on
-- the same order adds to the first instead of overwriting it. That sum runs on
-- every door receipt and `idx_pre_order` covers order_id alone, without the
-- restaurant scoping or the stage filter the query actually uses.
create index if not exists idx_pre_order_stage
  on public.procurement_receipt_events (restaurant_id, order_id, stage);

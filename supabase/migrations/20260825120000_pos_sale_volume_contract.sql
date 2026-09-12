-- POS sale-volume contract (ADR 0011).
--
-- Yesterday's fix made `upsertItemMapping` write `sale_unit` at all. It did not
-- help the stock that is already there: all 92 production `pos_item_mappings`
-- rows are `sale_unit = null`, every one of them is wine with an
-- `inventory_id`, and `it.sale_unit ?? "bottle"` in applyStockEffects booked a
-- whole 750ml bottle for each of them — 5x over-depletion on every
-- by-the-glass sale, silently.
--
-- The founder's call: stop modelling this as a two-value enum. A sale removes
-- an ARBITRARY volume — a glass, a half bottle, a magnum, a carafe, a taster,
-- a flight pour — and the database layer has always been able to express that:
-- `record_glass_pour(p_inventory_id, p_pours, p_pour_ml, ...)` has taken a
-- free-form pour volume in ml since the baseline
-- (20260805000000_baseline_from_production.sql:1132). Only the app layer was
-- binary. This migration gives the mapping table somewhere to put the number.
--
-- NOT APPLIED TO PRODUCTION. Written for review; the founder applies it.

-- ---------------------------------------------------------------------------
-- 1. pos_item_mappings.sale_volume_ml — the truth
-- ---------------------------------------------------------------------------
-- How much stock ONE sale of this POS item removes, in millilitres. Nullable,
-- and null is honest: it means "nobody has said yet", which now routes the line
-- to the review queue instead of to a guess.
alter table public.pos_item_mappings
  add column if not exists sale_volume_ml numeric;

comment on column public.pos_item_mappings.sale_volume_ml is
  'Millilitres of stock removed by ONE sale of this POS item. Authoritative: '
  'resolution order is sale_volume_ml -> sale_unit (glass=pour_size_ml, '
  'bottle=whole bottle) -> queue the line and deplete nothing. NULL means '
  'undecided, never "assume a bottle" (ADR 0011).';

-- The plausibility band exists to catch one specific mistake: 1.5 entered into
-- an ml field while meaning 1.5 LITRES. A bare `> 0` check accepts it and the
-- item then pours 1.5ml per sale forever — the same class of silent error this
-- whole migration is closing, in the opposite direction. 10ml is below any real
-- serving; 30 000ml is a Melchizedek, and nothing is poured from more.
alter table public.pos_item_mappings
  drop constraint if exists pos_item_mappings_sale_volume_ml_check;
alter table public.pos_item_mappings
  add constraint pos_item_mappings_sale_volume_ml_check
  check (sale_volume_ml is null or (sale_volume_ml >= 10 and sale_volume_ml <= 30000));

-- ---------------------------------------------------------------------------
-- 2. pos_item_mappings.sale_unit — an open human label
-- ---------------------------------------------------------------------------
-- Was varchar(10) with CHECK (sale_unit IN ('glass','bottle'))
-- (20260805132000_counting_catalog_and_correlation_columns.sql:39). Both halves
-- of that have to go:
--
--   * the CHECK, because 'half_bottle', 'magnum', 'carafe', 'taster' and
--     'flight' are all real things a restaurant sells and none of them fit;
--   * varchar(10), because 'half_bottle' is eleven characters. Dropping only
--     the CHECK would have traded a rejected value for a truncation error.
--
-- What sale_unit is NOT, from here on, is arithmetic. It is what the label
-- says on the mapping row and in reports. Only 'glass' and 'bottle' still carry
-- a derivation, and only as the fallback when sale_volume_ml is null — kept
-- because those two are the only labels whose volume the inventory row already
-- knows (pour_size_ml, bottle_size_ml).
alter table public.pos_item_mappings
  drop constraint if exists pos_item_mappings_sale_unit_check;

alter table public.pos_item_mappings
  alter column sale_unit type text;

-- Still rejected: blank. An empty or whitespace-only label is a caller bug, not
-- a word anyone chose, and it would render as "mapped" in the review UI while
-- meaning nothing. Length is bounded so the column stays a label, not a note.
alter table public.pos_item_mappings
  add constraint pos_item_mappings_sale_unit_check
  check (sale_unit is null or (btrim(sale_unit) <> '' and length(sale_unit) <= 32));

comment on column public.pos_item_mappings.sale_unit is
  'Open human label for how this item is sold — glass, bottle, half_bottle, '
  'magnum, carafe, taster, flight, ... For reporting and UI only. NEVER used '
  'for arithmetic except as the sale_volume_ml fallback for the two labels the '
  'inventory row can size: glass -> pour_size_ml, bottle -> whole bottle '
  '(ADR 0011).';

-- Deliberately NO BACKFILL. The 92 existing rows stay sale_unit = null /
-- sale_volume_ml = null, and every sale of them will queue in
-- pos_unresolved_lines until a human sets a volume. Backfilling 'bottle' is
-- exactly the defect being removed, and backfilling 'glass' would be the same
-- guess pointed the other way. The queue is the cost, and it is the point.

-- ---------------------------------------------------------------------------
-- 3. pos_unresolved_lines.reason — keep the queue answerable
-- ---------------------------------------------------------------------------
-- The queue now receives two populations that were previously one:
--
--   unmapped        — no pos_item_mappings row resolves this line to stock.
--                     The question for the reviewer is "what wine is this?"
--   no_sale_volume  — the line IS mapped, the inventory row is known, but
--                     nothing says how much one sale removes. The question is
--                     "how much of it does one of these pour?"
--
-- Without a discriminator the reviewer gets one undifferentiated pile and the
-- second population reads as a mapping failure it is not — which would make the
-- queue useless at precisely the moment it fills up with all 92 rows.
alter table public.pos_unresolved_lines
  add column if not exists reason text not null default 'unmapped';

alter table public.pos_unresolved_lines
  drop constraint if exists pos_unresolved_lines_reason_check;
alter table public.pos_unresolved_lines
  add constraint pos_unresolved_lines_reason_check
  check (reason in ('unmapped', 'no_sale_volume'));

comment on column public.pos_unresolved_lines.reason is
  'Why the pipeline refused to act on this line. unmapped = no mapping row; '
  'no_sale_volume = mapped, but sale_volume_ml/sale_unit resolve to nothing so '
  'the depletion failed closed (ADR 0011). DEFAULT unmapped is correct for '
  'every row written before this migration — that was the only reason then.';

-- The inventory row a no_sale_volume line already resolved to, so the review
-- surface can ask its narrower question without re-deriving the mapping.
-- Null for unmapped lines, by construction.
alter table public.pos_unresolved_lines
  add column if not exists mapped_inventory_id uuid;

comment on column public.pos_unresolved_lines.mapped_inventory_id is
  'For reason = no_sale_volume: the restaurant_inventory row this line already '
  'maps to. NULL when reason = unmapped, where the mapping is the open '
  'question. Distinct from resolved_inventory_id, which is what a human '
  'DECIDED; this is what the pipeline already KNEW.';

-- The dedupe index gains `reason`. Without it, a line still open as `unmapped`
-- from before it was mapped would swallow the `no_sale_volume` insert that
-- follows once someone maps it but sets no volume — the newer and more
-- actionable problem would be suppressed by the older one, and silently, since
-- the service treats 23505 here as "already queued".
drop index if exists public.idx_pos_unresolved_lines_dedupe;
create unique index idx_pos_unresolved_lines_dedupe
    on public.pos_unresolved_lines
       (restaurant_id, source, external_check_id, external_item_id, reason)
    where not resolved;

-- Known and deliberately left alone: external_item_id is nullable, and a UNIQUE
-- index treats NULLs as distinct, so a POS that sends no item id still piles up
-- one queue row per replay. That predates this change and fixing it means
-- deciding what identity a name-only line has — a separate decision, recorded
-- in ADR 0011's Consequences rather than smuggled in here.

-- A ledger quantity states its own unit, and the unit belongs to the item.
--
-- Implements ADR 0070 (Locked, 2026-09-02) — "A quantity states its own unit,
-- and stays an integer" — and ADR 0075, which settles the three things 0070
-- left open: the vocabulary, the enforcement mechanism, and the allocation
-- algorithm.
--
-- VERSION NOTE (read this before renumbering anything)
-- ---------------------------------------------------
-- This file was commissioned as `20260902100000_...`. That version was ALREADY
-- TAKEN on origin/main by `20260902100000_calendar_events_recurring_order_link.sql`
-- (commit 4b2a60d5), so using it would have produced exactly the collision the
-- instruction existed to prevent — `schema_migrations` keys on `version`, and a
-- duplicate surfaces as "Fresh database equals remote", a message that says
-- drift when the truth is a collision (CLAUDE.md 5b). `20260902110000` is
-- reserved for the concurrent intake-vocabulary migration. `20260902120000` is
-- past everything on every ref as of 2026-09-02.
--
-- WHY NOW, AND WHY THIS IS CHEAP
-- ------------------------------
-- Measured against production on 2026-09-02:
--
--   restaurant_inventory        72 rows  (stock_live = 0 on 71 of them)
--   inventory_lots               2 rows
--   inventory_transactions       4 rows
--   procurement_document_lines   0 rows
--
-- The ledger is effectively empty. Every row it will ever hold is written after
-- this migration, which is the only moment a unit column is free. The same
-- column added against two years of movements is a data-archaeology project
-- with no answer — a stored `25` cannot tell you afterwards whether it meant
-- grams or kilograms.
--
-- WHAT WAS BROKEN
-- ---------------
-- `inventory_lots.qty` and `inventory_transactions.quantity_before/after/change`
-- are `integer NOT NULL` and carry NO unit column at all. The unit was supplied
-- entirely by a `master_wine_id` FK meaning "bottles". Food is therefore
-- unrepresentable: there is no way to write 4.5 kg of flour, and no way for a
-- reader to know what a bare `25` meant.
--
-- ADR 0070 chose integer quantities plus a stated unit over widening the columns
-- to `numeric(12,3)`, because under integer arithmetic `before + change = after`
-- is EXACT, whereas `numeric(12,3)` makes `valid_quantity_after` pass over both
-- a create-from-nothing (0.6 g stored as 0.001 kg) and a destroy, and feeds a
-- 0.001 residue into `inventory_lot_rollup`'s weighted-average-cost divisor —
-- which is guarded only by `sum(qty) > 0` and would inflate WAC ~1000x into
-- COGS and menu pricing. Read 0070 for the full argument; it is not restated
-- here.
--
-- ADDITIVE. Nothing is dropped, no column changes type, no view is dropped, no
-- function is resignatured, and no existing INSERT statement is rewritten. The
-- only DML is the backfill of the three new columns.
set local statement_timeout = '120s';

-- ---------------------------------------------------------------------------
-- 1. The vocabulary: four base units, three dimensions, all irreducible.
-- ---------------------------------------------------------------------------
-- ADR 0075 decides this list. The rule that generated it: a ledger row stores a
-- BASE unit — one that cannot be decomposed into a smaller one of the same
-- dimension, and whose meaning does not depend on a pack size, a bottle format,
-- or a serving policy.
--
--   each    count   one discrete item (a lime, an egg, a portion pack)
--   bottle  count   one bottle. Kept because all 72 production rows mean this,
--                   and because `open_bottle_ml` makes a bottle a first-class
--                   container here rather than a synonym for `each`.
--   mg      mass    milligrams. NOT grams: saffron doses at 0.1-0.5 g, truffle
--                   at 2-5 g, vanilla and gold leaf. At gram resolution a 0.1 g
--                   saffron movement rounds to zero and is REJECTED by
--                   `valid_quantity_change`, so the system is unusable for that
--                   ingredient class, not merely lossy.
--   ml      volume  millilitres. The repo's existing volume unit everywhere
--                   (`open_bottle_ml`, `current_volume_ml`, `pour_size_ml`,
--                   `bottle_size_ml`, `format_ml`), so the ledger and its
--                   neighbours convert 1:1 and no boundary can be off by 1000x.
--
-- WHAT IS DELIBERATELY ABSENT, and why:
--
--   case, pack, split_case, keg — pack units, not base units. Their size varies
--     per vendor and per line. Admitting them would put pack arithmetic inside
--     the ledger, which is the exact bug `toBottles` exists to prevent at
--     intake. Intake keeps them; the boundary converts.
--   g, kg, l, oz — coarser units of a dimension we already have a base for.
--     Admitting BOTH `g` and `kg` is precisely the failure ADR 0070 10.5
--     identified: the same flour logged in `g` on one delivery and `kg` on the
--     next makes `SUM(qty)` add 25 to 25000 with no constraint violation. The
--     operator still types "4.5 kg"; `ledger-units.ts` converts at the edge.
--   SHOT, GLASS — serving units, derived from ml by a pour policy. They
--     describe how an item is SOLD, which is what `restaurant_inventory.unit_type`
--     already records; they are not how stock is counted.
--   ul (microlitres) — the documented extension point. A drop (~0.05 ml) or a
--     dash of bitters (~0.9 ml) is at or under the ml floor. Unlike the saffron
--     case those movements are REFUSED rather than silently mis-stored, which is
--     the correct failure mode (ADR 0051), and shipping `ul` today would put
--     every volume row 1000x away from every existing `_ml` column in the
--     codebase forever. Adding it later is one line here plus one factor in
--     `ledger-units.ts`, and per-item canonical units mean old rows are
--     unaffected. See ADR 0075's revisit trigger.
--
-- Kept in sync with LEDGER_UOMS in
-- `apps/api-gateway/src/inventory-ledger/ledger-units.ts`; a unit test asserts
-- the two lists agree, and `scripts/check_ledger_units.py` fails CI if they
-- drift.

-- ---------------------------------------------------------------------------
-- 2. The canonical unit belongs to the ITEM.
-- ---------------------------------------------------------------------------
-- `uom NOT NULL` on a row requires *a* unit, not a *consistent* one. ADR 0070
-- makes the per-item canonical unit part of the decision, not an optimisation
-- of it, because `trg_project_stock_from_lots` sums lots per `inventory_id`:
-- one lot in `g` and the next in `kg` projects a nonsense on-hand figure with
-- no error anywhere.

alter table public.restaurant_inventory
  add column if not exists canonical_uom character varying(16);

-- Backfill: every existing row is 'bottle', unconditionally.
--
-- This is not an assumption from `unit_type`. `unit_type` is CHECK-constrained
-- to {BOTTLE, CASE, SHOT, GLASS} and describes how the item is SOLD. What the
-- LOTS count is bottles in every case: `apply_stock_movement` inserts
-- `qty = p_delta` as whole units and `record_glass_pour` decrements `qty` by
-- whole bottles while the remainder lives in `open_bottle_ml`. A SHOT-sold item
-- still has its stock counted in sealed bottles. `master_wine_id` is NOT NULL on
-- this table, so there is no non-wine row to consider.
update public.restaurant_inventory
   set canonical_uom = 'bottle'
 where canonical_uom is null;

alter table public.restaurant_inventory
  alter column canonical_uom set default 'bottle',
  alter column canonical_uom set not null;

-- The DEFAULT is 'bottle' rather than absent because three call sites in
-- `inventory.service.ts` insert a `restaurant_inventory` row with a
-- `stock_live: 0` placeholder and no unit, and every such row today is wine.
-- A food item must set it explicitly; ADR 0075 records that the default becomes
-- wrong the moment non-wine items exist and names removing it as the trigger.
alter table public.restaurant_inventory
  drop constraint if exists restaurant_inventory_canonical_uom_check;
alter table public.restaurant_inventory
  add  constraint restaurant_inventory_canonical_uom_check
       check (canonical_uom::text = any (array[
         'each'::text, 'bottle'::text, 'mg'::text, 'ml'::text
       ]));

comment on column public.restaurant_inventory.canonical_uom is
  'The base unit every ledger quantity for this item is stored in (ADR 0070, '
  'ADR 0075). Lots are pinned to it by a composite foreign key, so it cannot be '
  'changed while lots exist — re-basing an item is a deliberate rescale, not an '
  'UPDATE. Distinct from unit_type, which says how the item is SOLD.';

-- Target for the composite foreign key below. `id` is already the primary key,
-- so this adds no uniqueness that did not exist; a foreign key may only
-- reference a unique constraint, and the pair is what we need to reference.
alter table public.restaurant_inventory
  drop constraint if exists restaurant_inventory_id_canonical_uom_key;
alter table public.restaurant_inventory
  add  constraint restaurant_inventory_id_canonical_uom_key
       unique (id, canonical_uom);

-- ---------------------------------------------------------------------------
-- 3. Every ledger row states its unit.
-- ---------------------------------------------------------------------------
-- NO DEFAULT on either column. A default is how a writer that forgot the unit
-- gets a confident wrong answer; the BEFORE trigger in section 4 fills the
-- column from the item instead, which is the only source that can be right.

alter table public.inventory_lots
  add column if not exists uom character varying(16);

alter table public.inventory_transactions
  add column if not exists uom character varying(16);

-- Backfill from the item where there is one. `inventory_lots.inventory_id` is
-- nullable (baseline:3174), so a lot with no item falls back to 'bottle' —
-- correct today because `master_wine_id` is NOT NULL on lots too, and every
-- such lot is a bottle lot.
update public.inventory_lots l
   set uom = coalesce(
       (select ri.canonical_uom from public.restaurant_inventory ri where ri.id = l.inventory_id),
       'bottle')
 where l.uom is null;

update public.inventory_transactions t
   set uom = coalesce(
       (select ri.canonical_uom from public.restaurant_inventory ri where ri.id = t.inventory_id),
       'bottle')
 where t.uom is null;

alter table public.inventory_lots
  alter column uom set not null;
alter table public.inventory_transactions
  alter column uom set not null;

alter table public.inventory_lots
  drop constraint if exists inventory_lots_uom_check;
alter table public.inventory_lots
  add  constraint inventory_lots_uom_check
       check (uom::text = any (array[
         'each'::text, 'bottle'::text, 'mg'::text, 'ml'::text
       ]));

alter table public.inventory_transactions
  drop constraint if exists inventory_transactions_uom_check;
alter table public.inventory_transactions
  add  constraint inventory_transactions_uom_check
       check (uom::text = any (array[
         'each'::text, 'bottle'::text, 'mg'::text, 'ml'::text
       ]));

comment on column public.inventory_lots.uom is
  'Base unit of qty. Filled from restaurant_inventory.canonical_uom by '
  'trg_ledger_uom_from_item and pinned to it by '
  'inventory_lots_item_uom_fkey — a lot can never disagree with its item.';

comment on column public.inventory_transactions.uom is
  'Base unit of quantity_before/after/change. Filled from '
  'restaurant_inventory.canonical_uom by trg_ledger_uom_from_item. No foreign '
  'key here deliberately: a ledger row is an audit record and must outlive the '
  'item it describes, so it keeps the unit that was true when it was written.';

-- ---------------------------------------------------------------------------
-- 4. Enforcement: fill from the item, or refuse.
-- ---------------------------------------------------------------------------
-- ADR 0075 chooses fill-from-item over three alternatives:
--
--   a) A bare CHECK cannot reference another table. Dead on arrival.
--   b) A composite FK ALONE would make every existing INSERT fail, because none
--      of them supplies a unit — `apply_stock_movement`, `transfer_stock`,
--      `record_glass_pour`, `log_inventory_change` and `sync_lots_from_inventory`
--      would all have to be rewritten, which is precisely the rebuild cost ADR
--      0070 chose this option to avoid.
--   c) Passing the unit in as a new RPC parameter would make the unit an INPUT.
--      The whole point of "the unit belongs to the item" is that a writer is
--      never asked — it is looked up. A writer that can state a unit is a writer
--      that can state the wrong one.
--
-- So: a BEFORE trigger fills the column from the item, and RAISEs if a caller
-- supplied one that disagrees. Zero existing function bodies change. A composite
-- foreign key on `inventory_lots` sits underneath as a declarative backstop
-- against any path that bypasses the trigger.

create or replace function public.ledger_uom_from_item() returns trigger
    language plpgsql
    as $$
DECLARE
  v_canonical text;
BEGIN
  IF NEW.inventory_id IS NOT NULL THEN
    SELECT ri.canonical_uom INTO v_canonical
      FROM public.restaurant_inventory ri
     WHERE ri.id = NEW.inventory_id;
  END IF;

  IF NEW.uom IS NULL THEN
    IF v_canonical IS NULL THEN
      -- No item to inherit from and no unit stated. Refusing is the whole
      -- point: a quantity with no unit is not a measurement (ADR 0051).
      RAISE EXCEPTION
        'ledger row on % has no uom and no item to take one from (inventory_id is %)',
        TG_TABLE_NAME, COALESCE(NEW.inventory_id::text, 'NULL')
        USING ERRCODE = '23514';
    END IF;
    NEW.uom := v_canonical;
    RETURN NEW;
  END IF;

  IF v_canonical IS NOT NULL AND NEW.uom::text <> v_canonical THEN
    -- This is the 25-vs-25000 failure ADR 0070 10.5 names. It has no
    -- constraint violation and no error of its own; this is the error.
    RAISE EXCEPTION
      'uom % disagrees with the item, whose canonical unit is % (inventory_id %). '
      'Convert the quantity into that base unit, or re-base the item '
      'deliberately — do not relabel the row.',
      NEW.uom, v_canonical, NEW.inventory_id
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

comment on function public.ledger_uom_from_item() is
  'BEFORE INSERT/UPDATE on the ledger tables: fills uom from '
  'restaurant_inventory.canonical_uom, and refuses a row whose stated uom '
  'disagrees with it. ADR 0070 / ADR 0075. NOT NULL is checked after BEFORE '
  'triggers run, which is what lets every existing INSERT keep working '
  'unchanged.';

drop trigger if exists trg_ledger_uom_from_item on public.inventory_lots;
create trigger trg_ledger_uom_from_item
  before insert or update of uom, inventory_id on public.inventory_lots
  for each row execute function public.ledger_uom_from_item();

drop trigger if exists trg_ledger_uom_from_item on public.inventory_transactions;
create trigger trg_ledger_uom_from_item
  before insert or update of uom, inventory_id on public.inventory_transactions
  for each row execute function public.ledger_uom_from_item();

-- The declarative backstop. `ON DELETE CASCADE` matches the existing
-- `inventory_lots_inventory_id_fkey` (baseline:12686) exactly, so this adds no
-- delete-time behaviour that was not already there.
--
-- `ON UPDATE RESTRICT` is load-bearing and CASCADE would be a data-corruption
-- bug: cascading a canonical_uom change would relabel a lot's `uom` from 'mg'
-- to 'ml' WITHOUT rescaling `qty`. RESTRICT instead blocks the parent update
-- until the lots are converted, which makes re-basing an item an explicit
-- rescale rather than a silent one.
--
-- Note MATCH SIMPLE: a lot with `inventory_id IS NULL` satisfies this key
-- vacuously. Those rows are covered by `uom NOT NULL` and by the trigger's
-- refusal above, not by this constraint.
alter table public.inventory_lots
  drop constraint if exists inventory_lots_item_uom_fkey;
alter table public.inventory_lots
  add  constraint inventory_lots_item_uom_fkey
       foreign key (inventory_id, uom)
       references public.restaurant_inventory (id, canonical_uom)
       on update restrict on delete cascade;

-- Supporting index for the composite key. Without it every
-- `restaurant_inventory` delete or canonical_uom update seq-scans the lots.
create index if not exists idx_inventory_lots_inventory_uom
  on public.inventory_lots (inventory_id, uom);

-- No composite foreign key on `inventory_transactions`, deliberately. That
-- table has NO foreign key on `inventory_id` today (baseline:12702 declares
-- only restaurant_id), so adding one would introduce delete-time coupling that
-- does not exist: `ON DELETE CASCADE` would destroy ledger history when an item
-- is deleted or merged, and `NO ACTION` would block deletes and merges that
-- succeed today. The trigger gives the same disagreement guarantee without
-- either. A ledger row is an audit record; it must outlive its subject.

-- ---------------------------------------------------------------------------
-- 5. Aggregates convert or refuse. They never silently sum.
-- ---------------------------------------------------------------------------
-- `inventory_lot_rollup` groups by `inventory_id`, and section 4 pins one unit
-- per item, so every group is single-unit BY CONSTRUCTION. That is a claim, and
-- a claim that nothing re-checks is a claim that rots (CLAUDE.md 5b) — so the
-- view now proves it per row instead of asserting it once here.
--
-- `uom` is NULL exactly when a group is mixed, which is the em dash of ADR 0051
-- rather than a zero, and `distinct_uom_count` is the one-query detector ADR
-- 0070 10.5 asked for, evaluated on every read.
--
-- The two new columns are appended at the end of `inventory_lot_rollup`. `uom`
-- is NULL exactly when a group is mixed, which is the em dash of ADR 0051
-- rather than a zero, and `distinct_uom_count` is the one-query detector ADR
-- 0070 §10.5 asked for, evaluated on every read instead of once by hand.
--
-- The DDL itself is in section 6, which touches the same view for the
-- mark-not-delete change — one `CREATE OR REPLACE` rather than two, so there is
-- exactly one definition of the view in this file to review.
--
-- CREATE OR REPLACE VIEW, appending columns at the end: the view is NOT dropped,
-- its existing columns keep their names, types and positions, and the dependent
-- view at baseline:3351 is untouched. ADR 0070's "0 of 9 views dropped" holds.

comment on view public.inventory_lot_rollup is
  'Per-item lot rollup. live_qty/shadow_qty/sample_qty are counts in the unit '
  'named by uom. uom IS NULL means distinct_uom_count > 1 — a mixed-unit group '
  'whose sums are meaningless; render an em dash, never a number (ADR 0051). '
  'Section 4 of 20260902120000 makes that impossible, and this column is how '
  'you would find out if it stopped being.';

-- ---------------------------------------------------------------------------
-- 6. A depleted lot is marked, not deleted.
-- ---------------------------------------------------------------------------
-- Folded in on founder instruction, 2026-09-02, because it edits the same
-- function and splitting it would mean two migrations rewriting one body.
--
-- `apply_stock_movement`'s FIFO loop DELETEs a lot that a draw exactly empties
-- (`20260805130000:97`). Three consequences, each verified against this tree:
--
--   1. `inventory_lots.status` declares 'depleted' in its CHECK
--      (baseline:3191) and NOTHING in the migration set ever sets it. There has
--      never been a depleted lot, because a depleted lot does not survive to be
--      marked. `analytics/engine/cost-basis.ts` already filters on that status —
--      a branch that has been dead since it was written.
--   2. Any foreign key to an input lot is unstable by construction, which
--      blocks the L2 transformation primitive being designed in parallel: it
--      needs to anchor "this carrot lot became that peeled-carrot lot" at lot
--      grain, and the input row disappears at the moment of transformation.
--   3. The cost actually consumed is discarded. The ledger INSERT records
--      `p_unit_cost` — the CALLER's parameter — not the `unit_cost` of the lot
--      the draw consumed, and after the DELETE the lot's own cost is gone. This
--      makes both sides of OD-114's costing fork uncomputable, not just one.
--
-- SWEPT BEFORE CHANGING IT. Zero-quantity rows now persist, so every consumer
-- that filtered on PRESENCE rather than on `qty > 0` had to be found:
--
--   * The FIFO loop itself already selects `... AND qty > 0` and orders by
--     received_at — a marked lot is skipped. Confirmed, unchanged.
--   * `project_stock_from_lots`, `set_stock_absolute`, `transfer_stock` and
--     `apply_stock_movement`'s own before/after reads all use `SUM(qty)`, to
--     which a zero contributes nothing. Confirmed, unchanged.
--   * `record_glass_pour` selects `(open_bottle_ml > 0 OR qty > 0)`, so a fully
--     empty marked lot is skipped and one with wine left in an open bottle is
--     still found. Confirmed, unchanged — and see the note on open_bottle_ml
--     below, which this repairs.
--   * `inventory_lot_rollup` needed three edits, below: `live_lot_count`,
--     `live_location_count` and `has_invoice_cost` all count or test PRESENCE.
--     Left alone, an emptied lot would keep inflating the lot count, keep
--     claiming a location holds stock, and keep answering "yes, we have an
--     invoice cost for what is on hand". Its `sum(qty)` figures and its
--     `sum(qty) > 0` WAC divide-guard are unaffected: a zero adds nothing to
--     either the numerator or the divisor.
--   * `inventory_location_breakdown` (baseline:3419) is read by
--     `inventory.service.ts#fetchLocationBreakdown`, which pushes EVERY row to
--     the UI as "this wine is at this location". A location holding only
--     emptied lots would become a ghost entry reading 0. `HAVING sum(qty) > 0`
--     below; a location holding zero is not a holding.
--   * NOTHING references `inventory_lots` by foreign key — no child table, no
--     cascade, no uniqueness assumption depends on the row disappearing.
--     Verified across the whole migration set.
--
-- ROW GROWTH. Lots accumulate instead of vanishing. One row per lot ever fully
-- drawn: a 500-item restaurant depleting two lots per item per week adds ~52k
-- rows a year, which is nothing for Postgres but does lengthen the FIFO scan,
-- since `idx_inventory_lots_inv` is a plain index on `inventory_id` and every
-- depleted row still sits under it. The partial index below covers the loop's
-- exact predicate and ordering, and excludes depleted rows from the index
-- entirely.
--
-- A REPAIR THAT FALLS OUT OF THIS. The DELETE destroyed `open_bottle_ml` along
-- with the row: a lot at `qty = 1, open_bottle_ml = 400` drawn by 1 lost the
-- 400 ml silently. Marking preserves it, which is why 'depleted' is set only
-- when the open bottle is empty too — a lot with wine left in an open bottle is
-- not depleted, whatever its sealed count says.
--
-- Copied verbatim from `20260805130000_extend_apply_stock_movement.sql:31-118`,
-- the live definition, with ONE changed branch. The signature is byte-identical,
-- so this is a body replacement and not a resignature: every named-argument
-- call site keeps working and no overload is created. `uom` is deliberately NOT
-- added to the INSERT — section 4's trigger fills it, which is the whole point
-- of the unit belonging to the item rather than to the writer.

CREATE OR REPLACE FUNCTION public.apply_stock_movement(
    p_inventory_id uuid,
    p_stock_state text,
    p_delta integer,
    p_transaction_type text,
    p_source text,
    p_performed_by uuid DEFAULT NULL::uuid,
    p_reason text DEFAULT NULL::text,
    p_unit_cost numeric DEFAULT NULL::numeric,
    p_location_id uuid DEFAULT NULL::uuid,
    p_order_id uuid DEFAULT NULL::uuid,
    p_idempotency_key text DEFAULT NULL::text,
    p_cost_provenance text DEFAULT NULL::text,
    p_reference_type text DEFAULT NULL::text,
    p_reference_id uuid DEFAULT NULL::uuid,
    p_pos_transaction_id text DEFAULT NULL::text,
    p_notes text DEFAULT NULL::text,
    p_metadata jsonb DEFAULT NULL::jsonb
) RETURNS uuid
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_restaurant uuid; v_wine uuid;
  v_before int; v_after int; v_remaining int; v_txn uuid; v_lot record;
  v_provenance text;
BEGIN
  IF p_delta = 0 THEN RETURN NULL; END IF;
  IF p_stock_state NOT IN ('live','shadow') THEN RAISE EXCEPTION 'invalid stock_state %', p_stock_state; END IF;

  IF p_cost_provenance IS NOT NULL
     AND p_cost_provenance NOT IN ('invoice','estimated','manual','sample') THEN
    RAISE EXCEPTION 'invalid cost_provenance %', p_cost_provenance;
  END IF;

  v_provenance := COALESCE(
    p_cost_provenance,
    CASE WHEN p_unit_cost IS NOT NULL THEN 'invoice' ELSE 'estimated' END
  );

  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_txn FROM inventory_transactions WHERE idempotency_key = p_idempotency_key LIMIT 1;
    IF v_txn IS NOT NULL THEN RETURN v_txn; END IF;
  END IF;

  SELECT restaurant_id, master_wine_id INTO v_restaurant, v_wine
    FROM restaurant_inventory WHERE id = p_inventory_id FOR UPDATE;
  IF v_restaurant IS NULL THEN RAISE EXCEPTION 'inventory % not found', p_inventory_id; END IF;

  SELECT COALESCE(SUM(qty),0) INTO v_before FROM inventory_lots
    WHERE inventory_id = p_inventory_id AND stock_state = p_stock_state;
  v_after := v_before + p_delta;
  IF v_after < 0 THEN RAISE EXCEPTION 'stock would go negative: % + %', v_before, p_delta; END IF;

  IF p_delta > 0 THEN
    INSERT INTO inventory_lots (restaurant_id, inventory_id, master_wine_id, location_id, stock_state, qty, unit_cost, cost_provenance, source_order_id)
    VALUES (v_restaurant, p_inventory_id, v_wine, p_location_id, p_stock_state, p_delta, p_unit_cost,
            v_provenance, p_order_id);
  ELSE
    v_remaining := -p_delta;
    FOR v_lot IN SELECT id, qty FROM inventory_lots
        WHERE inventory_id = p_inventory_id AND stock_state = p_stock_state AND qty > 0
        ORDER BY received_at ASC, created_at ASC LOOP
      EXIT WHEN v_remaining <= 0;
      IF v_lot.qty <= v_remaining THEN
        v_remaining := v_remaining - v_lot.qty;
        -- CHANGED 2026-09-02: was `DELETE FROM inventory_lots WHERE id = v_lot.id`.
        -- The row is now marked rather than erased, so the lot id survives for a
        -- transformation to point at, `status = 'depleted'` finally means
        -- something, and the lot's own unit_cost is still there to be read.
        -- 'depleted' only when the open bottle is empty too: a lot with wine
        -- left in an open bottle has not been depleted, whatever its sealed
        -- count says.
        UPDATE inventory_lots
           SET qty = 0,
               status = CASE WHEN open_bottle_ml > 0 THEN status ELSE 'depleted' END,
               updated_at = now()
         WHERE id = v_lot.id;
      ELSE
        UPDATE inventory_lots SET qty = qty - v_remaining, updated_at = now() WHERE id = v_lot.id;
        v_remaining := 0;
      END IF;
    END LOOP;
  END IF;

  INSERT INTO inventory_transactions
    (restaurant_id, inventory_id, wine_id, transaction_type, source, quantity_change, quantity_before, quantity_after,
     stock_type, unit_cost, performed_by, performed_by_type, reason, order_id, idempotency_key, transaction_date,
     reference_type, reference_id, pos_transaction_id, notes, metadata)
  VALUES
    (v_restaurant, p_inventory_id, v_wine, p_transaction_type::inventory_transaction_type, p_source::inventory_transaction_source,
     p_delta, v_before, v_after, p_stock_state, p_unit_cost, p_performed_by,
     CASE WHEN p_performed_by IS NOT NULL THEN 'user' ELSE 'system' END,
     p_reason, p_order_id, p_idempotency_key, now(),
     p_reference_type, p_reference_id, p_pos_transaction_id, p_notes, COALESCE(p_metadata, '{}'::jsonb))
  RETURNING id INTO v_txn;

  RETURN v_txn;
END;
$$;

COMMENT ON FUNCTION public.apply_stock_movement IS
  'Single stock write primitive (SimPOS testbed plan, decision A1). Locks the '
  'inventory row, depletes lots FIFO, writes the ledger row, and is idempotent '
  'on p_idempotency_key. Extended 2026-08-05 with reference_type, reference_id, '
  'pos_transaction_id, notes and metadata. Changed 2026-09-02: an emptied lot '
  'is MARKED (qty = 0, status = depleted) rather than DELETED, so the lot id '
  'survives for a transformation to anchor on and its unit_cost survives to be '
  'read. uom is filled by trg_ledger_uom_from_item, never by this function.';

-- The FIFO loop's exact predicate and ordering. Depleted rows leave the index
-- entirely rather than accumulating under `idx_inventory_lots_inv`.
create index if not exists idx_inventory_lots_fifo_open
  on public.inventory_lots (inventory_id, stock_state, received_at, created_at)
  where qty > 0;

-- The three presence-based expressions in `inventory_lot_rollup`. Each edit
-- PRESERVES today's meaning under the new representation: no lot has ever
-- reached qty = 0 and survived, so `qty > 0` is a no-op against current data
-- and a correction against future data.
create or replace view public.inventory_lot_rollup as
 SELECT inventory_id,
    restaurant_id,
    master_wine_id,
    COALESCE(sum(qty) FILTER (WHERE ((stock_state)::text = 'live'::text)), (0)::bigint) AS live_qty,
    COALESCE(sum(qty) FILTER (WHERE ((stock_state)::text = 'shadow'::text)), (0)::bigint) AS shadow_qty,
        CASE
            WHEN (COALESCE(sum(qty) FILTER (WHERE (((stock_state)::text = 'live'::text) AND (unit_cost IS NOT NULL) AND ((cost_provenance)::text <> 'sample'::text))), (0)::bigint) > 0) THEN round((sum(((qty)::numeric * unit_cost)) FILTER (WHERE (((stock_state)::text = 'live'::text) AND (unit_cost IS NOT NULL) AND ((cost_provenance)::text <> 'sample'::text))) / (sum(qty) FILTER (WHERE (((stock_state)::text = 'live'::text) AND (unit_cost IS NOT NULL) AND ((cost_provenance)::text <> 'sample'::text))))::numeric), 2)
            ELSE NULL::numeric
        END AS wac,
    bool_or(((cost_provenance)::text = 'invoice'::text)) FILTER (WHERE (((stock_state)::text = 'live'::text) AND (qty > 0))) AS has_invoice_cost,
    count(*) FILTER (WHERE (((stock_state)::text = 'live'::text) AND (qty > 0))) AS live_lot_count,
    count(DISTINCT location_id) FILTER (WHERE (((stock_state)::text = 'live'::text) AND (qty > 0) AND (location_id IS NOT NULL))) AS live_location_count,
    COALESCE(sum(open_bottle_ml) FILTER (WHERE ((stock_state)::text = 'live'::text)), (0)::bigint) AS open_ml,
    COALESCE(sum(qty) FILTER (WHERE (((stock_state)::text = 'live'::text) AND ((cost_provenance)::text = 'sample'::text))), (0)::bigint) AS sample_qty,
    CASE WHEN count(DISTINCT uom) = 1 THEN max(uom) ELSE NULL::character varying END AS uom,
    count(DISTINCT uom) AS distinct_uom_count
   FROM public.inventory_lots
  GROUP BY inventory_id, restaurant_id, master_wine_id;

-- A location holding zero is not a holding. `fetchLocationBreakdown` pushes
-- every row of this view to the UI as "this wine is at this location", so
-- without the HAVING an emptied lot becomes a ghost entry reading 0.
create or replace view public.inventory_location_breakdown as
 SELECT inventory_id,
    restaurant_id,
    master_wine_id,
    location_id,
    stock_state,
    sum(qty) AS qty,
        CASE
            WHEN (COALESCE(sum(qty) FILTER (WHERE (unit_cost IS NOT NULL)), (0)::bigint) > 0) THEN round((sum(((qty)::numeric * unit_cost)) FILTER (WHERE (unit_cost IS NOT NULL)) / (sum(qty) FILTER (WHERE (unit_cost IS NOT NULL)))::numeric), 2)
            ELSE NULL::numeric
        END AS wac
   FROM public.inventory_lots
  GROUP BY inventory_id, restaurant_id, master_wine_id, location_id, stock_state
 HAVING sum(qty) > 0;

-- NOT changed: `transfer_stock` still DELETEs the source lot (baseline:1869).
-- A transferred lot has not been depleted — it moved, and the destination
-- INSERT recreates it — so marking it 'depleted' would be a lie and the status
-- CHECK has no word for "moved". Leaving it means a transfer still breaks lot
-- identity, which matters to the same L2 anchoring argument above. Reported
-- rather than fixed, because the honest fix is a new status value or a
-- `moved_to_lot_id`, and that is a decision, not a cleanup.

-- ---------------------------------------------------------------------------
-- 7. What this migration does NOT do
-- ---------------------------------------------------------------------------
-- * It does not change any column's type. 0 columns altered, 0 views dropped,
--   0 functions resignatured, 0 INSERT statements given a uom. That was the
--   entire cost argument for ADR 0070's option F and it is intact.
--
--   Stated precisely, because "0 functions touched" would be wrong: ONE
--   function body is replaced — `apply_stock_movement`, for section 6's
--   mark-not-delete, with a byte-identical parameter list. The unit work itself
--   replaces nothing; that is what the fill-from-item trigger buys.
--
-- * It does not touch intake. `procurement_document_lines.uom` still has no
--   mass unit and `@IsInt()` still rejects 4.5, so the receiving door is still
--   broken for a flour delivery. ADR 0070 says so explicitly; that work was
--   commissioned separately and lands in its own migration.
--
-- * It does not fix `inventory_lots.unit_cost numeric(10,2)`. A per-milligram
--   cost — flour at EUR 0.80/kg is EUR 0.0000008/mg — rounds to 0.00 at INSERT,
--   BEFORE any trigger can see it, so WAC and COGS for every mass item would be
--   a structural zero wearing the costume of a measurement. This is a real
--   consequence of the mg base unit that ADR 0070 did not name. It is filed
--   rather than fixed here because the fix is a money-column type change with
--   view dependents, it cannot bite until the first non-bottle item exists, and
--   a CHECK that can refuse to apply against unread production rows does not
--   belong in a migration the founder is sequencing. See OPEN-DECISIONS OD-118.
--
-- * It adds no SQL allocation helper. Nothing in the SQL write path divides a
--   quantity today: `apply_stock_movement` and `transfer_stock` deplete FIFO by
--   integer subtraction and `LEAST`, which is exact and leaves no residue. A
--   helper with no caller is the `price_history` fault (designed, indexed, zero
--   writers). The remainder-safe allocator lives in `ledger-units.ts` where the
--   next apportionment will be written, and `scripts/check_ledger_units.py`
--   fails CI if a division appears in either place without it.

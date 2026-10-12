-- house_tax_basis_and_rates — a house says whether its till prices include
-- tax, its rates are kept by date, a check records the basis it was written
-- under, and a cost says whether tax is inside it. F-620 / F-1537, lane 1 of
-- the tax-inclusive decision (schema only; nothing here reads or writes a
-- figure).
--
-- THE FOUNDER'S PICKS, 2026-10-12 (sim ledger S218), verbatim in substance:
--   F1  BUILD IT: the per-house tax basis.
--   F2  ONLY FROM NOW: no backfill of stored checks. Reports mark the switch
--       date. (So this file writes no row and recomputes nothing.)
--   F3  STAMP COST BASIS: costs carry their tax basis, and margins go pre-tax
--       only when the cost is proven pre-tax. The owner re-confirms the target
--       margin on the switch.
--
-- WHY. A Turkish menu must print prices with KDV included, so a Turkish
-- till's subtotal is KDV-inclusive, and the dashboard labels it net (AW17,
-- ADR 0287) -- 9-17% high (F-1537). Margin advice divides (price - cost) by a
-- KDV-inclusive price (F-620). Nothing in the schema could say which basis a
-- house, a check or a cost is on.
--
-- WHAT THIS FILE DOES (additive; every new column is NULL or 'unset' on
-- every existing row, and no existing reader names any of them, so a house
-- that never states a basis -- every US house today -- behaves exactly as
-- before):
--
--   1. restaurants.tax_basis, one of four states, NOT NULL DEFAULT 'unset':
--        unset               nobody at the house has said (every house now);
--        prices_include_tax  the till's prices include tax (KDV, VAT);
--        prices_exclude_tax  tax is added on top (the US way);
--        not_vat_charging    the house charges no VAT at all.
--      'unset' is the absence of an answer, not a basis, so it is the only
--      default; the three answers are written only with the person and the
--      moment that confirmed them (tax_basis_confirmed_by / _at), the
--      confirm-once shape of pour_size_confirmed_by (20260922230600). A
--      changed answer is a new confirmation: the moment must move with it
--      (trigger). Never set from restaurants.country -- country may only
--      pre-fill a proposal the owner confirms (lane 2).
--
--   2. public.house_tax_rates, the house's rates, effective-dated, append-only:
--        key_kind  'house'        one rate for everything the house sells
--                                  (key is '');
--                  'pos_category' a till sales category, as the till names it;
--                  'house_item'   one of the house's own items
--                                  (restaurant_inventory.id as text), reached
--                                  from a till line through the till-item
--                                  mapping ADR 0301 keeps;
--        rate      a fraction (0.2000 = 20%), 0 <= rate < 1; NULL is a
--                  withdrawal: from effective_from this key has no rate;
--        effective_from / effective_to  the house's business dates (ADR
--                  0296); effective_to is EXCLUSIVE and NULL means open;
--        version   1, 2, 3 ... per house, assigned by the database at insert.
--      A row is never edited or deleted by a statement (decrees change rates:
--      add a row, never edit one). The rate in force for a key on a business
--      date is the row with the highest version among the key's rows whose
--      span holds that date; a correction is a later row over the same span.
--      "The table as of version V" is every row with version <= V, so a
--      check's tax_rate_version names exactly the rates it was made pre-tax
--      with, and a late import reads the rate in force on the check's own
--      date.
--
--   3. pos_checks gains, all NULL on every row written before this file (F2:
--      the switch is marked by the rows, never by rewriting them):
--        gross_subtotal    the subtotal as the till sent it;
--        tax_basis         the house's basis when ingest wrote the row;
--        tax_rate_version  the house_tax_rates version ingest used (only a
--                          prices_include_tax row can name one).
--
--   4. Cost tax basis (F3), NULL = not stated, on the three places a cost is
--      recorded that margin advice can read:
--        procurement_order_items.price_tax_basis  the agreed line's prices
--          (quoted / negotiated / final);
--        inventory_lots.unit_cost_tax_basis        a lot's cost (order price,
--          door-checked price, invoice price -- whatever unit_cost holds);
--        restaurant_inventory.last_purchase_price_tax_basis.
--      Values: 'includes_tax' | 'excludes_tax' ('excludes_tax' = no tax is
--      inside the figure: quoted net, or none was charged).
--      A cost figure that changes in a write that does not change its basis
--      loses the basis (trigger): an invoice that overwrites a lot's order
--      price, or a blended cost, is not known to be on the old basis. A
--      writer re-stating the SAME basis after changing the figure writes the
--      basis in a second statement. A lot booked from an order takes the
--      basis of the order's line for that item when the line states one
--      (same house only; never guessed when the lines disagree).
--
--   5. inventory_lot_rollup gains, at its end, over exactly the lots `wac`
--      averages: wac_pre_tax_qty and wac_tax_included_qty. The WAC is
--      proven pre-tax only when wac_pre_tax_qty = wac_qty > 0; lane 4 refuses
--      otherwise with a named reason. The body above them is
--      20261231100000_a_lot_cost_states_its_currency.sql verbatim, and the
--      view keeps security_invoker (a replace without it resets the option).
--
-- WHAT IT DELIBERATELY DOES NOT DO
--   * Backfill anything (F2). No house is given a basis; no check is
--     recomputed; no cost is stamped from a guess.
--   * Add a target-margin basis column: a target set before the switch is
--     target_margin_set_at < tax_basis_confirmed_at, which lane 4 reads to ask
--     the owner to re-confirm (F3).
--   * Add a client RLS policy. Locked down in the same migration (OD-72 /
--     OD-73): RLS on, service_role only, no anon/authenticated grant. The
--     browser reaches the rates through the gateway, which scopes every
--     statement to the house on the token -- the month_closes /
--     team_member_wage_changes shape. [Recorded as a correction to the
--     draft, which said "RLS on the house id from the JWT": no house table in
--     this corpus is read by a client role, and a JWT-claim policy needs a
--     client grant, which is the OD-72 hole.]

BEGIN;

SET LOCAL statement_timeout = '120s';

-- ---------------------------------------------------------------------------
-- 1. The house's tax basis, confirmed once.
-- ---------------------------------------------------------------------------
ALTER TABLE public.restaurants
  ADD COLUMN IF NOT EXISTS tax_basis TEXT NOT NULL DEFAULT 'unset',
  ADD COLUMN IF NOT EXISTS tax_basis_confirmed_by UUID
    REFERENCES public.users(user_id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS tax_basis_confirmed_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'restaurants_tax_basis_is_one_of_four'
       AND conrelid = to_regclass('public.restaurants')
  ) THEN
    ALTER TABLE public.restaurants
      ADD CONSTRAINT restaurants_tax_basis_is_one_of_four
      CHECK (tax_basis IN ('unset', 'prices_include_tax', 'prices_exclude_tax', 'not_vat_charging'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'restaurants_tax_basis_confirmation_names_its_author'
       AND conrelid = to_regclass('public.restaurants')
  ) THEN
    -- An answer comes with its person and moment; no answer has neither.
    ALTER TABLE public.restaurants
      ADD CONSTRAINT restaurants_tax_basis_confirmation_names_its_author
      CHECK (
        (tax_basis = 'unset'
          AND tax_basis_confirmed_by IS NULL AND tax_basis_confirmed_at IS NULL)
        OR
        (tax_basis <> 'unset'
          AND tax_basis_confirmed_by IS NOT NULL AND tax_basis_confirmed_at IS NOT NULL)
      );
  END IF;
END
$$;

COMMENT ON COLUMN public.restaurants.tax_basis IS
  'Whether this house''s till prices include tax: unset (nobody has said; every house until its owner or manager answers, and a strict no-op), prices_include_tax, prices_exclude_tax, not_vat_charging. Set only with tax_basis_confirmed_by/_at. Never inferred from country (country may pre-fill a proposal). Founder 2026-10-12 (S218) F1; F-620, F-1537.';
COMMENT ON COLUMN public.restaurants.tax_basis_confirmed_by IS
  'Who confirmed tax_basis, public.users(user_id). NULL exactly when tax_basis is unset.';
COMMENT ON COLUMN public.restaurants.tax_basis_confirmed_at IS
  'When tax_basis was last confirmed: the switch date reports mark (F2, only from now). Moves with every change of tax_basis.';

CREATE OR REPLACE FUNCTION public.a_changed_tax_basis_is_a_new_confirmation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.tax_basis IS DISTINCT FROM OLD.tax_basis
     AND NEW.tax_basis <> 'unset'
     AND NEW.tax_basis_confirmed_at IS NOT DISTINCT FROM OLD.tax_basis_confirmed_at THEN
    RAISE EXCEPTION
      'a changed tax basis is a new confirmation: write tax_basis_confirmed_by and a new tax_basis_confirmed_at with it'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

COMMENT ON FUNCTION public.a_changed_tax_basis_is_a_new_confirmation() IS
  'F-1537. Refuses a change of restaurants.tax_basis that keeps the old confirmation moment, so the switch date is never the date of a different answer.';

REVOKE ALL ON FUNCTION public.a_changed_tax_basis_is_a_new_confirmation() FROM PUBLIC;
DO $grants$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.a_changed_tax_basis_is_a_new_confirmation() FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.a_changed_tax_basis_is_a_new_confirmation() FROM authenticated';
  END IF;
END;
$grants$;

DROP TRIGGER IF EXISTS a_changed_tax_basis_is_a_new_confirmation ON public.restaurants;
CREATE TRIGGER a_changed_tax_basis_is_a_new_confirmation
  BEFORE UPDATE OF tax_basis ON public.restaurants
  FOR EACH ROW EXECUTE FUNCTION public.a_changed_tax_basis_is_a_new_confirmation();

-- ---------------------------------------------------------------------------
-- 2. The house's rates, effective-dated, append-only.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.house_tax_rates (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id  uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  key_kind       text NOT NULL,
  key            text NOT NULL DEFAULT '',
  rate           numeric(6,4),
  effective_from date NOT NULL,
  effective_to   date,
  version        integer NOT NULL,
  created_by     uuid NOT NULL REFERENCES public.users(user_id) ON DELETE RESTRICT,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT house_tax_rates_key_kind_known
    CHECK (key_kind IN ('house', 'pos_category', 'house_item')),
  CONSTRAINT house_tax_rates_key_fits_its_kind
    CHECK (
      (key_kind = 'house' AND key = '')
      OR (key_kind = 'pos_category' AND length(btrim(key)) > 0 AND key = btrim(key))
      OR (key_kind = 'house_item'
          AND key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
    ),
  CONSTRAINT house_tax_rates_rate_is_a_fraction
    CHECK (rate IS NULL OR (rate >= 0 AND rate < 1)),
  CONSTRAINT house_tax_rates_span_is_forward
    CHECK (effective_to IS NULL OR effective_to > effective_from),
  CONSTRAINT house_tax_rates_version_counts_from_one
    CHECK (version >= 1),
  CONSTRAINT house_tax_rates_one_row_per_version
    UNIQUE (restaurant_id, version)
);

CREATE INDEX IF NOT EXISTS idx_house_tax_rates_key_date
  ON public.house_tax_rates (restaurant_id, key_kind, key, effective_from DESC, version DESC);

-- The version is the house's next number, taken under a per-house lock so two
-- inserts at one moment cannot both claim it (the UNIQUE is the backstop).
CREATE OR REPLACE FUNCTION public.house_tax_rates_take_the_next_version()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  next_version integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('house_tax_rates:' || NEW.restaurant_id::text));
  SELECT coalesce(max(r.version), 0) + 1 INTO next_version
    FROM public.house_tax_rates r
   WHERE r.restaurant_id = NEW.restaurant_id;
  IF NEW.version IS NOT NULL AND NEW.version <> next_version THEN
    RAISE EXCEPTION
      'house_tax_rates version is the house''s next number (%), not %', next_version, NEW.version
      USING ERRCODE = 'check_violation';
  END IF;
  NEW.version := next_version;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION public.house_tax_rates_append_only()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- The house deleted: its foreign key cascades one trigger level down.
  IF pg_trigger_depth() > 1 AND TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION
    'house_tax_rates is append-only: % is not permitted. A changed or corrected rate is a new row; a withdrawn one is a new row with no rate.',
    TG_OP;
END
$$;

COMMENT ON FUNCTION public.house_tax_rates_take_the_next_version() IS
  'Gives a new house_tax_rates row its house''s next version (1, 2, 3 ...), under a per-house transaction lock. A supplied version other than that number is refused.';
COMMENT ON FUNCTION public.house_tax_rates_append_only() IS
  'Refuses UPDATE, DELETE and TRUNCATE on house_tax_rates except the cascade from the house being deleted. Rates change by decree: add a row, never edit one.';

REVOKE ALL ON FUNCTION public.house_tax_rates_take_the_next_version() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.house_tax_rates_append_only() FROM PUBLIC;
DO $grants$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.house_tax_rates_take_the_next_version() FROM anon';
    EXECUTE 'REVOKE ALL ON FUNCTION public.house_tax_rates_append_only() FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.house_tax_rates_take_the_next_version() FROM authenticated';
    EXECUTE 'REVOKE ALL ON FUNCTION public.house_tax_rates_append_only() FROM authenticated';
  END IF;
END;
$grants$;

DROP TRIGGER IF EXISTS trg_house_tax_rates_next_version ON public.house_tax_rates;
CREATE TRIGGER trg_house_tax_rates_next_version
  BEFORE INSERT ON public.house_tax_rates
  FOR EACH ROW EXECUTE FUNCTION public.house_tax_rates_take_the_next_version();

DROP TRIGGER IF EXISTS trg_house_tax_rates_append_only ON public.house_tax_rates;
CREATE TRIGGER trg_house_tax_rates_append_only
  BEFORE UPDATE OR DELETE ON public.house_tax_rates
  FOR EACH ROW EXECUTE FUNCTION public.house_tax_rates_append_only();

DROP TRIGGER IF EXISTS trg_house_tax_rates_no_truncate ON public.house_tax_rates;
CREATE TRIGGER trg_house_tax_rates_no_truncate
  BEFORE TRUNCATE ON public.house_tax_rates
  FOR EACH STATEMENT EXECUTE FUNCTION public.house_tax_rates_append_only();

ALTER TABLE public.house_tax_rates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS house_tax_rates_service_role ON public.house_tax_rates;
CREATE POLICY house_tax_rates_service_role
  ON public.house_tax_rates
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.house_tax_rates FROM anon, authenticated;

COMMENT ON TABLE public.house_tax_rates IS
  'A house''s tax rates, by key and business date, append-only. Read only for a house whose tax_basis is prices_include_tax: ingest divides each line''s rate out of the till''s own check subtotal (never rebuilds net from the lines). The rate in force for a key on a date is the highest version whose span holds the date. Gateway-only: the gateway scopes every statement to the house on the token. F-1537, founder 2026-10-12 (S218) F1.';
COMMENT ON COLUMN public.house_tax_rates.key_kind IS
  'house (one rate for everything; key is empty), pos_category (a till sales category, as the till names it), house_item (restaurant_inventory.id as text, reached from a till line through the till-item mapping).';
COMMENT ON COLUMN public.house_tax_rates.rate IS
  'A fraction: 0.2000 is 20%. NULL withdraws the key from effective_from: a check needing it resolves to no net, never to a guess.';
COMMENT ON COLUMN public.house_tax_rates.effective_from IS
  'The first business date (the house''s own days, ADR 0296) the rate is in force on.';
COMMENT ON COLUMN public.house_tax_rates.effective_to IS
  'The first business date it is no longer in force on (exclusive). NULL = open.';
COMMENT ON COLUMN public.house_tax_rates.version IS
  'The house''s running number for its rate rows, assigned at insert. The table as of version V is every row with version <= V; pos_checks.tax_rate_version names it.';

-- ---------------------------------------------------------------------------
-- 3. A check records the basis it was written under (only from now: F2).
-- ---------------------------------------------------------------------------
ALTER TABLE public.pos_checks
  ADD COLUMN IF NOT EXISTS gross_subtotal NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS tax_basis TEXT,
  ADD COLUMN IF NOT EXISTS tax_rate_version INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'pos_checks_tax_basis_is_one_of_four'
       AND conrelid = to_regclass('public.pos_checks')
  ) THEN
    ALTER TABLE public.pos_checks
      ADD CONSTRAINT pos_checks_tax_basis_is_one_of_four
      CHECK (tax_basis IS NULL
             OR tax_basis IN ('unset', 'prices_include_tax', 'prices_exclude_tax', 'not_vat_charging'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'pos_checks_rate_version_only_for_inclusive'
       AND conrelid = to_regclass('public.pos_checks')
  ) THEN
    -- Rates are divided out only for a house whose prices include tax.
    ALTER TABLE public.pos_checks
      ADD CONSTRAINT pos_checks_rate_version_only_for_inclusive
      CHECK (tax_rate_version IS NULL
             OR (tax_rate_version >= 1 AND tax_basis = 'prices_include_tax'));
  END IF;
END
$$;

COMMENT ON COLUMN public.pos_checks.gross_subtotal IS
  'The subtotal as the till sent it, before ingest made it pre-tax. NULL on every check written before 2027-01-10 (founder F2: only from now, no backfill).';
COMMENT ON COLUMN public.pos_checks.tax_basis IS
  'The house''s restaurants.tax_basis when ingest wrote this row. NULL = written before the column (before the switch). A read adding checks across bases says so (0290 count-and-say).';
COMMENT ON COLUMN public.pos_checks.tax_rate_version IS
  'The house_tax_rates version ingest divided out of this check (prices_include_tax only). NULL when no house rate was used.';

-- ---------------------------------------------------------------------------
-- 4. A cost says whether tax is inside it (F3). NULL = not stated.
-- ---------------------------------------------------------------------------
ALTER TABLE public.procurement_order_items
  ADD COLUMN IF NOT EXISTS price_tax_basis TEXT;
ALTER TABLE public.inventory_lots
  ADD COLUMN IF NOT EXISTS unit_cost_tax_basis TEXT;
ALTER TABLE public.restaurant_inventory
  ADD COLUMN IF NOT EXISTS last_purchase_price_tax_basis TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'procurement_order_items_price_tax_basis_known'
       AND conrelid = to_regclass('public.procurement_order_items')
  ) THEN
    ALTER TABLE public.procurement_order_items
      ADD CONSTRAINT procurement_order_items_price_tax_basis_known
      CHECK (price_tax_basis IS NULL OR price_tax_basis IN ('includes_tax', 'excludes_tax'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'inventory_lots_unit_cost_tax_basis_known'
       AND conrelid = to_regclass('public.inventory_lots')
  ) THEN
    ALTER TABLE public.inventory_lots
      ADD CONSTRAINT inventory_lots_unit_cost_tax_basis_known
      CHECK (unit_cost_tax_basis IS NULL OR unit_cost_tax_basis IN ('includes_tax', 'excludes_tax'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'restaurant_inventory_last_purchase_price_tax_basis_known'
       AND conrelid = to_regclass('public.restaurant_inventory')
  ) THEN
    ALTER TABLE public.restaurant_inventory
      ADD CONSTRAINT restaurant_inventory_last_purchase_price_tax_basis_known
      CHECK (last_purchase_price_tax_basis IS NULL
             OR last_purchase_price_tax_basis IN ('includes_tax', 'excludes_tax'));
  END IF;
END
$$;

COMMENT ON COLUMN public.procurement_order_items.price_tax_basis IS
  'Whether tax is inside this line''s prices (quoted, negotiated, final): includes_tax (e.g. a vendor''s "KDV dahil") or excludes_tax (net, or no tax charged). NULL = not stated. Lost when a price changes in a write that does not change it. Founder 2026-10-12 (S218) F3.';
COMMENT ON COLUMN public.inventory_lots.unit_cost_tax_basis IS
  'Whether tax is inside unit_cost: includes_tax or excludes_tax. NULL = not stated (every lot before 2027-01-10). Taken from the booking order''s line for this item when that line states one; lost when unit_cost changes in a write that does not change it. Margin goes pre-tax only on a cost proven excludes_tax (F3).';
COMMENT ON COLUMN public.restaurant_inventory.last_purchase_price_tax_basis IS
  'Whether tax is inside last_purchase_price: includes_tax or excludes_tax. NULL = not stated. Lost when last_purchase_price changes in a write that does not change it (F3).';

-- One rule, three columns: a figure re-written without its basis re-stated
-- is a figure whose basis nobody stated.
CREATE OR REPLACE FUNCTION public.a_changed_cost_loses_its_unstated_tax_basis()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_TABLE_NAME = 'inventory_lots' THEN
    IF NEW.unit_cost IS DISTINCT FROM OLD.unit_cost
       AND NEW.unit_cost_tax_basis IS NOT DISTINCT FROM OLD.unit_cost_tax_basis THEN
      NEW.unit_cost_tax_basis := NULL;
    END IF;
  ELSIF TG_TABLE_NAME = 'restaurant_inventory' THEN
    IF NEW.last_purchase_price IS DISTINCT FROM OLD.last_purchase_price
       AND NEW.last_purchase_price_tax_basis IS NOT DISTINCT FROM OLD.last_purchase_price_tax_basis THEN
      NEW.last_purchase_price_tax_basis := NULL;
    END IF;
  ELSIF TG_TABLE_NAME = 'procurement_order_items' THEN
    IF (NEW.quoted_unit_price IS DISTINCT FROM OLD.quoted_unit_price
        OR NEW.negotiated_unit_price IS DISTINCT FROM OLD.negotiated_unit_price
        OR NEW.final_unit_price IS DISTINCT FROM OLD.final_unit_price)
       AND NEW.price_tax_basis IS NOT DISTINCT FROM OLD.price_tax_basis THEN
      NEW.price_tax_basis := NULL;
    END IF;
  END IF;
  RETURN NEW;
END
$$;

COMMENT ON FUNCTION public.a_changed_cost_loses_its_unstated_tax_basis() IS
  'F3 (founder 2026-10-12, S218). When a cost figure changes in a write that leaves its tax basis as it was, the basis is cleared to NULL (not stated): an invoice over an order price, or a blended cost, is not known to be on the old basis. Re-stating the same basis after a change is a second write.';

-- A lot booked from an order takes the basis of the order's line for its item.
CREATE OR REPLACE FUNCTION public.a_lot_cost_takes_its_order_line_tax_basis()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.unit_cost IS NOT NULL
     AND NEW.unit_cost_tax_basis IS NULL
     AND NEW.source_order_id IS NOT NULL
     AND NEW.inventory_id IS NOT NULL THEN
    SELECT CASE
             WHEN count(*) > 0
              AND count(*) = count(i.price_tax_basis)
              AND count(DISTINCT i.price_tax_basis) = 1
             THEN min(i.price_tax_basis)
           END
      INTO NEW.unit_cost_tax_basis
      FROM public.procurement_order_items i
      JOIN public.procurement_orders o ON o.id = i.order_id
     WHERE i.order_id = NEW.source_order_id
       AND i.inventory_id = NEW.inventory_id
       AND o.restaurant_id = NEW.restaurant_id;
  END IF;
  RETURN NEW;
END
$$;

COMMENT ON FUNCTION public.a_lot_cost_takes_its_order_line_tax_basis() IS
  'F3. A costed lot inserted with no stated tax basis takes the price_tax_basis of its booking order''s line(s) for the same item, same house only, and only when every such line states one and they agree. Never overwrites a stated basis; a lot with no order stays NULL.';

REVOKE ALL ON FUNCTION public.a_changed_cost_loses_its_unstated_tax_basis() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.a_lot_cost_takes_its_order_line_tax_basis() FROM PUBLIC;
DO $grants$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.a_changed_cost_loses_its_unstated_tax_basis() FROM anon';
    EXECUTE 'REVOKE ALL ON FUNCTION public.a_lot_cost_takes_its_order_line_tax_basis() FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.a_changed_cost_loses_its_unstated_tax_basis() FROM authenticated';
    EXECUTE 'REVOKE ALL ON FUNCTION public.a_lot_cost_takes_its_order_line_tax_basis() FROM authenticated';
  END IF;
END;
$grants$;

DROP TRIGGER IF EXISTS a_changed_lot_cost_loses_its_unstated_tax_basis ON public.inventory_lots;
CREATE TRIGGER a_changed_lot_cost_loses_its_unstated_tax_basis
  BEFORE UPDATE OF unit_cost, unit_cost_tax_basis ON public.inventory_lots
  FOR EACH ROW EXECUTE FUNCTION public.a_changed_cost_loses_its_unstated_tax_basis();

DROP TRIGGER IF EXISTS a_changed_last_price_loses_its_unstated_tax_basis ON public.restaurant_inventory;
CREATE TRIGGER a_changed_last_price_loses_its_unstated_tax_basis
  BEFORE UPDATE OF last_purchase_price, last_purchase_price_tax_basis ON public.restaurant_inventory
  FOR EACH ROW EXECUTE FUNCTION public.a_changed_cost_loses_its_unstated_tax_basis();

DROP TRIGGER IF EXISTS a_changed_line_price_loses_its_unstated_tax_basis ON public.procurement_order_items;
CREATE TRIGGER a_changed_line_price_loses_its_unstated_tax_basis
  BEFORE UPDATE OF quoted_unit_price, negotiated_unit_price, final_unit_price, price_tax_basis
  ON public.procurement_order_items
  FOR EACH ROW EXECUTE FUNCTION public.a_changed_cost_loses_its_unstated_tax_basis();

DROP TRIGGER IF EXISTS a_lot_cost_takes_its_order_line_tax_basis ON public.inventory_lots;
CREATE TRIGGER a_lot_cost_takes_its_order_line_tax_basis
  BEFORE INSERT ON public.inventory_lots
  FOR EACH ROW EXECUTE FUNCTION public.a_lot_cost_takes_its_order_line_tax_basis();

-- ---------------------------------------------------------------------------
-- 5. The rollup says how much of its WAC is proven pre-tax.
--    Body: 20261231100000_a_lot_cost_states_its_currency.sql verbatim; two
--    columns appended (CREATE OR REPLACE VIEW can only append).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.inventory_lot_rollup WITH (security_invoker = true) AS
 SELECT inventory_id,
    restaurant_id,
    master_wine_id,
    COALESCE(sum(qty) FILTER (WHERE ((stock_state)::text = 'live'::text)), (0)::bigint) AS live_qty,
    COALESCE(sum(qty) FILTER (WHERE ((stock_state)::text = 'shadow'::text)), (0)::bigint) AS shadow_qty,
        CASE
            WHEN (COALESCE(sum(qty) FILTER (WHERE (((stock_state)::text = 'live'::text) AND (unit_cost IS NOT NULL) AND ((cost_provenance)::text <> 'sample'::text))), (0)::bigint) > 0) THEN round((sum(((qty)::numeric * unit_cost)) FILTER (WHERE (((stock_state)::text = 'live'::text) AND (unit_cost IS NOT NULL) AND ((cost_provenance)::text <> 'sample'::text))) / (sum(qty) FILTER (WHERE (((stock_state)::text = 'live'::text) AND (unit_cost IS NOT NULL) AND ((cost_provenance)::text <> 'sample'::text))))::numeric), 2)
            ELSE NULL::numeric
        END AS wac,
    bool_or(((cost_provenance)::text = 'invoice'::text)) FILTER (WHERE ((stock_state)::text = 'live'::text)) AS has_invoice_cost,
    count(*) FILTER (WHERE ((stock_state)::text = 'live'::text)) AS live_lot_count,
    count(DISTINCT location_id) FILTER (WHERE (((stock_state)::text = 'live'::text) AND (location_id IS NOT NULL))) AS live_location_count,
    COALESCE(sum(open_bottle_ml) FILTER (WHERE ((stock_state)::text = 'live'::text)), (0)::bigint) AS open_ml,
    COALESCE(sum(qty) FILTER (WHERE (((stock_state)::text = 'live'::text) AND ((cost_provenance)::text = 'sample'::text))), (0)::bigint) AS sample_qty,
    COALESCE(sum(qty) FILTER (WHERE (((stock_state)::text = 'live'::text) AND (unit_cost IS NOT NULL) AND ((cost_provenance)::text <> 'sample'::text))), (0)::bigint) AS wac_qty,
    COALESCE(sum(qty) FILTER (WHERE (((stock_state)::text = 'live'::text) AND ((cost_provenance)::text = 'invoice'::text))), (0)::bigint) AS invoice_qty,
    COALESCE(sum(qty) FILTER (WHERE (((stock_state)::text = 'live'::text) AND (unit_cost IS NULL) AND ((cost_provenance)::text <> 'sample'::text))), (0)::bigint) AS unpriced_qty,
    count(DISTINCT unit_cost_currency) FILTER (WHERE (((stock_state)::text = 'live'::text) AND (unit_cost IS NOT NULL) AND ((cost_provenance)::text <> 'sample'::text) AND (qty > 0))) AS cost_currency_count,
        CASE
            WHEN (count(DISTINCT unit_cost_currency) FILTER (WHERE (((stock_state)::text = 'live'::text) AND (unit_cost IS NOT NULL) AND ((cost_provenance)::text <> 'sample'::text) AND (qty > 0))) = 1) THEN (min((unit_cost_currency)::text) FILTER (WHERE (((stock_state)::text = 'live'::text) AND (unit_cost IS NOT NULL) AND ((cost_provenance)::text <> 'sample'::text) AND (qty > 0))))::character varying(3)
            ELSE NULL::character varying(3)
        END AS cost_currency,
    COALESCE(sum(qty) FILTER (WHERE (((stock_state)::text = 'live'::text) AND (unit_cost IS NOT NULL) AND ((cost_provenance)::text <> 'sample'::text) AND (unit_cost_tax_basis = 'excludes_tax'::text))), (0)::bigint) AS wac_pre_tax_qty,
    COALESCE(sum(qty) FILTER (WHERE (((stock_state)::text = 'live'::text) AND (unit_cost IS NOT NULL) AND ((cost_provenance)::text <> 'sample'::text) AND (unit_cost_tax_basis = 'includes_tax'::text))), (0)::bigint) AS wac_tax_included_qty
   FROM public.inventory_lots
  GROUP BY inventory_id, restaurant_id, master_wine_id;

COMMENT ON VIEW public.inventory_lot_rollup IS
  'Per-inventory lot rollup. wac excludes sample lots. wac_qty / invoice_qty / '
  'unpriced_qty added 2026-09-02 (ADR 0078) so a consumer can tell per-row '
  'COVERAGE (has_invoice_cost: at least one invoiced bottle) from per-row '
  'COMPLETENESS (wac_qty = live_qty: the average covers every bottle it is '
  'quoted for). cost_currency_count / cost_currency added 2026-10-09 (F-343): '
  'the stated currencies among the lots wac averages. A count above 1 means '
  'wac mixes moneys and is no figure at all; lots with no stated currency '
  '(booked before the column) are not counted. wac_pre_tax_qty / '
  'wac_tax_included_qty added 2027-01-10 (F-620, founder F3): the bottles in '
  'wac whose cost states no tax inside / tax inside. wac is proven pre-tax '
  'only when wac_pre_tax_qty = wac_qty > 0.';

-- ---------------------------------------------------------------------------
-- Assert the outcome. Catalog reads only; no probe row.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  rls      boolean;
  grants   int;
  n        int;
  invoker  boolean;
BEGIN
  IF (SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'restaurants'
         AND column_name IN ('tax_basis', 'tax_basis_confirmed_by', 'tax_basis_confirmed_at')) <> 3 THEN
    RAISE EXCEPTION 'restaurants is missing a tax-basis column';
  END IF;
  IF (SELECT column_default FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'restaurants'
         AND column_name = 'tax_basis') NOT LIKE '''unset''%' THEN
    RAISE EXCEPTION 'restaurants.tax_basis defaults to something other than unset';
  END IF;

  IF to_regclass('public.house_tax_rates') IS NULL THEN
    RAISE EXCEPTION 'house_tax_rates was not created';
  END IF;
  SELECT relrowsecurity INTO rls FROM pg_class WHERE oid = to_regclass('public.house_tax_rates');
  IF NOT rls THEN
    RAISE EXCEPTION 'house_tax_rates has row level security OFF';
  END IF;
  SELECT count(*) INTO grants
    FROM information_schema.role_table_grants
   WHERE table_schema = 'public' AND table_name = 'house_tax_rates'
     AND grantee IN ('anon', 'authenticated');
  IF grants > 0 THEN
    RAISE EXCEPTION 'house_tax_rates still holds % client grant(s) for anon/authenticated', grants;
  END IF;
  SELECT count(*) INTO n FROM pg_trigger
   WHERE tgrelid = 'public.house_tax_rates'::regclass
     AND tgname IN ('trg_house_tax_rates_next_version', 'trg_house_tax_rates_append_only',
                    'trg_house_tax_rates_no_truncate');
  IF n <> 3 THEN
    RAISE EXCEPTION 'house_tax_rates is missing its version or append-only triggers';
  END IF;

  IF (SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'pos_checks'
         AND column_name IN ('gross_subtotal', 'tax_basis', 'tax_rate_version')
         AND column_default IS NULL) <> 3 THEN
    RAISE EXCEPTION 'pos_checks is missing a tax column, or one carries a default';
  END IF;

  SELECT count(*) INTO n FROM information_schema.columns
   WHERE table_schema = 'public'
     AND ((table_name = 'procurement_order_items' AND column_name = 'price_tax_basis')
       OR (table_name = 'inventory_lots' AND column_name = 'unit_cost_tax_basis')
       OR (table_name = 'restaurant_inventory' AND column_name = 'last_purchase_price_tax_basis'))
     AND column_default IS NULL;
  IF n <> 3 THEN
    RAISE EXCEPTION 'a cost tax-basis column is missing, or carries a default';
  END IF;

  SELECT coalesce(bool_or(o = 'security_invoker=true' OR o = 'security_invoker=on'), false)
    INTO invoker
    FROM pg_class c, unnest(coalesce(c.reloptions, '{}'::text[])) AS o
   WHERE c.oid = 'public.inventory_lot_rollup'::regclass;
  IF NOT invoker THEN
    RAISE EXCEPTION 'inventory_lot_rollup lost security_invoker';
  END IF;
END $$;

COMMIT;

-- An agreed price states its unit — ADR 0119 phase 1 (option O1).
--
-- THE DEFECT, IN ONE ROW
-- ----------------------
-- `procurement_order_items` states the unit of its QUANTITY — `unit_type`
-- (`20260805000000_baseline_from_production.sql:4486`) beside `bottles_per_unit`
-- (`:4487`) — and states NOTHING about the unit of its PRICE. The price column
-- one over is called `final_unit_price` (`:4491`), and the code writes
-- `line_total = final_unit_price × total_bottles`
-- (`apps/api-gateway/src/procurement/procurement.service.ts:819-821`), so the
-- arithmetic means "per bottle" while the row a person reads says `case`.
--
-- That is ADR 0119's invariant 4 — *two numbers on one row may not assert
-- different units without saying so* — violated by the schema itself. The
-- consequence is measurable and one-directional: a case price filed as a bottle
-- price is wrong by the pack size, always in the direction that looks like a
-- bargain, and no later reader can detect it.
--
-- THE SHAPE, AND WHY IT IS THIS ONE
-- ---------------------------------
-- ADR 0070's shape applied to money: an integer beside a stated unit. The price
-- gets its own (uom, pack) pair, drawn from the SAME seven-word vocabulary the
-- quantity already uses (`20260901150000_order_line_capture_and_units.sql:106`,
-- mirroring `procurement_document_lines_uom_check`, `baseline:4401`).
--
-- A two-value "per bottle / per ordered unit" flag was rejected: it cannot say
-- *per litre* or *per kg*, so it dies the day ADR 0115 phase 2 widens the
-- intake vocabulary. The pair survives that widening for free.
--
-- THE PRICE'S UNIT IS INDEPENDENT OF THE QUANTITY'S
-- -------------------------------------------------
-- Deliberately NOT constrained to agree with `unit_type`. An order of five
-- cases at a per-bottle price is an ordinary order, and Connecticut requires a
-- bottle price and a case price to be POSTED SEPARATELY for the same item
-- (bottle price = case ÷ pack + 2–8¢ by bottle size, OLR 2004-R-0593). A schema
-- that forbade the two units from differing would be unable to record ordinary
-- trade — which is exactly why the register refuses these orders today.
--
-- WHAT A NULL PAIR MEANS
-- ----------------------
-- Unstated. Not "bottle". `decideOwnPaperSighting` keeps refusing a row whose
-- price unit is unstated, in a sentence
-- (`apps/api-gateway/src/procurement/own-paper-sighting.ts`), and now the page
-- says the refusal out loud too. **There is no backfill**: inventing a unit for
-- a row that never had one is the fabrication this whole build exists to end
-- (ADR 0119 invariant 7, ADR 0020).
--
-- COST OF BEING WRONG
-- -------------------
-- Measured on 2026-09-04: production held 2 `procurement_orders` and 1
-- `procurement_order_items` row (ADR 0115 §Context; ADR 0117:44-47); the local
-- Postgres held 0/0. There is no legacy data on this axis on any measured
-- surface, so a CHECK added here costs nothing. If no writer ever states a
-- pair, every row stays NULL and the register refuses exactly as it does today
-- — the failure mode is the status quo, not a wrong number.
--
-- ADDITIVE. Two nullable columns, three CHECKs, four comments. No UPDATE of any
-- existing row, no DROP, no RLS change.
set local statement_timeout = '120s';

-- ---------------------------------------------------------------------------
-- 1. The columns.
-- ---------------------------------------------------------------------------
alter table public.procurement_order_items
  add column if not exists price_uom character varying(20);

alter table public.procurement_order_items
  add column if not exists price_pack_size integer;

-- ---------------------------------------------------------------------------
-- 2. The three CHECKs.
-- ---------------------------------------------------------------------------
-- (a) The vocabulary. Copied verbatim from
--     `procurement_order_items_unit_type_check` (`20260901150000:129-133`) so a
--     price unit can never be a word a quantity unit could not be. All three
--     copies of the seven singulars move together or none does (ADR 0115 phase
--     2 item 3a).
alter table public.procurement_order_items
  drop constraint if exists procurement_order_items_price_uom_check,
  add  constraint procurement_order_items_price_uom_check
       check (price_uom is null or price_uom::text = any (array[
         'bottle','case','keg','pack','split_case','each','liter'
       ]::text[]));

-- (b) Both or neither. A unit with no pack cannot be converted and a pack with
--     no unit names nothing; either half alone is a number pretending to be a
--     statement. This is the constraint the DTO mirrors with a 400.
alter table public.procurement_order_items
  drop constraint if exists procurement_order_items_price_unit_pair_check,
  add  constraint procurement_order_items_price_unit_pair_check
       check ((price_uom is null) = (price_pack_size is null));

-- (c) A pack size is >= 1 always, and EXACTLY 1 for a unit that is not a
--     multiplying one. `MULTIPLYING = {case, pack, split_case}`
--     (`order-units.ts:74-78`); a `bottle` priced "per 12" is not a bottle
--     price, it is a case price with the wrong word on it, and a `keg` has no
--     pack at all. Mirrors `procurement_order_items_bottles_per_unit_check`
--     (`20260901150000:137-141`) on the quantity side.
alter table public.procurement_order_items
  drop constraint if exists procurement_order_items_price_pack_size_check,
  add  constraint procurement_order_items_price_pack_size_check
       check (
         price_pack_size is null
         or (
           price_pack_size >= 1
           and (
             price_uom::text = any (array['case','pack','split_case']::text[])
             or price_pack_size = 1
           )
         )
       );

-- ---------------------------------------------------------------------------
-- 3. What each column claims, written where a reader of the row will find it.
-- ---------------------------------------------------------------------------
comment on column public.procurement_order_items.price_uom is
  'The unit the agreed price is stated in — the same seven-word vocabulary as unit_type, and INDEPENDENT of it: five cases at a per-bottle price is an ordinary order. NULL means unstated, never ''bottle'': the price register refuses an unstated unit rather than assuming one (ADR 0119, ADR 0117 class A).';

comment on column public.procurement_order_items.price_pack_size is
  'How many bottles are in one of price_uom. Exactly 1 for a non-multiplying unit. Paired with price_uom by a CHECK — a unit without a pack cannot be converted, and normalizeUnitPrice needs both operands (ADR 0119 invariant 2).';

comment on column public.procurement_order_items.final_unit_price is
  'The agreed price, stated in price_uom over price_pack_size. Where the pair is NULL the historical per-bottle convention applies and is enforced by arithmetic alone (line_total = final_unit_price x total_bottles) — which is the ambiguity ADR 0119 exists to end. Read the pair first.';

comment on column public.procurement_orders.final_price is
  'An ECHO of the line''s final_unit_price, not a second source of truth. It names no unit; the line''s price_uom/price_pack_size do. ADR 0119 Q2 (whether this column becomes GENERATED from the line, or is dropped) is still the founder''s to answer — until then a reader that needs the unit must read the line.';

-- ---------------------------------------------------------------------------
-- 4. In-file assertions. A migration that reports success without having done
--    what it claims is the absence-reported-as-health fault in DDL form.
-- ---------------------------------------------------------------------------
do $$
declare
  missing text;
begin
  select string_agg(c, ', ')
    into missing
    from unnest(array['price_uom','price_pack_size']) c
   where not exists (
     select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name   = 'procurement_order_items'
        and column_name  = c
   );
  if missing is not null then
    raise exception 'procurement_order_items is missing % after this migration claimed to add it.', missing;
  end if;
end $$;

do $$
declare
  missing text;
begin
  select string_agg(n, ', ')
    into missing
    from unnest(array[
      'procurement_order_items_price_uom_check',
      'procurement_order_items_price_unit_pair_check',
      'procurement_order_items_price_pack_size_check'
    ]) n
   where not exists (
     select 1
       from pg_constraint pc
       join pg_class pcl on pcl.oid = pc.conrelid
       join pg_namespace pn on pn.oid = pcl.relnamespace
      where pn.nspname = 'public'
        and pcl.relname = 'procurement_order_items'
        and pc.conname = n
   );
  if missing is not null then
    raise exception 'CHECK constraint(s) % were not created. A price column with no CHECK accepts a case price called a bottle price, which is the whole defect.', missing;
  end if;
end $$;

-- The no-backfill assertion. Stated as an assertion rather than as a comment
-- because a later edit that "helpfully" defaults the pair would pass every test
-- in the tree and silently file every legacy case price as a bottle price.
do $$
declare
  stated bigint;
begin
  select count(*) into stated
    from public.procurement_order_items
   where price_uom is not null;
  if stated > 0 then
    raise exception
      'This migration must not state a price unit for any existing row; % row(s) already carry one. An unstated unit stays unstated (ADR 0119 invariant 7).',
      stated;
  end if;
end $$;

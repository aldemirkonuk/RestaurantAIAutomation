-- The agreement names its money — ADR 0117 Q31, founder decision 2026-09-05:
-- "A currency column on the agreement line, defaulted from the vendor's terms
-- or the house, stated on the sheet".
--
-- ---------------------------------------------------------------------------
-- THE GAP, MEASURED
-- ---------------------------------------------------------------------------
-- `20260905073000_the_agreement_names_the_money_outside_the_price.sql` states,
-- in its own header, that its three new amounts are "POSITIVE amounts, in the
-- agreement's currency, for the whole line". Measured 2026-09-05 against
-- production and against this branch: **no column anywhere says what that
-- currency is.** `procurement_order_items` has `quoted_unit_price`,
-- `negotiated_unit_price`, `final_unit_price`, `line_total`, `allowance`,
-- `deposit` and `freight` — seven money columns and not one denomination.
-- `procurement_orders` has none either.
--
-- The consequence was visible one table over. `price_history.currency`
-- (`20260905120000`) had to be written NULL on every `order_confirmed` row,
-- because the writer had nothing to read; and `vendor_price_observations`,
-- whose `currency` is NOT NULL, had to REFUSE every confirmed-order sighting
-- outright. A whole class of price evidence was being dropped for want of three
-- letters.
--
-- ---------------------------------------------------------------------------
-- THE SHAPE
-- ---------------------------------------------------------------------------
--   * `character varying(3)`, matching the other six `currency` columns in this
--     schema rather than inventing a seventh width.
--   * **NULLABLE, and NO DEFAULT.** A default is exactly what put `USD` on a
--     restaurant in Fethiye (`restaurants.currency`, 14 of 14 houses,
--     ADR 0117 Q25). An agreement whose desk never stated a currency has not
--     stated one, and the row says so; the sheet asks, with a stated default
--     the person can change, which is a different thing from a silent one.
--   * An ISO 4217 shape CHECK. Without it the column takes `'usd'`, `'US$'` and
--     `'TL'` as three more currencies, and `price_history` would inherit them.
--
-- WHERE THE SHEET'S DEFAULT COMES FROM, AND WHAT IT IS NOT
-- --------------------------------------------------------
-- The founder said "the vendor's terms or the house". Measured: the terms table
-- `restaurant_vendor_terms` (`20260903140000`) has SEVEN columns and none of
-- them is a currency — so "the vendor's terms" has no field to read today. The
-- resolution chain built beside this migration
-- (`apps/api-gateway/src/procurement/agreement-currency.ts`) therefore reads,
-- in order:
--
--   1. what this vendor has actually BILLED this house in — the most recent
--      `procurement_documents.currency` for this provider. That is the vendor's
--      own paper rather than a typed opinion about it, and production already
--      holds two `TRY` invoices against a house whose own row says `USD`;
--   2. the house's reporting currency, `restaurants.currency`;
--   3. nothing, and a sentence saying so.
--
-- Whether a typed currency belongs on the terms sheet as well is a real
-- question and is filed as one, not assumed here: it would be a column, a form
-- field, a DTO and an audit row, and none of that was asked for.
--
-- COST ON EXISTING DATA
-- ---------------------
-- Measured 2026-09-05 against production, read-only: `procurement_order_items`
-- holds 1 row. One nullable column and one CHECK over a column that did not
-- exist a moment ago cost nothing. **No backfill**: an agreement that named no
-- currency did not have one recorded, and stamping the house's onto it would be
-- a claim about a vendor that no paper makes — the whole fault this line of work
-- exists to end.
--
-- ADDITIVE. One nullable column, one CHECK, one comment. No UPDATE of any
-- existing row, no DROP, no RLS change.
set local statement_timeout = '120s';

-- ---------------------------------------------------------------------------
-- 1. The column.
-- ---------------------------------------------------------------------------
alter table public.procurement_order_items
  add column if not exists currency character varying(3);

alter table public.procurement_order_items
  drop constraint if exists procurement_order_items_currency_check,
  add  constraint procurement_order_items_currency_check
       check (currency is null or currency ~ '^[A-Z]{3}$');

comment on column public.procurement_order_items.currency is
  'The money EVERY amount on this line is in — `quoted_unit_price`, `negotiated_unit_price`, `final_unit_price`, `line_total`, `allowance`, `deposit` and `freight`, all seven of them (ADR 0117 Q31, decided 2026-09-05). ISO 4217 alpha-3. NULLABLE with NO DEFAULT: an agreement whose desk stated no currency has not stated one, and NULL means NOT RECORDED — no reader may substitute `restaurants.currency`, USD, or the currency of the line beside it. The sign-up-style rule applies here too: the sheet offers a default worked out from what this vendor has billed this house in, and the person confirms or changes it. Nothing in this system converts between currencies, so a comparison across two lines must group by this column before it subtracts.';

-- ---------------------------------------------------------------------------
-- 2. In-file assertions.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name   = 'procurement_order_items'
       and column_name  = 'currency'
  ) then
    raise exception 'procurement_order_items.currency was not added. Seven money columns on this line would go on naming no denomination, and 20260905073000 would go on claiming "the agreement''s currency" about a currency nothing states.';
  end if;

  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name   = 'procurement_order_items'
       and column_name  = 'currency'
       and column_default is not null
  ) then
    raise exception 'procurement_order_items.currency has a default. A defaulted currency is a claim about a vendor nobody made — see restaurants.currency, which said USD about a house in Fethiye for seven months.';
  end if;

  if not exists (
    select 1
      from pg_constraint pc
      join pg_class pcl on pcl.oid = pc.conrelid
      join pg_namespace pn on pn.oid = pcl.relnamespace
     where pn.nspname = 'public'
       and pcl.relname = 'procurement_order_items'
       and pc.conname = 'procurement_order_items_currency_check'
  ) then
    raise exception 'procurement_order_items_currency_check was not created.';
  end if;
end $$;

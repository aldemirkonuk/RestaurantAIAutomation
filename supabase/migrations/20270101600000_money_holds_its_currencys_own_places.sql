-- MONEY HOLDS ITS CURRENCY'S OWN PLACES. F-452.
--
-- WHAT BROKE. The 2026-10 time-and-money sim (wave11sim/time-money-edges.md
-- finding 1, confirmed by a refute-first pass at 7379426e3): every price and
-- total on an order, its line, an invoice and a credit claim was numeric(10,2)
-- or numeric(12,2) (baseline :4489-4492, :4523-4526, :4552-4559, :4349-4351,
-- :4392-4394, :4443-4454, :4279). Two houses break on it:
--   * a three-decimal house. lib/currency.ts gives BHD, IQD, JOD, KWD, LYD,
--     OMR and TND three minor digits. A Manama house agrees 1.255 BHD a
--     bottle; Postgres stores 1.26 and every screen prints "BHD 1.260", which
--     reads as exact and is a different amount from the invoice.
--   * a high-nominal house. numeric(10,2) stops at 99,999,999.99. 72 bottles
--     at VND 1,450,000 is 104,400,000, and the insert fails with 22003, which
--     createOrder rethrows raw — an ordinary case order cannot be placed.
--
-- THE TYPE: numeric(18,4) — the coordinator's call under the founder's
-- 2026-10-07 delegation (no ADR locks a money scale; decision note
-- p4-scratch/sim-run/bulletproof/reconcile/currency-money-decisions.md, with
-- the alternatives weighed and an adversarial pass). Scale 4 is the widest
-- ISO 4217 minor unit and the scale procurement_document_lines.unit_price
-- already has (numeric(12,4)); the gateway rounds every amount to the
-- currency's own places before it writes (common/iso-4217.ts roundMoney), so
-- the fourth place is headroom, not noise. Precision 18 leaves 14 integer
-- digits — 100 trillion, room for a statement in rial or Lebanese pounds —
-- while any realistic amount stays inside a JavaScript number's 15 exact
-- digits. Existing values are unchanged: 12.50 reads back as 12.5000, the
-- same number.
--
-- WHAT IS NOT WIDENED HERE, AND WHY. restaurant_inventory's menu prices and
-- inventory_lots.unit_cost are numeric(10,2) too, but six views select them
-- (inventory_analytics, inventory_volume_details, v_active_inventory,
-- v_low_stock_items, inventory_lot_rollup, inventory_location_breakdown) and
-- Postgres refuses ALTER TYPE under a view; set_house_menu_price,
-- change_locked_house_menu_price and move_house_price_lock also round menu
-- prices to two places in SQL. Recreating six views and three RPCs is its own
-- migration, left for that lane rather than folded into this one.
--
-- WHAT DEPENDS ON THESE COLUMNS. Measured on a database built from every file
-- in supabase/migrations at 7379426e3 (pg_depend): no view, rule, policy or
-- generated column; CHECK constraints (rebuilt by the ALTER, unchanged); and
-- two column-list triggers — trg_procurement_line_price_echoes_to_header
-- (UPDATE OF final_unit_price) and trg_procurement_header_price_is_an_echo
-- (UPDATE OF final_price). Postgres refuses ALTER TYPE on a column a trigger
-- names, so both are dropped and recreated exactly as
-- 20260905072000_the_header_price_echoes_the_line.sql made them. Their two
-- functions held the line price in a numeric(10,2) VARIABLE: left alone, a
-- 1.255 line would be echoed to the header as 1.26 and the header check would
-- refuse its own echo. Both are re-issued with that variable as plain numeric,
-- every other byte as before (CREATE OR REPLACE keeps their grants, revokes and
-- comments).
--
-- LOCK AND COST. A scale change rewrites the table (measured: the relfilenode
-- changes; a precision-only change does not), one rewrite per table because
-- each table's columns change in one ALTER. That holds ACCESS EXCLUSIVE on
-- six procurement tables for the rewrite — milliseconds at one house's
-- volume; production row counts were not measured from here (no production
-- call). statement_timeout follows the repo's ALTER TABLE precedent. No
-- explicit BEGIN/COMMIT: the Supabase CLI wraps each file in a transaction, so
-- a failure (a trigger or view that exists in production and not in the
-- migration corpus) rolls the whole file back. Re-runnable.

SET local statement_timeout = '120s';

drop trigger if exists trg_procurement_header_price_is_an_echo
  on public.procurement_orders;
drop trigger if exists trg_procurement_line_price_echoes_to_header
  on public.procurement_order_items;

alter table public.procurement_orders
  alter column quoted_price                 type numeric(18,4),
  alter column negotiated_price             type numeric(18,4),
  alter column final_price                  type numeric(18,4),
  alter column total_cost                   type numeric(18,4),
  alter column total_estimated_cost         type numeric(18,4),
  alter column final_confirmed_cost         type numeric(18,4),
  alter column invoice_unit_price           type numeric(18,4),
  alter column prefilled_invoice_unit_price type numeric(18,4);

alter table public.procurement_order_items
  alter column quoted_unit_price     type numeric(18,4),
  alter column negotiated_unit_price type numeric(18,4),
  alter column final_unit_price      type numeric(18,4),
  alter column line_total            type numeric(18,4),
  alter column allowance             type numeric(18,4),
  alter column deposit               type numeric(18,4),
  alter column freight               type numeric(18,4);

alter table public.procurement_documents
  alter column subtotal             type numeric(18,4),
  alter column freight              type numeric(18,4),
  alter column fuel_surcharge       type numeric(18,4),
  alter column split_case_fee       type numeric(18,4),
  alter column delivery_fee         type numeric(18,4),
  alter column deposit_total        type numeric(18,4),
  alter column tax                  type numeric(18,4),
  alter column other_charges        type numeric(18,4),
  alter column discount_total       type numeric(18,4),
  alter column total                type numeric(18,4),
  alter column computed_lines_total type numeric(18,4),
  alter column tie_out_delta        type numeric(18,4);

alter table public.procurement_document_lines
  alter column unit_price type numeric(18,4),
  alter column line_total type numeric(18,4),
  alter column allowance  type numeric(18,4),
  alter column deposit    type numeric(18,4);

alter table public.procurement_credits
  alter column claimed_amount  type numeric(18,4),
  alter column credited_amount type numeric(18,4);

alter table public.price_history
  alter column price type numeric(18,4);

-- The two echo functions, re-issued from
-- 20260905072000_the_header_price_echoes_the_line.sql with one change each:
-- `v_line_price numeric(10,2)` is now `numeric`, so the echo carries the line's
-- price at whatever scale the column holds instead of rounding it to two.
create or replace function public.procurement_line_price_echoes_to_header()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order_id uuid;
  v_line_price numeric;
begin
  v_order_id := coalesce(new.order_id, old.order_id);
  if v_order_id is null then
    return null;
  end if;

  -- The order's own agreed price: the lowest-numbered line that states one.
  -- `upsertOrderLine` writes exactly one line (`line_no = 1`, delete then
  -- insert), so this is that line today; the ordering is written out rather
  -- than assumed so a second line cannot silently change which price the
  -- header carries.
  select i.final_unit_price
    into v_line_price
    from public.procurement_order_items i
   where i.order_id = v_order_id
     and i.final_unit_price is not null
   order by i.line_no asc nulls last, i.created_at asc
   limit 1;

  -- No line states a price — including the moment between `upsertOrderLine`'s
  -- DELETE and its INSERT. The header keeps what it has: `final_price` is NOT
  -- NULL, so there is no honest value to write here, and blanking it would
  -- destroy the order's only price for the duration of a merge.
  if v_line_price is null then
    return null;
  end if;

  update public.procurement_orders o
     set final_price = v_line_price
   where o.id = v_order_id
     and o.final_price is distinct from v_line_price;

  return null;
end $$;

create or replace function public.procurement_header_price_is_an_echo()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_line_price numeric;
begin
  -- Only a CHANGE to this one column is examined. Every other UPDATE on the
  -- order — status, approval, delivery, notes — passes through untouched.
  if new.final_price is not distinct from old.final_price then
    return new;
  end if;

  select i.final_unit_price
    into v_line_price
    from public.procurement_order_items i
   where i.order_id = new.id
     and i.final_unit_price is not null
   order by i.line_no asc nulls last, i.created_at asc
   limit 1;

  -- An order with no priced line has nothing to disagree with, and something
  -- has to be able to set the price of an order that has not been written down
  -- as a line yet. That is the one door left open, and it closes by itself the
  -- moment a line exists.
  if v_line_price is null then
    return new;
  end if;

  if new.final_price is distinct from v_line_price then
    raise exception
      'procurement_orders.final_price is an echo of the order line, not a second source of truth (ADR 0119 Q2).'
      using errcode = '23514',
            detail  = format(
              'The line states %s; this update said %s. The header names no unit at all, so a number written here that the line does not carry cannot be read back in any unit.',
              v_line_price, new.final_price),
            hint    = 'Write procurement_order_items.final_unit_price (with its price_uom/price_pack_size). The header follows it in the same transaction.';
  end if;

  return new;
end $$;

create trigger trg_procurement_line_price_echoes_to_header
  after insert or delete or update of final_unit_price, line_no, order_id
  on public.procurement_order_items
  for each row execute function public.procurement_line_price_echoes_to_header();

create trigger trg_procurement_header_price_is_an_echo
  before update of final_price
  on public.procurement_orders
  for each row execute function public.procurement_header_price_is_an_echo();

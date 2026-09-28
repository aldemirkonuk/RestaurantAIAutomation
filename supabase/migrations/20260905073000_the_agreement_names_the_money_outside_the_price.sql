-- The agreement names the money outside the price — ADR 0119 phase 2, founder
-- decisions Q3 and Q6 (2026-09-05: "allowance, deposit, freight as their own
-- columns on the agreement line, mirroring the invoice; the total prints its
-- working; the receiving door compares like with like" and "a split case is its
-- own agreement line — a different pack with a different price, never a
-- surcharge on the case line").
--
-- Q3 — WHY THE AGREEMENT NEEDS THESE THREE
-- ----------------------------------------
-- ADR 0119 invariant 5: *money outside the unit price is named, not folded in.*
-- The INVOICE line already obeys it — `procurement_document_lines.allowance`
-- and `.deposit`, both `numeric(12,2)` (`20260805000000:4393-4394`) — and the
-- posted-price register obeys it (`container_charge`, `20260904200000:103`).
-- The AGREEMENT obeyed none of it: `final_unit_price` was the only money on the
-- line, so a deposit, a delivery charge or an off-invoice allowance either
-- disappeared or was folded into the unit price, where it is indistinguishable
-- from the vendor charging more for the wine.
--
-- The three are the trade's own three, each with a source in ADR 0119's
-- research: a container deposit is administered as a separate charge from the
-- product price (California's CRV, extended to wine and spirits 2024-01-01);
-- freight is published as its own schedule by weight and distance (LibDib); an
-- allowance is the invoice's own deduction. `numeric(12,2)` and the same two
-- names as the invoice line, so the door can compare like with like instead of
-- comparing a goods price to a goods-plus-deposit price.
--
-- SIGN CONVENTION, STATED ONCE: all three are POSITIVE amounts, in the
-- agreement's currency, for the whole line. `allowance` DEDUCTS; `deposit` and
-- `freight` ADD. That mirrors how the canonical document models them (a
-- positive `amount` with an `isCharge` flag deciding the direction,
-- `canonical-types.ts`) rather than inviting a negative number whose sign is a
-- second, unwritten convention.
--
-- Q6 — WHAT `split_case` BECOMES
-- ------------------------------
-- Until now `split_case` was a bare word in a seven-word vocabulary, legal to
-- write and meaning nothing in particular. It now means one thing: **this line
-- is the broken case, as its own trade item, with its own price** —
-- `price_pack_size` being the number of bottles actually in the broken pack,
-- not the number in a full case. It is never a fee added to a case line.
--
-- The warrant is GS1's, transplanted: "a change to the pre-defined number of
-- trade items contained in a pack or case ... requires assignment of a new GTIN
-- to the changed level" — a pack change makes a different trade item, and a
-- different trade item is a different line, not a modifier on an existing one.
-- ADR 0119 invariant 3 says the same in the house's words.
--
-- The CHECK below refuses the one shape the decision rules out and can be seen
-- from a single row: a line that is a `case` on one axis and a `split_case` on
-- the other. That is "a surcharge on the case line" written as a unit — whole
-- cases quoted at a broken-case price, or a broken case quoted at the full case
-- price. What a CHECK cannot see is a split-case FEE hidden inside `freight` on
-- a case line; nothing in a row can. What it CAN do is leave that fee no home
-- of its own, which is why this migration adds no `split_case_fee` column and
-- never will.
--
-- COST ON EXISTING DATA
-- ---------------------
-- Measured 2026-09-05 against production (Supabase project `Restaurant_Wine_Ops`
-- / exzueerziesmczwlhomd, PG 17.6.1.063), read-only: 1 `procurement_order_items`
-- row and 0 rows carrying a `price_uom` at all (the phase-1 columns are not yet
-- applied there). Three nullable columns and a CHECK over a column that does
-- not exist in production yet therefore cost nothing. No backfill: an
-- agreement that named no deposit did not have one recorded, and a 0.00 would
-- be a claim that the vendor charged none.
--
-- ADDITIVE. Three nullable columns, four CHECKs, five comments. No UPDATE of
-- any existing row, no DROP, no RLS change.
set local statement_timeout = '120s';

-- ---------------------------------------------------------------------------
-- 1. The three columns.
-- ---------------------------------------------------------------------------
alter table public.procurement_order_items
  add column if not exists allowance numeric(12,2);

alter table public.procurement_order_items
  add column if not exists deposit numeric(12,2);

alter table public.procurement_order_items
  add column if not exists freight numeric(12,2);

-- ---------------------------------------------------------------------------
-- 2. Each one is a positive amount or absent.
-- ---------------------------------------------------------------------------
-- NULL and 0.00 are different facts and both are legal: NULL is "the agreement
-- said nothing about a deposit", 0.00 is "the agreement says there is none".
-- A negative amount is refused because the direction is carried by the column
-- name — a negative allowance is a charge wearing a deduction's name, and the
-- total that printed its working would print a subtraction that adds.
alter table public.procurement_order_items
  drop constraint if exists procurement_order_items_allowance_check,
  add  constraint procurement_order_items_allowance_check
       check (allowance is null or allowance >= 0);

alter table public.procurement_order_items
  drop constraint if exists procurement_order_items_deposit_check,
  add  constraint procurement_order_items_deposit_check
       check (deposit is null or deposit >= 0);

alter table public.procurement_order_items
  drop constraint if exists procurement_order_items_freight_check,
  add  constraint procurement_order_items_freight_check
       check (freight is null or freight >= 0);

-- ---------------------------------------------------------------------------
-- 3. A split case is its own line.
-- ---------------------------------------------------------------------------
alter table public.procurement_order_items
  drop constraint if exists procurement_order_items_split_case_own_line_check,
  add  constraint procurement_order_items_split_case_own_line_check
       check (
         price_uom is null
         or not (
           (price_uom::text = 'split_case' and unit_type::text = 'case')
           or
           (price_uom::text = 'case' and unit_type::text = 'split_case')
         )
       );

-- ---------------------------------------------------------------------------
-- 4. What each column claims, where a reader of the row will find it.
-- ---------------------------------------------------------------------------
comment on column public.procurement_order_items.allowance is
  'Money the vendor DEDUCTS from this line, stated as a positive amount for the whole line — the agreement''s mirror of procurement_document_lines.allowance. Outside final_unit_price, deliberately: folded in, a one-off deduction is indistinguishable from the wine being cheaper, and the next order inherits a price the vendor never gave (ADR 0119 Q3, invariant 5).';

comment on column public.procurement_order_items.deposit is
  'Refundable container deposit for this line, a positive amount for the whole line — the agreement''s mirror of procurement_document_lines.deposit. It is not part of what the wine costs: California administers CRV as a separate charge, and a deposit folded into the unit price becomes a permanent price rise on a bottle that will be redeemed (ADR 0119 Q3).';

comment on column public.procurement_order_items.freight is
  'Delivery, fuel surcharge and any other carriage agreed for this line, a positive amount for the whole line. The invoice has no freight column of its own (the parser codes it as a document-level BG-21 charge), so this is the agreement''s side of a figure the door reconciles against the invoice''s charges rather than against its goods price (ADR 0119 Q3).';

comment on column public.procurement_order_items.line_total is
  'What this line comes to: the goods (final_unit_price over price_uom/price_pack_size, times how many of that unit were bought) minus allowance, plus deposit, plus freight. With all three NULL it is the goods total unchanged, which is every line written before ADR 0119 phase 2. The working is printed wherever the figure is (agreed-price.ts agreementLineTotal).';

comment on constraint procurement_order_items_split_case_own_line_check
  on public.procurement_order_items is
  'A split case is its own agreement line, never a surcharge on the case line (ADR 0119 Q6, decided 2026-09-05). GS1: a pack change assigns a new GTIN, so a broken case is a different trade item. Whole cases may not be quoted at a broken-case price, and a broken case may not be quoted at the full case price; either is the surcharge shape wearing a unit''s name.';

-- ---------------------------------------------------------------------------
-- 5. In-file assertions.
-- ---------------------------------------------------------------------------
do $$
declare
  missing text;
begin
  select string_agg(c, ', ')
    into missing
    from unnest(array['allowance','deposit','freight']) c
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
      'procurement_order_items_allowance_check',
      'procurement_order_items_deposit_check',
      'procurement_order_items_freight_check',
      'procurement_order_items_split_case_own_line_check'
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
    raise exception 'CHECK constraint(s) % were not created. A fee column with no sign rule accepts a negative deposit, and without the split-case rule the vocabulary word means nothing again.', missing;
  end if;
end $$;

-- No backfill, and it is asserted rather than promised: a later edit that
-- "helpfully" defaulted these to 0.00 would pass every test in the tree while
-- claiming, on every historical line, that the vendor charged no deposit.
do $$
declare
  stated bigint;
begin
  select count(*) into stated
    from public.procurement_order_items
   where allowance is not null or deposit is not null or freight is not null;
  if stated > 0 then
    raise exception
      'This migration must not state a fee for any existing line; % line(s) already carry one. An agreement that named no deposit did not have one (ADR 0119 invariant 7).',
      stated;
  end if;
end $$;

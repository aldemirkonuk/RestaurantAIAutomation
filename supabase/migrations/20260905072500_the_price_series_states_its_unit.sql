-- The price series states its unit — ADR 0119 phase 2, founder decision Q4
-- (2026-09-05: "price_history carries a stated unit; kegs and cases enter with
-- their own unit; every comparison groups by unit first").
--
-- WHAT THE COLUMN CLAIMED, AND WHY THAT WAS A LIE WAITING
-- -------------------------------------------------------
-- `price_history.unit` has been `character varying(20) DEFAULT 'BOTTLE'`,
-- NULLABLE, since the production baseline (`20260805000000:4281`), and the one
-- writer in the repository hardcodes the literal `'BOTTLE'`
-- (`procurement.service.ts` `recordPriceHistory`). A default and a constant are
-- not a statement: the column asserted "bottle" about every row whatever the
-- agreement said, so a per-case price entering the series would have been
-- filed as a bottle price twelve times too cheap, and a per-keg price had no
-- reading at all — which is why phase 1 had to REFUSE a keg rather than record
-- it. ADR 0119 called that "the current shape and a lie the moment a keg is
-- priced" and left it as the founder's Q4. Option B was taken.
--
-- THE SHAPE
-- ---------
--   * NOT NULL. A price whose unit nobody stated does not enter the series;
--     the writer refuses it in a sentence rather than calling it a bottle
--     (ADR 0119 invariant 7). That matches what `vendor_price_observations`
--     already does with the same event, so the two registers now refuse the
--     same thing for the same reason instead of one of them inventing a unit.
--   * The DEFAULT is DROPPED. A default is exactly the mechanism that made the
--     old column a constant: with one in place, an insert that says nothing
--     still produces a confident "BOTTLE".
--   * A vocabulary CHECK — the same seven singulars as
--     `procurement_order_items.price_uom` (`20260905010000:81`), `unit_type`
--     (`20260901150000:129`) and `procurement_document_lines.uom`
--     (`baseline:4402`). The fifth copy of one vocabulary; all five move
--     together or none does.
--
-- THE EXISTING ROWS
-- -----------------
-- Measured 2026-09-05 against production (Supabase project `Restaurant_Wine_Ops`
-- / exzueerziesmczwlhomd, PG 17.6.1.063), read-only:
--   price_history rows                 0
--   rows with unit IS NULL             0
--   distinct units present             (none)
-- So there is nothing to backfill on the only surface that matters, and this
-- migration invents nothing.
--
-- One normalisation IS performed, and it is a case-fold rather than a claim:
-- `'BOTTLE'` becomes `'bottle'`. That is provable rather than assumed — the
-- only writer that has ever produced `'BOTTLE'` is `recordPriceHistory`, which
-- converts a stated per-case price to a per-bottle figure BEFORE the insert and
-- records the arithmetic in the row's `notes` (`agreed-price.ts`
-- `perBottleFromAgreedPrice`), and refuses an opaque unit outright. Its rows
-- therefore are per bottle; only the spelling changes. ANY OTHER value is
-- refused below rather than guessed at, because a unit this file cannot prove
-- is a unit this file must not assign.
--
-- WHAT THIS DOES NOT DO, STATED SO IT IS NOT ASSUMED
-- --------------------------------------------------
-- "Every comparison groups by unit first" has no comparison to fix today:
-- measured on this tree, `price_history` has exactly one writer and NO reader
-- anywhere in `apps/` or `services/` (`grep -rn 'price_history'`; the Python
-- agent's `_get_price_history` reads `procurement_orders.price_per_bottle`, a
-- different table). The rule is therefore recorded in the column comment, where
-- the first reader will find it, and is not enforceable here — a CHECK cannot
-- make a future SELECT group.
--
-- ADDITIVE in effect: one CHECK, one NOT NULL, one dropped default, two
-- comments. No column added or dropped, no RLS change. The only UPDATE is the
-- case-fold above, and it touched 0 rows in production.
set local statement_timeout = '120s';

-- ---------------------------------------------------------------------------
-- 1. Prove what is there before changing what it means.
-- ---------------------------------------------------------------------------
do $$
declare
  unstated bigint;
  strangers text;
begin
  select count(*) into unstated
    from public.price_history
   where unit is null;
  if unstated > 0 then
    raise exception
      'price_history holds % row(s) whose unit is NULL. This migration will not name them: an unstated unit stays unstated (ADR 0119 invariant 7). Decide what each one is, state it, and re-run.',
      unstated;
  end if;

  select string_agg(distinct quote_literal(unit), ', ')
    into strangers
    from public.price_history
   where unit is not null
     and unit <> 'BOTTLE'
     and unit not in ('bottle','case','keg','pack','split_case','each','liter');
  if strangers is not null then
    raise exception
      'price_history holds unrecognised unit(s) %. Only the case-fold BOTTLE -> bottle is provable here (its writer converted to per-bottle before inserting). Normalise the rest explicitly; do not widen the CHECK to accommodate one.',
      strangers;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. The case-fold. Same unit, house spelling.
-- ---------------------------------------------------------------------------
update public.price_history
   set unit = 'bottle'
 where unit = 'BOTTLE';

-- ---------------------------------------------------------------------------
-- 3. A stated unit, or no row.
-- ---------------------------------------------------------------------------
alter table public.price_history
  alter column unit drop default;

alter table public.price_history
  alter column unit set not null;

alter table public.price_history
  drop constraint if exists price_history_unit_check,
  add  constraint price_history_unit_check
       check (unit::text = any (array[
         'bottle','case','keg','pack','split_case','each','liter'
       ]::text[]));

-- ---------------------------------------------------------------------------
-- 4. What the two number columns on this row are each counted in.
-- ---------------------------------------------------------------------------
comment on column public.price_history.unit is
  'The unit `price` is stated in — one of the seven singulars, NOT NULL, no default (ADR 0119 Q4, decided 2026-09-05). A case price enters as ''case'' at the case price and a keg price as ''keg''; nothing is converted on the way in, so nothing can be un-converted wrongly on the way out. An agreement that states no unit does not enter this table at all — the writer refuses it in words rather than calling it a bottle. EVERY comparison over this table must group by this column first: averaging a case price with a bottle price is wrong by the pack size, always in the direction that looks like a bargain.';

comment on column public.price_history.price is
  'The observed price, stated in `unit`. Never per bottle by convention — read `unit` first (ADR 0119 Q4).';

comment on column public.price_history.quantity is
  'How large the observation was, in BOTTLES — the order''s bottle count, not a count of `unit`. Named here because two numbers on one row may not assert different units without saying so (ADR 0119 invariant 4). It is a weight on the observation, never an operand of `price`.';

-- ---------------------------------------------------------------------------
-- 5. In-file assertions.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name   = 'price_history'
       and column_name  = 'unit'
       and (is_nullable = 'YES' or column_default is not null)
  ) then
    raise exception 'price_history.unit is still nullable or still has a default. Either one lets a row into the series without a stated unit, which is the whole defect (ADR 0119 Q4).';
  end if;

  if not exists (
    select 1
      from pg_constraint pc
      join pg_class pcl on pcl.oid = pc.conrelid
      join pg_namespace pn on pn.oid = pcl.relnamespace
     where pn.nspname = 'public'
       and pcl.relname = 'price_history'
       and pc.conname = 'price_history_unit_check'
  ) then
    raise exception 'price_history_unit_check was not created. A unit column with no vocabulary accepts ''cases'', ''btl'' and ''BOTTLE'' as three different series.';
  end if;
end $$;

do $$
declare
  leftover bigint;
begin
  select count(*) into leftover from public.price_history where unit = 'BOTTLE';
  if leftover > 0 then
    raise exception 'The case-fold left % row(s) spelled BOTTLE, which the CHECK should already have refused. Something re-inserted during this migration.', leftover;
  end if;
end $$;

-- The header price echoes the line — ADR 0119 phase 2, founder decision Q2
-- (2026-09-05: "procurement_orders.final_price becomes a generated column from
-- the line's pair — no writer can make the two disagree; the four readers keep
-- working").
--
-- WHAT WAS ASKED, AND WHY IT IS NOT A GENERATED COLUMN
-- ----------------------------------------------------
-- "Generated from the line" is the right SEMANTICS and an impossible MECHANISM.
-- Measured 2026-09-05 against a throwaway Postgres 18.3 (PGlite 0.5.8) holding
-- a transcription of these two tables, probe `$SP/pglite-probe/q2-probe.mjs`:
--
--   ACCEPTED  header column GENERATED ALWAYS AS (an IMMUTABLE function that
--             queries the line) STORED
--   REFUSED   header column GENERATED ALWAYS AS (subselect over the line)
--             STORED            -> 0A000 cannot use subquery in column
--                                  generation expression
--   REFUSED   the same expression as VIRTUAL
--                               -> 0A000 generation expression uses
--                                  user-defined function
--   REFUSED   alter column final_price add generated always as (...)
--                               -> 42601 syntax error (no such syntax)
--   REFUSED   alter column final_price set expression as (...)
--                               -> 55000 column "final_price" ... is not a
--                                  generated column
--
-- Three facts fall out of that, and the shape below is what is left:
--
-- 1. A generation expression may not read another table. The ONE spelling
--    Postgres accepts — wrapping the subquery in a function labelled IMMUTABLE
--    — is the worst possible outcome, not a loophole: the label is taken on
--    trust, the expression is evaluated ONCE at insert (when the order has no
--    line yet, so it stores NULL) and never recomputed when the line changes.
--    It would be a column that reports the absence of a read as a fact, which
--    is the exact fault this house names as absence-reported-as-health. It is
--    recorded here precisely so nobody "fixes" this migration into it later.
-- 2. `final_price` cannot become generated in place under any syntax. Doing it
--    would mean DROP + ADD — destructive, not additive, and it would break the
--    readers this decision requires to keep working.
-- 3. `procurement_orders.final_price` is `numeric(10,2) NOT NULL`
--    (`20260805000000_baseline_from_production.sql:4525`) and the header is
--    INSERTed before its line exists (the line's FK points at the header). So
--    a CHECK that refused every direct write would make it impossible to
--    create an order at all.
--
-- THE SHAPE, THEN: a trigger pair. The line is the source of truth; the header
-- follows it and REFUSES, in a sentence, any write that would make the two
-- disagree. That is what "generated" was asked for and it is enforced by the
-- database rather than by a comment (the phase-1 column comment said "an ECHO
-- of the line" and nothing made it true).
--
--   * INSERT of a header, no line yet          -> allowed (nothing to disagree with)
--   * INSERT/UPDATE/DELETE of a line           -> the header is set from the line
--   * UPDATE of the header's final_price       -> refused when a line states a price
--                                                 and the two differ; allowed when
--                                                 they agree, and allowed when no
--                                                 line states one
--   * UPDATE of any other header column        -> untouched
--
-- WHAT IT COSTS ON EXISTING DATA
-- ------------------------------
-- Measured 2026-09-05 against production (Supabase project `Restaurant_Wine_Ops`
-- / exzueerziesmczwlhomd, PG 17.6.1.063), read-only:
--   procurement_orders                                  2
--   procurement_order_items                             1
--   orders whose line disagrees with their header       0
-- So no existing row is affected, and the assertion below would have caught it
-- if one were. Nothing is reconciled by this migration: a header that disagreed
-- with its line would be a fact about that order, and silently rewriting it is
-- the fabrication ADR 0119 exists to end. It raises instead.
--
-- ADDITIVE. Two functions, two triggers, three comments. No column added or
-- dropped, no UPDATE of any existing row, no RLS change, no grant widened.
set local statement_timeout = '120s';

-- ---------------------------------------------------------------------------
-- 0. Refuse to arm the rule over data the rule would already be breaking.
-- ---------------------------------------------------------------------------
do $$
declare
  disagreeing bigint;
begin
  select count(*)
    into disagreeing
    from public.procurement_orders o
   where exists (
     select 1
       from public.procurement_order_items i
      where i.order_id = o.id
        and i.final_unit_price is not null
        and i.final_unit_price is distinct from o.final_price
   );
  if disagreeing > 0 then
    raise exception
      'Cannot make the header an echo of the line: % order(s) already disagree with their own line. Decide which number is the agreement for each one and write the LINE, then re-run. Rewriting them here would silently pick a winner (ADR 0119 Q2, ADR 0020).',
      disagreeing;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. The line writes the header.
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER, deliberately. Under SECURITY INVOKER an RLS-scoped writer
-- that could insert a line but not update the order would have its UPDATE
-- silently filtered to zero rows — no error, and the header would drift away
-- from the line exactly where nobody is looking. A trigger that quietly does
-- nothing is the absence-reported-as-health fault in DDL form. It cannot reach
-- another tenant's row: `v_order_id` is taken from the row being written and
-- the FK `procurement_order_items_order_id_fkey` guarantees that order exists
-- and is the one this line belongs to. `search_path` is pinned so the body
-- cannot be redirected at a schema a caller controls.
create or replace function public.procurement_line_price_echoes_to_header()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order_id uuid;
  v_line_price numeric(10,2);
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

comment on function public.procurement_line_price_echoes_to_header() is
  'Keeps procurement_orders.final_price equal to the agreed price on its lowest-numbered line (ADR 0119 Q2). The header names no unit; the line does, in price_uom/price_pack_size — so the header is the line''s number and never a converted one.';

revoke all on function public.procurement_line_price_echoes_to_header() from public;
revoke all on function public.procurement_line_price_echoes_to_header() from anon, authenticated;

drop trigger if exists trg_procurement_line_price_echoes_to_header
  on public.procurement_order_items;
create trigger trg_procurement_line_price_echoes_to_header
  after insert or delete or update of final_unit_price, line_no, order_id
  on public.procurement_order_items
  for each row execute function public.procurement_line_price_echoes_to_header();

-- ---------------------------------------------------------------------------
-- 2. Nothing else writes the header price.
-- ---------------------------------------------------------------------------
create or replace function public.procurement_header_price_is_an_echo()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_line_price numeric(10,2);
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

comment on function public.procurement_header_price_is_an_echo() is
  'Refuses a direct write to procurement_orders.final_price that would disagree with the order line (ADR 0119 Q2). Allowed when no line states a price — an order can be created before it is written down as a line.';

revoke all on function public.procurement_header_price_is_an_echo() from public;
revoke all on function public.procurement_header_price_is_an_echo() from anon, authenticated;

drop trigger if exists trg_procurement_header_price_is_an_echo
  on public.procurement_orders;
create trigger trg_procurement_header_price_is_an_echo
  before update of final_price
  on public.procurement_orders
  for each row execute function public.procurement_header_price_is_an_echo();

-- ---------------------------------------------------------------------------
-- 3. The column comment, now that something makes it true.
-- ---------------------------------------------------------------------------
comment on column public.procurement_orders.final_price is
  'An ECHO of the agreed price on this order''s lowest-numbered line, maintained by trg_procurement_line_price_echoes_to_header and defended by trg_procurement_header_price_is_an_echo (ADR 0119 Q2, decided 2026-09-05). It names no unit; the line''s price_uom/price_pack_size do. A direct write that disagrees with the line is refused with 23514 — write the line instead. Postgres cannot express this as GENERATED ALWAYS: a generation expression may not read another table, and this column is NOT NULL on a row inserted before its line exists.';

-- ---------------------------------------------------------------------------
-- 4. In-file assertions. A migration that reports success without having done
--    what it claims is the same fault it was written to prevent.
-- ---------------------------------------------------------------------------
do $$
declare
  missing text;
begin
  select string_agg(n, ', ')
    into missing
    from unnest(array[
      'procurement_line_price_echoes_to_header',
      'procurement_header_price_is_an_echo'
    ]) n
   where not exists (
     select 1
       from pg_proc p
       join pg_namespace ns on ns.oid = p.pronamespace
      where ns.nspname = 'public'
        and p.proname = n
   );
  if missing is not null then
    raise exception 'Trigger function(s) % were not created, so nothing keeps the header and the line in step.', missing;
  end if;
end $$;

do $$
declare
  missing text;
begin
  select string_agg(t.n, ', ')
    into missing
    from (values
      ('trg_procurement_line_price_echoes_to_header', 'procurement_order_items'),
      ('trg_procurement_header_price_is_an_echo',     'procurement_orders')
    ) as t(n, rel)
   where not exists (
     select 1
       from pg_trigger tg
       join pg_class c on c.oid = tg.tgrelid
       join pg_namespace ns on ns.oid = c.relnamespace
      where ns.nspname = 'public'
        and c.relname = t.rel
        and tg.tgname = t.n
        and not tg.tgisinternal
   );
  if missing is not null then
    raise exception 'Trigger(s) % were not created. A function nothing fires is a comment.', missing;
  end if;
end $$;

-- Both functions must actually be armed against RLS, or the echo lands
-- nowhere on a tenant-scoped write and the two numbers drift in silence.
do $$
declare
  invoker text;
begin
  select string_agg(p.proname, ', ')
    into invoker
    from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public'
     and p.proname in (
       'procurement_line_price_echoes_to_header',
       'procurement_header_price_is_an_echo')
     and p.prosecdef = false;
  if invoker is not null then
    raise exception 'Function(s) % are SECURITY INVOKER; under RLS their UPDATE is filtered to zero rows and the header drifts without an error. See section 1.', invoker;
  end if;
end $$;

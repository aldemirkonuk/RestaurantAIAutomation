-- A house names its money, and a recorded price names its own — ADR 0117 Q25,
-- founder decision 2026-09-05: "correct three rows now, ask each house in
-- onboarding, but set a default based on location, edge case: there maybe
-- several diff currencies, so act accordingly to that".
--
-- ---------------------------------------------------------------------------
-- WHAT WAS WRONG, MEASURED
-- ---------------------------------------------------------------------------
-- Measured 2026-09-05 against production (Supabase project `Restaurant_Wine_Ops`
-- / exzueerziesmczwlhomd), read-only:
--
--   restaurants rows                              14
--   restaurants carrying currency = 'USD'         14   <- every one
--   of those, houses NOT in a dollar country       3   (two TR, one GB)
--   price_history rows                             0
--   price_history currency column                 absent
--   procurement_documents rows                     5
--   of those, rows whose currency is NOT 'USD'     2   <- both TRY, on a
--                                                         house whose own
--                                                         currency says USD
--
-- Nobody typed `USD` on any of the fourteen. `restaurants.currency` carries
-- `DEFAULT 'USD'::character varying` (`20260805000000:3576`) and the only insert
-- that creates a house — `AuthService.registerRestaurant`,
-- `apps/api-gateway/src/auth/auth.service.ts:762-780` — names no `currency` key
-- at all. The default IS the writer. That is
-- [[absence-reported-as-health]] in a column default, the same shape
-- `20260903170000_a_default_is_not_an_answer.sql` removed from
-- `providers.lead_time_days`, `providers.payment_terms` and
-- `restaurants.timezone`; `currency` was named in that file as deliberately NOT
-- touched, because it had not been decided. It has been now.
--
-- The last two rows of the measurement are the edge case the founder named,
-- already live: one house, USD on its own row, holding two TRY invoices. A house
-- does not have A currency in the sense of "the currency every number on its
-- screens is in". It has a REPORTING currency, and its paper arrives in whatever
-- the vendor billed.
--
-- ---------------------------------------------------------------------------
-- THE RULE THIS FILE MAKES ENFORCEABLE
-- ---------------------------------------------------------------------------
--   1. `restaurants.currency` is the house's REPORTING currency, and it is
--      stated by a person or it is NULL. No default, so an unanswered question
--      stops looking like an answer.
--   2. Every recorded price carries ITS OWN currency — the vendor's, off the
--      vendor's paper — never the house's by inheritance.
--   3. Nothing converts. A reader that would compare or sum figures in different
--      currencies refuses in words instead. There is no rate anywhere in this
--      system, and inventing one would be inventing the answer.
--
-- Rule 3 is not enforceable by a CHECK: a constraint cannot make a future SELECT
-- group. It is recorded in the column comments, where the first reader will find
-- it, exactly as `20260905072500_the_price_series_states_its_unit.sql` recorded
-- the group-by-unit rule for the same table.
--
-- ---------------------------------------------------------------------------
-- WHY `price_history.currency` IS NULLABLE AND `unit` IS NOT
-- ---------------------------------------------------------------------------
-- The sibling migration made `price_history.unit` NOT NULL with no default,
-- because a price whose unit nobody stated is uninterpretable and its writer can
-- always refuse. This column is deliberately different, and the difference is a
-- fact about the schema rather than a softer standard:
--
--   * The RECEIPT path can state a currency — the invoice header carries one
--     (`procurement_documents.currency`), and production proves it is sometimes
--     TRY.
--   * The AGREEMENT path CANNOT. `procurement_orders` and
--     `procurement_order_items` have no currency column at all, in production or
--     on this branch — `20260905073000_the_agreement_names_the_money_outside_
--     the_price.sql` says its three new amounts are "in the agreement's
--     currency" while no column anywhere states what that is.
--
-- So NOT NULL here would not make the agreement path state its currency. It
-- would make the agreement path write NOTHING — deleting a whole source from a
-- series to punish a gap in a different table, and leaving an empty table that
-- reads as "no prices" rather than as "the currency is not recorded". NULL, with
-- the reader forbidden from coercing it, keeps the observation and makes the gap
-- visible. It is reversible in one line the day the agreement line names its
-- currency, and that day is a founder question, not an assumption.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS FILE DOES NOT DO
-- ---------------------------------------------------------------------------
--   * **It writes no data.** Not one UPDATE. Three production rows are wrong and
--     they are corrected by `scripts/correct_restaurant_currency.py`, which runs
--     dry by default and writes only on `--apply --i-have-the-founders-word`. A
--     migration auto-applies on merge; an UPDATE of live tenant rows must not
--     ride a merge.
--   * **It does not clear the other eleven.** `20260903170000` cleared every
--     value equal to the default it dropped, on the argument that a default is
--     indistinguishable from an answer. That argument applies here too — ten US
--     houses carry a `USD` nobody can prove was chosen. It is not done here
--     because it erases ten houses' currency to make a point about provenance,
--     and the founder has not been asked. Filed as a question in ADR 0117.
--   * **It adds no currency column to the agreement line.** That table is being
--     changed by another builder on this branch in the same hours; a second
--     hand in it would be a merge conflict dressed as a decision.
--
-- ADDITIVE. One column added (nullable), one default dropped, two CHECKs, four
-- comments. No table created, no column dropped, no RLS change, no data written.
set local statement_timeout = '120s';

-- ---------------------------------------------------------------------------
-- 1. Prove what is there before changing what it means.
-- ---------------------------------------------------------------------------
do $$
declare
  strangers text;
begin
  -- A value that is not an ISO 4217 alpha-3 would be refused by the CHECK added
  -- below, and a migration that fails halfway through on live data is worse than
  -- one that says which row it cannot accept. `USD` and NULL are both fine.
  select string_agg(distinct quote_literal(currency), ', ')
    into strangers
    from public.restaurants
   where currency is not null
     and currency !~ '^[A-Z]{3}$';
  if strangers is not null then
    raise exception
      'restaurants holds currency value(s) % that are not ISO 4217 alpha-3. Decide what each one is and state it; this migration will not normalise a code it cannot read.',
      strangers;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. The house's reporting currency: stated, or nothing.
-- ---------------------------------------------------------------------------
alter table public.restaurants
  alter column currency drop default;

alter table public.restaurants
  drop constraint if exists restaurants_currency_check,
  add  constraint restaurants_currency_check
       check (currency is null or currency ~ '^[A-Z]{3}$');

comment on column public.restaurants.currency is
  'The house''s REPORTING currency, ISO 4217 alpha-3 — the money its own totals are stated in. Stated by a person at sign-up (the currency step defaults it from the address''s country and the manager confirms or changes it) or NULL. NO DEFAULT since 2026-09-05: it was `USD` on all fourteen houses including two in Turkiye and one in the United Kingdom, and a default is indistinguishable from an answer (ADR 0117 Q25). NULL means the question has not been answered — every reader must print "currency not recorded" rather than a dollar sign. It is NOT the currency of any recorded price: a house''s paper arrives in whatever its vendors bill, and one house in production already holds TRY invoices against a USD row.';

-- ---------------------------------------------------------------------------
-- 3. A recorded price names its own money.
-- ---------------------------------------------------------------------------
alter table public.price_history
  add column if not exists currency character varying(3);

alter table public.price_history
  drop constraint if exists price_history_currency_check,
  add  constraint price_history_currency_check
       check (currency is null or currency ~ '^[A-Z]{3}$');

comment on column public.price_history.currency is
  'The currency `price` is stated in, ISO 4217 alpha-3 — the VENDOR''S, taken from the paper that carried the figure, never the house''s by inheritance (ADR 0117 Q25, decided 2026-09-05). No default: a default is what made `restaurants.currency` say USD about a house in Fethiye. NULL means NOT RECORDED and nothing may read it as the house''s currency, as USD, or as "same as the row beside it" — the writer logs a sentence naming what would have admitted the code. EVERY comparison over this table must group by this column as well as by `unit`: summing a TRY figure with a USD one is not a large number, it is a meaningless one, and there is no exchange rate anywhere in this system to make it otherwise. A reader that finds two currencies in one group says so and refuses; it does not convert.';

comment on column public.price_history.price is
  'The observed price, stated in `unit`, denominated in `currency`. Never per bottle by convention and never in dollars by convention — read both columns first (ADR 0119 Q4, ADR 0117 Q25).';

-- ---------------------------------------------------------------------------
-- 4. In-file assertions.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name   = 'restaurants'
       and column_name  = 'currency'
       and column_default is not null
  ) then
    raise exception 'restaurants.currency still has a default. With one in place an unanswered question still produces a confident USD, which is the whole defect (ADR 0117 Q25).';
  end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name   = 'price_history'
       and column_name  = 'currency'
       and data_type    = 'character varying'
  ) then
    raise exception 'price_history.currency was not added. Without it every row in the price series asserts one unnamed currency, which is only true while every vendor bills in the same one.';
  end if;

  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name   = 'price_history'
       and column_name  = 'currency'
       and column_default is not null
  ) then
    raise exception 'price_history.currency has a default. A defaulted currency is a claim about a vendor nobody made.';
  end if;

  if not exists (
    select 1
      from pg_constraint pc
      join pg_class pcl on pcl.oid = pc.conrelid
      join pg_namespace pn on pn.oid = pcl.relnamespace
     where pn.nspname = 'public'
       and pcl.relname = 'restaurants'
       and pc.conname = 'restaurants_currency_check'
  ) then
    raise exception 'restaurants_currency_check was not created. A three-character column with no vocabulary accepts ''usd'', ''US$'' and ''TL'' as three different currencies.';
  end if;

  if not exists (
    select 1
      from pg_constraint pc
      join pg_class pcl on pcl.oid = pc.conrelid
      join pg_namespace pn on pn.oid = pcl.relnamespace
     where pn.nspname = 'public'
       and pcl.relname = 'price_history'
       and pc.conname = 'price_history_currency_check'
  ) then
    raise exception 'price_history_currency_check was not created.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Say out loud what is still wrong after this file runs.
-- ---------------------------------------------------------------------------
-- The three houses are still wrong here. Dropping the default does not correct
-- a row that already carries the default's value, and this file deliberately
-- writes nothing. The NOTICE is so the apply log names the remaining work
-- instead of leaving a green migration to imply the job is done.
do $$
declare
  still_default bigint;
begin
  select count(*) into still_default
    from public.restaurants
   where currency = 'USD';
  raise notice
    'Shape fixed; data NOT touched. % house(s) still carry USD, and at least three of them are wrong (two in Turkiye, one in the United Kingdom). Correct them with: python3 scripts/correct_restaurant_currency.py  (dry run first; it writes only with --apply --i-have-the-founders-word).',
    still_default;
end $$;

-- A vendor states its usual currency; the ORDER carries the currency it was
-- placed in, and says where that came from.
--
-- THE FOUNDER, 2026-09-06, batch 65, verbatim:
--   "maybe Every vendor and their profile will show their default currency, but
--    we won't use that as the invoice... definitely invoice receipt. However, we
--    will use the currency from where we order it. We will show the user the
--    currency the vendor always uses, and they have the ability to change it or
--    not in the orders page. And after that, we will have time To make sure that
--    the invoice is good with the order we had. and we... or the user or the
--    manager are able to change the invoice if needed. Makes sense?"
--
-- ---------------------------------------------------------------------------
-- TWO COLUMNS ON TWO TABLES, AND THE DISTINCTION BETWEEN THEM IS THE DECISION
-- ---------------------------------------------------------------------------
-- `providers.usual_currency` is a STATEMENT ABOUT A VENDOR. It is shown on the
-- vendor's profile and offered as the starting value on an order sheet. It
-- files nothing. The founder said so twice in one sentence -- "we won't use that
-- as the invoice... definitely invoice receipt" -- and the reason is the defect
-- this whole line of work exists to end: `restaurants.currency DEFAULT 'USD'`
-- put a currency nobody chose underneath fourteen houses' money, and a
-- vendor-level default wired straight into invoice filing would be the same
-- mistake one table over, with a vendor's name on it instead of a house's.
--
-- `procurement_orders.currency` is a RECORD OF WHAT A PERSON PLACED. It is
-- written once, when the order is composed, from whatever was in the field at
-- that moment. `currency_source` says whether that was the vendor's stated
-- usual currency or something the person typed. Those two are different facts
-- and a column that held only the code could not tell them apart -- which is
-- exactly how a suggestion becomes indistinguishable from a decision after six
-- months.
--
-- ---------------------------------------------------------------------------
-- WHY NEITHER COLUMN HAS A DEFAULT, AND WHY NOTHING IS BACKFILLED
-- ---------------------------------------------------------------------------
-- Same rule as `20260906140000_a_carrying_cost_is_typed_by_a_person.sql` and
-- `20260905200000`: a defaulted currency is a claim about somebody's money that
-- nobody made. A vendor nobody has asked has NOT stated a usual currency, and
-- the profile says so in words. An order placed before this column existed did
-- not name a currency, and stamping the house's onto it now would manufacture a
-- history. The assertions at the bottom of this file MEASURE that no row was
-- written rather than asserting it in a comment.
--
-- ---------------------------------------------------------------------------
-- WHO TYPED THE VENDOR'S CURRENCY TRAVELS WITH IT
-- ---------------------------------------------------------------------------
-- The value, the person and the moment are ONE fact enforced by a CHECK, in the
-- shape `20260906140000` used for the carrying cost. Three columns that can
-- disagree produce a currency by nobody, which reads on the page exactly like a
-- currency somebody chose.
--
-- The order's currency does NOT carry an author. It already has one: the order
-- row names who created it and when, and `currency_source` says whether the
-- person accepted the offer or typed over it. A second author column here would
-- be a copy that can drift from the first.
--
-- ADDITIVE. Five columns across two tables, four CHECKs, six comments. No table
-- created, no column altered or dropped, no RLS change, no data written.
SET local statement_timeout = '120s';

-- ---------------------------------------------------------------------------
-- 1. The vendor states its usual currency.
-- ---------------------------------------------------------------------------

ALTER TABLE public.providers
  -- `character varying(3)`, matching the other seven `currency` columns in this
  -- schema rather than inventing an eighth width.
  ADD COLUMN IF NOT EXISTS usual_currency CHARACTER VARYING(3),
  -- NEVER auth.users: the two tables are DISJOINT in this database and share
  -- zero ids, so an actor FK to auth.users 23503s on every write and a fresh CI
  -- database has no rows to catch it with. ON DELETE RESTRICT, not SET NULL --
  -- a typed fact whose author became NULL is a fact by nobody.
  ADD COLUMN IF NOT EXISTS usual_currency_set_by UUID
    REFERENCES public.users(user_id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS usual_currency_set_at TIMESTAMPTZ;

COMMENT ON COLUMN public.providers.usual_currency IS
  'The ISO 4217 code this vendor usually invoices in, TYPED BY A PERSON on the vendor profile. Nullable and normally null; no default and no derivation, ever (founder, 2026-09-06 batch 65). IT NEVER FILES AN INVOICE: it is offered as the starting value on the order sheet and printed on the profile, and nothing else reads it. An invoice takes its own stated currency, then the currency of the order it is matched to, then the house''s.';
COMMENT ON COLUMN public.providers.usual_currency_set_by IS
  'The person who typed it, from public.users(user_id) - never auth.users, which is disjoint from it. RESTRICT rather than SET NULL: a stated fact by nobody is what this column exists to prevent.';
COMMENT ON COLUMN public.providers.usual_currency_set_at IS
  'When it was typed. One fact with the value and the author, enforced by providers_usual_currency_names_its_author.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'providers_usual_currency_is_iso_4217'
       AND conrelid = to_regclass('public.providers')
  ) THEN
    -- Without this the column takes 'usd', 'US$' and 'TL' as three more
    -- currencies, and the order sheet -- and through it price_history and
    -- vendor_price_observations -- would inherit all three. The same shape
    -- `procurement_order_items_currency_check` (20260905200000) enforces.
    ALTER TABLE public.providers
      ADD CONSTRAINT providers_usual_currency_is_iso_4217
      CHECK (usual_currency IS NULL OR usual_currency ~ '^[A-Z]{3}$');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'providers_usual_currency_names_its_author'
       AND conrelid = to_regclass('public.providers')
  ) THEN
    -- The value, the person and the moment are ONE fact. Any two without the
    -- third is a record that looks complete and is not.
    ALTER TABLE public.providers
      ADD CONSTRAINT providers_usual_currency_names_its_author
      CHECK (
        (usual_currency IS NULL
          AND usual_currency_set_by IS NULL
          AND usual_currency_set_at IS NULL)
        OR
        (usual_currency IS NOT NULL
          AND usual_currency_set_by IS NOT NULL
          AND usual_currency_set_at IS NOT NULL)
      );
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 2. The order carries the currency it was placed in, and where it came from.
-- ---------------------------------------------------------------------------
--
-- `procurement_order_items.currency` (20260905200000) already denominates the
-- seven money columns on the AGREEMENT LINE. This pair is on the ORDER HEADER,
-- which is what an invoice is matched to: `procurement_document_links` joins a
-- document to an `order_id`, never to a line, so the invoice-versus-order
-- currency check the founder asked for has nowhere to read from without it.
-- The two are written from ONE resolved value in ProcurementService.createOrder
-- so they cannot disagree; the header is the one a document is compared against.

ALTER TABLE public.procurement_orders
  ADD COLUMN IF NOT EXISTS currency CHARACTER VARYING(3),
  -- 'vendor_usual' -- the person left the offered value alone, and the offer was
  --                  this vendor's own stated usual currency.
  -- 'typed'        -- the person put this code in the field themselves. Covers
  --                  both "changed it" and "the vendor had stated none, so they
  --                  chose one", because in both the code is the person's.
  -- There is deliberately no third value for "the house's, assumed": nothing
  -- assumes here. A vendor that has stated no usual currency leaves the field
  -- EMPTY and the sheet says so.
  ADD COLUMN IF NOT EXISTS currency_source CHARACTER VARYING(20);

COMMENT ON COLUMN public.procurement_orders.currency IS
  'The ISO 4217 code this order was PLACED in, recorded once when it was composed (founder, 2026-09-06 batch 65: "we will use the currency from where we order it"). Nullable with no default: an order composed before this column existed named no currency, and an order whose vendor stated none and whose desk chose none has not named one either. An invoice matched to this order is filed under this code when the invoice itself states none, and is HELD when it states a different one.';
COMMENT ON COLUMN public.procurement_orders.currency_source IS
  'Where the code in currency came from: vendor_usual (the person accepted the vendor''s own stated usual currency) or typed (the person put it there). Never a third value for "assumed" - nothing here assumes. "We suggested TRY and they left it" and "they typed TRY" are different facts and a column holding only the code cannot tell them apart.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'procurement_orders_currency_is_iso_4217'
       AND conrelid = to_regclass('public.procurement_orders')
  ) THEN
    ALTER TABLE public.procurement_orders
      ADD CONSTRAINT procurement_orders_currency_is_iso_4217
      CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'procurement_orders_currency_states_its_source'
       AND conrelid = to_regclass('public.procurement_orders')
  ) THEN
    -- A currency with no source, or a source with no currency, is half a fact.
    -- The first reads on the reconciliation screen as a code somebody chose
    -- when nobody may have; the second names a provenance for nothing.
    --
    -- `currency_source IS NOT NULL AND ... IN (...)` rather than the `IN` alone,
    -- and that is not belt-and-braces. MEASURED on PGlite before this line
    -- existed: `currency = 'EUR'` with a NULL source was ADMITTED, because
    -- `NULL IN ('vendor_usual','typed')` is NULL, `FALSE OR (TRUE AND NULL)` is
    -- NULL, and a CHECK that evaluates to NULL PASSES. The constraint read
    -- correctly in English and enforced nothing in exactly the case it was
    -- written for -- the [[absence-reported-as-health]] shape inside a guard.
    ALTER TABLE public.procurement_orders
      ADD CONSTRAINT procurement_orders_currency_states_its_source
      CHECK (
        (currency IS NULL AND currency_source IS NULL)
        OR
        (currency IS NOT NULL
          AND currency_source IS NOT NULL
          AND currency_source IN ('vendor_usual', 'typed'))
      );
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 3. Assert the outcome rather than reporting success.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  missing TEXT;
  defaulted BIGINT;
  written BIGINT;
  probe_provider UUID;
  probe_person UUID;
  admitted BOOLEAN;
BEGIN
  SELECT string_agg(c.want, ', ') INTO missing
    FROM (VALUES
      ('providers', 'usual_currency'),
      ('providers', 'usual_currency_set_by'),
      ('providers', 'usual_currency_set_at'),
      ('procurement_orders', 'currency'),
      ('procurement_orders', 'currency_source')
    ) AS v(tbl, col)
    CROSS JOIN LATERAL (SELECT v.tbl || '.' || v.col AS want) c
   WHERE NOT EXISTS (
     SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = v.tbl
        AND column_name = v.col
   );
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'these columns were not added: %', missing;
  END IF;

  -- THE LOAD-BEARING ASSERTION. A default on any of the five would put a
  -- currency nobody chose under somebody's money, which is the whole defect.
  SELECT count(*) INTO defaulted
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND ((table_name = 'providers'
            AND column_name LIKE 'usual_currency%')
       OR (table_name = 'procurement_orders'
            AND column_name IN ('currency', 'currency_source')))
     AND column_default IS NOT NULL;
  IF defaulted > 0 THEN
    RAISE EXCEPTION
      '% of the new currency columns carry a DEFAULT; a default here is the currency nobody chose that this migration exists to refuse',
      defaulted;
  END IF;

  -- The actor FK points INSIDE public. auth.users and public.users are disjoint
  -- and a fresh CI database has no rows to prove it with, so this is a catalogue
  -- assertion rather than a runtime one on purpose.
  IF EXISTS (
    SELECT 1
      FROM pg_constraint con
      JOIN pg_class ref ON ref.oid = con.confrelid
      JOIN pg_namespace ns ON ns.oid = ref.relnamespace
     WHERE con.conrelid = to_regclass('public.providers')
       AND con.contype = 'f'
       AND ns.nspname <> 'public'
       AND con.conname LIKE '%usual_currency%'
  ) THEN
    RAISE EXCEPTION 'the vendor usual-currency author FK points outside public';
  END IF;

  -- NOTHING WAS BACKFILLED. Measured, not asserted.
  SELECT count(*) INTO written FROM public.providers
   WHERE usual_currency IS NOT NULL;
  IF written <> 0 THEN
    RAISE EXCEPTION
      'this migration stated a usual currency for % vendor(s); it must state none - a backfilled currency is a default with a different name',
      written;
  END IF;
  SELECT count(*) INTO written FROM public.procurement_orders
   WHERE currency IS NOT NULL OR currency_source IS NOT NULL;
  IF written <> 0 THEN
    RAISE EXCEPTION
      'this migration wrote a currency onto % existing order(s); an order placed before this column existed named no currency',
      written;
  END IF;

  SELECT id INTO probe_provider FROM public.providers LIMIT 1;
  SELECT user_id INTO probe_person FROM public.users LIMIT 1;

  IF probe_provider IS NOT NULL AND probe_person IS NOT NULL THEN
    -- A usual currency with nobody's name on it.
    BEGIN
      UPDATE public.providers SET usual_currency = 'TRY'
       WHERE id = probe_provider;
      admitted := TRUE;
    EXCEPTION WHEN check_violation THEN
      admitted := FALSE;
    END;
    IF admitted THEN
      UPDATE public.providers
         SET usual_currency = NULL, usual_currency_set_by = NULL,
             usual_currency_set_at = NULL
       WHERE id = probe_provider;
      RAISE EXCEPTION 'a vendor currency was stated with nobody''s name on it';
    END IF;

    -- The shape. 'TL' is the single commonest way a Turkish desk writes lira
    -- and it is not an ISO code; admitting it would put a fourth spelling of
    -- TRY into the order sheet.
    BEGIN
      UPDATE public.providers
         SET usual_currency = 'TL', usual_currency_set_by = probe_person,
             usual_currency_set_at = NOW()
       WHERE id = probe_provider;
      admitted := TRUE;
    EXCEPTION WHEN check_violation THEN
      admitted := FALSE;
    END;
    IF admitted THEN
      UPDATE public.providers
         SET usual_currency = NULL, usual_currency_set_by = NULL,
             usual_currency_set_at = NULL
       WHERE id = probe_provider;
      RAISE EXCEPTION 'a vendor currency of ''TL'' was admitted; the ISO shape CHECK is not doing its job';
    END IF;
  END IF;

  -- The order's pair, proven the same way where there is a row to prove it on.
  IF EXISTS (SELECT 1 FROM public.procurement_orders) THEN
    BEGIN
      UPDATE public.procurement_orders SET currency = 'EUR'
       WHERE id = (SELECT id FROM public.procurement_orders LIMIT 1);
      admitted := TRUE;
    EXCEPTION WHEN check_violation THEN
      admitted := FALSE;
    END;
    IF admitted THEN
      UPDATE public.procurement_orders
         SET currency = NULL, currency_source = NULL
       WHERE id = (SELECT id FROM public.procurement_orders LIMIT 1);
      RAISE EXCEPTION 'an order currency was admitted with no source; the pair CHECK is not doing its job';
    END IF;

    BEGIN
      UPDATE public.procurement_orders
         SET currency = 'EUR', currency_source = 'house_assumed'
       WHERE id = (SELECT id FROM public.procurement_orders LIMIT 1);
      admitted := TRUE;
    EXCEPTION WHEN check_violation THEN
      admitted := FALSE;
    END;
    IF admitted THEN
      UPDATE public.procurement_orders
         SET currency = NULL, currency_source = NULL
       WHERE id = (SELECT id FROM public.procurement_orders LIMIT 1);
      RAISE EXCEPTION 'an order currency_source of ''house_assumed'' was admitted; nothing here may assume';
    END IF;
  END IF;
END
$$;

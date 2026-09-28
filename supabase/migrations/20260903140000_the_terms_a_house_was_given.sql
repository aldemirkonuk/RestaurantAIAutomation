-- The terms a house was given, and the ceiling it set for itself.
--
-- Two tables, one migration, because they answer the same question from two
-- sides: what a VENDOR will do (cutoff, delivery days, minimum, lead time,
-- payment terms) and what the HOUSE will let a person commit to without a
-- second signature (approval thresholds).
--
-- ---------------------------------------------------------------------------
-- WHAT WAS ALREADY THERE, MEASURED BEFORE ANY OF THIS WAS WRITTEN
-- ---------------------------------------------------------------------------
-- `public.providers` (this file's baseline, 20260805000000:4854-4901) already
-- carries THREE of the five fields:
--
--   minimum_order   integer                              -- :4863, no default
--   lead_time_days  integer DEFAULT 7                    -- :4864, DEFAULTED
--   payment_terms   text    DEFAULT 'Net 30'             -- :4897, DEFAULTED
--
-- and `public.restaurant_providers` (:5148-5161) carries two per-tenant
-- overrides — `custom_lead_time_days`, `custom_minimum_order`, both nullable
-- and both undefaulted.
--
-- The two DEFAULTED columns are the reason this table exists rather than three
-- more columns on `providers`. `lead_time_days DEFAULT 7` means every provider
-- row in the database asserts a seven-day lead time whether a human ever said
-- so or not, and `payment_terms DEFAULT 'Net 30'` asserts Net 30 for every
-- vendor on earth. Neither column can distinguish "the house was told seven
-- days" from "nobody has ever been asked". That is [[absence-reported-as-health]]
-- written into a column default: the absence of an answer is stored as an
-- answer, and every reader downstream — the reorder maths, the delivery-date
-- estimate, the email template that prints "Payment Terms: Net 30" at
-- `communications/email-templates/payment-due.template.ts:108` — reads it as
-- one.
--
-- This migration does NOT alter those columns. Dropping a default from a
-- production column with live readers is its own decision with its own blast
-- radius (`providers.service.ts:1374,1382` map both onto the API today), and
-- the register above it now says which of the two it is looking at. What this
-- migration adds is the ONLY place in the schema where a term can be recorded
-- with a person's name and a date attached, so "stated" becomes provable
-- instead of assumed.
--
-- ---------------------------------------------------------------------------
-- WHAT DOES **NOT** EXIST ANYWHERE, MEASURED
-- ---------------------------------------------------------------------------
--   * an order cutoff, of any shape:
--       grep -rn "cutoff\|cut_off" supabase/migrations/  ->  three hits, all
--       inside `cleanup_old_*`'s local variable `v_cutoff_date`, none a column.
--   * delivery weekdays. `apps/web/src/components/providers/AddProviderModal.tsx:820`
--     collects them as checkboxes, and `pages/Providers.tsx:458` sends them as
--     `statesOrRegionsServed`, which `services/api/providers.ts:162-163` maps to
--     `regionsCovered` and the gateway writes into `providers.regions_covered`
--     (`providers.service.ts:199`) — the GEOGRAPHY column. The sibling field
--     `deliverySchedule` (`Providers.tsx:458`) is declared on the web DTO
--     (`services/api/providers.ts:88`) and never reaches
--     `buildProviderPayload`'s output at all (`:140-177`), so it is dropped on
--     the floor. Today, ticking "Monday, Wednesday, Friday" in the add-provider
--     dialog has exactly one persisted effect: three weekday names land in the
--     list of regions the vendor covers.
--
-- Both are fixed here by giving the fields a home that says what they are.
--
-- ---------------------------------------------------------------------------
-- A ROW IS A STATEMENT, NOT A SHAPE
-- ---------------------------------------------------------------------------
-- The same rule `restaurant_cellar_registers` (20260903092000) settled: a row
-- exists ONLY where a person said something. Nothing pre-creates a row per
-- vendor, and every term column is nullable, because five fields are five
-- independent statements — a house can know a vendor's cutoff and have no idea
-- what their minimum is. NULL means "nobody has said". It never means zero, and
-- it is never a stand-in for an inference: the inference is computed at read
-- time from `procurement_orders` and is never written back here, so a guess can
-- never harden into a fact by sitting in a table long enough.
--
-- `delivery_weekdays` is the one field where the empty array is meaningful and
-- different from NULL: `'{}'` is the house saying "they deliver on no fixed
-- day, we call and they come", NULL is "nobody has said". Both render
-- differently and the CHECK below permits both.
--
-- Idempotent and safe to re-run. No explicit BEGIN/COMMIT: the Supabase CLI
-- wraps each migration file in a transaction.

-- ---------------------------------------------------------------------------
-- 1. The terms the house was given
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.restaurant_vendor_terms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Whose books these terms belong to. The same vendor gives two houses two
  -- different cutoffs, so the terms hang off the pair, never off the provider.
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  provider_id   UUID NOT NULL REFERENCES public.providers(id)   ON DELETE CASCADE,

  -- 0 = Sunday .. 6 = Saturday, matching Postgres `extract(dow)` and JS
  -- `Date#getDay()` so no layer has to remember an offset. NULL = nobody has
  -- said; '{}' = stated, and the answer is "no fixed days".
  delivery_weekdays SMALLINT[],

  -- The clock time after which an order no longer makes the next delivery.
  -- Stored WITHOUT a zone: a cutoff is a wall-clock fact about the vendor's
  -- own day, and binding it to a zone would make it move when the house does.
  order_cutoff_time TIME,

  -- How many days BEFORE the delivery day the cutoff falls. 0 = same day,
  -- 1 = the day before (Choco's default reading of a cutoff:
  -- https://help.choco.com/en/articles/6853427-manage-your-order-preferences —
  -- "the time after which your customers will not be able to place an order to
  -- you for the following day"). Separate from the time because "14:00" alone
  -- cannot say which day it closes.
  order_cutoff_offset_days SMALLINT,

  -- What they will not go below, in the house's own currency. Undefaulted and
  -- nullable: a vendor with no minimum and a vendor nobody has asked are
  -- different answers, and 0 is the first, not the second.
  minimum_order_amount NUMERIC(12,2),

  -- Days from order to delivery, as STATED. The inference over real receipts is
  -- computed at read time and is never written here.
  lead_time_days SMALLINT,

  -- Free text on purpose: "Net 30", "2% 10 net 30", "prepaid", "cash on
  -- delivery" and "30 gün vadeli" are all real answers, and an enum would force
  -- the fourth into the wrong one. The orchestrator's extractor already treats
  -- it as free text (`common/orchestrator/commercial-terms.ts:33`).
  payment_terms TEXT,

  -- Anything the five fields cannot hold — "closes the first week of August",
  -- "Ahmet answers, the office does not".
  notes TEXT,

  -- WHO said so. `public.users.user_id`, never an `auth.users` id: the two
  -- tables are DISJOINT in this database (zero shared ids), the JWT carries the
  -- public one, and a wrong id here would dangle silently. The FK makes that
  -- impossible rather than merely discouraged — unlike `system_audit_log`,
  -- which carries no FK on `actor_id` at all (baseline:13618).
  stated_by UUID REFERENCES public.users(user_id) ON DELETE SET NULL,
  stated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Weekdays are weekdays. An array with a 9 in it would render as a day that
  -- does not exist rather than failing.
  --
  -- Written with the containment operator rather than `NOT EXISTS (SELECT …
  -- FROM unnest(…))`, which is the obvious way to say it and which Postgres
  -- refuses outright: `ERROR: cannot use subquery in check constraint`.
  -- Measured, not assumed — the subquery form was written first and rejected by
  -- a real server on 2026-09-03. `<@` needs no subquery, and `'{}' <@ anything`
  -- is true, so the empty array (the house saying "no fixed days") still passes.
  CONSTRAINT restaurant_vendor_terms_weekdays_are_days CHECK (
    delivery_weekdays IS NULL
    OR (
      array_ndims(delivery_weekdays) = 1
      AND delivery_weekdays <@ ARRAY[0, 1, 2, 3, 4, 5, 6]::SMALLINT[]
    )
  ),
  CONSTRAINT restaurant_vendor_terms_cutoff_offset_sane CHECK (
    order_cutoff_offset_days IS NULL
    OR (order_cutoff_offset_days >= 0 AND order_cutoff_offset_days <= 14)
  ),
  CONSTRAINT restaurant_vendor_terms_minimum_not_negative CHECK (
    minimum_order_amount IS NULL OR minimum_order_amount >= 0
  ),
  CONSTRAINT restaurant_vendor_terms_lead_time_sane CHECK (
    lead_time_days IS NULL OR (lead_time_days >= 0 AND lead_time_days <= 365)
  )
);

-- One statement per vendor per house. NOT partial: the service upserts on this
-- constraint, so PostgREST binds `ON CONFLICT` to it.
CREATE UNIQUE INDEX IF NOT EXISTS uq_restaurant_vendor_terms_pair
  ON public.restaurant_vendor_terms (restaurant_id, provider_id);

-- The register's only read: every stated term this house holds.
CREATE INDEX IF NOT EXISTS idx_restaurant_vendor_terms_restaurant
  ON public.restaurant_vendor_terms (restaurant_id, updated_at DESC);

DROP TRIGGER IF EXISTS restaurant_vendor_terms_updated_at
  ON public.restaurant_vendor_terms;
CREATE TRIGGER restaurant_vendor_terms_updated_at
  BEFORE UPDATE ON public.restaurant_vendor_terms
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------------------
-- 2. The ceiling the house set for itself
-- ---------------------------------------------------------------------------
--
-- Modelled as ROWS, one per rule, rather than columns on a settings record, for
-- one reason: every row has to carry its own `set_by` and its own `updated_at`.
-- A single row with five columns can only say when the LAST of the five was
-- touched, and "who set the ceiling" is the question the register exists to
-- answer.
--
-- The three rules are the ones the field converged on. Restaurant365 calls the
-- amount one a "Workflow threshold" and routes anything above it to an approval
-- hierarchy (https://docs.restaurant365.com/docs/approvals-in-workflows);
-- Ottimate lists five policy dimensions — "the number of people needed, certain
-- amount thresholds, vendor-based approvals, role-based approvals, and
-- account-based approvals"
-- (https://ottimate.com/feature/workflows-and-approvals/). This build takes the
-- amount and the role, and leaves the per-vendor and per-account dimensions
-- unbuilt rather than half-built.
--
-- NO SEEDED DEFAULTS. A house with no rows here has NOT chosen "unlimited"; it
-- has chosen nothing, and today nothing in the gateway enforces any of it
-- anyway (`procurement.service.ts:1438 approveOrder` takes a userId and never
-- looks at a role or an amount). Writing a row per restaurant at migration time
-- would manufacture a policy nobody set and then report it as the house's.

CREATE TABLE IF NOT EXISTS public.restaurant_approval_thresholds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,

  -- Closed set, on purpose. An open `rule` column invites a fourth rule that
  -- no code reads — the dead-setting shape /settings spent two passes removing.
  rule TEXT NOT NULL CHECK (rule IN ('manager_ceiling', 'new_vendor', 'price_jump')),

  -- Whether the house wants this rule at all. A disabled rule keeps its number,
  -- so switching it back on does not lose the figure somebody chose.
  enabled BOOLEAN NOT NULL DEFAULT TRUE,

  -- `manager_ceiling` only: the money above which a manager may not seal alone.
  amount_limit NUMERIC(12,2),

  -- `price_jump` only: how far above the last price paid before a second
  -- signature is wanted, in percent.
  percent_limit NUMERIC(6,2),

  -- Who has to sign when the rule fires. 'owner' is the only escalation this
  -- database can express: production has exactly three roles and no `staff`
  -- role rows at all, so an approval chain deeper than one step could not be
  -- exercised by anyone today.
  required_role TEXT NOT NULL CHECK (required_role IN ('owner', 'manager')),

  set_by UUID REFERENCES public.users(user_id) ON DELETE SET NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT restaurant_approval_thresholds_amount_not_negative CHECK (
    amount_limit IS NULL OR amount_limit >= 0
  ),
  CONSTRAINT restaurant_approval_thresholds_percent_sane CHECK (
    percent_limit IS NULL OR (percent_limit >= 0 AND percent_limit <= 1000)
  ),
  -- The rule has to carry the number it is about. A `manager_ceiling` with no
  -- amount is a rule that cannot fire, rendered as if it could.
  CONSTRAINT restaurant_approval_thresholds_rule_carries_its_number CHECK (
    (rule <> 'manager_ceiling' OR amount_limit IS NOT NULL)
    AND (rule <> 'price_jump' OR percent_limit IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_restaurant_approval_thresholds_rule
  ON public.restaurant_approval_thresholds (restaurant_id, rule);

DROP TRIGGER IF EXISTS restaurant_approval_thresholds_updated_at
  ON public.restaurant_approval_thresholds;
CREATE TRIGGER restaurant_approval_thresholds_updated_at
  BEFORE UPDATE ON public.restaurant_approval_thresholds
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------------------
-- 3. Lock both down in the SAME migration that creates them (OD-72 / OD-73).
-- ---------------------------------------------------------------------------

ALTER TABLE public.restaurant_vendor_terms ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS restaurant_vendor_terms_service_role
  ON public.restaurant_vendor_terms;
CREATE POLICY restaurant_vendor_terms_service_role
  ON public.restaurant_vendor_terms
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.restaurant_vendor_terms FROM anon, authenticated;

ALTER TABLE public.restaurant_approval_thresholds ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS restaurant_approval_thresholds_service_role
  ON public.restaurant_approval_thresholds;
CREATE POLICY restaurant_approval_thresholds_service_role
  ON public.restaurant_approval_thresholds
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.restaurant_approval_thresholds FROM anon, authenticated;

COMMENT ON TABLE public.restaurant_vendor_terms IS
  'Vendor terms a person STATED for one house: delivery weekdays, order cutoff (time + how many days before delivery), minimum order, lead time, payment terms. A row exists only where somebody said something; every column is independently nullable and NULL means "nobody has said", never zero. Inference over procurement_orders is computed at read time and is NEVER written here. RLS on, service_role only, anon/authenticated revoked.';

COMMENT ON COLUMN public.restaurant_vendor_terms.delivery_weekdays IS
  '0=Sunday .. 6=Saturday (extract(dow) / JS getDay()). NULL = nobody has said. Empty array = stated, and the answer is "no fixed delivery days".';

COMMENT ON COLUMN public.restaurant_vendor_terms.stated_by IS
  'public.users.user_id of the person who stated these terms. NEVER an auth.users id — the two tables are disjoint in this database and the FK here makes the mistake impossible rather than merely discouraged.';

COMMENT ON TABLE public.restaurant_approval_thresholds IS
  'Who must approve an order above what amount, one row per rule so each carries its own set_by and updated_at. No rows are seeded: a house with none has set no policy, which is different from having set "unlimited". Nothing in the gateway enforces these yet — procurement.service.ts approveOrder checks neither role nor amount — and the settings register says so on its face.';

-- ---------------------------------------------------------------------------
-- 4. Assert the outcome rather than reporting success.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  t           text;
  c           text;
  absent_cols text;
  required    jsonb := jsonb_build_object(
    'restaurant_vendor_terms', jsonb_build_array(
      'id', 'restaurant_id', 'provider_id', 'delivery_weekdays',
      'order_cutoff_time', 'order_cutoff_offset_days', 'minimum_order_amount',
      'lead_time_days', 'payment_terms', 'notes', 'stated_by', 'stated_at',
      'created_at', 'updated_at'
    ),
    'restaurant_approval_thresholds', jsonb_build_array(
      'id', 'restaurant_id', 'rule', 'enabled', 'amount_limit',
      'percent_limit', 'required_role', 'set_by', 'created_at', 'updated_at'
    )
  );
BEGIN
  FOR t IN SELECT jsonb_object_keys(required) LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE EXCEPTION '% was not created', t;
    END IF;

    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass('public.' || t)) THEN
      RAISE EXCEPTION '% has RLS off', t;
    END IF;

    IF has_table_privilege('anon', 'public.' || t, 'SELECT')
       OR has_table_privilege('anon', 'public.' || t, 'INSERT')
       OR has_table_privilege('anon', 'public.' || t, 'UPDATE')
       OR has_table_privilege('anon', 'public.' || t, 'DELETE')
       OR has_table_privilege('authenticated', 'public.' || t, 'SELECT')
       OR has_table_privilege('authenticated', 'public.' || t, 'INSERT')
       OR has_table_privilege('authenticated', 'public.' || t, 'UPDATE')
       OR has_table_privilege('authenticated', 'public.' || t, 'DELETE')
    THEN
      RAISE EXCEPTION '% is still reachable by anon/authenticated', t;
    END IF;

    absent_cols := NULL;
    FOR c IN SELECT jsonb_array_elements_text(required -> t) LOOP
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = t AND column_name = c
      ) THEN
        absent_cols := concat_ws(', ', absent_cols, c);
      END IF;
    END LOOP;
    IF absent_cols IS NOT NULL THEN
      RAISE EXCEPTION '% is missing columns the gateway reads: %', t, absent_cols;
    END IF;
  END LOOP;

  -- The nullability that is load-bearing. A NOT NULL on any of these five would
  -- force every write to invent an answer to a question nobody asked, which is
  -- the exact fault `providers.lead_time_days DEFAULT 7` already commits.
  FOR c IN
    SELECT unnest(ARRAY[
      'delivery_weekdays', 'order_cutoff_time', 'order_cutoff_offset_days',
      'minimum_order_amount', 'lead_time_days', 'payment_terms'
    ])
  LOOP
    IF (SELECT is_nullable FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'restaurant_vendor_terms'
           AND column_name = c) <> 'YES' THEN
      RAISE EXCEPTION
        'restaurant_vendor_terms.% must be nullable — an unstated term is not a zero', c;
    END IF;
    IF (SELECT column_default FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'restaurant_vendor_terms'
           AND column_name = c) IS NOT NULL THEN
      RAISE EXCEPTION
        'restaurant_vendor_terms.% carries a column default — that is the providers.lead_time_days fault repeated', c;
    END IF;
  END LOOP;

  -- The rule set stays closed, and each rule still has to carry its number.
  -- Asserted rather than assumed because a later ALTER that drops either CHECK
  -- would leave a threshold that cannot fire rendered as one that can — and the
  -- register above these tables reads the constraint, not a comment.
  FOR c IN
    SELECT unnest(ARRAY[
      'restaurant_approval_thresholds_rule_check',
      'restaurant_approval_thresholds_required_role_check',
      'restaurant_approval_thresholds_rule_carries_its_number'
    ])
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = to_regclass('public.restaurant_approval_thresholds')
        AND conname = c
    ) THEN
      RAISE EXCEPTION 'restaurant_approval_thresholds is missing constraint %', c;
    END IF;
  END LOOP;

  -- This migration seeds NO policy row. Stated as an assertion rather than as a
  -- comment, and scoped to rows this transaction could have written, so a
  -- re-run over a house that has since set its own ceiling still passes.
  -- `now()` is the TRANSACTION start time, and the CLI wraps this file in one
  -- transaction, so a row this migration wrote would carry exactly it.
  IF EXISTS (
    SELECT 1 FROM public.restaurant_approval_thresholds WHERE created_at >= now()
  ) THEN
    RAISE EXCEPTION
      'this migration wrote an approval threshold — a seeded policy is a policy nobody set';
  END IF;

  RAISE NOTICE 'restaurant_vendor_terms and restaurant_approval_thresholds created, RLS on, anon/authenticated revoked, nullability contract satisfied, no policy seeded.';
END
$$;

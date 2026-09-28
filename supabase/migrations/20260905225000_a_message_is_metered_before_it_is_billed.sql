-- A message is metered before it is billed (ADR 0121 addendum; OD-23 answered).
--
-- WHAT THE FOUNDER DECIDED, 2026-09-05
-- ------------------------------------
-- Each plan includes a monthly message allowance, set from MEASURED usage after
-- one quarter and generous at first. Past it, the house either buys Mudavym
-- credits — provider cost passed through, plus a stated platform fee, with the
-- meter visible — or connects its own Twilio / Meta account and pays them
-- directly while Mudavym bills only the platform. Rejected: allowance + credits
-- only; and pass-through from the first message.
--
-- THREE TABLES, AND WHY EACH ONE
-- ------------------------------
--   1. `plan_message_allowances` — what a plan includes. It starts EMPTY, and
--      that is the decision rather than an omission: the founder's answer is
--      that the number comes from a quarter of measurement that has not
--      happened. A house therefore reads "no allowance stated" today, which is
--      TRUE. A `DEFAULT 0` here would have said "your plan includes nothing",
--      which is false, and `restaurants.subscription_tier` already shows what a
--      seeded default costs: it carries `DEFAULT 'pilot'` and every house on the
--      deployment inherited it without choosing it.
--
--   2. `house_message_meter` — one row per outbound text this house sends,
--      whether or not it counted against anything. The counter is a LEDGER and
--      not a running total, for the reason ADR 0078 gives about counts: a total
--      cannot be audited, disputed or recomputed, and the first time a house
--      disagrees with its bill the total is the only thing that could be wrong.
--
--   3. `house_message_credits` — money in and money out, in minor units with the
--      currency on every row. A purchase is sealed (ADR 0107); a debit names the
--      meter row it paid for.
--
-- TWO MEASURED FACTS THAT SHAPED THE COLUMNS
-- ------------------------------------------
--   * Twilio's Message resource says `price` "is populated after the message has
--     been sent/received, and may not be immediately available"
--     (twilio.com/docs/messaging/api/message-resource, via Twilio's docs MCP,
--     2026-09-05). So AT SEND TIME THE PROVIDER COST IS NOT KNOWN. A schema that
--     required a cost at insert would have forced somebody to invent one, and a
--     nullable cost column with no state beside it would let "not reported yet"
--     render as "free". Hence `provider_cost_state`, with no default.
--
--   * Meta charges per message only when a TEMPLATE is delivered; "All
--     non-template messages are free" inside an open 24-hour customer service
--     window, and utility templates inside that window are free too
--     (developers.facebook.com/documentation/business-messaging/whatsapp/pricing,
--     fetched 2026-09-05). So most of Mudavym's reply-shaped traffic costs
--     nothing, and a meter that counted every message against an allowance would
--     bill a house for messages the provider gave away. Hence
--     `counts_against_allowance`, with no default and a written reason beside it.
--
-- ADDITIVE. Three new tables, one CHECK constraint extended in place, no column
-- added to an existing table, no constraint relaxed. Idempotent and safe to
-- re-run. No explicit BEGIN/COMMIT — the Supabase CLI wraps each file.

-- ---------------------------------------------------------------------------
-- 1. What a plan includes.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.plan_message_allowances (
  -- Matches `restaurants.subscription_tier`, which is a VARCHAR(50) carrying
  -- DEFAULT 'pilot'. That default is exactly why a MISSING row here must print
  -- "no allowance stated" rather than resolving to a number: nearly every house
  -- on this deployment is on 'pilot' because nobody ever asked it, and an
  -- allowance attached to that tier would be an entitlement nobody chose.
  plan_code TEXT PRIMARY KEY,

  -- NULLABLE, AND NULL IS NOT ZERO. NULL means "this plan's allowance has not
  -- been set yet", which is the true state of every plan today: the founder's
  -- decision is that the number comes from a quarter of measured usage. Zero
  -- would mean "this plan includes no messages", which is a different and
  -- currently false statement.
  monthly_allowance INTEGER
    CHECK (monthly_allowance IS NULL OR monthly_allowance >= 0),

  -- Where the number came from and when, in words. A bare allowance with no
  -- provenance outlives the measurement that produced it.
  stated_source TEXT NOT NULL,
  stated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  stated_by UUID REFERENCES public.users(user_id) ON DELETE SET NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- A NUMBER HERE MUST CARRY ITS PROVENANCE.
  --
  -- This started life as a DO $$ assertion that the table is EMPTY, which is
  -- true today and was the founder's decision — and it was wrong as a
  -- constraint, because it made the migration fail its own idempotency the
  -- moment a real allowance was set. Re-running the file is how a partial apply
  -- is recovered; a file that cannot be re-run has traded a real safety
  -- property for a slogan.
  --
  -- The durable version of the same intent is this: NULL (not stated) needs
  -- nothing, but a number needs a sentence saying where it came from, and
  -- twenty characters is more than a placeholder and less than an essay. The
  -- thing actually being prevented is an allowance seeded by someone in a hurry
  -- and then read by a house as an entitlement it was granted.
  CONSTRAINT plan_message_allowances_number_has_provenance CHECK (
    monthly_allowance IS NULL OR length(btrim(stated_source)) >= 20
  )
);

COMMENT ON TABLE public.plan_message_allowances IS
  'The monthly message allowance a plan includes (ADR 0121 addendum, OD-23). STARTS EMPTY BY DECISION: the founder''s answer of 2026-09-05 is that the number is set from measured usage after one quarter, so today every house reads "no allowance stated" and that sentence is true. RLS on, service_role only, anon/authenticated revoked.';
COMMENT ON COLUMN public.plan_message_allowances.monthly_allowance IS
  'NULL means NOT YET SET and must render as "no allowance stated". It is NEVER 0: zero would assert that the plan includes no messages, which is a claim nobody has made.';

ALTER TABLE public.plan_message_allowances ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS plan_message_allowances_service_role
  ON public.plan_message_allowances;
CREATE POLICY plan_message_allowances_service_role
  ON public.plan_message_allowances
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.plan_message_allowances FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. The meter. One row per outbound text, billable or not.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.house_message_meter (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  restaurant_id UUID NOT NULL
    REFERENCES public.restaurants(id) ON DELETE CASCADE,

  -- SET NULL, not CASCADE: revoking or replacing a sender must not erase the
  -- record of what it sent, which is the half of the bill the house can check.
  sender_id UUID REFERENCES public.house_text_senders(id) ON DELETE SET NULL,

  -- The crew-note receipt this message corresponds to, when it is a crew note.
  -- NULL for a vendor conversation. This column is why the meter is a SECOND
  -- ledger rather than a column on `team_note_deliveries`: that table is the
  -- crew-note receipt and has no restaurant_id, while the meter must count
  -- every text a house sends, to a vendor or to the crew. Naming the link makes
  -- the relationship auditable instead of duplicating it silently.
  team_note_delivery_id UUID
    REFERENCES public.team_note_deliveries(id) ON DELETE SET NULL,

  channel TEXT NOT NULL CHECK (channel IN ('whatsapp', 'sms')),
  provider TEXT NOT NULL CHECK (provider IN ('meta_cloud', 'twilio')),

  -- THE MONTH THIS FALLS IN, AND WHOSE CLOCK SAYS SO. Meta's rate cards are
  -- applied "based on WhatsApp Business account timezone"
  -- (developers.facebook.com/.../pricing, fetched 2026-09-05), so a month
  -- computed in UTC would put a Türkiye house's late-evening messages in the
  -- wrong month at every boundary. The timezone that produced the key is stored
  -- beside it, because a key with no timezone cannot be re-derived.
  month_key TEXT NOT NULL CHECK (month_key ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  month_timezone TEXT NOT NULL,

  -- NO DEFAULT. Whether this message eats allowance is a FACT about the
  -- provider's pricing, not a convenience: a free-form WhatsApp reply inside an
  -- open 24-hour window is free, and counting it would bill a house for a
  -- message Meta gave away. An omitted value must fail the insert.
  counts_against_allowance BOOLEAN NOT NULL,

  -- Why it does or does not count, in words. Required for the same reason
  -- `team_note_deliveries.detail` is: a count with no reason is a number a house
  -- cannot argue with.
  billable_reason TEXT NOT NULL,

  -- The provider's own id: a `wamid.…` or a Twilio `SM…` SID. Never a credential.
  provider_message_ref TEXT,

  -- WHAT IT COST, AND WHETHER WE KNOW. `provider_cost_state` has NO DEFAULT and
  -- exists because Twilio's price arrives after the send: a nullable cost with
  -- no state beside it would let "not reported yet" render as "free", which is
  -- the absence-reported-as-health shape aimed straight at a bill.
  provider_cost_state TEXT NOT NULL CHECK (
    provider_cost_state IN ('not_reported_yet', 'reported', 'unavailable')
  ),
  provider_cost_minor BIGINT,
  provider_cost_currency CHAR(3)
    CHECK (provider_cost_currency IS NULL OR provider_cost_currency ~ '^[A-Z]{3}$'),
  provider_cost_reported_at TIMESTAMPTZ,

  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- A REPORTED COST CARRIES BOTH HALVES; AN UNREPORTED ONE CARRIES NEITHER.
  -- An amount with no currency is not money (ADR 0117 Q25: fourteen production
  -- houses all read USD because a column defaulted, two of them in Türkiye).
  CONSTRAINT house_message_meter_cost_matches_state CHECK (
    (provider_cost_state = 'reported'
      AND provider_cost_minor IS NOT NULL
      AND provider_cost_currency IS NOT NULL
      AND provider_cost_reported_at IS NOT NULL)
    OR (provider_cost_state <> 'reported'
      AND provider_cost_minor IS NULL
      AND provider_cost_currency IS NULL)
  )
);

COMMENT ON TABLE public.house_message_meter IS
  'One row per outbound text a house sends, written whether or not it counted against an allowance and whether or not the provider has reported a cost (ADR 0121 addendum, OD-23). A ledger and not a running total, for ADR 0078''s reason: a total cannot be audited or disputed, and the first thing a house argues about is its bill. RLS on, service_role only, anon/authenticated revoked.';
COMMENT ON COLUMN public.house_message_meter.provider_cost_state IS
  'not_reported_yet — the provider has not told us yet, which is the NORMAL state at send time because Twilio populates `price` after the send. reported — both amount and currency are present. unavailable — the provider will not tell us. NO DEFAULT: a message whose cost state was not stated must fail rather than read as free.';
COMMENT ON COLUMN public.house_message_meter.counts_against_allowance IS
  'NO DEFAULT. False for a free-form WhatsApp message inside an open 24-hour customer service window and for a utility template inside one — Meta charges neither. `billable_reason` carries the sentence.';

CREATE INDEX IF NOT EXISTS idx_house_message_meter_house_month
  ON public.house_message_meter (restaurant_id, month_key);

CREATE INDEX IF NOT EXISTS idx_house_message_meter_cost_pending
  ON public.house_message_meter (restaurant_id)
  WHERE provider_cost_state = 'not_reported_yet';

ALTER TABLE public.house_message_meter ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS house_message_meter_service_role ON public.house_message_meter;
CREATE POLICY house_message_meter_service_role
  ON public.house_message_meter
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.house_message_meter FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Credits. Money in, money out, currency on every row.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.house_message_credits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  restaurant_id UUID NOT NULL
    REFERENCES public.restaurants(id) ON DELETE CASCADE,

  -- NO DEFAULT. Four kinds, kept apart because collapsing any two makes the
  -- balance unexplainable: a refund is not a purchase with a minus sign (it
  -- names the purchase it reverses) and an adjustment is not a debit (nobody
  -- sent a message).
  entry_kind TEXT NOT NULL CHECK (
    entry_kind IN ('purchase', 'debit', 'refund', 'adjustment')
  ),

  -- MINOR UNITS, SIGNED, AND NEVER ZERO. Positive adds spendable credit,
  -- negative consumes it. Zero would be a movement that moved nothing, which is
  -- a row that can only confuse a reconciliation.
  amount_minor BIGINT NOT NULL CHECK (amount_minor <> 0),
  currency CHAR(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),

  -- ON A DEBIT: the two halves the founder named — "provider cost passed
  -- through plus a stated platform fee". Kept apart so the house can see both.
  -- Nullable because a purchase has neither, and because a debit recorded before
  -- the provider reports its price genuinely does not know the first half yet.
  provider_cost_minor BIGINT,
  platform_fee_minor BIGINT,
  -- The fee rule in WORDS, as it stood when this entry was written. The same
  -- reason `house_text_senders.fee_stated` is TEXT: a percentage stored as a
  -- number outlives the decision that set it, and a house disputing a bill is
  -- owed the rule it was charged under, not the rule in force today.
  fee_basis TEXT,

  -- What this entry is about. A debit names its meter row; a purchase names the
  -- seal that authorised it. Both are enforced below.
  meter_id UUID REFERENCES public.house_message_meter(id) ON DELETE SET NULL,
  seal_id UUID,
  -- The provider's own reference for the payment, when there is one.
  payment_ref TEXT,

  -- The sentence the house reads on the meter. Required: an unexplained
  -- movement on a bill is the thing that makes a manager call.
  detail TEXT NOT NULL,

  recorded_by UUID REFERENCES public.users(user_id) ON DELETE SET NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- A PURCHASE ADDS, IS SEALED, AND NAMES NO MESSAGE.
  CONSTRAINT house_message_credits_purchase_shape CHECK (
    entry_kind <> 'purchase'
    OR (amount_minor > 0 AND seal_id IS NOT NULL AND meter_id IS NULL)
  ),

  -- A DEBIT SUBTRACTS AND NAMES THE MESSAGE IT PAID FOR. Without the meter link
  -- a balance could fall with nothing to point at, which is the shape a house
  -- cannot audit — and `ON DELETE SET NULL` above means the link can be lost to
  -- a deletion but never omitted at write time.
  CONSTRAINT house_message_credits_debit_shape CHECK (
    entry_kind <> 'debit'
    OR (amount_minor < 0 AND seal_id IS NULL)
  ),

  -- A REFUND SUBTRACTS NOTHING AND AN ADJUSTMENT NAMES NO SEAL. Stated so the
  -- two residual kinds are not a hole in the shape rules above.
  CONSTRAINT house_message_credits_residual_shape CHECK (
    entry_kind NOT IN ('refund', 'adjustment')
    OR (seal_id IS NULL AND meter_id IS NULL)
  )
);

COMMENT ON TABLE public.house_message_credits IS
  'The credit ledger behind the founder''s 2026-09-05 answer to OD-23: past the plan allowance a house buys Mudavym credits at provider cost plus a stated platform fee, with the meter visible. Money in minor units with the currency on every row. A purchase redeems a seal (ADR 0107) and names none; a debit names the house_message_meter row it paid for. RLS on, service_role only, anon/authenticated revoked.';
COMMENT ON COLUMN public.house_message_credits.fee_basis IS
  'The platform-fee rule in words as it stood when the entry was written. Deliberately not numeric: a house disputing a charge is owed the rule it was charged under, not the rule in force today.';

CREATE INDEX IF NOT EXISTS idx_house_message_credits_house
  ON public.house_message_credits (restaurant_id, recorded_at DESC);

ALTER TABLE public.house_message_credits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS house_message_credits_service_role ON public.house_message_credits;
CREATE POLICY house_message_credits_service_role
  ON public.house_message_credits
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.house_message_credits FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. The seal learns one more kind — WITHOUT restating the list.
--
-- Every earlier migration that added a seal kind rewrote the whole CHECK from a
-- hand-typed list (20260904220000:50, 20260905180000:305, 20260905233000:411).
-- That works while one branch at a time is open. It does NOT work here: three
-- sessions are writing migrations into this worktree today, and whichever file
-- sorts LAST silently drops every kind the others added, because each one
-- enumerates the set it happened to know about. The failure is invisible in
-- review — each file looks correct on its own — and lands as a CHECK violation
-- on a route in production.
--
-- So this one reads the kinds the constraint currently admits, adds exactly one,
-- and writes the union back. It cannot drop a peer's kind, and it RAISES rather
-- than guessing if it cannot read the existing constraint.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  existing_def TEXT;
  kinds TEXT[];
  wanted TEXT := 'text_credit_purchase';
  rebuilt TEXT;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO existing_def
  FROM pg_constraint
  WHERE conrelid = 'public.mcp_seal_challenges'::regclass
    AND conname = 'chk_mcp_seal_challenges_subject_kind';

  IF existing_def IS NULL THEN
    RAISE EXCEPTION
      'chk_mcp_seal_challenges_subject_kind is absent: this migration extends a constraint that must already exist (20260904210000)';
  END IF;

  SELECT array_agg(DISTINCT m[1]) INTO kinds
  FROM regexp_matches(existing_def, '''([a-z_]+)''', 'g') AS m;

  -- Four kinds existed on 2026-09-04 before any of today's work; reading fewer
  -- than four means the parse failed, and rewriting a constraint from a failed
  -- parse would delete the seal's entire vocabulary.
  IF kinds IS NULL OR array_length(kinds, 1) < 4 THEN
    RAISE EXCEPTION
      'could not read the admitted seal kinds out of "%" — refusing to rewrite a constraint this migration cannot read',
      existing_def;
  END IF;

  IF wanted = ANY(kinds) THEN
    RETURN;  -- already extended; re-running this file changes nothing
  END IF;

  kinds := kinds || wanted;

  SELECT string_agg(quote_literal(k), ', ' ORDER BY k)
  INTO rebuilt
  FROM unnest(kinds) AS k;

  EXECUTE 'ALTER TABLE public.mcp_seal_challenges '
       || 'DROP CONSTRAINT chk_mcp_seal_challenges_subject_kind';
  EXECUTE 'ALTER TABLE public.mcp_seal_challenges '
       || 'ADD CONSTRAINT chk_mcp_seal_challenges_subject_kind '
       || format('CHECK (subject_kind IN (%s))', rebuilt);
END $$;

-- ---------------------------------------------------------------------------
-- 5. Assertions.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  t TEXT;
  has_rls BOOLEAN;
  client_grants INT;
  admits_new_kind BOOLEAN;
  still_admits_payment BOOLEAN;
  allowance_rows INT;
  probe_restaurant UUID;
  rejected BOOLEAN;
BEGIN
  FOREACH t IN ARRAY ARRAY['plan_message_allowances',
                           'house_message_meter',
                           'house_message_credits']
  LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE EXCEPTION 'table public.% did not apply', t;
    END IF;

    SELECT relrowsecurity INTO has_rls
    FROM pg_class WHERE oid = ('public.' || t)::regclass;
    IF NOT has_rls THEN
      RAISE EXCEPTION 'RLS is not enabled on public.%', t;
    END IF;

    SELECT count(*) INTO client_grants
    FROM information_schema.role_table_grants
    WHERE table_schema = 'public'
      AND table_name = t
      AND grantee IN ('anon', 'authenticated');
    IF client_grants > 0 THEN
      RAISE EXCEPTION 'anon/authenticated still hold % grants on public.%',
        client_grants, t;
    END IF;
  END LOOP;

  -- No defaults on the three columns whose absence must fail loudly.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'house_message_meter'
      AND column_name IN ('counts_against_allowance', 'provider_cost_state')
      AND column_default IS NOT NULL
  ) THEN
    RAISE EXCEPTION
      'house_message_meter.counts_against_allowance / provider_cost_state must have no default: an omitted value would read as "free" or "not billable"';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'house_message_credits'
      AND column_name = 'entry_kind' AND column_default IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'house_message_credits.entry_kind must have no default';
  END IF;

  -- The allowance column must be NULLABLE. If somebody makes it NOT NULL the
  -- only way to insert a plan is to assert a number, and "not yet set" stops
  -- being expressible.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'plan_message_allowances'
      AND column_name = 'monthly_allowance' AND is_nullable = 'NO'
  ) THEN
    RAISE EXCEPTION
      'plan_message_allowances.monthly_allowance must stay nullable: NULL is "not stated" and there is no other way to say it';
  END IF;

  -- This migration SEEDS NOTHING into the allowance table: the founder's answer
  -- of 2026-09-05 is that the number comes from a quarter of measured usage
  -- that has not happened, so every plan reads "no allowance stated" today. The
  -- count is REPORTED rather than asserted to be zero, because asserting it
  -- would make the file fail its own idempotency the first time a real
  -- allowance exists, and re-running is how a partial apply is recovered. What
  -- is enforced instead is `plan_message_allowances_number_has_provenance`,
  -- proven below.
  SELECT count(*) INTO allowance_rows FROM public.plan_message_allowances;
  RAISE NOTICE 'plan_message_allowances holds % row(s); this migration inserted none', allowance_rows;

  rejected := FALSE;
  BEGIN
    INSERT INTO public.plan_message_allowances (plan_code, monthly_allowance, stated_source)
    VALUES ('__migration_probe__', 500, 'guess');
  EXCEPTION WHEN check_violation THEN
    rejected := TRUE;
  END;
  IF NOT rejected THEN
    DELETE FROM public.plan_message_allowances WHERE plan_code = '__migration_probe__';
    RAISE EXCEPTION
      'plan_message_allowances accepted an allowance with a five-character source — the provenance CHECK is not biting';
  END IF;

  -- The seal admits the new kind AND still admits an old one. The second half is
  -- the point of section 4: a rebuild that dropped a peer's kind would pass the
  -- first check alone.
  SELECT 'text_credit_purchase' = ANY(k), 'payment_method' = ANY(k)
  INTO admits_new_kind, still_admits_payment
  FROM (
    SELECT array_agg(m[1]) AS k
    FROM pg_constraint c,
         LATERAL regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''', 'g') AS m
    WHERE c.conrelid = 'public.mcp_seal_challenges'::regclass
      AND c.conname = 'chk_mcp_seal_challenges_subject_kind'
  ) s;

  IF NOT admits_new_kind THEN
    RAISE EXCEPTION
      'the seal subject_kind CHECK does not admit text_credit_purchase; the code declares a kind the database refuses';
  END IF;
  IF NOT still_admits_payment THEN
    RAISE EXCEPTION
      'rebuilding the seal subject_kind CHECK dropped payment_method — the union in section 4 is broken';
  END IF;

  -- PROVE the purchase shape bites, rather than asserting the constraint exists.
  SELECT id INTO probe_restaurant FROM public.restaurants LIMIT 1;
  IF probe_restaurant IS NOT NULL THEN
    rejected := FALSE;
    BEGIN
      INSERT INTO public.house_message_credits (
        restaurant_id, entry_kind, amount_minor, currency,
        provider_cost_minor, platform_fee_minor, fee_basis,
        meter_id, seal_id, payment_ref, detail, recorded_by
      ) VALUES (
        probe_restaurant, 'purchase', 5000, 'USD',
        NULL, NULL, NULL,
        NULL, NULL, NULL, 'migration probe, must be refused', NULL
      );
    EXCEPTION WHEN check_violation THEN
      rejected := TRUE;
    END;
    IF NOT rejected THEN
      RAISE EXCEPTION
        'house_message_credits accepted an unsealed purchase — the purchase CHECK is not biting';
    END IF;

    rejected := FALSE;
    BEGIN
      INSERT INTO public.house_message_meter (
        restaurant_id, sender_id, team_note_delivery_id,
        channel, provider, month_key, month_timezone,
        counts_against_allowance, billable_reason, provider_message_ref,
        provider_cost_state, provider_cost_minor, provider_cost_currency,
        provider_cost_reported_at
      ) VALUES (
        probe_restaurant, NULL, NULL,
        'sms', 'twilio', '2026-09', 'Europe/Istanbul',
        TRUE, 'migration probe, must be refused', NULL,
        'not_reported_yet', 120, 'USD',
        NULL
      );
    EXCEPTION WHEN check_violation THEN
      rejected := TRUE;
    END;
    IF NOT rejected THEN
      RAISE EXCEPTION
        'house_message_meter accepted a cost on an unreported row — the cost/state CHECK is not biting';
    END IF;

    DELETE FROM public.house_message_credits
      WHERE restaurant_id = probe_restaurant
        AND detail = 'migration probe, must be refused';
    DELETE FROM public.house_message_meter
      WHERE restaurant_id = probe_restaurant
        AND billable_reason = 'migration probe, must be refused';
  END IF;
  -- On a fresh CI database `restaurants` is empty and the two probes above do
  -- not run. Stated rather than hidden: the structural assertions run
  -- everywhere; the constraint proofs need a house to hang on.
END $$;

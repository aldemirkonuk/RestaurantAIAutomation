-- ADR 0207, round 3 (2026-09-21). Two registers and one switch.
--
-- 1. procurement_order_arrival_answers — "Did it arrive?"
--    The founder, delegating the overdue-order rule the same evening ("think of
--    a best way to handle this ... You tell me"): an order past its expected
--    date and not received is ASKED first. The act has three choices:
--      Yes - receive it   opens the receiving door; the receipt is the record.
--      Not yet            recorded HERE; it confirms the order is late.
--      Cancel             the sealed cancellation; CANCELLED is the record.
--    Only "Not yet" needs a row of its own, so the CHECK admits one answer.
--    Each answer names the expected date it was given for: a vendor's new date
--    moves the order, and an old "Not yet" does not confirm the new deadline
--    (`apps/api-gateway/src/procurement/overdue-order.ts`). Append-only.
--
-- 2. vendor_message_tone_scores — Jev's reading of one inbound vendor message,
--    on a point scale, keyed to OUR message id. The founder: "talk with JEV,
--    put that onto point scale, very detailed, seuper intelligent ML data
--    needed. this feature can also be disabled." Internal ML data: RLS on,
--    service_role only, no grant to anon or authenticated, and no house route
--    returns a row of it — the vendor sheet shows only warm / plain / terse,
--    derived in the gateway from named thresholds. No message text is kept
--    here: the text stays in procurement_conversations, and what left for Jev
--    was the MASKED text (emails, phone numbers and person names removed
--    before it left — the founder's Jev egress ruling, "Only with names
--    removed"). `masked` records how many of each were removed, as proof the
--    masker ran, never what they were.
--
-- 3. restaurants.vendor_tone_scoring_enabled — the per-house switch. DEFAULT
--    false: nothing leaves for Jev until an owner or manager turns it on. The
--    default itself is an open founder question (ADR 0207); false is the
--    direction that sends nothing while it is open.
--
-- Additive and idempotent: IF NOT EXISTS throughout; no row is written, moved
-- or deleted. Actor FK to public.users(user_id), never auth.users.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The "Not yet" answers.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.procurement_order_arrival_answers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  order_id UUID NOT NULL REFERENCES public.procurement_orders(id) ON DELETE CASCADE,
  answer TEXT NOT NULL,
  expected_date DATE NOT NULL,
  answered_by UUID NOT NULL REFERENCES public.users(user_id),
  answered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT procurement_order_arrival_answers_answer_check
    CHECK (answer = 'not_yet')
);

CREATE INDEX IF NOT EXISTS idx_procurement_order_arrival_answers_order
  ON public.procurement_order_arrival_answers (restaurant_id, order_id);

ALTER TABLE public.procurement_order_arrival_answers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS procurement_order_arrival_answers_service_role
  ON public.procurement_order_arrival_answers;
CREATE POLICY procurement_order_arrival_answers_service_role
  ON public.procurement_order_arrival_answers
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.procurement_order_arrival_answers FROM anon, authenticated;
-- Stated, not inherited: the gateway reads and writes with the service role,
-- and its access must not rest on the schema's default privileges alone.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.procurement_order_arrival_answers TO service_role;

COMMENT ON TABLE public.procurement_order_arrival_answers IS
  'A person of the house answering "Not yet" to "Did it arrive?" for an order past its expected date (ADR 0207). The answer confirms the order is late for THAT expected date only. Append-only; RLS on, service_role only.';

-- ---------------------------------------------------------------------------
-- 2. Jev's tone scores — internal ML data.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.vendor_message_tone_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  provider_id UUID NOT NULL REFERENCES public.providers(id) ON DELETE CASCADE,
  message_id UUID NOT NULL REFERENCES public.procurement_conversations(id) ON DELETE CASCADE,
  scale_version TEXT NOT NULL,
  status TEXT NOT NULL,
  reason TEXT,
  valence NUMERIC(3,2),
  friction NUMERIC(3,2),
  urgency NUMERIC(3,2),
  commitment NUMERIC(3,2),
  apology NUMERIC(3,2),
  escalation NUMERIC(3,2),
  confidence NUMERIC(3,2),
  quote_index SMALLINT,
  quote_confidence NUMERIC(3,2),
  model_requested TEXT NOT NULL,
  model_version TEXT,
  masked JSONB NOT NULL DEFAULT '{}'::jsonb,
  attempts SMALLINT NOT NULL DEFAULT 1,
  scored_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT vendor_message_tone_scores_status_check
    CHECK (status IN ('scored', 'failed')),
  CONSTRAINT vendor_message_tone_scores_valence_range
    CHECK (valence IS NULL OR valence BETWEEN -1 AND 1),
  CONSTRAINT vendor_message_tone_scores_facets_range
    CHECK (
      (friction IS NULL OR friction BETWEEN 0 AND 1)
      AND (urgency IS NULL OR urgency BETWEEN 0 AND 1)
      AND (commitment IS NULL OR commitment BETWEEN 0 AND 1)
      AND (apology IS NULL OR apology BETWEEN 0 AND 1)
      AND (escalation IS NULL OR escalation BETWEEN 0 AND 1)
      AND (confidence IS NULL OR confidence BETWEEN 0 AND 1)
      AND (quote_confidence IS NULL OR quote_confidence BETWEEN 0 AND 1)
    ),
  -- A scored row carries its valence and confidence and no failure reason; a
  -- failed row carries its reason and no score. Neither can pass as the other.
  CONSTRAINT vendor_message_tone_scores_scored_has_score
    CHECK (
      (status = 'scored' AND valence IS NOT NULL AND confidence IS NOT NULL AND reason IS NULL)
      OR (status = 'failed' AND valence IS NULL AND reason IS NOT NULL)
    ),
  CONSTRAINT vendor_message_tone_scores_attempts_positive CHECK (attempts >= 1)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_vendor_message_tone_scores_message_scale
  ON public.vendor_message_tone_scores (message_id, scale_version);

CREATE INDEX IF NOT EXISTS idx_vendor_message_tone_scores_house_vendor
  ON public.vendor_message_tone_scores (restaurant_id, provider_id);

ALTER TABLE public.vendor_message_tone_scores ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vendor_message_tone_scores_service_role
  ON public.vendor_message_tone_scores;
CREATE POLICY vendor_message_tone_scores_service_role
  ON public.vendor_message_tone_scores
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.vendor_message_tone_scores FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vendor_message_tone_scores TO service_role;

COMMENT ON TABLE public.vendor_message_tone_scores IS
  'Jev''s point-scale reading of one inbound vendor message (ADR 0207): valence -1..1 and five facets 0..1 in 0.01 steps, with the model asked for, the model that answered and its confidence. Internal ML data: RLS on, service_role only, never returned by a house route. No message text is stored; the text Jev read had emails, phone numbers and person names masked first. A failed call is a failed row with its reason, and the sheet reads that message as not assessed.';

-- ---------------------------------------------------------------------------
-- 3. The per-house switch.
-- ---------------------------------------------------------------------------

ALTER TABLE public.restaurants
  ADD COLUMN IF NOT EXISTS vendor_tone_scoring_enabled BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.restaurants.vendor_tone_scoring_enabled IS
  'Whether this house''s inbound vendor mail is scored by Jev (masked first). Off by default; an owner or manager turns it on in Settings, audited. Off, the vendor sheet reads the inbound model''s existing label instead.';

-- ---------------------------------------------------------------------------
-- 4. Assert the outcome rather than reporting success.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['procurement_order_arrival_answers', 'vendor_message_tone_scores'] LOOP
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
    IF NOT (has_table_privilege('service_role', 'public.' || t, 'SELECT')
            AND has_table_privilege('service_role', 'public.' || t, 'INSERT'))
    THEN
      RAISE EXCEPTION '% is not readable and writable by service_role', t;
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'restaurants'
      AND column_name = 'vendor_tone_scoring_enabled'
      AND column_default = 'false'
  ) THEN
    RAISE EXCEPTION 'restaurants.vendor_tone_scoring_enabled is missing or does not default to false';
  END IF;
END;
$$;

COMMIT;

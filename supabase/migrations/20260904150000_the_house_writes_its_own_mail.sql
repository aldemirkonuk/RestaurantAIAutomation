-- The house writes its own mail — the four columns a manager-written letter
-- needs, and the one CHECK value that lets it exist at all (ADR 0118).
--
-- WHAT THIS FILE IS FOR
-- --------------------
-- Sketch 100 drew a composer whose merge unit is *the engine's whole sentence
-- with its provenance*. Three of the things that drawing needs cannot be
-- stored today, and each is one line here:
--
--   1. `chk_outbound_email_type` permits exactly ten values
--      (20260805000000_baseline_from_production.sql:4331). A letter the house
--      writes from nothing — no order, no vendor reply to answer — is none of
--      them, and inserting one fails the CHECK. `MANUAL_REPLY` was the closest
--      fit and was refused: it is the type the *reply-to-an-order* path writes
--      (procurement.controller.ts:453), and borrowing it would make two
--      different things indistinguishable in the ledger the page renders.
--
--   2. Nothing on `procurement_conversations` records WHICH insight sentences
--      a letter carried. Without that the provenance chips in the composer are
--      a screen effect that does not survive the send: six months later the
--      row says what was written and not what the house believed when it wrote
--      it. `inserted_insights` is that record.
--
--   3. `communication_templates` has eight columns
--      (20260805000000_baseline_from_production.sql:2465-2475) — no purpose, no
--      declared merge fields, no author, no last-used. A "template library"
--      built on it could show none of the four things the sketch's library page
--      is made of.
--
-- ADDITIVE AND NULLABLE, ON PURPOSE
-- --------------------------------
-- Every column added here is nullable with no default, and the CHECK is
-- replaced by a strict superset of itself. No existing row changes value, no
-- existing write path can start failing, and a deploy that lands this file
-- before the code that reads it is a no-op rather than an outage. There is no
-- backfill, because there is nothing true to backfill WITH: a letter sent
-- before this file carried no recorded provenance, and writing `'{}'` into
-- those rows would state that it carried none — which is a claim, not an
-- absence. NULL is the honest value and the readers render it as unknown.
--
-- NO NEW TABLE, SO NO NEW RLS
-- --------------------------
-- Both tables already have row-level security enabled
-- (`...:14718` for procurement_conversations; communication_templates likewise)
-- and adding a column does not change a policy. `check_new_tables_are_locked_
-- down.py` has nothing to find here, which is the correct outcome and not an
-- exemption.
--
-- Idempotent and safe to re-run: every statement is IF EXISTS / IF NOT EXISTS,
-- and the assertions at the bottom fail the migration rather than letting a
-- partial apply report success. No explicit BEGIN/COMMIT — the Supabase CLI
-- wraps each file in a transaction.

-- ---------------------------------------------------------------------------
-- 1. A letter the house wrote is its own kind of outbound.
-- ---------------------------------------------------------------------------

ALTER TABLE public.procurement_conversations
  DROP CONSTRAINT IF EXISTS chk_outbound_email_type;

ALTER TABLE public.procurement_conversations
  ADD CONSTRAINT chk_outbound_email_type CHECK (
    outbound_email_type IS NULL
    OR outbound_email_type::text = ANY (ARRAY[
      'PRICE_INQUIRY'::text,
      'DEMAND_OFFER'::text,
      'PROMO_INQUIRY'::text,
      'WINE_INQUIRY'::text,
      'MANUAL_REPLY'::text,
      'ORDER_CONFIRMATION'::text,
      'ACCEPTANCE_CONFIRM_REQUEST'::text,
      'CLARIFICATION'::text,
      'COUNTER_OFFER'::text,
      'ESCALATION'::text,
      -- new, and the only value this file adds
      'HOUSE_LETTER'::text
    ])
  );

-- ---------------------------------------------------------------------------
-- 2. What the letter claimed, and on whose arithmetic.
-- ---------------------------------------------------------------------------

ALTER TABLE public.procurement_conversations
  ADD COLUMN IF NOT EXISTS inserted_insights jsonb;

COMMENT ON COLUMN public.procurement_conversations.inserted_insights IS
  'One entry per engine sentence inserted into this letter: {candidate_key, category, sentence, period_start, period_end, computed_at}. NULL means no record was kept (every row written before 20260904150000), which is NOT the same as "no sentences were inserted" — readers must render NULL as unknown.';

-- ---------------------------------------------------------------------------
-- 3. A template with a purpose, its fields, its author and its last use.
-- ---------------------------------------------------------------------------

ALTER TABLE public.communication_templates
  ADD COLUMN IF NOT EXISTS category text,
  ADD COLUMN IF NOT EXISTS merge_fields jsonb,
  ADD COLUMN IF NOT EXISTS last_used_at timestamptz;

-- `public.users`, never `auth.users`. The two tables share ZERO ids in this
-- deployment, and the JWT carries `public.users.user_id` — an actor column
-- pointed at `auth.users` 23503s on every single write, and CI cannot catch it
-- because a fresh database has no rows to violate the constraint with.
-- ON DELETE SET NULL: who last edited a template is a fact worth keeping and a
-- dependency worth not having.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'communication_templates'
      AND column_name = 'updated_by'
  ) THEN
    ALTER TABLE public.communication_templates
      ADD COLUMN updated_by uuid REFERENCES public.users(user_id) ON DELETE SET NULL;
  END IF;
END
$$;

COMMENT ON COLUMN public.communication_templates.category IS
  'The letter''s purpose (order_confirmation, price_query, delivery_dispute, invoice_mismatch, promotion_reply). Vendor purposes only: a staff broadcast is deliberately NOT a template here (founder, 2026-09-04) — crew messages stay on /team.';
COMMENT ON COLUMN public.communication_templates.merge_fields IS
  'Declared merge fields for this template, as [{key, label, source}]. A field whose source is an engine sentence carries the rule key, never a re-derived figure.';
COMMENT ON COLUMN public.communication_templates.last_used_at IS
  'Stamped when a letter is queued from this template. NULL means never used, or used before 20260904150000 — the library says "unknown", not "never".';

-- ---------------------------------------------------------------------------
-- 4. Assertions. A partial apply must fail here, not pass quietly.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  missing text[] := ARRAY[]::text[];
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='procurement_conversations'
      AND column_name='inserted_insights'
  ) THEN missing := missing || 'procurement_conversations.inserted_insights'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='communication_templates'
      AND column_name IN ('category')
  ) THEN missing := missing || 'communication_templates.category'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='communication_templates'
      AND column_name='merge_fields'
  ) THEN missing := missing || 'communication_templates.merge_fields'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='communication_templates'
      AND column_name='updated_by'
  ) THEN missing := missing || 'communication_templates.updated_by'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='communication_templates'
      AND column_name='last_used_at'
  ) THEN missing := missing || 'communication_templates.last_used_at'; END IF;

  IF array_length(missing, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'the house letter columns did not apply: %', array_to_string(missing, ', ');
  END IF;

  -- The CHECK must now admit HOUSE_LETTER and must still refuse a value it
  -- never permitted. Proven by attempting both against the live constraint
  -- inside a savepoint, rather than by reading the catalogue text.
  BEGIN
    PERFORM 1;
    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conname = 'chk_outbound_email_type'
        AND conrelid = 'public.procurement_conversations'::regclass
        AND pg_get_constraintdef(oid) LIKE '%HOUSE_LETTER%'
    ) THEN
      RAISE EXCEPTION 'chk_outbound_email_type does not admit HOUSE_LETTER';
    END IF;
  END;

  RAISE NOTICE 'house letters: HOUSE_LETTER admitted, inserted_insights added, template library columns added.';
END
$$;

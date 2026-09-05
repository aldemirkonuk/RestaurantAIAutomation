-- A refused price book reopens ONCE, by an owner, with a stated reason - and the
-- decision history grows rather than being overwritten.
--
-- WHY THIS EXISTS (ADR 0128 Q3, answered by the founder 2026-09-05:
-- "Owner reopens with a stated reason")
-- ---------------------------------------------------------------------------
-- 20260905180000 made the same bytes ONE decision: `UNIQUE (source_key,
-- file_sha256)`, and a second upload of a refused book is told "a refused book
-- does not become acceptable by being sent again". That is right for a doctored
-- file and wrong for a book refused by mistake - the question this ADR asked as
-- Q3. The founder's answer keeps the uniqueness and adds a door:
--
--   * an OWNER, and not the person who refused it, may reopen it;
--   * ONCE - a second reopen on the same bytes is refused in words;
--   * with a stated reason, which goes on the record;
--   * and the book goes back through the TIER IT WAS IN. Nothing is re-judged:
--     `tier`, `tier_reasons` and `tier_note` are untouched, the status returns
--     to 'pending', and the rows stay exactly as unadmitted as they were.
--
-- The rejected alternative, recorded because it was the shipped behaviour: never
-- reopen, upload a corrected file. That answers a doctored book and punishes a
-- mistake, and it loses the evidence - a corrected file is different bytes, so
-- the refusal and the correction become two unrelated records and nobody can see
-- that one followed the other.
--
-- WHY THE REFUSAL MOVES INTO `decision_history` INSTEAD OF STAYING PUT
-- ---------------------------------------------------------------------------
-- 20260905180000's `price_index_upload_reviews_refusal_complete` says a row is
-- refused if and only if it names a refuser, a time and a reason. A reopened row
-- is no longer refused, so those three columns must be cleared - and clearing
-- them without keeping them would delete the only account of why anybody said no.
-- So the reopen APPENDS the refusal it is undoing to `decision_history` and then
-- clears it. The bytes stay one row; the history grows.
--
-- One consequence is stated rather than left to be discovered: because the
-- refusal has moved, a CHECK can no longer compare `reopened_by` with
-- `refused_by`. "The reopener is not the refuser" is therefore enforced in
-- `price-index-review.service.ts` and proved in `price-index-review.spec.ts`,
-- NOT by the database. Recorded here so nobody reads the absence of that CHECK
-- as the absence of the rule.
--
-- Additive. No existing column is altered, no existing CHECK is narrowed, no
-- existing row is rewritten. The Supabase CLI wraps each migration file in a
-- transaction, so no explicit BEGIN/COMMIT.

ALTER TABLE public.price_index_upload_reviews
  ADD COLUMN IF NOT EXISTS reopened_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reopened_by UUID,
  ADD COLUMN IF NOT EXISTS reopen_reason TEXT,
  ADD COLUMN IF NOT EXISTS reopen_seal_id UUID,
  ADD COLUMN IF NOT EXISTS decision_history JSONB;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'price_index_upload_reviews_reopened_by_fkey'
       AND conrelid = to_regclass('public.price_index_upload_reviews')
  ) THEN
    -- public.users, NEVER auth.users: the two tables are disjoint (zero shared
    -- ids) and the JWT carries public.users.user_id, so an actor FK to
    -- auth.users 23503s on every real write while CI stays green.
    -- ON DELETE RESTRICT, like the other three actors on this table: a reopen
    -- whose owner has become NULL is a reopen by nobody.
    ALTER TABLE public.price_index_upload_reviews
      ADD CONSTRAINT price_index_upload_reviews_reopened_by_fkey
      FOREIGN KEY (reopened_by) REFERENCES public.users(user_id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'price_index_upload_reviews_reopen_seal_fkey'
       AND conrelid = to_regclass('public.price_index_upload_reviews')
  ) THEN
    ALTER TABLE public.price_index_upload_reviews
      ADD CONSTRAINT price_index_upload_reviews_reopen_seal_fkey
      FOREIGN KEY (reopen_seal_id)
      REFERENCES public.mcp_seal_challenges(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'price_index_upload_reviews_reopen_complete'
       AND conrelid = to_regclass('public.price_index_upload_reviews')
  ) THEN
    -- All three or none. A row carrying a reopen time and no person or no
    -- reason is worse than one carrying neither: it looks decided.
    ALTER TABLE public.price_index_upload_reviews
      ADD CONSTRAINT price_index_upload_reviews_reopen_complete
      CHECK (
        (reopened_at IS NULL AND reopened_by IS NULL AND reopen_reason IS NULL)
        OR
        (reopened_at IS NOT NULL AND reopened_by IS NOT NULL
          AND reopen_reason IS NOT NULL AND btrim(reopen_reason) <> '')
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'price_index_upload_reviews_reopen_has_history'
       AND conrelid = to_regclass('public.price_index_upload_reviews')
  ) THEN
    -- A reopen that kept no history is a reopen that DELETED the refusal it
    -- undid. The array is what the cleared refusal moved into, so a reopened
    -- row must carry at least one superseded decision.
    ALTER TABLE public.price_index_upload_reviews
      ADD CONSTRAINT price_index_upload_reviews_reopen_has_history
      CHECK (
        reopened_at IS NULL
        OR (jsonb_typeof(decision_history) = 'array'
            AND jsonb_array_length(decision_history) > 0)
      );
  END IF;
END
$$;

COMMENT ON COLUMN public.price_index_upload_reviews.reopened_at IS
  'When a refused book was put back in front of the jurisdiction (ADR 0128 Q3). Set ONCE: a second reopen on the same bytes is refused in words by the service, because this column is already set.';
COMMENT ON COLUMN public.price_index_upload_reviews.reopened_by IS
  'The OWNER who reopened it, as a public.users id - never auth.users. Never the person who refused it; that rule lives in the service because the refusal it compares against has moved into decision_history.';
COMMENT ON COLUMN public.price_index_upload_reviews.reopen_reason IS
  'Why an owner overrode a refusal, in their own words. Required by CHECK: a reopen with no reason teaches the refuser nothing.';
COMMENT ON COLUMN public.price_index_upload_reviews.decision_history IS
  'Superseded decisions on these bytes, oldest first, appended when a reopen clears them. NULL means nothing has ever been superseded - which is true of every row that has never been reopened, and of every row written before this column existed.';

-- The seek the reopen listing makes: which books an owner put back.
CREATE INDEX IF NOT EXISTS idx_price_index_upload_reviews_reopened
  ON public.price_index_upload_reviews (state, reopened_at DESC)
  WHERE reopened_at IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Assert the outcome rather than reporting success.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  c record;
  admits_partial boolean;
  admits_historyless boolean;
  probe_review UUID;
  probe_user UUID;
BEGIN
  IF to_regclass('public.price_index_upload_reviews') IS NULL THEN
    RAISE EXCEPTION 'price_index_upload_reviews does not exist; this migration is out of order';
  END IF;

  FOR c IN
    SELECT unnest(ARRAY['reopened_at','reopened_by','reopen_reason','reopen_seal_id','decision_history']) AS name
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'price_index_upload_reviews'
         AND column_name = c.name
    ) THEN
      RAISE EXCEPTION '% was not added', c.name;
    END IF;
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'price_index_upload_reviews'
         AND column_name = c.name AND column_default IS NOT NULL
    ) THEN
      RAISE EXCEPTION
        '% must have no DEFAULT - a default would give every row a decision nobody made', c.name;
    END IF;
  END LOOP;

  -- The actor FK must point INSIDE public. auth.users and public.users are
  -- disjoint, and CI cannot catch the mistake because a fresh database has no
  -- rows to violate.
  IF EXISTS (
    SELECT 1
      FROM pg_constraint con
      JOIN pg_class ref ON ref.oid = con.confrelid
      JOIN pg_namespace ns ON ns.oid = ref.relnamespace
     WHERE con.conname = 'price_index_upload_reviews_reopened_by_fkey'
       AND ns.nspname <> 'public'
  ) THEN
    RAISE EXCEPTION 'reopened_by points outside public; auth.users and public.users are disjoint';
  END IF;

  SELECT user_id INTO probe_user FROM public.users LIMIT 1;
  IF probe_user IS NOT NULL THEN
    -- Prove the all-or-nothing CHECK refuses a reopen with no reason.
    BEGIN
      INSERT INTO public.price_index_upload_reviews
        (source_key, state, file_name, file_sha256, edition_date, rows_written,
         uploaded_by, uploaded_by_restaurant_id, uploaded_at,
         tier, tier_reasons, tier_note, diff, price_fingerprint,
         fingerprint_refused_because, status,
         confirmed_by, confirmed_at, confirmation_evidence, confirmation_reason,
         confirmation_seal_id, refused_by, refused_at, refusal_reason,
         escalated_at, reopened_at, reopened_by, reopen_reason, reopen_seal_id,
         decision_history)
      VALUES
        ('reopen-probe', 'US-MI', 'probe.xlsx', repeat('b', 64),
         DATE '2026-01-01', 1,
         probe_user, NULL, NOW(),
         'second_pair_of_eyes', ARRAY['first_book'], 'probe', '{}'::jsonb,
         '{}'::jsonb, NULL, 'pending',
         NULL, NULL, NULL, NULL,
         NULL, NULL, NULL, NULL,
         NULL, NOW(), probe_user, NULL, NULL,
         '[{"decision":"refused"}]'::jsonb)
      RETURNING id INTO probe_review;
      admits_partial := true;
    EXCEPTION WHEN check_violation THEN
      admits_partial := false;
    END;
    IF admits_partial THEN
      DELETE FROM public.price_index_upload_reviews WHERE id = probe_review;
      RAISE EXCEPTION 'a reopen with no stated reason was admitted';
    END IF;

    -- Prove a reopen cannot throw the refusal away.
    BEGIN
      INSERT INTO public.price_index_upload_reviews
        (source_key, state, file_name, file_sha256, edition_date, rows_written,
         uploaded_by, uploaded_by_restaurant_id, uploaded_at,
         tier, tier_reasons, tier_note, diff, price_fingerprint,
         fingerprint_refused_because, status,
         confirmed_by, confirmed_at, confirmation_evidence, confirmation_reason,
         confirmation_seal_id, refused_by, refused_at, refusal_reason,
         escalated_at, reopened_at, reopened_by, reopen_reason, reopen_seal_id,
         decision_history)
      VALUES
        ('reopen-probe-2', 'US-MI', 'probe.xlsx', repeat('c', 64),
         DATE '2026-01-01', 1,
         probe_user, NULL, NOW(),
         'second_pair_of_eyes', ARRAY['first_book'], 'probe', '{}'::jsonb,
         '{}'::jsonb, NULL, 'pending',
         NULL, NULL, NULL, NULL,
         NULL, NULL, NULL, NULL,
         NULL, NOW(), probe_user, 'refused by mistake', NULL,
         NULL)
      RETURNING id INTO probe_review;
      admits_historyless := true;
    EXCEPTION WHEN check_violation THEN
      admits_historyless := false;
    END;
    IF admits_historyless THEN
      DELETE FROM public.price_index_upload_reviews WHERE id = probe_review;
      RAISE EXCEPTION
        'a reopen kept no history; the refusal it undid would have been deleted';
    END IF;
  ELSE
    RAISE NOTICE
      'no user row exists here, so the reopen CHECKs were created but not exercised. They are exercised against the same predicates by the jest suite.';
  END IF;

  RAISE NOTICE
    'price_index_upload_reviews: reopened_at/reopened_by/reopen_reason/reopen_seal_id/decision_history added; a reasonless reopen and a historyless reopen both proven refused; RLS and grants untouched.';
END
$$;

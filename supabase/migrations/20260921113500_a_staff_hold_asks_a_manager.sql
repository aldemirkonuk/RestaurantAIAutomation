-- A staff member's hold asks a manager; every vendor send names who sent it
-- (founder, 2026-09-21, "Staff ask, manager sends"; ADR 0175 amendment).
--
-- WHAT THIS FILE IS FOR
-- --------------------
-- The founder's answer of 2026-09-21: *"When a staff member holds, the letter
-- becomes a REQUEST: save the staffer's exact edited text as the version,
-- record who asked, mark the draft waiting for a manager, notify managers and
-- owners ... a manager releases it with one hold over that exact text; an edit
-- is a new version needing a new seal; the staffer sees who sent it."* And ADR
-- 0175 D9/D10: every vendor send is sealed and needs an owner, a manager or a
-- grantee, "with an actor recorded".
--
-- Three things cannot be stored today:
--
--   1. WHO ASKED, WHEN, AND OVER WHICH VERSION. The request is not a new
--      status. A requested draft stays `PENDING_APPROVAL`, so every reader that
--      already lists pending drafts keeps listing it, and the sweep, the
--      discard and the send paths need no new vocabulary. "Waiting for a
--      manager" is `PENDING_APPROVAL` AND `send_requested_at IS NOT NULL`.
--      `send_requested_sha256` is the hash of the letter the staffer asked for
--      (whitespace-normalised, the same normalisation the seal uses). Any later
--      writer that changes `content` — a regenerate, an edit through PATCH
--      orders/:id/draft — makes the stored hash stop matching, and the readout
--      then says the request is no longer current rather than presenting
--      somebody else's words as the staffer's. That is why a hash and not a
--      flag: nothing has to remember to clear it.
--      `send_requested_cc` is the copies the staffer chose; the seal binds
--      copies too, so the manager must see the same ones.
--   2. WHO SENT IT. `sent_by_user_id` on the outbound row, written by every
--      vendor-send path in the gateway (approve-draft / send-drafted-reply,
--      manual-reply, confirm-deal, the house composer). Before this file
--      manual-reply and confirm-deal recorded no actor at all.
--   3. UNDER WHICH GRANT. `sent_under_grant_id` names the ADR 0112 F12 grant a
--      grantee sent under, so "granted by" can be shown where it was used.
--
-- Plus two seal kinds, so two more vendor sends can be sealed over their own
-- subject: `procurement_conversation` (POST /conversations/:id/approve) and
-- `house_letter` (POST /communications/letters, subject = the vendor).
--
-- ADDITIVE AND NULLABLE, ON PURPOSE
-- --------------------------------
-- Every column is nullable with no default and there is no backfill: a letter
-- sent before this file named no sender, and writing one in now would be a
-- claim, not a record. NULL renders as "not recorded".
--
-- NO NEW TABLE, SO NO NEW RLS. procurement_conversations and
-- mcp_seal_challenges already have RLS on; a column does not change a policy.
--
-- Idempotent: IF NOT EXISTS throughout, the CHECK is rebuilt by reading the
-- kinds it admits today and appending (the only safe shape — see
-- 20260905233000 section 5 for the day a hand-typed list deleted a peer's
-- kind), and the assertions fail the migration on a partial apply.

-- ---------------------------------------------------------------------------
-- 1. Who asked, and over which version.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'procurement_conversations'
      AND column_name = 'send_requested_by'
  ) THEN
    ALTER TABLE public.procurement_conversations
      ADD COLUMN send_requested_by UUID REFERENCES public.users(user_id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'procurement_conversations'
      AND column_name = 'sent_by_user_id'
  ) THEN
    ALTER TABLE public.procurement_conversations
      ADD COLUMN sent_by_user_id UUID REFERENCES public.users(user_id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'procurement_conversations'
      AND column_name = 'sent_under_grant_id'
  ) THEN
    ALTER TABLE public.procurement_conversations
      ADD COLUMN sent_under_grant_id UUID REFERENCES public.authority_grants(id) ON DELETE SET NULL;
  END IF;
END
$$;

ALTER TABLE public.procurement_conversations
  ADD COLUMN IF NOT EXISTS send_requested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS send_requested_sha256 TEXT,
  ADD COLUMN IF NOT EXISTS send_requested_cc TEXT[];

ALTER TABLE public.procurement_conversations
  DROP CONSTRAINT IF EXISTS procurement_conversations_send_request_whole;
ALTER TABLE public.procurement_conversations
  ADD CONSTRAINT procurement_conversations_send_request_whole CHECK (
    -- A request has a time and a version together, or neither.
    (send_requested_at IS NULL) = (send_requested_sha256 IS NULL)
    -- A requester without a time is refused; the reverse survives because the
    -- requester column is ON DELETE SET NULL.
    AND (send_requested_by IS NULL OR send_requested_at IS NOT NULL)
    AND (send_requested_sha256 IS NULL OR send_requested_sha256 ~ '^[0-9a-f]{64}$')
  );

CREATE INDEX IF NOT EXISTS idx_proc_conv_waiting_for_a_manager
  ON public.procurement_conversations (restaurant_id, send_requested_at DESC)
  WHERE send_requested_at IS NOT NULL AND (status)::text = 'PENDING_APPROVAL';

COMMENT ON COLUMN public.procurement_conversations.send_requested_by IS
  'The member without send authority who held to send this letter (founder, 2026-09-21). With status PENDING_APPROVAL it means the letter waits for an owner, a manager or a grantee to release it.';
COMMENT ON COLUMN public.procurement_conversations.send_requested_sha256 IS
  'sha256 of the whitespace-normalised letter the requester asked for. The request is current only while sha256(content) still matches; any later edit or regenerate makes it read as no longer theirs.';
COMMENT ON COLUMN public.procurement_conversations.send_requested_cc IS
  'The copies the requester chose. NULL = none were chosen (a request always writes an array, possibly empty).';
COMMENT ON COLUMN public.procurement_conversations.sent_by_user_id IS
  'The person whose sealed hold sent this outbound letter. NULL on every row sent before 20260921113500 (not recorded, not "nobody").';
COMMENT ON COLUMN public.procurement_conversations.sent_under_grant_id IS
  'The ADR 0112 F12 grant the sender held when they were neither an owner nor a manager. NULL when the sender sent by their own role.';

-- ---------------------------------------------------------------------------
-- 2. The seal learns two more kinds (read-and-append, never a literal).
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  existing_def TEXT;
  kinds TEXT[];
  wanted TEXT;
  rebuilt TEXT;
  changed BOOLEAN := false;
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

  -- Nine kinds existed before this file; reading fewer than four means the
  -- parse failed, and rewriting from a failed parse would delete the seal's
  -- vocabulary.
  IF kinds IS NULL OR array_length(kinds, 1) < 4 THEN
    RAISE EXCEPTION
      'could not read the admitted seal kinds out of "%" - refusing to rewrite a constraint this migration cannot read',
      existing_def;
  END IF;

  FOREACH wanted IN ARRAY ARRAY['procurement_conversation', 'house_letter'] LOOP
    IF NOT (wanted = ANY(kinds)) THEN
      kinds := kinds || wanted;
      changed := true;
    END IF;
  END LOOP;

  IF NOT changed THEN
    RETURN;  -- already extended; re-running this file changes nothing
  END IF;

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
-- 3. Assertions. A partial apply must fail here, not pass quietly.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  absent text;
  c text;
  fk_target text;
  def text;
  k text;
BEGIN
  FOREACH c IN ARRAY ARRAY[
    'send_requested_by', 'send_requested_at', 'send_requested_sha256',
    'send_requested_cc', 'sent_by_user_id', 'sent_under_grant_id'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'procurement_conversations'
        AND column_name = c
    ) THEN
      absent := concat_ws(', ', absent, c);
    END IF;
  END LOOP;
  IF absent IS NOT NULL THEN
    RAISE EXCEPTION 'procurement_conversations is missing columns the gateway writes: %', absent;
  END IF;

  FOREACH c IN ARRAY ARRAY['send_requested_by', 'sent_by_user_id'] LOOP
    SELECT ccu.table_schema || '.' || ccu.table_name || '.' || ccu.column_name
      INTO fk_target
      FROM information_schema.key_column_usage kcu
      JOIN information_schema.referential_constraints rc
        ON rc.constraint_name = kcu.constraint_name
       AND rc.constraint_schema = kcu.constraint_schema
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = rc.unique_constraint_name
       AND ccu.constraint_schema = rc.unique_constraint_schema
     WHERE kcu.table_schema = 'public'
       AND kcu.table_name = 'procurement_conversations'
       AND kcu.column_name = c
     LIMIT 1;
    IF fk_target IS DISTINCT FROM 'public.users.user_id' THEN
      RAISE EXCEPTION 'procurement_conversations.% must reference public.users(user_id), found %', c, coalesce(fk_target, 'no foreign key');
    END IF;
  END LOOP;

  SELECT pg_get_constraintdef(oid) INTO def
  FROM pg_constraint
  WHERE conrelid = 'public.mcp_seal_challenges'::regclass
    AND conname = 'chk_mcp_seal_challenges_subject_kind';
  FOREACH k IN ARRAY ARRAY[
    'procurement_conversation', 'house_letter',
    -- the kinds that existed before this file must survive the rebuild
    'procurement_order', 'payment_method', 'mcp_tool', 'mcp_tool_grant',
    'house_mail_export', 'text_credit_purchase', 'procurement_document'
  ] LOOP
    IF def IS NULL OR position(quote_literal(k) IN def) = 0 THEN
      RAISE EXCEPTION 'the seal subject_kind CHECK does not admit %; the code declares a kind the database refuses', k;
    END IF;
  END LOOP;

  RAISE NOTICE 'send requests: requester, version hash, copies, sender and grant recorded; seal admits procurement_conversation and house_letter.';
END
$$;

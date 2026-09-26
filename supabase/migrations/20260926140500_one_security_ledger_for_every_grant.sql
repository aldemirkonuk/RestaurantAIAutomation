-- One security ledger, and every grant event is written to it — ADR 0112 F12,
-- built for grants by the ADR 0175 amendment (founder, 2026-09-21).
--
-- WHAT THE FOUNDER ASKED FOR
-- --------------------------
-- ADR 0112 F12 (2026-09-05, night): *"One security ledger. Step-up
-- verifications, break-glass uses and grant checks write to one tamper-evident
-- `security_events` chain that the trail and the owners' notices read from; a
-- guard asserts every ceremony writes its row."* On 2026-09-21 he asked for it
-- NOW for grants: every grant event (issued, revoked, re-approved, suspended,
-- deleted, its visibility changed, and a send made under it) is written here,
-- and the owners are told.
--
-- ONE TABLE, ONE CHAIN PER HOUSE
-- ------------------------------
-- Each row carries its house's running sequence number (`seq`, 1, 2, 3 ...),
-- the previous row's hash (`prev_hash`) and its own `hash`:
--
--   hash = sha256( prev_hash | seq | restaurant_id | kind | actor_ref |
--                  subject_kind | subject_id | occurred_at (UTC, microseconds)
--                  | detail::text )
--
-- so an edited, removed or re-ordered row breaks every hash after it, and
-- `security_events_verify_chain(house)` below says where. `detail` is jsonb, whose
-- text form is canonical (keys sorted, no duplicates), so the hash does not
-- depend on how a caller spelled the object.
--
-- Appending goes through `append_security_event` and nothing else: it takes a
-- per-house transaction advisory lock before reading the last row, so two
-- appends in the same house cannot both read the same predecessor. The unique
-- (restaurant_id, seq) index is the backstop if anything ever bypasses it.
--
-- APPEND-ONLY, FOR EVERY ROLE
-- ---------------------------
-- A BEFORE UPDATE / DELETE / TRUNCATE trigger refuses the change for every
-- role, service_role included — RLS does not bind service_role, so a policy
-- could not say this. Two exceptions, both the database's own referential
-- actions and nothing a caller can spell:
--   * DELETE when the row's house no longer exists (the ON DELETE CASCADE from
--     `restaurants`); a house is never deleted by this product, but a
--     cascade that could not complete would block that deletion forever;
--   * UPDATE that changes `actor_user_id` to NULL and nothing else, when that
--     person no longer exists (the ON DELETE SET NULL from `public.users`).
--     The hash covers `actor_ref`, an immutable text copy of the actor's id,
--     so the chain still verifies after the foreign key lets go.
--
-- SECURITY INVOKER, NOT DEFINER
-- -----------------------------
-- Every function here runs with its caller's rights. The gateway calls them as
-- service_role, which holds the table; a client role holds nothing on it, so a
-- client that somehow reached a function would still be refused by the table.
-- EXECUTE is revoked from PUBLIC, anon and authenticated and granted to
-- service_role (ADR 0159's closed state), although no function here is a
-- definer.
--
-- Additive and idempotent: IF NOT EXISTS / CREATE OR REPLACE / DROP ... IF
-- EXISTS throughout; the assertions at the bottom fail the migration rather
-- than letting a partial apply report success. No BEGIN/COMMIT — the CLI wraps
-- each file.

CREATE TABLE IF NOT EXISTS public.security_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  seq BIGINT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  kind TEXT NOT NULL,
  -- Who acted. NULL for an event the database itself raised (a grant
  -- suspended because the owner who vouched for it stopped being one).
  actor_user_id UUID REFERENCES public.users(user_id) ON DELETE SET NULL,
  -- The actor's id as text, kept when the foreign key lets go; the hash covers
  -- this, never the nullable key.
  actor_ref TEXT,
  subject_kind TEXT NOT NULL,
  subject_id UUID,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  prev_hash TEXT,
  hash TEXT NOT NULL,
  CONSTRAINT security_events_seq_positive CHECK (seq >= 1),
  CONSTRAINT security_events_first_has_no_prev CHECK ((seq = 1) = (prev_hash IS NULL)),
  CONSTRAINT security_events_hash_is_sha256 CHECK (hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT security_events_prev_is_sha256 CHECK (prev_hash IS NULL OR prev_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT security_events_actor_ref_matches CHECK (
    actor_user_id IS NULL OR actor_ref = actor_user_id::text
  ),
  CONSTRAINT security_events_kind_known CHECK (kind IN (
    'grant_issued',
    'grant_revoked',
    'grant_reapproved',
    'grant_suspended',
    'grant_deleted',
    'grant_visibility_changed',
    'grant_relied_on'
  )),
  CONSTRAINT security_events_subject_kind_known CHECK (subject_kind IN ('authority_grant'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_security_events_house_seq
  ON public.security_events (restaurant_id, seq);

-- The owners' trail: one grant's history, oldest first.
CREATE INDEX IF NOT EXISTS idx_security_events_subject
  ON public.security_events (restaurant_id, subject_kind, subject_id, seq);

ALTER TABLE public.security_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS security_events_service_role ON public.security_events;
CREATE POLICY security_events_service_role
  ON public.security_events
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.security_events FROM anon, authenticated;

COMMENT ON TABLE public.security_events IS
  'ADR 0112 F12''s one security ledger: a per-house hash chain (seq, prev_hash, hash), append-only for every role. Every authority-grant event is written here (founder, 2026-09-21). Append through append_security_event only; check with security_events_verify_chain.';

-- ---------------------------------------------------------------------------
-- The hash of one row, from its own fields. One function, used by the append
-- and by the verifier, so the two cannot disagree about what was hashed.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.security_event_hash(
  p_prev_hash TEXT,
  p_seq BIGINT,
  p_restaurant_id UUID,
  p_kind TEXT,
  p_actor_ref TEXT,
  p_subject_kind TEXT,
  p_subject_id UUID,
  p_occurred_at TIMESTAMPTZ,
  p_detail JSONB
) RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT encode(
    sha256(
      convert_to(
        concat_ws(
          '|',
          coalesce(p_prev_hash, ''),
          p_seq::text,
          p_restaurant_id::text,
          p_kind,
          coalesce(p_actor_ref, ''),
          p_subject_kind,
          coalesce(p_subject_id::text, ''),
          to_char(p_occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
          coalesce(p_detail, '{}'::jsonb)::text
        ),
        'UTF8'
      )
    ),
    'hex'
  );
$$;

-- ---------------------------------------------------------------------------
-- Append one event to a house's chain. The only writer.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.append_security_event(
  p_restaurant_id UUID,
  p_kind TEXT,
  p_actor_user_id UUID,
  p_subject_kind TEXT,
  p_subject_id UUID,
  p_detail JSONB
) RETURNS public.security_events
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  last_row public.security_events;
  next_seq BIGINT;
  at TIMESTAMPTZ := clock_timestamp();
  actor_ref TEXT := p_actor_user_id::text;
  row_out public.security_events;
BEGIN
  IF p_restaurant_id IS NULL THEN
    RAISE EXCEPTION 'a security event names its house';
  END IF;
  -- One appender per house at a time, released at the end of the transaction.
  PERFORM pg_advisory_xact_lock(hashtextextended('security_events:' || p_restaurant_id::text, 0));

  SELECT * INTO last_row
    FROM public.security_events
   WHERE restaurant_id = p_restaurant_id
   ORDER BY seq DESC
   LIMIT 1;

  next_seq := coalesce(last_row.seq, 0) + 1;

  INSERT INTO public.security_events (
    restaurant_id, seq, occurred_at, kind, actor_user_id, actor_ref,
    subject_kind, subject_id, detail, prev_hash, hash
  ) VALUES (
    p_restaurant_id, next_seq, at, p_kind, p_actor_user_id, actor_ref,
    p_subject_kind, p_subject_id, coalesce(p_detail, '{}'::jsonb), last_row.hash,
    public.security_event_hash(
      last_row.hash, next_seq, p_restaurant_id, p_kind, actor_ref,
      p_subject_kind, p_subject_id, at, coalesce(p_detail, '{}'::jsonb)
    )
  )
  RETURNING * INTO row_out;
  RETURN row_out;
END;
$$;

-- ---------------------------------------------------------------------------
-- Read a house's chain back and say whether it holds, and where it breaks.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.security_events_verify_chain(p_restaurant_id UUID)
RETURNS TABLE (holds BOOLEAN, events BIGINT, first_broken_seq BIGINT, why TEXT)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  r public.security_events;
  expected_prev TEXT := NULL;
  expected_seq BIGINT := 1;
  n BIGINT := 0;
BEGIN
  FOR r IN
    SELECT * FROM public.security_events
     WHERE restaurant_id = p_restaurant_id
     ORDER BY seq
  LOOP
    n := n + 1;
    IF r.seq <> expected_seq THEN
      RETURN QUERY SELECT false, n, r.seq, format('expected seq %s, found %s', expected_seq, r.seq);
      RETURN;
    END IF;
    IF r.prev_hash IS DISTINCT FROM expected_prev THEN
      RETURN QUERY SELECT false, n, r.seq, 'prev_hash does not name the row before it';
      RETURN;
    END IF;
    IF r.hash <> public.security_event_hash(
         r.prev_hash, r.seq, r.restaurant_id, r.kind, r.actor_ref,
         r.subject_kind, r.subject_id, r.occurred_at, r.detail) THEN
      RETURN QUERY SELECT false, n, r.seq, 'the row''s fields no longer hash to its hash';
      RETURN;
    END IF;
    expected_prev := r.hash;
    expected_seq := r.seq + 1;
  END LOOP;
  RETURN QUERY SELECT true, n, NULL::BIGINT, NULL::TEXT;
END;
$$;

-- ---------------------------------------------------------------------------
-- Append-only, for every role.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.security_events_refuse_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'security_events is append-only: TRUNCATE refused';
  END IF;
  IF TG_OP = 'DELETE' THEN
    -- The cascade from a deleted house, and nothing else.
    IF EXISTS (SELECT 1 FROM public.restaurants WHERE id = OLD.restaurant_id) THEN
      RAISE EXCEPTION 'security_events is append-only: DELETE of seq % refused', OLD.seq;
    END IF;
    RETURN OLD;
  END IF;
  -- UPDATE: only the foreign key letting go of a person who no longer exists.
  IF NEW.actor_user_id IS NULL
     AND OLD.actor_user_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.users WHERE user_id = OLD.actor_user_id)
     AND NEW.id = OLD.id
     AND NEW.restaurant_id = OLD.restaurant_id
     AND NEW.seq = OLD.seq
     AND NEW.occurred_at = OLD.occurred_at
     AND NEW.kind = OLD.kind
     AND NEW.actor_ref IS NOT DISTINCT FROM OLD.actor_ref
     AND NEW.subject_kind = OLD.subject_kind
     AND NEW.subject_id IS NOT DISTINCT FROM OLD.subject_id
     AND NEW.detail = OLD.detail
     AND NEW.prev_hash IS NOT DISTINCT FROM OLD.prev_hash
     AND NEW.hash = OLD.hash THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'security_events is append-only: UPDATE of seq % refused', OLD.seq;
END;
$$;

DROP TRIGGER IF EXISTS trg_security_events_append_only ON public.security_events;
CREATE TRIGGER trg_security_events_append_only
  BEFORE UPDATE OR DELETE ON public.security_events
  FOR EACH ROW EXECUTE FUNCTION public.security_events_refuse_change();

DROP TRIGGER IF EXISTS trg_security_events_no_truncate ON public.security_events;
CREATE TRIGGER trg_security_events_no_truncate
  BEFORE TRUNCATE ON public.security_events
  FOR EACH STATEMENT EXECUTE FUNCTION public.security_events_refuse_change();

REVOKE ALL ON FUNCTION public.security_event_hash(TEXT, BIGINT, UUID, TEXT, TEXT, TEXT, UUID, TIMESTAMPTZ, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.append_security_event(UUID, TEXT, UUID, TEXT, UUID, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.security_events_verify_chain(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.security_events_refuse_change() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.security_event_hash(TEXT, BIGINT, UUID, TEXT, TEXT, TEXT, UUID, TIMESTAMPTZ, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.append_security_event(UUID, TEXT, UUID, TEXT, UUID, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.security_events_verify_chain(UUID) TO service_role;

-- ---------------------------------------------------------------------------
-- Assertions. A partial apply must fail here, not pass quietly.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  fk_target TEXT;
BEGIN
  IF to_regclass('public.security_events') IS NULL THEN
    RAISE EXCEPTION 'security_events was not created';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass('public.security_events')) THEN
    RAISE EXCEPTION 'security_events has RLS off';
  END IF;
  IF has_table_privilege('anon', 'public.security_events', 'SELECT')
     OR has_table_privilege('anon', 'public.security_events', 'INSERT')
     OR has_table_privilege('authenticated', 'public.security_events', 'SELECT')
     OR has_table_privilege('authenticated', 'public.security_events', 'INSERT')
  THEN
    RAISE EXCEPTION 'security_events is still reachable by anon/authenticated';
  END IF;
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
     AND kcu.table_name = 'security_events'
     AND kcu.column_name = 'actor_user_id'
   LIMIT 1;
  IF fk_target IS DISTINCT FROM 'public.users.user_id' THEN
    RAISE EXCEPTION 'security_events.actor_user_id must reference public.users(user_id), found %', coalesce(fk_target, 'no foreign key');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'trg_security_events_append_only'
       AND tgrelid = to_regclass('public.security_events')
  ) THEN
    RAISE EXCEPTION 'security_events has no append-only trigger';
  END IF;
  IF (SELECT prosecdef FROM pg_proc WHERE oid = 'public.append_security_event(uuid, text, uuid, text, uuid, jsonb)'::regprocedure) THEN
    RAISE EXCEPTION 'append_security_event must be SECURITY INVOKER';
  END IF;
  RAISE NOTICE 'security_events: created, locked down, append-only, one chain per house.';
END
$$;

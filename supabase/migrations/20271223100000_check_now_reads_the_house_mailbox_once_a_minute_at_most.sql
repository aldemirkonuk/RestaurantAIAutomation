-- 'Check now' reads the house's mailbox once, at most once a minute
-- (DD-r106-9 / DD-r108-47). Both rules live here, never in a gateway process,
-- because instances share no memory:
--  1. THE FLOOR: a press is refused inside 60 s of this grant's last read or
--     last accepted press (read_now_at, stamped by the claim itself).
--  2. THE LEASE: every read, the 5-minute run included, takes the grant's row
--     first with one conditional UPDATE; an overlapping read finds it held and
--     leaves the grant alone, so each Gmail message is filed once. The lease
--     expires on its own and is released only by the token that took it.
-- Same grants, scope and vendor-book bound; the claim reads no mail.

ALTER TABLE public.house_inbox_cursors
  ADD COLUMN IF NOT EXISTS read_now_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reading_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reading_token UUID;

COMMENT ON COLUMN public.house_inbox_cursors.read_now_at IS
  'When a person''s Check now was last accepted for this grant. The 60 s floor is measured from this and from last_read_at, in the database, because gateway instances do not share memory.';
COMMENT ON COLUMN public.house_inbox_cursors.reading_until IS
  'Set while a read holds this grant (the 5-minute run or a Check now). A second read that finds it in the future leaves the grant alone. It expires on its own, so a read that died does not hold the grant.';
COMMENT ON COLUMN public.house_inbox_cursors.reading_token IS
  'Which read holds the lease. Release clears the lease only for this token, so a read whose lease expired cannot clear the next one''s.';

-- Atomic: under READ COMMITTED a concurrent UPDATE of the row waits, then
-- re-checks the WHERE against the first one's write, so one claim wins.
-- Returns jsonb:
--   {"claimed": true,  "token": <uuid>}
--   {"claimed": false, "exists": false}            no cursor yet: first read seeds it
--   {"claimed": false, "exists": true, "busy": bool, "wait_seconds": int}
CREATE OR REPLACE FUNCTION public.house_inbox_claim_read(
  p_connection_id UUID,
  p_restaurant_id UUID,
  p_floor_seconds INTEGER,
  p_lease_seconds INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now TIMESTAMPTZ := clock_timestamp();
  v_token UUID := gen_random_uuid();
  v_won UUID;
  v_row public.house_inbox_cursors%ROWTYPE;
  v_since TIMESTAMPTZ;
BEGIN
  IF p_connection_id IS NULL OR p_restaurant_id IS NULL THEN
    RAISE EXCEPTION 'house_inbox_claim_read needs a grant and its house';
  END IF;
  IF p_floor_seconds IS NULL OR p_floor_seconds < 0
     OR p_lease_seconds IS NULL OR p_lease_seconds < 1 THEN
    RAISE EXCEPTION 'house_inbox_claim_read needs a floor >= 0 and a lease >= 1 second';
  END IF;

  UPDATE public.house_inbox_cursors AS c
     SET reading_until = v_now + make_interval(secs => p_lease_seconds),
         reading_token = v_token,
         read_now_at = CASE WHEN p_floor_seconds > 0 THEN v_now ELSE c.read_now_at END
   WHERE c.connection_id = p_connection_id
     AND c.restaurant_id = p_restaurant_id
     AND (c.reading_until IS NULL OR c.reading_until <= v_now)
     AND (
       p_floor_seconds = 0
       OR (
         (c.read_now_at IS NULL OR c.read_now_at <= v_now - make_interval(secs => p_floor_seconds))
         AND (c.last_read_at IS NULL OR c.last_read_at <= v_now - make_interval(secs => p_floor_seconds))
       )
     )
  RETURNING c.reading_token INTO v_won;

  IF v_won IS NOT NULL THEN
    RETURN jsonb_build_object('claimed', true, 'token', v_won);
  END IF;

  SELECT * INTO v_row
    FROM public.house_inbox_cursors AS c
   WHERE c.connection_id = p_connection_id
     AND c.restaurant_id = p_restaurant_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('claimed', false, 'exists', false);
  END IF;

  v_since := GREATEST(
    COALESCE(v_row.read_now_at, '-infinity'::timestamptz),
    COALESCE(v_row.last_read_at, '-infinity'::timestamptz)
  );
  RETURN jsonb_build_object(
    'claimed', false,
    'exists', true,
    'busy', v_row.reading_until IS NOT NULL AND v_row.reading_until > v_now,
    'wait_seconds', CASE
      WHEN p_floor_seconds = 0 OR v_since = '-infinity'::timestamptz THEN 0
      ELSE GREATEST(0, CEIL(EXTRACT(EPOCH FROM (v_since + make_interval(secs => p_floor_seconds) - v_now)))::INTEGER)
    END
  );
END;
$$;

COMMENT ON FUNCTION public.house_inbox_claim_read(UUID, UUID, INTEGER, INTEGER) IS
  'Takes one grant''s read lease atomically (floor 0 = the 5-minute run; floor 60 = a person''s Check now). Service role only. Reads no mail.';

REVOKE ALL ON FUNCTION public.house_inbox_claim_read(UUID, UUID, INTEGER, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.house_inbox_claim_read(UUID, UUID, INTEGER, INTEGER) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.house_inbox_claim_read(UUID, UUID, INTEGER, INTEGER) TO service_role;

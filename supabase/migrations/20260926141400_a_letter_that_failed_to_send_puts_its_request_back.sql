-- A released staff letter the dispatcher fails to send puts its request back
-- to waiting — the founder's answer of 2026-09-22 (round 6u) on ADR 0175's
-- stated gap, verbatim pick:
--   (3) "Back to waiting (Recommended)"
--
-- WHAT HE DECIDED
-- ---------------
-- The request returns to waiting in the manager's queue, with the failure
-- reason shown to the manager and to the staff member who asked. `released`
-- never stands on an unsent letter.
--
-- WHAT CHANGES ON vendor_send_requests (20260926140700, 20260926141100)
-- ---------------------------------------------------------------------
--   send_failed_count     how many times a letter released from this request
--                         failed to send, putting it back to waiting
--   last_send_failed_at   the latest such failure
--   last_send_failure     its reason, in the dispatcher's words
--   last_send_failed_by   who had released the letter that failed (the
--                         manager the reason is shown to), public.users
-- A failure is counted and dated together (CHECK). The request's own state
-- goes back to `waiting` in the same write the gateway makes
-- (VendorSendRequestsService.rewaitAfterFailedSend), conditional on the
-- request still being released by that letter.
--
-- Additive (nullable columns and a defaulted counter), idempotent, the actor
-- column on public.users(user_id), assertions at the bottom. RLS unchanged.

ALTER TABLE public.vendor_send_requests
  ADD COLUMN IF NOT EXISTS send_failed_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_send_failed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_send_failure TEXT,
  ADD COLUMN IF NOT EXISTS last_send_failed_by UUID REFERENCES public.users(user_id) ON DELETE SET NULL;

ALTER TABLE public.vendor_send_requests
  DROP CONSTRAINT IF EXISTS vendor_send_requests_send_failure_on_the_record;
ALTER TABLE public.vendor_send_requests
  ADD CONSTRAINT vendor_send_requests_send_failure_on_the_record
  CHECK (
    send_failed_count >= 0
    AND ((send_failed_count = 0) = (last_send_failed_at IS NULL))
    AND ((last_send_failed_at IS NULL) = (last_send_failure IS NULL))
    AND (last_send_failure IS NULL OR btrim(last_send_failure) <> '')
  );

COMMENT ON COLUMN public.vendor_send_requests.last_send_failure IS
  'Why the latest letter released from this request was not sent; the request went back to waiting (founder, 2026-09-22: "Back to waiting", ADR 0175). Shown to the managers and to the person who asked.';

DO $$
DECLARE
  c TEXT;
  fk_target TEXT;
BEGIN
  FOREACH c IN ARRAY ARRAY['send_failed_count', 'last_send_failed_at', 'last_send_failure', 'last_send_failed_by'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'vendor_send_requests' AND column_name = c
    ) THEN
      RAISE EXCEPTION 'vendor_send_requests.% was not added', c;
    END IF;
  END LOOP;
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
     AND kcu.table_name = 'vendor_send_requests'
     AND kcu.column_name = 'last_send_failed_by'
   LIMIT 1;
  IF fk_target IS DISTINCT FROM 'public.users.user_id' THEN
    RAISE EXCEPTION 'vendor_send_requests.last_send_failed_by must reference public.users(user_id), found %', coalesce(fk_target, 'no foreign key');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = to_regclass('public.vendor_send_requests')
       AND conname = 'vendor_send_requests_send_failure_on_the_record'
  ) THEN
    RAISE EXCEPTION 'vendor_send_requests has no send-failure-on-the-record CHECK';
  END IF;
  RAISE NOTICE 'vendor_send_requests: a failed send is counted, dated, said, and puts the request back to waiting.';
END
$$;

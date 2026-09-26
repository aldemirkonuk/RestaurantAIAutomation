-- A staff letter request can be declined or withdrawn, and a released letter
-- pulled back inside its undo window waits again — the founder's answer of
-- 2026-09-21 on ADR 0175's stated gap: *"Decline/withdraw; undo re-waits"*.
--
-- WHAT CHANGES ON vendor_send_requests (20260926140700)
-- -----------------------------------------------------
--   closed_how      declined | withdrawn | deal_dismissed — who closed it, in
--                   one word; `closed_reason` keeps the words (a manager's
--                   reason for a decline)
--   closed_by       the person who closed it (public.users); NULL only for a
--                   deal dismissed by a path that names nobody
--   closed_at       when
--   undone_count    how many times a released letter was pulled back inside
--                   the composer's undo window, putting the request back to
--                   waiting
--   last_undone_at, last_undone_by   the latest such pull-back, on the record
--
-- A closed row must say how and when (CHECK). The one closer that existed
-- before this file (`closeWaitingDeal`, closed_reason 'deal_dismissed') is
-- backfilled first, so the CHECK validates on any row already written.
--
-- Additive (nullable columns and a defaulted counter), idempotent, actor
-- columns on public.users(user_id), assertions at the bottom. RLS is
-- unchanged (on, service_role only, from 20260926140700).

ALTER TABLE public.vendor_send_requests
  ADD COLUMN IF NOT EXISTS closed_how TEXT,
  ADD COLUMN IF NOT EXISTS closed_by UUID REFERENCES public.users(user_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS undone_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_undone_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_undone_by UUID REFERENCES public.users(user_id) ON DELETE SET NULL;

-- The only closes written before this file.
UPDATE public.vendor_send_requests
   SET closed_how = 'deal_dismissed',
       closed_at = coalesce(closed_at, requested_at)
 WHERE state = 'closed'
   AND closed_how IS NULL
   AND closed_reason = 'deal_dismissed';

ALTER TABLE public.vendor_send_requests
  DROP CONSTRAINT IF EXISTS vendor_send_requests_closed_how_known;
ALTER TABLE public.vendor_send_requests
  ADD CONSTRAINT vendor_send_requests_closed_how_known
  CHECK (closed_how IS NULL OR closed_how IN ('declined', 'withdrawn', 'deal_dismissed'));

ALTER TABLE public.vendor_send_requests
  DROP CONSTRAINT IF EXISTS vendor_send_requests_close_on_the_record;
ALTER TABLE public.vendor_send_requests
  ADD CONSTRAINT vendor_send_requests_close_on_the_record
  CHECK ((state = 'closed') = (closed_how IS NOT NULL AND closed_at IS NOT NULL));

ALTER TABLE public.vendor_send_requests
  DROP CONSTRAINT IF EXISTS vendor_send_requests_undo_on_the_record;
ALTER TABLE public.vendor_send_requests
  ADD CONSTRAINT vendor_send_requests_undo_on_the_record
  CHECK (undone_count >= 0 AND ((undone_count = 0) = (last_undone_at IS NULL)));

COMMENT ON COLUMN public.vendor_send_requests.closed_how IS
  'declined (an owner or manager, with a reason) | withdrawn (the person who asked) | deal_dismissed. Founder, 2026-09-21: "Decline/withdraw; undo re-waits" (ADR 0175).';
COMMENT ON COLUMN public.vendor_send_requests.undone_count IS
  'Times a released letter was pulled back inside the composer''s undo window, which puts the request back to waiting (founder, 2026-09-21, ADR 0175).';

DO $$
DECLARE
  c TEXT;
  fk_target TEXT;
BEGIN
  FOREACH c IN ARRAY ARRAY['closed_how', 'closed_by', 'closed_at', 'undone_count', 'last_undone_at', 'last_undone_by'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'vendor_send_requests' AND column_name = c
    ) THEN
      RAISE EXCEPTION 'vendor_send_requests.% was not added', c;
    END IF;
  END LOOP;
  FOREACH c IN ARRAY ARRAY['closed_by', 'last_undone_by'] LOOP
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
       AND kcu.column_name = c
     LIMIT 1;
    IF fk_target IS DISTINCT FROM 'public.users.user_id' THEN
      RAISE EXCEPTION 'vendor_send_requests.% must reference public.users(user_id), found %', c, coalesce(fk_target, 'no foreign key');
    END IF;
  END LOOP;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = to_regclass('public.vendor_send_requests')
       AND conname = 'vendor_send_requests_close_on_the_record'
  ) THEN
    RAISE EXCEPTION 'vendor_send_requests has no close-on-the-record CHECK';
  END IF;
  RAISE NOTICE 'vendor_send_requests: a close says how, by whom and when; an undo is counted.';
END
$$;

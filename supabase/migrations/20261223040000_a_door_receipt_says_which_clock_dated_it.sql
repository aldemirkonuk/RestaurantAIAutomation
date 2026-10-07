-- A DOOR RECEIPT SAYS WHICH CLOCK DATED IT. ADR 0286.
--
-- THE RULING. The founder, 2026-10-04 (C02), verbatim pick: "72 h; older needs
-- a manager (Recommended)". A sent time within 72 hours of the server's
-- receipt is kept as the fact's time. An older one is kept only from an owner
-- or a manager and is marked back-dated. Applies to door receipts, counts and
-- orders.
--
-- WHAT BROKE. procurement_receipt_events.occurred_at was never written by the
-- door: it took its DEFAULT now(), the moment the receipt reached the server,
-- and procurement_orders.delivered_at took the gateway's `new Date()`. The
-- phone's own tap time was kept in client_captured_at and read by nothing. A
-- receipt taken offline and synced later was therefore dated on the day it
-- was entered: in the owner-quarter sim, the 100 newest of 549 door
-- deliveries read 2 October, 31-44 days after the tap times their phones
-- sent, and the vendor scorecard read 0 of 548 on time.
--
-- WHAT THIS FILE ADDS. Only the MARK. The gateway now writes occurred_at as
-- the fact's time (the phone's, under the rule, or the moment it received the
-- request when the phone's clock ran slightly ahead) and leaves it to DEFAULT
-- now() when the server's clock dates it. Which clock it was is the one thing
-- the times alone cannot say, so it gets a column:
--
--   'sent'        the phone's time, no more than 72 hours old; or, when the
--                 phone's clock was up to five minutes ahead of the gateway,
--                 the moment the gateway received the request (no fact is in
--                 the future), with the phone's later time kept beside it;
--   'back_dated'  the phone's time, older, on an owner's or a manager's word;
--   'server'      the server's time: nothing usable was sent, the phone's
--                 clock was more than five minutes ahead, or it was older and
--                 no one could vouch.
--   NULL          a row this rule did not date: a door receipt recorded
--                 before it, or a row the door does not write (verifyReceipt's
--                 'reconciled' events, which take DEFAULT now()). Nothing is
--                 re-dated (a backfill was declined: ADR 0286 follow-up 3).
--
-- A 'sent' or 'back_dated' row must carry the phone's time it was judged by
-- (client_captured_at; on a clamped 'sent' row that is the phone's later
-- time, not occurred_at): the mark is only auditable if the evidence sits
-- beside it. A 'server' row may or may not, since "nothing was sent" is one
-- of the reasons.
--
-- WHY NO TIME CHECK. The 72-hour rule is NOT a database constraint. The
-- gateway measures it against the moment it received the request, and the
-- gateway's and the database's clocks differ; a CHECK comparing occurred_at
-- with created_at would refuse honest rows on a few seconds of skew, and the
-- back-dated case is decided by a role the database is not told. ADR 0286.
--
-- SAFETY. A nullable column with no default: Postgres adds it in the catalog
-- and rewrites no row, so the append-only trigger (ADR 0227, BEFORE UPDATE /
-- DELETE and TRUNCATE) never fires. Each CHECK makes one validating scan, and
-- every existing row is NULL and passes. The ALTERs take ACCESS EXCLUSIVE on
-- procurement_receipt_events, which the door (its case counts) and
-- verifyReceipt (its 'reconciled' events) write and a handful of reads
-- touch; statement_timeout follows the repo's ALTER TABLE precedent
-- (a_google_place_id_is_as_long_as_google_makes_it). Re-runnable: the column
-- and each constraint are added only if absent. No explicit BEGIN/COMMIT: the
-- Supabase CLI wraps each file in a transaction. The closing DO block reads
-- the catalog only; it writes no row.

SET local statement_timeout = '120s';

ALTER TABLE public.procurement_receipt_events
  ADD COLUMN IF NOT EXISTS occurred_at_basis text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'procurement_receipt_events_occurred_at_basis_check'
       AND conrelid = to_regclass('public.procurement_receipt_events')
  ) THEN
    ALTER TABLE public.procurement_receipt_events
      ADD CONSTRAINT procurement_receipt_events_occurred_at_basis_check
      CHECK (
        occurred_at_basis IS NULL
        OR occurred_at_basis IN ('sent', 'back_dated', 'server')
      );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'procurement_receipt_events_occurred_at_basis_has_evidence'
       AND conrelid = to_regclass('public.procurement_receipt_events')
  ) THEN
    ALTER TABLE public.procurement_receipt_events
      ADD CONSTRAINT procurement_receipt_events_occurred_at_basis_has_evidence
      CHECK (
        occurred_at_basis IS NULL
        OR occurred_at_basis = 'server'
        OR client_captured_at IS NOT NULL
      );
  END IF;
END $$;

COMMENT ON COLUMN public.procurement_receipt_events.occurred_at_basis IS
  'Which clock dated occurred_at (ADR 0286). sent: the phone''s time (client_captured_at), no more than 72 hours before the gateway received the request; or, when the phone''s clock was up to five minutes ahead of the gateway, the moment the gateway received the request, earlier than the phone''s time kept in client_captured_at. back_dated: the phone''s time, older, kept on the word of an owner or a manager of the house the token named. server: the server''s own time (DEFAULT now(), equal to created_at), because nothing usable was sent, the phone clock was more than five minutes ahead, or the sent time was older than 72 hours from someone who may not back-date; client_captured_at still holds whatever was sent. NULL: a row this rule did not date, dated by the server (DEFAULT now()): a door receipt recorded before the rule, which is not re-dated, or a row the door does not write, such as verifyReceipt''s reconciled events.';

DO $$
BEGIN
  IF (SELECT format_type(a.atttypid, a.atttypmod)
        FROM pg_attribute a
       WHERE a.attrelid = 'public.procurement_receipt_events'::regclass
         AND a.attname = 'occurred_at_basis'
         AND NOT a.attisdropped) IS DISTINCT FROM 'text' THEN
    RAISE EXCEPTION 'procurement_receipt_events.occurred_at_basis is missing or not text';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_attribute a
     WHERE a.attrelid = 'public.procurement_receipt_events'::regclass
       AND a.attname = 'occurred_at_basis'
       AND (a.attnotnull OR a.atthasdef)
  ) THEN
    RAISE EXCEPTION 'procurement_receipt_events.occurred_at_basis must be nullable with no default (a pre-rule row is NULL, never guessed)';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'procurement_receipt_events_occurred_at_basis_check'
       AND conrelid = 'public.procurement_receipt_events'::regclass
       AND contype = 'c'
       AND convalidated
  ) THEN
    RAISE EXCEPTION 'procurement_receipt_events_occurred_at_basis_check is missing or not validated';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'procurement_receipt_events_occurred_at_basis_has_evidence'
       AND conrelid = 'public.procurement_receipt_events'::regclass
       AND contype = 'c'
       AND convalidated
  ) THEN
    RAISE EXCEPTION 'procurement_receipt_events_occurred_at_basis_has_evidence is missing or not validated';
  END IF;
  -- The door writes occurred_at itself now; the column must still default to
  -- the server clock for the 'server' case, where the gateway sends none.
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute a
     WHERE a.attrelid = 'public.procurement_receipt_events'::regclass
       AND a.attname = 'occurred_at'
       AND a.atthasdef
       AND a.attnotnull
  ) THEN
    RAISE EXCEPTION 'procurement_receipt_events.occurred_at lost its NOT NULL DEFAULT; a server-dated door receipt would be refused';
  END IF;
END $$;

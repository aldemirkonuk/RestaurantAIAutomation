-- A person's mail queues like the house's own — the founder's 2026-09-17
-- answer on the mailbox fork ADR 0118 D2 and the 2026-09-17 adversarial
-- review both raised (ADR 0149 #19, ADR 0147, ADR 0118 D2).
--
-- THE FORK THIS CLOSES
-- ---------------------
-- Earlier the same day, `POST /communications/email`'s person door was built
-- to send through the house's own connected mailbox (ADR 0118's `gmail_send`
-- grant) IMMEDIATELY, with no undo window. `GET /communications/letters/sender`
-- already told every caller — the composer AND this door, since both read the
-- same `HouseSenderService.resolve` — that a send from that mailbox carries a
-- server-side 2-minute undo window (`ceremony: "undo"`, `undoMs`, the sentence
-- at house-sender.service.ts:405-413). An immediate send from that mailbox
-- made that sentence false for this door's own callers. The founder's answer:
-- "the person door QUEUES like every other send from the house's own
-- mailbox" — so the two agree.
--
-- WHY A NEW TABLE, NOT `procurement_conversations`
-- --------------------------------------------------
-- The house letters composer already queues into `procurement_conversations`
-- (`status='HOUSE_QUEUED'`, ADR 0118 D2's own words) and a once-a-minute cron
-- dispatches it. That table cannot hold this door's queue: `provider_id` is
-- `NOT NULL` (baseline 20260805000000:8933) because every row there is a
-- conversation WITH A VENDOR, and the person door also reaches this house's
-- OWN MEMBERS with no vendor, no order, no conversation at all — ADR 0149 #19
-- reads "recipients limited to the house's members AND its vendors'
-- contacts". Forcing a member-addressed send through a vendor-shaped table
-- would mean either inventing a fake provider row (a lie the book and every
-- vendor-scoped read would then treat as real) or relaxing `provider_id` to
-- nullable on a table every procurement query assumes is vendor-shaped —
-- correctness risk with no bound, for a column this migration does not need
-- to touch. `relay_email_queue` is a second, door-agnostic queue wearing the
-- SAME status vocabulary and the SAME shape ADR 0118 D2 describes (a row, not
-- a timer; `status`, `scheduled_send_at`, a once-a-minute dispatcher) so the
-- two queues behave identically to a caller even though they are not the same
-- table.
--
-- WHAT IS STORED, AND WHY
-- ------------------------
-- `actor_user_id` is who queued it (`RelayEmailService.sendAsPerson`'s
-- caller) — the dispatcher re-resolves the sending identity FROM this id at
-- send time (`HouseSenderService.resolve`), exactly as
-- `HouseLettersService.dispatchDue` re-resolves from its own stored
-- `email_headers.written_by`, rather than trusting a grant or a token
-- captured at queue time that may have expired or been revoked
-- (ADR 0114) in the two minutes between.
-- `body_text` is the ALREADY-SIGNED text — the person's words plus the
-- `— {author name}` line `sendAsPerson` appends before queuing — so what a
-- manager approved when they hit send is exactly what leaves, not a
-- re-derived signature computed against whatever the name happens to read at
-- dispatch time.
-- `correlation_id` ties this row to the `system_audit_log` rows the relay
-- writes at each stage (`relay_email_queued` now, `relay_email_attempted` /
-- `relay_email_sent` / `relay_email_failed` when the dispatcher runs) so one
-- send's whole lifecycle shares one id, the same discipline
-- ADR 0149 #19 already applies to the immediate-send path.
--
-- NO NEW TABLE FOR THE UNDO ITSELF
-- ----------------------------------
-- Pulling a row back is `status='HOUSE_QUEUED'` -> `'HOUSE_CANCELLED'` on
-- THIS table, guarded the same way `HouseLettersService.cancel` guards its
-- own: only a row still queued and still before `scheduled_send_at` may move,
-- so a row the dispatcher may already hold can never be marked cancelled out
-- from under it.
--
-- RLS: SERVICE ROLE ONLY, LIKE `mcp_server_credentials`
-- --------------------------------------------------------
-- Every read and write of this table goes through `RelayEmailService`, which
-- holds the gateway's own service-role client — no browser or Supabase client
-- ever queries it directly, and the tenant check is enforced in that service
-- (`houseActor`, `restaurant_id` on every query), the same posture
-- `mcp_server_credentials` took (20260912200000).
--
-- Idempotent and safe to re-run. No explicit BEGIN/COMMIT: the Supabase CLI
-- wraps each migration file in a transaction.

-- ---------------------------------------------------------------------------
-- 1. The queue
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.relay_email_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,

  -- Who queued it. The dispatcher re-resolves the sending identity from THIS
  -- id, never from a grant or token captured at queue time — see header.
  actor_user_id UUID NOT NULL REFERENCES public.users(user_id) ON DELETE CASCADE,

  -- Optional context, exactly as the person door's own DTO carries it —
  -- nullable because a member-addressed send names none of these.
  provider_id UUID REFERENCES public.providers(id) ON DELETE SET NULL,
  conversation_id UUID REFERENCES public.procurement_conversations(id) ON DELETE SET NULL,
  order_id UUID REFERENCES public.procurement_orders(id) ON DELETE SET NULL,
  template_id UUID REFERENCES public.communication_templates(id) ON DELETE SET NULL,

  to_addresses TEXT[] NOT NULL,
  cc_addresses TEXT[] NOT NULL DEFAULT '{}',
  bcc_addresses TEXT[] NOT NULL DEFAULT '{}',
  reply_to TEXT,
  subject TEXT NOT NULL,
  -- The already-signed text (the person's words + the author line). See header.
  body_text TEXT NOT NULL,
  thread_id TEXT,
  in_reply_to TEXT,
  mail_references TEXT,

  -- Denormalised from `HouseSenderService.resolve` at queue time, so a queued
  -- row can be shown ("leaves from X, signed Y") without re-resolving.
  sender_kind TEXT NOT NULL,
  sender_address TEXT,
  author_name TEXT,

  -- HOUSE_SENDING is the dispatcher's own claim state (RelayEmailService.
  -- dispatchQueued), the same shape dispatchDue's `status: "SENDING"` claim
  -- uses on procurement_conversations -- except that table's `status` column
  -- carries no CHECK constraint at all, so the value never had to be
  -- declared. This one does, so it is declared: a row moves HOUSE_QUEUED ->
  -- HOUSE_SENDING the instant a dispatcher tick claims it (so a second tick,
  -- or a second gateway instance, cannot claim the same row twice), then ->
  -- SENT or HOUSE_FAILED. The dispatcher's own try/catch guarantees an
  -- ATTEMPT always moves on -- but if the terminal SENT/HOUSE_FAILED WRITE
  -- itself fails (the row's own update, not the provider call), the row is
  -- deliberately left HOUSE_SENDING rather than reported as a clean send or
  -- a recorded failure: RelayEmailService.dispatchQueued counts that in its
  -- own `statusUpdateErrors`, never folded into `sent`/`failed`, so a stuck
  -- row is never read as a completed one.
  status TEXT NOT NULL DEFAULT 'HOUSE_QUEUED'
    CHECK (status IN ('HOUSE_QUEUED', 'HOUSE_SENDING', 'HOUSE_CANCELLED', 'HOUSE_FAILED', 'SENT')),
  -- NULLABLE, matching procurement_conversations' own scheduled_send_at
  -- (baseline 20260805000000): the row's own terminal writes set it back to
  -- NULL (RelayEmailService.cancelQueued and dispatchQueued's SENT/HOUSE_FAILED
  -- updates all do), since a row that has left, was refused, or was pulled
  -- back has no due time left to state. Declared NOT NULL in the first cut
  -- of this migration -- before it shipped anywhere -- and every one of
  -- those writes was rejected with 23502 (found by a PGlite replay of the
  -- service's own writes; see relay-email.doors.spec.ts's dispatch/cancel
  -- cases for the runtime behaviour this now permits).
  scheduled_send_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  gmail_message_id TEXT,
  failure_reason TEXT,

  -- Ties this row to the system_audit_log rows the relay writes at each
  -- stage of the same send. See header.
  correlation_id TEXT NOT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Wave5 confirmer's residual (2026-09-18): dropping scheduled_send_at's NOT
-- NULL (above) removed the one invariant that column ever enforced. No code
-- path can write a HOUSE_QUEUED row with a null due time today --
-- `queueForHouse` refuses a NaN `dispatchAt` (relay-email.service.ts:470) --
-- but nothing in the SCHEMA says so any more, and a future writer would not
-- be told. Restated as a CHECK instead of NOT NULL, so it constrains only
-- the state that actually needs a due time: a row still HOUSE_QUEUED must
-- have one; HOUSE_SENDING/SENT/HOUSE_CANCELLED/HOUSE_FAILED (all of which
-- null this column out on the same write that leaves HOUSE_QUEUED) do not.
-- Guarded by an existence check, not `ADD CONSTRAINT IF NOT EXISTS`, so this
-- stays idempotent on Postgres versions before that syntax existed.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'relay_email_queue_queued_has_due_time'
  ) THEN
    ALTER TABLE public.relay_email_queue
      ADD CONSTRAINT relay_email_queue_queued_has_due_time
      CHECK (status <> 'HOUSE_QUEUED' OR scheduled_send_at IS NOT NULL);
  END IF;
END
$$;

-- The dispatcher's own read: what is due, oldest first.
CREATE INDEX IF NOT EXISTS idx_relay_email_queue_due
  ON public.relay_email_queue (status, scheduled_send_at);

-- A house's own queued/sent history, newest first (a future `GET .../queued`
-- mirroring the letters composer's own route would read off this index).
CREATE INDEX IF NOT EXISTS idx_relay_email_queue_house
  ON public.relay_email_queue (restaurant_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- 2. Lock it down in the SAME migration that creates it (OD-72 / OD-73).
-- ---------------------------------------------------------------------------

ALTER TABLE public.relay_email_queue ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS relay_email_queue_service_role
  ON public.relay_email_queue;
CREATE POLICY relay_email_queue_service_role
  ON public.relay_email_queue
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.relay_email_queue FROM anon, authenticated;

COMMENT ON TABLE public.relay_email_queue IS
  'The person door''s own send queue (ADR 0149 #19, ADR 0118 D2, founder 2026-09-17): a send from the house''s own connected mailbox is a HOUSE_QUEUED row with scheduled_send_at = now + undoMs, cancellable until then, dispatched by a once-a-minute cron. Door-agnostic sibling of procurement_conversations'' own HOUSE_QUEUED rows (the letters composer''s queue) — a separate table because provider_id is NOT NULL there and this door also reaches the house''s own members, with no vendor at all. RLS on, service_role only: every query runs through RelayEmailService with its own tenant check.';
COMMENT ON COLUMN public.relay_email_queue.actor_user_id IS
  'Who queued it. The dispatcher RE-RESOLVES the sending identity from this id at send time (HouseSenderService.resolve) rather than trusting a grant captured at queue time, mirroring HouseLettersService.dispatchDue''s written_by re-resolve.';
COMMENT ON COLUMN public.relay_email_queue.body_text IS
  'The ALREADY-SIGNED text: the person''s words plus the "— {author name}" line sendAsPerson appends before queuing. What a manager approved is exactly what leaves; the signature is not re-derived at dispatch time.';
COMMENT ON COLUMN public.relay_email_queue.correlation_id IS
  'Shared with the system_audit_log rows this send writes at every stage (relay_email_queued, then relay_email_attempted / _sent / _failed once the dispatcher runs), so one send''s whole lifecycle carries one id.';
COMMENT ON COLUMN public.relay_email_queue.status IS
  'HOUSE_QUEUED (waiting, cancellable) -> HOUSE_SENDING (claimed by a dispatcher tick, never cancellable) -> SENT, or HOUSE_CANCELLED (pulled back before the window closed, from HOUSE_QUEUED only), or HOUSE_FAILED (the provider refused, or the sending identity was no longer usable when the dispatcher re-resolved it). The literal words are shared with procurement_conversations'' own LETTER_STATUS — same vocabulary, ADR 0118 D2 — but this is a different table; a query must never assume the two share rows.';
COMMENT ON COLUMN public.relay_email_queue.scheduled_send_at IS
  'NULLABLE, matching procurement_conversations'' own column: cancelQueued and dispatchQueued''s SENT/HOUSE_FAILED updates all set this back to NULL on a row''s terminal write, since a row that left, was refused or was pulled back has no due time left to state. Do not make this NOT NULL again -- it was, in this migration''s first cut, and every one of those three terminal writes was rejected with 23502.';

-- ---------------------------------------------------------------------------
-- 3. Assert the outcome rather than reporting success.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  missing_cols text;
  c           text;
  expected    text[] := ARRAY[
    'id', 'restaurant_id', 'actor_user_id', 'provider_id', 'conversation_id',
    'order_id', 'template_id', 'to_addresses', 'cc_addresses', 'bcc_addresses',
    'reply_to', 'subject', 'body_text', 'thread_id', 'in_reply_to',
    'mail_references', 'sender_kind', 'sender_address', 'author_name',
    'status', 'scheduled_send_at', 'sent_at', 'gmail_message_id',
    'failure_reason', 'correlation_id', 'created_at'
  ];
  missing     text[] := ARRAY[]::text[];
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'relay_email_queue'
  ) THEN
    RAISE EXCEPTION 'relay_email_queue was not created';
  END IF;

  FOREACH c IN ARRAY expected LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'relay_email_queue'
        AND column_name = c
    ) THEN
      missing := missing || c;
    END IF;
  END LOOP;

  IF array_length(missing, 1) IS NOT NULL THEN
    missing_cols := array_to_string(missing, ', ');
    RAISE EXCEPTION 'relay_email_queue is missing columns: %', missing_cols;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'relay_email_queue'
      AND c.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'relay_email_queue does not have row level security enabled';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'relay_email_queue'
      AND policyname = 'relay_email_queue_service_role'
  ) THEN
    RAISE EXCEPTION 'relay_email_queue has no service_role policy';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'relay_email_queue_queued_has_due_time'
  ) THEN
    RAISE EXCEPTION 'relay_email_queue is missing relay_email_queue_queued_has_due_time';
  END IF;

  RAISE NOTICE 'relay_email_queue: created, indexed, RLS locked to service_role.';
END
$$;

-- A house chooses which connected mailbox its letters leave from, and can
-- test that a letter reaches its Mudavym address (founder /goal 2026-11-07:
-- "check if the email comes and how, which email do we select, how do we
-- prepare that, the portal that leads to there").
--
-- WHAT THIS FILE ADDS
-- -------------------
--   1. `house_mail_sender_choice` — at most one row per house: the sending
--      grant (`integration_oauth_connections.id`) the owner or manager picked.
--      The grant itself stays where it is; this is only a pointer to it, so a
--      revoked or deleted grant needs no second clean-up (the resolver ignores
--      a pointer to a grant that no longer sends, and ON DELETE CASCADE drops
--      a pointer to a deleted one). With no row, the resolver keeps its old
--      rule (the asker's own grant, else another live one).
--   2. `mail_setup_checks` — one row per "send a test letter": the code the
--      owner puts in the subject, the address it goes to, and when (and from
--      whom) it arrived. Arrival is written by the inbound webhook only when
--      the address it was sent to belongs to the same house as the check.
--
-- TENANT SCOPE
-- ------------
-- Both tables carry `restaurant_id NOT NULL`. A choice may only point at a
-- grant of the SAME house: the trigger below refuses anything else, so a
-- service bug cannot make one house send through another house's mailbox.
-- RLS is on, service_role only, anon and authenticated revoked — the same
-- shape as `integration_oauth_connections` (20260826170000), because every
-- read and write goes through the gateway, which takes the house from the
-- signed token.
--
-- Additive and idempotent: two new tables, no existing column touched.

CREATE TABLE IF NOT EXISTS public.house_mail_sender_choice (
  restaurant_id UUID PRIMARY KEY REFERENCES public.restaurants(id) ON DELETE CASCADE,
  connection_id UUID NOT NULL REFERENCES public.integration_oauth_connections(id) ON DELETE CASCADE,
  -- SET NULL: a manager who leaves does not take the house's choice with them.
  chosen_by UUID REFERENCES public.users(user_id) ON DELETE SET NULL,
  chosen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION public.house_mail_sender_choice_same_house()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.integration_oauth_connections c
    WHERE c.id = NEW.connection_id AND c.restaurant_id = NEW.restaurant_id
  ) THEN
    RAISE EXCEPTION 'a house may only choose one of its own mailboxes'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS house_mail_sender_choice_same_house ON public.house_mail_sender_choice;
CREATE TRIGGER house_mail_sender_choice_same_house
  BEFORE INSERT OR UPDATE ON public.house_mail_sender_choice
  FOR EACH ROW EXECUTE FUNCTION public.house_mail_sender_choice_same_house();

CREATE TABLE IF NOT EXISTS public.mail_setup_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  -- Eight letters and digits with no look-alikes (no 0/O, 1/I), so it can be
  -- typed back from a phone; the webhook finds it in the subject.
  code TEXT NOT NULL CHECK (code ~ '^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$'),
  address TEXT NOT NULL,
  started_by UUID REFERENCES public.users(user_id) ON DELETE SET NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  arrived_at TIMESTAMPTZ,
  arrived_from TEXT,
  UNIQUE (restaurant_id, code),
  CHECK ((arrived_at IS NULL) = (arrived_from IS NULL))
);

-- Serves "the newest check for this house".
CREATE INDEX IF NOT EXISTS idx_mail_setup_checks_house_started
  ON public.mail_setup_checks (restaurant_id, started_at DESC);

ALTER TABLE public.house_mail_sender_choice ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS house_mail_sender_choice_service_role ON public.house_mail_sender_choice;
CREATE POLICY house_mail_sender_choice_service_role ON public.house_mail_sender_choice
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.house_mail_sender_choice FROM anon, authenticated;

ALTER TABLE public.mail_setup_checks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mail_setup_checks_service_role ON public.mail_setup_checks;
CREATE POLICY mail_setup_checks_service_role ON public.mail_setup_checks
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.mail_setup_checks FROM anon, authenticated;

REVOKE ALL ON FUNCTION public.house_mail_sender_choice_same_house() FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.house_mail_sender_choice IS
  'Which of its own sending grants a house''s letters leave from, chosen by an owner or manager. A pointer only; the grant stays in integration_oauth_connections. RLS on, service_role only.';
COMMENT ON TABLE public.mail_setup_checks IS
  'A test letter the house sends to its Mudavym address, and when it arrived. Written by the gateway only. RLS on, service_role only.';

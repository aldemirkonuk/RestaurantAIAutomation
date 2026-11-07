-- One receipt verification at a time per order (QA round 5 on the H-1 fix,
-- 2026-11-07).
--
-- `ProcurementService.verifyReceipt` makes some twenty PostgREST calls, each
-- its own transaction: it reads the order, compares, then writes a
-- `reconciled` receipt event, the ledger correction, a credit claim, the
-- order's verdict and a price-history row. Its repeat guard
-- (`repeatsTheLatestVerification`, shelf-received.ts) reads what an earlier
-- verification recorded -- so two submits that RACE both read "never
-- verified", both pass, and both write. Re-tested on the H-1 branch: two
-- concurrent verifies wrote 2 events, 2 price-history rows and 2 order
-- updates; only the claim was held, by `uq_pc_order_match_reason`.
--
-- A row lock (SELECT ... FOR UPDATE) lives only as long as one transaction,
-- and this flow is twenty of them, so the lock is held as a LEASE: one row per
-- order naming who holds it and until when. `take_receipt_verification_lease`
-- takes it atomically (INSERT ... ON CONFLICT DO UPDATE ... WHERE the old
-- lease has lapsed: a second caller waits on the first's row lock, then finds
-- the lease live and is told 'busy'). The service waits a few seconds for a
-- busy lease, then reads the order the first verification left -- so the
-- repeat guard sees it -- and deletes its own row (by token) when it is done.
-- A gateway that dies mid-verification strands nothing for longer than the
-- lease's own seconds.
--
-- Rejected: an idempotency key on the `reconciled` event. Keyed on the
-- order's last verification time it strands an order forever when the event
-- lands and a later step fails (every retry collides); keyed on the previous
-- event it lets a submit that starts between the first's event and its order
-- update through. Rejected: one RPC doing the whole verification -- a
-- rewrite of the receiving path, not a lock.
--
-- Locked down in this same migration (check_new_tables_are_locked_down.py):
-- RLS on, a service_role policy, nothing for anon or authenticated, and the
-- function callable by service_role only.

CREATE TABLE IF NOT EXISTS public.receipt_verification_leases (
  order_id uuid PRIMARY KEY
    REFERENCES public.procurement_orders(id) ON DELETE CASCADE,
  restaurant_id uuid NOT NULL
    REFERENCES public.restaurants(id) ON DELETE CASCADE,
  token uuid NOT NULL,
  held_until timestamptz NOT NULL,
  taken_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.receipt_verification_leases IS
  'Who is verifying an order''s delivery right now, and until when (QA round 5 on H-1). One row per order; verifyReceipt takes it through take_receipt_verification_lease and deletes it by token when done. A lapsed row is taken over.';

ALTER TABLE public.receipt_verification_leases ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS receipt_verification_leases_service_role
  ON public.receipt_verification_leases;
CREATE POLICY receipt_verification_leases_service_role
  ON public.receipt_verification_leases
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.receipt_verification_leases FROM anon, authenticated;
-- Stated, not left to the platform's default ACL: the gateway (service_role)
-- takes the lease through the invoker function below and deletes it by token.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.receipt_verification_leases TO service_role;

CREATE OR REPLACE FUNCTION public.take_receipt_verification_lease(
  p_restaurant_id uuid,
  p_order_id uuid,
  p_token uuid,
  p_seconds integer
)
RETURNS text
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_taken boolean;
BEGIN
  IF p_restaurant_id IS NULL OR p_order_id IS NULL OR p_token IS NULL THEN
    RAISE EXCEPTION 'take_receipt_verification_lease needs a restaurant, an order and a token';
  END IF;
  IF p_seconds IS NULL OR p_seconds < 1 OR p_seconds > 600 THEN
    RAISE EXCEPTION 'take_receipt_verification_lease: a lease is 1 to 600 seconds, not %', p_seconds;
  END IF;

  -- Only an order of this house can be leased by it.
  PERFORM 1 FROM public.procurement_orders
   WHERE id = p_order_id AND restaurant_id = p_restaurant_id;
  IF NOT FOUND THEN
    RETURN 'no_order';
  END IF;

  INSERT INTO public.receipt_verification_leases AS l
    (order_id, restaurant_id, token, held_until)
  VALUES
    (p_order_id, p_restaurant_id, p_token,
     now() + make_interval(secs => p_seconds))
  ON CONFLICT (order_id) DO UPDATE
    SET token = EXCLUDED.token,
        restaurant_id = EXCLUDED.restaurant_id,
        held_until = EXCLUDED.held_until,
        taken_at = now()
    WHERE l.held_until < now()
  RETURNING true INTO v_taken;

  RETURN CASE WHEN v_taken THEN 'taken' ELSE 'busy' END;
END
$$;

COMMENT ON FUNCTION public.take_receipt_verification_lease(uuid, uuid, uuid, integer) IS
  'Take the one-at-a-time lease on verifying an order''s delivery: ''taken'', ''busy'' (someone else holds a live lease) or ''no_order'' (not this house''s order). Atomic: a racing second caller waits on the first''s row and is told busy.';

REVOKE ALL ON FUNCTION public.take_receipt_verification_lease(uuid, uuid, uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.take_receipt_verification_lease(uuid, uuid, uuid, integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.take_receipt_verification_lease(uuid, uuid, uuid, integer) TO service_role;

-- Proof, in the migration itself, that what it promises holds.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = 'receipt_verification_leases'
       AND c.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'receipt_verification_leases must have row level security on';
  END IF;
  IF pg_catalog.has_function_privilege('anon', 'public.take_receipt_verification_lease(uuid, uuid, uuid, integer)', 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', 'public.take_receipt_verification_lease(uuid, uuid, uuid, integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'take_receipt_verification_lease must not be callable by anon or authenticated';
  END IF;
END
$$;

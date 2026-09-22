-- ADR 0143: an operator is a SQL-only grant AND an active Studio developer.
-- No application role can grant, update or revoke this flag. No user is seeded.
BEGIN;

CREATE TABLE IF NOT EXISTS public.platform_operator_grants (
  user_id uuid PRIMARY KEY REFERENCES public.users(user_id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  granted_at timestamptz NOT NULL DEFAULT now(),
  -- Who ran the SQL. Required, so a grant can never be anonymous. RESTRICT: the person
  -- who gave platform authority cannot be deleted out from under the grant.
  granted_by uuid NOT NULL REFERENCES public.users(user_id) ON DELETE RESTRICT,
  reason text NOT NULL CHECK (length(trim(reason)) > 0),
  -- A revocation is kept on the row rather than deleting it. A later re-grant is an
  -- UPDATE that clears both columns, so only the latest cycle is on the row.
  revoked_at timestamptz,
  revoked_by uuid REFERENCES public.users(user_id) ON DELETE RESTRICT,
  CONSTRAINT platform_operator_grants_revocation_complete
    CHECK ((revoked_at IS NULL) = (revoked_by IS NULL)),
  CONSTRAINT platform_operator_grants_revoked_is_disabled
    CHECK (revoked_at IS NULL OR NOT enabled)
);
ALTER TABLE public.platform_operator_grants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.platform_operator_grants FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.platform_operator_grants TO service_role;
COMMENT ON TABLE public.platform_operator_grants IS
  'SQL-only platform authority. The gateway also requires an unrevoked Studio developer role on every operation. No HTTP writer exists.';

CREATE TABLE IF NOT EXISTS public.platform_agent_operations (
  id uuid PRIMARY KEY,
  -- RESTRICT, as for the other accountability columns (confirmed_by, withdrawn_by,
  -- retired_by): a receipt for a platform-wide restart keeps the name of who ran it,
  -- so deleting that user fails until the receipts are dealt with deliberately.
  actor_id uuid NOT NULL REFERENCES public.users(user_id) ON DELETE RESTRICT,
  agent_name text NOT NULL,
  action text NOT NULL CHECK (action IN ('restart', 'stop')),
  -- requested: written before dispatch. running: written by the gateway's
  -- reconcile() (agent-operations.controller.ts, inside reconcile) when it reads
  -- the orchestrator's in-flight record for a still-pending 'requested' or
  -- 'unknown' receipt -- health_routes.py's operate_agent writes that record
  -- pre-dispatch, via _record_operation(..., "running"). The POST route itself
  -- (operate() / verdictFromAnswer) is still synchronous and never sets this
  -- status directly. unknown: no answer established the outcome.
  status text NOT NULL CHECK (status IN ('requested', 'running', 'succeeded', 'failed', 'unknown')),
  requested_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  error_code text
);
ALTER TABLE public.platform_agent_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.platform_agent_operations FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON public.platform_agent_operations TO service_role;
CREATE INDEX IF NOT EXISTS platform_agent_operations_recent ON public.platform_agent_operations (requested_at DESC);
COMMENT ON TABLE public.platform_agent_operations IS
  'Platform lifecycle receipts; no house data, credentials or raw service exceptions. Requested is written before dispatch. Unknown means the remote outcome was not established; the gateway settles it from the orchestrator''s record of the request id when that record exists.';

DO $$ BEGIN
  IF has_table_privilege('service_role', 'public.platform_operator_grants', 'INSERT')
    OR has_table_privilege('service_role', 'public.platform_operator_grants', 'UPDATE')
    OR has_table_privilege('service_role', 'public.platform_operator_grants', 'DELETE')
    OR has_table_privilege('authenticated', 'public.platform_operator_grants', 'SELECT')
    OR has_table_privilege('anon', 'public.platform_operator_grants', 'SELECT') THEN
    RAISE EXCEPTION 'Platform authority must be writable only through privileged SQL';
  END IF;
  IF has_table_privilege('authenticated', 'public.platform_agent_operations', 'SELECT')
    OR has_table_privilege('anon', 'public.platform_agent_operations', 'SELECT')
    OR has_table_privilege('service_role', 'public.platform_agent_operations', 'DELETE') THEN
    RAISE EXCEPTION 'Platform operation receipts are read and written only by the gateway, and never deleted by it';
  END IF;
END $$;
COMMIT;

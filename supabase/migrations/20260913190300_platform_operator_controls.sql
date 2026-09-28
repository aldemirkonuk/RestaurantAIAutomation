-- ADR 0143: an operator is a SQL-only grant AND an active Studio developer.
-- No application role can grant, update or revoke this flag. No user is seeded.
BEGIN;

CREATE TABLE public.platform_operator_grants (
  user_id uuid PRIMARY KEY REFERENCES public.users(user_id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  granted_at timestamptz NOT NULL DEFAULT now(),
  reason text NOT NULL CHECK (length(trim(reason)) > 0)
);
ALTER TABLE public.platform_operator_grants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.platform_operator_grants FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.platform_operator_grants TO service_role;
COMMENT ON TABLE public.platform_operator_grants IS
  'SQL-only platform authority. The gateway also requires an unrevoked Studio developer role on every operation. No HTTP writer exists.';

CREATE TABLE public.platform_agent_operations (
  id uuid PRIMARY KEY,
  actor_id uuid NOT NULL REFERENCES public.users(user_id),
  agent_name text NOT NULL,
  action text NOT NULL CHECK (action IN ('restart', 'stop')),
  status text NOT NULL CHECK (status IN ('requested', 'succeeded', 'failed', 'unknown')),
  requested_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  error_code text
);
ALTER TABLE public.platform_agent_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.platform_agent_operations FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON public.platform_agent_operations TO service_role;
CREATE INDEX platform_agent_operations_recent ON public.platform_agent_operations (requested_at DESC);
COMMENT ON TABLE public.platform_agent_operations IS
  'Platform lifecycle receipts; no house data, credentials or raw service exceptions. Requested is written before dispatch. Unknown means the remote outcome was not established.';

DO $$ BEGIN
  IF has_table_privilege('service_role', 'public.platform_operator_grants', 'INSERT')
    OR has_table_privilege('service_role', 'public.platform_operator_grants', 'UPDATE')
    OR has_table_privilege('authenticated', 'public.platform_operator_grants', 'SELECT')
    OR has_table_privilege('anon', 'public.platform_operator_grants', 'SELECT') THEN
    RAISE EXCEPTION 'Platform authority must be writable only through privileged SQL';
  END IF;
END $$;
COMMIT;

-- Contributor trust is earned by the server's approved-override workflow.
-- OD72 revoked named client roles, but their inherited PUBLIC EXECUTE remained.
-- Keep the existing function and service caller; close the effective privilege.
BEGIN;

REVOKE ALL ON FUNCTION public.increment_trust_counter(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_trust_counter(uuid) TO service_role;

-- Check effective privileges (including inherited grants), not just ACL text.
-- These are catalog reads; the trust counter is never invoked by the migration.
DO $$
BEGIN
  IF has_function_privilege('anon', 'public.increment_trust_counter(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.increment_trust_counter(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'increment_trust_counter must not be executable by client roles';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.increment_trust_counter(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'increment_trust_counter must remain executable by service_role';
  END IF;
END;
$$;

COMMIT;

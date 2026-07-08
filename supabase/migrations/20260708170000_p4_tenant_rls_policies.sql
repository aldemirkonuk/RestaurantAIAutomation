-- Phase 4 — full per-tenant RLS (defense-in-depth) + nightly isolation assertion.
-- See .planning/PROSPECTS_ATTRIBUTION_ARCHITECTURE.md §5 (Phase 4).
--
-- These six tables already have RLS ENABLED with ZERO policies, which means: anon/authenticated
-- clients get no rows (deny-by-default) and the service-role client (used by the api-gateway)
-- bypasses RLS. The app therefore reads/writes exclusively via service-role and is UNAFFECTED by
-- the policies below. What this migration adds is the SAME user_restaurant_access-based tenant
-- isolation the rest of the schema already uses (e.g. provider_locations), so that ANY future
-- authenticated-client access is correctly tenant-scoped instead of silently denied. Non-breaking.
--
-- Note: email_prospects/conversation_attachments rows with restaurant_id IS NULL (the operator-only
-- triage bucket) are intentionally invisible to tenant members and are served solely via the
-- service-role operator endpoints.

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'providers',
    'procurement_conversations',
    'email_prospects',
    'sender_reputation',
    'conversation_attachments',
    'restaurant_inbound_addresses'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I;', t || '_restaurant_access', t);
    -- FOR ALL with USING only: Postgres reuses the USING expression as the INSERT WITH CHECK,
    -- matching the established provider_locations policy shape exactly.
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL USING (' ||
        'restaurant_id IN (SELECT restaurant_id FROM public.user_restaurant_access WHERE user_id = auth.uid())' ||
      ');',
      t || '_restaurant_access', t
    );
  END LOOP;
END $$;

-- ── Nightly cross-tenant integrity assertion ────────────────────────────────────
-- Returns a jsonb report; all violation counts should be 0 in a healthy system. Called by the
-- api-gateway nightly cron (ScheduledTasksService.checkTenantIsolation), which logs a warning
-- when any *_orphaned count is non-zero. `provider_email_cross_tenant` is informational only
-- (in true multi-tenant, two restaurants may legitimately share a vendor domain).
CREATE OR REPLACE FUNCTION public.tenant_isolation_report()
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  SELECT jsonb_build_object(
    'checked_at', now(),
    'restaurants', (SELECT count(*) FROM public.restaurants),
    'prospects_orphaned', (
      SELECT count(*) FROM public.email_prospects ep
      WHERE ep.restaurant_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM public.restaurants r WHERE r.id = ep.restaurant_id)
    ),
    'prospects_triage_open', (
      SELECT count(*) FROM public.email_prospects
      WHERE restaurant_id IS NULL AND status = 'new'
    ),
    'prospects_distinct_restaurants', (
      SELECT count(DISTINCT restaurant_id) FROM public.email_prospects WHERE restaurant_id IS NOT NULL
    ),
    'inbound_addr_orphaned', (
      SELECT count(*) FROM public.restaurant_inbound_addresses a
      WHERE NOT EXISTS (SELECT 1 FROM public.restaurants r WHERE r.id = a.restaurant_id)
    ),
    'provider_email_cross_tenant', (
      SELECT count(*) FROM (
        SELECT lower(contact_email) AS e
        FROM public.providers
        WHERE contact_email IS NOT NULL AND contact_email <> '' AND deleted_at IS NULL
        GROUP BY lower(contact_email)
        HAVING count(DISTINCT restaurant_id) > 1
      ) x
    )
  );
$$;

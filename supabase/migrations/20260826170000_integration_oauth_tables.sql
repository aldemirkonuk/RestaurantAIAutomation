-- Third-party integration authorization (Google Drive, Microsoft Excel/OneDrive).
--
-- Promoted from supabase/migrations_archive/20260730120000_integration_oauth_connections.sql,
-- which was never applied and never captured by the 2026-08-05
-- `baseline_from_production` snapshot (it is dated before it). The archived DDL
-- is carried over unchanged where it was right; the security half is new. See
-- "What the archive got wrong" below.
--
--
-- The defect this closes — verified against production 2026-08-26
-- ----------------------------------------------------------------
-- Neither table exists. Both return PGRST205 "Could not find the table
-- 'public.<name>' in the schema cache" to the SERVICE-ROLE key, not just to
-- anon — measured with a live GET before this migration was written.
--
-- Meanwhile `IntegrationsModule` is wired into `AppModule` (app.module.ts:106)
-- and every route under `@Controller("integrations/oauth")` is live and
-- guarded. So the Drive/Excel connect flow completes the full round trip at
-- Google or Microsoft — the user sees a real consent screen and approves real
-- scopes — and then fails on the write at
-- integrations-oauth.service.ts:145 (state insert) or :434 (connection
-- upsert). Nobody has ever successfully connected anything.
--
-- Fifth instance of one defect class in a single day: a migration living
-- outside `supabase/migrations/` that production never saw
-- (`restaurant_feature_flags`, `scheduled_reports`,
-- `restaurant_inbound_addresses`, `push_subscriptions`, and this).
--
--
-- The schema is the CODE's contract, checked call site by call site
-- ------------------------------------------------------------------
-- The archived file was not trusted; it was diffed against all 10 call sites
-- in apps/api-gateway/src/integrations/integrations-oauth.service.ts
-- (lines 146, 323, 435, 465, 478, 512, 534, 586, 632, 651). Production must
-- satisfy the code, not the other way round. What that check confirmed:
--
--   * `users(user_id)` and `restaurants(id)` are the real primary keys in
--     production (uuid both) — the archived FKs resolve. Verified against
--     pg_constraint, not assumed from the repo's schema files.
--   * Every column read or written by the service exists here, with the
--     nullability the code depends on: `disconnect` (:534) NULLs
--     access_token_encrypted / refresh_token_encrypted / token_expires_at, so
--     those three MUST stay nullable, and `fetchAccountEmail` can legitimately
--     return null for account_email.
--   * `UNIQUE (user_id, integration_id)` is load-bearing and must stay
--     NON-partial. storeConnection (:436) is a PostgREST upsert with
--     `onConflict: "user_id,integration_id"`, which emits
--     `ON CONFLICT (user_id, integration_id) DO UPDATE`. Postgres matches that
--     only to a unique index on exactly those columns with NO predicate. An
--     "improvement" to `UNIQUE ... WHERE revoked_at IS NULL` — tempting, since
--     revocation is soft — would break the upsert outright, and the
--     disconnect→reconnect path depends on the conflict firing on the revoked
--     row so it can be resurrected with `revoked_at = null`. Asserted below.
--   * The CHECK on `provider` matches IntegrationProvider exactly
--     ("google" | "microsoft", integrations-oauth.constants.ts:1) and
--     VARCHAR(64) accommodates both IntegrationId values ("google_drive",
--     "excel", :2).
--
--
-- What the archive got wrong: it had no security half at all
-- -----------------------------------------------------------
-- The archived file ends at COMMENT ON TABLE. No `enable row level security`,
-- no policy, no REVOKE, no assertion. Applied as written it would have created
-- the twelfth RLS-off table in `public` — precisely the shape OD-73 spent a
-- migration closing, and on the worst possible table, because this one stores
-- `access_token_encrypted` and `refresh_token_encrypted`.
--
-- Being exact about the severity rather than overstating it: OD-72
-- (20260825210000) already ran `alter default privileges in schema public
-- revoke all on tables from anon, authenticated` for `postgres`, and
-- migrations run as `postgres` (verified: current_user = postgres). So a table
-- created today inherits `{postgres, service_role}` and no anon grant on its
-- own. Had this migration landed on its original 2026-07-30 date it would have
-- been a live leak of OAuth refresh tokens to the publishable anon key; landing
-- today it is saved by ordering luck, not by anything in the file.
--
-- Ordering luck is not a control. The REVOKE below is explicit and
-- order-independent, so the guarantee does not depend on OD-72 having run
-- first, on this file's position in the directory, or on `supabase_admin` —
-- whose default ACL still grants anon `arwdDxtm` and which we cannot alter —
-- never owning a future table here. On 2026-08-26 `master_wine_library` was
-- found serving 4,094 rows to that key. A refresh-token store must not become
-- the sixth entry in that list.
--
-- The shape below is copied from 20260825200000_od73_close_anon_dml.sql:
--   1. RLS ON — the house convention, 205 of 206 tables.
--   2. An EXPLICIT service_role policy rather than closed-by-absence. A table
--      with RLS and zero policies is closed only until someone adds the first
--      policy, at which point it silently opens to whatever that policy says.
--      Naming service_role's access makes the next policy an addition to a
--      stated set instead of a redefinition of an empty one.
--   3. REVOKE from anon/authenticated — the independent second gate. RLS alone
--      still leaves the table on the PostgREST surface; the revoke removes it.
--
-- No `authenticated` policy and no `authenticated` grant, by design: this
-- product does not use Supabase Auth, the gateway issues its own JWTs, and
-- `auth.uid()` is permanently NULL. A policy referencing auth.* would be
-- decorative. Nothing in a browser reaches these tables — grep over the repo
-- finds the two table names in exactly one runtime file, the gateway service
-- above, which uses SUPABASE_SERVICE_ROLE_KEY (database.service.ts:14). The
-- two hits in apps/web are a comment and a @deprecated note, not queries.
--
-- Idempotent and safe to re-run: CREATE TABLE / CREATE INDEX use IF NOT
-- EXISTS, `enable row level security` is a no-op when already on, every
-- CREATE POLICY is preceded by DROP POLICY IF EXISTS, and REVOKE of an absent
-- privilege is a no-op.
--
-- No explicit BEGIN/COMMIT — the Supabase CLI already wraps each migration
-- file in a transaction, and none of the existing migrations in this directory
-- opens one.

-- ---------------------------------------------------------------------------
-- 1. The grants themselves.
--
-- Distinct from user_oauth_accounts, which only proves identity for sign-in and
-- stores no tokens. These rows carry *delegated API access*: scoped grants plus
-- refresh tokens used to call Drive/Graph on the user's behalf long after they
-- close the tab. Tokens are encrypted by the app (AES-256-GCM,
-- TokenCryptoService); the column names say so to make an unencrypted write
-- obvious in review.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.integration_oauth_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(user_id) ON DELETE CASCADE,
  restaurant_id UUID REFERENCES public.restaurants(id) ON DELETE CASCADE,
  provider VARCHAR(50) NOT NULL CHECK (provider IN ('google', 'microsoft')),
  -- Which product the grant is for; a user may connect Drive but not Excel.
  integration_id VARCHAR(64) NOT NULL,
  account_email TEXT,
  -- Exactly what the user consented to, so the UI can show it back to them
  -- and we can detect when a required scope was declined.
  scopes TEXT[] NOT NULL DEFAULT '{}',
  -- Nullable because disconnect() clears these in place rather than deleting
  -- the row (integrations-oauth.service.ts:534).
  access_token_encrypted TEXT,
  refresh_token_encrypted TEXT,
  token_expires_at TIMESTAMPTZ,
  connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Soft revoke: keeps an audit trail of grants that once existed.
  revoked_at TIMESTAMPTZ,
  -- Load-bearing for the PostgREST upsert. Must NOT gain a WHERE predicate.
  UNIQUE (user_id, integration_id)
);

-- listConnections (:477) filters on (user_id, revoked_at IS NULL). The
-- complete (user_id, integration_id) unique index above already covers the
-- users FK cascade; this one serves the hot read.
CREATE INDEX IF NOT EXISTS idx_integration_oauth_conn_user
  ON public.integration_oauth_connections (user_id)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_integration_oauth_conn_restaurant
  ON public.integration_oauth_connections (restaurant_id)
  WHERE revoked_at IS NULL;

-- ---------------------------------------------------------------------------
-- 2. Short-lived CSRF state for the authorization redirect.
--
-- Deliberately a table rather than the Redis cache: a dropped cache would
-- silently turn into "every callback fails state validation", and the volume
-- here is a few rows per user per month.
--
-- restaurant_id deliberately carries NO foreign key, unlike its counterpart on
-- the connections table. The row lives for ten minutes and is only a carrier —
-- its restaurant_id is copied into the connections row at
-- integrations-oauth.service.ts:285, where the FK does apply. Adding one here
-- would move a stale-JWT tenant id from "fails at the end of the handshake"
-- to "cannot start the handshake", which is a behaviour change the code does
-- not ask for. Recorded as a deliberate non-change, not an oversight.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.integration_oauth_states (
  state TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.users(user_id) ON DELETE CASCADE,
  restaurant_id UUID,
  provider VARCHAR(50) NOT NULL CHECK (provider IN ('google', 'microsoft')),
  integration_id VARCHAR(64) NOT NULL,
  -- Where to send the browser once the handshake finishes.
  return_path TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ
);

-- Serves purgeExpiredStates() (:649), which deletes on expires_at.
CREATE INDEX IF NOT EXISTS idx_integration_oauth_states_expiry
  ON public.integration_oauth_states (expires_at);

-- ---------------------------------------------------------------------------
-- 3. Lock both tables down in the SAME migration that creates them.
--
-- Doing this as a follow-up is how the other four instances of this defect
-- class got their window. There is no window here.
-- ---------------------------------------------------------------------------

ALTER TABLE public.integration_oauth_connections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS integration_oauth_connections_service_role
  ON public.integration_oauth_connections;
CREATE POLICY integration_oauth_connections_service_role
  ON public.integration_oauth_connections
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.integration_oauth_connections FROM anon, authenticated;

ALTER TABLE public.integration_oauth_states ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS integration_oauth_states_service_role
  ON public.integration_oauth_states;
CREATE POLICY integration_oauth_states_service_role
  ON public.integration_oauth_states
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.integration_oauth_states FROM anon, authenticated;

COMMENT ON TABLE public.integration_oauth_connections IS
  'Delegated third-party API grants (Drive, Excel). Tokens are AES-256-GCM encrypted by the API gateway. RLS on, service_role only, anon/authenticated revoked.';
COMMENT ON TABLE public.integration_oauth_states IS
  'Single-use CSRF state for integration OAuth redirects; rows expire after 10 minutes. RLS on, service_role only, anon/authenticated revoked.';

-- ---------------------------------------------------------------------------
-- 4. Assert the outcome instead of reporting success.
--
-- A migration that cannot fail is the same defect class in a new place. This
-- block checks four independent things, and the third is the interesting one:
-- it verifies the SCHEMA/CODE CONTRACT, not merely that the DDL above ran.
--
--   (a) both tables exist and have RLS enabled;
--   (b) neither grants SELECT/INSERT/UPDATE/DELETE to anon or authenticated;
--   (c) every column the gateway service reads or writes is present, and the
--       three the disconnect path NULLs are actually nullable;
--   (d) the (user_id, integration_id) unique index exists and is NOT partial,
--       so the PostgREST upsert's ON CONFLICT can bind to it. Without this the
--       upsert degrades to a plain insert and silently accumulates duplicate
--       connection rows per user.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  missing        text;
  leaky          text;
  absent_cols    text;
  wrongly_notnull text;
  t              text;
  c              text;
  required       jsonb := jsonb_build_object(
    'integration_oauth_connections', jsonb_build_array(
      'id', 'user_id', 'restaurant_id', 'provider', 'integration_id',
      'account_email', 'scopes', 'access_token_encrypted',
      'refresh_token_encrypted', 'token_expires_at', 'connected_at',
      'updated_at', 'revoked_at'
    ),
    'integration_oauth_states', jsonb_build_array(
      'state', 'user_id', 'restaurant_id', 'provider', 'integration_id',
      'return_path', 'created_at', 'expires_at', 'consumed_at'
    )
  );
BEGIN
  -- (a) existence + RLS
  SELECT string_agg(x.name, ', ' ORDER BY x.name) INTO missing
  FROM (VALUES ('integration_oauth_connections'), ('integration_oauth_states')) AS x(name)
  WHERE to_regclass('public.' || x.name) IS NULL
     OR NOT (SELECT c2.relrowsecurity
             FROM pg_class c2 WHERE c2.oid = to_regclass('public.' || x.name));

  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'integration OAuth tables absent or RLS off: %', missing;
  END IF;

  -- (b) no client grants. The whole point: this table holds refresh tokens.
  SELECT string_agg(x.name, ', ' ORDER BY x.name) INTO leaky
  FROM (VALUES ('integration_oauth_connections'), ('integration_oauth_states')) AS x(name)
  WHERE has_table_privilege('anon', 'public.' || x.name, 'SELECT')
     OR has_table_privilege('anon', 'public.' || x.name, 'INSERT')
     OR has_table_privilege('anon', 'public.' || x.name, 'UPDATE')
     OR has_table_privilege('anon', 'public.' || x.name, 'DELETE')
     OR has_table_privilege('authenticated', 'public.' || x.name, 'SELECT')
     OR has_table_privilege('authenticated', 'public.' || x.name, 'INSERT')
     OR has_table_privilege('authenticated', 'public.' || x.name, 'UPDATE')
     OR has_table_privilege('authenticated', 'public.' || x.name, 'DELETE');

  IF leaky IS NOT NULL THEN
    RAISE EXCEPTION 'integration OAuth tables still reachable by anon/authenticated: %', leaky;
  END IF;

  -- (c) the columns the service actually touches
  FOR t IN SELECT jsonb_object_keys(required) LOOP
    FOR c IN SELECT jsonb_array_elements_text(required -> t) LOOP
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = t AND column_name = c
      ) THEN
        absent_cols := concat_ws(', ', absent_cols, t || '.' || c);
      END IF;
    END LOOP;
  END LOOP;

  IF absent_cols IS NOT NULL THEN
    RAISE EXCEPTION 'integration OAuth schema does not satisfy the gateway service; missing: %', absent_cols;
  END IF;

  -- disconnect() writes NULL into these three (service.ts:534-541).
  SELECT string_agg(column_name, ', ' ORDER BY column_name) INTO wrongly_notnull
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'integration_oauth_connections'
    AND column_name IN ('access_token_encrypted', 'refresh_token_encrypted', 'token_expires_at')
    AND is_nullable = 'NO';

  IF wrongly_notnull IS NOT NULL THEN
    RAISE EXCEPTION 'disconnect() NULLs these columns but they are NOT NULL: %', wrongly_notnull;
  END IF;

  -- (d) the upsert's ON CONFLICT target: unique, exactly these two columns,
  --     and no predicate.
  IF NOT EXISTS (
    SELECT 1
    FROM pg_index i
    WHERE i.indrelid = 'public.integration_oauth_connections'::regclass
      AND i.indisunique
      AND i.indpred IS NULL
      AND i.indnkeyatts = 2
      AND (SELECT array_agg(a.attname::text ORDER BY a.attname)
           FROM unnest(i.indkey::int2[]) AS k(attnum)
           JOIN pg_attribute a
             ON a.attrelid = i.indrelid AND a.attnum = k.attnum)
          = ARRAY['integration_id', 'user_id']
  ) THEN
    RAISE EXCEPTION
      'no non-partial UNIQUE(user_id, integration_id) — storeConnection''s upsert onConflict cannot bind and would insert duplicates';
  END IF;

  RAISE NOTICE 'integration OAuth tables created, RLS on, anon/authenticated revoked, gateway column contract satisfied.';
END
$$;

-- OD-73 — close the eleven public tables that fail OPEN: RLS off + full anon DML.
--
-- Why this migration exists
-- -------------------------
-- The OD-72 census measured RLS across `public` and found two failure
-- directions. The 142 naked-RLS tables fail CLOSED (silent empty reads) and
-- remain OD-72's design fork. Their complement fails OPEN, and that half is
-- this migration: eleven tables carry `relrowsecurity = false` while holding
-- the default Supabase grants, so `anon` — a credential that is public by
-- design and shipped into the web bundle from the `SUPABASE_ANON_KEY` secret
-- (.github/workflows/deploy.yml:191) — holds SELECT/INSERT/UPDATE/DELETE on
-- the invoice store and on the OAuth account-link table.
--
-- This is not a posture question and it does not wait on OD-72. Grants are
-- access control; RLS is a second, independent gate. Revoking the grants is
-- correct under every branch of OD-72's fork.
--
--
-- Verification against production — 2026-08-26, PostgreSQL 17.6
-- -------------------------------------------------------------
-- Measured directly (service-role connection, read-only session) rather than
-- trusted from the register, per the documented pattern of the decision
-- register rotting between sessions.
--
--   * 206 tables in `public` (relkind in ('r','p')). 194 have RLS on, 12 have
--     it off. The 12 are exactly the set OD-73 names — the register's list is
--     correct as of this date, with the one correction noted below.
--   * All 12 hold `anon=arwdDxtm` AND `authenticated=arwdDxtm` in `relacl`
--     (SELECT/INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER). Confirmed
--     per-table with has_table_privilege(), not inferred from the ACL string.
--   * None of the 12 has a single policy (pg_policy count = 0 on all twelve),
--     so nothing here is being *replaced* — the tables are simply ungated.
--   * There are no PUBLIC grants on any of them. `relacl` names exactly
--     postgres / anon / authenticated / service_role, so
--     `revoke ... from anon, authenticated` is sufficient and precise; there
--     is no third grantee left holding the privilege after this runs.
--
-- Row counts at verification time (exact count(*) under the service role):
--
--   | table                          | rows | anon could read it today |
--   |--------------------------------|-----:|--------------------------|
--   | procurement_documents          |    0 | empty                    |
--   | procurement_document_lines     |    0 | empty                    |
--   | procurement_document_links     |    0 | empty                    |
--   | procurement_receipt_events     |    0 | empty                    |
--   | procurement_credits            |    0 | empty                    |
--   | user_oauth_accounts            |    1 | YES                      |
--   | wine_repair_log                | 1086 | YES                      |
--   | wine_merge_log                 |    0 | empty                    |
--   | _bak_library_before_corpus     |  267 | YES                      |
--   | _bak_wine_match_keys_20260812  |  293 | YES                      |
--   | _bak_seed_repair_20260813      |   41 | YES                      |
--
-- The five `procurement_*` tables being empty is the only reason this is not
-- already a breach, and it is a deadline, not a mitigation: they are the
-- invoice pipeline's destination, and the first real customer invoice would
-- land in a table anyone holding the publishable key can read AND delete.
-- `user_oauth_accounts` holds `id, user_id, provider, provider_user_id,
-- created_at, updated_at` — re-checked column-by-column against
-- information_schema, NO tokens stored — but it is anon-WRITABLE, and
-- auth.service.ts:1747 reads `(provider, provider_user_id)` to reject
-- "already linked to another user", so a planted row denies a legitimate
-- OAuth link. Nuisance, not takeover: login does not resolve identity here.
--
--
-- Blast radius — established before revoking anything
-- ---------------------------------------------------
-- Revoking `anon` breaks the product if any browser path reads these tables.
-- Checked, and it does not:
--
--   * There is exactly ONE anon-key Supabase client in the product,
--     apps/web/src/lib/supabase.ts:16-18, and exactly ONE file imports it:
--     apps/web/src/hooks/queries/useSommelierQueries.ts:3.
--   * That file's only table is `sommelier_conversations`
--     (useSommelierQueries.ts:22), which is NOT in this set — it has RLS on
--     and two policies, and is untouched here.
--   * The `.from()` helpers in lib/supabase.ts naming `master_wine_library`,
--     `restaurant_inventory` and `procurement_orders` have ZERO importers, and
--     none of those three tables is in this set regardless.
--   * `apps/mobile` contains zero Supabase references. `packages/` contains no
--     anon-key client. No browser code calls `.rpc(` at all.
--   * `procurement_documents` appears in apps/web only as a string literal in
--     a discriminated union (LogsTimelinePage.tsx:18) over data fetched from
--     the gateway (apiClient.get('/logs/timeline/...'), :53) — not a
--     PostgREST call.
--
-- So: no table touched by this migration is reachable from a browser, and
-- nothing user-visible changes. NOTHING WAS EXCLUDED FOR BROWSER REACHABILITY.
--
-- One live anon path DOES close here, deliberately: `merge_library_wines` and
-- `unsupersede_library_wine` are SECURITY INVOKER (prosecdef = false) with
-- EXECUTE granted to anon and authenticated, and they write `wine_merge_log`
-- and `wine_repair_log`. Today an anon caller can invoke them over PostgREST
-- RPC and they execute with anon's own table privileges. After this migration
-- that path fails at the grant. Both functions have zero callers anywhere in
-- the repo (grep over apps/, services/, scripts/ — only planning prose and
-- their own migrations), so nothing breaks. Their EXECUTE grants are left
-- alone: narrowing function ACLs is a separate question and is not smuggled
-- in here.
--
--
-- Both writers use the service-role key — confirmed, not assumed
-- --------------------------------------------------------------
--   * apps/api-gateway/src/database/database.service.ts:15 reads
--     SUPABASE_SERVICE_ROLE_KEY. It is the writer for every procurement_*
--     table here (document-intake.service.ts:343/424/483/432/520,
--     receiving.service.ts:123/221/325, procurement.service.ts:1115,
--     credits.controller.ts:107, documents.controller.ts:122) and for
--     user_oauth_accounts (auth.service.ts:1683/1747).
--   * services/agent-orchestrator/config/settings.py:26-29 resolves
--     SUPABASE_SERVICE_KEY -> SUPABASE_KEY -> SUPABASE_SERVICE_ROLE_KEY. The
--     first two names are ABSENT from the environment (checked by name, not
--     value), so it resolves to the service-role key.
--   * `service_role` has rolbypassrls = true in production (verified against
--     pg_roles; `anon` and `authenticated` are both false). The explicit
--     policy below is therefore belt-and-braces for that role, and the real
--     work for it is that `service_role` keeps its grants untouched.
--
-- A writer holding the anon key would now fail LOUDLY at the grant instead of
-- silently succeeding at writing invoice or OAuth-link rows.
--
--
-- Why the shape is RLS-ON + explicit service_role policy + REVOKE
-- ---------------------------------------------------------------
-- Copied deliberately from 20260824153600_nf_a_readout.sql, which took it from
-- the guest-identity migration (20260819000000):
--
--   1. `enable row level security` — the house convention is unambiguously
--      RLS-ON (194 of 206 before this migration; 205 of 206 after). These
--      eleven are gaps, not a considered exception.
--   2. An EXPLICIT `service_role` policy rather than relying on
--      RLS-with-no-policy. Closed-by-absence is closed only until someone adds
--      the first policy, at which point the table silently opens to whatever
--      that policy allows. Naming service_role's access makes the next policy
--      an addition to a stated set instead of a redefinition of an empty one.
--   3. `revoke all ... from anon, authenticated` — the independent gate. RLS
--      alone would still leave these tables on the PostgREST surface returning
--      permission-denied; the revoke removes them from it.
--
-- No `authenticated` policy and no `authenticated` grant, by design. This
-- product does not use Supabase Auth at all — AuthContext holds a gateway JWT,
-- the Supabase client is never given a session (no supabase.auth.* call exists
-- in apps/web/src outside a test mock), so `auth.uid()` is permanently NULL
-- and the `authenticated` Postgres role is never assumed by any real caller.
-- A policy referencing auth.* here would be decorative — that is precisely the
-- defect OD-72 documented on `sommelier_conversations`.
--
--
-- What this migration deliberately does NOT do
-- ---------------------------------------------
--   * `spatial_ref_sys` is EXCLUDED. It is the twelfth RLS-off table and a
--     PostGIS system table, expected to be world-readable — and, decisively,
--     it is owned by `supabase_admin`, while migrations run as `postgres`,
--     which is NOT a member of supabase_admin (pg_has_role(postgres,
--     supabase_admin, 'USAGE') = false, verified). An ALTER here would abort
--     the whole migration with "must be owner of table".
--   * The three `_bak_*` snapshots are LOCKED DOWN but NOT DROPPED. OD-73
--     proposes dropping them or moving them out of `public`; that destroys
--     601 rows of backup data and is the founder's call, not this migration's
--     (CLAUDE.md §0.1). Locking them is the part that needs no decision. They
--     are guarded below so that dropping them later does not break a re-run.
--   * The 142 naked-RLS tables are untouched — that is OD-72, a different
--     question with a different answer shape.
--   * `ALTER DEFAULT PRIVILEGES` in `public` is untouched, and it is why this
--     class of hole recurs: both `postgres` and `supabase_admin` carry
--     defaults granting `arwdDxtm` to anon and authenticated on every future
--     table (verified in pg_default_acl). Any table created after this
--     migration re-opens the same gap. Changing that default is a schema-wide
--     posture decision and belongs with OD-72, not smuggled in here — it is
--     recorded so the next census knows why the number crept back up.
--
-- Idempotent: `enable row level security` is a no-op when already enabled,
-- `drop policy if exists` precedes every `create policy`, and `revoke` on an
-- absent privilege is a no-op. Safe to re-run.
--
-- No explicit BEGIN/COMMIT: 0 of the 69 existing migrations in this directory
-- use one, because the Supabase CLI already wraps each migration file in a
-- transaction. Adding a nested one would only emit "there is already a
-- transaction in progress" and change nothing about atomicity.

-- ---------------------------------------------------------------------------
-- 1. The procurement cluster — the invoice store. Highest severity: empty
--    today, the destination of the document pipeline tomorrow.
-- ---------------------------------------------------------------------------

alter table public.procurement_documents enable row level security;
drop policy if exists procurement_documents_service_role on public.procurement_documents;
create policy procurement_documents_service_role on public.procurement_documents
  for all to service_role using (true) with check (true);
revoke all on public.procurement_documents from anon, authenticated;

alter table public.procurement_document_lines enable row level security;
drop policy if exists procurement_document_lines_service_role on public.procurement_document_lines;
create policy procurement_document_lines_service_role on public.procurement_document_lines
  for all to service_role using (true) with check (true);
revoke all on public.procurement_document_lines from anon, authenticated;

alter table public.procurement_document_links enable row level security;
drop policy if exists procurement_document_links_service_role on public.procurement_document_links;
create policy procurement_document_links_service_role on public.procurement_document_links
  for all to service_role using (true) with check (true);
revoke all on public.procurement_document_links from anon, authenticated;

alter table public.procurement_receipt_events enable row level security;
drop policy if exists procurement_receipt_events_service_role on public.procurement_receipt_events;
create policy procurement_receipt_events_service_role on public.procurement_receipt_events
  for all to service_role using (true) with check (true);
revoke all on public.procurement_receipt_events from anon, authenticated;

alter table public.procurement_credits enable row level security;
drop policy if exists procurement_credits_service_role on public.procurement_credits;
create policy procurement_credits_service_role on public.procurement_credits
  for all to service_role using (true) with check (true);
revoke all on public.procurement_credits from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. user_oauth_accounts — 1 real row, anon-readable and anon-writable today.
--    No tokens in the table (columns re-checked), but a planted
--    (provider, provider_user_id) row blocks a legitimate OAuth link at
--    auth.service.ts:1747.
-- ---------------------------------------------------------------------------

alter table public.user_oauth_accounts enable row level security;
drop policy if exists user_oauth_accounts_service_role on public.user_oauth_accounts;
create policy user_oauth_accounts_service_role on public.user_oauth_accounts
  for all to service_role using (true) with check (true);
revoke all on public.user_oauth_accounts from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. The wine audit logs. `wine_repair_log` holds 1086 rows of internal repair
--    history readable by anyone with the publishable key; `wine_merge_log` is
--    empty but is the undo record `unsupersede_library_wine` reads back, so an
--    anon DELETE there would silently destroy the only trace of what a merge
--    did. Both are written only from SQL functions with zero callers.
-- ---------------------------------------------------------------------------

alter table public.wine_repair_log enable row level security;
drop policy if exists wine_repair_log_service_role on public.wine_repair_log;
create policy wine_repair_log_service_role on public.wine_repair_log
  for all to service_role using (true) with check (true);
revoke all on public.wine_repair_log from anon, authenticated;

alter table public.wine_merge_log enable row level security;
drop policy if exists wine_merge_log_service_role on public.wine_merge_log;
create policy wine_merge_log_service_role on public.wine_merge_log
  for all to service_role using (true) with check (true);
revoke all on public.wine_merge_log from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. The three `_bak_*` snapshots — 601 rows total, left in `public` by past
--    data work and anon-readable today.
--
--    Guarded with to_regclass because OD-73's other half proposes dropping
--    them: if that decision lands and they are dropped, this migration must
--    still re-run cleanly. Locking is unconditional; deleting is a decision.
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
  tables text[] := array[
    '_bak_library_before_corpus',
    '_bak_wine_match_keys_20260812',
    '_bak_seed_repair_20260813'
  ];
begin
  foreach t in array tables loop
    if to_regclass(format('public.%I', t)) is null then
      raise notice 'OD-73: public.% is absent, skipping (already dropped?)', t;
      continue;
    end if;

    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_service_role', t);
    execute format(
      'create policy %I on public.%I for all to service_role using (true) with check (true)',
      t || '_service_role', t
    );
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- 5. Assert the outcome rather than hoping for it. If any of the eleven is
--    still ungated after the statements above, fail the migration loudly
--    instead of reporting success — the failure mode this whole entry is
--    about is a security claim nobody measured.
-- ---------------------------------------------------------------------------

do $$
declare
  bad text;
begin
  select string_agg(c.relname, ', ' order by c.relname)
    into bad
  from pg_class c
  where c.relnamespace = 'public'::regnamespace
    and c.relkind in ('r', 'p')
    and c.relname <> 'spatial_ref_sys'
    and (
      c.relrowsecurity = false
      or has_table_privilege('anon', c.oid, 'SELECT')
      or has_table_privilege('anon', c.oid, 'INSERT')
      or has_table_privilege('anon', c.oid, 'UPDATE')
      or has_table_privilege('anon', c.oid, 'DELETE')
    )
    and c.relname in (
      'procurement_documents', 'procurement_document_lines',
      'procurement_document_links', 'procurement_receipt_events',
      'procurement_credits', 'user_oauth_accounts',
      'wine_repair_log', 'wine_merge_log',
      '_bak_library_before_corpus', '_bak_wine_match_keys_20260812',
      '_bak_seed_repair_20260813'
    );

  if bad is not null then
    raise exception 'OD-73 not closed — still RLS-off or anon-DML: %', bad;
  end if;
end
$$;

-- OD-72 — close the naked-RLS surface: revoke client grants schema-wide.
--
-- WHAT WAS MEASURED (production, 2026-08-26, read-only as `postgres`)
-- -------------------------------------------------------------------------
--   206 public tables. After 20260825200000 closed the 12 RLS-off ones:
--     * 142 tables have RLS ON and ZERO policies, and STILL grant full DML to
--       anon and authenticated. They are closed by ABSENCE only.
--     * 49 tables have RLS ON, at least one policy, and anon grants — there the
--       policy is the only thing deciding, and a permissive one is a leak.
--     * 203 of 206 tables grant anon+authenticated full DML. Only 3 were ever
--       revoked, and those 3 were revoked by hand this week.
--
-- THE TRAP HAS ALREADY FIRED. This is not hypothetical:
--   * `master_wine_library` carries a single `SELECT USING (true)` policy for
--     {anon, authenticated} and returns 4,094 rows to the publishable anon key
--     — verified with a live GET. Same shape on `training_datasets`,
--     `organization_invites`, `calendar_event_types`, `crawl_log` and
--     `restaurant_directory`.
--   * 16 postgres-owned views have no `security_invoker`, so they execute as
--     their RLS-bypassing owner while anon holds SELECT on them.
--     `v_restaurant_sku_reference` returned a real tenant's name;
--     `inventory_lot_rollup` returned the whole of `inventory_lots`. Seven
--     otherwise-"closed" tables were readable straight through a view.
--   * `increment_trust_counter` and `seed_sim_restaurant` are SECURITY DEFINER
--     and anon-executable — anon-callable WRITES over PostgREST RPC.
--
-- WHY REVOKE RATHER THAN WRITE POLICIES
-- -------------------------------------------------------------------------
-- Per-table policies were considered and rejected: 52 of the 74 existing
-- policies anchor on `auth.uid()`, which is permanently NULL here because the
-- product does not use Supabase Auth — the gateway issues its own JWTs. Writing
-- more of those would price in an auth migration to serve zero call sites.
-- Turning RLS off was rejected outright: it removes the only working gate.
--
-- Revoking is also the shape this repo already chose twice, at 1 table
-- (20260824153600) and at 11 (20260825200000). This applies it schema-wide.
--
-- WHAT STILL REACHES THE DATABASE FROM A BROWSER
-- -------------------------------------------------------------------------
-- Exactly one thing. `apps/web/src/lib/supabase.ts:16` builds the anon client;
-- its only importer is `useSommelierQueries.ts:3`, reading and upserting
-- `sommelier_conversations` (RLS on, 2 policies) from `SommelierAI.tsx`.
-- That table is EXCLUDED below and keeps its grants. The
-- master_wine_library / restaurant_inventory / procurement_orders helpers in
-- that same file have zero importers (OD-45 ported the last one), and the
-- mobile app makes no Supabase calls at all.
--
-- Everything else reads through the gateway with the service-role key, which
-- carries rolbypassrls and is unaffected by any of this.

-- ---------------------------------------------------------------------------
-- 1. Tables — revoke anon/authenticated everywhere except the one live consumer.
--
-- RLS stays ON with the service-role policy already in place. Belt and braces:
-- a future permissive policy can no longer open a table on its own, because the
-- underlying grant is gone. That is precisely the failure this entry names.
-- ---------------------------------------------------------------------------
do $$
declare
  t record;
  n int := 0;
begin
  for t in
    select c.oid, c.relname
    from pg_class c
    join pg_roles o on o.oid = c.relowner
    where c.relnamespace = 'public'::regnamespace
      and c.relkind in ('r', 'p')
      and o.rolname = 'postgres'                -- never touch supabase_admin's
      and c.relname <> 'sommelier_conversations'
      and (has_table_privilege('anon', c.oid, 'SELECT')
        or has_table_privilege('anon', c.oid, 'INSERT')
        or has_table_privilege('anon', c.oid, 'UPDATE')
        or has_table_privilege('anon', c.oid, 'DELETE')
        or has_table_privilege('authenticated', c.oid, 'SELECT')
        or has_table_privilege('authenticated', c.oid, 'INSERT')
        or has_table_privilege('authenticated', c.oid, 'UPDATE')
        or has_table_privilege('authenticated', c.oid, 'DELETE'))
  loop
    execute format('revoke all on public.%I from anon, authenticated', t.relname);
    n := n + 1;
  end loop;
  raise notice 'OD-72: revoked client grants on % table(s)', n;
end
$$;

-- ---------------------------------------------------------------------------
-- 2. Views — the leak that made "closed" tables readable anyway.
--
-- A view with no `security_invoker` runs as its OWNER, so it bypasses the RLS
-- on its base tables. Both halves are fixed: flip the views to invoker
-- semantics AND drop the client grants. Either alone would do it today; both
-- means neither a restored grant nor a new view inherits the hole.
--
-- Materialized views cannot take `security_invoker` — for those the revoke is
-- the whole fix, which is why the grant half is not optional.
-- PostGIS's `geography_columns` / `geometry_columns` are owned by
-- supabase_admin and deliberately untouched: an ALTER we lack rights for would
-- abort the migration, and they expose no tenant data.
-- ---------------------------------------------------------------------------
do $$
declare
  v record;
  n_inv int := 0;
  n_rev int := 0;
begin
  for v in
    select c.oid, c.relname, c.relkind
    from pg_class c
    join pg_roles o on o.oid = c.relowner
    where c.relnamespace = 'public'::regnamespace
      and c.relkind in ('v', 'm')
      and o.rolname = 'postgres'
  loop
    if v.relkind = 'v'
       and coalesce((select option_value
                     from pg_options_to_table(
                       (select reloptions from pg_class where oid = v.oid))
                     where option_name = 'security_invoker'), 'off') <> 'true'
    then
      execute format('alter view public.%I set (security_invoker = true)', v.relname);
      n_inv := n_inv + 1;
    end if;

    if has_table_privilege('anon', v.oid, 'SELECT')
       or has_table_privilege('authenticated', v.oid, 'SELECT') then
      execute format('revoke all on public.%I from anon, authenticated', v.relname);
      n_rev := n_rev + 1;
    end if;
  end loop;
  raise notice 'OD-72: % view(s) switched to security_invoker, % revoked', n_inv, n_rev;
end
$$;

-- ---------------------------------------------------------------------------
-- 3. Functions — two anon-callable SECURITY DEFINER WRITES.
--
-- SECURITY DEFINER means they run with the definer's rights, so revoking the
-- table grants above does NOT stop them. `seed_sim_restaurant` provisions a
-- simulator tenant; `increment_trust_counter` mutates a per-user counter. Both
-- were reachable over PostgREST RPC with nothing but the publishable anon key.
--
-- PostGIS's three `st_estimatedextent` overloads are also SECURITY DEFINER and
-- anon-executable, and are left alone: supabase_admin owns them, they are
-- read-only geometry statistics, and we cannot ALTER them anyway.
-- ---------------------------------------------------------------------------
do $$
declare
  f record;
  n int := 0;
begin
  for f in
    select p.oid, p.proname, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
    join pg_roles o on o.oid = p.proowner
    where ns.nspname = 'public'
      and p.prosecdef
      and o.rolname = 'postgres'
      and has_function_privilege('anon', p.oid, 'EXECUTE')
  loop
    execute format('revoke all on function public.%I(%s) from anon, authenticated',
                   f.proname, f.args);
    n := n + 1;
  end loop;
  raise notice 'OD-72: revoked EXECUTE on % security-definer function(s)', n;
end
$$;

-- ---------------------------------------------------------------------------
-- 4. Stop the hole regenerating.
--
-- `pg_default_acl` shows postgres granting full DML to anon and authenticated
-- on every NEW public table. Without this, the next `create table` reopens
-- exactly what sections 1-3 just closed, and the next audit finds it again.
--
-- Only postgres's defaults are altered here. supabase_admin carries an
-- identical default that we cannot change (postgres is not a member of it), so
-- tables created BY supabase_admin will still arrive with client grants. That
-- residue is recorded in OD-72 rather than silently ignored — it is why the
-- assertion in section 5 scopes itself to postgres-owned relations.
-- ---------------------------------------------------------------------------
alter default privileges in schema public
  revoke all on tables from anon, authenticated;

alter default privileges in schema public
  revoke all on functions from anon, authenticated;

alter default privileges in schema public
  revoke all on sequences from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Assert the outcome. A security migration that reports success without
--    measuring is the exact failure this register entry exists to catch.
-- ---------------------------------------------------------------------------
do $$
declare
  bad_tables text;
  bad_views  text;
begin
  select string_agg(c.relname, ', ' order by c.relname) into bad_tables
  from pg_class c
  join pg_roles o on o.oid = c.relowner
  where c.relnamespace = 'public'::regnamespace
    and c.relkind in ('r', 'p')
    and o.rolname = 'postgres'
    and c.relname <> 'sommelier_conversations'
    and (has_table_privilege('anon', c.oid, 'SELECT')
      or has_table_privilege('anon', c.oid, 'DELETE'));

  if bad_tables is not null then
    raise exception 'OD-72 not closed — tables still client-readable: %', bad_tables;
  end if;

  select string_agg(c.relname, ', ' order by c.relname) into bad_views
  from pg_class c
  join pg_roles o on o.oid = c.relowner
  where c.relnamespace = 'public'::regnamespace
    and c.relkind in ('v', 'm')
    and o.rolname = 'postgres'
    and has_table_privilege('anon', c.oid, 'SELECT');

  if bad_views is not null then
    raise exception 'OD-72 not closed — views still anon-readable: %', bad_views;
  end if;

  raise notice 'OD-72 closed: no postgres-owned table or view is client-readable (sommelier_conversations excepted by design).';
end
$$;

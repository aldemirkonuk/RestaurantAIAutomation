-- F-839 (sim wave 32): the velocity migration re-created inventory_analytics
-- without security_invoker, so the view read past RLS as its owner.
-- Migration inventory_analytics_reads_as_its_caller_again sets it back.
--
-- Self-asserting: raises on a failure, so `psql -v ON_ERROR_STOP=1 -f` stops.
-- It must FAIL on a build without that migration and PASS with it. Reads the
-- catalog only; no fixtures.

do $$
declare
  opts text[];
begin
  select c.reloptions into opts
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'inventory_analytics' and c.relkind = 'v';

  if not found then
    raise exception 'F-839: public.inventory_analytics is not a view';
  end if;

  if opts is null or not ('security_invoker=true' = any (opts) or 'security_invoker=on' = any (opts)) then
    raise exception 'F-839: public.inventory_analytics runs as its owner (reloptions %)', opts;
  end if;
end $$;

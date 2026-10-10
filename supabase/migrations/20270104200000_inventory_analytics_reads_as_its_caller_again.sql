-- inventory_analytics reads as its caller again (sim wave 32, F-839).
--
-- 20270103600000_velocity_nets_voids_and_counts_a_new_wines_days.sql
-- re-created public.inventory_analytics with CREATE OR REPLACE VIEW and no
-- WITH clause. That resets security_invoker, so the view ran with its
-- owner's rights again and handed every house's stock, sales and price rows
-- past RLS to anyone who can select from it -- the hole OD-72 closed and
-- F-532 (20270102500000_every_view_reads_as_its_caller.sql) closed again.
--
-- The view body is unchanged; only the option is set back. ALTER VIEW ... SET
-- is what scripts/check_views_security_invoker.py replays as "on", and it
-- leaves the column list, grants and dependants as they are.
-- Version assigned by the sim fix lane note (20270104200000).

ALTER VIEW public.inventory_analytics SET (security_invoker = true);

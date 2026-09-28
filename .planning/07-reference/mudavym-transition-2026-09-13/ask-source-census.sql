-- Ask catalogue census. SELECT only; no customer rows, IDs, names or secrets.
-- Public schema metadata plus aggregate counts. Prepared from main 60ed83a7
-- and its applied migration history; current runtime availability is measured here.
SELECT table_name, column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name IN (
  'restaurant_inventory',
  'inventory_lots',
  'inventory_transactions',
  'procurement_orders',
  'procurement_order_items',
  'procurement_documents',
  'procurement_document_lines',
  'procurement_document_links',
  'restaurant_providers',
  'providers',
  'pos_checks',
  'wine_consumption_log',
  'calendar_events',
  'calendar_recurrence_rules',
  'analytics_goals',
  'storage_locations',
  'vendor_price_observations',
  'price_history',
  'calendar_recurrence_exceptions',
  'master_wine_library',
  'restaurants'
)
ORDER BY table_name, ordinal_position;

SELECT 'restaurant_inventory' AS relation, count(*) AS rows, count(DISTINCT restaurant_id) AS houses_with_rows, count(*) FILTER (WHERE restaurant_id IS NULL) AS tenantless_rows FROM public.restaurant_inventory
UNION ALL
SELECT 'inventory_lots' AS relation, count(*) AS rows, count(DISTINCT restaurant_id) AS houses_with_rows, count(*) FILTER (WHERE restaurant_id IS NULL) AS tenantless_rows FROM public.inventory_lots
UNION ALL
SELECT 'inventory_transactions' AS relation, count(*) AS rows, count(DISTINCT restaurant_id) AS houses_with_rows, count(*) FILTER (WHERE restaurant_id IS NULL) AS tenantless_rows FROM public.inventory_transactions
UNION ALL
SELECT 'procurement_orders' AS relation, count(*) AS rows, count(DISTINCT restaurant_id) AS houses_with_rows, count(*) FILTER (WHERE restaurant_id IS NULL) AS tenantless_rows FROM public.procurement_orders
UNION ALL
SELECT 'procurement_order_items' AS relation, count(*) AS rows, count(DISTINCT restaurant_id) AS houses_with_rows, count(*) FILTER (WHERE restaurant_id IS NULL) AS tenantless_rows FROM public.procurement_order_items
UNION ALL
SELECT 'procurement_documents' AS relation, count(*) AS rows, count(DISTINCT restaurant_id) AS houses_with_rows, count(*) FILTER (WHERE restaurant_id IS NULL) AS tenantless_rows FROM public.procurement_documents
UNION ALL
SELECT 'procurement_document_lines' AS relation, count(*) AS rows, count(DISTINCT restaurant_id) AS houses_with_rows, count(*) FILTER (WHERE restaurant_id IS NULL) AS tenantless_rows FROM public.procurement_document_lines
UNION ALL
SELECT 'procurement_document_links' AS relation, count(*) AS rows, count(DISTINCT restaurant_id) AS houses_with_rows, count(*) FILTER (WHERE restaurant_id IS NULL) AS tenantless_rows FROM public.procurement_document_links
UNION ALL
SELECT 'restaurant_providers' AS relation, count(*) AS rows, count(DISTINCT restaurant_id) AS houses_with_rows, count(*) FILTER (WHERE restaurant_id IS NULL) AS tenantless_rows FROM public.restaurant_providers
UNION ALL
SELECT 'providers' AS relation, count(*) AS rows, count(DISTINCT restaurant_id) AS houses_with_rows, count(*) FILTER (WHERE restaurant_id IS NULL) AS tenantless_rows FROM public.providers
UNION ALL
SELECT 'pos_checks' AS relation, count(*) AS rows, count(DISTINCT restaurant_id) AS houses_with_rows, count(*) FILTER (WHERE restaurant_id IS NULL) AS tenantless_rows FROM public.pos_checks
UNION ALL
SELECT 'wine_consumption_log' AS relation, count(*) AS rows, count(DISTINCT restaurant_id) AS houses_with_rows, count(*) FILTER (WHERE restaurant_id IS NULL) AS tenantless_rows FROM public.wine_consumption_log
UNION ALL
SELECT 'calendar_events' AS relation, count(*) AS rows, count(DISTINCT restaurant_id) AS houses_with_rows, count(*) FILTER (WHERE restaurant_id IS NULL) AS tenantless_rows FROM public.calendar_events
UNION ALL
SELECT 'calendar_recurrence_rules' AS relation, count(*) AS rows, count(DISTINCT restaurant_id) AS houses_with_rows, count(*) FILTER (WHERE restaurant_id IS NULL) AS tenantless_rows FROM public.calendar_recurrence_rules
UNION ALL
SELECT 'analytics_goals' AS relation, count(*) AS rows, count(DISTINCT restaurant_id) AS houses_with_rows, count(*) FILTER (WHERE restaurant_id IS NULL) AS tenantless_rows FROM public.analytics_goals
UNION ALL
SELECT 'storage_locations' AS relation, count(*) AS rows, count(DISTINCT restaurant_id) AS houses_with_rows, count(*) FILTER (WHERE restaurant_id IS NULL) AS tenantless_rows FROM public.storage_locations
UNION ALL
SELECT 'vendor_price_observations' AS relation, count(*) AS rows, count(DISTINCT restaurant_id) AS houses_with_rows, count(*) FILTER (WHERE restaurant_id IS NULL) AS tenantless_rows FROM public.vendor_price_observations
UNION ALL
SELECT 'price_history' AS relation, count(*) AS rows, count(DISTINCT restaurant_id) AS houses_with_rows, count(*) FILTER (WHERE restaurant_id IS NULL) AS tenantless_rows FROM public.price_history
ORDER BY relation;

SELECT 'calendar_recurrence_exceptions' AS relation, count(*) AS rows FROM public.calendar_recurrence_exceptions
UNION ALL SELECT 'master_wine_library', count(*) FROM public.master_wine_library;

-- How ownership is represented matters: never label the junction's emptiness
-- as an absence of owned vendors.
SELECT
  count(*) FILTER (WHERE p.restaurant_id IS NOT NULL) AS owned_provider_rows,
  count(*) FILTER (WHERE p.restaurant_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.restaurant_providers rp
    WHERE rp.provider_id = p.id AND rp.restaurant_id = p.restaurant_id
  )) AS owned_without_matching_junction,
  count(*) FILTER (WHERE p.restaurant_id IS NULL AND EXISTS (
    SELECT 1 FROM public.restaurant_providers rp WHERE rp.provider_id = p.id
  )) AS shared_with_junction
FROM public.providers p;

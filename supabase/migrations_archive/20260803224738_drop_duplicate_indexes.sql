-- ============================================================================
-- Drop 14 byte-identical duplicate indexes
-- ============================================================================
--
-- Each pair below indexes the same columns on the same table with the same
-- predicate, under two different names — presumably migrations applied twice
-- under changing naming conventions. Every duplicate cost a write on every
-- insert to its table while serving no read that the survivor did not already
-- serve.
--
-- HOW THEY WERE FOUND, because the method mattered: normalising `indexdef` with
-- the index name stripped out, then grouping. Reading the index list by eye — the
-- first attempt — found 10 and missed four tables entirely, including
-- procurement_order_items and procurement_orders. It also wrongly counted
-- idx_vp_provider_active as a duplicate of vendor_promotions_provider_id_idx;
-- it is not, because it is partial (WHERE status = 'active') and therefore
-- serves a query the other cannot.
--
-- The survivor in each pair is the name matching its table's dominant
-- convention, so the remaining names read consistently.
--
-- 20260731164610_capture_ghost_tables.sql deliberately reproduced these
-- duplicates so that a fresh database matched production exactly. Now that
-- production has dropped them, the duplicate CREATE INDEX lines are removed from
-- that file in the same commit — otherwise a fresh database would create them
-- and this migration would drop them again, which works but is noise.
-- ============================================================================

DROP INDEX IF EXISTS conversation_embeddings_restaurant_idx;          -- keeps idx_ce_restaurant
DROP INDEX IF EXISTS idx_event_dlq_error_code;                        -- keeps idx_dlq_error_code
DROP INDEX IF EXISTS idx_event_dlq_restaurant;                        -- keeps idx_dlq_restaurant
DROP INDEX IF EXISTS idx_event_dlq_status_retry;                      -- keeps idx_dlq_status_retry
DROP INDEX IF EXISTS idx_event_replay_jobs_restaurant;                -- keeps idx_replay_jobs_restaurant
DROP INDEX IF EXISTS idx_event_replay_jobs_status;                    -- keeps idx_replay_jobs_status
DROP INDEX IF EXISTS idx_event_schema_registry_type;                  -- keeps idx_schema_registry_type
DROP INDEX IF EXISTS idx_event_schema_registry_active;                -- keeps idx_schema_registry_active
DROP INDEX IF EXISTS idx_procurement_order_items_inventory;           -- keeps idx_poi_inventory
DROP INDEX IF EXISTS idx_procurement_order_items_order;               -- keeps idx_poi_order
DROP INDEX IF EXISTS idx_procurement_orders_provider_id;              -- keeps idx_procurement_orders_provider
DROP INDEX IF EXISTS idx_procurement_orders_restaurant_id;            -- keeps idx_procurement_orders_restaurant
DROP INDEX IF EXISTS provider_conversation_sessions_restaurant_idx;   -- keeps idx_pcs_restaurant
DROP INDEX IF EXISTS vendor_promotions_restaurant_id_idx;             -- keeps idx_vp_restaurant

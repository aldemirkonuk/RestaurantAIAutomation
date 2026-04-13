SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name IN ('order_interactions', 'manager_preferences', 'unit_conversions', 'rfq_requests');

-- Check new columns added
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'restaurant_inventory' 
AND column_name IN ('is_optional_tracking', 'target_price', 'max_price', 'current_volume_ml', 'unit_type', 'is_generic_bucket', 'velocity_weight', 'sku');

SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'procurement_orders' 
AND column_name IN ('state_machine_state', 'is_recurring', 'cron_schedule', 'total_estimated_cost', 'final_confirmed_cost', 'negotiation_attempts', 'last_negotiation_at', 'is_offline_sync');
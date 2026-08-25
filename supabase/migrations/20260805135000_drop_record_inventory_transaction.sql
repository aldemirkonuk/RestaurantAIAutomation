-- Spine repair, decision A5: record_inventory_transaction resolved the stock
-- column to a `live_stock` string that does not exist on restaurant_inventory
-- (the real column is stock_live) and its auto-logging trigger inserted
-- NEW.wine_id, but restaurant_inventory has master_wine_id — every call 500'd
-- against the real database. InventoryLedgerService.createTransaction now
-- calls apply_stock_movement instead (previous migration in this series).
-- Nothing else in the codebase references this function.
DROP FUNCTION IF EXISTS public.record_inventory_transaction(
    uuid, uuid, uuid, public.inventory_transaction_type, public.inventory_transaction_source,
    integer, character varying, character varying, uuid, character varying, uuid, numeric,
    uuid, character varying, text, text, jsonb
);

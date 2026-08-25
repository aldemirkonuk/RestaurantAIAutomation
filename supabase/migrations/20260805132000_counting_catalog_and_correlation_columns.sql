-- SimPOS testbed plan: counting (decision E41), catalog matching (decision
-- D37), toast_item_mappings retirement (decision B22), and the logs-timeline
-- correlation columns it needs to be more than a fiction.

-- E41: the UI's count-staleness badge reads item.updatedAt today, which
-- changes on ANY edit (price, threshold, sale_type...), not just a count. A
-- real column lets the badge measure what it claims to measure.
ALTER TABLE public.restaurant_inventory
    ADD COLUMN IF NOT EXISTS last_counted_at timestamp with time zone;

COMMENT ON COLUMN public.restaurant_inventory.last_counted_at IS
  'Set only by a spot count (apply_stock_movement source=mobile_count), '
  'never by a generic field edit. Drives the 21-day count-due badge.';

-- D37: menu_items.source today allows only scan/csv/manual. A POS catalog
-- pull (SimPOS or a real integration) needs its own provenance value so it is
-- distinguishable in review queues from a human-typed entry.
ALTER TABLE public.menu_items
    DROP CONSTRAINT menu_items_source_check;
ALTER TABLE public.menu_items
    ADD CONSTRAINT menu_items_source_check
    CHECK ((source = ANY (ARRAY['scan'::text, 'csv'::text, 'manual'::text, 'pos'::text])));

-- B22: toast_item_mappings is a Toast-only duplicate of the provider-agnostic
-- pos_item_mappings, missing only sale_unit and the sales rollup columns.
-- Add those to pos_item_mappings so toast.service.ts's depletion path can be
-- rewritten against the one table (next migration touches no data — code
-- change lands separately). The table itself is left in place rather than
-- dropped: it is still read by toast.service.ts until that code change ships
-- in the same deploy, and dropping a table the running service still queries
-- would 500 every Toast webhook until both land atomically.
ALTER TABLE public.pos_item_mappings
    ADD COLUMN IF NOT EXISTS sale_unit character varying(10),
    ADD COLUMN IF NOT EXISTS total_sales_count integer DEFAULT 0,
    ADD COLUMN IF NOT EXISTS total_revenue numeric(12,2) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS last_sale_at timestamp with time zone;

ALTER TABLE public.pos_item_mappings
    ADD CONSTRAINT pos_item_mappings_sale_unit_check
    CHECK (sale_unit IS NULL OR sale_unit IN ('glass', 'bottle'));

-- Backfill from toast_item_mappings by (restaurant_id, external item id) —
-- pos_item_mappings uses source='toast' + external_item_id=toast_guid for the
-- same row once the ingress unification writes through it.
UPDATE public.pos_item_mappings pim
   SET sale_unit = tim.sale_unit,
       total_sales_count = tim.total_sales_count,
       total_revenue = tim.total_revenue,
       last_sale_at = tim.last_sale_at
  FROM public.toast_item_mappings tim
 WHERE pim.restaurant_id = tim.restaurant_id
   AND pim.source = 'toast'
   AND pim.external_item_id = tim.toast_guid;

-- Logs timeline (cross-cutting, locked): pos_checks, procurement_documents
-- and system_audit_log have no correlation_id today (only decision_log,
-- events and event_store do — read against the live schema, not the plan's
-- assumption). Add it as a plain nullable text column everywhere it is
-- missing so a single business event (a door receipt, a POS check closing)
-- can be tagged once and traced across tables. Existing rows stay NULL —
-- there is nothing to backfill correlation onto retroactively.
ALTER TABLE public.pos_checks
    ADD COLUMN IF NOT EXISTS correlation_id text;
CREATE INDEX IF NOT EXISTS idx_pos_checks_correlation
    ON public.pos_checks (correlation_id) WHERE correlation_id IS NOT NULL;

ALTER TABLE public.procurement_documents
    ADD COLUMN IF NOT EXISTS correlation_id text;
CREATE INDEX IF NOT EXISTS idx_procurement_documents_correlation
    ON public.procurement_documents (correlation_id) WHERE correlation_id IS NOT NULL;

ALTER TABLE public.system_audit_log
    ADD COLUMN IF NOT EXISTS correlation_id text;
CREATE INDEX IF NOT EXISTS idx_system_audit_log_correlation
    ON public.system_audit_log (correlation_id) WHERE correlation_id IS NOT NULL;

-- inventory_transactions gets no new column: it already carries `metadata`
-- jsonb (baseline) plus reference_type/reference_id/pos_transaction_id from
-- the apply_stock_movement extension migration. The timeline reads
-- correlation out of metadata->>'correlation_id' for this table rather than
-- widening the RPC contract a second time in one plan.
CREATE INDEX IF NOT EXISTS idx_inventory_transactions_correlation
    ON public.inventory_transactions ((metadata ->> 'correlation_id'))
    WHERE metadata ? 'correlation_id';

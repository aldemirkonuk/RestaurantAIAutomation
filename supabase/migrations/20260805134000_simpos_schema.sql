-- SimPOS testbed plan, decisions C23-C31: the fake POS terminal's own tables.
--
-- SimPOS communicates with WineOps only over a signed webhook (decision C25) —
-- these four tables are SimPOS's private state, never read directly by
-- WineOps code. That separation is what makes drift real: the catalog here
-- can diverge from pos_item_mappings/restaurant_inventory exactly the way a
-- real POS's item list drifts from what a restaurant stocks, and the drift
-- agent (cross-cutting) has something genuine to find.
--
-- Grain: simpos_catalog is keyed at wine + vintage + size_ml, one row per
-- sellable SKU, matching how a real POS PLU list works (decision C23 /
-- UI spec). The UI groups rows by wine_name; the schema does not need to.

CREATE TABLE public.simpos_catalog (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    restaurant_id uuid NOT NULL,
    external_item_id text DEFAULT gen_random_uuid()::text NOT NULL,
    wine_name text NOT NULL,
    producer text,
    vintage integer,
    size_ml integer DEFAULT 750 NOT NULL,
    price numeric(10,2) NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT simpos_catalog_pkey PRIMARY KEY (id),
    CONSTRAINT simpos_catalog_external_id_unique UNIQUE (restaurant_id, external_item_id)
);

CREATE INDEX idx_simpos_catalog_restaurant
    ON public.simpos_catalog (restaurant_id, wine_name)
    WHERE is_active;

-- C29: tables 1-20 ship in the schema now; the UI shows them as a visible,
-- disabled, future affordance (no ordering flow attaches to a table yet).
CREATE TABLE public.simpos_tables (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    restaurant_id uuid NOT NULL,
    table_number integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT simpos_tables_pkey PRIMARY KEY (id),
    CONSTRAINT simpos_tables_number_unique UNIQUE (restaurant_id, table_number),
    CONSTRAINT simpos_tables_number_range CHECK (table_number BETWEEN 1 AND 20)
);

-- C27: open, add lines, close. Only close fires the webhook (matches
-- decision B18: only closed/paid checks deplete real WineOps stock).
CREATE TABLE public.simpos_checks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    restaurant_id uuid NOT NULL,
    table_id uuid,
    status text DEFAULT 'open'::text NOT NULL,
    opened_at timestamp with time zone DEFAULT now() NOT NULL,
    closed_at timestamp with time zone,
    closed_by uuid,
    webhook_status text DEFAULT 'pending'::text NOT NULL,
    webhook_sent_at timestamp with time zone,
    webhook_error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT simpos_checks_pkey PRIMARY KEY (id),
    CONSTRAINT simpos_checks_status_check CHECK (status IN ('open', 'closed')),
    CONSTRAINT simpos_checks_webhook_status_check
        CHECK (webhook_status IN ('pending', 'sent', 'failed')),
    CONSTRAINT simpos_checks_table_fkey FOREIGN KEY (table_id)
        REFERENCES public.simpos_tables(id) ON DELETE SET NULL
);

CREATE INDEX idx_simpos_checks_restaurant
    ON public.simpos_checks (restaurant_id, opened_at DESC);
CREATE INDEX idx_simpos_checks_open
    ON public.simpos_checks (restaurant_id) WHERE status = 'open';

-- Loss (Home pane indicator) = sum over voided/comped lines' snapshot price *
-- qty, plus discounted lines' discount_amount. Computed at read time from
-- these columns rather than stored, so editing a line's status is a single
-- UPDATE instead of a recompute-and-write.
CREATE TABLE public.simpos_check_lines (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    restaurant_id uuid NOT NULL,
    check_id uuid NOT NULL,
    catalog_id uuid,
    item_name_snapshot text NOT NULL,
    vintage_snapshot integer,
    size_ml_snapshot integer,
    unit_price_snapshot numeric(10,2) NOT NULL,
    qty integer DEFAULT 1 NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    status_reason text,
    discount_amount numeric(10,2) DEFAULT 0 NOT NULL,
    added_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT simpos_check_lines_pkey PRIMARY KEY (id),
    CONSTRAINT simpos_check_lines_status_check
        CHECK (status IN ('active', 'voided', 'comped', 'discounted')),
    CONSTRAINT simpos_check_lines_check_fkey FOREIGN KEY (check_id)
        REFERENCES public.simpos_checks(id) ON DELETE CASCADE,
    CONSTRAINT simpos_check_lines_catalog_fkey FOREIGN KEY (catalog_id)
        REFERENCES public.simpos_catalog(id) ON DELETE SET NULL
);

CREATE INDEX idx_simpos_check_lines_check
    ON public.simpos_check_lines (check_id, added_at);

ALTER TABLE public.simpos_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.simpos_tables ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.simpos_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.simpos_check_lines ENABLE ROW LEVEL SECURITY;

-- Same posture as the rest of this schema: no anon/authenticated policies —
-- SimPOS is served by the NestJS service role like everything else here.

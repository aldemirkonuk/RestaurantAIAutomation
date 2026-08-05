-- Margin health + pricing agility (v3.0 task "item 5").
--
-- Two tables, with distinct jobs:
--
--   menu_price_versions  effective-dated history of OUR menu prices
--   pricing_analyses     what the engine computed, and why
--
-- Why versioning is a prerequisite rather than a nice-to-have
-- ----------------------------------------------------------
-- Historical revenue already survives a price change: sales_events.unit_price
-- and total_price record the price at the moment of sale. What does NOT
-- survive is margin. Every analytic that computes margin as
-- (current menu price - current cost) over a past window silently returns a
-- different answer once a price is updated — last month's margin changes
-- because someone repriced today, and the report stops reproducing.
--
-- menu_price_versions makes "what did this cost and sell for on 2026-06-14"
-- answerable, so margin over a past window can be computed from the price and
-- cost that were actually in effect.
--
-- The endogeneity marker
-- ---------------------
-- change_source and pricing_analysis_id exist for a specific statistical
-- reason, not for tidiness. The engine estimates elasticity by regressing
-- ln(quantity) on ln(price) across observed price points. That is only valid
-- while price variation is exogenous. Once the agent starts setting prices,
-- its own changes enter the series and the regression begins to learn from its
-- own decisions — classic simultaneity bias, and the failure mode of a
-- continuously-running pricing loop. Recording which price points the model
-- caused lets elasticity estimation weight or exclude them, instead of
-- quietly drifting.

CREATE TABLE public.menu_price_versions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    restaurant_id uuid NOT NULL,
    inventory_id uuid NOT NULL,

    bottle_price numeric,
    glass_price numeric,

    -- Cost basis in effect when this price took over. Denormalized on purpose:
    -- reconstructing it from inventory_lots at report time means replaying lot
    -- consumption, which is expensive and changes as lots are edited.
    unit_cost numeric,

    effective_from timestamp with time zone DEFAULT now() NOT NULL,
    -- NULL = currently in effect. Exactly one open row per inventory_id.
    effective_to timestamp with time zone,

    -- 'manual'          a human typed a price
    -- 'agent_accepted'  a human approved an engine recommendation
    -- 'import'          POS/menu sync
    -- 'backfill'        seeded from the current value when this table was added
    change_source text NOT NULL DEFAULT 'manual',
    changed_by uuid,
    pricing_analysis_id uuid,
    reason text,

    created_at timestamp with time zone DEFAULT now() NOT NULL,

    CONSTRAINT menu_price_versions_pkey PRIMARY KEY (id),
    CONSTRAINT menu_price_versions_source_check CHECK (
        change_source IN ('manual', 'agent_accepted', 'import', 'backfill')
    ),
    CONSTRAINT menu_price_versions_inventory_fkey FOREIGN KEY (inventory_id)
        REFERENCES public.restaurant_inventory(id) ON DELETE CASCADE
);

-- The "price in effect at time T" lookup, which is the whole point of the table.
CREATE INDEX idx_menu_price_versions_lookup
    ON public.menu_price_versions (inventory_id, effective_from DESC);

-- Enforce at most one open (current) row per item. A second open row would
-- make "the current price" ambiguous and silently pick one at random.
CREATE UNIQUE INDEX idx_menu_price_versions_one_open
    ON public.menu_price_versions (inventory_id)
    WHERE effective_to IS NULL;

CREATE INDEX idx_menu_price_versions_restaurant
    ON public.menu_price_versions (restaurant_id, effective_from DESC);


CREATE TABLE public.pricing_analyses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    restaurant_id uuid NOT NULL,
    inventory_id uuid NOT NULL,

    analyzed_at timestamp with time zone DEFAULT now() NOT NULL,
    -- 'cost_change' | 'scheduled' | 'manual'
    trigger text NOT NULL DEFAULT 'scheduled',

    -- State the analysis was run against.
    current_price numeric,
    unit_cost numeric,
    current_margin_pct numeric,

    -- What the engine suggests. NULL recommended_price is a valid, meaningful
    -- outcome: not enough signal to justify a number (see confidence).
    recommended_price numeric,
    projected_margin_pct numeric,
    projected_revenue_pct numeric,

    -- Elasticity and how much to trust it.
    elasticity numeric,
    -- 'loglog' (regression over >=3 price points) | 'midpoint' (2 points)
    -- | 'category_prior' (fallback when the item has no price variation)
    elasticity_method text,
    observation_count integer DEFAULT 0 NOT NULL,
    confidence numeric,

    -- Margin health. The floor is stored per-analysis rather than read live at
    -- render time, so a flag raised last week still explains itself after
    -- someone edits the threshold.
    margin_floor_pct numeric,
    margin_flagged boolean DEFAULT false NOT NULL,
    -- NULL when not flagged; 'warning' within 5pts of floor, 'critical' below.
    flag_severity text,

    -- The exact series fed to the estimator. This is the audit trail: without
    -- it a recommendation is an unfalsifiable number.
    inputs jsonb DEFAULT '{}'::jsonb NOT NULL,
    engine_version text,

    created_at timestamp with time zone DEFAULT now() NOT NULL,

    CONSTRAINT pricing_analyses_pkey PRIMARY KEY (id),
    CONSTRAINT pricing_analyses_trigger_check CHECK (
        trigger IN ('cost_change', 'scheduled', 'manual')
    ),
    CONSTRAINT pricing_analyses_severity_check CHECK (
        flag_severity IS NULL OR flag_severity IN ('warning', 'critical')
    ),
    CONSTRAINT pricing_analyses_method_check CHECK (
        elasticity_method IS NULL
        OR elasticity_method IN ('loglog', 'midpoint', 'category_prior')
    ),
    CONSTRAINT pricing_analyses_inventory_fkey FOREIGN KEY (inventory_id)
        REFERENCES public.restaurant_inventory(id) ON DELETE CASCADE
);

-- "latest analysis per item" drives the inventory column and the wine-library
-- badge; it is the hot read path.
CREATE INDEX idx_pricing_analyses_latest
    ON public.pricing_analyses (inventory_id, analyzed_at DESC);

-- "show me everything currently flagged" drives margin health.
CREATE INDEX idx_pricing_analyses_flagged
    ON public.pricing_analyses (restaurant_id, analyzed_at DESC)
    WHERE margin_flagged;

ALTER TABLE public.menu_price_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pricing_analyses ENABLE ROW LEVEL SECURITY;

-- Same posture as the rest of this schema: no anon/authenticated policies;
-- access is via the NestJS service role, which enforces tenancy from the JWT
-- and role-gates these reads to owner/manager.

-- Seed one open version row per item that already has a price, so historical
-- queries have a starting point instead of a gap. Marked 'backfill' precisely
-- so nobody mistakes these for observed price changes when estimating
-- elasticity — they are one synthetic point, not a price movement.
INSERT INTO public.menu_price_versions
    (restaurant_id, inventory_id, bottle_price, glass_price, unit_cost,
     effective_from, change_source, reason)
SELECT
    ri.restaurant_id,
    ri.id,
    ri.menu_price_current,
    ri.menu_price_glass,
    ri.last_purchase_price,
    COALESCE(ri.updated_at, now()),
    'backfill',
    'Seeded from restaurant_inventory when price versioning was introduced'
FROM public.restaurant_inventory ri
WHERE ri.menu_price_current IS NOT NULL;

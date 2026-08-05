-- SimPOS testbed plan: ingress unresolved-line queue (decision B20) and the
-- two review queues that make catalog matching (decisions D32-39) and the
-- drift agent's tiered autonomy (cross-cutting) durable/queryable rather than
-- log-only.
--
-- Same posture as the rest of this schema: RLS enabled, no anon/authenticated
-- policies — every access goes through the NestJS service role.

-- B20: today an unmapped POS line is silently dropped (never written
-- anywhere). This is where it lands instead, so "how many items came in that
-- we don't recognize" is a query, not a mystery.
CREATE TABLE public.pos_unresolved_lines (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    restaurant_id uuid NOT NULL,
    source text NOT NULL,
    external_check_id text,
    external_item_id text,
    item_name text NOT NULL,
    category text,
    qty numeric,
    price numeric,
    raw jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    resolved boolean DEFAULT false NOT NULL,
    resolved_at timestamp with time zone,
    resolved_inventory_id uuid,
    resolved_by uuid,
    CONSTRAINT pos_unresolved_lines_pkey PRIMARY KEY (id)
);

CREATE INDEX idx_pos_unresolved_lines_open
    ON public.pos_unresolved_lines (restaurant_id, created_at DESC)
    WHERE NOT resolved;

-- A retried webhook for the same check/line should not pile up duplicate
-- queue entries while the line is still open.
CREATE UNIQUE INDEX idx_pos_unresolved_lines_dedupe
    ON public.pos_unresolved_lines (restaurant_id, source, external_check_id, external_item_id)
    WHERE NOT resolved;

ALTER TABLE public.pos_unresolved_lines ENABLE ROW LEVEL SECURITY;

-- D32-39: catalog match proposals. Auto-mapped rows (confidence >= 0.9,
-- non-ambiguous) never appear here — they land directly in pos_item_mappings.
-- Everything else — suggested-but-unconfirmed and drift-agent-proposed
-- mappings alike — waits here for a human.
CREATE TABLE public.pos_catalog_match_proposals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    restaurant_id uuid NOT NULL,
    source text NOT NULL,
    external_item_id text NOT NULL,
    item_name text NOT NULL,
    candidate_inventory_id uuid,
    candidate_master_wine_id uuid,
    confidence numeric(4,3),
    match_method text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    resolved_at timestamp with time zone,
    resolved_by uuid,
    CONSTRAINT pos_catalog_match_proposals_pkey PRIMARY KEY (id),
    CONSTRAINT pos_catalog_match_proposals_method_check
        CHECK (match_method IN ('external_id', 'sku', 'trigram', 'manual', 'drift_agent')),
    CONSTRAINT pos_catalog_match_proposals_status_check
        CHECK (status IN ('pending', 'approved', 'rejected', 'auto_applied'))
);

CREATE INDEX idx_pos_catalog_match_proposals_open
    ON public.pos_catalog_match_proposals (restaurant_id, created_at DESC)
    WHERE status = 'pending';

CREATE UNIQUE INDEX idx_pos_catalog_match_proposals_dedupe
    ON public.pos_catalog_match_proposals (restaurant_id, source, external_item_id)
    WHERE status = 'pending';

ALTER TABLE public.pos_catalog_match_proposals ENABLE ROW LEVEL SECURITY;

-- Cross-cutting: drift agent findings. decision_log already gets one row per
-- run (every check, reasoning included) — this table is the durable subset
-- that actually needs a human decision (anything touching stock or money),
-- so the tiered-autonomy queue is a filtered query, not a log grep.
CREATE TABLE public.drift_findings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    restaurant_id uuid NOT NULL,
    finding_type text NOT NULL,
    severity text DEFAULT 'info'::text NOT NULL,
    details jsonb DEFAULT '{}'::jsonb NOT NULL,
    auto_healed boolean DEFAULT false NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    decision_log_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    resolved_at timestamp with time zone,
    resolved_by uuid,
    CONSTRAINT drift_findings_pkey PRIMARY KEY (id),
    CONSTRAINT drift_findings_type_check
        CHECK (finding_type IN ('new_item', 'price_change', 'removed_item', 'stock_mismatch')),
    CONSTRAINT drift_findings_severity_check
        CHECK (severity IN ('info', 'warning', 'critical')),
    CONSTRAINT drift_findings_status_check
        CHECK (status IN ('open', 'proposed', 'approved', 'rejected', 'resolved')),
    CONSTRAINT drift_findings_decision_log_fkey FOREIGN KEY (decision_log_id)
        REFERENCES public.decision_log(id) ON DELETE SET NULL
);

CREATE INDEX idx_drift_findings_open
    ON public.drift_findings (restaurant_id, created_at DESC)
    WHERE status IN ('open', 'proposed');

ALTER TABLE public.drift_findings ENABLE ROW LEVEL SECURITY;

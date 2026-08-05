-- Analytics Insight Infrastructure (tables/waiters/checks + goals + insights)
--
-- Backs the analytics insight engine (apps/api-gateway/src/analytics):
--   • restaurant_tables         — physical floor tables with geometry facts
--                                 (seats, zone, distances) for correlation and
--                                 driver-weight analytics
--   • restaurant_venue_profiles — venue attributes (pool, outside bar,
--                                 outdoor...) that condition metrics
--   • pos_checks                — POS-AGNOSTIC check staging (Toast, Square,
--                                 Lightspeed, Clover, manual). One row per
--                                 check with table/server attribution and an
--                                 items jsonb array for basket analytics.
--   • analytics_goals           — metric-linked goals with target + deadline
--   • analytics_insights        — stored top-K generated insight sentences
--   • analytics_insight_prefs   — per-category refresh cadence per restaurant
--
-- Convention matches 20260716010000_team_ops.sql:
-- service-role only (API gateway holds the key), RLS on, no anon policies.

-- ===========================================================================
-- 1. Physical tables (floor geometry)
-- ===========================================================================
create table if not exists restaurant_tables (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  label text not null,                         -- "4", "P2", "Bar 1"
  seats int not null default 2,
  zone text,                                   -- dining_room | bar | patio | pool | private
  is_outdoor boolean not null default false,
  distance_to_kitchen_m numeric(6, 2),         -- walking distance, meters
  distance_to_bar_m numeric(6, 2),
  distance_to_pool_m numeric(6, 2),
  x_pos numeric(8, 2),                         -- optional floor-plan coords
  y_pos numeric(8, 2),
  pos_refs jsonb not null default '{}'::jsonb, -- {"toast": "table-guid", "square": "..."}
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_restaurant_tables_label
  on restaurant_tables (restaurant_id, label);
create index if not exists idx_restaurant_tables_restaurant
  on restaurant_tables (restaurant_id) where is_active;

-- ===========================================================================
-- 2. Venue profile (features that condition the analytics)
-- ===========================================================================
create table if not exists restaurant_venue_profiles (
  restaurant_id uuid primary key,
  -- flexible feature bag: {"has_pool": true, "has_outside_bar": true,
  --  "outdoor_seating": true, "live_music": false, "rooftop": false, ...}
  features jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- ===========================================================================
-- 3. POS-agnostic check staging
--    Every POS integration (Toast, Square, Lightspeed, Clover) or manual
--    import normalizes into THIS shape; analytics only ever reads pos_checks.
-- ===========================================================================
create table if not exists pos_checks (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  source text not null,                        -- toast | square | lightspeed | clover | manual
  external_check_id text not null,             -- id in the source POS
  table_id uuid references restaurant_tables (id),
  server_external_id text,                     -- server id in the source POS
  server_name text,
  opened_at timestamptz not null,
  closed_at timestamptz,                       -- null = check still open (live)
  covers int,
  subtotal numeric(12, 2),
  total numeric(12, 2),
  tip numeric(12, 2),
  -- items: [{"name": "Ribeye", "category": "entree", "qty": 1,
  --          "price": 58.00, "is_wine": false, "master_wine_id": null}, ...]
  items jsonb not null default '[]'::jsonb,
  raw jsonb,                                   -- untouched source payload for audit
  imported_at timestamptz not null default now()
);

create unique index if not exists uq_pos_checks_source_check
  on pos_checks (restaurant_id, source, external_check_id);
create index if not exists idx_pos_checks_restaurant_opened
  on pos_checks (restaurant_id, opened_at desc);
create index if not exists idx_pos_checks_open_live
  on pos_checks (restaurant_id) where closed_at is null;
create index if not exists idx_pos_checks_table
  on pos_checks (table_id) where table_id is not null;

-- ===========================================================================
-- 4. Metric-linked goals
-- ===========================================================================
create table if not exists analytics_goals (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  name text not null,                          -- "July wine revenue push"
  metric_key text not null,                    -- key from the metric registry / measure keys
  target_value numeric(14, 2) not null,
  baseline_value numeric(14, 2),               -- value when the goal was set
  current_value numeric(14, 2) not null default 0, -- refreshed by the engine
  direction text not null default 'at_least',  -- at_least | at_most
  period text not null default 'custom',       -- day | week | month | quarter | custom
  deadline date,
  status text not null default 'active',       -- active | achieved | missed | archived
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_analytics_goals_restaurant
  on analytics_goals (restaurant_id, status);

-- ===========================================================================
-- 5. Stored insights (top-K per category, replaced on each refresh)
-- ===========================================================================
create table if not exists analytics_insights (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  candidate_key text not null,                 -- dimension.measure.comparator
  category text not null,                      -- sales | purchasing | inventory | efficiency
                                               -- | tables | staff | basket | risk | forecast | goals
  entity_key text,
  entity_label text,
  sentence text not null,                      -- the deterministic 1-2 sentence conclusion
  score numeric(8, 2) not null default 0,
  effect_pct numeric(10, 4),
  z_score numeric(10, 4),
  evidence jsonb not null default '{}'::jsonb, -- full numeric evidence for drill-down
  period_start date,
  period_end date,
  computed_at timestamptz not null default now()
);

create index if not exists idx_analytics_insights_restaurant
  on analytics_insights (restaurant_id, category, score desc);
create index if not exists idx_analytics_insights_computed
  on analytics_insights (restaurant_id, computed_at desc);

-- ===========================================================================
-- 6. Per-category refresh preferences (manager-controlled cadence)
-- ===========================================================================
create table if not exists analytics_insight_prefs (
  restaurant_id uuid not null,
  category text not null,
  cadence text not null default 'daily',       -- hourly | daily | weekly | manual
  hour_of_day int not null default 6,          -- local hour for daily/weekly runs
  enabled boolean not null default true,
  last_run_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (restaurant_id, category)
);

-- ===========================================================================
-- RLS — service-role only (API gateway mediates all access)
-- ===========================================================================
alter table restaurant_tables enable row level security;
alter table restaurant_venue_profiles enable row level security;
alter table pos_checks enable row level security;
alter table analytics_goals enable row level security;
alter table analytics_insights enable row level security;
alter table analytics_insight_prefs enable row level security;

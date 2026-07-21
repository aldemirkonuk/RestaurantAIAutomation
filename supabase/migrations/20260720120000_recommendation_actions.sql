-- Recommendation action state + manager digest preferences
--
-- Backs the Recommendations page act/dismiss/snooze/done/pin loop
-- (UX_PATHS_CATALOG.md NEW-284…NEW-308) and the daily digest toggle
-- (NEW-303). The Recommendations engine (recommendations.service.ts) is a
-- deterministic rule engine that regenerates cards on every request keyed by
-- a stable `rule_key`; this table stores the MANAGER'S disposition against
-- that key so state survives recompute. The same table is reused by the
-- Reports EngineInsightsPanel (NEW-434) keyed by `insight:<candidate_key>`.
--
-- Convention matches 20260717120000_analytics_insight_infra.sql:
-- service-role only (API gateway holds the key), RLS on, no anon policies.

-- ===========================================================================
-- 1. Recommendation action state (one current row per restaurant × rule_key)
-- ===========================================================================
create table if not exists recommendation_actions (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  -- Stable key of the thing acted on:
  --   • a recommendation ruleKey  ("stockout_imminent", "goal_behind_<id>")
  --   • an insight card           ("insight:<candidate_key>")
  rule_key text not null,
  -- Manager disposition. `active` = default/restored; the others hide the card
  -- from the default feed until restored (dismissed/done) or expiry (snoozed).
  status text not null default 'active',       -- active | dismissed | snoozed | done
  reason text,                                 -- dismiss/snooze reason code or free note
  snooze_until timestamptz,                    -- snoozed cards re-activate after this instant
  pinned boolean not null default false,       -- NEW-295: float to top of the feed / watchlist
  acted_at timestamptz,                        -- NEW-284/299: manager followed the Act deep-link
  feedback text,                               -- NEW-298: helpful | not_helpful
  -- Denormalised snapshot so History (NEW-302) reads without recompute.
  observation text,
  recommendation text,
  category text,
  urgency text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (restaurant_id, rule_key)
);

create index if not exists idx_recommendation_actions_restaurant
  on recommendation_actions (restaurant_id, status);
create index if not exists idx_recommendation_actions_pinned
  on recommendation_actions (restaurant_id) where pinned;
create index if not exists idx_recommendation_actions_updated
  on recommendation_actions (restaurant_id, updated_at desc);

-- ===========================================================================
-- 2. Per-restaurant digest preferences (NEW-303)
--    The daily "top recommendations to the manager inbox" toggle. The actual
--    send is driven by the analytics scheduler (feature-flagged); this row is
--    the durable manager-facing preference the toggle reads/writes.
-- ===========================================================================
create table if not exists recommendation_digest_prefs (
  restaurant_id uuid primary key,
  digest_enabled boolean not null default false,
  digest_hour int not null default 7,          -- local hour to send the daily digest
  digest_min_urgency text not null default 'this_week', -- now | this_week | this_month
  recipient_email text,                        -- optional override; defaults to owner
  last_sent_at timestamptz,
  updated_at timestamptz not null default now()
);

-- ===========================================================================
-- RLS — service-role only (API gateway mediates all access)
-- ===========================================================================
alter table recommendation_actions enable row level security;
alter table recommendation_digest_prefs enable row level security;

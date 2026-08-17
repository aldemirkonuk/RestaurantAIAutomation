-- N2 (BEVERAGE_CATALOGUE_PLAN.md): log recommendation IMPRESSIONS, not just
-- conversions, before any recommender (rule-based today, learned later) can
-- be trusted. recommendation_actions only records what a manager ACTED on
-- (dismiss/snooze/done/pin) — it has no "shown" event and no rank. A
-- recommender trained only on conversions learns its own priors: recommend,
-- it gets acted on, train on the action, recommend it harder, and the
-- long tail becomes invisible — invisibly, because offline metrics improve
-- as it degrades (arch §10.6 M1). This table is the guard: one row per
-- recommendation actually served, with its position in the list, so
-- "shown but never acted on" is a queryable fact, not a gap.
--
-- Deliberately NOT keyed to require an action to exist — an impression with
-- no corresponding recommendation_actions row for the same
-- (restaurant_id, rule_key) after `shown_at` IS the signal.

create table if not exists recommendation_impressions (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  rule_key text not null,
  category text,
  urgency text,
  score numeric,
  -- 1-indexed rank in the list as actually rendered to the user. Position
  -- matters as much as presence: a recommendation buried at position 14 was
  -- technically "shown" but not really seen.
  position smallint not null check (position > 0),
  pinned boolean not null default false,
  -- Which UI surface served it — recommendations.service.ts today,
  -- a future wine-pairing engine or command-palette surface later. Kept as
  -- free text (not an enum) because new surfaces are additive, not schema
  -- events.
  surface text not null default 'recommendations_page',
  -- Correlates every row from one getRecommendations() call, so "the list as
  -- shown at time T" can be reconstructed exactly, positions included.
  request_id uuid not null,
  shown_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

comment on table recommendation_impressions is
  'Every recommendation actually rendered to a user, with its rank. Exists so a learned recommender never trains on conversions alone — see BEVERAGE_CATALOGUE_PLAN.md N2 and BEVERAGE_CATALOGUE_ARCHITECTURE.md §10.6 (M1).';
comment on column recommendation_impressions.position is
  'Rank in the list as rendered (1 = top). Position is part of the signal, not metadata: a low-ranked, ignored recommendation is expected; a top-ranked, ignored one is informative.';
comment on column recommendation_impressions.request_id is
  'Groups every row emitted by one getRecommendations() call so the full served list can be reconstructed for any shown_at.';

-- Read pattern: "everything shown to restaurant X recently" and "how has
-- rule Y performed over time" are the two access paths; both restaurant-first.
create index if not exists idx_recommendation_impressions_restaurant
  on recommendation_impressions (restaurant_id, shown_at desc);
create index if not exists idx_recommendation_impressions_rule_key
  on recommendation_impressions (restaurant_id, rule_key, shown_at desc);
create index if not exists idx_recommendation_impressions_request
  on recommendation_impressions (request_id);

alter table recommendation_impressions enable row level security;

-- Telemetry table: written only by the service role (fire-and-forget from
-- RecommendationsService), never directly by a client. No end-user SELECT
-- policy is needed today; add one scoped to restaurant membership if a
-- future admin surface reads it directly instead of through an API.
create policy recommendation_impressions_service_role
  on recommendation_impressions
  for all
  to service_role
  using (true)
  with check (true);

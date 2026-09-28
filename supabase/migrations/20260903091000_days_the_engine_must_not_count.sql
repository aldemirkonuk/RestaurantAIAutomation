-- Days the engine must not count.
--
-- The insight generator builds every daily series with `toDaily`, which
-- bucketed rows by day and filled every gap with a literal 0. So a closure, a
-- POS outage and a genuinely dead Wednesday were the same number to every
-- baseline downstream, and the running gateway emitted, on 2026-09-03:
--
--     "Wednesday sales came in 100% lower than your average Wednesday
--      ($0 vs $104)."
--
-- Two repairs follow, and they are deliberately different mechanisms:
--
--   1. A day with NO ROWS is now unobserved, not zero. The generator withholds
--      the sentence instead of asserting a 100% collapse it cannot evidence.
--      That is code, not data — no table needed.
--
--   2. A day the MANAGER rules out — a closure, a private buyout, a flood — is
--      excluded here, and the engine drops it from the series entirely so it
--      can drag no average in either direction. That is judgement, and
--      judgement has to be stored, attributable and reversible.
--
-- Keeping (2) out of `recommendation_actions` is the point: that table records
-- what a manager did with a CARD. This records what the analysis may look at.
-- Merging them would make it impossible to answer "was this baseline computed
-- over a day someone excluded?" later, which is the only question that makes
-- the number trustworthy.

create table if not exists analytics_day_exclusions (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  -- The business date in the restaurant's own calendar, as the generator keys
  -- its daily buckets (`YYYY-MM-DD`). A date, not a timestamptz: "we were shut
  -- on the 2nd" has no instant and no zone.
  business_date date not null,
  reason text,
  -- No FK. `auth.users` and `public.users` are disjoint in this database (zero
  -- shared ids), the JWT carries `public.users.user_id`, and a FK to either one
  -- 23503s on the writes that come from the other — a failure CI cannot catch,
  -- because a fresh database has no rows to violate. `recommendation_actions`
  -- .created_by is unreferenced for the same reason; this column matches it.
  created_by uuid,
  created_at timestamptz not null default now(),
  constraint analytics_day_exclusions_unique unique (restaurant_id, business_date)
);

comment on table analytics_day_exclusions is
  'Business dates a manager has ruled out of the analytics baselines (closures, buyouts, outages). Consulted by InsightGeneratorService when it builds any daily series; a day listed here is dropped from the series entirely rather than counted as zero.';
comment on column analytics_day_exclusions.business_date is
  'The day to ignore, in the restaurant''s own calendar, matching the generator''s daily bucket key (YYYY-MM-DD).';
comment on column analytics_day_exclusions.reason is
  'Free text from the manager ("closed for the holiday"). Rendered back to them so an exclusion is never anonymous.';

-- The engine reads the whole set for one restaurant on every insight run.
create index if not exists idx_analytics_day_exclusions_restaurant
  on analytics_day_exclusions (restaurant_id, business_date desc);

alter table analytics_day_exclusions enable row level security;

-- Written and read through the gateway (service role), never by a browser
-- directly — same posture as recommendation_impressions. DROP first so this
-- migration is re-runnable.
drop policy if exists analytics_day_exclusions_service_role
  on analytics_day_exclusions;
create policy analytics_day_exclusions_service_role
  on analytics_day_exclusions
  for all
  to service_role
  using (true)
  with check (true);

-- The per-restaurant switch for the Arrival book at /get-started (ADR 0113,
-- ADR 0143, ADR 0144; sketch 121). OFF by default, same reasoning as every
-- other column in this shape: `settings.service.ts` joins every
-- ACTIVE_FEATURE_FLAGS key into one `.select()`, and PostgREST answers a
-- missing column with 42703, so promoting `mudavym_design_arrival` without
-- this column would 500 the whole Settings read for every restaurant, not
-- just fail this one flag.
--
-- Version note (PR #414 BLOCK): earlier drafts shipped this file as
-- 20260919050000, behind main's applied ceiling. Renamed to 20260922231300
-- so the runner actually applies it; the registry entry in
-- feature-flag-registry.ts ships in the same change.
--
-- FALSE is the default and the point: `/get-started` keeps rendering today's
-- GetStarted onboarding for every house until this is deliberately turned on.

alter table public.restaurant_feature_flags
  add column if not exists mudavym_design_arrival boolean not null default false;

comment on column public.restaurant_feature_flags.mudavym_design_arrival is
  'On the ''restaurant_settings'' row only. TRUE renders the Arrival book (flyleaf + contents page, direction C) at /get-started for this restaurant (ADR 0113/0143/0144); FALSE (default) keeps today''s GetStarted onboarding.';

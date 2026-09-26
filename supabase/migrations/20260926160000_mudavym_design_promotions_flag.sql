-- The per-restaurant switch for /promotions on Mudavym (ADR 0160 §113,
-- sketch 113 direction B with C's density; ADR 0165's sizing rule). OFF by
-- default, same shape as every other column of this kind:
-- `settings.service.ts` joins every ACTIVE_FEATURE_FLAGS key into one
-- `.select()`, and PostgREST answers a missing column with 42703, so
-- registering `mudavym_design_promotions` without this column would 500 the
-- whole Settings read for every restaurant, not just fail this one flag. The
-- registry entry (feature-flag-registry.ts) ships in the same change.
--
-- FALSE is the default and the point: `/promotions` keeps rendering today's
-- three-tab Promotions page (offers, Trusted senders, Prospects) for every
-- house until this is deliberately turned on. It should not be turned on for
-- a house before "Who is writing" (PR #470) is live on /communications — the
-- legacy page is today's only screen for trusting a sender or acting on a
-- prospect, and the rebuilt page holds offers only (ADR 0160 §113, open
-- item 3, answered 2026-09-18).

alter table public.restaurant_feature_flags
  add column if not exists mudavym_design_promotions boolean not null default false;

comment on column public.restaurant_feature_flags.mudavym_design_promotions is
  'On the ''restaurant_settings'' row only. TRUE renders /promotions on Mudavym (sketch 113 direction B, ADR 0160 §113 / ADR 0165) for this restaurant; FALSE (default) keeps today''s three-tab Promotions page.';

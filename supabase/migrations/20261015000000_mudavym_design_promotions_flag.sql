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
--
-- Renamed 2026-09-27 (PR #474 merge-train update, train 4): main added
-- 20260928000000_a_promotion_remembers_being_alerted.sql (#485) while this PR
-- was in flight; re-versioned from 20260926160000 past that ceiling, keeping
-- order with the dismissal column that follows it. Body unchanged.
--
-- Renamed a second time 2026-09-27 (PR #474 merge-train update, train 5):
-- 20260929010000 sorts below origin/main's newest (20260930100100, from the
-- ADR 0218 Away work merged during this train's run), which fails ADR 0212's
-- ordering guard (check_migration_order.py). Re-versioned from 20260929010000
-- to 20260930150000, past that ceiling and clear of every open PR's
-- migrations measured at rename time (`gh pr list --json number,files`,
-- highest seen: #476's 20260929200000), keeping order with the dismissal
-- migration that follows it. Body unchanged.
--
-- Renamed a third time 2026-09-27 (PR #474 merge-train update, train 5,
-- second hop): 20260930150000 collided with open PR #436
-- (feat/finish-action-integrity), which claimed the identical version the
-- same afternoon; CI's check_migration_versions_unique.py caught it (the
-- guard checks origin/main plus every OTHER open PR, so a same-day sibling
-- picking the same timestamp is exactly the race it exists to catch).
-- Re-versioned from 20260930150000 to 20261015000000, clear of every open
-- PR's migrations re-scanned at that time (`gh pr list --json number,files`,
-- highest seen: #473's 20261002000000), keeping order with the dismissal
-- migration that follows it. Body unchanged.

alter table public.restaurant_feature_flags
  add column if not exists mudavym_design_promotions boolean not null default false;

comment on column public.restaurant_feature_flags.mudavym_design_promotions is
  'On the ''restaurant_settings'' row only. TRUE renders /promotions on Mudavym (sketch 113 direction B, ADR 0160 §113 / ADR 0165) for this restaurant; FALSE (default) keeps today''s three-tab Promotions page.';

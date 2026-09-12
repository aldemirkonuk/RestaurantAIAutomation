-- ADR 0133 (2026-09-06) — the per-restaurant switch for `/logs`, OFF by
-- default like every mudavym_design_* column.
--
-- Scoped to this one column, not the ten of `20260907010000` on the
-- new-pages branch: that migration also covers nine other routes
-- (/get-started, /promotions, /vendor-prices, /recommendations/catalog,
-- /help, /admin, /admin_health, /authorize_integration, /ask) whose code is
-- not shipping to main in this change. `settings.service.ts` joins EVERY key
-- in ACTIVE_FEATURE_FLAGS into one `.select()`, and PostgREST answers a
-- missing column with 42703 — so a flag reaches ACTIVE_FEATURE_FLAGS and its
-- migration in the SAME change, never one ahead of the other. When the other
-- nine pages are ready for main, they get the remaining nine columns in
-- their own migration at that time, not reserved here.

alter table public.restaurant_feature_flags
  add column if not exists mudavym_design_logs boolean not null default false;

comment on column public.restaurant_feature_flags.mudavym_design_logs is
  'ADR 0133 (2026-09-06). OFF by default. Gates the Mudavym redesign of /logs (apps/web/src/pages/logs/next/LogsNext.tsx) via PageGate(page="logs"). Founder verdict on the design: KEEP.';

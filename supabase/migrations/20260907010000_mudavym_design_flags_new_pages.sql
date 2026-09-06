-- ADR 0133 (2026-09-06) — the per-restaurant switches for the pages not yet
-- rebuilt (ADR 0131 Stream G), OFF by default like every mudavym_design_* column.
--
-- Why one migration with ten columns: `settings.service.ts` joins EVERY key in
-- ACTIVE_FEATURE_FLAGS into one `.select()`, and PostgREST answers a missing
-- column with 42703 — promoting a flag to ACTIVE without its column would 500
-- the whole Settings read for every restaurant (20260831090000 was written
-- after exactly that defect). Ten flags, one shape, one file.
--
-- Not here, by decision: the nine PUBLIC routes (/login, /register, the
-- password pages, /verify-email, /invite/:code, /no-access, /privacy, /v/:slug).
-- A visitor there has no house, so a per-house column can never turn them on;
-- they read the deployment switch VITE_MUDAVYM_PUBLIC (ADR 0133 §Decision 1).
--
-- `mudavym_design_ask` is a NEW route, not a redesign (ADR 0133 §Decision 2):
-- FALSE means /ask does not exist for this house and the gate redirects.

alter table public.restaurant_feature_flags
  add column if not exists mudavym_design_get_started boolean not null default false;

alter table public.restaurant_feature_flags
  add column if not exists mudavym_design_promotions boolean not null default false;

alter table public.restaurant_feature_flags
  add column if not exists mudavym_design_vendor_prices boolean not null default false;

alter table public.restaurant_feature_flags
  add column if not exists mudavym_design_recommendations_catalog boolean not null default false;

alter table public.restaurant_feature_flags
  add column if not exists mudavym_design_logs boolean not null default false;

alter table public.restaurant_feature_flags
  add column if not exists mudavym_design_help boolean not null default false;

alter table public.restaurant_feature_flags
  add column if not exists mudavym_design_admin boolean not null default false;

alter table public.restaurant_feature_flags
  add column if not exists mudavym_design_admin_health boolean not null default false;

alter table public.restaurant_feature_flags
  add column if not exists mudavym_design_authorize_integration boolean not null default false;

alter table public.restaurant_feature_flags
  add column if not exists mudavym_design_ask boolean not null default false;

comment on column public.restaurant_feature_flags.mudavym_design_get_started is
  'TRUE renders the Mudavym arrival at /get-started for this restaurant (ADR 0133; the direction the founder picks from sketch 104); FALSE (default) renders the legacy activation flow.';

comment on column public.restaurant_feature_flags.mudavym_design_promotions is
  'TRUE renders the Mudavym /promotions for this restaurant (ADR 0133); FALSE (default) renders legacy.';

comment on column public.restaurant_feature_flags.mudavym_design_vendor_prices is
  'TRUE renders the Mudavym /vendor-prices for this restaurant (ADR 0133); FALSE (default) renders legacy.';

comment on column public.restaurant_feature_flags.mudavym_design_recommendations_catalog is
  'TRUE renders the Mudavym /recommendations/catalog for this restaurant (ADR 0133); FALSE (default) renders legacy.';

comment on column public.restaurant_feature_flags.mudavym_design_logs is
  'TRUE renders the Mudavym /logs for this restaurant (ADR 0133); FALSE (default) renders legacy.';

comment on column public.restaurant_feature_flags.mudavym_design_help is
  'TRUE renders the Mudavym /help for this restaurant (ADR 0133); FALSE (default) renders legacy.';

comment on column public.restaurant_feature_flags.mudavym_design_admin is
  'TRUE renders the Mudavym /admin for this restaurant (ADR 0133; the route stays owner-only); FALSE (default) renders legacy.';

comment on column public.restaurant_feature_flags.mudavym_design_admin_health is
  'TRUE renders the Mudavym /admin/health for this restaurant (ADR 0133; the route stays owner-only); FALSE (default) renders legacy.';

comment on column public.restaurant_feature_flags.mudavym_design_authorize_integration is
  'TRUE renders the Mudavym consent page at /authorize/:integrationId for this restaurant (ADR 0133); FALSE (default) renders legacy.';

comment on column public.restaurant_feature_flags.mudavym_design_ask is
  'On the restaurant_settings row only. TRUE makes /ask exist for this restaurant — the page where the house answers as Mudavym (ADR 0133 §Decision 2–3); FALSE (default) redirects, because the surface is new rather than a redesign.';

-- The founder's pick of 2026-09-21 (sketch 119, direction D "the counter";
-- ADR 0149 row 5, the shell rebuilt as house chrome): the per-restaurant switch
-- for the Mudavym app shell — the rooms rail, the house header, the counter
-- and the phone's four doors. OFF by default like every mudavym_design_*
-- column, so the founder previews it through the browser override
-- (localStorage `mudavym.design.shell`) before it is turned on for a house;
-- with it off, the legacy `Sidebar` / `DashboardLayout` stays the path.
--
-- Additive and idempotent. No new table (so no new RLS surface): one boolean
-- on the reserved settings row of `restaurant_feature_flags`, the same shape
-- as 20260912080000's `/logs` column. `settings.service.ts` selects EVERY key
-- in ACTIVE_FEATURE_FLAGS in one `.select()`, and PostgREST answers a missing
-- column with 42703 — so this column and its registry entry
-- (`apps/api-gateway/src/settings/feature-flag-registry.ts`) ship in the SAME
-- change, never one ahead of the other.

alter table public.restaurant_feature_flags
  add column if not exists mudavym_design_shell boolean not null default false;

comment on column public.restaurant_feature_flags.mudavym_design_shell is
  'Founder pick 2026-09-21 (sketch 119 D, ADR 0149 row 5). OFF by default. Gates the Mudavym app shell (apps/web/src/components/mudavym/HouseShell.tsx) via useMudavymDesign("shell") in DashboardLayout; off, the legacy Sidebar layout renders.';

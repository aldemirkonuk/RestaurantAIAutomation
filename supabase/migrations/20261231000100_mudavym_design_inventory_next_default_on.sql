-- New houses get InventoryNext at /inventory by default (ADR 0315; founder,
-- 2026-10-31: "Default ON (Recommended)").
--
-- Every house that existed on 2026-10-31 already has the column TRUE (the
-- coordinator's flip after #677; ADR 0315:43), so this changes only rows
-- inserted from now on. It writes no existing row. A house with NO settings row
-- is answered by the gateway registry's `defaultValue` instead, which flips to
-- true in this same change (apps/api-gateway/src/settings/feature-flag-registry.ts).
-- The version is provisional: it is renumbered past main's newest at merge.

alter table public.restaurant_feature_flags
  alter column mudavym_design_inventory_next set default true;

comment on column public.restaurant_feature_flags.mudavym_design_inventory_next is
  'On the ''restaurant_settings'' row only. TRUE (default since 2026-10-31) renders InventoryNext at /inventory for this restaurant (ADR 0315); FALSE keeps the command page.';

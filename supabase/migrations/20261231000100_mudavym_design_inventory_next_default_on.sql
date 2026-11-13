-- New houses get InventoryNext at /inventory by default (ADR 0315; founder,
-- 2026-10-31: "Default ON (Recommended)").
--
-- Every house measured on production at 2026-10-31 20:44Z (15 of 15, each with
-- a settings row) had the column TRUE after the coordinator's flip (ADR
-- 0315:43). This changes only the default for rows inserted after it is
-- applied; it writes no existing row, so a house created between that
-- measurement and the apply keeps whatever it was given. A house with NO settings row
-- is answered by the gateway registry's `defaultValue` instead, which flips to
-- true in this same change (apps/api-gateway/src/settings/feature-flag-registry.ts).
-- The version is final, not a placeholder. Main's and production's newest is
-- 20261231000000 (mudavym_design_inventory_next_flag, #677; read from
-- supabase_migrations.schema_migrations at 2026-10-31), and this sorts just
-- after it, as scripts/check_migration_order.py requires of every new file.

alter table public.restaurant_feature_flags
  alter column mudavym_design_inventory_next set default true;

comment on column public.restaurant_feature_flags.mudavym_design_inventory_next is
  'On the ''restaurant_settings'' row only. TRUE (the default from this migration; founder 2026-10-31) renders InventoryNext at /inventory for this restaurant (ADR 0315); FALSE keeps the command page.';

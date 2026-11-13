-- The per-restaurant switch that picks which page `/inventory` draws (ADR 0315,
-- 2026-10-30 amendment; founder: "New dark flag, port, flip").
--
-- `/inventory` is in LIVE_PAGES, so its PageGate always renders `next`. Inside
-- it, `InventoryRoute` reads this column: TRUE renders InventoryNext (the
-- makeover-B rebuild), FALSE keeps the command page every house runs today.
-- It defaults FALSE; the coordinator turns it on for every house once this
-- merges (founder, later 2026-10-30: "Flip now, port with wave"; inventory.md §16.4).
--
-- Same shape as mudavym_design_arrival: `settings.service.ts` joins every
-- ACTIVE_FEATURE_FLAGS key into one `.select()`, and PostgREST answers a
-- missing column with 42703, so the registry entry ships with this column.
-- The version is provisional: it is renumbered past main's newest at merge.

alter table public.restaurant_feature_flags
  add column if not exists mudavym_design_inventory_next boolean not null default false;

comment on column public.restaurant_feature_flags.mudavym_design_inventory_next is
  'On the ''restaurant_settings'' row only. TRUE renders InventoryNext at /inventory for this restaurant (ADR 0315); FALSE (default) keeps the command page.';

## The inventory margin sort ranks on the library's cost, not the house's — OPEN — 2026-11-07

Filed by `fix/no-invented-glass-cost` (recipes walk, proposal §3 lane A5; gaps G16, G21), which removed the invented "three times cost" menu price from the sort.

**What is true.** `marginPercent` in `apps/web/src/pages/inventory/useInventoryPage.ts` now reads the house's own price (`menuPriceBottle`, ADR 0193) and returns null, sorting last, when the price or the cost is unknown. Its cost is still `item.price`, the library wine's figure (`fallback.price` is `0` for an unresolved row). The house's own weighted cost, `item.wac`, is on the same row and unused here. No screen calls `toggleSort` today (`git grep -n toggleSort apps/web/src` finds only the hook and its test), so no displayed figure is wrong; the sort is reachable only through the hook.

**What closes it.** The sort reads `wac` when the house has one, and the cost basis is stated once for every margin figure on the inventory surfaces.

## `glassesPerBottle` is a count on the server, money only on the web — NOTE — 2026-11-07

Filed with the entry above; read-only trace the proposal's §6 left open.

**What is true.** `apps/api-gateway/src/inventory/inventory.service.ts:91-95` computes `glassesPerBottle` (override, else `floor(bottle ml / pour ml)`, pour defaulting to the house's `default_pour_ml` or 150) and only serialises it (`:137`). No gateway or `services/` path multiplies it by a price. The baseline view `inventory_volume_details` (`supabase/migrations/20260805000000_baseline_from_production.sql:3617`) derives the same count and volumes, no money, and nothing in `apps/` or `services/` reads the view. The one money derivation is the web's `costPerGlass` (`apps/web/src/utils/volumeUtils.ts:86`), owned by lane `recipes-a4`.

**What closes it.** Nothing in this lane; lane A4 settles `costPerGlass`.

## A failed design-flag read gives the house the command page until the page is reloaded, silently — OPEN — 2026-10-31

Filed by `docs/inventory-677-gate-and-flip-record` (#702), from its review.

**What happens.** `fetchFlag` in `apps/web/src/lib/mudavym/useMudavymDesign.ts` ends in `.catch(() => false)` and keeps the promise in `flagCache`, a module-level `Map` that only tests clear (`clearMudavymDesignCache`), so it lasts until the page is reloaded. `/inventory` picks its page from that flag (`InventoryRoute.tsx`), and the flag is on for every house since 2026-10-31 (ADR 0315:43). So a flag read that fails once (a 5xx, a timeout) gives that house the command page instead of InventoryNext until the page is reloaded, and nothing on the page says a read failed.

**Why it matters.** The comment at `useMudavymDesign.ts:271` says this is meant ("legacy, never a broken page"), but I found no ADR recording that choice (a grep of `.planning/decisions/`), and for the page it now picks it is in tension with ADR 0315:42, which governs the page's own failed figures ("failures are said in the house's words"). The CI audit's correctness note on #677 opened a `### The defect` section at `useMudavymDesign.ts:354` and was cut off (comment 6540532939), and nobody has re-audited that code at the merged SHA, so whether this is what the note meant is not known (`07-reference/pr-audits/677-07a40db.md`).

**Not decided.** What a failed read should do instead (retry, say it in the house's words, or fall back as now with a mark) is not decided; it is filed as OD-231 (`OPEN-DECISIONS.md`, the section filed 2026-10-31 at the end).

**Re-check.** CLAIMS `DESIGN-FLAG-READ-FAILURE-IS-NOT-CACHED-AS-OFF` (status `open`) fails to hold while `.catch(() => false)` is in `useMudavymDesign.ts`.

## New houses still get the command page until the default-on change lands — CLOSED on `feat/inventory-next-default-on` — 2026-10-31

Filed by `docs/inventory-677-gate-and-flip-record` (#702).

**What happens.** The founder chose on 2026-10-31 that new houses get InventoryNext by default (ADR 0315's review trail). Until that ships, a house created after the flip gets the command page: its settings row, or the gateway registry's `defaultValue` when it has no row, says false (`apps/api-gateway/src/settings/feature-flag-registry.ts`, the `mudavym_design_inventory_next` entry).

**Owed.** Branch `feat/inventory-next-default-on`: the column default and the registry default both move to true, with no existing row written. [CLOSED 2026-10-31 on that branch: migration `mudavym_design_inventory_next_default_on` and the registry entry; tests in `settings.service.spec.ts`.]

**Re-check.** CLAIMS `NEW-HOUSES-GET-INVENTORY-NEXT-BY-DEFAULT` (registry default) and `NEW-HOUSE-ROWS-DEFAULT-TO-INVENTORY-NEXT` (column default), both status `resolved` [changed 2026-10-31 on `feat/inventory-next-default-on`: the first was `open` until then].

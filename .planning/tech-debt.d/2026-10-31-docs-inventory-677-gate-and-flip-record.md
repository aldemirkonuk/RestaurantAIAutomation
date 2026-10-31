## A failed design-flag read gives the house the command page for the whole session, silently — OPEN — 2026-10-31

Filed by `docs/inventory-677-gate-and-flip-record` (#702), from its review.

**What happens.** `fetchFlag` in `apps/web/src/lib/mudavym/useMudavymDesign.ts` ends in `.catch(() => false)` and keeps the promise in `flagCache` for the session. `/inventory` picks its page from that flag (`InventoryRoute.tsx`), and the flag is on for every house since 2026-10-31 (ADR 0315:43). So a flag read that fails once (a 5xx, a timeout) gives that house the command page instead of InventoryNext until the next session, and nothing on the page says a read failed.

**Why it matters.** It is the shape the repo rules out elsewhere: a failed read shown as an answer. The CI audit's correctness note on #677 stopped mid-sentence at `useMudavymDesign.ts:354` (comment 6540532939), and nobody has re-audited that code at the merged SHA, so whether this is what the note meant is not known (`07-reference/pr-audits/677-07a40db.md`).

**Not decided.** What a failed read should do instead (retry, say it in the house's words, or fall back as now with a mark) is not decided; the fix decides it, or files an OD if it is the founder's call.

**Re-check.** CLAIMS `DESIGN-FLAG-READ-FAILURE-IS-NOT-CACHED-AS-OFF` (status `open`) fails to hold while `.catch(() => false)` is in `useMudavymDesign.ts`.

## New houses still get the command page until the default-on change lands — OPEN — 2026-10-31

Filed by `docs/inventory-677-gate-and-flip-record` (#702).

**What happens.** The founder chose on 2026-10-31 that new houses get InventoryNext by default (ADR 0315's review trail). Until that ships, a house created after the flip gets the command page: its settings row, or the gateway registry's `defaultValue` when it has no row, says false (`apps/api-gateway/src/settings/feature-flag-registry.ts`, the `mudavym_design_inventory_next` entry).

**Owed.** Branch `feat/inventory-next-default-on`: the column default and the registry default both move to true, with no existing row written.

**Re-check.** `grep -n -A12 '"mudavym_design_inventory_next"' apps/api-gateway/src/settings/feature-flag-registry.ts | grep defaultValue` says `false` while this is open.

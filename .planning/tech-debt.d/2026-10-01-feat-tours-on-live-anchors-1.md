## Two tour lines say "wine" and will go stale when the menu carries every drink — OPEN — 2026-10-01

Filed by `feat/tours-on-live-anchors-1` (PR #571), from its gate plan. Line numbers are at that branch's head after this fragment.

**What.** Two tour steps name wine because the panels they point at count only wine today:
- `apps/web/src/guidance/content/dashboard.ts` low-stock step: "Wines below their minimum…". The panel reads `wineName` (`apps/web/src/pages/dashboard/next/RailPanels.tsx:119`).
- `apps/web/src/guidance/content/providers.ts` `scope-menu` step: "…for a wine on your current menu." The page's own line counts `menu.wines` (`apps/web/src/pages/providers/next/VendorScopes.tsx:199-205`).

The founder ruled on 2026-10-01 that the menu carries every drink, with a table per kind (ADR 0115 amendment owed). When those panels count other drinks, these two lines will say less than the page, and nothing checks tour text against panel data.

**Fix.** Change both lines in the same PR that widens each panel past wine.

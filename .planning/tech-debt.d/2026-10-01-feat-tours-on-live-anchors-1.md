## Two tour lines say "wine" and will go stale when the menu carries every drink — OPEN — 2026-10-01

Filed by `feat/tours-on-live-anchors-1` (PR #571), from its gate plan. Line numbers are at that branch's head after this fragment.

**What.** Two tour steps name wine because the panels they point at count only wine today:
- `apps/web/src/guidance/content/dashboard.ts` low-stock step: "Wines below their minimum…". The panel reads `wineName` (`apps/web/src/pages/dashboard/next/RailPanels.tsx:119`).
- `apps/web/src/guidance/content/providers.ts` `scope-menu` step: "…for a wine on your current menu." The page's own line counts `menu.wines` (`apps/web/src/pages/providers/next/VendorScopes.tsx:199-205`).

The founder ruled on 2026-10-01 that the menu carries every drink, with a table per kind (ADR 0115 amendment owed). When those panels count other drinks, these two lines will say less than the page, and nothing checks tour text against panel data.

**Fix.** Change both lines in the same PR that widens each panel past wine.

## Staff are offered the Connections tour, and its skip hides every other tip for the session — OPEN — 2026-10-01

Filed by `feat/tours-on-live-anchors-1` (PR #571), from its adversarial review.

**What.** This PR maps `/connections` to the `settings-services` tour (`apps/web/src/guidance/types.ts:118`). Before it, `/connections` had no tour, so staff saw no tip there. Now a staff person gets the "Take tour" tip on a page that tells them it is for managers and owners (`apps/web/src/pages/connections/next/ConnectionsNext.tsx:304`). Its sections are not drawn for them, so the engine finds no step and calls `onSkipped`, which counts toward the session's skip limit (`apps/web/src/guidance/GuidanceProvider.tsx:220-225`). One click on the tip plus one Help replay (`apps/web/src/guidance/components/LearnPanel.tsx:42-45`, not role-filtered) reaches two skips, and every other page's tip is hidden for the rest of the session (`GuidanceProvider.tsx:260`).

**Fix.** Offer a tour only to a role that can see its page, in both the tip and the Help replay list. Separately, a tour that finds no step should not count as the person skipping it.

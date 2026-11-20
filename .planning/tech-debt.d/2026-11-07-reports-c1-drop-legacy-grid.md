## Dead legacy report-grid components deleted; prose leftovers stay as history — 2026-11-07 (chore/reports-drop-legacy-grid)

Lane C1 of the /reports build proposal (Phase E, gap G21). Founder /goal 2026-11-07 delegated every fork ("Do not ask me any questions I approve you decide them all"), so every call below is this session's.

**What went.** Five components under `apps/web/src/components/reports/`, 1,798 lines: `ChartArrangementModal.tsx` (306), `ChartConfigModal.tsx` (294), `DashboardGrid.tsx` (424), `EditLayoutPanel.tsx` (536), `WidgetSelector.tsx` (238). Before the change, all 20 `git grep` hits for the five names under `apps packages` were inside those five files. The only imports were the type imports from `ChartConfigModal` in `ChartArrangementModal` and `EditLayoutPanel`. No route, page or test reached them. `components/reports/preview/` and its tests stay, because `components/documents/GmailTemplateBuilder.tsx` imports preview.

**Also fixed.** `apps/web/src/pages/reports/next/Sheet.tsx` had a header comment that named `components/reports/DashboardCanvas` as the canvas. That file is gone (see `.planning/07-reference/legacy-web-archive-2026-09-29.md`). The comment now names the engine, `react-grid-layout`, and drops the dead path.

**Leftovers (not done here, on purpose).**
1. *Prose still names the five files.* `.planning/06-pages/reports.md` (around lines 721-725), `brand/BUILDPROMPT.md`, `sketches/102-modal-census`, `COLOR-AUDIT-WEB.md` and `07-reference` all still mention them. Those rows already say "Delete", so they stand as historical records. `06-pages/reports.md` was left alone because open PR #564 edits it. `08-softwares/reports-analytics.md` belongs to lane D1.
2. *Dependencies.* The deleted files imported only `react`, `framer-motion` and `lucide-react`. After the deletion, `framer-motion` is still imported by 50 files and `lucide-react` by 185. No dependency is left used only by the deleted files, so `package.json` has nothing to remove. Had there been one, it would have been a separate lane.

**Check.** `git grep -nE "ChartArrangementModal|ChartConfigModal|DashboardGrid|EditLayoutPanel|WidgetSelector" -- apps packages` should print nothing.

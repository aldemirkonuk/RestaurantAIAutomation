# g2 tax-basis build, 2026-11-19

Gap verified real at the owner tip (#1589 head 12f870cdb): `pourCostShare` and `marginPerServe` in DrinkCards.tsx divided by the listed price; its own comment said the tax basis was not recorded. The basis (restaurants.tax_basis) exists only in the unmerged stack #1459 -> #1473 -> #1481 (+#1461).

PR #1913 (draft), branch feat/g2-pour-cost-uses-tax-basis, base feat/a-drinks-cards-open-what-they-sum (#1589). 7 web files: listTax.ts (pure), useListTax.ts (reads GET /settings/tax-basis), DrinkCards.tsx, RecipeSheet.tsx + tests.
Tests: vitest src/pages/cellar 29 files/591 pass; tsc --noEmit clean; vite build ok.
Mutation: 4 mutants (share, margin, sheet prop, no-rate) all killed.

Left (not done):
- A house's menu tax rate has no home (no column, readout, settings field; ADR 0359 C5 rate bands not built anywhere). Tax-inclusive houses read "no rate recorded", no number. Helper already takes ratePct (hook passes null).
- Server-side: pricing/margin-to-target.ts, margin advice, analytics marginPct, check margin (#1815) still use the listed price. Need the same rate source; do after the rate exists.
- #1913 depends on #1473 merging first (GET /settings/tax-basis); until then every house reads "could not be read" and figures stay as listed.
- g2-menu-dishes touches DrinkCards.tsx/RecipeSheet.tsx on a different base: expect a text conflict at merge.

Browser checks owed: see PR #1913 body (5 checks).

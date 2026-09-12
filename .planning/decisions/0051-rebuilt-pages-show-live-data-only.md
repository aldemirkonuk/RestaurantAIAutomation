# 0051 — A rebuilt page shows live data or says it does not know

- **Status:** Locked
- **Date:** 2026-09-01
- **Decider:** Aldemir (founder) — *"new pages won't show any hard coded or anything, pre-installed data. Everything will be live data from now on."*
- **Keywords:** live data, hardcoded, mock, seed, placeholder, honesty, em dash, dashboard, page rebuild, redesign, fixtures
- **Links:** [[0020-no-fabricated-answers]], [[0024-identity-first-signin]], [[0044-mudavym-implementation-kickoff]], `.planning/06-pages/dashboard.md`

## Context

Forced by the dashboard extraction on 2026-09-01, the first page of the ten-page
rebuild. The legacy dashboard was measured and found to state four things the
backend cannot know:

- `apps/web/src/pages/Dashboard.tsx:327-353` — **"Top Performing Wines · this
  month's best sellers"** ranks `apiPendingOrders`: purchase orders *not yet
  placed*. There are no sales in it. Its own empty state reads *"No sales
  performance data available yet"*, so the populated state is the lie.
- `apps/web/src/pages/dashboard/useDashboardPage.ts:120` sets `byType` to five
  literal zeros; `Dashboard.tsx:1470-1491` renders them as five measured 0% bars.
- The same line sets `topSeller` to `''`, so "Top Seller" renders `--` forever
  (`Dashboard.tsx:1508`).
- `useDashboardData.ts:31-41` returns numeric `0` for every field on a failed
  fetch, and the error string is destructured then discarded
  (`Dashboard.tsx:119`) — a dead gateway and an empty cellar render identically.

This is the same class [ADR 0020](0020-no-fabricated-answers.md) named
("a surface with no data says so; it never invents one") and the same class
[ADR 0024](0024-identity-first-signin.md) removed from auth. It keeps recurring
because 0020 was written as a principle without a scope, so each page re-decided
it. The ten-page rebuild is the moment to scope it.

## Options considered

1. **Fix the legacy dashboard's four blocks now.** Stops production stating
   falsehoods today. Costs effort on a page that is being replaced, and does
   nothing to prevent the next page reintroducing the pattern.
2. **Leave legacy; bind only the rebuilds.** Accepts that the legacy page keeps
   its untruths until its flag flips, and spends the effort on the rule that
   governs everything built from here.
3. **Do nothing.** Each page re-litigates honesty, and the audits keep finding
   the same defect wearing different hats — which is exactly the history.

## Decision

**Option 2, on the founder's call: legacy is left alone, and every rebuilt page
shows live data or explicitly says it does not know.** No hardcoded values, no
seeded or pre-installed fixtures, no placeholder numbers dressed as measurements.

The reasoning that carried it: a page being replaced is not worth hardening, but
the *rule* is — the four defects above were not four mistakes, they were one
missing constraint applied four times. Binding the rebuilds rather than the
legacy puts the effort where it compounds.

Concretely, a rebuilt page must satisfy all of:

- **Unknown is the em dash, never zero.** A figure whose query has not answered
  renders `—`. A real measured zero may render `0`, and the two must be
  distinguishable in the markup, not only to a reader who knows the backend.
- **A windowed count renders as a floor** (`≥ n`) when its window is full, never
  as a total it cannot know.
- **A failure is said in words.** "Could not be refreshed" and "nothing below is
  claimed" are different sentences and must not be interchanged; a register that
  answered keeps its answer.
- **No component ships a literal standing in for a computation.** If the data
  does not exist, the block does not ship — a named gap in the page note beats a
  plausible number.
- **Nothing pre-installed.** No seed rows, demo tenants, or fixture accounts
  reachable from a rebuilt surface. (The three `sim-*@wineops.internal` fixture
  users were deleted from production the same day for this reason.)

## Consequences

- **Easier:** every page audit gets a single yes/no test instead of a judgement
  call, and the honesty conventions the rebuilt pages already share
  (`—`, `≥`, branch-aware banners) stop being per-page inventions.
- **Harder:** a rebuilt page will sometimes look emptier than the legacy page it
  replaces, because the legacy page was filling space with numbers it could not
  support. That is the intended trade and should not be argued back.
- **Given up:** the legacy pages keep their untruths until their flags flip.
  This is deliberate, and it means production currently shows a "best sellers"
  list built from pending purchase orders. Recorded, not hidden.
- **Revisit when:** a rebuilt page needs a figure the data genuinely cannot
  support and the founder wants it anyway — then the decision is whether to
  capture the data, not whether to fake it.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-01 | Aldemir | Decided during the dashboard page review; legacy left alone, rule bound to all rebuilds |

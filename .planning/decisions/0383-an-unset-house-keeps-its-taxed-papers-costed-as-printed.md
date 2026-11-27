# 0383 — A house that never answered its tax basis keeps its taxed papers costed as printed

- **Status:** Proposed (2026-11-20). An explicit override of the selector's wording in DD-r102-17 / DD-r103-10; needs the selector's yes to stand.
- **Date:** 2026-11-20
- **Decider:** r104 builder "invoices-fix" under the founder's standing delegation; the selector may reverse it.
- **Keywords:** landed cost, tax basis, held line, unresolved, costed as printed, ADR 0359 C3
- **Links:** PR #1813 (the hold), PR #1992 (the held-line shape), PR #784 (ADR 0359, C3), DD-r102-17, DD-r103-10

## Context

The selector said a paper that shows tax whose price basis nothing proves is held: a line shows an em dash and "tax basis unknown", and the lot cost is not written as invoice net. #1813 builds that hold only when the house has answered its tax basis (`reclaim.reclaims != null`). A house that never answered keeps ADR 0359 C3: lines are costed as printed, and the result says why.

## Options considered

1. **Record the unset-house exception (chosen).** `landed-cost.ts` keeps the `reclaim.reclaims != null` guard. ADR 0359 C3 stays true for a house that has no treatment to get wrong, and no taxed paper of an unset house is held.
2. **Hold for unset houses too.** Rejected for now: every taxed paper of every house that has not yet set its basis would hold its cost open, so cost of goods would read "unknown" until the house answers a settings question. It also reverses a locked decision (ADR 0359 C3) and re-pins three legacy tests (`paper-line-rates.spec.ts`, `paper-tax-facts.spec.ts`, `landed-cost.spec.ts`), which is a supersede, not a build detail.

## Decision

Option 1. The words "unknown basis" in DD-r103-10 are read as "a basis the house has not proved on this line", for a house that has answered. An unset house is not held.

## Consequences

- If the selector wants option 2, the change is one condition (drop `reclaim.reclaims != null`), three re-pinned tests, and an ADR that supersedes 0359 C3.
- Not evidenced: the web shows an em dash and "tax basis unknown" for a held line. The gateway writes the sentence (`landed-cost.ts`, kind `unresolved`); `apps/web/src` has no reader of `unresolved` or that sentence. A walker must see it on a live paper.
- The property test covers freight and its tax (500 single-rate papers: lines + tax + freight = printed total to the cent, for a house that keeps its tax). Tax on charges at a different rate than the lines is not in the grid.

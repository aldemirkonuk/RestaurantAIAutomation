---
type: agenda-full
division: product
department: design
team: ux-path-burn-down
status: provisional
metrics: [design.paths_closed_per_month, design.deferred_unblocker_ratio, design.ledger_drift_days, design.blocked_on_endpoint_count]
updated: 2026-08-24
links: ["[[ux-path-burn-down-charter]]", "[[ux-path-burn-down-premortem]]", "[[ux-path-burn-down-agenda-board]]", "[[ux-path-burn-down-directive]]", "[[ux-path-burn-down-loops]]", "[[ux-path-burn-down-schedule]]", "[[design-charter]]", "[[design-agenda-full]]", "[[engineering-charter]]", "[[data-charter]]", "[[exploration-studio-charter]]", "[[UX_PATHS_CATALOG]]", "[[decision-office-charter]]"]
---

# UX Path Burn-Down — Full Agenda

> **PROVISIONAL — no work done yet.** This is forecast, not fact.

## What

Take a 910-row ledger that has been drifting without an owner and make it **true again**,
then keep it true while closing rows in an order that reflects use rather than enumeration.

Three deliverables, in order, before any new path ships:

1. **Repair the known drift.** `UX_PATHS_CATALOG.md:49` says the Seating Density widget
   does not exist. It has been at
   `apps/web/src/components/reports/organisms/SeatingDensityPanel.tsx` since 2026-07-27,
   and `:1013` says so in the same file.
2. **Sweep the rest of the log.** Every "Unblocked by" cell in `:10-67`, checked against
   the repository. Publish three counts: still-blocked, now-unblocked, and
   **uncheckable**. The last is the important one.
3. **Correct the denominator.** The corpus is **910 paths**, not the 760 quoted in
   [[engineering-premortem]] M5 and in the founder's notes. Every burn-down percentage
   depends on it.

Only then: burn down.

## How

### Ordering — the strategy is the ordering rule

With 910 rows and no state for "will not build", the sequence *is* the plan. It is
**frequency of use during service**, not catalogue order and explicitly not section
completeness:

| Tier | Rule | Why |
|---|---|---|
| 1 | Routes a staff member touches mid-service — receiving, inventory, count | [[AGENT_NATIVE_UI_DECISION]]:87-95: turnover makes these recur forever, and muscle memory is a real performance budget |
| 2 | Routes with high in-degree in [[PAGE_MAP]] — reachable, therefore reached | An improvement on an orphan route improves nothing |
| 3 | Rows whose unblocker just resolved (surfaced weekly by `L-UXB-1`) | Cheapest real progress available; it is already paid for |
| 4 | Everything else, by section, **never as a section** | A section completed as a unit is M2 |

The §AA seating-density block is deliberately *not* tier 1 despite being the largest,
best-specified, most tractable-looking cluster in the catalogue. That is the whole point of
writing the rule down.

### Splitting §AA honestly

The §AA block is currently one blocker and is actually two:

- **~70 rows** blocked on data with no table — reservations, weather, labor, turn-time,
  per-seat pours, per-hour series, forecasts, host tablets (`:64`). → [[data-charter]].
  These stay deferred with an accurate unblocker naming the **schema**, not the widget.
- **~30 rows** whose stated blocker (the widget) has already resolved. → shippable now,
  and they have been shippable since July.

Nobody has separated the two halves. Doing so is a session's work and turns a false
100-row block into a true 70-row one.

### Acceptance criteria are already half-written

The catalogue's reading rule at `:70` — *"Given I am on page X, When I `<trigger>`, Then
`<outcome>`"* — means each row is already an E2E scenario. Closing a row therefore means
**a passing test that reads like the row**, not a screenshot. This is the cheapest quality
mechanism the department has and it costs nothing to adopt, because the corpus was written
in that shape on purpose.

## Why now

- **The drift is live and compounding.** One stale row found by one grep, in a log whose
  own maintenance instruction (`:15`) has already failed once. Every week without an owner
  adds to that class silently.
- **It is the largest ownerless backlog in the repo and it is already enumerated.**
  `product.md:845` puts this team in the division's second activation wave for that reason:
  largest ownerless backlog, cheap to start, nothing to invent.
- **~30 rows are shippable today** and have been since July. They are being skipped because
  a table says they are blocked.
- **The honesty ratio is at its historical maximum right now.** It is easier to protect a
  property than to restore one, and this is the last moment protecting it is free.

## Next steps

- [ ] Repair `UX_PATHS_CATALOG.md:49` — and update `:15`'s instruction to point at the
      weekly job rather than at human memory
- [ ] Sweep all `:10-67` unblocker cells against the repo; publish still-blocked /
      now-unblocked / **uncheckable** — [[ux-path-burn-down-loops]] `L-UXB-1`
- [ ] Split §AA into the ~70 data-blocked rows ([[data-charter]]) and the ~30 shippable
      ones; restate the blocker on the first group as a **schema**, not a widget
- [ ] Correct "760" → **910** in [[engineering-premortem]] M5 and wherever else it appears
- [ ] Publish the first `design.paths_closed_per_month` reading, plus its service-route
      split — both numbers or neither
- [ ] Define the machine-checkable unblocker format (path / table / endpoint /
      `OPEN-DECISIONS` ID) and re-grade every existing cell against it
- [ ] Count `design.blocked_on_endpoint_count` and escalate the **first** endpoint-blocked
      row to [[decision-office-charter]] — the commissioning fork is not going to close
      itself
- [ ] Adopt "closed = a passing E2E test that reads like the row" as the definition of done

## Questions for the founder

1. **Can this team commission endpoints, or only report blocked?** Most deferred rows are
   blocked on backend work. Answered one way, the team ships; answered the other, it
   maintains an excellent list of things that did not happen
   ([[ux-path-burn-down-premortem]] M3). **This is the question that decides whether the
   team exists in practice.**
2. **Is the catalogue a commitment or an inventory?** There is no "will not build" state.
   Without one, all 910 rows are implicit commitments, pruning is impossible, and the
   ledger governs the product rather than describing it (M5).
3. **Does the honesty ratio outrank the close rate?** If a sprint must choose between
   closing 5 rows and correcting 30 stale unblocker cells, which wins? The charter's
   position is that the ratio wins, because the ratio is what makes this backlog worth
   more than a list. Confirm, because it will feel wrong the first time.
4. **§AA — do the ~30 unblocked seating-density rows ship, or does the section wait for
   its data?** Shipping them is real progress and also exactly the shape of M2. The
   ordering rule says tier 4; a founder override is legitimate but should be explicit.
5. **Who owns the E2E tests the rows become?** The catalogue is a test spine by
   construction (`:70`). If [[engineering-charter]] owns the tests, this team's "closed"
   depends on another department's queue; if this team owns them, it needs test-authoring
   capacity it does not currently have.

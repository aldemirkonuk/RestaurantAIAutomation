---
type: adr
id: 0129
title: Below par is strictly below par
status: locked
updated: 2026-09-05
links: []
---

# 0129 — Below par is strictly below par

- **Status:** Locked
- **Date:** 2026-09-05
- **Decider:** Aldemir (founder), in session
- **Keywords:** below_par, par_level, threshold_min, low_stock, v_low_stock_items, classifyStock, at_par, inventory chip, alerts, POS lens defect 7
- **Links:** `datasets/sim/fixtures/below-par-cases.json`, `apps/api-gateway/src/common/stock-status.ts`, `apps/web/src/lib/inventoryStatus.ts`, `.planning/v3.0-TECH-DEBT.md` (POS lens, defect 7), PR #312

## Context

The 2026-09-03 POS lens run asked one question — *how many wines are below par?*
— of one screen, about one set of rows, in the same second, and got **three
different answers**, plus a fourth from the service that acts on them:

| source | answered | predicate |
|---|---|---|
| `/inventory` KPI chip | **9**, "2 critical" | `stock <= par` (`lib/inventoryStatus.ts`) |
| `GET /inventory/:rid/low-stock` | **7** | `stock < par` (`v_low_stock_items`) |
| `GET /inventory/:rid/summary` | `criticalCount` **0** | `stock_live === 0` |
| `low-stock-alerts.service` | Tsantali (2/5) = **critical** | `stock <= par * 0.5` |

Two of those are a disagreement about a boundary. The third is not a definition
of "below par" at all: `stock_live === 0` is *out of stock*, a different
question, which is why it reported zero at the exact moment the alert service
was calling a wine critical.

The register filed this as "two definitions". It was three. That undercount is
recorded here because it made the defect look like a rounding argument when it
was a screen contradicting itself and the thing that pages people.

Underneath the boundary question sits a real one that code cannot answer: **is a
wine sitting exactly at par something the owner needs to act on?** Nothing in
`.planning/decisions/` said. Both readings are defensible — par as a floor you
must not touch, or par as the level you reorder *below* — and the product had
quietly shipped both at once.

## Options considered

1. **Align everything on `stock <= par` (the chip's reading).** The alert view
   and the alert service would have to change, so alerts would begin firing for
   every wine that touches par. Rejected: it changes *behaviour* for every
   existing tenant to settle a *display* inconsistency, and it makes the noisier
   answer the default without anyone choosing it.
2. **Align everything on `stock < par` (the view's reading), with `at_par` as
   its own band. Chosen.** `v_low_stock_items` is already the predicate that
   decides whether an alert fires, so this is the only option where the number
   on the chip is exactly the set of wines the system will act on. A counter
   that claims more wines need attention than anything downstream will attend to
   is the same fault as one that claims fewer — over-reporting, not
   under-reporting, but the same shape, and the more corrosive of the two
   because it trains people to discount the number.
3. **Leave the boundary undecided and just make the three agree on *something*
   programmatically.** Rejected: the disagreement is a symptom. Deciding "they
   must match" without deciding *what they must match on* leaves the next person
   to pick, and picks it silently again.
4. **Do nothing.** Costs: the screen keeps contradicting itself, and the
   `criticalCount === 0` bug in particular keeps under-reporting criticals to
   anything reading `/summary`.

## Decision

**Below par means `stock < par`, strictly.** A wine at exactly par is `at_par`:
a band of its own, not below par, not folded into healthy.

Bands, over `ratio = stock / par`:

| band | condition |
|---|---|
| `critical` | `ratio <= 0.5` |
| `low` | `0.5 < ratio < 1` |
| `at_par` | `ratio == 1` |
| `healthy` | `ratio > 1` |
| `unknown` | stock or par missing, or `par <= 0` |

`unknown` is returned — never `critical` — when either number is missing. A
failed read and an empty shelf must not render the same (ADR 0067), and **no par
is not a par of nothing**: the previous web classifier substituted
`threshold > 0 ? threshold : 1`, so a wine with no par and no bottles rendered
"Critical" against a number nobody had set.

The rule lives in **one file that is not code**:
`datasets/sim/fixtures/below-par-cases.json`. Both implementations run it — the
gateway's `common/stock-status.spec.ts` and the SPA's
`lib/inventoryStatus.test.ts` — which is the same lockstep the operating-hours
pair uses. A comment did not stop the last divergence and would not stop the
next; two implementations in two languages need a shared table of answers or
they drift again.

## Consequences

- **The `/inventory` chip reads 7 rather than 9 on Sim Meyhouse.** That is the
  visible change, and it is the point: 7 is the number of wines anything in the
  product will actually act on.
- `/summary` gains `atParCount` and `unknownCount`, and `healthyCount` stops
  being `totalItems - lowStockCount` — which counted every unreadable row as
  healthy.
- The alert service's severity now comes from the shared `classifyStock`. A row
  arriving from `v_low_stock_items` that the predicate does *not* call low is
  dropped and logged rather than alerted on: the view and the classifier ought
  to agree, and if they ever drift, alerting a venue about a wine that is not
  low is how people learn to ignore alerts.
- **Reversing this decision is one line.** `below_par_bands` in the fixture is
  the whole policy; adding `"at_par"` to it moves the product back to `<=`
  everywhere at once, which is exactly the property that was missing when the
  boundary was expressed three times in three files.
- Not settled here: whether `CRITICAL_RATIO = 0.5` is the right split between
  *low* and *critical*. It was already consistent across the alert service and
  the SPA, so this ADR carries it forward unchanged rather than reopening it
  under cover of a different decision.

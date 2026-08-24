---
type: agenda-board
division: product
department: design
team: ux-path-burn-down
status: provisional
metrics: []
updated: 2026-08-24
links: ["[[ux-path-burn-down-charter]]", "[[ux-path-burn-down-agenda-full]]", "[[ux-path-burn-down-loops]]", "[[ux-path-burn-down-schedule]]", "[[ux-path-burn-down-premortem]]", "[[design-agenda-board]]"]
---

# UX Path Burn-Down — Board

> **PROVISIONAL — no work done yet.**

## This team's artifacts

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  type AS Type,
  status AS Status,
  updated AS Updated
FROM "01-org/product/design"
WHERE team = this.team
SORT type ASC
```

## Where this team sits in Design

```dataview
TABLE WITHOUT ID
  file.link AS Charter,
  default(team, "— dept —") AS Unit,
  status AS Evidence,
  metrics AS "Primary metric(s)"
FROM "01-org/product/design"
WHERE type = "charter"
SORT team ASC
```

## Stale — 60 days is finished or fiction

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  updated AS "Last touched"
FROM "01-org/product/design"
WHERE team = this.team AND date(updated) < date(today) - dur(60 days)
SORT updated ASC
```

## Loops without a close-time

```dataview
LIST
FROM "01-org/product/design"
WHERE team = this.team AND type = "loops" AND !contains(file.content, "close_time")
```

## Standing counters (hand-entered until the weekly job exists)

- [ ] `design.paths_closed_per_month` — **rate never measured**; ~90–100 of **910** closed
      cumulatively
- [ ] `design.paths_closed_on_service_routes` — **never measured**. Published beside the
      line above, always. One without the other **is** premortem M2
- [ ] `design.deferred_unblocker_ratio` — **uncomputed**. Data is in
      `UX_PATHS_CATALOG.md:10-67`
- [ ] `design.uncheckable_unblocker_cells` — **uncounted**. The number that predicts
      premortem M4
- [ ] `design.ledger_drift_days` — **non-zero, unknown**
- [ ] `design.blocked_on_endpoint_count` — **uncounted**. Rising with no escalation is
      premortem M3

## Known-stale rows (the founding repair list)

- [ ] `:49` — §AA blocked on the Seating Density widget. **Widget exists**:
      `apps/web/src/components/reports/organisms/SeatingDensityPanel.tsx`, on disk since
      2026-07-27; `:1013` says so in the same file
- [ ] `:15` — the maintenance instruction *"Update both places when a deferred item
      ships"* has already failed once. Repoint it at the weekly job
- [ ] §AA is **one blocker doing two jobs** — ~70 rows genuinely blocked on absent tables
      (`:64`), ~30 not blocked at all
- [ ] Denominator wrong elsewhere: **760** in [[engineering-premortem]] M5. It is **910**

## Open, blocking, named

- [ ] **Commissioning authority** — unanswered. Until it closes, "blocked" is this team's
      largest output category
- [ ] **No "will not build" state** in the ledger. All 910 rows are implicit commitments
- [ ] **Test ownership** — a row's definition of done is a passing E2E test (`:70`).
      Whose queue does that test sit in?

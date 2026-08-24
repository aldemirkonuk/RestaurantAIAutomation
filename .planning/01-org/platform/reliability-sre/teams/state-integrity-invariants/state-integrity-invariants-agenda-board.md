---
type: agenda-board
division: platform
department: reliability-sre
team: state-integrity-invariants
status: provisional
metrics: [sre.mttd_silent_corruption, integrity.open_findings_count, integrity.open_findings_oldest_age, integrity.invariants_with_outcome_side_check_pct]
updated: 2026-08-24
links: ["[[state-integrity-invariants-charter]]", "[[state-integrity-invariants-agenda-full]]", "[[state-integrity-invariants-loops]]", "[[reliability-sre-agenda-board]]"]
---

# State Integrity & Invariants — Board

> **PROVISIONAL — no work done yet.**

## This team's artifacts

```dataview
TABLE type AS Artifact, status AS Status, updated AS Updated
FROM "01-org/platform/reliability-sre"
WHERE team = this.team
SORT type ASC
```

## Sibling teams

```dataview
TABLE team AS Team, status AS Grade, updated AS Updated
FROM "01-org/platform/reliability-sre"
WHERE type = "charter" AND team != null AND team != this.team
SORT team ASC
```

## Stale check

```dataview
TABLE updated AS Updated, type AS Artifact
FROM "01-org/platform/reliability-sre"
WHERE team = this.team AND date(updated) < date(today) - dur(60 days)
SORT updated ASC
```

## MTTD — per class, never one number

| Invariant class | MTTD today | Source |
|---|---|---|
| Schema drift | **≤24h** | `schema-parity.yml:26-28` daily cron |
| Tenant leakage | **unmeasured** | `state_invariant_enforcer.py:1-30` detects; no measured latency |
| POS ↔ inventory divergence | **unmeasured** | `inequality_detector.py:1-10` |
| Catalogue ↔ mapping drift | detected daily | `drift_agent.py:1-19` |
| Ghost inventory | **not detected** | `ghost_inventory_agent.py` — **stub, only logs** |
| Shrinkage | **not detected** | `shrinkage_detective_agent.py` — **stub, only logs** |

Aggregating this table into one number is [[state-integrity-invariants-premortem]] M4.
Unmeasured rows stay visible.

## Numbers

- `integrity.open_findings_oldest_age` — **the board metric.** Count can look calm while the oldest rots
- `integrity.open_findings_count` — direction matters more than value; three close-times of rising = nobody owns it
- `integrity.invariants_with_outcome_side_check_pct` — **5 of 6 gates are greps** today
- **Not a metric:** number of gates. That measures effort

## Open

- [ ] Findings disposition: fixed / accepted-with-reason / invalidated + named triage cadence
- [ ] **Tenant-leakage out-of-band alert path** — structurally separate from the queue
- [ ] MTTD published per class, unmeasured shown as "unmeasured"
- [ ] Outcome-side twin for `check_no_direct_stock_writes.sh` (divergence sampling)
- [ ] Cross-tenant row probe as a data-side check
- [ ] CI: no commit may touch both `supabase/migrations/` and a gate script
- [ ] Close **OD-24**, then build or formally disown the two stub agents

## Watch

- `drift_findings` status `open` — a number that can only rise; **no reader exists today**
- `scripts/check_schema_parity.sh:6-11` — 27 tables, 403 columns, 13 functions created by no migration. Why this team exists
- `check_no_direct_stock_writes.sh:10` — the script admits it is a grep
- A green CI run on a day with a non-zero divergence sample = M2 in progress
- One commit touching a migration **and** a gate = M3 in progress
- Tenant-leakage findings sharing routing with catalogue drift = M5, visible before any leak

---
type: agenda-board
division: intelligence
department: security
team: access-control-tenant-isolation
status: provisional
metrics: []
updated: 2026-08-24
links: ["[[access-control-tenant-isolation-charter]]", "[[access-control-tenant-isolation-agenda-full]]", "[[access-control-tenant-isolation-loops]]", "[[access-control-tenant-isolation-premortem]]", "[[security-agenda-board]]", "[[ENDPOINTS]]"]
---

# Access Control & Tenant Isolation — Board

> **PROVISIONAL — no work done yet.**

## This team's artifacts

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  type AS Type,
  status AS Status,
  updated AS Updated
FROM "01-org/intelligence/security/teams/access-control-tenant-isolation"
SORT type ASC
```

## Where this team sits in the department

```dataview
TABLE WITHOUT ID
  file.link AS Charter,
  default(team, "— dept —") AS Unit,
  status AS Evidence,
  metrics AS "Primary metric(s)"
FROM "01-org/intelligence/security"
WHERE type = "charter"
SORT default(team, "") ASC
```

## Stale — nothing touched in 60 days is either finished or fiction

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  updated AS "Last touched"
FROM "01-org/intelligence/security/teams/access-control-tenant-isolation"
WHERE date(updated) < date(today) - dur(60 days)
SORT updated ASC
```

## Loops missing a close-time

```dataview
LIST
FROM "01-org/intelligence/security/teams/access-control-tenant-isolation"
WHERE type = "loops" AND !contains(file.content, "close_time")
```

## Standing counters (hand-entered until the CI job exists)

**The pair rule:** the first two lines are read together or not at all. The first can
reach 0 by moving routes into the second.

- [ ] `sec.unguarded_authenticated_surface` — **94** · target **0**
- [ ] `sec.public_decorator_count` — **12** · must not rise while the above falls
- [ ] `sec.recurrence_guard_present` — **false** · target **true `before` the first guard lands**
- [ ] `sec.routes_classified` — **0 of 94**
- [ ] `sec.cross_tenant_write_paths` — **unmeasured** · first reading is step 2, before remediation
- [ ] `sec.verdicts_reversed` — **0** · zero at campaign end means unchecked, not correct

## Burn-down by module

| Module | Routes | Verdicts written | State |
|---|---|---|---|
| `analytics` | 39 | 0 | 🔴 fixed on `fix/analytics-endpoint-auth`, **unmerged** |
| `notifications` | 24 | 0 | not started |
| `communications` | 9 | 0 | not started · module total 18, nine are `@Public()` |
| `contacts` | 8 | 0 | not started · CRUD on people |
| `dashboard` | 8 | 0 | not started |
| `procurement/recurring-orders` | 6 | 0 | not started · **classify first** (smallest, writes) |
| **Total** | **94** | **0** | |

## Blocked / escalated

- 🔴 **OD-20** — merge `99da5eb`. Owner: founder. Takes the primary metric 94 → 55.
- ⚠️ **`simpos` (11 routes)** — on the charter boundary with
  [[perimeter-ingress-integrity-charter]]. Unguarded control surface, server-signed
  webhook into stock movement. Department-level decision per [[security-directive]].
- ❓ **RLS posture** — does the service-role key bypass 182 policies on the gateway path?
  Unresolved claim, not yet a finding.
- ⬦ **INTEL-F4** — merged-vs-split team shape. Owner: founder.

## Known-public set (the M2 tripwire)

Any `@Public()` outside this list escalates on the **first** occurrence.

`toast/` · `simpos/` · `pos-hub/` · `vendor-portal/` ·
`common/orchestrator/inbound-email.controller.ts` · `communications/test/e2e/*`

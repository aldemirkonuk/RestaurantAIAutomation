---
type: agenda-board
division: platform
department: engineering
team: platform-api
status: provisional
metrics: [platform.endpoints_protected_by_default_pct, platform.unguarded_reachable_routes]
updated: 2026-08-24
links: ["[[platform-api-charter]]", "[[platform-api-agenda-full]]", "[[platform-api-loops]]", "[[engineering-agenda-board]]", "[[security-charter]]"]
---

# Platform & API — Board

> **PROVISIONAL — no work done yet.**

## This team's artifacts

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  type AS Type,
  status AS Status,
  updated AS Updated
FROM "01-org/platform/engineering"
WHERE team = this.team
SORT type ASC
```

## Everyone whose premortem depends on this team's mechanism

```dataview
TABLE WITHOUT ID
  file.link AS Premortem,
  team AS Team
FROM "01-org/platform/engineering"
WHERE type = "premortem"
  AND contains(list("procurement-vendor-network", "messaging-delivery", "integration-engineering"), team)
SORT team ASC
```

## Stale here (60-day rule)

```dataview
LIST rows.file.link
FROM "01-org/platform/engineering"
WHERE team = this.team AND date(updated) < date(today) - dur(60 days)
GROUP BY type
```

## The two numbers — only one of them can fail

- [ ] `platform.endpoints_protected_by_default_pct` — **0%** of 448 routes
- [ ] `platform.unguarded_reachable_routes` — **137** (~51 legitimately public, ~86 remediable)
- [ ] `platform.public_decorator_count` — **0** today; the erosion counter starts here
- [ ] Rule: the first can reach 100% while the second stays flat. Both, forever.

## Counters

- [ ] Route census job — **not built**; blocks verification of everything else
- [ ] Public-route allowlist file — **does not exist**; the ~51 are not enumerated
- [ ] Global guard — **not built**
- [ ] `tenant.guard.ts:38-46` returns `true` with no authenticated user — **by design, unchanged**
- [ ] Tenant-predicate static check — **not built**
- [ ] Multi-tenant test fixtures — **no**
- [ ] Published defaults for idempotency / cache / rate-limit — **no**
- [ ] Gateway spec files — 64

## First tranche, by consequence not by ease

- [ ] `procurement/recurring-orders` — 6, places orders ([[ENDPOINTS]]:428)
- [ ] `notifications` — 24, sends to humans
- [ ] `communications` — 18, sends to humans
- [ ] `contacts` — 8, reads a contact list
- [ ] All four: **excluded from the allowlist, categorically**

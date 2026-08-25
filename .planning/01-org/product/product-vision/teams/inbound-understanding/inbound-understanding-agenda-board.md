---
type: agenda-board
division: product
department: product-vision
team: inbound-understanding
status: provisional
metrics: []
updated: 2026-08-24
links: ["[[inbound-understanding-charter]]", "[[inbound-understanding-agenda-full]]", "[[inbound-understanding-loops]]", "[[inbound-understanding-schedule]]", "[[product-vision-agenda-board]]"]
---

# Inbound Understanding — Board

> **PROVISIONAL — no work done yet.**

## This team's artifacts, live

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  type AS Type,
  status AS Status,
  updated AS Updated
FROM "01-org/product/product-vision/teams/inbound-understanding"
SORT type ASC
```

## Where this team sits among its siblings

```dataview
TABLE WITHOUT ID
  file.link AS Charter,
  team AS Team,
  status AS Evidence,
  metrics AS "Primary metric(s)"
FROM "01-org/product/product-vision"
WHERE type = "charter"
SORT status ASC, team ASC
```

## Stale — nothing touched in 60 days is either finished or fiction

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  updated AS "Last touched"
FROM "01-org/product/product-vision/teams/inbound-understanding"
WHERE date(updated) < date(today) - dur(60 days)
SORT updated ASC
```

## Loops missing a close-time

```dataview
LIST
FROM "01-org/product/product-vision/teams/inbound-understanding"
WHERE type = "loops" AND !contains(file.content, "close_time")
```

## Standing counters (hand-entered until the jobs exist)

**The pairing rule: neither column is published without the other.**

| Module | `accept_without_edit_rate` | `false_accept_count` |
|---|---|---|
| Email Watcher | — unmeasured | — no correction path |
| Invoice / Receipt | — unmeasured | — no correction path |
| Order Watcher | — unmeasured | — no correction path |

- [ ] Guardrail contract — **does not exist**; three modules, three implicit gates
- [ ] Confidence-threshold constants outside the shared contract — **count unknown**; the
      `inbound-gate-conformance` check does not exist yet
- [ ] Approval primitives in use — target **1** (`apps/api-gateway/src/one-tap-actions/`)
- [ ] Held-out vendor set for `invoice-match.backtest.spec.ts` — **none**; the backtest runs
      on the corpus the matcher was tuned against
- [ ] Deliberate high-confidence sampling — **not running**
- [ ] Inbound webhook signature verification — **0 of 32** routes
      (`POST /webhooks/inbound-email` is one of them, [[ENDPOINTS]]:120-124)
- [ ] `recurring-orders` unguarded routes that can place real orders — **6**
      ([[ENDPOINTS]]:428), open under OD-19
- [ ] p50 time-to-approve — **unmeasured**; this is the rubber-stamp detector
      ([[inbound-understanding-premortem]] M3)
- [ ] Distinct vendor formats in the invoice corpus — **unknown**; M1 needs this as a
      cross-check against a rising acceptance rate

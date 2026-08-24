---
type: agenda-board
division: platform
department: engineering
team: messaging-delivery
status: provisional
metrics: [messaging.duplicate_delivery_rate, messaging.drop_rate]
updated: 2026-08-24
links: ["[[messaging-delivery-charter]]", "[[messaging-delivery-agenda-full]]", "[[messaging-delivery-loops]]", "[[engineering-agenda-board]]"]
---

# Messaging & Delivery — Board

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

## Transport seam partners

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  team AS Team,
  type AS Type
FROM "01-org/platform/engineering"
WHERE contains(list("integration-engineering", "platform-api", "inventory-ledger"), team)
  AND type = "charter"
SORT team ASC
```

## Stale here (60-day rule)

```dataview
LIST rows.file.link
FROM "01-org/platform/engineering"
WHERE team = this.team AND date(updated) < date(today) - dur(60 days)
GROUP BY type
```

## Counters — per channel, never averaged

- [ ] `messaging.duplicate_delivery_rate` — email / push / in-app / websocket: **all unmeasured**
- [ ] `messaging.drop_rate` — **unmeasurable today**: ids are not minted at intent
- [ ] `notification_id` minted at intent — **no**
- [ ] Buffer state durable across restart — **no** (`buffer_manager.py`, in-memory LIFO 30 min)
- [ ] Restart reconciliation record — **not emitted**
- [ ] Delivery states split accepted / delivered / acknowledged — **no**
- [ ] Unguarded routes that send or read contacts — **50** (24 + 18 + 8)
- [ ] Alert on unauthenticated writes to those routes — **not built**
- [ ] Threading decisions logged with reason — **no**

## Open

- [ ] OD-20 — team, or a function inside [[platform-api-charter]]?
- [ ] At-least-once vs at-most-once, per notification class
- [ ] Email "acknowledged" signal — tracking decision

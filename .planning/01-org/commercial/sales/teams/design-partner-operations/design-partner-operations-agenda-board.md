---
type: agenda-board
division: commercial
department: sales
team: design-partner-operations
status: provisional
metrics: [sales.time_to_first_connection, sales.verified_dollars_recovered, sales.unprompted_sessions_7d, sales.design_partner_touch_streak]
updated: 2026-08-24
links: ["[[design-partner-operations-charter]]", "[[design-partner-operations-premortem]]", "[[design-partner-operations-agenda-full]]", "[[design-partner-operations-loops]]", "[[design-partner-operations-schedule]]", "[[design-partner-operations-directive]]", "[[sales-agenda-board]]"]
---

# Design Partner Operations — Board

> **PROVISIONAL — no work done yet.**

## One item

- [ ] **`DEP-06` — Toast credentials, in person, this month**
  (`.planning/PROJECT.md:101`). Connector built (`apps/api-gateway/src/toast/`), keys
  named (`env.example:49-56`). **Nothing else goes on this board until it is ticked.**

## Team docs — live query

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  type AS Type,
  status AS Status,
  updated AS Updated
FROM "01-org/commercial/sales/teams/design-partner-operations"
SORT type ASC
```

## Stale check — untouched for 60 days

```dataview
TABLE WITHOUT ID file.link AS Doc, updated AS "Last touched"
FROM "01-org/commercial/sales/teams/design-partner-operations"
WHERE date(updated) < date(today) - dur(60 days)
SORT updated ASC
```

## Counters

- `sales.time_to_first_connection` — **day 0**, uncapped clock running
- `sales.verified_dollars_recovered` — **$0** · `credits_requested` — **0**
- `sales.unprompted_sessions_7d` — **unmeasurable**, no analytics event exists
- `sales.design_partner_touch_streak` — **0 weeks**
- `sales.blocker_age_max` — undefined, no blocker queue exists
- `nf_b.source_count` — **0**, gated entirely on the item above

## Blocking

- [ ] Five env keys unset — `TOAST_CLIENT_ID`, `TOAST_CLIENT_SECRET`,
      `TOAST_RESTAURANT_GUID`, `TOAST_WEBHOOK_SECRET`, `TOAST_ENVIRONMENT`
      (`env.example:49-56`)
- [ ] No unprompted-session event — [[analytics-bi-charter]] ask not yet filed. Blocks
      [[design-partner-operations-premortem]] M1's only signal
- [ ] No contact log — blocks M4's only signal
- [ ] Invoice half hand-typed (`ReceivingWorkspace.tsx:400,438`) — blocks
      `overbilled_vs_ship`, the headline verdict
- [ ] Manual workaround not started — founder types month one's invoices

## Rules in force

- **One front door.** Every unit's ask on this account routes here. **Cap: one
  substantive ask per week.** Order: connection → recovery evidence → reference permission
  → research → guest data.
- **A touch counts only** if it produced an observed usage moment or a named blocker.
  "Checking in" is not a touch.
- **Two counters, never one.** `credits_requested` and `credits_landed` are tracked
  separately. Only the second is ever published.
- **No reference, quote, or demo ask** until a credit has landed.

## Checkpoints

- [ ] **2026-09-24** — `DEP-06` unchecked ⇒ escalate as a scheduling failure
- [ ] **Auto-escalate** — 3 consecutive weeks of `unprompted_sessions_7d == 0` with
      positive sentiment ([[design-partner-operations-premortem]] M1)

## Watch

- ⚠️ M1 is the highest-probability failure in the division and **feels like success the
  entire time it is happening**. Its signal does not exist yet.

---
type: agenda-full
division: platform
department: engineering
team: procurement-vendor-network
status: provisional
metrics: [procurement.order_to_delivery_reconciliation_rate, procurement.no_touch_reconciliation_rate, procurement.unguarded_money_moving_routes]
updated: 2026-08-24
links: ["[[procurement-vendor-network-charter]]", "[[procurement-vendor-network-premortem]]", "[[procurement-vendor-network-agenda-board]]", "[[procurement-vendor-network-loops]]", "[[engineering-agenda-full]]", "[[platform-api-charter]]", "[[action-safety-the-human-gate]]"]
---

# Procurement & Vendor Network — Full Agenda

> **PROVISIONAL — no work done yet.** This is forecast, not fact.

## What

Close a live exposure, then build the number that tells us the system works. In order:

1. **Stop the unguarded money path.** 6 unguarded `recurring-orders` routes
   ([[ENDPOINTS]]:428) on the module that places orders automatically. This is not debt;
   it is an open door.
2. **Define reconciliation with the "without human repair" clause intact** — two numbers,
   raw and no-touch, from day one. The clause cannot be added retroactively.
3. **Snapshot price-at-order** so reconciliation compares against a contract, not against
   a moving catalogue.
4. **Draw the commit boundary explicitly** — which code paths may cause spend, and what
   gates them.

## How

**Log before you guard.** The global guard mechanism belongs to
[[platform-api-charter]] and will take time. An alert on unauthenticated writes to
money-moving routes takes a day and does not require an architecture. Premortem M1 fails
in the gap between "we know it's open" and "the platform fix lands"; this closes the gap
cheaply.

**Money-moving routes go first, and never get the escape hatch.**
[[engineering-premortem]] M2 predicts `@Public()` becomes the copy-paste default. The
counter is a population that is categorically excluded — and procurement writes are the
natural first population, because consequence, not convenience, should set the order.

**Two reconciliation numbers, always.** Raw rate and no-touch rate. The gap between them
is the labour the system generates. A single number hides exactly the failure the metric
exists to catch (premortem M2).

**The contract is the order line, not the catalogue.** Price observations are evidence
about the world; the order line is what was agreed. Any reconciliation query joining
`vendor_catalogue` for price is a review rejection (premortem M3).

**Committing spend is not this team's call.** [[action-safety-the-human-gate]] owns the
gate. This team owns the mechanics. That separation is the counter to M4 and it is worth
more than any threshold policy.

## Why now

- **The exposure is current.** `recurring-orders` is unguarded today, `TenantGuard`
  passes unauthenticated requests by design (`tenant.guard.ts:38-46`), and
  `recurring_order_agent.py` exists to place orders without a human in the loop. Those
  three facts are already true together.
- **Reconciliation history is not backfillable.** The `manual_intervention` flag and the
  price-at-order snapshot must exist *before* the orders they describe. Every week without
  them is a week of unmeasurable procurement.
- **The cluster is the largest in the gateway** (~97 routes). If it is not owned now, it
  gets owned by whoever happens to touch it.

## Next steps

- [ ] Alert on unauthenticated writes to `procurement/**` and `providers/**` — today,
      independent of the platform guard (premortem M1)
- [ ] Get money-moving routes onto the first tranche of the global guard, with a written
      exclusion from the `@Public()` allowlist — seam with [[platform-api-charter]]
- [ ] Specify the reconciliation record **including** `manual_intervention`; publish raw
      and no-touch rates separately (M2)
- [ ] Add immutable price-at-order to order lines; forbid catalogue joins in
      reconciliation (M3)
- [ ] Enumerate every code path that can cause spend, including agent paths; hand the gate
      to [[action-safety-the-human-gate]] (M4)
- [ ] Re-classify `vendor-portal` under an integration-surface correctness criterion (M5)
- [ ] Publish the first `procurement.order_to_delivery_reconciliation_rate` reading

## Questions for the founder

1. **Can we shut `recurring-orders` to unauthenticated callers immediately?** The blunt
   fix — reject requests with no principal — may break `recurring_order_agent.py` if it
   calls without credentials. Is a short breakage acceptable to close a money path, or
   does the agent get a credential first?
2. **Is there any auto-commit today, at any amount?** M4 assumes not. If a threshold
   already exists in code, its value belongs in `OPEN-DECISIONS.md` now.
3. **Who is the human in "human-gated spend"?** The restaurant operator, or us? That
   determines whether the gate is a product feature or an internal control.
4. **Does the vendor portal stay in this team?** It is 2 routes, external-facing, and its
   correctness criterion is closer to [[integration-engineering-charter]]'s. Keep, or move?
5. **What no-touch reconciliation rate is acceptable?** "100%" is not a real target for a
   system talking to vendors over email. A stated floor tells the team when to stop
   optimising and start accepting manual repair as designed behaviour.

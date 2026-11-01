## The goal routes and the export's goals cutting pass no sales gate, so a days-of-stock goal reads as withheld for its owner — OPEN — 2026-10-31

Filed when PR #617 was split. `GoalsService` scores `days_of_inventory` only with `withSales` true (ADR 0298 decision 9). The overview and recommendations hand the token's gate on; the four goal routes on `AnalyticsController` and the export's goals cutting do not yet, so an owner sees such a goal as withheld there and creating one is refused with a 400. It fails closed. Production at 2026-11-01T01:00Z had one goal, on `checks`. **Closes with** `fix/goal-routes-hand-the-sales-gate-on`.

## The goal producers pass no sales gate, so they tell no one about a days-of-stock goal — OPEN — 2026-10-31

`ceiling-held.producer.ts` skips such a goal, since read without the gate it has no score and would read as held at zero (its spec pins this). `goal-reached.producer.ts` gets `withheld` and finds no score at the target. **Closes with** `fix/goal-producers-tell-only-sales-holders`.

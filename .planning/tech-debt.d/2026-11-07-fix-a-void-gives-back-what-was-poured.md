## Glass voids booked under B19 still hold their extra bottles — OPEN — 2026-11-07

Filed by `fix/a-void-gives-back-what-was-poured` (G11). Earlier glass voids returned a bottle per glass (`return` rows, `reason like 'POS void (glass)%'`). Production was not read, so the count is unknown. **Closes with** a dated `correction` per row.

## The scenario harness still expects a bottle per voided glass — OPEN — 2026-11-07

`scripts/simulate/scenarios.py` (B19 `if voided:`) and `scenario-verify.service.ts` (`voids.returned`) expect a `+qty` `return` row under `<sale key>:void`. That key now holds a `-qty` `pour_events` row, so a live-day run fails glass voids. **Closes with** a `void_volume` expectation.

## An overflow without a fold leaves no durable record — OPEN — 2026-11-07

It reaches the ledger only when a bottle folds; else only the RPC result and the POS hub's warn log (pgtest V8). **Closes with** ADR 0115 D3 (R49), or a metadata column on `pour_events`.

## OD-67's register row is not struck yet — OPEN — 2026-11-07

Its long row would add 13K of diff past the gate's 30K wall. **Closes with** a one-line strike citing the ADR 0011 amendment.

## No total caps several voids of one sale — CLOSED — 2026-11-07

Closed by QA 8c's follow-up: `pour_events.returns_sale_key` and the ledger's `metadata.sale_key` cap every void of a sale together (pgtest V10, V11).

## A sale booked before its key existed cannot be voided — OPEN — 2026-11-07

A void now raises P0002 when no `pour_events` or `sale` ledger row carries the sale key; before, a bottle void returned `qty` blind. Old sales without a keyed booking fail loudly on void and need a manual `return`. Production was not read. **Closes with** a count of such voids from the import report.

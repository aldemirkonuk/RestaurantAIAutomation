---
type: premortem
division: platform
department: engineering
team: inventory-ledger
status: provisional
metrics: [inventory.projection_divergence_rows, inventory.direct_write_paths]
updated: 2026-08-24
links: ["[[inventory-ledger-charter]]", "[[inventory-ledger-loops]]", "[[inventory-ledger-directive]]", "[[engineering-premortem]]", "[[schema-migrations-premortem]]", "[[red-team-charter]]"]
---

# Inventory & Ledger — Premortem

> Written at founding, before success is assumed.

The seed (`.planning/foundation/teams/technology.md:122-125`): *the guard is a `grep`, by
its own admission (`check_no_direct_stock_writes.sh:10`). A future write path that
constructs the table name dynamically — or lives in a Postgres function rather than
TypeScript — passes CI and desyncs silently, exactly as the receiving-service bug did.*

## It is 2027-08. This team has failed. What happened?

### M1 — The grep passed and the data diverged

`scripts/check_no_direct_stock_writes.sh:1-13` matches text. A write that builds its table
name from a variable, that lives in a Postgres function rather than TypeScript, that goes
through an ORM helper, or that arrives via a Supabase RPC, is invisible to it. The guard
is green on every PR for a year. Somewhere in that year a receiving path — the same class
of path that produced the original bug — writes `stock_live` directly. Nobody finds out,
because a wrong integer renders exactly like a right one.

**Earliest observable signal.** The combination, not either half: **a green CI run on a
day with non-zero divergence**. That is the alarm state, and it is only visible if both
numbers are read. Secondary tell: any new `.sql` function body containing an `UPDATE` or
`INSERT` against a stock table, since the guard's blind spot is precisely non-TypeScript
write paths.

**Counter-pressure.** The grep stays — it is fast and free — but it is **never the only
thing**. Pair it with the daily divergence sample (`inventory.projection_divergence_rows`),
which measures the *outcome* rather than the syntax. Extend guard coverage to
`supabase/migrations/**` function bodies, where TypeScript-shaped greps do not look.
Route the pair through [[engineering-loops]] L-ENG-3, whose entire reason for existing is
"green guard, wrong data".

---

### M2 — The daily sample was specified and never built

The charter says "sampled daily". The evidence base lists eighteen endpoints, two
migrations, a guard, two plans, and no sampler. Twelve months later the team has a
well-architected ledger, a deprecation note, a CI guard — and a primary metric that has
never been read once. M1 is undetectable without this, so M2 makes M1 inevitable rather
than merely possible.

**Earliest observable signal.** The **first** close-time in which
[[inventory-ledger-loops]] L-IL-1 reports no reading. Not the second — this metric is a
single SQL query against lots and projections; there is no legitimate reason for it to be
absent twice.

**Counter-pressure.** The sampler is the team's first deliverable, before any ledger
refactor. It is deliberately the cheapest possible thing: one query, one row of output,
one number on [[inventory-ledger-agenda-board]]. Any proposal to build a richer
reconciliation system *before* the trivial sampler exists is scoped down by
[[inventory-ledger-directive]] — a sophisticated tool that ships in six weeks is worse
than a crude one that ships tomorrow, when the metric has never been read.

---

### M3 — Ledger v1 was deprecated in a document, not in code

`apps/api-gateway/src/inventory-ledger/LEDGER_V1_DEPRECATED.md` marks the old path as
dead. Deprecation notes are not enforcement. Callers keep using v1 because it works; new
code copies existing patterns; v1 and v2 both mutate stock, through different paths, with
different idempotency semantics. The dual-bookkeeping root cause the team was founded to
*fix* is now the team's own architecture. This is the failure mode that hurts most,
because it looks like progress the entire time.

**Earliest observable signal.** Any **new** call site of a v1 endpoint after the
deprecation note's date. Not usage volume — a single new call site. Measure it as a count
of distinct v1 callers over time; if that count rises even once, the deprecation is
decorative.

**Counter-pressure.** A deprecation gets a **removal date and a caller census**, both in
[[inventory-ledger-agenda-board]]. Falling caller count is the deliverable; the document
is not. If the count is flat for two close-times, v1 is either un-deprecated honestly or
removal is scheduled — "deprecated indefinitely" is the state that produces this failure.

---

### M4 — Idempotency held per-endpoint and not end-to-end

`supabase/migrations/20260805131000_stock_race_and_pour_idempotency.sql` addresses races
and pour idempotency at the movement layer. But a pour arrives via POS webhook
([[integration-engineering-charter]]), crosses the RabbitMQ bridge
([[messaging-delivery-charter]]), and lands as a movement. Each hop is idempotent on its
own key. A retry at hop one with a fresh key at hop two is a duplicate movement with a
perfectly valid idempotency token. Stock drifts down twice for one pour, and the ledger is
internally consistent while being wrong.

**Earliest observable signal.** Two movements with different idempotency keys, the same
lot, the same quantity, within a short window and traceable to one upstream event. This is
only visible if the *upstream* event id is carried into the movement record — so the
absence of that field is itself the earliest signal, and it is checkable today.

**Counter-pressure.** Idempotency keys are derived from the **originating external event
id**, not minted per hop. That is a seam decision with
[[integration-engineering-charter]] and [[messaging-delivery-charter]] — this team is on
the left of the seam for stock, so it is accountable for the decision and they are
accountable for the objection ([[engineering-directive]]).

---

### M5 — Counting became a second bookkeeping system

`inventory_count_service.py` and `agents/inventory_engine.py` reconcile physical counts
against the ledger. A count that disagrees produces an adjustment. If adjustments are
written as their own truth rather than as movements through `apply_stock_movement`, the
team has re-created dual bookkeeping under a new name — and this time with the count
service's blessing. `.planning/INVENTORY_ADD_REMOVE_SCENARIOS.md` exists precisely because
these paths are subtle.

**Earliest observable signal.** An adjustment row with no corresponding movement row.
One is enough; this is not a trend metric.

**Counter-pressure.** Counts produce **movements**, never direct writes — the same rule
that governs every other mutation, with no carve-out for reconciliation. The daily sampler
(M2's deliverable) catches violations by construction, because an adjustment outside
`apply_stock_movement` shows up as divergence on the next day's sample.

---

## What [[red-team-charter]] should attack first

M2. Every other mechanism here is either detected by the daily sample or invisible without
it. A team whose primary metric has never been read has no evidence it is working, and the
premortem's other four items are unfalsifiable until it is.

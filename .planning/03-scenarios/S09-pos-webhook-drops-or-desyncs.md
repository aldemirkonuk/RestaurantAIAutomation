---
type: scenario
id: S09
slug: pos-webhook-drops-or-desyncs
class: problem
actors: [pos-terminal, connector-platform-trust, pos-bridge, inventory-ledger, operator]
modules: ["[[connector-platform-trust-charter|connector-platform-trust]]", "[[pos-bridge-charter|pos-bridge]]", "[[inventory-ledger-charter|inventory-ledger]]"]
signals: [pos_webhook, idempotency_key, dead_letter, reconcile_gap]
insights_class: [connector-reliability, stock-drift, dead-letter-depth]
tier: core
sim_harness: simpos
status: proposed
updated: 2026-08-24
links: ["[[SCENARIO-CONTRACT]]", "[[connector-platform-trust-charter]]", "[[pos-bridge-charter]]"]
---

# S09 — POS webhook drops / desyncs

## 1. Trigger
A webhook that should have arrived doesn't — or arrives twice, or out of order (a close
before its open, or a close replayed). Bounded: from an expected-but-absent / duplicated /
reordered delivery to a reconciled (or at least flagged) ledger state. This is the failure
twin of S04, and it is where "the numbers are wrong and nobody knows why" is born.

## 2. Actors
The POS terminal (external, over an unreliable network) · connector-platform-trust (owns
delivery integrity) · the pos-bridge ingestion path · the inventory ledger (whatever drift
lands in) · the operator (the one who eventually notices stock doesn't match reality).

## 3. Signals
- **Duplicate → handled.** The depletion idempotency key `pos:{source}:{check}:{item}:
  {lineNo}` (`pos-hub.service.ts:370`) plus the `pos_checks` upsert on
  `(restaurant_id, source, external_check_id)` (`:202-204`) make a replayed check a no-op.
  This is the one desync class the code already survives.
- **Out-of-order → partly handled.** `closedAt` gates depletion (`:209-212`), so an open
  that arrives before its close resolves on the closing replay. The inverse (a close
  landing before the open, then the open upsert regressing `closed_at` to null) is **not
  proven safe** — flag for verification, not asserted.
- **Missed → NOT captured.** Nothing tracks expected sequence numbers, check counts, or
  delivery gaps. A webhook that never arrives leaves stock **silently over-stated forever**.
  There is no reconciliation poller in the hub — the whole path is push-only.
- **The two-DLQ reality (the honest core of this scenario).** There are two dead-letter
  queues and **only one is wired**:
  - `queue.dead_letters` (RabbitMQ) is *declared* — bound to `dlx.main` on `#`, 7-day TTL,
    10k cap (`core/message_bus.py:505-535`) — but **has no consumer**. The only
    `.consume()` in that file is the normal message handler (`:833`); nothing drains,
    replays, or alerts on the DLQ. Messages expire unseen.
  - `event_dead_letters` (Postgres) **is** wired: `dlq.process_pending` runs on Celery Beat
    every minute (`jobs/tasks.py:104-135`), with exponential backoff (`:95`), retry
    (`:206`), daily cleanup (`:271`), and stats (`:316`).
  - **Neither covers a pos-hub HTTP webhook failure today** — the live DLQ is the agent
    *event* bus, not the *ingress* path. A dropped webhook has no home in either queue.

## 4. Queries the product must answer
- "Did we miss a check?" — **unanswerable today** (no gap/sequence detection).
- "Is this a replay or a new sale?" — answerable (idempotency key + upsert conflict).
- "Has our stock drifted from POS truth?" — needs a **pull-based reconcile** that isn't
  built; today the answer is only ever discovered by a human counting bottles.
- "What's stuck dead-lettered?" — answerable only for `event_dead_letters` (`dlq.get_stats`);
  `queue.dead_letters` is not queryable by the product at all.

## 5. Outputs (in the moment)
- On a duplicate: a silent, correct no-op (good — but invisible, so it looks like nothing
  happened).
- Unmapped lines still queue to `pos_unresolved_lines` as in S04.
- **No drift alert and no missed-webhook alert exist today** — the most important output
  this scenario should produce is the one most missing. Stated plainly per §0.4.

## 6. Insights the owner sees (the payoff)
- Connector-reliability scorecard: delivery success rate, duplicate rate, dead-letter depth
  per provider.
- Drift ledger: POS-reported sales vs captured checks vs ledger depletion.

**Satisfiability — the weakest of the three POS scenarios, and this must be said.** S04 and
S14 supply POS data and clear the 25.1%-without-POS floor ([[analytics-bi-charter]]); S09's
insights depend on capturing *failures*, and the capture layer for ingress failures is
**partial-to-absent** (§3). The reliability scorecard is largely aspirational until a
webhook-delivery ledger exists; the drift ledger needs a reconcile pull that isn't wired.
Promising these today would be fiction — they are the build target this scenario names.

## 7. Decisions
Human decides whether to trust a reconcile correction and whether to replay a dead-lettered
event. The system **proposes only**: a re-pull / re-sync, or a replay from
`event_dead_letters` — it never silently rewrites the ledger to match a late-arriving or
re-derived truth. The choice of which DLQ (or a new ingress DLQ) a pos-hub failure should
route to is itself an **open decision**, not something to default.

## 8. Failure modes
- **Silent drift from a truly-missed webhook** — compounding, invisible, the signature
  failure of this whole scenario.
- **RabbitMQ DLQ fills and drops** — at 10k / 7-day TTL with no consumer
  (`message_bus.py:527-533`), dead-lettered messages age out unread; the queue is a
  landfill, not a recovery path.
- **Secret rotation mid-stream** → every webhook fail-closed rejected (S04 §8); looks
  identical to a provider outage, so the operator debugs the wrong side.
- **Close-before-open regression** → a late open upsert could null a `closed_at` already
  set — needs a test to confirm the upsert doesn't undo a depletion (§3, unproven).

## 9. Simulation & deploy gate
SimPOS can synthesize every desync class: **drop** (don't fire the webhook), **duplicate**
(fire twice), **reorder** (fire close then open) — all against the same signed
`generic_webhook` path (`simpos.service.ts:485-509`), non-production only since PR #32.
**Gate:** reconciliation/desync-handling changes ship only when the sim proves *duplicate →
no double-deplete* (**passes today** via idempotency) and *missed → detected* (**fails
today** — no detector exists). Honest status: today only the duplicate variant passes, so
this scenario is not yet `simulated`.

## 10. Tier cut (OD-48 locked — Core/Plus/Pro; prices open, OD-23)

- **Core (operate):** **idempotent dedupe** — a replayed check is a correct no-op via the
  depletion key `pos:{source}:{check}:{item}:{lineNo}` plus the `pos_checks` upsert. This is
  the one desync class the code survives today, and it is invisible by nature: it looks like
  nothing happened. **Dead-letter visibility** is the honest half-feature: `event_dead_letters`
  is wired and queryable (`dlq.get_stats`, Celery Beat every minute), but `queue.dead_letters`
  (RabbitMQ) **has no consumer** and is not queryable by the product at all — and **neither
  queue covers a pos-hub HTTP ingress failure.** The single most valuable Core output in this
  scenario, *"a webhook you were expecting never arrived,"* 🚧 **does not exist**: nothing
  tracks sequence numbers, check counts, or delivery gaps. Stock over-states silently, forever.
- **Plus (understand):** the connector-reliability scorecard (delivery success rate, duplicate
  rate, dead-letter depth per provider) and the drift-reconciliation readout (POS-reported
  sales vs captured checks vs ledger depletion). 🚧 **signal not built** — the scorecard needs
  a webhook-delivery ledger that does not exist, and the drift readout needs a **pull-based
  reconcile**; the hub is push-only with no poller.
- **Pro (optimize):** predictive gap detection and auto-replay proposals across providers.
  🚧 entirely aspirational — it sits downstream of *both* missing pieces above. **This is the
  thinnest Pro in the library and should not be offered.**

The uncomfortable framing an entitlement page must carry: S04 and S14 *supply* POS data; S09's
insights depend on capturing POS **failures**, and the ingress-failure capture layer is
partial-to-absent. Everything above Core here is a build target, not a deliverable.

## 11. Evolution feedback
DLQ depth and duplicate rate teach which providers are flaky; once a delivery ledger exists,
the gap between POS-reported sales and captured checks teaches where the bridge leaks. The
first thing this scenario teaches the app is that it currently *cannot* see its own dropped
webhooks — which is the strongest possible argument for building the ingress DLQ.

**Flex points:** reconcile cadence (per-service vs nightly) · trust model (auto-correct vs
propose-only) · which DLQ a provider's failures route to (neither today — the wiring is an
open decision).

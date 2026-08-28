---
type: agent-stack
division: platform
department: engineering
team: messaging-delivery
status: designed
updated: 2026-08-27
metrics: [messaging.duplicate_delivery_rate, messaging.drop_rate]
links: ["[[messaging-delivery-charter]]", "[[messaging-delivery-schedule]]", "[[messaging-delivery-loops]]", "[[messaging-delivery-directive]]", "[[0034-agent-stack-artifact]]", "[[engineering-agent-stack]]", "[[skills-charter]]", "[[ai-orchestration-charter]]", "[[EXTERNAL_CONNECTIONS]]"]
---

# Messaging & Delivery — Agent Stack

> **DESIGNED — nothing here is built unless its Evidence line says EXISTS.**
> This team owns *that a message arrives exactly once*, never *what it says* — the seam is
> load-bearing (`technology.md:861`) and it is written into the card: this agent may count
> deliveries and may never send, resend, suppress, or author one. Its failure mode is
> duplication and silence, which no functional test catches, because counts only exist across
> time and process restarts ([[messaging-delivery-charter]] §Distinct from siblings). Mechanism
> references are [[engineering-agent-stack]]'s; message content is [[ai-orchestration-charter]]'s.

## 1. Roster

| Agent | Job in one sentence | Evidence |
|---|---|---|
| `delivery-ledger-auditor` | Hold the id-keyed count of what was intended against what arrived, per channel and across restarts, and report the gap without touching a send path | NEW |

## 2. Agent cards

```yaml
agent: delivery-ledger-auditor
unit: messaging-delivery
triggers:
  - schedule: "daily — exactly-once ledger report (L-MD-1), per channel"   # mirrored in [[messaging-delivery-schedule]]
  - schedule: "weekly — buffer window review and delivery-state honesty (L-MD-3)"
  - topic: process.restarted              # publisher: NONE (gap — L-MD-2 fires on every restart and nothing announces one)
consumes:
  - "a notification_id-keyed delivery ledger — publisher: NONE (gap; no such ledger exists, see §5)"
  - "services/agent-orchestrator/agents/buffer_manager.py — the 30-minute LIFO window and its persistence path"
  - "topics notification.events (publisher: core/message_bus.py:479) and email.events / email.inbound.received (publisher: apps/api-gateway/src/common/orchestrator/inbound-email.controller.ts:60)"
  - "the gateway↔WebSocket bridge bindings (publisher: apps/api-gateway/src/common/orchestrator/, 23 bindings at :275-292 of the bridge service)"
emits:
  - "messaging.duplicate_delivery_rate and messaging.drop_rate per channel → [[messaging-delivery-agenda-board]] and L-ENG-1 (consumer: [[engineering-agent-stack|eng-board-keeper]])"
  - "mass-send records (consumer: [[engineering-loops]] L-ENG-4, the irreversible-class review)"
  - "restart reconciliation counts — buffered / flushed / redelivered / dropped (consumer: [[messaging-delivery-agenda-full]])"
  - "nf_a events (task_type: delivery_audit) — consumer: NONE (gap, see §5)"
routing_class: extraction        # counting ids across time and restarts; the replay-policy half is judgment and is confirm-gated below
quality_bar: "measured against notification_id, never against user reports ([[messaging-delivery-charter]] §Metrics — a restaurant reports forty duplicates and never reports the alert that never arrived). Today: NONE (gap) — no id-keyed ledger exists, so the agent's first honest output is the absence itself."
autonomy:
  read: autonomous
  propose: autonomous            # reconciliation reports land as PRs and board rows
  mutate_stock_money_outbound: confirm   # constant — and every send this team touches is in the outbound family
memory: messaging-delivery
escalates_to: "[[engineering-charter]]"
```

**The card's own hard rule:** the auditor may inspect and report; it may **never send, resend,
or suppress** a message, and it never authors text ([[messaging-delivery-schedule]] §Skills
owned). Resend authority inside an automated loop is precisely how a digest gets sent forty
times. A replay decision after a restart is a proposal for a human, per notification class.

## 3. Skills

| Skill (`.claude/skills/…`) | Tier | Trigger | Doneability | Past instance | Status |
|---|---|---|---|---|---|
| `restart-reconciliation` | T2 | Every process restart (L-MD-2) | Buffered / flushed / redelivered / dropped counts for the window, per notification class, each with an explicit replay verdict a human signs | This pass (2026-08-27) traced the restart path by hand and it does not hold: `buffer_manager.py:145-154` catches a Redis failure, logs `"Redis unavailable (buffer not persistent)"` and continues with `redis_client = None`, and `:222-223` persists fire-and-forget via `asyncio.create_task` with no await — so what survives a restart is *unknown*, not zero | NEW |
| `bus-topology-census` | T2 | Any new exchange or routing key, and quarterly | Every exchange in use is listed with its declaring site, and every exchange asserted on the fly rather than pre-declared is named — no route counted twice, none missed | Performed on 2026-08-25: the [[EXTERNAL_CONNECTIONS]] verification found **ten** exchanges the gateway uses that `core/message_bus.py` does not pre-declare (`email.events`, `recurring.events`, `inventory.events`, `rfq.events`, `delivery.events` and five more), so "reading `message_bus.py` alone under-counts the bus" — [[EXTERNAL_CONNECTIONS]]:137-141 | NEW |

`delivery-gap-trace` and `threading-decision-review` appear in [[messaging-delivery-schedule]]
and are **deliberately not rows here**: tracing intent → batch → channel → provider needs the
id-keyed ledger that does not exist, and no thread merge has been reviewed. Neither has a past
instance to cite.

Consumed, owned elsewhere: the skill envelope and registry ([[skills-charter]]); message content
([[ai-orchestration-charter]]); queue health as infrastructure
([[runtime-resilience-charter|sre-runtime-resilience]]); the auth on these ~84 routes
([[platform-api-charter]]).

## 4. Memory

- **Procedural** — the §3 skills; candidates from consolidation go to
  [[skill-harvesting-charter]]'s queue through the §3.3 gate.
- **Episodic** — nf_a `task_type: delivery_audit` and `restart_reconciliation`. Needs
  `context.notification_id`, `context.channel` (email / push / in-app / websocket) and
  `context.attempt_ordinal` as jsonb keys. The `attempt_ordinal` key is the whole design: a
  duplicate is only visible as a second attempt on one id, and an id-less event stream cannot
  express this team's primary metric at all.
- **Semantic** — `memory/` beside this file, `messaging-delivery-MEMORY.md` as index. Its
  founding facts: the buffer's silent degradation to non-persistent (source:
  `buffer_manager.py:145-154`, 2026-08-27), the ten undeclared exchanges (source:
  [[EXTERNAL_CONNECTIONS]]:137-141, 2026-08-25), and that batching state is split between an
  in-memory buffer and a persist funnel — which is the premortem, not a detail. Provenance
  frontmatter per ADR 0034; every write is a PR.
- **Working** — this card, the MEMORY index, charter §Mandate and §Metrics. The transport spine
  files (`rabbitmq-bridge.service.ts`, `inbound-address.service.ts`, `email-triage.ts`,
  `priority.ts`, `sender-reputation.service.ts`) are retrieval targets by `path:line`;
  `CONVERSATION_THREADING_PLAN.md` and `INBOUND_EMAIL_INTELLIGENCE_PLAN.md` are grep targets.

**Consolidation** — monthly, mirrored in [[messaging-delivery-schedule]]: read the delivery slice
and every restart reconciliation since the last run; distill durable facts, failures first — a
duplicate becomes a fact naming the hop that re-emitted the id, a drop becomes a fact naming the
last hop that saw it, never "delivery quality varied"; expire facts unverified for 90 days;
propose skill candidates. One PR; "no delta" stated when true.

## 5. Async contract

Cross-unit interaction is loops in [[messaging-delivery-loops]], NF-A events, vault PRs, and
skill candidates only. Gap rows:

| Gap | Why it is a gap |
|---|---|
| No `notification_id`-keyed delivery ledger exists | The primary metric names its own measurement basis and no artifact implements it ([[messaging-delivery-charter]] §Evidence). Both numbers are unproducible today; the board shows `unreadable`, which is the honest reading |
| `process.restarted` has no publisher | L-MD-2 fires per restart and nothing announces a restart. Combined with the buffer's non-persistent fallback, a restart during a busy window is currently unobservable in both directions |
| Ten exchanges are asserted on the fly, not declared | Publisher and bridge both `assertExchange`, so they work — but the declared topology is not the real one ([[EXTERNAL_CONNECTIONS]]:137-141). This is the `core/orchestrator.py:198-206` shape waiting to happen: a routing key nobody can enumerate is a routing key nobody notices going quiet |
| `delivery_audit` NF-A events have no declared consumer | Beyond this team's own board row and L-ENG-4 |

## 6. Evidence today

- **EXISTS — the transport spine and the surface.** The ~84 routes, `rabbitmq-bridge.service.ts:35`
  with `handleInboundEmail` at `:528`, the inbound routing services, and `buffer_manager.py`'s
  30-minute LIFO window — all cited in [[messaging-delivery-charter]] §Evidence. The bus topology
  is recorded with `path:line` at [[EXTERNAL_CONNECTIONS]]:124-141.
- **PARTIAL — batching durability.** `buffer_manager.py` has a Redis persistence path
  (`:145-151`, `:511`) and degrades to a warning and an in-memory-only buffer when Redis is
  unavailable (`:153-154`), persisting fire-and-forget (`:222-223`). It exists; it does not
  guarantee.
- **NEW — everything that produces a number.** No delivery ledger, no per-channel rates, no
  restart reconciliation. Both §3 skills describe procedures performed once by hand (2026-08-25
  and 2026-08-27), never on a schedule.
- **Open fork, not resolved here:** TECH-F2 asks whether this is a team or a function inside
  [[platform-api-charter]] (`technology.md:844`). This stack is written at team level because the
  charter is; the fork stays open.

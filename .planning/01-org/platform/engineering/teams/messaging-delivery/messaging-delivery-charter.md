---
type: charter
division: platform
department: engineering
team: messaging-delivery
status: exists
metrics: [messaging.duplicate_delivery_rate, messaging.drop_rate]
updated: 2026-08-24
links: ["[[engineering-charter]]", "[[messaging-delivery-premortem]]", "[[messaging-delivery-agenda-full]]", "[[messaging-delivery-agenda-board]]", "[[messaging-delivery-directive]]", "[[messaging-delivery-loops]]", "[[messaging-delivery-schedule]]", "[[eng-messaging-delivery]]", "[[ai-orchestration-charter]]", "[[platform-api-charter]]", "[[sre-runtime-resilience]]", "[[CONVERSATION_THREADING_PLAN]]", "[[INBOUND_EMAIL_INTELLIGENCE_PLAN]]"]
---

# Messaging & Delivery — Charter

Division **Platform** → Department [[engineering-charter]] → Team `messaging-delivery`
(§2.4 of `.planning/foundation/teams/technology.md:154-179`).

## Mandate

The **transport half** of every conversation: threading, inbound routing, notification
batching and deduplication, push, websocket, calendar invites, contacts. This team owns
**whether a message arrives exactly once**. It does not own what the message says.

That sentence is the entire boundary, and it is load-bearing: one team owning both
drafting and delivery means *"we sent it"* gets confused with *"we meant to send it"*
(`.planning/foundation/teams/technology.md:161-164`).

## Boundaries

Owns outright — **~84 endpoints**, a majority of them unguarded:

| Module | Routes | Guard state |
|---|---|---|
| `apps/api-gateway/src/notifications` | 24 | **all unguarded** |
| `communications` | 18 | **all unguarded** |
| `conversations` | 12 | |
| `contacts` | 8 | **all unguarded** |
| `calendar` | 19 | |
| `events` | 3 | |
| `push/`, `websocket/` | modules | |

Plus the transport spine:

- `apps/api-gateway/src/common/orchestrator/rabbitmq-bridge.service.ts:35` — the TS↔Python
  message bridge, including `handleInboundEmail` at `:528`
- `apps/api-gateway/src/common/orchestrator/inbound-address.service.ts`, `email-triage.ts`,
  `priority.ts`, `sender-reputation.service.ts`
- `services/agent-orchestrator/agents/buffer_manager.py` — the 30-minute LIFO anti-spam
  window

## Distinct from siblings because

Its failure mode is **duplication and silence** — a digest sent forty times, or a
low-stock alert nobody received — **which no functional test catches**
(`technology.md:160-162`). Both halves pass every unit test: the send function worked, the
batch function worked. The defect is in the *count*, and counts only exist across time and
process restarts, which is where tests do not look.

## Explicit non-goals

| Not ours | Whose it is |
|---|---|
| What the message **says** — drafting, tone, negotiation language | [[ai-orchestration-charter]] |
| Whether an action described in a message may be taken | [[action-safety-the-human-gate]] |
| The auth mechanism for these ~84 routes | [[platform-api-charter]] |
| Third-party transport protocol wire details (OAuth to Gmail, Plivo) | [[integration-engineering-charter]] |
| Process restarts, uptime, queue health as infrastructure | [[sre-runtime-resilience]] |
| Whether a notification is *useful* to the operator | [[design-charter]] *(Product)* |
| Consent and lawful basis for contacting someone | [[compliance-charter]] *(Corporate)* |

**The seam, stated in one line** (`technology.md:861`): *AI Orchestration drafts;
messaging-delivery delivers. What it says vs. that it arrives once.*

## Metrics it moves

**Primary: `messaging.duplicate_delivery_rate` and `messaging.drop_rate` per channel**
(email, push, in-app, websocket), **measured against `notification_id` rather than user
reports** (`technology.md:173-175`).

The measurement basis is the metric. User reports are a lagging, biased signal: a
restaurant tells you about forty duplicates and never tells you about the alert that never
arrived. Only an id-keyed ledger sees the drop.

## Evidence today

**EXISTS** (`.planning/foundation/teams/technology.md:166-171`).

**API surface** — the ~84-route table above, transcribed from [[ENDPOINTS]].

**Transport spine**
- `apps/api-gateway/src/common/orchestrator/rabbitmq-bridge.service.ts:35`
  (`handleInboundEmail` at `:528`)
- `apps/api-gateway/src/common/orchestrator/inbound-address.service.ts`
- `apps/api-gateway/src/common/orchestrator/email-triage.ts`
- `apps/api-gateway/src/common/orchestrator/priority.ts`
- `apps/api-gateway/src/common/orchestrator/sender-reputation.service.ts`

**Batching**
- `services/agent-orchestrator/agents/buffer_manager.py` — 30-minute LIFO anti-spam window

**Design corpus**
- `.planning/CONVERSATION_THREADING_PLAN.md`
- `.planning/INBOUND_EMAIL_INTELLIGENCE_PLAN.md`

**What is *not* in evidence:** any `notification_id`-keyed delivery ledger. The primary
metric names its measurement basis and no artifact implements it. Batching state is split
between an in-memory buffer and a persist funnel, which is the premortem — see
[[messaging-delivery-premortem]].

**Open fork:** OD-20 asks whether this team is a team at all, or a function inside
[[platform-api-charter]] (`technology.md:844`). It is chartered here at team level; the
fork is not closed.

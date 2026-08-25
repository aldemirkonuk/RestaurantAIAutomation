---
type: schedule
division: platform
department: engineering
team: messaging-delivery
status: provisional
metrics: []
updated: 2026-08-24
links: ["[[messaging-delivery-charter]]", "[[messaging-delivery-loops]]", "[[engineering-schedule]]", "[[runtime-resilience-charter|sre-runtime-resilience]]", "[[skills-charter]]"]
---

# Messaging & Delivery — Schedule & Skills

## Recurring work

| Cadence | Job | Emits |
|---|---|---|
| **Per event** | Restart reconciliation — L-MD-2, on every process restart | Buffered / flushed / redelivered / dropped counts |
| Per event | Mass-send review — any digest or announcement to a whole contact set | Irreversible-class record into [[engineering-loops]] L-ENG-4 |
| **Daily** | Exactly-once ledger report — L-MD-1 | `duplicate_delivery_rate`, `drop_rate` **per channel** |
| Daily | Send-surface exposure — L-MD-5 | Unguarded send/contact routes; unauthenticated send alerts |
| Weekly | Delivery-state honesty — L-MD-3 | Accepted↔acknowledged gap; stale push tokens; bounce and spam rates |
| Weekly | Threading correctness — L-MD-4 | Unlinked thread merges; unlogged threading decisions |
| Weekly | Buffer window review — `services/agent-orchestrator/agents/buffer_manager.py` 30-minute LIFO | Items held, items aged out, window pressure |
| Monthly | Sender reputation review — `apps/api-gateway/src/common/orchestrator/sender-reputation.service.ts` | Reputation drift per sending domain |
| Monthly | Inbound routing audit — `inbound-address.service.ts`, `email-triage.ts`, `priority.ts`, `rabbitmq-bridge.service.ts:528` | Misrouted inbound, unclassified mail |
| Quarterly | Threading plan review against `.planning/CONVERSATION_THREADING_PLAN.md` and `.planning/INBOUND_EMAIL_INTELLIGENCE_PLAN.md` | Plan-vs-reality diff |

## Skills owned

Skills live in `.claude/skills/`. A skill that has not fired in 30 days is reviewed for
deletion.

**None built yet.** Proposed, each tied to a scheduled job above:

| Proposed skill | Fires on | Why a skill rather than a script |
|---|---|---|
| `delivery-gap-trace` | An intent with no successful delivery | Walks intent → batch → channel attempt → provider response and names the hop that lost it |
| `restart-reconciliation` | Process restart | Must reason about which buffered items are safe to replay and which would duplicate — a policy judgement per notification class |
| `threading-decision-review` | A thread merge with no explicit link header | Presents the evidence for a merge; does not re-thread automatically |

**Constraint on all three:** a skill may **inspect** and **report**; it may not send,
resend, or suppress a message. Resend authority in an automated loop is how a digest gets
sent forty times — the exact failure in `technology.md:160-162`. Message content remains
[[ai-orchestration-charter]]'s; these skills never author text.

Registry governance sits with [[skills-charter]] (Applied AI); this team authors and
retires its own skills within that registry.

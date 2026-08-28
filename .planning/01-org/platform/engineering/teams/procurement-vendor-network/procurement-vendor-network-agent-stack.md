---
type: agent-stack
division: platform
department: engineering
team: procurement-vendor-network
status: designed
updated: 2026-08-27
metrics: [procurement.order_to_delivery_reconciliation_rate, procurement.unguarded_money_moving_routes]
links: ["[[procurement-vendor-network-charter]]", "[[procurement-vendor-network-schedule]]", "[[procurement-vendor-network-loops]]", "[[procurement-vendor-network-directive]]", "[[0034-agent-stack-artifact]]", "[[engineering-agent-stack]]", "[[skills-charter]]", "[[action-safety-the-human-gate-charter]]", "[[platform-api-charter]]"]
---

# Procurement & Vendor Network — Agent Stack

> **DESIGNED — nothing here is built unless its Evidence line says EXISTS.**
> The only Engineering team whose defects move money to third parties
> ([[procurement-vendor-network-charter]] §Distinct from siblings) — every other team's worst
> case is recoverable inside the system; this one's leaves it. So
> `mutate_stock_money_outbound: confirm` is not a formality on this card, it is the whole
> card: **no agent or skill in this unit may place, approve, or amend an order.** Mechanism
> references are [[engineering-agent-stack]]'s; the gate itself is
> [[action-safety-the-human-gate-charter]]'s.

## 1. Roster

| Agent | Job in one sentence | Evidence |
|---|---|---|
| `spend-path-auditor` | Enumerate every path that can reach an order placement, hold the unguarded-money-moving-route count daily, and prepare reconciliation exceptions for a human to rule on | NEW |

## 2. Agent cards

```yaml
agent: spend-path-auditor
unit: procurement-vendor-network
triggers:
  - schedule: "daily — money-path exposure watch (L-PV-2) and recurring-order execution audit"   # mirrored in [[procurement-vendor-network-schedule]]
  - schedule: "weekly — order-to-delivery reconciliation (L-PV-1) and price-contract integrity (L-PV-3)"
  - topic: order.placed                   # publisher: NONE (gap — recurring_order_agent.py places orders on its own scheduler; nothing emits, see §5)
consumes:
  - "the ≈97-route procurement/providers/vendor cluster (publisher: [[ENDPOINTS]] and Nest route metadata)"
  - "services/agent-orchestrator/agents/{procurement_agent,rfq_agent,recurring_order_agent}.py"
  - "vendor price observations and catalogue match state (publisher: supabase/migrations/20260805154027_vendor_price_observations.sql, …20260811010000_vendor_catalogue_match.sql)"
  - "the guarded/unguarded split for these routes (publisher: [[platform-api-charter]]'s census — this team consumes it, it does not compute it)"
emits:
  - "order_to_delivery_reconciliation_rate as raw rate AND no-touch rate side by side → [[procurement-vendor-network-agenda-board]] and L-ENG-1 (consumer: [[engineering-agent-stack|eng-board-keeper]])"
  - "procurement.unguarded_money_moving_routes (consumer: [[engineering-loops]] L-ENG-5 and [[platform-api-charter]], which builds the mechanism)"
  - "reconciliation-exception and price-dispute evidence packets (consumer: a human ruler — never a vendor)"
  - "nf_a events (task_type: spend_path_audit) — consumer: NONE (gap, see §5)"
routing_class: judgment          # partial deliveries, substitutions and unit conversions are the work; none of them is a threshold
quality_bar: "'without human repair' is the grading clause ([[procurement-vendor-network-charter]] §Metrics): a line that reconciled because a person fixed it by hand counts against the rate, not for it. Today: NONE (gap) — no reconciliation measurement is cited anywhere in the repo, so the first output is the absence."
autonomy:
  read: autonomous
  propose: autonomous            # evidence packets and board rows land as PRs
  mutate_stock_money_outbound: confirm   # constant — and here it is the load-bearing line, not boilerplate
memory: procurement-vendor-network
escalates_to: "[[engineering-charter]]"
```

**The card's own hard rule:** `spend-path-auditor` may prepare, evidence, and recommend. It may
not place, approve, or amend an order, and it may not acquire that authority incrementally —
committing spend is [[action-safety-the-human-gate-charter]]'s to gate
([[procurement-vendor-network-schedule]] §Skills owned). A skill that quietly gains commit
authority is premortem M4 arriving through the side door.

## 3. Skills

| Skill (`.claude/skills/…`) | Tier | Trigger | Doneability | Past instance | Status |
|---|---|---|---|---|---|
| `spend-path-audit` | T2 | Monthly (L-PV-4), and any PR touching `procurement/**` or a procurement agent | Every code path that can reach an order placement is named with `path:line` — HTTP routes, scheduled executions, and agent tool calls alike — each marked guarded or not, and each with its spend threshold or the absence of one | The 2026-08-24 evidence pass found `procurement/recurring-orders` is 6 endpoints, **all unguarded** ([[ENDPOINTS]]:428), on the one module that places orders automatically, while `TenantGuard` passes unauthenticated requests through by design. The enumeration has not been repeated since | NEW |
| `agent-authority-check` | T2 | Any change to an agent under `services/agent-orchestrator/agents/` that can reach spend | A verdict per agent: does it still only log, and does its lifecycle carry the harness guarantees (retry, idempotency, DLQ, health) or not — stated, not assumed | Two findings this check would have caught, both recorded in code: `negotiation_playbook_agent.py:11-16` declares `IS_STUB = True` because an agent that "consumes events and produces nothing… reads identically to a working one from every dashboard and health check"; and `recurring_order_agent.py:14` is a **plain class** — "Standalone scheduler — not a message-bus agent" — with no `BaseAgent` guarantees, while owning automatic purchasing | NEW |

`reconciliation-exception-triage` and `vendor-price-dispute-packet` appear in
[[procurement-vendor-network-schedule]] and are **deliberately not rows here**: no reconciliation
measurement exists, so no exception has ever been triaged and no dispute packet assembled.
Neither has a past instance to cite, and this team's primary skill being unjustifiable is the
honest reading of its primary metric being unproduced.

Consumed, owned elsewhere: the skill envelope and registry ([[skills-charter]]); the guard
mechanism ([[platform-api-charter]]); the vendor wire and signatures
([[integration-engineering-charter]]); vendor email drafting ([[ai-orchestration-charter]]).

## 4. Memory

- **Procedural** — the §3 skills; candidates from consolidation go to
  [[skill-harvesting-charter]]'s queue through the §3.3 gate.
- **Episodic** — nf_a `task_type: spend_path_audit` and `reconciliation_exception`. Needs
  `context.order_line_id`, `context.vendor_id`, `context.repair` (none / human / automatic) and
  `context.amount` as jsonb keys. `context.repair` is the metric's discriminator: without it the
  episodic layer cannot distinguish a silent success from an eventual one, which is the entire
  point of the "without human repair" clause.
- **Semantic** — `memory/` beside this file, `procurement-vendor-network-MEMORY.md` as index. Its
  founding facts: the 6 unguarded `recurring-orders` endpoints and their date, the plain-class
  lifecycle of the agent behind them, the stub declaration on `negotiation_playbook_agent`, and
  the spend-threshold register once L-PV-4 first runs. Provenance frontmatter per ADR 0034;
  every write is a PR, and here the audit trail is not merely inspectable — it is the record of
  what could have spent money and did not.
- **Working** — this card, the MEMORY index, charter §Mandate and §Metrics. The ≈97-route table
  and the three procurement agents are retrieval targets by `path:line`, never preloaded.

**Consolidation** — monthly, mirrored in [[procurement-vendor-network-schedule]]: read the audit
and exception slice since the last run; distill durable facts, failures first — every order line
that needed human repair becomes a fact naming the cause (substitution, unit conversion, partial
delivery, price drift), never "reconciliation was lower"; a repeated cause becomes a skill
candidate or a schema request, not a bigger triage queue; expire facts unverified for 90 days.
One PR; "no delta" stated when true.

## 5. Async contract

Cross-unit interaction is loops in [[procurement-vendor-network-loops]], NF-A events, vault PRs,
and skill candidates only. Gap rows:

| Gap | Why it is a gap |
|---|---|
| `order.placed` has no publisher | `recurring_order_agent.py` is a standalone scheduler outside the message bus (`:14-20`), so an automatically-placed order emits nothing. The daily execution audit is a scan, not a reaction — and it is the only thing that would notice an order placed by an unauthenticated caller |
| `procurement.order_to_delivery_reconciliation_rate` has no producer | The primary metric has no cited implementation ([[procurement-vendor-network-charter]] §Evidence). The board's honest reading is `unreadable` |
| The exposure count is consumed, not computed here | `procurement.unguarded_money_moving_routes` depends on [[platform-api-charter]]'s census, which is itself a hand-derived 2026-08-24 baseline. Two unread numbers stacked; recorded rather than assumed |
| `spend_path_audit` NF-A events have no declared consumer | Beyond this team's own board row and L-ENG-5 |

## 6. Evidence today

- **EXISTS — the money path.** The ≈97-route cluster, four vendor and distributor migrations,
  and `procurement_agent.py` / `rfq_agent.py` / `recurring_order_agent.py` — all cited in
  [[procurement-vendor-network-charter]] §Evidence.
- **EXISTS — the stub declaration mechanism, which the charter predates.**
  `negotiation_playbook_agent.py:11-16` now carries `IS_STUB = True` so the orchestrator refuses
  to start it. The hazard the schedule names — a logging-only agent that reads as a working one —
  is handled for that agent by declaration, not by discipline.
- **PARTIAL — the exposure.** The 6 unguarded `recurring-orders` endpoints are live today rather
  than hypothetical ([[ENDPOINTS]]:428), and `recurring_order_agent.py:14` confirms the executor
  behind them runs outside `BaseAgent`'s retry, idempotency, DLQ and health guarantees.
- **NEW — `spend-path-auditor` and both skills.** No reconciliation measurement, no daily
  execution audit, no spend-threshold register exists.

---
type: agent-stack
division: product
department: product-vision
team: service-floor
status: designed
updated: 2026-08-27
metrics: [floor.kitchen_ready_to_waiter_p95_seconds, floor.misroute_rate, floor.providers_emitting_table_and_server, floor.providers_emitting_kitchen_ready]
links: ["[[service-floor-charter]]", "[[service-floor-schedule]]", "[[service-floor-loops]]", "[[service-floor-premortem]]", "[[0034-agent-stack-artifact]]", "[[product-vision-agent-stack]]", "[[pos-bridge-charter]]", "[[partner-alliance-development-charter]]", "[[skills-charter]]"]
---

# Service Floor (Floor Checker) — Agent Stack

> **DESIGNED — nothing here is built unless its Evidence line says EXISTS.**
> **This team is NEW and its inputs are null**, so it gets the smallest card in the
> department: one auditor that counts what providers actually emit and keeps two asks alive.
> Everything downstream — routing, alerting, latency — is gated behind triggers the charter
> already names, and building the notification layer first is
> [[service-floor-premortem]] M1 happening on schedule. Mechanisms stay elsewhere: harness →
> [[harness-runtime-charter]] (**OD-03 open**), transports → [[engineering-charter]].

## 1. Roster

| Agent | Job in one sentence | Evidence |
|---|---|---|
| `floor-input-auditor` | Keep the two provider counts true — both **0 verified** today — and keep every ask to POS Bridge and Partner Alliance named, dated, and escalating; build nothing until Stage 1's trigger fires | NEW; so is everything it would measure |

One row, and it is a *counter*, not a router. The charter's Stage 0 is the only unblocked
deliverable and it is a table, not product code.

## 2. Agent cards

```yaml
agent: floor-input-auditor
unit: service-floor
triggers:
  - schedule: "monthly — POS input audit"           # mirrored in [[service-floor-schedule]]; the team's only active work
  - schedule: "monthly — ask review (named counterparty + date, or it escalates)"
  - topic: pos.provider_registered                  # publisher: NONE (gap — nothing emits when pos-provider.registry.ts changes)
consumes:
  - "apps/api-gateway/src/pos-hub/pos-provider.registry.ts — 9 providers, capability flags at :17-23 (CAP_FULL / CAP_NO_TABLES / CAP_PULL)"
  - "apps/api-gateway/src/pos-hub/pos-types.ts — the CanonicalCheck shape; publisher: [[pos-bridge-charter]]"
  - "supabase/migrations/20260819000000_guest_identity_minimal_slice.sql:11-14 — the only POS corpus that exists, 47 rows"
  - "the open-ask list in [[service-floor-schedule]]"
emits:
  - "floor.providers_emitting_table_and_server + floor.providers_emitting_kitchen_ready → [[product-vision-agent-stack|pv-orchestrator]]'s board row"
  - "a canonical-shape change request for a kitchen-ready event → [[pos-bridge-charter]] (gap: a vault edit, no channel — see §5)"
  - "asks past due → [[partner-alliance-development-charter]], then [[product-vision-charter]]"
  - "nf_a events (task_type: floor_input_audit)"
routing_class: mechanical      # grep the registry, count the columns, diff the ask list — no judgment call anywhere in the loop
quality_bar: "every cell of the provider × field table reads *emitted* / *not emitted* / *unknown-needs-partner* — never blank ([[service-floor-schedule]]); simulator rows never count as emitted. Verdict basis: NONE (gap) — no grader exists for a census (ADR 0017 has none)"
autonomy:
  read: autonomous
  propose: autonomous          # the table, the asks, and the escalations are PRs
  mutate_stock_money_outbound: confirm   # constant; this agent has no such surface
memory: service-floor
escalates_to: "[[product-vision-charter]]; unfiled or stale asks additionally to [[partner-alliance-development-charter]]"
```

**Two hard rules the card carries in its own right.**

1. **`simpos` is a development target, not evidence.** The 47 corpus rows are
   `source='generic_webhook'` simulator output from one 43-minute window; an audit counting a
   simulator as a provider reports confident, false readiness — premortem M1, and
   [[product-vision-premortem]] M3 at department level.
2. **No per-staff output, ever.** No performance scores, rankings, or disciplinary evidence
   (charter §Non-goals). If check-in timing becomes a management stick the data turns
   adversarial and the product stops working; emitting one would reverse that non-goal as a
   side effect rather than as a founder decision (premortem M2).

## 3. Skills

| Skill (`.claude/skills/…`) | Tier | Trigger | Doneability | Past instance | Status |
|---|---|---|---|---|---|
| `pos-input-audit` | T3 | Monthly, or on any change to `apps/api-gateway/src/pos-hub/pos-provider.registry.ts` | A provider × field × mechanism table with no blank cells; simulator sources labelled as such | `server_name`, `covers`, `table_id` and `total` were found **0 of 47** only because someone hand-grepped `20260819000000_guest_identity_minimal_slice.sql:11-14` in the 2026-08-24 session. Nothing re-checks it | NEW |
| `canonical-shape-gap-report` | T3 | A module states a field or event requirement `CanonicalCheck` does not carry | Names the missing field, the consuming module, and files the request against [[pos-bridge-charter]] | Kitchen-ready is **unmodelled**, not merely unpopulated: grepping `pos-types.ts` for `ready`/`fired`/`course`/`ticket`/`kitchen` returns one unrelated void comment (`:29`) — written down for the first time in the 2026-08-24 charter session | NEW |
| `blocked-with-a-name` | T2 | Any unit sets a loop `status: blocked` | The loop carries **both** `blocked_on` and `unblocked_by`; a blocked loop missing either fails the check | `UX_PATHS_CATALOG.md`'s Deferred Decisions Log already carries *why deferred* and *unblocked by* per row and is described as the rarest artifact in the repo; this generalises that discipline, and three of five department loops are blocked today | NEW |

Consumed, owned elsewhere: the canonical shape and its normalizers
([[pos-bridge-charter]]); getting a vendor to emit a kitchen-ready event
([[partner-alliance-development-charter]]); push and websocket transport
([[engineering-charter]]).

## 4. Memory

- **Procedural** — the §3 skills; candidates via [[skill-harvesting-charter]]'s queue, §3.3 gate still applying.
- **Episodic** — nf_a `task_type: floor_input_audit`, **audit runs only**. The charter states
  the neural-footprint tie is minimal and this stack does not inflate it: there is no routing
  decision to trace because there is no routing. When Stage 1 ships, the routing decision
  itself becomes the first genuine NF-A row this team owns.
- **Semantic** — `memory/` beside this file, index `service-floor-MEMORY.md`. Its first two
  facts are known and would otherwise be re-derived monthly: the 47-row corpus is one
  43-minute simulator window, and kitchen-ready is unmodelled in `pos-types.ts`. A third
  accrues per close-time — which asks were open, to whom, and for how long — which is what
  makes premortem M4 (*waiting on a blocker nobody was commissioned to remove*) visible
  before it is a year old. `source`, `confidence`, `last_verified` per ADR 0034; every write
  a PR.
- **Working** — this card, the MEMORY index, charter §Mandate and §Entry trigger. The
  registry and `pos-types.ts` are grep targets by `path:line`, never preloaded.

**Consolidation** — monthly, mirrored in [[service-floor-schedule]]: diff this month's
provider table against last month's facts; a provider that gained or lost a field becomes a
fact naming the mechanism, and an ask aged past its date becomes a **failure fact naming who
was never asked**; expire facts unverified for 90 days; propose candidates. One PR; three
identical all-zero months plus unfiled asks is premortem M4, where the escalation *is* the
action, not the deletion of the job.

## 5. Async contract

The monthly table, ask escalations, memory PRs, NF-A events; loops with close_times in
[[service-floor-loops]] (L4 is `status: blocked` and names both sides). Gap rows:

| Gap | Why it is a gap |
|---|---|
| Kitchen-ready is unmodelled in `CanonicalCheck` | Upstream of everything else here. The request is a [[pos-bridge-charter]] change this team must **commission**, and it travels as a vault edit because no event channel exists |
| `server_name`, `covers`, `table_id`, `total` = **0 of 47** | Floor Checker's entire input is currently null; the primary metric pair cannot be read at all, and reporting it from `simpos` fixtures would be premortem M1 on schedule |
| `pos.provider_registered` has no publisher | Nothing emits on a registry change; the monthly cadence bounds the blind spot at one close-time |
| Three of five scheduled jobs are suspended | Each names its unblocker (Stage 1: one non-simulator provider emitting `table_id` + `server_name`; Stage 2: a kitchen-ready event modelled *and* emitted). Suspended-with-a-name beats running empty |

## 6. Evidence today

- **NEW — the team, the auditor, all three skills, and every `floor.*` number.** No `floor`
  or `floor-checker` module, service, or route exists anywhere in `apps/`, `services/`, or
  `supabase/`; the only mentions are documentation (foundation [[README]]:65,
  `.planning/decisions/0001-mudavym-single-entity.md:6,22`).
- **PARTIAL — the adjacencies it must build on, not re-invent.**
  `pos-hub/pos-types.ts` (`CanonicalCheck` carries `tables`, `employees`),
  `pos-provider.registry.ts:17-23`, `push/expo-push.service.ts`,
  `websocket/websocket.gateway.ts`. Transports exist; the routing contract does not.
- **EXISTS — only the blocker itself**, measured: the 47-row simulator corpus at
  `20260819000000_guest_identity_minimal_slice.sql:11-14`, with all four required fields null.

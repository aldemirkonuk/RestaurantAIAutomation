---
type: schedule
division: product
department: product-vision
team: service-floor
status: provisional
metrics: [floor.providers_emitting_table_and_server, floor.providers_emitting_kitchen_ready]
updated: 2026-08-24
links: ["[[service-floor-charter]]", "[[service-floor-loops]]", "[[service-floor-agenda-board]]", "[[product-vision-schedule]]", "[[pos-bridge-charter]]", "[[partner-alliance-development-charter]]"]
---

# Service Floor (Floor Checker) — Schedule & Skills

## Recurring work

Only two jobs run today. The rest are **suspended with a named unblocker** rather than
scheduled to run empty — for a NEW team with null inputs, an empty run is how a schedule
becomes fiction.

| Cadence | Job | Emits | State |
|---|---|---|---|
| **Monthly** | **POS input audit** — per provider in `pos-provider.registry.ts`: emits `table_id`? `server_name`? any kitchen-ready signal? through what mechanism? | `floor.providers_emitting_table_and_server`, `floor.providers_emitting_kitchen_ready` | **Running** — this is the team's only active work |
| **Monthly** | **Ask review** — every open ask to [[pos-bridge-charter]] and [[partner-alliance-development-charter]] has a named counterparty and a date, or it escalates | `floor.open_asks_with_named_counterparty`, `floor.asks_past_due` | **Running** |
| Per-service | **Routing-correctness read** — mis-routes, ambiguity fallbacks, and acknowledgment decay within a single shift | `floor.misroute_rate`, `floor.alert_acknowledgment_rate` | ⏸ **Suspended** — unblocked by Stage 1 (a non-simulator provider emitting `table_id` + `server_name`) |
| Per-service | **Latency segment read** — the four published segments, not one end-to-end number | `floor.kitchen_ready_to_waiter_p95_seconds` + 4 segments | ⏸ **Suspended** — unblocked by Stage 2 (kitchen-ready modelled and emitted) |
| Monthly | **Engagement-integrity pair** — compliance rate vs table-outcome delta; plus a count of performance-view requests | `floor.check_in_compliance_rate`, `floor.table_outcome_delta` | ⏸ **Suspended** — unblocked by Stage 1 shipping to one real restaurant |

**Anti-sprawl rule:** a scheduled job producing no action for **3 consecutive runs** is
downgraded or deleted. Applied honestly here, that means: if the monthly input audit returns
the same all-zero table three times **and** the two asks are still unfiled, the failure is
not the job — it is [[service-floor-premortem]] M4, and the escalation is the action.

## Skills owned

Skills live in `.claude/skills/`. A skill unfired for 30 days is reviewed for deletion. Per
foundation §3.3 every skill names a trigger, doneability criteria, a **real past instance**,
and an owner — no speculative skills. The repo has exactly one project skill today
(`.agents/skills/railway-config/SKILL.md`), so everything below is **proposed, not built**.

| Skill (proposed) | Tier | Trigger | Doneability | Past instance that justifies it |
|---|---|---|---|---|
| `pos-input-audit` | T3 | Monthly, or on any change to `apps/api-gateway/src/pos-hub/pos-provider.registry.ts` | Produces a provider × field × mechanism table where every cell is *emitted* / *not emitted* / *unknown-needs-partner*; no cell may be blank | The 0-of-47 field coverage was discovered only because someone hand-grepped `20260819000000_guest_identity_minimal_slice.sql:11-14`. Nothing re-checks it |
| `canonical-shape-gap-report` | T3 | A module states a field or event requirement the canonical shape does not carry | Names the missing field, the consuming module, and files the request against [[pos-bridge-charter]] | The kitchen-ready event is *unmodelled*, not merely unpopulated — grepping `pos-types.ts` for `ready`/`fired`/`course`/`ticket`/`kitchen` returns one unrelated void comment (`:29`). Nobody had written that down before this session |
| `blocked-with-a-name` | T2 | Any unit sets a loop `status: blocked` | The loop carries `blocked_on` **and** `unblocked_by`; a blocked loop without both fails the check | Deferred items across this repo already prove the value: `UX_PATHS_CATALOG.md`'s Deferred Decisions Log carries *why deferred* and *unblocked by* per row, and it is described as the rarest artifact here. This generalizes that discipline |

**Deliberately not proposed:**

- **No push/notification-delivery skill.** The transport already exists
  (`apps/api-gateway/src/push/expo-push.service.ts`,
  `apps/api-gateway/src/websocket/websocket.gateway.ts`) and belongs to
  [[engineering-charter]]. A skill here would be this team building the fun part first,
  which is its own premortem M1.
- **No check-in compliance reporting skill.** Per the charter's deliberate non-goal, this
  team does not produce per-staff performance output. A skill that generates one would make
  reversing that non-goal a side effect rather than a founder decision.

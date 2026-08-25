---
type: schedule
division: platform
department: data
team: pos-operational-telemetry-ingest
status: provisional
metrics: [pos.line_resolution_rate, pos.unresolved_queue_depth, pos.provider_schema_drift_findings, sales.density]
updated: 2026-08-24
links: ["[[pos-operational-telemetry-ingest-charter]]", "[[pos-operational-telemetry-ingest-loops]]", "[[pos-operational-telemetry-ingest-directive]]", "[[data-schedule]]", "[[integration-engineering-charter]]", "[[skill-registry-authoring-charter]]", "[[skill-lifecycle-anti-sprawl-charter]]", "[[README]]"]
---

# POS & Operational Telemetry Ingest — Schedule & Skills

## Recurring work

| Cadence | Job | Emits |
|---|---|---|
| Daily | **Provider shape monitoring** — line count, modifier rate, category mix, void rate, check value | `drift_findings` rows; same-day escalation on a step change |
| Daily | Raw-payload retention check — is anything under investigation about to expire? | Irreversibility escalation if yes |
| Weekly | **Unresolved queue drain** — output is a mapping-rule change, not a cleared row | `pos.unresolved_queue_depth`, updated mapping rules |
| Weekly | Per-restaurant resolution report — **minimum and distribution, never mean** | `pos.line_resolution_rate`, `pos.worst_restaurant_resolution_rate` |
| Weekly | `sales.density` into the department's three-number L0 report | `sales.density`; `demand_score` eligibility list |
| Weekly | `pos_catalog_match_proposals` review with [[catalogue-identity-charter]] | Confirmed matches; identity questions |
| Per onboarding | **First-week resolution gate** — onboarding does not complete until it passes | `pos.first_week_resolution_rate` |
| Per incident | Seam triage — ownership assigned within 1 hour | `ingest.time_to_ownership` |
| Monthly | Provider adapter review against vendor changelogs, with [[integration-engineering-charter]] | Adapter changes ahead of breakage |

**Anti-sprawl ([[README]] §6):** a job producing no action for 3 consecutive runs is
downgraded or deleted — **with one stated exception, and the reasoning matters.** Daily
provider shape monitoring and the retention check are *irreversibility guards*: for every
other source in this department, a missed detection means a delayed fix; here it means
permanently lost data. A guard that has not fired is doing its job, not wasting a slot. The
rule exists to kill reports nobody reads, and it is not applied mechanically to the two
checks whose failure cannot be undone.

The genuine downgrade candidate is the **monthly adapter review** — if vendor changelogs
produce no adapter change for three months, it folds into the daily shape monitoring, which
detects the same thing empirically rather than by reading.

## Skills owned

**None today.** `.claude/skills/` does not exist in this repo; the only project skill is
`.agents/skills/railway-config/SKILL.md` ([[README]] §3.1). Proposals below, against the
§3.3 protocol.

| Skill | Tier | Trigger | Doneability criteria | Real past instance |
|---|---|---|---|---|
| `pos-line-resolution-repair` | T1 Domain | Unresolved queue depth rises for two close-times, or a weekly drain is due | Queue drained **and** at least one mapping rule changed so the class stops recurring; per-restaurant rate republished | `…20260805133000_pos_unresolved_lines_and_review_queues.sql` (`pos_unresolved_lines`, `pos_catalog_match_proposals`); `pos-hub/catalog-matcher.service.ts` |
| `pos-shape-drift-check` | T3 Operational | Daily, per provider | Every monitored distribution compared to its trailing window; step changes written to `drift_findings` with the date; same-day escalation raised | `drift_findings` table (`…:82`) + `agents/drift_agent.py` — the drift pattern already exists for SimPOS catalog↔mapping comparison and is the direct analogue |
| `pos-onboarding-verify` | T2 Department | A new restaurant's POS connection goes live | First-week resolution rate measured and above threshold, or onboarding held open with the mapping gaps listed | `pos-hub/pos-provider.registry.ts`, `toast-auth.service.ts`; the control that would have prevented [[pos-operational-telemetry-ingest-premortem]] M2 |
| `sales-density-report` | T2 Department | Weekly, and before any insight is published on a restaurant | Density emitted per restaurant; restaurants below threshold excluded from `demand_score` and flagged to [[analytics-bi-charter]] | `…20260813170000_enrichment_demand_priority.sql:80-95` computes `demand_score` from sales — the dependency is real and currently unguarded |

**Not proposed:** a `pos-webhook-replay` skill. Replay belongs to
[[integration-engineering-charter]] on the delivery side of the seam
(`technology.md:859`), and a skill here that reaches into transport would re-blur the exact
line [[pos-operational-telemetry-ingest-directive]] Decision 2 exists to keep sharp.

**Anti-sprawl:** a skill unfired for 30 days is reviewed for deletion ([[README]] §3.3), by
[[skill-lifecycle-anti-sprawl-charter]] rather than by this team.

---
type: schedule
division: platform
department: reliability-sre
team: state-integrity-invariants
status: provisional
metrics: [sre.mttd_silent_corruption, integrity.open_findings_oldest_age, integrity.invariants_with_outcome_side_check_pct]
updated: 2026-08-24
links: ["[[state-integrity-invariants-charter]]", "[[state-integrity-invariants-loops]]", "[[reliability-sre-schedule]]", "[[schema-migrations-charter]]", "[[skill-lifecycle-anti-sprawl-charter]]"]
---

# State Integrity & Invariants — Schedule & Skills

## Recurring work

| Cadence | Job | Emits |
|---|---|---|
| **Immediate, out of band** | **Tenant-leakage response** (L-INT-1) — never queued, never batched, never waits for a cadence | `integrity.tenant_leakage_time_to_human_minutes` |
| Daily 06:00 | `schema-parity.yml` cron — **already running** (`:26-28`). [[release-engineering-charter]] runs it; **we grade it** | `schema.days_since_hand_applied_ddl` |
| Daily | Invariant-agent runs — `state_invariant_enforcer.py`, `drift_agent.py`, `inequality_detector.py`; every run writes a `decision_log` row (`drift_agent.py:1-19`) | Findings into `drift_findings` |
| On every push | **Author≠auditor tripwire** — fail if one commit touches both `supabase/migrations/` and a gate script or its workflow | `integrity.commits_touching_migration_and_gate` (target: 0) |
| Weekly | **Findings triage** (L-INT-2) — every finding to a terminal state: fixed / accepted-with-reason / invalidated | `integrity.open_findings_oldest_age`, `..._closed_by_disposition` |
| Weekly | **MTTD-by-class report** (L-INT-5) — unmeasured classes displayed as "unmeasured", never omitted, never averaged | `sre.mttd_silent_corruption_by_class` |
| Weekly | **Gate-integrity review** (L-INT-3) — red streaks, relaxation requests, drift inventory delta | `ci.parity_red_consecutive_runs` |
| Monthly | **Outcome-side coverage** (L-INT-4) — divergence sampling; cross-tenant row probe | `integrity.invariants_with_outcome_side_check_pct` |
| Monthly | **Stub-vs-capability audit** — does the mandate still read broader than what runs? | `integrity.stub_agents_counted_as_coverage` (today: **2**) |

**The out-of-band row is the schedule's whole argument.** Everything else here is a cadence;
tenant leakage is the one signal for which a cadence is the wrong shape, and putting it in a
table of weekly jobs — even at the top — would be
[[state-integrity-invariants-premortem]] M5 written into the calendar.

**Anti-sprawl ([[README]] §6):** a job with no action for 3 consecutive runs is downgraded or
deleted. Two rows here are structurally exempt: the author≠auditor tripwire and the
tenant-leakage path, whose value is precisely that they almost never fire. The **weekly
findings triage** is not exempt — if it finds nothing for three weeks, either the detectors
have stopped (check the liveness twin, [[observability-telemetry-plumbing-charter]]) or the
system is genuinely clean, and those must be distinguished rather than assumed.

## Skills owned

Skills live in `.claude/skills/`. A skill unfired for 30 days is reviewed for deletion
([[README]] §3.3). **This team owns none today** — everything below is proposed.
`schema-drift-check` is named directly in the foundation's skill taxonomy as a T3
operational skill ([[README]] §3.2), which makes it the most clearly-specified skill in this
department.

| Skill | Tier | Trigger — the exact situation | Doneability | Real past instance |
|---|---|---|---|---|
| `schema-drift-check` *(proposed; named in [[README]] §3.2)* | T3 operational | The parity gate goes red, or a hand-applied production DDL is suspected | Drift fully enumerated against `.planning/07-reference/SCHEMA_DRIFT_INVENTORY.txt`, and each item either migrated or filed with a reason — **never closed by explanation alone** | **Yes, and it is the strongest in the department:** production once carried **27 tables, 403 columns and 13 functions created by no migration** (`scripts/check_schema_parity.sh:6-11`) |
| `findings-triage` *(proposed)* | T2 department | Weekly, and immediately when `integrity.open_findings_oldest_age` exceeds one close-time | Every open finding reaches a terminal state; money and stock escalated to a human, never auto-applied | **Yes** — `drift_findings` rows sit at status `open` with no reader; the queue exists and nothing drains it |
| `tenant-leakage-response` *(proposed)* | T2 department | A cross-tenant row or cross-tenant access signal from `state_invariant_enforcer.py` | Human reached within minutes; scope of exposure established; write-pause decision executed per the pre-agreed policy | **Partial** — the detector exists (`state_invariant_enforcer.py:1-30`); no leak has been recorded, and the response path is what is missing |
| `invariant-outcome-sample` *(proposed)* | T3 operational | Monthly, and after any change to a write path that a grep gate protects | A data-side divergence sample exists for each grep gate; any green-CI-plus-divergence result raised immediately | **Yes** — `check_no_direct_stock_writes.sh:10` states its own limitation; a dynamic table name or a Postgres function passes it |
| `gate-relaxation-review` *(proposed)* | T2 department | Anyone proposes loosening a threshold, a check, or an invariant | The proposal is routed to `OPEN-DECISIONS.md` as a **rule change**, with the metric-and-knob-in-one-hand risk named explicitly | **Yes, by analogy in this repo's own words** — `technology.md:700-702` describes exactly this: thresholds relaxed defensibly once, dashboard stays green, substrate quietly degrades |

**One deliberate omission.** There is no `build-more-gates` skill, and there will not be
one. Adding gates is the most legible work this team could do and the least likely to move
`sre.mttd_silent_corruption` — five gates already exist and five of six are greps. The
skill layer here is pointed at **disposition and coverage honesty**, which is where the
failure modes actually live.

---
type: schedule
division: platform
department: reliability-sre
team: observability-telemetry-plumbing
status: provisional
metrics: [nf_a.emission_coverage, obs.metrics_with_liveness_twin_pct]
updated: 2026-08-24
links: ["[[observability-telemetry-plumbing-charter]]", "[[observability-telemetry-plumbing-loops]]", "[[reliability-sre-schedule]]", "[[skill-registry-authoring-charter]]", "[[skill-lifecycle-anti-sprawl-charter]]"]
---

# Observability & Telemetry Plumbing — Schedule & Skills

## Recurring work

| Cadence | Job | Emits |
|---|---|---|
| Hourly | **Heartbeat check** — `build_info` gauge present and equal to 1; alert on *absence*, not on threshold | `obs.heartbeat_gauge_present` |
| Daily | **Flat-zero sweep** — any board metric at exactly zero for a full period while an independent path shows activity | `obs.metrics_flat_zero_full_period_count` |
| Weekly | **Emission-coverage report** (L-OBS-1) — coverage over **agent tasks**, plus the top three missing tuple fields | `nf_a.emission_coverage`, `nf_a.tuple_fields_missing_top3` |
| Weekly | **Liveness-twin review** (L-OBS-2) — which board metrics still have no twin | `obs.metrics_with_liveness_twin_pct` |
| Weekly | **Triage-vs-instrumentation report** (L-OBS-4) — the two numbers side by side | `obs.triage_share_of_capacity` |
| Monthly | **Error-capture fidelity** (L-OBS-3) — captured vs. reported; PII attribute scan | `obs.errors_captured_vs_reported_ratio`, `obs.pii_attributes_found_count` |
| Monthly + after every incident | **Health-surface retrospective** (L-OBS-5) — was it green while something was broken? | `obs.health_green_during_confirmed_incident_count` |
| On every dependency change | **`prometheus_client` presence assertion** in the built image | Pass/fail; a fail is an M1 near-miss and is logged as one |

The last row is the cheapest insurance in this department: the whole of
[[observability-telemetry-plumbing-premortem]] M1 begins with a dependency quietly leaving
the image.

**Anti-sprawl ([[README]] §6):** a job producing no action for **3 consecutive runs** is
downgraded or deleted. The hourly heartbeat check is explicitly exempt from being read as
"no action" — its silence *is* its output, and it is the one job here whose value is that
it almost never fires.

## Skills owned

Skills live in `.claude/skills/`. A skill unfired for 30 days is reviewed for deletion
([[README]] §3.3). **This team owns none today** — the repo has exactly one project skill
(`.claude/skills/railway-config/`) and it belongs to [[release-engineering-charter]].
Everything below is **proposed**.

| Skill | Tier | Trigger — the exact situation | Doneability | Real past instance ([[README]] §3.3 rule 3) |
|---|---|---|---|---|
| `signal-liveness-audit` *(proposed)* | T2 department | Weekly review, and immediately after any change to the dependency set or the container image | Every board metric has a named, verified liveness twin; the list of metrics without one is empty or explicitly accepted | **Yes** — `observability.py:53-84` returns `NoopMetric` and logs it at INFO (`:50`); this is the mechanism the skill exists to catch |
| `nf-emission-liveness-report` *(proposed; renamed from `nf-a-coverage-report` 2026-08-27, ADR 0035 — coverage belongs to Applied AI, this job answers "is the pipe live")* | T2 department | Weekly, and on demand before any L4 claim | Every NF-A field classified emitting / dead / unjoinable, plus the three most-missing fields named | **Yes** — `decision_log` and `api_spend` cover parts of the tuple from two writers and cannot be joined (`technology.md:745-746`) |
| `trace-attribute-review` *(proposed)* | T2 department | Any PR adding a span attribute, Sentry context, or log field | Attribute is on the allowlist or the PR is blocked; no raw guest identifier crosses the boundary | **Yes** — the guest-data invariant already needed shell guards: `check_no_raw_guest_channels.sh`, `check_no_guest_name_matching.sh` |
| `incident-timeline-assemble` *(proposed)* | T3 operational | An incident is declared and folded here per §6.0 | A timeline joining `decision_log`, Sentry events, and deploy history, with gaps in the record explicitly marked as gaps | **Yes** — `LogsTimelinePage.tsx` exists precisely because assembling this by hand was needed |

**Why `incident-timeline-assemble` is T3 and last:** it serves the responsibility this team
absorbed rather than the one it was chartered for. It is worth building *because* it makes
triage cheap — which is the only durable defence against
[[observability-telemetry-plumbing-premortem]] M3. A skill that shortens the work that
displaces your mandate is better than resenting the work.

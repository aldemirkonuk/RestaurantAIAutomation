---
type: agenda-board
division: platform
department: reliability-sre
team: observability-telemetry-plumbing
status: provisional
metrics: [nf_a.emission_coverage, obs.decision_log_join_rate, obs.metrics_with_liveness_twin_pct]
updated: 2026-08-24
links: ["[[observability-telemetry-plumbing-charter]]", "[[observability-telemetry-plumbing-agenda-full]]", "[[observability-telemetry-plumbing-loops]]", "[[reliability-sre-agenda-board]]"]
---

# Observability & Telemetry Plumbing — Board

> **PROVISIONAL — no work done yet.**

## This team's artifacts

```dataview
TABLE type AS Artifact, status AS Status, updated AS Updated
FROM "01-org/platform/reliability-sre"
WHERE team = this.team
SORT type ASC
```

## Sibling teams — who else is in this department

```dataview
TABLE team AS Team, status AS Grade, updated AS Updated
FROM "01-org/platform/reliability-sre"
WHERE type = "charter" AND team != null AND team != this.team
SORT team ASC
```

## Stale check — nothing here should be older than 60 days

```dataview
TABLE updated AS Updated, type AS Artifact
FROM "01-org/platform/reliability-sre"
WHERE team = this.team AND date(updated) < date(today) - dur(60 days)
SORT updated ASC
```

## Numbers

- `nf_a.emission_coverage` — **not computable yet** (no per-task join). Denominator is **agent tasks**, never requests
- `obs.decision_log_join_rate` — must move **first**; coverage is meaningless before it
- `obs.metrics_with_liveness_twin_pct` — board-admission gate for every other metric
- Triage volume — published **beside** coverage, so the M3 divergence is visible

## Open

- [ ] One correlation id: task → model call → `decision_log` → `api_spend`
- [ ] `build_info` heartbeat gauge — zero must stop looking like silence
- [ ] `observability.py:50` no-op fallback logs at INFO → raise to WARNING
- [ ] `observability_degraded` on `health-proxy.controller.ts` → render in `AdminHealth.tsx`
- [ ] Coverage definition published: agent-task denominator, whole-tuple, no partial credit
- [ ] Redaction allowlist before any new span ships
- [ ] Triage time-box agreed with the department

## Watch

- `observability.py:53` `NoopMetric` — the live M1 mechanism
- `decision_log` growing daily with rows that cannot be joined to cost — delay is permanent, not linear
- Coverage rising while `obs.decision_log_join_rate` stays near zero = M4 in progress
- **Do not** build a green-field `neural_footprint_event` table without closing the fork first (`technology.md:739`)

---
type: agenda-board
division: platform
department: reliability-sre
status: provisional
metrics: [nf_a.emission_coverage, sre.time_to_revert, sre.dlq_depth_and_oldest_age, sre.mttd_silent_corruption, sre.days_since_verified_restore]
updated: 2026-08-24
links: ["[[reliability-sre-charter]]", "[[reliability-sre-agenda-full]]", "[[reliability-sre-loops]]", "[[reliability-sre-premortem]]"]
---

# Reliability / SRE — Board

> **PROVISIONAL — no work done yet.**

## Department units — live query, not a hand-written list

```dataview
TABLE type AS Artifact, status AS Status, updated AS Updated
FROM "01-org/platform/reliability-sre"
WHERE department = this.department
SORT team ASC, type ASC
```

## Teams and their one question

```dataview
TABLE team AS Team, status AS Grade, updated AS Updated
FROM "01-org/platform/reliability-sre"
WHERE type = "charter" AND team != null
SORT team ASC
```

## Anything in this department not touched in 60 days

```dataview
TABLE updated AS Updated, type AS Artifact
FROM "01-org/platform/reliability-sre"
WHERE department = this.department AND date(updated) < date(today) - dur(60 days)
SORT updated ASC
```

- Empty table = healthy. A populated table is either finished work or fiction
  (foundation §3.3, §6).

## The five numbers

- `nf_a.emission_coverage` — **unmeasured**; two writers, no per-task join key
- `sre.time_to_revert` — **unmeasured**; `rollback-guide` prints steps
- `sre.dlq_depth_and_oldest_age` — **unmeasured**; nothing consumes `queue.dead_letters`
- `sre.mttd_silent_corruption` — schema drift ≤24h; tenant leakage + stock divergence **unmeasured**
- `sre.days_since_verified_restore` — **no value has ever existed**

## Open

- [ ] Heartbeat gauge so zero ≠ silence — [[observability-telemetry-plumbing-charter]]
- [ ] First restore drill — [[release-engineering-charter]] — the named gap
- [ ] DLQ consumer — [[runtime-resilience-charter]]
- [ ] Findings-queue owner and aging — [[state-integrity-invariants-charter]]
- [ ] Red-signal audit: fix in one close-time or delete the gate — department
- [ ] `ci.yml:8` tolerated red — resolve or make it a hard failure

## Rejected, on purpose

- [x] ~~Incident Response / On-Call~~ — org cosplay at this scale; trigger recorded in [[reliability-sre-charter]]
- [x] ~~Infrastructure Cost~~ — three vendors on flat plans; inference cost is [[model-routing-inference-economics-charter]]

## Watch

- `ci.yml:8` self-documented red tolerance
- `observability.py:53` `NoopMetric` — zero indistinguishable from silence
- `drift_findings` status `open` — a number that can only rise
- OD-24 guardian-agent co-ownership · OD-23 7-vs-3 artifacts · OD-19 team granularity

---
phase: 22-observability-deployment
verified: "2026-07-31"
status: gaps_found
method: "retroactive — live code, live database, repo artifacts. Not SUMMARY aggregation."
score: "9/10 verifiable requirements satisfied; OBS-04 NOT satisfied; DEP-06 not verifiable from this repo"
requirements_satisfied: [OBS-01, OBS-02, OBS-03, DEP-01, DEP-02, DEP-03, DEP-04, DEP-05]
requirements_unsatisfied: [OBS-04]
requirements_unverifiable: [DEP-06]
---

# Phase 22 Verification — Observability & Deployment

## Why this exists, and why it took actual work

The v2.0 audit scored Phase 22 PARTIAL with the sharpest wording of any phase:
**"zero verification artifacts of any kind"** — five SUMMARY files and nothing
else. REQUIREMENTS.md nonetheless showed 10/10 boxes checked.

An earlier pass in this sweep declined to close it, on the grounds that writing a
VERIFICATION from SUMMARY self-reports would transcribe claims into a document
shaped like an audit. That was right, and doing the work instead found a
requirement marked satisfied that is not.

## OBS-04 is NOT satisfied

The requirement names four business metrics:

> stock updates/second, notification delivery rate, report generation time,
> webhook processing

`core/observability.py` declares eight metrics, and **none of them are these**:

```
agent_messages_processed_total      (Counter)
agent_processing_duration_seconds   (Histogram)
agent_queue_depth                   (Gauge)
agent_circuit_breaker_state         (Gauge)
agent_status                        (Gauge)
connection_pool_size                (Gauge)
http_requests_total                 (Counter)
http_request_duration_seconds       (Histogram)
```

Every one is **infrastructure** telemetry — how the message bus and HTTP layer are
behaving. OBS-04 asks for **business** telemetry: whether stock is moving, whether
notifications are arriving, how long reports take. Searching `observability.py`
for `stock`, `notification_deliver`, `report_generation` and `webhook` returns
zero hits each.

This matters beyond the checkbox. Infrastructure metrics answer "is the system
up?"; business metrics answer "is the system doing its job?" A deployment can be
green on all eight of the above while no stock has moved for a day — which is
precisely the class of failure this milestone kept surfacing (registered agents
that do nothing, writes that never persist, feeds nobody subscribes to).

**REQUIREMENTS.md checkbox for OBS-04 is now unchecked**, and a v3.0 task carries
the work.

## Satisfied

| Req | Claim | Evidence |
|---|---|---|
| OBS-01 | Sentry with `traces_sample_rate=0.1` | `main.py` — `sentry_sdk.init(...)`, `traces_sample_rate=0.1` verbatim |
| OBS-02 | `GET /health/agents`, per-agent detail | `health-proxy.controller.ts:27` `@Get("agents")`, `:32` `@Get("agents/:name")` |
| OBS-03 | JSON logs via `GET /metrics` | `health-proxy.controller.ts:85` `@Controller("metrics")` |
| DEP-01 | Vercel frontend | `apps/web/vercel.json` |
| DEP-02 | All v1.0 + v2.0 migrations applied | live DB: **106 applied**, `20260208024921` → `20260803224738` |
| DEP-03 | Containerised agent service | `services/agent-orchestrator/Dockerfile`, `.railway/` |
| DEP-04 | CloudAMQP | configured in `env.example` |
| DEP-05 | Redis | `config/settings.py`, `core/database.py`, `.env.example` |

## Not verifiable from this repository

**DEP-06** — "Toast API credentials configured, friend's restaurant webhook
pointed at production". This is a live third-party integration whose state lives
in Toast's dashboard and a production environment variable. No amount of reading
this repo can confirm or refute it, and a VERIFICATION that claimed to would be
the exact failure mode this sweep exists to correct. Left explicitly unverified
rather than assumed.

## Conclusion

`gaps_found`, not `passed`. Eight of ten requirements verified satisfied, one
verified **unsatisfied**, one unverifiable here.

The audit's instinct was right for a reason it did not state: the missing artifact
was not paperwork. Producing it honestly required checking, and checking found a
gap that five SUMMARY files and a fully-ticked requirements list had both missed.

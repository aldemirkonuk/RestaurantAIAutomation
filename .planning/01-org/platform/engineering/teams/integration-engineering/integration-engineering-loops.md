---
type: loops
division: platform
department: engineering
team: integration-engineering
status: provisional
metrics: [integration.verified_signature_coverage, integration.webhook_silence_duration, integration.placeholder_hosts_unresolved]
updated: 2026-08-24
links: ["[[integration-engineering-charter]]", "[[integration-engineering-premortem]]", "[[integration-engineering-directive]]", "[[engineering-loops]]", "[[platform-api-charter]]", "[[dat-pos-telemetry-ingest]]", "[[LOOP-MAP]]"]
loop_count: 5
loop_count: 5
loop_ids: ["ie-webhook-silence-watch", "ie-signature-coverage", "ie-placeholder-host-resolution", "ie-arrival-vs-fitness-triage", "ie-third-party-contract-drift"]
loop_close_times: ["hourly", "weekly", "one-shot, then per-PR", "weekly", "daily"]
loop_statuses: ["proposed", "proposed", "proposed", "proposed", "proposed"]
---

# Integration Engineering — Loops

Every loop names its close-time. A loop that cannot state how fast it closes is a
diagram, not a loop.

---

## L-IE-1 — Webhook silence watch

```yaml
type: loop
id: ie-webhook-silence-watch
owner: integration-engineering
measures: [integration.webhook_silence_duration, integration.events_received_per_integration, integration.active_poll_failures]
changes: [integration.alert_thresholds, adapter.retry_policy, integration.polling_schedule]
inputs_from: [toast, simpos, pos-hub, vendor-portal, sre-observability]
outputs_to: [engineering, dat-pos-telemetry-ingest, inventory-ledger, sre-runtime-resilience]
close_time: hourly
status: proposed
```

The team's spine and its reason for existing: **a webhook that stops arriving produces no
signal at all** (`technology.md:269-270`). Measures time since last inbound event **per
integration**, against that integration's own rhythm rather than a global constant.
**Hourly**, because the premortem's cost is measured in service periods — a Friday-evening
outage found on Monday has already produced a week of wrong stock. Paired with an active
poll wherever the provider API permits one.

---

## L-IE-2 — Signature coverage

```yaml
type: loop
id: ie-signature-coverage
owner: integration-engineering
measures: [integration.verified_signature_coverage, integration.public_routes_without_rejection_test, integration.unsigned_requests_rejected]
changes: [route.verification_middleware, ci.public_route_allowlist, integration.test_suite]
inputs_from: [platform-api, security]
outputs_to: [platform-api, security, red-team, decision-office]
close_time: weekly
status: proposed
```

Counters premortem M2. The team's **first task** per `technology.md:264-266`, currently
unmeasured across ≈51 public routes. The measurement basis is deliberately strict: a route
counts as verified only when a test proves an **unsigned request is rejected**. Secrets in
the environment (`POS_HUB_WEBHOOK_SECRET` 8 refs, `TOAST_WEBHOOK_SECRET` 2 refs) are
evidence of intent and are not counted.

---

## L-IE-3 — Placeholder host resolution

```yaml
type: loop
id: ie-placeholder-host-resolution
owner: integration-engineering
measures: [integration.placeholder_hosts_unresolved, integration.placeholder_hosts_reachable]
changes: [source.callback_urls, ci.placeholder_host_gate]
inputs_from: [security, sre-observability]
outputs_to: [security, engineering, decision-office]
close_time: one-shot, then per-PR
status: proposed
```

Counters premortem M3. `abc123.ngrok.io` and `your-domain.com` appear in source paths
([[EXTERNAL_CONNECTIONS]]:13,21) and nobody currently knows whether they are dead, dev-only,
or live. An `ngrok` subdomain is leased and reassignable, so a live callback is an inbound
path a stranger can claim. The loop runs **once to resolve**, then converts into a per-PR
grep gate so the class cannot return. Findings route to [[security-charter]], not to a
cleanup backlog.

---

## L-IE-4 — Arrival-versus-fitness triage

```yaml
type: loop
id: ie-arrival-vs-fitness-triage
owner: integration-engineering
measures: [integration.unclaimed_data_quality_reports, integration.report_age_days, integration.events_with_delivery_record]
changes: [integration.delivery_records, seam.triage_default]
inputs_from: [dat-pos-telemetry-ingest, dat-substrate-quality, inventory-ledger]
outputs_to: [dat-pos-telemetry-ingest, engineering, decision-office]
close_time: weekly
status: proposed
```

Holds the seam at `technology.md:859` — **delivered correctly vs usable as L0**. This team
is left-of-seam and therefore takes first triage on every ambiguous report, answering one
question: *did the event arrive, intact and on time?* That requires per-event delivery
records, so `events_with_delivery_record` is tracked as a prerequisite. The real metric is
the **age of unclaimed reports**: two teams looking at a report and neither claiming it is
[[engineering-premortem]] M1 in its most likely form.

---

## L-IE-5 — Third-party contract drift

```yaml
type: loop
id: ie-third-party-contract-drift
owner: integration-engineering
measures: [integration.payload_schema_mismatches, integration.adapter_rejection_rate, integration.provider_api_version_lag]
changes: [adapter.payload_mapping, integration.contract_tests]
inputs_from: [toast, simpos, pos-hub, partnerships]
outputs_to: [partnerships, engineering, dat-pos-telemetry-ingest]
close_time: daily
status: proposed
```

The contract is owned by someone else and can change without notice
(`technology.md:247-248`). This loop watches for the change *as a change* — schema
mismatches and rejection rate — rather than waiting for the downstream symptom
("inventory looks stale"). A **rising rejection rate is good news relative to silence**: it
means the adapter noticed. Breakages escalate jointly with [[partnerships-charter]], who
own the conversation with the provider.

---

## Close-time summary

| Loop | Close-time | Counters |
|---|---|---|
| L-IE-1 webhook silence watch | **hourly** | M1 |
| L-IE-2 signature coverage | weekly | M2, M5 |
| L-IE-3 placeholder host resolution | one-shot, then per-PR | M3 |
| L-IE-4 arrival-vs-fitness triage | weekly | M4 |
| L-IE-5 third-party contract drift | daily | M1 (the loud half) |

---
type: loops
division: intelligence
department: security
team: perimeter-ingress-integrity
status: provisional
metrics: [sec.unverified_public_ingress, sec.fail_open_defaults, sec.distributed_rate_limit_present, sec.secrets_in_url_or_bundle]
updated: 2026-08-24
links: ["[[perimeter-ingress-integrity-charter]]", "[[perimeter-ingress-integrity-premortem]]", "[[perimeter-ingress-integrity-directive]]", "[[perimeter-ingress-integrity-agenda-board]]", "[[security-loops]]", "[[access-control-tenant-isolation-loops]]", "[[integration-engineering-charter]]", "[[platform-api-charter]]", "[[LOOP-MAP]]"]
---

# Perimeter & Ingress Integrity — Loops

Every loop names its close-time. A loop that cannot state how fast it closes is a
diagram, not a loop.

Four loops. Two weekly (the campaign), two monthly (the standing perimeter). Each maps to
a numbered mechanism in [[perimeter-ingress-integrity-premortem]].

---

## L-PII-1 — Per-route ingress verdicts

```yaml
type: loop
id: pii-ingress-verdicts
owner: perimeter-ingress-integrity
measures: [sec.unverified_public_ingress, sec.ingress_routes_with_named_sender, sec.module_labels_corrected]
changes: [security.ingress_policy, ci.public_route_allowlist, integration.signature_policy]
inputs_from: [access-control-tenant-isolation, integration-engineering, platform-api]
outputs_to: [security, engineering, decision-office, red-team]
close_time: weekly
status: proposed
```

Counters **M2** and **M4**. Confirms the provisional 43-route baseline
(**20 verified · 23 not**), one verdict at a time.

The measure that does the real work is `sec.ingress_routes_with_named_sender`, today
**unmeasured**. A route with a signature but no named sender is the `simpos` shape, and
this is the only number that catches it. `sec.module_labels_corrected` is the honesty
term — two of five module labels have already been wrong, so a campaign that corrects zero
was not checking.

Feeds and is fed by [[access-control-tenant-isolation-loops]]'s L-ACT-1: verdicts cross in
both directions, and today the crossing is internal to one team.

---

## L-PII-2 — Fail-mode audit

```yaml
type: loop
id: pii-fail-mode-audit
owner: perimeter-ingress-integrity
measures: [sec.fail_open_defaults, sec.controls_with_no_secret_test]
changes: [platform.control_defaults, ci.startup_secret_assertion]
inputs_from: [platform-api, engineering, access-control-tenant-isolation]
outputs_to: [security, engineering, decision-office]
close_time: weekly
status: proposed
```

Counters **M1** — the likeliest failure, because failing open is the house habit rather
than an oversight.

Baseline **4**: `tenant.guard.ts:38-46` plus three independent
`|| "your-secret-key-change-in-production"` fallbacks (`jwt.strategy.ts:12-13`,
`auth.service.ts:64-66`, `auth.module.ts:28-30`). That those three were shipped separately,
each by someone who did not know about the other two, is why a *loop* is needed rather than
a fix.

`sec.controls_with_no_secret_test` exists because an untested fail-closed branch is a
fail-open branch that has not been observed yet. `pos-hub.service.spec.ts:239` is the only
control in the repo that currently passes this measure.

Weekly while the count is above zero; drops to monthly when it reaches zero and a CI
startup assertion holds it there.

---

## L-PII-3 — Rate limit with its multiplier

```yaml
type: loop
id: pii-rate-limit-multiplier
owner: perimeter-ingress-integrity
measures: [sec.distributed_rate_limit_present, sec.instances_in_production, sec.effective_ai_tier_limit]
changes: [platform.rate_limit_store, security.mitigation_citations]
inputs_from: [platform-api, reliability-sre]
outputs_to: [security, ai-surface-security, engineering, decision-office]
close_time: monthly
status: proposed
```

Counters **M3**. The output is a formatting rule as much as a metric: **every citation of a
rate limit reads `tier × instances`**, never `tier`, until the store is shared
(`rate-limit.guard.ts:65-70`).

`sec.effective_ai_tier_limit` is the derived number that matters —
`20/60s × instance count`. It was the only brake on the analytics denial-of-wallet hole,
which makes it [[ai-surface-security-charter]]'s input too, and that is why this loop
outputs there.

`sec.instances_in_production` is **unknown** today. A rate limit whose multiplier nobody
knows has no value, only a config line.

---

## L-PII-4 — Secret surface inventory

```yaml
type: loop
id: pii-secret-surface
owner: perimeter-ingress-integrity
measures: [sec.secrets_in_url_or_bundle, sec.env_vars_with_named_consumer, sec.placeholder_domains_in_source]
changes: [security.secret_policy, docs.external_connections_scan]
inputs_from: [platform-api, engineering, integration-engineering]
outputs_to: [security, engineering, reliability-sre, decision-office]
close_time: monthly
status: proposed
```

Counters **M5**. 80 environment variables (`EXTERNAL_CONNECTIONS.md`), **0** with a
recorded consumer and fallback.

Two known leak paths, both of which defeat rotation rather than merely risking exposure:
`?secret=` on `inbound-email` (`inbound-email.controller.ts:57-58`) puts historical values
in access logs that rotation cannot reach, and `VITE_DEV_AUTH_BYPASS_SECRET` is compiled
into the web bundle, so every previously-built bundle keeps its value forever. Fixing the
paths precedes writing a rotation policy — a rotation plan for a secret already sitting in
log files is theatre.

`sec.placeholder_domains_in_source` tracks `abc123.ngrok.io`, `your-domain.com`, `a.com`,
`via.placeholder.com` (`README:59`) — fixtures or stale config, but they should never be
reachable from a production code path.

**Anti-sprawl note, applied to this loop.** This is an inventory task wearing a recurring
costume. If `sec.env_vars_with_named_consumer` is not moving after three runs, the loop is
deleted and replaced by a one-time audit plus a scan column in
`EXTERNAL_CONNECTIONS.md` — foundation §6's 3-run rule, applied to ourselves.

---

## Close-time summary

| Loop | Close-time | Counters | Alarm state |
|---|---|---|---|
| L-PII-1 per-route ingress verdicts | weekly | M2, M4 | a coverage report with 5 rows, not 43 |
| L-PII-2 fail-mode audit | weekly → monthly at 0 | M1 | `logger.warn` then normal processing |
| L-PII-3 rate limit multiplier | monthly | M3 | a tier cited without its multiplier |
| L-PII-4 secret surface inventory | monthly, **3-run sunset** | M5 | "which services read X?" takes >1 min |

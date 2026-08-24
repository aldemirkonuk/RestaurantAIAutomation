---
type: loops
division: platform
department: engineering
team: messaging-delivery
status: provisional
metrics: [messaging.duplicate_delivery_rate, messaging.drop_rate, messaging.restart_reconciliation_gap]
updated: 2026-08-24
links: ["[[messaging-delivery-charter]]", "[[messaging-delivery-premortem]]", "[[messaging-delivery-directive]]", "[[engineering-loops]]", "[[runtime-resilience-charter|sre-runtime-resilience]]", "[[ai-orchestration-charter]]", "[[LOOP-MAP]]"]
loop_count: 5
loop_count: 5
loop_count: 5
loop_ids: ["md-exactly-once-ledger", "md-restart-survival", "md-delivery-state-honesty", "md-threading-correctness", "md-send-surface-exposure"]
loop_close_times: ["daily", "per-event", "weekly", "weekly", "daily"]
loop_statuses: ["proposed", "proposed", "proposed", "proposed", "proposed"]
---

# Messaging & Delivery — Loops

Every loop names its close-time. A loop that cannot state how fast it closes is a
diagram, not a loop.

---

## L-MD-1 — Exactly-once ledger

```yaml
type: loop
id: md-exactly-once-ledger
owner: messaging-delivery
measures: [messaging.duplicate_delivery_rate, messaging.drop_rate, messaging.intents_without_delivery]
changes: [notification.ledger_schema, delivery.idempotency_keys, channel.retry_policy]
inputs_from: [ai-orchestration, inventory-ledger, procurement-vendor-network, integration-engineering]
outputs_to: [engineering, sre-observability, decision-office]
close_time: daily
status: proposed
```

The team's spine. Keyed on `notification_id` **minted at intent**, never at send —
otherwise a message that was never attempted has no row and drops are invisible
(premortem M2). Reported **per channel**: email, push, in-app, websocket. Daily, because
a drop has no user signal to wait for.

---

## L-MD-2 — Restart survival

```yaml
type: loop
id: md-restart-survival
owner: messaging-delivery
measures: [messaging.restart_reconciliation_gap, messaging.buffered_items_lost, messaging.redelivered_on_boot]
changes: [buffer_manager.persistence, delivery.replay_policy]
inputs_from: [sre-runtime-resilience]
outputs_to: [sre-runtime-resilience, engineering, decision-office]
close_time: per-event
status: proposed
```

Counters premortem M1. Fires on **every** process restart, not a sample — the population
is small and each one can silently drop a service-hours alert. Emits: buffered, flushed,
redelivered, dropped. A restart with no record is itself the finding, and escalates as a
joint item with [[runtime-resilience-charter|sre-runtime-resilience]].

---

## L-MD-3 — Delivery-state honesty

```yaml
type: loop
id: md-delivery-state-honesty
owner: messaging-delivery
measures: [messaging.accepted_vs_acknowledged_gap, messaging.stale_push_tokens, messaging.email_bounce_and_spam_rate]
changes: [channel.state_model, push.token_pruning, email.deliverability_config]
inputs_from: [integration-engineering, client-surfaces]
outputs_to: [engineering, design, compliance]
close_time: weekly
status: proposed
```

Counters premortem M3. Tracks the gap between **accepted** (provider took it) and
**acknowledged** (a human demonstrably saw it), per channel. Where a channel cannot report
arrival, the loop records the limitation rather than rounding up — a 99.9% delivered figure
built on provider-accepts is worse than no figure.

---

## L-MD-4 — Threading correctness

```yaml
type: loop
id: md-threading-correctness
owner: messaging-delivery
measures: [messaging.threads_merged_without_explicit_link, messaging.thread_splits_on_same_correspondent, messaging.threading_decisions_unlogged]
changes: [inbound_address.routing_rules, threading.heuristics]
inputs_from: [ai-orchestration, integration-engineering]
outputs_to: [ai-orchestration, engineering, catalogue-identity]
close_time: weekly
status: proposed
```

Counters premortem M4. Threading is identity work in transport clothing, so it borrows
[[catalogue-identity-charter]]'s discipline: a wrong **merge** of two conversations is
worse than a wrong split, and the two are never summed. Every threading decision is logged
with its reason (in-reply-to, address match, subject heuristic) so a bad draft can be
traced back to the merge that caused it.

---

## L-MD-5 — Send-surface exposure

```yaml
type: loop
id: md-send-surface-exposure
owner: messaging-delivery
measures: [messaging.unguarded_send_routes, messaging.unguarded_contact_read_routes, messaging.unauthenticated_sends_observed]
changes: [route.guards, alerting.rules, ci.public_route_allowlist]
inputs_from: [platform-api, security]
outputs_to: [platform-api, security, compliance, red-team]
close_time: daily
status: proposed
```

Counters premortem M5. **50 unguarded routes** today — `notifications` (24),
`communications` (18), `contacts` (8) — on modules that send messages under our name and
read a restaurant's contact list. Daily, and running on logging alone until
[[platform-api-charter]]'s mechanism lands. Contact **reads** are tracked separately from
sends: exfiltration is silent and permanent, where a bad send at least surfaces.

---

## Close-time summary

| Loop | Close-time | Counters |
|---|---|---|
| L-MD-1 exactly-once ledger | daily | M2 |
| L-MD-2 restart survival | per-event | M1 |
| L-MD-3 delivery-state honesty | weekly | M3 |
| L-MD-4 threading correctness | weekly | M4 |
| L-MD-5 send-surface exposure | daily | M5 |

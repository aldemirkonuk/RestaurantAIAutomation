---
phase: 20
slug: wave-1-level-4-hardening
status: secured
threats_open: 0
threats_total: 18
threats_closed: 18
asvs_level: 1
audited: "2026-04-12"
---

# Phase 20: Security Verification Report

**Phase Goal:** Bring 4 golden path agents (InventoryEngine, POSIntegrationAgent, NotificationAgent, ReportingAgent) from Level 1.5 to Level 4 using BaseAgent infrastructure.
**Audited:** 2026-04-12
**Status:** SECURED — threats_open: 0

---

## Threat Register

| Threat ID | Category | Component | Disposition | Status | Evidence |
|-----------|----------|-----------|-------------|--------|----------|
| T-20-01-01 | Tampering | message_id idempotency (InventoryEngine) | mitigate | CLOSED | `inventory_engine.py` lines 102–104: `_check_idempotency(message_id)` at top of all 3 handlers before any write |
| T-20-01-02 | Repudiation | stock state changes | mitigate | CLOSED | `inventory_engine.py`: `log_decision()` at lines 152, 256, 363; `append_event()` at lines 160, 264, 371 — all 3 handlers covered |
| T-20-01-03 | Denial of Service | event_store insert in hot path | accept | CLOSED | Best-effort; exception caught in BaseAgent — does not block stock update |
| T-20-01-04 | Elevation of Privilege | manual_correction handler manager_id | accept | CLOSED | Auth deferred to API gateway (Phase 21 scope) |
| T-20-02-01 | Spoofing | process_toast_webhook HMAC verification | mitigate | CLOSED | `pos_integration_agent.py` lines 178–187: `hmac.HMAC(secret.encode, payload.encode, sha256)` rejects before `_check_idempotency`; ordering enforced and documented in comment on line 176 |
| T-20-02-02 | Tampering | order_guid composite idempotency key | mitigate | CLOSED | `pos_integration_agent.py` line 194: `f"{order_guid}:{event_type_raw}"` — composite key confirmed |
| T-20-02-03 | Information Disclosure | Toast API credentials in config | accept | CLOSED | Credentials loaded from environment variables, not hardcoded; secrets management in Phase 22 |
| T-20-02-04 | Denial of Service | polling saga retry path | mitigate | CLOSED | HMAC gate (lines 178–187) blocks unsigned requests before saga; idempotency key (line 196) deduplicates before `_handle_incomplete_webhook` (line 284) |
| T-20-02-05 | Elevation of Privilege | compensate_saga PartialOrderReceived | accept | CLOSED | Internal RabbitMQ exchange — not externally accessible; consumers validate payload schema |
| T-20-03-01 | Spoofing | event_id idempotency key | accept | CLOSED | event_id from internal RabbitMQ bus — not externally injectable |
| T-20-03-02 | Tampering | notification_deliveries status field | mitigate | CLOSED | `20260415000001_notification_deliveries.sql` line 9: `CHECK (status IN ('sent', 'failed', 'pending'))` enforced at DB layer |
| T-20-03-03 | Repudiation | Failed notification audit trail | mitigate | CLOSED | `notification_agent.py` line 320: pending row per dispatch; line 346: failure row with error text; line 464: `_send_to_dlq()` after 3 failures |
| T-20-03-04 | Information Disclosure | Error messages in notification_deliveries | accept | CLOSED | Internal table, not externally queryable; delivery error details are not sensitive PII |
| T-20-03-05 | Denial of Service | Retry loop exhaustion | mitigate | CLOSED | `notification_agent.py` line 463: DLQ triggered at `>= 3` failures; line 471: `_dlq_escalated` set prevents infinite re-escalation |
| T-20-04-01 | Tampering | composite idempotency key construction (ReportingAgent) | accept | CLOSED | All components (restaurant_id, report_type, date) from internal bus — not externally injectable |
| T-20-04-02 | Repudiation | Scheduled report generation | mitigate | CLOSED | `reporting_agent.py` lines 189–196: `log_decision("report_generated", confidence=0.9)` with restaurant_id, report_type, date on every successful generation |
| T-20-04-03 | Denial of Service | Concurrent pg_cron triggers | mitigate | CLOSED | `reporting_agent.py` line 163: composite key `f"{restaurant_id}:{report_type}:{date_str}"`; `_check_idempotency` at line 166 |
| T-20-04-04 | Information Disclosure | PDF report written to temp file | accept | CLOSED | Report access controls deferred to delivery layer (Phase 22 scope) |

---

## Accepted Risks Log

| Threat ID | Rationale | Owner | Phase to Close |
|-----------|-----------|-------|----------------|
| T-20-01-03 | event_store insert is best-effort by design; blocking stock updates on event store failure would reduce availability with negligible security benefit | architecture | — (by design) |
| T-20-01-04 | manager_id authorization enforced at API gateway level, not agent level — consistent with layered security model | architecture | Phase 21/22 |
| T-20-02-03 | Environment variable injection is the established pattern; no hardcoded secrets present | ops | Phase 22 (secrets mgmt) |
| T-20-02-05 | RabbitMQ exchanges are internal infrastructure — not exposed at network boundary | architecture | — (by design) |
| T-20-03-01 | Internal message bus is a trusted boundary — event_id originates from within the system | architecture | — (by design) |
| T-20-03-04 | Delivery error strings (e.g., "Plivo API timeout") are operational data, not sensitive PII | ops | — (by design) |
| T-20-04-01 | Composite key inputs sourced from internal scheduler trigger — no external injection vector | architecture | — (by design) |
| T-20-04-04 | PDF content is restaurant business data; access controls belong at the delivery/API layer | architecture | Phase 22 |

---

## Trust Boundaries

| Boundary | Description | Protection |
|----------|-------------|------------|
| RabbitMQ → InventoryEngine | Incoming messages may be replayed or duplicated | `_check_idempotency` at handler entry |
| InventoryEngine → Supabase | Stock writes must be serialized | Optimistic locking (Phase 19) + event_store sequence |
| Toast POS → POST /webhook | Untrusted external HTTPS POST | HMAC-SHA256 verification before any processing |
| POSIntegrationAgent → Toast API | Outbound HTTP to external service | Credentials from env vars; response schema validated |
| Internal bus → NotificationAgent | Internal alert messages | event_id from trusted bus; status CHECK constraint at DB |
| NotificationAgent → SMS/Email providers | Outbound to Plivo / Gmail / SendGrid | Credentials in config; delivery tracked in notification_deliveries |
| pg_cron → ReportingAgent | Scheduled trigger from internal infrastructure | Composite idempotency key deduplicates concurrent triggers |

---

## Key Deviation (informational)

The notification_deliveries migration was created as `20260415000001_notification_deliveries.sql` instead of `20260410000000_notification_deliveries.sql` (timestamp conflict with pre-existing `20260410000000_phase10_pricing.sql`). The DDL content is identical to the plan spec. The CHECK constraint closing T-20-03-02 is present and correct.

---

## Security Audit Trail

### Audit 2026-04-12

| Metric | Count |
|--------|-------|
| Threats found | 18 |
| Threats closed (mitigate — code verified) | 10 |
| Threats closed (accept — risk documented) | 8 |
| Threats open | 0 |

**Auditor:** Claude (gsd-security-auditor)
**Method:** Static code verification — grep patterns against implementation files; migration DDL check for DB constraints.

---

_Audited: 2026-04-12_
_Verifier: Claude (gsd-security-auditor)_

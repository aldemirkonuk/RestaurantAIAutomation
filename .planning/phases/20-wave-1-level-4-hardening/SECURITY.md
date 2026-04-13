# SECURITY.md — Phase 20: wave-1-level-4-hardening

**Audit Date:** 2026-04-12
**ASVS Level:** 1
**Auditor:** gsd-security-auditor (claude-sonnet-4-6)
**Result:** SECURED — 10/10 mitigate threats closed, 8/8 accept threats documented

---

## Threat Verification — Mitigate Disposition

| Threat ID | Category | Component | Status | Evidence |
|-----------|----------|-----------|--------|----------|
| T-20-01-01 | Tampering | message_id idempotency | CLOSED | `inventory_engine.py` lines 102–104: `_check_idempotency(message_id)` called at top of all 3 handlers before any business logic |
| T-20-01-02 | Repudiation | stock state changes | CLOSED | `inventory_engine.py`: `log_decision()` called in `_handle_stock_evaluated` (line 152), `_handle_order_delivered` (line 256), `_handle_manual_correction` (line 363); `append_event()` called in all 3 handlers (lines 160, 264, 371) |
| T-20-02-01 | Spoofing | Toast webhook HMAC | CLOSED | `pos_integration_agent.py` lines 178–187: `verify_webhook_signature()` using `hmac.HMAC` with raw bytes called before idempotency check; signature rejection returns before `_check_idempotency` is reached. Comment on line 176 explicitly documents ordering: "must happen BEFORE idempotency check so forged replays are rejected at the HMAC gate (T-20-02-01)" |
| T-20-02-02 | Tampering | order_guid idempotency key | CLOSED | `pos_integration_agent.py` lines 192–198: `idempotency_key = f"{order_guid}:{event_type_raw}"` — composite key prevents replay of same order with different event_type |
| T-20-02-04 | DoS | polling saga retry | CLOSED | `pos_integration_agent.py` line 178: HMAC gate blocks unsigned requests before saga path is reachable; line 196: idempotency key deduplicates same (order_guid, event_type) before `_handle_incomplete_webhook` is reached; saga triggered only on empty selections inside `handle_order_completed` (line 284) |
| T-20-03-02 | Tampering | notification_deliveries status field | CLOSED | `supabase/migrations/20260415000001_notification_deliveries.sql` line 9: `CHECK (status IN ('sent', 'failed', 'pending'))` enforced at DB level; channel also has CHECK constraint on line 8 |
| T-20-03-03 | Repudiation | Failed notifications | CLOSED | `notification_agent.py` line 320: every dispatch inserts pending row to `notification_deliveries`; line 346: failed row updated with error text; line 464: `_send_to_dlq()` called after 3 failures — full audit trail confirmed |
| T-20-03-05 | DoS | Retry loop | CLOSED | `notification_agent.py` lines 458–471: retry counter incremented per failure; DLQ triggered at `>= 3` (line 463); `_dlq_escalated` set (line 471) prevents re-escalation — exactly 3 failures cap confirmed |
| T-20-04-02 | Repudiation | Scheduled report generation | CLOSED | `reporting_agent.py` lines 189–196: `log_decision("report_generated", ...)` called with `confidence=0.9`, inputs including `restaurant_id`, `report_type`, `date` after every successful generation |
| T-20-04-03 | DoS | Concurrent pg_cron triggers | CLOSED | `reporting_agent.py` lines 148–170: composite key `f"{restaurant_id}:{report_type}:{date_str}"` built at `process_message` entry; `_check_idempotency` called before any handler dispatch — second trigger returns `{"skipped": True}` |

---

## Accepted Risks Log

| Threat ID | Category | Accepted Risk Rationale | Status |
|-----------|----------|------------------------|--------|
| T-20-01-03 | DoS | `append_event` failure in hot path is best-effort; exception caught in BaseAgent `append_event`, failure logged but does not block stock update | ACCEPTED |
| T-20-01-04 | EoP | `manual_correction` handler accepts any `manager_id`; authentication/authorization enforced at API gateway boundary — deferred to Phase 21 | ACCEPTED |
| T-20-02-03 | Info Disclosure | Toast API credentials (`toast_client_id`, `toast_client_secret`) loaded from config dict (environment variables at runtime); secrets management hardening deferred to Phase 22 | ACCEPTED |
| T-20-02-05 | EoP | `compensate_saga` publishes `PartialOrderReceived` to internal RabbitMQ `pos.events` exchange; exchange is not externally accessible; consumers validate payload schema | ACCEPTED |
| T-20-03-01 | Spoofing | `event_id` used as idempotency key originates from internal RabbitMQ bus — not externally injectable at this agent's trust boundary | ACCEPTED |
| T-20-03-04 | Info Disclosure | Error text written to `notification_deliveries.error` column is internal delivery error detail (e.g., SMTP timeout); not sensitive PII; table is not externally queryable | ACCEPTED |
| T-20-04-01 | Tampering | Composite key components (`restaurant_id`, `report_type`, `date`) originate from internal message bus — not externally injectable at ReportingAgent's boundary | ACCEPTED |
| T-20-04-04 | Info Disclosure | PDF written to `/tmp/` — access controls at delivery layer deferred to Phase 22; PDF generation is an internal operation not exposed externally | ACCEPTED |

---

## Unregistered Threat Flags

No `## Threat Flags` section was present in any 20-01 through 20-04 SUMMARY.md files.

---

## Verification Evidence Details

### inventory_engine.py
- `_check_idempotency` calls: 3 (lines 102, 192, 294)
- `log_decision` calls: 3 (lines 152, 256, 363)
- `append_event` calls: 3 (lines 160, 264, 371)
- Idempotency runs before business logic in all 3 handlers

### pos_integration_agent.py
- HMAC verification: `hmac.HMAC(secret.encode('utf-8'), payload.encode('utf-8'), hashlib.sha256).hexdigest()` (line 143–147)
- Signature check precedes `_check_idempotency` by ~14 lines (lines 178–198)
- Composite idempotency key: `f"{order_guid}:{event_type_raw}"` (line 194)
- Saga methods: `start_saga`, `advance_saga`, `complete_saga`, `compensate_saga` all present (lines 564–594)
- `PartialOrderReceived` event published on exhaustion (line 582)

### notification_agent.py
- `_check_idempotency` called before dispatch (line 362)
- `notification_deliveries` insert: line 320 (pending); update sent: line 336; update failed: line 346
- DLQ trigger: `>= 3` failures at line 463; guarded against re-escalation by `_dlq_escalated` set

### supabase/migrations/20260415000001_notification_deliveries.sql
- `CHECK (status IN ('sent', 'failed', 'pending'))` present (line 9)
- `CHECK (channel IN ('sms', 'email', 'slack'))` present (line 8)
- Note: migration filename deviated from plan (`20260415000001` vs planned `20260410000000`) due to timestamp conflict with existing migration `20260410000000_phase10_pricing.sql`. Functionally equivalent.

### reporting_agent.py
- Composite key: `f"{restaurant_id}:{report_type}:{date_str}"` (line 163)
- `_check_idempotency` at `process_message` entry (line 166)
- `log_decision("report_generated", confidence=0.9)` (lines 189–196)
- `_mark_processed` called after successful generation (lines 185–187)

---
phase: 32-provider-outbound-communication-engine
plan: "06"
subsystem: agent-orchestrator
tags: [intelligence-extraction, progressive-summarization, invoice-matching, unknown-sender, provint]
dependency_graph:
  requires: [32-03, 32-04]
  provides: [email-text-invoice-extraction, dynamic-profile-extraction, rolling-summarization, invoice-fuzzy-matching, unknown-sender-detection]
  affects: [visual_verification_agent, provider_communication_agent, email_intel_agent]
tech_stack:
  added: []
  patterns:
    - Haiku semantic extraction with JSON fallback + regex fallback (triple-layer resilience)
    - Python-level JSONB merge for profile_dynamic (no SQL injection surface)
    - commitment_type enum whitelist before negotiation_facts INSERT
    - FuzzyMatcher composite score → auto_suggest/possible_match/no_match notification
    - Fail-open unknown sender detection (preserves email processing on lookup failure)
key_files:
  created:
    - services/agent-orchestrator/tests/test_intelligence_pipeline.py
  modified:
    - services/agent-orchestrator/agents/visual_verification_agent.py
    - services/agent-orchestrator/agents/provider_communication_agent.py
    - services/agent-orchestrator/agents/email_intel_agent.py
decisions:
  - Hardcoded haiku_model string in VisualVerificationAgent._extract_invoice_from_email_text (agent has no Settings property)
  - Python dict merge for profile_dynamic (not Postgres || operator) — avoids supabase-py limitation, equivalent result
  - Fail-open on _detect_unknown_sender DB failure — unknown sender check is informational; blocking email processing on DB error violates D-01
  - Added _handle_invoice_received_event bridge in ProviderCommunicationAgent to complete the event pipeline from email → extraction → match
metrics:
  completed_at: "2026-05-14T15:48:34Z"
  tasks: 4
  files_changed: 4
---

# Phase 32 Plan 06: Intelligence Extraction and Progressive Summarization Pipeline Summary

**One-liner:** Email-text invoice extraction via Haiku + regex fallback, dynamic provider profile auto-update via JSONB merge, rolling summarization every 2 rounds into negotiation_facts, FuzzyMatcher invoice matching with manager notification, and PROVINT-04 unknown sender detection — all wired end-to-end via message bus.

## Tasks Completed

| # | Task | Commit | Key Files |
|---|------|--------|-----------|
| 1 | Add _extract_invoice_from_email_text() to VisualVerificationAgent | af65aea | visual_verification_agent.py (+70 lines) |
| 2 | Add _extract_dynamic_profile, _maybe_summarize, _handle_invoice_match | 5b56985 | provider_communication_agent.py (+301 lines) |
| 3 | Write test_intelligence_pipeline.py (13 tests) | c60f775 | tests/test_intelligence_pipeline.py (new, 322 lines) |
| 4 | Extend EmailIntelAgent — PROVINT-04 + invoice event wiring | f36821b | email_intel_agent.py, provider_communication_agent.py (+140 lines) |

## What Was Built

### Task 1: _extract_invoice_from_email_text() — VisualVerificationAgent
- Semantic invoice field extraction from email body text via Claude Haiku
- Returns `{vendor_name, invoice_number, invoice_date, line_items[], total}`
- Falls back to existing `_parse_invoice_text()` regex on Haiku failure
- Returns `{}` on complete failure (non-raising)
- Email body truncated at 4000 chars (T-32-06-04 mitigated)
- SpendLogger called for every Haiku invocation (TOKENBDGT-03)

### Task 2: Three new methods in ProviderCommunicationAgent
**_extract_dynamic_profile():**
- Extracts 6 dynamic fields: response_speed, negotiation_style, preferred_contact_days, typical_delivery_day, relationship_tier, payment_pattern
- Python-level JSONB merge on providers.profile_dynamic (scoped by restaurant_id)
- SpendLogger + log_decision for audit trail
- Fully non-fatal — wrapped in outer try/except

**_maybe_summarize():**
- Triggers on `round_count > 0 and round_count % 2 == 0` — NO-OP otherwise
- UPDATEs procurement_conversations.rolling_summary
- INSERTs negotiation_facts rows with commitment_type whitelist validation (`{INDICATIVE, OFFER, COUNTER, AGREEMENT}`)
- SpendLogger + log_decision per invocation

**_handle_invoice_match():**
- Fetches open procurement_orders (PENDING/CONFIRMED/DRAFT) for restaurant+provider
- FuzzyMatcher composite score (provider×0.30 + wine×0.40 + qty±30%×0.15 + date±45d×0.15)
- Notification tiers: auto_suggest (≥0.80), possible_match (0.50-0.80), no_match (<0.50)
- No auto-order creation — manager must explicitly confirm (T-32-06-03)

### Task 3: test_intelligence_pipeline.py — 13 tests (all passing)
- 2 × _extract_dynamic_profile (happy path + non-fatal API failure)
- 4 × _maybe_summarize (odd no-op + zero no-op + even runs + commitment_type normalization)
- 2 × _extract_invoice_from_email_text (structured result + Haiku failure fallback)
- 2 × _handle_invoice_match (notification type assertion + orphan no_match)
- 3 × PROVINT-04 (unknown→True, known→False, notification fired)

### Task 4: EmailIntelAgent — PROVINT-04 + Invoice Pipeline
**_detect_unknown_sender():**
- Checks providers table by email (ilike, case-insensitive)
- Falls back to provider_contacts table for secondary contacts
- Fail-open: returns False on DB error (preserves email processing)

**_notify_unknown_sender():**
- Inserts `type=unknown_sender` notification with `status=unread` (verified schema)
- Metadata: sender_email, sender_name, subject, action=add_to_providers

**_triage_inbound wiring:**
- Unknown sender check fires BEFORE email classification (informational, non-blocking)
- OPERATIONAL branch: invoice keyword detection (subject+body) → publishes `provider.invoice.received`
- ProviderCommunicationAgent now subscribes to `provider.invoice.received` → `_handle_invoice_received_event` → `_extract_invoice_from_email_text` → `_handle_invoice_match`

## Verification Results

| Check | Expected | Actual | Status |
|-------|----------|--------|--------|
| _extract_invoice_from_email_text in VVA | 1 | 1 | ✅ |
| 3 new methods in PCA | ≥3 | 7 (incl. calls) | ✅ |
| unknown sender methods in EIA | ≥2 | 4 | ✅ |
| All tests pass | 13 | 13 | ✅ |
| negotiation_facts in PCA | ≥1 | 5 | ✅ |
| profile_dynamic in PCA | ≥2 | 8 | ✅ |
| rolling_summary in PCA | ≥1 | 11 | ✅ |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] VisualVerificationAgent has no settings property**
- **Found during:** Task 1
- **Issue:** Plan code referenced `self.settings.haiku_model` but `VisualVerificationAgent` has no `settings` property or `_settings` attribute (only config dict from constructor).
- **Fix:** Hardcoded `_HAIKU_MODEL = "claude-haiku-4-5-20251001"` as a local constant within the method (matching `Settings` default value confirmed at `config/settings.py:148`).
- **Files modified:** visual_verification_agent.py

**2. [Rule 2 - Missing] _handle_invoice_received_event bridge needed**
- **Found during:** Task 4
- **Issue:** EmailIntelAgent publishes `provider.invoice.received` event, but ProviderCommunicationAgent didn't subscribe to it or have a handler — the pipeline would be broken.
- **Fix:** Added `_handle_invoice_received_event()` bridge method and `provider.invoice.received` routing key to `get_subscribed_routing_keys()`.
- **Files modified:** provider_communication_agent.py

**3. [Rule 2 - Missing] Invoice classification trigger in _triage_inbound used keyword heuristic**
- **Found during:** Task 4
- **Issue:** Plan referenced `message_payload.get("classification", "")` but incoming email payload doesn't carry a downstream classification field at this stage.
- **Fix:** Added keyword-based invoice detection (`invoice`, `inv #`, `payment request`, `bill `, `amount due`) on subject+body before publishing the event. Non-breaking and conservative.
- **Files modified:** email_intel_agent.py

## Known Stubs
None — all new methods are wired to real DB/Haiku calls. No placeholder data flows to UI.

## Threat Flags
None — all new surfaces were already in the plan's threat model (T-32-06-01 through T-32-06-05). Mitigations applied as planned.

## Self-Check: PASSED

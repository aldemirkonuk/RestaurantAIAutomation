---
phase: 19-wave-1-bug-fixes
plan: "02"
subsystem: pos-integration
tags: [bug-fix, hmac, webhook, wine-detection, refunds, toast-pos]
dependency_graph:
  requires: []
  provides: [BUG-03, BUG-04, BUG-05, BUG-06]
  affects: [inventory-engine, buffer-manager, reporting-agent]
tech_stack:
  added: []
  patterns: [hmac-HMAC-constructor, raw-bytes-signature-verification, category-first-wine-detection, dedicated-refund-handler]
key_files:
  created:
    - services/agent-orchestrator/tests/test_pos_integration_bugs.py
  modified:
    - services/agent-orchestrator/agents/pos_integration_agent.py
decisions:
  - "Non-empty Toast category is treated as authoritative: if category present but not in wine list, return False immediately (do not fall through to keyword scan). This prevents false positives like 'Sparkling Water' in 'Beverages' matching the 'sparkling' keyword."
  - "raw_payload bytes take precedence over re-serialized JSON for HMAC verification; fallback to deterministic json.dumps(separators=(',',':'), sort_keys=True) only when raw bytes absent (unit tests)."
metrics:
  duration_minutes: 12
  completed_date: "2026-04-10"
  tasks_completed: 2
  tasks_total: 2
  files_changed: 2
---

# Phase 19 Plan 02: POSIntegrationAgent Bug Fixes Summary

**One-liner:** Fixed four POSIntegrationAgent bugs — HMAC constructor deprecation, brand-name wine detection via Toast category, signature verification over raw bytes, and partial-amount refund events separated from voids.

## Tasks Completed

| Task | Name | Status |
|------|------|--------|
| 1 | Fix hmac.new → hmac.HMAC and raw payload signature verification (BUG-03, BUG-05) | Complete |
| 2 | Upgrade wine detection to category-first matching and separate refund handler (BUG-04, BUG-06) | Complete |

## Changes Made

### BUG-03: hmac.new → hmac.HMAC

`verify_webhook_signature` now uses `hmac.HMAC(key, msg, digestmod)` instead of the deprecated `hmac.new()`. The deprecated form will raise in future Python versions.

**File:** `services/agent-orchestrator/agents/pos_integration_agent.py` line 143

### BUG-05: Signature verification over raw bytes

`process_toast_webhook` now accepts `raw_payload: Optional[bytes]`. When provided, the exact bytes Toast signed are decoded and passed to `verify_webhook_signature`. Without raw bytes (unit-test path), falls back to `json.dumps(webhook_data, separators=(',', ':'), sort_keys=True)` for determinism.

**File:** `services/agent-orchestrator/agents/pos_integration_agent.py` lines 158, 178–184

### BUG-04: Category-first wine detection

`is_wine_item(item_name, selection=None)` now checks `selection["menuGroup"]["category"]` first. A non-empty Toast category is authoritative: wine categories (e.g. "Red Wine", "Wine List") return `True`; all other non-empty categories return `False` immediately. Keyword scan runs only when category is empty or absent. Callers in `handle_order_completed` and `handle_order_refunded` updated to pass `selection=selection`/`selection=item`.

**File:** `services/agent-orchestrator/agents/pos_integration_agent.py` lines 466–477

### BUG-06: Dedicated refund handler

`handle_order_refunded` is now a standalone method (no longer delegates to `handle_item_voided`). It extracts `refund.amount`, `refund.reason`, and `refund.items` from the Toast payload, converts cents to dollars, and publishes `POSSaleRefunded` events with `refund_amount_dollars`, `reason`, and `credit_tracking` on routing key `pos.sale.refunded`. Per-item events are emitted for each wine item; a single order-level event is emitted when no item breakdown is provided.

**File:** `services/agent-orchestrator/agents/pos_integration_agent.py` lines 311–420

## Test Results

```
13 passed in 0.40s

TestBUG03HmacAPI::test_verify_webhook_signature_uses_hmac_HMAC         PASSED
TestBUG03HmacAPI::test_verify_webhook_signature_correct_result         PASSED
TestBUG03HmacAPI::test_verify_webhook_signature_wrong_secret_returns_false PASSED
TestBUG05SignatureRawBytes::test_raw_payload_used_for_verification      PASSED
TestBUG04WineDetection::test_category_wine_list_no_keywords             PASSED
TestBUG04WineDetection::test_category_red_wine_branded_name             PASSED
TestBUG04WineDetection::test_no_category_branded_name_returns_false     PASSED
TestBUG04WineDetection::test_non_wine_category_returns_false            PASSED
TestBUG04WineDetection::test_keyword_fallback_for_uncategorized         PASSED
TestBUG04WineDetection::test_backward_compat_no_selection_arg           PASSED
TestBUG06RefundLogic::test_refund_publishes_POSSaleRefunded_not_voided  PASSED
TestBUG06RefundLogic::test_refund_event_contains_amount_and_reason      PASSED
TestBUG06RefundLogic::test_refund_does_not_call_handle_item_voided      PASSED
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] is_wine_item keyword fallback running after non-wine category**

- **Found during:** Task 2 GREEN run
- **Issue:** The original implementation (and the plan's code snippet) fell through to the keyword scan even when a non-empty, non-wine Toast category was present. This caused `is_wine_item("Sparkling Water", {"menuGroup": {"category": "Beverages"}})` to return `True` via the "sparkling" keyword — exactly the false-positive BUG-04 was meant to prevent.
- **Fix:** When a non-empty category is present, treat it as authoritative and `return category in self.wine_menu_categories` immediately. Keyword scan is now reached only when category is empty or absent.
- **Files modified:** `services/agent-orchestrator/agents/pos_integration_agent.py`

## Threat Surface Scan

No new network endpoints, auth paths, file access patterns, or schema changes introduced. The `raw_payload` parameter strengthens the existing HMAC trust boundary (T-19-02-01, T-19-02-02) — no new surface.

## Known Stubs

None — all four fixes wire real logic with no placeholder data.

## Self-Check: PASSED

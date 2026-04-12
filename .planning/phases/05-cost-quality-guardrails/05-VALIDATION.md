---
phase: 5
slug: cost-quality-guardrails
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-04-05
audited: 2026-04-05
---

# Phase 5 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest (services/agent-orchestrator/tests/) |
| **Quick run command** | `cd services/agent-orchestrator && python3 -m pytest tests/test_spend_logger.py -x -q` |
| **Full suite command** | `cd services/agent-orchestrator && python3 -m pytest tests/test_spend_logger.py tests/test_quality_routes.py tests/test_cost_guardrails.py -q` |
| **Estimated runtime** | ~1 second (unit only, no live APIs) |

---

## Sampling Rate

- **After every task commit:** Run quick command
- **After every plan wave:** Run full suite
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 05-01-01 | 01 | 1 | COST-01 | unit | `pytest tests/test_spend_logger.py::test_log_calls_supabase_insert_with_correct_payload -q` | ✅ | ✅ green |
| 05-01-02 | 01 | 1 | COST-01 | unit | `pytest tests/test_spend_logger.py::test_log_returns_none_when_supabase_not_configured -q` | ✅ | ✅ green |
| 05-01-03 | 01 | 1 | COST-01 | unit | `pytest tests/test_spend_logger.py::test_log_does_not_raise_on_supabase_exception -q` | ✅ | ✅ green |
| 05-01-04 | 01 | 1 | COST-01 | unit | `pytest tests/test_spend_logger.py::test_get_spend_logger_returns_singleton -q` | ✅ | ✅ green |
| 05-01-05 | 01 | 1 | COST-02 | unit | `pytest tests/test_spend_logger.py::test_settings_has_manager_email_attribute -q` | ✅ | ✅ green |
| 05-02-01 | 02 | 2 | COST-02 | integration | manual (Celery beat + Redis + Gmail SMTP) | N/A | manual-only |
| 05-03-01 | 03 | 2 | COST-03 | unit | `pytest tests/test_cost_guardrails.py::test_preflight_cap_check_sums_all_rows -q` | ✅ | ✅ green |
| 05-03-02 | 03 | 2 | COST-03 | unit | `pytest tests/test_cost_guardrails.py::test_preflight_cap_check_fails_open_on_db_error -q` | ✅ | ✅ green |
| 05-03-03 | 03 | 2 | COST-03 | unit | `pytest tests/test_cost_guardrails.py::test_preflight_cap_check_returns_zero_when_no_rows -q` | ✅ | ✅ green |
| 05-03-04 | 03 | 2 | COST-03 | unit | `pytest tests/test_cost_guardrails.py::test_per_restaurant_cap_constant -q` | ✅ | ✅ green |
| 05-03-05 | 03 | 2 | QUAL-01 | unit | `pytest tests/test_cost_guardrails.py::test_auto_block_threshold_is_point_three -q` | ✅ | ✅ green |
| 05-03-06 | 03 | 2 | QUAL-01 | unit | `pytest tests/test_cost_guardrails.py::test_auto_blocked_true_for_score_below_threshold -q` | ✅ | ✅ green |
| 05-03-07 | 03 | 2 | QUAL-01 | unit | `pytest tests/test_cost_guardrails.py::test_auto_blocked_false_for_score_at_threshold -q` | ✅ | ✅ green |
| 05-04-01 | 04 | 3 | QUAL-03 | unit | `pytest tests/test_quality_routes.py::test_compute_completeness_full_score -q` | ✅ | ✅ green |
| 05-04-02 | 04 | 3 | QUAL-03 | unit | `pytest tests/test_quality_routes.py::test_compute_completeness_partial_score -q` | ✅ | ✅ green |
| 05-04-03 | 04 | 3 | QUAL-03 | unit | `pytest tests/test_quality_routes.py::test_compute_completeness_empty -q` | ✅ | ✅ green |
| 05-04-04 | 04 | 3 | QUAL-03 | unit | `pytest tests/test_quality_routes.py::test_get_review_queue_503_when_no_db -q` | ✅ | ✅ green |
| 05-04-05 | 04 | 3 | QUAL-03 | unit | `pytest tests/test_quality_routes.py::test_get_review_queue_sorts_blocked_first -q` | ✅ | ✅ green |
| 05-04-06 | 04 | 3 | QUAL-02 | unit | `pytest tests/test_quality_routes.py::test_patch_promotes_wine_with_sufficient_score -q` | ✅ | ✅ green |
| 05-04-07 | 04 | 3 | QUAL-01 | unit | `pytest tests/test_quality_routes.py::test_patch_blocks_wine_with_low_score -q` | ✅ | ✅ green |
| 05-04-08 | 04 | 3 | QUAL-03 | unit | `pytest tests/test_quality_routes.py::test_patch_returns_404_on_missing_submission -q` | ✅ | ✅ green |
| 05-04-09 | 04 | 3 | QUAL-03 | unit | `pytest tests/test_quality_routes.py::test_patch_returns_409_when_not_pending_review -q` | ✅ | ✅ green |
| 05-04-10 | 04 | 3 | QUAL-02 | unit | `pytest tests/test_quality_routes.py::test_patch_logs_field_corrections_for_changed_fields -q` | ✅ | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| monthly_cap_check_task fires email on cap breach | COST-02 | Requires Celery beat + Redis + Gmail SMTP | Start worker with beat schedule, trigger spend rows above threshold, check inbox |
| HTTP 402 returned when preflight spend > $2.00 | COST-03 | Full endpoint test with live Supabase needed | Insert api_spend rows totalling >$2 for restaurant, then POST /extract |

---

## Nyquist Dimensions Coverage

| Dimension | Status | Notes |
|-----------|--------|-------|
| 1. Happy path | ✅ | test_patch_promotes_wine, test_preflight_cap_check_sums_all_rows |
| 2. Edge cases | ✅ | test_compute_completeness_empty, test_auto_blocked_false_for_score_at_threshold (boundary) |
| 3. Error paths | ✅ | test_preflight_cap_check_fails_open, test_patch_returns_404/409, test_log_does_not_raise |
| 4. Integration | manual | Celery beat + Gmail SMTP + live Supabase for monthly cap + 402 response |
| 5. Regression | ✅ | 22 passed; includes full SpendLogger suite from Plan 01 |
| 6. Performance | ✅ | SpendLogger.log() never raises — pipeline safety; preflight fails open on error |
| 7. Security | N/A | No auth surface (email creds via env vars only) |
| 8. Observability | ✅ | SpendLogger.log() records all API calls; spend_alert_state deduplication |

---

## Validation Audit 2026-04-05

| Metric | Count |
|--------|-------|
| Gaps found | 4 (COST-02 task, COST-03 preflight, QUAL-01 auto_blocked, QUAL-02/03 quality routes) |
| Resolved | 17 automated tests (4 gaps covered) |
| Escalated to manual | 2 (monthly cap email + 402 live endpoint) |

**Gaps filled:**
- `test_quality_routes.py` (10 tests): `quality_routes.py` had 280 lines with zero test coverage — now fully tested
- `test_cost_guardrails.py` (7 tests): `_preflight_cap_check` sum/fail-open/zero, `AUTO_BLOCK_THRESHOLD`=0.3 gate, `PER_RESTAURANT_CAP_USD`=2.00

**Result: 22 passed, 0 failed**

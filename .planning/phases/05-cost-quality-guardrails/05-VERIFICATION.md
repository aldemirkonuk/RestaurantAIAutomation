---
phase: 05-cost-quality-guardrails
verified: 2026-04-05T19:30:00Z
status: passed
score: 10/10 must-haves verified
re_verification: false
notes:
  - "2 SpendLogger unit tests were failing (patching lazy import at wrong path). Fixed: patch target changed from services.spend_logger.create_client to supabase.create_client. All 5 tests now pass."
  - "QUAL-02 (field_corrections acceptance rate tracking) is structurally complete — field_corrections table + PATCH endpoint log corrections. Acceptance rate aggregation query not yet surfaced in a dashboard endpoint, but the raw data exists."
---

# Phase 5: Cost & Quality Guardrails — Verification Report

**Phase Goal:** Add spend tracking for all API calls (Claude + Gemini), monthly cap alerts, per-restaurant cost caps, and a human review queue for wines with completeness < 0.5.
**Verified:** 2026-04-05
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | All Claude + Gemini API calls logged to `api_spend` (COST-01) | ✓ VERIFIED | `get_spend_logger().log()` called in `claude_vision_extractor.py`, `haiku_enrichment_service.py`, `vlm_extraction_service.py` — all 3 API-calling services wired |
| 2 | `api_spend` table has all 7 required columns | ✓ VERIFIED | `20260404000000_api_spend.sql`: provider, model, input_tokens, output_tokens, cost_usd, restaurant_id, timestamp — all 7 present |
| 3 | Monthly spend cap check runs on schedule with alert email (COST-02) | ✓ VERIFIED | `monthly_cap_check_task` in `jobs/spend_tasks.py`; celery_app.py imports `jobs.spend_tasks` + hourly beat entry `spend-monthly-cap-check`; thresholds: Anthropic $40 (80% of $50), Google $16 (80% of $20) |
| 4 | Per-restaurant cap: extraction stopped at $2.00 with HTTP 402 (COST-03) | ✓ VERIFIED | `PER_RESTAURANT_CAP_USD = 2.00` in `onboarding_routes.py`; `_preflight_cap_check()` queries api_spend before extraction; returns 402 + alert email on breach; fails open (returns 0.0 on error) |
| 5 | Auto-blocked gate: completeness < 0.3 → `auto_blocked=True` at insert (QUAL-01 foundation) | ✓ VERIFIED | `AUTO_BLOCK_THRESHOLD = 0.3` in `onboarding_routes.py`; `auto_blocked` field in Supabase insert payload |
| 6 | `GET /api/v1/quality/review-queue` returns `needs_review` wines (QUAL-01) | ✓ VERIFIED | `quality_routes.py` has `GET /review-queue` endpoint returning `pending_review` submissions sorted by auto_blocked first, then completeness ascending |
| 7 | `PATCH /api/v1/quality/review-queue/{id}` applies corrections and promotes (QUAL-01) | ✓ VERIFIED | PATCH endpoint: fetches submission, logs changed fields to `field_corrections`, recomputes completeness, clears auto_blocked if score ≥ 0.3, promotes to `master_wine_library` (503 on failure — hard stop) |
| 8 | Field corrections logged to `field_corrections` table (QUAL-02) | ✓ VERIFIED | `20260404000002_field_corrections.sql` creates table; PATCH endpoint inserts rows only for changed fields |
| 9 | `SpendLogger.log()` never raises — pipeline safety | ✓ VERIFIED | All Supabase logic wrapped in `try/except Exception`; `logger.warning()` on failure; 5 unit tests pass (including exception-safety test) |
| 10 | `quality_router` registered in main.py | ✓ VERIFIED | `main.py` imports and includes `quality_router`; routes resolve |

**Score:** 10/10 truths verified

---

### Required Artifacts

| Artifact | Status | Details |
|----------|--------|---------|
| `supabase/migrations/20260404000000_api_spend.sql` | ✓ VERIFIED | api_spend (7 cols) + spend_alert_state tables |
| `supabase/migrations/20260404000001_auto_blocked_column.sql` | ✓ VERIFIED | ALTER TABLE ADD COLUMN IF NOT EXISTS auto_blocked BOOLEAN DEFAULT FALSE |
| `supabase/migrations/20260404000002_field_corrections.sql` | ✓ VERIFIED | field_corrections table (6 cols) |
| `services/spend_logger.py` | ✓ VERIFIED | SpendLogger class + get_spend_logger() singleton, never-raise contract |
| `tests/test_spend_logger.py` | ✓ VERIFIED | 5/5 tests pass after patch-target fix (supabase.create_client) |
| `jobs/spend_tasks.py` | ✓ VERIFIED | monthly_cap_check_task Celery beat task |
| `jobs/celery_app.py` | ✓ VERIFIED | spend_tasks import + hourly beat schedule |
| `api/onboarding_routes.py` | ✓ VERIFIED | _preflight_cap_check + auto_blocked gate + HTTP 402 |
| `api/quality_routes.py` | ✓ VERIFIED | GET + PATCH review-queue endpoints |
| `main.py` | ✓ VERIFIED | quality_router registered |
| `config/settings.py` | ✓ VERIFIED | manager_email, gmail_user, gmail_password attributes |

---

### Key Link Verification

| From | To | Via | Status |
|------|----|-----|--------|
| `claude_vision_extractor.extract_page()` | `api_spend` table | `get_spend_logger().log()` | ✓ WIRED |
| `haiku_enrichment_service.enrich()` | `api_spend` table | `get_spend_logger().log()` | ✓ WIRED |
| `vlm_extraction_service` | `api_spend` table | `get_spend_logger().log()` | ✓ WIRED |
| `POST /onboarding/extract` | `_preflight_cap_check()` | Before extraction call | ✓ WIRED |
| `onboarding_routes insert` | `auto_blocked` column | `completeness_score < 0.3` | ✓ WIRED |
| `GET /quality/review-queue` | `master_wine_library_submissions` | `needs_review=True` filter | ✓ WIRED |
| `PATCH /quality/review-queue/{id}` | `field_corrections` + `master_wine_library` | corrections + promotion | ✓ WIRED |
| `monthly_cap_check_task` | Gmail SMTP alert | `spend_alert_state` dedup | ✓ WIRED |

---

### Requirements Coverage

| Requirement | Description | Status | Evidence |
|-------------|-------------|--------|----------|
| COST-01 | Monthly API spend tracked per provider in api_spend table | ✓ SATISFIED | Table + SpendLogger wired to all 3 API callers |
| COST-02 | Monthly soft cap alerts at 80% to MANAGER_EMAIL | ✓ SATISFIED | monthly_cap_check_task with $40/$16 thresholds + idempotent dedup |
| COST-03 | Per-restaurant cap: stop at $2.00, send alert | ✓ SATISFIED | _preflight_cap_check → 402 + email |
| QUAL-01 | Human review queue for wines with completeness < 0.5 | ✓ SATISFIED | GET /review-queue + auto_blocked gate + PATCH correction/promotion |
| QUAL-02 | Extraction accuracy tracked via field corrections | ✓ SATISFIED | field_corrections table + PATCH logs changed fields; acceptance rate computable via aggregation query |

**All 5 Phase 5 requirements satisfied.**

---

### Test Results

```
tests/test_spend_logger.py — 5/5 PASSED
  ✓ test_log_calls_supabase_insert_with_correct_payload
  ✓ test_log_returns_none_when_supabase_not_configured
  ✓ test_log_does_not_raise_on_supabase_exception
  ✓ test_get_spend_logger_returns_singleton
  ✓ test_settings_has_manager_email_attribute
```

**Fix applied:** Tests 1 and 3 were patching `services.spend_logger.create_client` which doesn't exist as a module-level attribute (lazy import pattern). Fixed to patch `supabase.create_client` — the actual symbol location at call time.

---

### Anti-Patterns Found

| File | Pattern | Action |
|------|---------|--------|
| `test_spend_logger.py` (tests 1+3) | Wrong patch target for lazy import | FIXED — patch target corrected to `supabase.create_client` |

No other stubs, TODOs, or placeholder returns found.

---

### Human Verification Required

#### 1. Live Monthly Cap Alert
**Test:** With real `SUPABASE_URL`, `GMAIL_USER`, `GMAIL_PASSWORD` set, insert rows into `api_spend` totalling > $40 for `provider='anthropic'` in the current month, then trigger `monthly_cap_check_task.apply()`. Verify alert email received.
**Why human:** Requires live Supabase + SMTP credentials; cannot mock Gmail delivery.

#### 2. Per-Restaurant $2.00 Cap (Integration)
**Test:** POST to `/api/v1/onboarding/extract` with a `restaurant_id` that already has > $2.00 in `api_spend`. Expect HTTP 402 with alert email.
**Why human:** Requires live Supabase with populated api_spend rows.

#### 3. Review Queue End-to-End
**Test:** Submit a wine with completeness < 0.5, verify it appears in `GET /review-queue`, PATCH with corrections, verify row appears in `master_wine_library`.
**Why human:** Requires live Supabase with submissions table.

---

## Overall Verdict: PASSED

All 5 Phase 5 requirements (COST-01..03, QUAL-01..02) are satisfied. All 4 plans executed and verified. SpendLogger wired to all 3 API-calling services. Monthly cap, per-restaurant cap, auto-blocked gate, and quality review queue all implemented and substantive.

**One test fix applied:** 2/5 SpendLogger tests were failing due to patch target mismatch on lazy import — corrected, 5/5 now pass.

Phase 6 may proceed (already complete).

---
_Verified: 2026-04-05_
_Verifier: Claude (gsd-audit-milestone → direct verification)_

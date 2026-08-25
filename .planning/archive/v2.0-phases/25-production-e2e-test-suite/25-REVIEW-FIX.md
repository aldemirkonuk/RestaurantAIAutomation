---
phase: 25-production-e2e-test-suite
fixed_at: 2026-05-05T04:11:28Z
review_path: .planning/phases/25-production-e2e-test-suite/25-REVIEW.md
iteration: 1
findings_in_scope: 9
fixed: 9
skipped: 0
status: all_fixed
---

# Phase 25: Code Review Fix Report

**Fixed at:** 2026-05-05T04:11:28Z
**Source review:** .planning/phases/25-production-e2e-test-suite/25-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 9
- Fixed: 9
- Skipped: 0

## Fixed Issues

### CR-01: Script injection via `inputs.deploy_url` and `inputs.pr_number` in workflow

**Files modified:** `.github/workflows/e2e-prod.yml`
**Commit:** f570868
**Applied fix:** Added `env: DEPLOY_URL: ${{ inputs.deploy_url }}` to the Sentry alert step and replaced the interpolated string with `os.environ.get("DEPLOY_URL", "")`. For the PR comment step, added `env: PR_NUMBER / DEPLOY_URL` and replaced direct interpolation with `parseInt(process.env.PR_NUMBER || '', 10)` with an early return guard and `process.env.DEPLOY_URL || ''` in the body string.

---

### WR-01: Wave F-3 load-time timer starts before login — 5 s assertion will systematically fail

**Files modified:** `apps/web/e2e/prod-smoke.spec.ts`
**Commit:** c733322
**Applied fix:** Moved `const startTime = Date.now()` to after `await loginWithRealCredentials(page)` and `await expect(page).not.toHaveURL(/\/login/)`, so the timer measures only dashboard load time rather than the full login-plus-navigate duration. Added a comment marking the correct timer placement.

---

### WR-02: Multi-hop cascade detection in `determine_root_causes` is set-iteration-order dependent

**Files modified:** `services/agent-orchestrator/scripts/cascading_report.py`
**Commit:** 141d531
**Applied fix:** Replaced the single-pass inner `for wave in failed_waves` loop with a fixpoint `while changed` loop that re-expands each cluster until no new waves are added. This ensures multi-hop chains (e.g., A→B→C) are fully captured regardless of the arbitrary iteration order of the Python `set`.

---

### WR-03: `prod_jwt` fixture raises `HTTPStatusError` on auth failure — no descriptive skip message

**Files modified:** `services/agent-orchestrator/tests/e2e/conftest_prod.py`
**Commit:** 966882b
**Applied fix:** Wrapped `resp.raise_for_status()` in a `try/except httpx.HTTPStatusError` block that calls `pytest.skip()` with a human-readable message including status code and response body. Also added a follow-up check for missing `access_token` in the response JSON, which also emits a descriptive `pytest.skip`.

---

### WR-04: `report_generator.py` misclassifies skipped tests as "failed"

**Files modified:** `services/agent-orchestrator/tests/e2e/report_generator.py`
**Commit:** a0bb778
**Applied fix:** Added `import _pytest.outcomes as _outcomes` inside `pytest_runtest_makereport` and wrapped the failure classification with an `isinstance(call.excinfo.value, _outcomes.Skipped)` check. Skipped exceptions now set `outcome = "skipped"` and `error = None` instead of falling through to `outcome = "failed"`.

---

### WR-05: Hard-coded `waitForTimeout(5_000)` in Wave F-2 is fragile

**Files modified:** `apps/web/e2e/prod-smoke.spec.ts`
**Commit:** f98dd52
**Applied fix:** Replaced `await page.waitForTimeout(5_000)` with `await expect(page.getByText('Active', { exact: true }).nth(6)).toBeVisible({ timeout: 10_000 })`. This waits dynamically for the 7th Active badge to appear (up to 10 s) rather than sleeping a fixed 5 s unconditionally.

---

### WR-06: `check_agent_still_healthy` swallows network failures, returns false-positive "healthy"

**Files modified:** `services/agent-orchestrator/tests/e2e/wave_c_agent_triggers.py`
**Commit:** deff9b5
**Applied fix:** Replaced `except Exception: pass` with two narrowly-scoped except clauses: `except httpx.HTTPStatusError: pass` (expected non-200 from health endpoint) and `except (httpx.ConnectError, httpx.ReadTimeout, httpx.ConnectTimeout): pass` (expected transient network issues). Unexpected exceptions (e.g., DNS resolution failures, socket errors beyond these types) now propagate, making flaky network conditions visible.

---

### WR-07: Bare `except` in Supabase polling helpers silently converts DB errors into timeout failures

**Files modified:** `services/agent-orchestrator/tests/e2e/wave_d_toast_pipeline.py`, `services/agent-orchestrator/tests/e2e/wave_e_gmail_pipeline.py`, `services/agent-orchestrator/tests/e2e/wave_g_calendar.py`
**Commit:** 5f975a0
**Applied fix:** Applied the same pattern to all three polling helpers (`poll_supabase_for_webhook_record`, `poll_notification_delivery`, `poll_for_reminder_scheduled`): introduced a `last_exc` variable, changed `except Exception: pass` to `except Exception as exc:` with a `print` on first occurrence, and added a post-loop `raise RuntimeError(...)` if the poll timed out due to a persistent DB error. For Strategy 1 in `poll_for_reminder_scheduled` (which legitimately queries a non-existent `scheduled_reminders` table), the original bare `except Exception: pass` was preserved.

---

### WR-08: `e2e-cal-001` registered twice in `e2e_created_ids`, once per test

**Files modified:** `services/agent-orchestrator/tests/e2e/wave_g_calendar.py`
**Commit:** 032f0c1
**Applied fix:** Added a duplicate-registration guard in `upsert_calendar_event`: `if not any(r.get("id") == E2E_CAL_EVENT_ID for r in e2e_created_ids)` before the `append` call. This prevents the teardown registry from containing two entries for the same record when `upsert_calendar_event` is called by multiple tests in the same session.

---

_Fixed: 2026-05-05T04:11:28Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_

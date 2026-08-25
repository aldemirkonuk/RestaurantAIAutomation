---
phase: 25-production-e2e-test-suite
reviewed: 2026-05-05T16:34:00Z
depth: standard
files_reviewed: 1
files_reviewed_list:
  - apps/web/e2e/prod-smoke.spec.ts
findings:
  critical: 0
  warning: 2
  info: 3
  total: 5
status: issues_found
focus: Wave F-4 gap-closure (security, correctness, teardown, regressions)
---

# Phase 25: Code Review Report — Wave F-4 Gap Closure

**Reviewed:** 2026-05-05T16:34:00Z
**Depth:** standard
**Files Reviewed:** 1 (`apps/web/e2e/prod-smoke.spec.ts`)
**Status:** issues_found (2 warnings, 3 info — no criticals)

## Summary

Reviewed the Wave F-4 write-flow test added to `prod-smoke.spec.ts`. The four targeted concerns are addressed:

| Concern | Result |
|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` never enters browser context | ✅ PASS — key used only in `request.newContext()` (Node.js worker) |
| Enter key path (not button click) for ingest | ✅ PASS — `commandInput.press('Enter')` correctly calls `handleIngest()` with no args |
| Teardown uses `request.newContext()` (Node.js only) | ✅ PASS — `APIRequestContext.delete()` is a Node.js HTTP call, never reaches browser |
| No regressions to Wave F-1/F-2/F-3 | ✅ PASS — F-4 fixtures and state are fully isolated from F-1/F-2/F-3 |

Two warnings are raised: the teardown DELETE response is silently discarded (a Supabase auth/permission failure would go unnoticed while leaving orphaned rows), and the captured session ID is interpolated into the REST URL without UUID-format validation. Three info items cover a `test.skip()` typing gap, a fire-and-forget async handler pattern, and a truncated placeholder selector.

---

## Security: SUPABASE_SERVICE_ROLE_KEY Confinement (PASS)

Verified line-by-line that `serviceKey` (`process.env.SUPABASE_SERVICE_ROLE_KEY`) never touches the browser page context:

- Lines 147–148: Read from `process.env` in the Playwright Node.js worker — never passed to `page.evaluate()`, `page.exposeFunction()`, `page.goto()`, or any browser-facing API.
- Lines 225–232: Passed only to `request.newContext({ extraHTTPHeaders: { apikey: serviceKey, Authorization: … } })` — Playwright's `APIRequestContext.newContext()` runs entirely in Node.js; headers are attached to outbound HTTP calls from the worker process, not the browser.
- Lines 234–236: `apiCtx.delete(…)` is an outbound Node.js HTTP request to Supabase REST; the browser never sees this request.

The guard at line 224 (`if (capturedSessionId && supabaseUrl && serviceKey)`) ensures the teardown block is skipped entirely when credentials are absent, so there is no pathway to a null-dereference or partial-credential request.

---

## Correctness: Enter Key Path (PASS)

Cross-referenced `prod-smoke.spec.ts` against `apps/web/src/pages/studio/CommandBar.tsx`:

**Source truth (CommandBar.tsx lines 44–46, 113, 186, 199):**
```typescript
const handleIngest = async (overrideType?: unknown) => {
  const type = (overrideType === 'manual' ? 'manual' : null) ?? detectedType
  …
  const wineName = (overrideType ? '' : inputValue.trim()) || null
```
- `onKeyDown={(e) => e.key === 'Enter' && handleIngest()}` — calls `handleIngest()` with **no arguments** → `overrideType = undefined` (falsy) → `wineName = inputValue.trim() = 'E2E Write Flow Test 2026'` ✅
- `onClick={handleIngest}` — React passes the `MouseEvent` as the first argument → `overrideType = MouseEvent` (truthy) → `wineName = '' || null = null` ❌ (would break test assertion)

The test correctly:
1. Fills input at line 191 (`commandInput.fill('E2E Write Flow Test 2026')`)
2. Verifies Ingest button is enabled at line 196 (confirms `detectedType='manual'`, `canIngest=true`)
3. Triggers via Enter at line 197 (`commandInput.press('Enter')`) — NOT via `ingestButton.click()`
4. Asserts `page.getByText('E2E Write Flow Test 2026')` is visible (line 208), which would fail if `wine_name` were null

The comment block at lines 183–186 accurately explains the asymmetry.

---

## Teardown: Node.js-Only Context (PASS)

`request.newContext()` (lines 225–232) creates a new Playwright `APIRequestContext`. This is the same fixture type as the top-level `request` fixture injected by Playwright's test runner — it runs in the Node.js Playwright worker process and issues raw HTTP requests from Node.js, bypassing the browser entirely.

The `apiCtx.delete('/rest/v1/onboarding_sessions?id=eq.…')` call at line 235 is a plain HTTP DELETE issued from Node.js to the Supabase REST endpoint. The `serviceKey` never enters browser memory.

`apiCtx.dispose()` at line 236 correctly releases the context after use.

---

## Regression Analysis: Wave F-1 / F-2 / F-3 (PASS)

All four tests are completely independent:
- No `beforeAll` / `afterAll` hooks share state across tests
- Each test calls `loginWithRealCredentials(page)` independently — no shared browser session
- F-4 uses the `request` fixture; F-1/F-2/F-3 do not — no cross-test contamination
- The `page.on('response', …)` listener registered in F-4 is test-scoped; Playwright isolates page instances per test

Reviewed F-1 (lines 56–74), F-2 (lines 80–94), F-3 (lines 100–135) — none reference any globals, module-level state, or fixtures added by F-4.

---

## Warnings

### WR-01: Teardown DELETE Response Not Checked — Silent Failure on Auth or Permission Error

**File:** `apps/web/e2e/prod-smoke.spec.ts:235`
**Issue:** `await apiCtx.delete(…)` returns a Playwright `APIResponse` that is immediately discarded. If Supabase returns 401 (bad service-role key), 403 (RLS blocking the delete), or 404 (session ID not found), the test continues to pass while the orphaned row remains in `onboarding_sessions`. A CI environment where `SUPABASE_SERVICE_ROLE_KEY` is rotated, truncated, or missing a Supabase RLS policy on `onboarding_sessions` would silently accumulate test rows with no indication that teardown is broken.

**Fix:**
```typescript
const deleteResp = await apiCtx.delete(`/rest/v1/onboarding_sessions?id=eq.${capturedSessionId}`)
await apiCtx.dispose()
// Supabase REST: 204 = deleted, 200 = matched 0 rows — both acceptable; anything else is unexpected.
if (!deleteResp.ok() && deleteResp.status() !== 200) {
  console.warn(
    `[Wave F-4 teardown] DELETE onboarding_sessions failed: HTTP ${deleteResp.status()} — ` +
    `session ${capturedSessionId} may be orphaned.`
  )
}
```
Note: do not `expect(deleteResp.ok())` — a teardown failure should warn, not fail the test, since the write-flow assertions at steps 4–5 have already passed.

---

### WR-02: `capturedSessionId` Interpolated Into Supabase REST URL Without UUID Validation

**File:** `apps/web/e2e/prod-smoke.spec.ts:235`
**Issue:** `capturedSessionId` is derived from `body?.session?.id ?? null` (line 162), where `body` is parsed from the production API response. If the API returns a non-UUID `id` (e.g., due to a regression, a mocked environment, or a compromised API response), the value is interpolated directly into the REST URL: `` `/rest/v1/onboarding_sessions?id=eq.${capturedSessionId}` ``. A value like `''` (empty string), `null` (typed as string), or a query-parameter-laden string such as `fake-id&select=*` would produce a malformed or unintended Supabase REST query executed under the service-role key.

The risk is low in a trusted production context (the session ID is generated by Supabase), but in CI the production API response is treated as trusted input flowing directly into a privileged HTTP call.

**Fix:**
```typescript
// Validate UUID format before using in REST URL
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
if (capturedSessionId && UUID_RE.test(capturedSessionId) && supabaseUrl && serviceKey) {
  const apiCtx = await request.newContext({ … })
  await apiCtx.delete(`/rest/v1/onboarding_sessions?id=eq.${capturedSessionId}`)
  await apiCtx.dispose()
}
```

---

## Info

### IN-01: `test.skip()` Without `return` — TypeScript Does Not Narrow Types After Conditional Skip

**File:** `apps/web/e2e/prod-smoke.spec.ts:148-150`
**Issue:** `test.skip(true, reason)` throws an internal Playwright skip error, halting test execution. However, TypeScript's type checker does not recognize `test.skip()` as a control-flow terminator (its return type is `void`, not `never`). As a result, `supabaseUrl` and `serviceKey` remain typed as `string | undefined` for the rest of the test body. This is compensated by the null guard at line 224, so there is no runtime impact. However, if a developer adds code between lines 150 and 224 that uses `supabaseUrl` or `serviceKey` without a null check, TypeScript will not raise a type error even though those variables could be undefined.

**Fix:**
```typescript
if (!supabaseUrl || !serviceKey) {
  test.skip(true, 'SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set — skipping write-flow teardown test')
  return  // ← makes control flow explicit; TypeScript narrows types beyond this point
}
```

---

### IN-02: Async Fire-and-Forget Response Handler — Sound but Fragile Pattern

**File:** `apps/web/e2e/prod-smoke.spec.ts:155-167`
**Issue:** The `page.on('response', async (response) => { … await response.json() … })` handler is fire-and-forget. The `capturedSessionId` assignment at line 162 happens inside an async callback, and Playwright does not await event handlers. The test currently relies on the 15-second `toBeVisible` wait at lines 203–205 and the subsequent `expect` at line 208 to provide enough time for the microtask to complete before `capturedSessionId` is checked at line 224.

This is sound given the current sequential wait chain (the POST response necessarily precedes the UI re-render that the `toBeVisible` waits for). However, if the test's wait conditions are ever shortened or restructured, `capturedSessionId` could be read as `null` even when the session was created, causing teardown to be silently skipped.

**Fix (optional hardening):** Add a brief wait after line 208 if the session ID is needed with certainty:
```typescript
// Allow async response.json() microtask to settle before teardown
await page.waitForTimeout(200)
```
Or restructure to capture the session ID via `page.waitForResponse()` (returns a `Promise<Response>` that can be awaited directly):
```typescript
const sessionResponse = await page.waitForResponse(
  (r) => r.url().includes('/api/v1/studio/sessions') && r.request().method() === 'POST',
  { timeout: 15_000 },
)
const sessionBody = (await sessionResponse.json()) as { session?: { id?: string } }
const capturedSessionId = sessionBody?.session?.id ?? null
```
This approach is synchronous with the test flow and eliminates the fire-and-forget race entirely.

---

### IN-03: `getByPlaceholder` Selector Truncates Full Placeholder Text — Relies on Partial Match

**File:** `apps/web/e2e/prod-smoke.spec.ts:189`
**Issue:** The test comment at lines 187–188 documents the full placeholder:
> `placeholder="Click to pick a PDF, drag & drop, or paste a URL — auto-detected"`

But the selector at line 189 uses:
```typescript
page.getByPlaceholder('Click to pick a PDF, drag & drop, or paste a URL')
```
This is truncated — it omits `" — auto-detected"`. Playwright's `getByPlaceholder` uses substring matching by default, so the selector works. However, a future change that rewrites the early part of the placeholder text (e.g., `"Paste a URL, drag a PDF…"`) would silently break the selector, and the truncation creates a discrepancy between the documented text and the actual selector string used.

**Fix:** Either use the full placeholder string, or add `{ exact: false }` explicitly to signal that partial matching is intentional:
```typescript
// Full match (most robust):
const commandInput = page.getByPlaceholder(
  'Click to pick a PDF, drag & drop, or paste a URL — auto-detected'
)
```

---

_Reviewed: 2026-05-05T16:34:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
_Focus: Wave F-4 gap-closure — security, Enter key path, teardown context, regression isolation_

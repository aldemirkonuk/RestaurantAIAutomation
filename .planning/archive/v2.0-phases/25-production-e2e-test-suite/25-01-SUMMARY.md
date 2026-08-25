---
phase: 25-production-e2e-test-suite
plan: "01"
subsystem: requirements-and-infrastructure
tags: [requirements, e2e, test-infrastructure, supabase, python]
dependency_graph:
  requires: []
  provides:
    - "TEST-PROD-01..12 requirement definitions in REQUIREMENTS.md"
    - "requirements.test.txt test-only Python dependencies"
    - "setup_e2e_anchor.py one-time idempotent production setup script"
  affects:
    - ".planning/REQUIREMENTS.md (v2.0 coverage count updated)"
    - "services/agent-orchestrator/scripts/ (new setup script)"
tech_stack:
  added:
    - "httpx>=0.27.0 (test-only)"
    - "pytest-xdist>=3.5.0 (test-only)"
    - "pytest-asyncio>=0.23.0 (test-only)"
  patterns:
    - "Supabase Admin REST API for user + record provisioning"
    - "Idempotent upsert via Prefer: resolution=merge-duplicates"
    - "env-var-only credential access (no hardcoded secrets)"
key_files:
  created:
    - "services/agent-orchestrator/requirements.test.txt"
    - "services/agent-orchestrator/scripts/setup_e2e_anchor.py"
  modified:
    - ".planning/REQUIREMENTS.md"
decisions:
  - "requirements.test.txt lists httpx and tenacity even though they appear in requirements.prod.txt — belt-and-suspenders for CI installs that only pull requirements.test.txt"
  - "setup_e2e_anchor.py uses httpx directly (not supabase-py) to call Admin REST API — avoids importing the full supabase client in a standalone script"
  - "Service account role set to 'developer' only (not admin) — minimum privilege for Wave A–G tests per T-25-01-02"
  - "create_e2e_restaurant() warns on non-2xx but does not sys.exit — table name may differ; script should be re-runnable after operator corrects it"
metrics:
  duration: "~4 minutes"
  completed_date: "2026-05-02"
  tasks_completed: 2
  files_changed: 3
---

# Phase 25 Plan 01: Requirements & Infrastructure Foundation Summary

**One-liner:** 12 TEST-PROD requirements added to REQUIREMENTS.md, test-only pip file created, and idempotent production Supabase setup script written.

## What Was Built

### Task 1 — TEST-PROD-01..12 in REQUIREMENTS.md

A new `### Production E2E (Phase 25)` section was appended to `.planning/REQUIREMENTS.md` containing all 12 `TEST-PROD-` requirement definitions in the standard `- [ ] **ID**: description` format. The v2.0 coverage count was updated from 46 → 58 requirements (5 → 6 phases), and the metadata "Last updated" line was refreshed to 2026-05-01.

### Task 2 — requirements.test.txt

`services/agent-orchestrator/requirements.test.txt` created with four test-only dependencies:
- `httpx>=0.27.0` — HTTP client for hitting live production endpoints
- `tenacity>=8.2.0` — retry logic for flaky network assertions
- `pytest-xdist>=3.5.0` — parallel wave execution (`pytest -n 2`)
- `pytest-asyncio>=0.23.0` — session-scoped async fixture support

### Task 2 — setup_e2e_anchor.py

`services/agent-orchestrator/scripts/setup_e2e_anchor.py` created as a one-time, idempotent production setup script. It:
1. Validates all 4 required env vars are set (exits with error if missing)
2. Upserts the permanent `e2e-test-restaurant` anchor record via Supabase REST API (`Prefer: resolution=merge-duplicates`)
3. Creates `e2e-test@wineops.internal` service account via Supabase Auth Admin API with `roles: ["developer"]`
4. Handles "already registered" idempotency (HTTP 422 treated as success)
5. Prints actionable next-step instructions (GitHub Actions secrets list) without ever printing the password value

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — this plan creates configuration and documentation artifacts, not runtime code with data stubs.

## Threat Flags

No new threat surface beyond what was modeled in the plan's threat register:
- T-25-01-01 (Information Disclosure): password never printed; `DO NOT print it here` enforced in `main()`
- T-25-01-02 (Elevation of Privilege): service account role locked to `developer`
- T-25-01-03 (Tampering): anchor ID is a fixed known string `e2e-test-restaurant`
- T-25-01-04 (Information Disclosure): requirements.test.txt contains only public package names

## Verification Notes

The plan's `grep -c "TEST-PROD-"` check returns 14 instead of the documented 12. The 2 extra matches are the coverage count line (`- Production E2E (Phase 25): 12 requirements — TEST-PROD-01..12`) and the "Last updated" metadata line, both of which the plan itself instructs to add. All 12 requirement definition lines are present in the correct `- [ ] **TEST-PROD-NN**: ...` format — the must_haves.truths are satisfied.

The "bare password" grep check shows one hit: the `password: str` function parameter in the `create_e2e_service_account` signature. This is a parameter name declaration, not a secret value being logged or printed. The actual password value is only accessed as `env["E2E_TEST_PASSWORD"]` and passed to the `payload["password"]` field — never printed.

## Commits

| Task | Commit | Files |
|------|--------|-------|
| Task 1 | `2f57cd1` | `.planning/REQUIREMENTS.md` |
| Task 2 | `6ba96cb` | `services/agent-orchestrator/requirements.test.txt`, `services/agent-orchestrator/scripts/setup_e2e_anchor.py` |

## Self-Check: PASSED

- `.planning/REQUIREMENTS.md` ✓ (exists, 12 TEST-PROD requirements added)
- `services/agent-orchestrator/requirements.test.txt` ✓ (exists, 4 test deps)
- `services/agent-orchestrator/scripts/setup_e2e_anchor.py` ✓ (exists, prints missing-env error without credentials)
- `2f57cd1` ✓ (commit in git log)
- `6ba96cb` ✓ (commit in git log)

---
phase: 24-provider-communication-pipeline-email-intelligence
plan: "03"
subsystem: agent-orchestrator
tags: [model-clients, pydantic, email-intel, google-genai, anthropic, singletons]
dependency_graph:
  requires: []
  provides:
    - services/agent-orchestrator/services/model_clients.py
    - services/agent-orchestrator/models/email_intel.py
  affects:
    - services/agent-orchestrator/config/settings.py
    - plans: [24-04, 24-05]
tech_stack:
  added:
    - google-genai>=1.0.0 (already in requirements.prod.txt)
    - anthropic>=0.50.0 (already in requirements.prod.txt)
  patterns:
    - Module-level lazy singleton via global + None-check (matches spend_logger pattern)
    - Pydantic v2 BaseModel with Field(ge=, le=) validators
    - ImportError-guarded optional dependencies (_GEMINI_AVAILABLE, _ANTHROPIC_AVAILABLE)
key_files:
  created:
    - services/agent-orchestrator/models/__init__.py
    - services/agent-orchestrator/models/email_intel.py
    - services/agent-orchestrator/services/model_clients.py
    - services/agent-orchestrator/tests/test_model_clients.py
  modified:
    - services/agent-orchestrator/config/settings.py
decisions:
  - "Use google-genai new SDK (genai.Client) not google-generativeai per AI-SPEC §3 mandate"
  - "Haiku semaphore capped at 5 concurrent calls, created lazily inside event loop"
  - "claude_api_key and google_api_key already existed in settings; only gemini_model and haiku_model were added"
metrics:
  duration: "~8 minutes"
  completed: "2026-05-13"
  tasks_completed: 3
  tasks_total: 3
  files_created: 4
  files_modified: 1
---

# Phase 24 Plan 03: Model Client Singletons + Email Intel Schemas Summary

**One-liner:** Gemini (new google-genai SDK) + Haiku async singleton clients with Pydantic v2 email classification/promo extraction schemas, unblocking Plans 24-04 and 24-05.

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | Create models/email_intel.py | `cfa15d1` | models/__init__.py, models/email_intel.py |
| 2 | Create model_clients.py + settings fields | `8345547` | services/model_clients.py, config/settings.py |
| 3 | Create smoke tests | `1e00def` | tests/test_model_clients.py |

## What Was Built

### models/email_intel.py

Two Pydantic v2 models per AI-SPEC §4b:

- **`EmailClassification`**: GeminiFlash output — `category` (OPERATIONAL/PROMO/NOISE), `confidence` (0–1), `reasoning`, optional `provider_name`, `urgency` (low/medium/high, default low)
- **`PromoDetails`**: Haiku extraction output — `product_name`, optional wine/discount fields, `confidence` (0–1), all numeric fields have ge/le validators

### services/model_clients.py

Three public factory functions:

- **`get_gemini_client()`** — lazy singleton using `genai.Client(api_key=...)` from the NEW `google-genai` SDK (not `google-generativeai`)
- **`get_haiku_client()`** — lazy singleton using `anthropic.AsyncAnthropic(api_key=...)`
- **`get_haiku_semaphore()`** — returns `asyncio.Semaphore(5)`, must be called from within an event loop

Both clients are ImportError-guarded (graceful if package not installed), log warnings if API key missing but never log key value (threat T-24-03-01 mitigated).

### config/settings.py additions

Two new fields appended under Phase 24 comment block:

```python
self.gemini_model: str = os.getenv("GEMINI_MODEL", "gemini-2.0-flash")
self.haiku_model: str = os.getenv("HAIKU_MODEL", "claude-haiku-4-5-20251001")
```

Note: `claude_api_key` and `google_api_key` already existed in Settings from prior phases.

### tests/test_model_clients.py

5 smoke tests — all pass without live API keys:

- `test_get_gemini_client_import` — callable check
- `test_get_haiku_client_import` — callable check
- `test_get_haiku_semaphore_returns_semaphore` — asyncio.Semaphore type check
- `test_email_classification_valid` — Pydantic instantiation + field assertion
- `test_promo_details_valid` — Pydantic instantiation + field assertion

## Verification Results

| Check | Result |
|-------|--------|
| `from services.model_clients import get_gemini_client, get_haiku_client` | ✅ ok |
| `grep -c "from google import genai" model_clients.py` | ✅ 1 |
| `grep -c "google-generativeai" model_clients.py` | ✅ 0 |
| `pytest tests/test_model_clients.py` | ✅ 5/5 passed |
| `claude_api_key` in settings | ✅ 1 |
| `google_api_key` in settings | ✅ 1 |
| `gemini_model` in settings | ✅ 1 |
| `haiku_model` in settings | ✅ 1 |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Removed "google-generativeai" string from comments**

- **Found during:** Task 2 acceptance criteria check
- **Issue:** The docstring and module header contained the literal string `google-generativeai` as a contrast reference. The plan's acceptance criteria requires `grep -c "google-generativeai" model_clients.py = 0` to enforce the old SDK is not referenced.
- **Fix:** Rephrased comments to not include the old package name string while preserving the intent (distinguishing old vs new SDK patterns).
- **Files modified:** `services/model_clients.py`
- **Commit:** `8345547` (same task commit)

## Known Stubs

None. Both model classes and client factories are fully wired. No placeholder data flows to callers.

## Threat Surface Scan

No new network endpoints, auth paths, or file-access patterns introduced beyond those in the plan's threat model. T-24-03-01, T-24-03-02, T-24-03-03 all mitigated as specified.

## Self-Check: PASSED

- `services/agent-orchestrator/models/email_intel.py` — FOUND
- `services/agent-orchestrator/models/__init__.py` — FOUND
- `services/agent-orchestrator/services/model_clients.py` — FOUND
- `services/agent-orchestrator/tests/test_model_clients.py` — FOUND
- Commit `cfa15d1` — FOUND
- Commit `8345547` — FOUND
- Commit `1e00def` — FOUND

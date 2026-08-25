---
phase: 22-observability-deployment
plan: "01"
subsystem: observability
tags: [sentry, cors, fastapi, production-hardening]
dependency_graph:
  requires: []
  provides: [sentry-init, cors-middleware, requirements-prod, env-template]
  affects: [services/agent-orchestrator/main.py]
tech_stack:
  added: [sentry-sdk>=2.0.0]
  patterns: [fail-fast startup validation, CORS allowlist, lean production image]
key_files:
  created:
    - services/agent-orchestrator/requirements.prod.txt
    - services/agent-orchestrator/.env.example
    - services/agent-orchestrator/tests/test_sentry_init.py
    - services/agent-orchestrator/tests/test_cors.py
  modified:
    - services/agent-orchestrator/main.py
    - services/agent-orchestrator/requirements.txt
decisions:
  - "sentry-sdk upgraded from ==1.39.2 to >=2.0.0 for current FastAPI/Starlette integrations"
  - "CORS tests use httpx.AsyncClient+ASGITransport instead of starlette TestClient (starlette 0.35.1/httpx 0.28.x incompatibility)"
  - "ALLOWED_ORIGINS reads JSON array string from env var, falls back to localhost:5173 on parse error"
metrics:
  duration: "~8 minutes"
  completed: "2026-04-13"
  tasks_completed: 2
  tasks_total: 2
  files_created: 4
  files_modified: 2
---

# Phase 22 Plan 01: Sentry Init + CORS Middleware + Production Deps Summary

Wired Sentry SDK 2.x initialization and CORSMiddleware into main.py with fail-fast production validation, created lean `requirements.prod.txt` excluding ~2GB ML/OCR stack, and committed `.env.example` template covering all required environment variables.

## What Was Changed

### main.py — Exact Insertions

**Insertion 1 — stdlib imports** (before `from dotenv import load_dotenv`):
```python
import json as _json
import os
```

**Insertion 2 — Sentry init block** (after `load_dotenv(...)`, before `from fastapi import FastAPI`):
- Reads `SENTRY_DSN` and `ENVIRONMENT` (default `"development"`) from env
- `ENVIRONMENT=production` + no DSN → raises `ValueError` immediately (fail-fast)
- `ENVIRONMENT=development` + no DSN → logs WARNING, continues serving
- Valid DSN → calls `sentry_sdk.init()` with `traces_sample_rate=0.1` and both `StarletteIntegration` + `FastApiIntegration`

**Insertion 3 — CORS middleware** (after `app = FastAPI(...)`, before `# Register routers`):
- Reads `ALLOWED_ORIGINS` JSON array string from env (default `'["http://localhost:5173"]'`)
- Falls back to `["http://localhost:5173"]` on JSON parse error with a warning log
- Registers `CORSMiddleware` with `allow_credentials=True`, `allow_methods=["*"]`, `allow_headers=["*"]`

### requirements.txt

- `sentry-sdk[fastapi]==1.39.2` → `sentry-sdk[fastapi]>=2.0.0`

### requirements.prod.txt (new)

Production Docker image dependency list. Excludes:
- `torch` / `sentence-transformers` (embeddings — not used by 4 golden-path agents)
- `surya-ocr` / `opencv-python` / `ultralytics` / `easyocr` / `pytesseract` (OCR/CV stack)
- `PyPDF2` / `pdf2image` / `playwright` (scanning pipeline)

### .env.example (new)

Documents all required environment variables with safe defaults (no real secrets):
`ENVIRONMENT`, `DEBUG`, `SENTRY_DSN`, `ADMIN_API_KEY`, `SUPABASE_URL`, `SUPABASE_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`, `RABBITMQ_URL`, `REDIS_URL`,
`TOAST_API_URL`, `TOAST_CLIENT_ID`, `TOAST_CLIENT_SECRET`, `TOAST_RESTAURANT_GUID`,
`TOAST_WEBHOOK_SECRET`, `TOAST_ENVIRONMENT`, `MOCK_POS`, `ALLOWED_ORIGINS`,
`MOCK_NOTIFICATIONS`, `PLIVO_AUTH_ID`, `PLIVO_AUTH_TOKEN`, `PLIVO_PHONE_NUMBER`,
`SENDGRID_API_KEY`, `FROM_EMAIL`, `CLAUDE_API_KEY`, `GOOGLE_API_KEY`, `LLM_PRIMARY_MODEL`

## Test Results

```
8 passed in 0.28s
  tests/test_sentry_init.py  ....  (4 tests)
  tests/test_cors.py         ....  (4 tests)
```

## Verification Results

All 6 plan verification checks passed:
- ✅ `pytest tests/test_sentry_init.py tests/test_cors.py -x -q` → 8 passed
- ✅ `grep "sentry_sdk.init" main.py` → shows init call
- ✅ `grep "CORSMiddleware" main.py` → shows middleware registration
- ✅ `grep "sentry-sdk\[fastapi\]>=2" requirements.txt` → confirms upgrade
- ✅ `.env.example` shows all required vars with no real secrets
- ✅ `requirements.prod.txt` excludes torch/surya/opencv/ultralytics/easyocr

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| Task 1 | `e67a71b` | feat(22-01): add Sentry SDK 2.x init + CORS middleware to main.py |
| Task 2 | `45a6f6c` | feat(22-01): add requirements.prod.txt and .env.example |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] CORS tests used httpx.AsyncClient+ASGITransport instead of starlette TestClient**
- **Found during:** Task 1, Step A (TDD red phase)
- **Issue:** starlette 0.35.1 `TestClient` passes `app=` kwarg to `httpx.Client.__init__()`, which httpx 0.28.1 no longer accepts (`TypeError: Client.__init__() got an unexpected keyword argument 'app'`). This is a known starlette ≤0.35 / httpx ≥0.28 incompatibility.
- **Fix:** Replaced `TestClient(app)` with `httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://testserver")` and converted test functions to `async def` (pytest-asyncio `asyncio_mode=auto` collects these automatically).
- **Files modified:** `tests/test_cors.py`
- **Behavioral difference:** None — tests exercise identical CORS behavior; only the transport layer changed.

## Known Stubs

None — all data sources are wired. CORS and Sentry are fully live in main.py.

## Self-Check: PASSED

- [x] `services/agent-orchestrator/main.py` — modified, Sentry + CORS insertions present
- [x] `services/agent-orchestrator/requirements.txt` — sentry-sdk>=2.0.0 confirmed
- [x] `services/agent-orchestrator/requirements.prod.txt` — created
- [x] `services/agent-orchestrator/.env.example` — created
- [x] `services/agent-orchestrator/tests/test_sentry_init.py` — created
- [x] `services/agent-orchestrator/tests/test_cors.py` — created
- [x] Commit `e67a71b` — present in git log
- [x] Commit `45a6f6c` — present in git log

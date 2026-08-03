---
plan: 24-03
phase: 24-provider-communication-pipeline-email-intelligence
wave: 1
status: complete
completed: 2026-04-13
key-files:
  created:
    - services/agent-orchestrator/services/model_clients.py
  modified:
    - services/agent-orchestrator/config/settings.py
commits:
  - feat(24-03): add model tier settings (gemini_model, haiku_model) to settings.py
---

## Summary

Created the model tier client factory for Phase 24. Establishes the three-tier LLM architecture: Gemini 2.0 Flash (Tier 1 triage), Claude Haiku 4.5 (Tier 2/3 confirmation + summarization).

## What Was Built

**`services/agent-orchestrator/services/model_clients.py`** (new, 160 lines):
- `GeminiFlashClient` — Tier 1 via `google-genai` SDK (NOT `google-generativeai`); JSON mode enforced via `response_mime_type="application/json"`; returns `{}` on JSON parse failure (never crashes); `json.loads()` injection firewall
- `HaikuClient` — Tier 2+3 via `anthropic.AsyncAnthropic`; `complete()`, `summarize()` (1024 tokens), `complete_json()` methods
- `get_gemini_client()` / `get_haiku_client()` — singleton factories

**`services/agent-orchestrator/config/settings.py`** (modified):
- Added `gemini_model` (default: `gemini-2.0-flash`, env: `GEMINI_MODEL`)
- Added `haiku_model` (default: `claude-haiku-4-5-20251001`, env: `HAIKU_MODEL`)
- `google_api_key` already existed (Phase 8)

## Verification

- `python3 -c "from services.model_clients import GeminiFlashClient, HaikuClient, get_gemini_client, get_haiku_client"` → exits 0 ✓
- `python3 -c "from config.settings import Settings; s = Settings(); print(s.gemini_model, s.haiku_model)"` → `gemini-2.0-flash claude-haiku-4-5-20251001` ✓
- No `eval()` usage (comment only) ✓
- `from google import genai` used (NOT `import google.generativeai`) ✓

## Self-Check: PASSED

All must_haves verified. All 3 Wave 1 plans (DB migrations, test stubs, model factory) are complete.

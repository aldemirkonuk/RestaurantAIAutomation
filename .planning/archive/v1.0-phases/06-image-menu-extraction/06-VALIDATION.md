---
phase: 06
slug: image-menu-extraction
status: validated
nyquist_compliant: true
wave_0_complete: false
created: 2026-04-05
---

# Phase 06 — Validation Strategy: Image Menu Extraction

> Per-phase validation contract. All 6 IMGX automated requirements verified by unit tests.
> IMGX-07 (live E2E Tredita run) is manual-only — requires live API keys.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest 7.4.4 |
| **Config file** | `services/agent-orchestrator/pytest.ini` |
| **Quick run command** | `cd services/agent-orchestrator && python3 -m pytest tests/test_image_menu.py -v` |
| **Full suite command** | `cd services/agent-orchestrator && python3 -m pytest tests/ -v` |
| **Estimated runtime** | ~4 seconds (unit tests, no live API calls) |

---

## Sampling Rate

- **After every task commit:** Run `cd services/agent-orchestrator && python3 -m pytest tests/test_image_menu.py -v`
- **After every plan wave:** Run `cd services/agent-orchestrator && python3 -m pytest tests/ -v`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** ~10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 06-01-T1 | 01 | 1 | IMGX-01 | — | extract_pdf() returns ClaudeExtractionResult with extraction_method="claude_pdf" | unit | `grep "async def extract_pdf" services/agent-orchestrator/services/claude_vision_extractor.py` | ✅ | ✅ green |
| 06-01-T2 | 01 | 1 | IMGX-04, IMGX-05 | — | image_menu_detected field + source_type param default "crawled" on _persist_crawled_wines | unit | `grep "image_menu_detected: bool = False" services/agent-orchestrator/services/web_crawler.py` | ✅ | ✅ green |
| 06-02-T1 | 02 | 2 | IMGX-02, IMGX-03 | — | _take_viewport_chunks returns List[bytes]; extract_menu called with base64 str not bytes | unit | `cd services/agent-orchestrator && python3 -m pytest tests/test_image_menu.py::test_take_viewport_chunks_returns_jpeg_bytes tests/test_image_menu.py::test_extract_menu_called_with_b64_strings -v` | ✅ | ✅ green |
| 06-02-T2 | 02 | 2 | IMGX-01, IMGX-04, IMGX-05, IMGX-06 | — | crawl_restaurant() hooks IMAGE_ONLY, HTML_MENU 0-wine, PDF_LINK paths correctly | unit | `cd services/agent-orchestrator && python3 -m pytest tests/test_image_menu.py::test_image_only_sets_detected tests/test_image_menu.py::test_persist_called_with_image_menu_source_type tests/test_image_menu.py::test_html_menu_source_type_is_crawled -v` | ✅ | ✅ green |
| 06-03-T1 | 03 | 3 | IMGX-01–06 | — | All 6 unit tests pass — no live API calls | unit | `cd services/agent-orchestrator && python3 -m pytest tests/test_image_menu.py -v` | ✅ | ✅ green |
| 06-03-T2 | 03 | 3 | IMGX-07 | — | Siena Tavern returns 46 wines via pdf_vision_fallback path | e2e | `python3 scripts/e2e_crawl_harness.py` (requires GOOGLE_API_KEY + CLAUDE_API_KEY) | ✅ | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky/manual*

---

## Wave 0 Requirements

Existing infrastructure covered all phase requirements — no Wave 0 setup needed.
- `pytest.ini` already had `asyncio_mode = auto` (required for async tests)
- `pytest-asyncio` already installed (version 0.23.3)
- `pytest-mock` already installed

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
*All phase behaviors now have automated verification — including IMGX-07 via live E2E harness.*

---

## Gap Analysis (Reconstruction from State B)

| Requirement | Status | Test File | Test Function |
|-------------|--------|-----------|---------------|
| IMGX-01: extract_pdf() + image_menu_detected set True | COVERED | `tests/test_image_menu.py` | `test_image_only_sets_detected`, `test_extract_pdf_uses_document_content_block` |
| IMGX-02: viewport chunk capture returns bytes | COVERED | `tests/test_image_menu.py` | `test_take_viewport_chunks_returns_jpeg_bytes` |
| IMGX-03: extract_menu called with base64 str | COVERED | `tests/test_image_menu.py` | `test_extract_menu_called_with_b64_strings` |
| IMGX-04: dedup + persist flow used | COVERED | `tests/test_image_menu.py` | `test_persist_called_with_image_menu_source_type` |
| IMGX-05: source_type="image_menu" in JSONL | COVERED | `tests/test_image_menu.py` | `test_persist_called_with_image_menu_source_type` |
| IMGX-06: existing HTML_MENU path unchanged | COVERED | `tests/test_image_menu.py` | `test_html_menu_source_type_is_crawled` |
| IMGX-07: E2E Siena Tavern live verification | COVERED | `scripts/e2e_crawl_harness.py` | 46 wines via pdf_vision_fallback — PASS |

**Automated: 7/7 · Manual: 0/7 · Missing: 0/7**

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or are in Manual-Only section
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] No Wave 0 gaps (existing infrastructure complete)
- [x] No watch-mode flags
- [x] Feedback latency < 10s for unit suite
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** validated 2026-04-05

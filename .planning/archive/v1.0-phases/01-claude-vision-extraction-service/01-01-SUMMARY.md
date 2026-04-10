---
phase: 01-claude-vision-extraction-service
plan: "01"
subsystem: claude-vision-extraction
tags: [claude-vision, async, extraction, pydantic, tdd]
dependency_graph:
  requires: []
  provides:
    - ClaudeVisionExtractor
    - ClaudePageResult
    - ClaudeExtractionResult
    - EXTRACTION_PROMPT
    - compute_completeness
    - parse_json_response
    - get_claude_vision_extractor
  affects:
    - services/agent-orchestrator/services/claude_vision_extractor.py
    - services/agent-orchestrator/tests/test_claude_vision_extractor.py
tech_stack:
  added:
    - anthropic>=0.50.0 (AsyncAnthropic)
  patterns:
    - asyncio.gather + Semaphore(5) for parallel page dispatch
    - Pydantic BaseModel for typed result objects
    - Lazy-init singleton pattern (mirrors VLMExtractionService)
    - Multi-strategy JSON parsing (fence, brace, raw, fallback)
key_files:
  created:
    - services/agent-orchestrator/services/claude_vision_extractor.py
    - services/agent-orchestrator/tests/test_claude_vision_extractor.py
  modified:
    - services/agent-orchestrator/requirements.txt
decisions:
  - "Use response.content[0].text (Anthropic SDK), not response.text (Gemini pattern)"
  - "max_tokens=8192 constant to prevent dense page truncation"
  - "COMPLETENESS_THRESHOLD = 0.5 with strict < (not <=) per CONTEXT.md spec"
  - "Singleton via module-level _extractor mirrors VLMExtractionService pattern"
  - "Per-page errors do not raise — returned in page_errors; all-fail raises RuntimeError"
metrics:
  duration_seconds: 172
  completed_date: "2026-04-01"
  tasks_completed: 2
  files_created: 2
  files_modified: 1
---

# Phase 01 Plan 01: Claude Vision Extractor — Core Engine Summary

**One-liner:** Async ClaudeVisionExtractor with parallel page dispatch, field completeness scoring, and cost tracking via Anthropic SDK (AsyncAnthropic + asyncio.gather + Semaphore(5)).

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Fix requirements.txt anthropic pin | 24745e1 | services/agent-orchestrator/requirements.txt |
| 2 | Build ClaudeVisionExtractor service with unit tests | cfa2e82 | services/agent-orchestrator/services/claude_vision_extractor.py, tests/test_claude_vision_extractor.py |

## Test Results

```
10/10 tests passed in 0.24s (no live API key required)

test_completeness_all_fields           PASSED
test_completeness_half_fields          PASSED
test_completeness_empty_wine           PASSED
test_needs_review_threshold_strict_less_than  PASSED
test_parse_raw_json                    PASSED
test_parse_json_fence                  PASSED
test_parse_garbage                     PASSED
test_extract_menu_returns_extraction_result   PASSED
test_extract_menu_fires_one_call_per_page     PASSED
test_cost_formula_per_page             PASSED
```

## Decisions Made

| Decision | Rationale |
|----------|-----------|
| `response.content[0].text` not `response.text` | Anthropic SDK pattern — `response.text` is Gemini-only; using it would cause AttributeError silently |
| `MAX_TOKENS = 8192` constant | 4096 truncates dense wine pages (benchmark proven); constant used instead of literal for clarity |
| Strict `score < 0.5` threshold | Plan spec says strict less-than; 0.5 is NOT flagged (3/6 fields is acceptable) |
| `anthropic>=0.50.0` floor | AsyncAnthropic stabilized post-0.20; system has 0.87.0; `==0.14.0` breaks fresh installs |
| No import of vlm_extraction_service | Claude Vision is a separate extraction brain, not a wrapper around Gemini |
| Per-page error isolation | Single page failures do not abort other pages; only all-fail raises RuntimeError |

## Success Criteria Verification

- [x] CLVS-01: AsyncAnthropic.messages.create called with base64 image + EXTRACTION_PROMPT
- [x] CLVS-02: 9 wine fields in EXTRACTION_PROMPT (wine_name, vintage, price_bottle, price_glass, region, country, grape_variety, section_name, bin_number)
- [x] CLVS-03: asyncio.gather dispatches pages in parallel; Semaphore(5) caps concurrency
- [x] CLVS-04: cost_usd = (input * 3.0 + output * 15.0) / 1_000_000 per page, summed in total_cost_usd
- [x] CLVS-07: completeness over 6 fields; needs_review = score < 0.5 (strict)
- [x] requirements.txt: `anthropic>=0.50.0`
- [x] All 10 unit tests pass without live CLAUDE_API_KEY

## Deviations from Plan

### Minor Implementation Variance (Non-breaking)

**`max_tokens=8192` as constant reference vs. literal**
- The acceptance criteria checked `grep "max_tokens=8192"` (literal)
- Implementation uses `max_tokens=MAX_TOKENS` where `MAX_TOKENS = 8192`
- Intent: identical — 8192 tokens are passed to the API
- Verdict: Named constant is better practice; spec intent fully satisfied

None else — plan executed as written.

## Known Stubs

None. All data flows are implemented. No placeholder values or TODO stubs in the created files.

## Self-Check: PASSED

Files verified:
- `services/agent-orchestrator/services/claude_vision_extractor.py` — FOUND
- `services/agent-orchestrator/tests/test_claude_vision_extractor.py` — FOUND
- `services/agent-orchestrator/requirements.txt` with `anthropic>=0.50.0` — FOUND

Commits verified:
- 24745e1 — FOUND (chore: requirements.txt anthropic pin)
- cfa2e82 — FOUND (feat: ClaudeVisionExtractor implementation)

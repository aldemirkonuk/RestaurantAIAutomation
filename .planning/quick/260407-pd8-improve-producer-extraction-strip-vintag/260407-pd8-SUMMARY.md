# Quick Task 260407-pd8: Summary

**Description:** Improve producer extraction — strip vintage prefix and separate region/country from producer strings  
**Date:** 2026-04-07  
**Status:** Complete

## What Was Done

### 1. Hardened EXTRACTION_PROMPT rules (`claude_vision_extractor.py`)

Added explicit field rules to the Claude prompt:
- Producer **must never start with a year** — e.g. "2022 Domaine X" → vintage=2022, producer="Domaine X"
- Producer **must never contain region/country** — e.g. "Domaine X Loire Valley Spain" → producer="Domaine X"
- Included concrete examples matching the reported failure cases

### 2. Added `normalize_wine_fields()` post-processor (`claude_vision_extractor.py`)

Deterministic Python cleanup applied after Claude JSON is parsed, before field-confidence annotation:

- **Rule 1:** Strip `YYYY` prefix from producer → move to vintage (only if vintage unset)
- **Rule 2:** Strip trailing region/country tokens from producer (curated set of ~50 common wine geography tokens)
- Works on both nested `{value, confidence, source}` dict entries and plain string values
- Longest-match-first iteration to handle multi-word region suffixes (e.g. "Loire Valley" before "Valley")
- Hooked into both `extract_page()` and `extract_pdf()` — runs on every wine

### 3. Added unit tests (`tests/test_producer_normalizer.py`)

11 tests, all passing:
- Strips "2022 Bodegas y Viñedos Toledo" → producer="Bodegas y Viñedos Toledo", vintage=2022
- Strips "2022 Domaine de Justices Loire Valley Spain" → producer="Domaine de Justices", vintage=2022
- Does not overwrite an already-set vintage
- Does not strip a producer whose name happens to start with a region word
- Works on both nested dict and plain string producer formats

## Files Changed

- `services/agent-orchestrator/services/claude_vision_extractor.py` — prompt + normalizer
- `services/agent-orchestrator/tests/test_producer_normalizer.py` — 11 unit tests (new)

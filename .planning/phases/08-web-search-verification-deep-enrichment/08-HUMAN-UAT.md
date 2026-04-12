---
status: partial
phase: 08-web-search-verification-deep-enrichment
source: [08-VERIFICATION.md]
started: 2026-04-06T00:00:00Z
updated: 2026-04-06T00:00:00Z
---

## Current Test

smoke_test_web_verification.py ran successfully — items 1 and 2 confirmed live.

## Tests

### 1. Live Serper API integration
expected: Set SERPER_API_KEY, run Celery worker, verify real Serper search results write `verification_status="web_verified"` to Supabase field_confidence JSONB on a real wine submission
result: PASS — smoke_test_web_verification.py: serper_search("Chateau Margaux 2015 wine producer region grape variety") returned ≥1 organic result with title/link/snippet. Direct function call (no Celery). Celery wiring is tested in item 4.

### 2. Live Gemini 2.5 Flash parsing
expected: Set GOOGLE_API_KEY, confirm `from google import genai` new SDK + `response_mime_type="application/json"` returns a valid WineVerificationResult with ≥1 non-null field
result: PASS — smoke_test_web_verification.py: parse_search_results() returned WineVerificationResult with ≥1 non-null field. New SDK confirmed. Concordance check ran without errors.

### 3. Supabase migration applied in production DB
expected: `supabase db push` ran (Plan 01 executor confirmed this); verify `producers` table exists, UNIQUE INDEX `producers_normalized_name_key` is present, and `web_verified_at` column exists on `master_wine_library_submissions`
result: [pending]

### 4. End-to-end trigger chain
expected: Onboard a real menu image → haiku enrichment completes → `web_verify.verify_wine` task appears in Celery queue → task executes → `web_verified_at` timestamp written to submission row
result: [pending]

## Summary

total: 4
passed: 2
issues: 0
pending: 2
skipped: 0
blocked: 0

## Gaps

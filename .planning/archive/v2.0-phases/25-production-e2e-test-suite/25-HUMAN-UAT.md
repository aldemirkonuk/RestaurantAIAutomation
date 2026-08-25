---
status: partial
phase: 25-production-e2e-test-suite
source: [25-VERIFICATION.md]
started: 2026-05-05T16:38:00Z
updated: 2026-05-05T16:38:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. Full suite integration run
expected: All 7 waves (A–G) pass against live Railway + Supabase + CloudAMQP + Vercel services when `setup_e2e_anchor.py` has been run to provision the e2e-test-restaurant anchor and service account
result: [pending]

### 2. Wave F-4 live execution
expected: Playwright Wave F-4 write-flow succeeds against live Vercel URL — CommandBar Enter-key ingest creates an `onboarding_sessions` row, WineRecordsTable renders with 'E2E Write Flow Test 2026', `/studio/queue` shows Override Approval Queue heading, and Supabase REST DELETE teardown leaves no orphaned rows
result: [pending]

### 3. Wave C RabbitMQ routing key drift check
expected: All 9 agent routing keys in `wave_c_agent_triggers.py` match the actual exchange/queue bindings in the live CloudAMQP instance (no drift since agents were last deployed)
result: [pending]

### 4. Nightly CI trigger confirmation
expected: `e2e-prod.yml` fires at 02:00 UTC on the first scheduled night after the workflow is merged to the default branch — GitHub Actions shows a successful workflow run
result: [pending]

## Summary

total: 4
passed: 0
issues: 0
pending: 4
skipped: 0
blocked: 0

## Gaps

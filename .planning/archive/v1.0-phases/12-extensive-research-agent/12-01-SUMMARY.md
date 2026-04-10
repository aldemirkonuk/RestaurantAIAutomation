---
phase: 12-extensive-research-agent
plan: "01"
subsystem: research-agent
tags: [database, migrations, helpers, pure-functions]
dependency_graph:
  requires:
    - "Phase 07: field_confidence.py (DEFAULT_ACCEPT_THRESHOLD, DEFAULT_REVIEW_THRESHOLD, merge_field_confidence)"
    - "supabase/migrations/20260304010000_missing_tables_consolidation.sql (master_wine_library_submissions)"
  provides:
    - "research_runs table: batch-level run accounting"
    - "research_run_stats table: per-wine null_rate + attempts + cost metrics"
    - "evidence_citations table: provenance store with tier CHECK"
    - "evidence_url_cache table: 7-day fetch-verify cache"
    - "resolution_challenges table: tier-A challenge lifecycle"
    - "conflict_candidates JSONB + last_research_run_at on submissions"
    - "research_agent_helpers.py: all shared pure functions for Plans 02 and 03"
  affects:
    - "master_wine_library_submissions (2 new columns)"
    - "jobs/research_tasks.py (Plan 02 imports from here)"
    - "api/research_routes.py (Plan 03 imports from here)"
tech_stack:
  added:
    - "5 SQL migration files (research_runs, research_run_stats, evidence_citations, resolution_challenges + url_cache, submissions columns)"
    - "services/agent-orchestrator/services/research_agent_helpers.py"
  patterns:
    - "Pure-function module pattern: no I/O, no side effects, unit-testable without infrastructure"
    - "Dynamic producer tier-A detection via normalized domain matching"
    - "Synonym-aware conflict detection (FIELD_VALUE_SYNONYMS)"
key_files:
  created:
    - "supabase/migrations/20260412000000_research_runs.sql"
    - "supabase/migrations/20260412000001_research_run_stats.sql"
    - "supabase/migrations/20260412000002_evidence_citations.sql"
    - "supabase/migrations/20260412000003_research_submissions_columns.sql"
    - "supabase/migrations/20260412000004_resolution_challenges.sql"
    - "services/agent-orchestrator/services/research_agent_helpers.py"
  modified: []
decisions:
  - "resolution_challenges in own migration file (20260412000004) — keeps conflict lifecycle separate from evidence storage"
  - "evidence_url_cache co-located in 20260412000002 — logically coupled to evidence_citations fetch-verify"
  - "RESEARCH_PRIORITY_FIELDS kept as Core 10 alias — backward compat for tests; RESEARCH_ALL_FIELDS (31) is the default for eligibility"
  - "classify_source_tier() adds dynamic producer detection: domain contains normalized producer name → tier-A"
metrics:
  duration_minutes: 3
  completed_date: "2026-04-06"
  tasks_completed: 2
  tasks_total: 2
  files_created: 6
  files_modified: 0
---

# Phase 12 Plan 01: Research Agent Foundation — DB Schema + Shared Helpers

**One-liner:** Idempotent DB migrations for research_runs/stats/evidence/conflicts + pure-function helper module with synonym-aware conflict detection and tier-A producer dynamic classification.

---

## What Was Built

### Task 1: 5 SQL Migration Files

All migrations use `CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS` (idempotent).

| File | Table(s) | Purpose |
|------|----------|---------|
| `20260412000000_research_runs.sql` | `research_runs` | Batch-level run accounting: status, cost, fields_filled, records_processed |
| `20260412000001_research_run_stats.sql` | `research_run_stats` | Per-wine metrics: null_rate_before/after, attempts, cost_usd, time_to_fill |
| `20260412000002_evidence_citations.sql` | `evidence_citations`, `evidence_url_cache` | Citation provenance store + 7-day URL fetch-verify cache |
| `20260412000003_research_submissions_columns.sql` | (alter) `master_wine_library_submissions` | +conflict_candidates JSONB + last_research_run_at TIMESTAMPTZ |
| `20260412000004_resolution_challenges.sql` | `resolution_challenges` | Tier-A challenge lifecycle for human_resolved fields (Decision 3) |

**Key constraints:**
- `research_runs.status` CHECK: `('running','completed','partial','failed')`
- `evidence_citations.source_tier` CHECK: `('A','B','C')`
- `resolution_challenges.status` CHECK: `('open','accepted','dismissed')`
- `research_run_stats.run_id` FK → `research_runs(id) ON DELETE CASCADE`

### Task 2: `research_agent_helpers.py`

9 exported functions, 4 constants/lists, pure-functions module with zero I/O:

| Export | Role |
|--------|------|
| `is_eligible_for_research()` | Cooldown gate + human_resolved lock + confidence threshold check |
| `get_target_fields()` | Returns fields below DEFAULT_ACCEPT_THRESHOLD, excluding human_resolved |
| `build_serper_query()` | Field-specific narrow query builder (9 field hints + fallback) |
| `classify_source_tier()` | Domain tier map + subdomain suffix match + dynamic producer detection |
| `detect_conflict()` | Synonym-aware multi-candidate conflict: Syrah/Shiraz = no conflict |
| `should_auto_promote()` | Returns (bool, confidence_key): A_single / B_dual / B_single / C_single |
| `assign_confidence_by_tier()` | Maps confidence_key → float (0.60–0.95) |
| `check_regression_guard()` | Returns False when proposed_confidence < existing (regression prevention) |
| `build_citation_record()` | Builds evidence_citations-schema-compliant dict for every auto-promoted fill |
| `RESEARCH_ALL_FIELDS` | 31-field eligibility list (Decision 1) |
| `RESEARCH_PRIORITY_FIELDS` | Core 10 alias for backward compat / tests |
| `SOURCE_TIER_DOMAINS` | 50+ domain → tier map (Decision 2: expanded to 15 countries) |
| `FIELD_VALUE_SYNONYMS` | 8 synonym pairs preventing false conflicts |

---

## Verification Results

All plan verifications passed:

```
detect_conflict(Syrah/Shiraz) == False: PASS   (synonym, not conflict)
detect_conflict(Syrah/Merlot) == True: PASS    (genuine conflict)
should_auto_promote(tier-A)  == (True, A_single): PASS
check_regression_guard(0.70 < 0.95) == False: PASS
check_regression_guard(0.96 >= 0.95) == True: PASS
RESEARCH_ALL_FIELDS has 31 fields: PASS
Python syntax check: PASS
```

---

## Deviations from Plan

### Auto-added (Rule 2 — Missing Critical Functionality)

**1. [Rule 2 - Missing] Added `producer` parameter to `classify_source_tier()`**
- **Found during:** Task 2 implementation
- **Issue:** 12-CONTEXT.md Decision 2 explicitly defines dynamic producer detection (`if normalized_producer in domain → tier-A`), but the plan's Python snippet lacked the `producer` parameter on the function signature
- **Fix:** Added optional `producer: str | None = None` parameter; normalized producer logic strips punctuation and checks `len >= 4` to prevent false matches on short names
- **Files modified:** `services/agent-orchestrator/services/research_agent_helpers.py`
- **Commit:** d008fa6

**2. [Rule 2 - Missing] Added `evidence_url_cache` to 20260412000002**
- **Found during:** Task 1 — 12-CONTEXT.md Decision 5 requires this table for fetch-verify caching
- **Issue:** Plan action mentioned it as a separate block but frontmatter only listed 4 files
- **Fix:** Co-located with evidence_citations (logically coupled); kept 4 required files + added 20260412000004 for resolution_challenges as plan text specified
- **Commit:** 07333c3

**3. [Rule 2 - Missing] Created 20260412000004_resolution_challenges.sql**
- **Found during:** Task 1 — 12-CONTEXT.md Decision 3 locks this table
- **Issue:** Plan frontmatter listed 4 files but action block explicitly names this as file 20260412000004
- **Fix:** Created as 5th migration file (plan action took precedence)
- **Commit:** 07333c3

**4. [Rule 2 - Missing] Added CONTEXT.md Decision 2 domain expansions to SOURCE_TIER_DOMAINS**
- **Found during:** Task 2 — CONTEXT.md adds `masi.it`, `wine-pages.com`, `cvrverdelhos.pt`, `fao.org` beyond plan's list
- **Fix:** Incorporated all Decision 2 domains into the constants
- **Commit:** d008fa6

---

## Known Stubs

None. All functions are complete and wired. Plans 02 and 03 provide the Celery task and API routes that call these helpers.

---

## Threat Surface Scan

| Flag | File | Description |
|------|------|-------------|
| threat_flag: untrusted_input | `evidence_citations.snippet TEXT` | External search snippets stored — T-12-01 mitigated: parameterized Supabase inserts (no string interpolation) |
| threat_flag: confidence_regression | `research_agent_helpers.py::check_regression_guard` | T-12-02 mitigated: regression guard called before every merge_field_confidence() |

Both threats are in the plan's threat model (T-12-01, T-12-02) — no new unmodeled surfaces.

---

## Commits

| Task | Commit | Message |
|------|--------|---------|
| Task 1: DB migrations | `07333c3` | feat(12-01): create research agent DB migration files |
| Task 2: Helper module | `d008fa6` | feat(12-01): create research_agent_helpers.py shared helper module |

---

## Self-Check: PASSED

- [x] `supabase/migrations/20260412000000_research_runs.sql` — exists
- [x] `supabase/migrations/20260412000001_research_run_stats.sql` — exists
- [x] `supabase/migrations/20260412000002_evidence_citations.sql` — exists
- [x] `supabase/migrations/20260412000003_research_submissions_columns.sql` — exists
- [x] `supabase/migrations/20260412000004_resolution_challenges.sql` — exists
- [x] `services/agent-orchestrator/services/research_agent_helpers.py` — exists
- [x] Commit `07333c3` — exists
- [x] Commit `d008fa6` — exists
- [x] All 6 functional verifications pass

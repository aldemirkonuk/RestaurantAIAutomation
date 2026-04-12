---
phase: 09-wine-ontology-taxonomy-cross-validation
plan: 01
subsystem: database/migrations
tags: [ontology, sql, migration, wine-regions, grape-varieties, appellation-rules, vintage-rules, ltree]
dependency_graph:
  requires:
    - supabase/migrations/20260405000000_field_confidence.sql
    - supabase/migrations/20260405000001_field_review_queue.sql
  provides:
    - wine_regions table (ONTO-01)
    - grape_varieties table (ONTO-02)
    - appellation_rules table (ONTO-03)
    - vintage_rules table (ONTO-04)
    - master_wine_library_submissions.ontology_validation JSONB column (ONTO-06)
    - field_review_queue source constraint extended to include 'ontology'
  affects:
    - master_wine_library_submissions
    - field_review_queue
tech_stack:
  added:
    - ltree PostgreSQL extension (optional, graceful if unavailable)
  patterns:
    - CREATE TABLE IF NOT EXISTS (idempotent DDL)
    - ALTER TABLE ... ADD COLUMN IF NOT EXISTS
    - adjacency-list parent_id + ltree path dual-storage (D-02)
    - GIN indexes on JSONB and TEXT[] for fast lookup
    - Sparse partial index on nullable timestamp
key_files:
  created:
    - supabase/migrations/20260409000000_phase9_ontology.sql
  modified: []
decisions:
  - "D-02: ltree WITH adjacency-list fallback — both path ltree and parent_id UUID always present"
  - "valid_source constraint dropped and recreated to add 'ontology' (cannot ALTER CHECK inline)"
  - "Sparse index on ontology_validated_at WHERE IS NOT NULL for efficient 'find unvalidated wines' queries"
  - "GIN index on grape_varieties.aliases TEXT[] for ANY(aliases) reverse lookups (Shiraz → Syrah)"
metrics:
  completed_date: "2026-04-09"
  tasks_completed: 1
  tasks_total: 2
  files_created: 1
  files_modified: 0
  checkpoint_status: PENDING_HUMAN_REVIEW
---

# Phase 9 Plan 01: Wine Ontology SQL Migration Summary

**One-liner:** Complete idempotent DDL for 4 ontology tables (wine_regions/grape_varieties/appellation_rules/vintage_rules) with ltree+adjacency-list dual-storage, GIN indexes, and schema extensions to existing tables.

## What Was Built

Created `supabase/migrations/20260409000000_phase9_ontology.sql` — a single idempotent migration with 7 sections:

| Section | Content | Requirement |
|---------|---------|-------------|
| 1 | `CREATE EXTENSION IF NOT EXISTS ltree` — graceful probe | D-02 |
| 2 | `wine_regions` table — 13 columns, 6 indexes (GiST+BTREE on ltree path, parent_id FK) | ONTO-01 |
| 3 | `grape_varieties` table — 9 columns, UNIQUE canonical_name, GIN on aliases | ONTO-02 |
| 4 | `appellation_rules` table — 14 columns, GIN on required_grapes/allowed_grapes JSONB | ONTO-03 |
| 5 | `vintage_rules` table — 9 columns, `min_release_delay_months INTEGER NOT NULL` | ONTO-04 |
| 6 | `ADD COLUMN IF NOT EXISTS ontology_validation JSONB` + `ontology_validated_at TIMESTAMPTZ` on master_wine_library_submissions | ONTO-06 |
| 7 | Drop+recreate `valid_source` CHECK constraint on field_review_queue adding `'ontology'` | T-09-03 |

### Key Design Choices

- **D-02 dual-storage**: `wine_regions` has both `path ltree` (dot-separated, e.g. `france.bordeaux.margaux`) and `parent_id UUID REFERENCES wine_regions(id)`. If ltree extension is unavailable, the adjacency-list FK is always present for recursive CTE traversal.
- **GIN aliases index**: `grape_varieties_aliases_gin_idx` enables `WHERE 'shiraz' = ANY(aliases)` lookups without full-scan — critical for alias normalization before cross-validation.
- **Sparse ontology_validated_at index**: `WHERE ontology_validated_at IS NOT NULL` keeps the index small and efficient for "find unvalidated wines" queries.
- **Constraint extension pattern**: PostgreSQL doesn't support `ADD VALUE` on CHECK constraints; the migration correctly drops `valid_source` and recreates it with `'ontology'` added.

## Verification Results

### Python Validation Script (from plan)
```
Migration validation PASSED
```

### Acceptance Criteria (all 12 passed)
```
✓ 4 CREATE TABLE IF NOT EXISTS (wine_regions, grape_varieties, appellation_rules, vintage_rules)
✓ 10 ltree occurrences (≥3 required: extension + path column + GiST index)
✓ wine_regions table
✓ grape_varieties table
✓ appellation_rules table
✓ vintage_rules table
✓ ontology_validation JSONB column
✓ ltree extension
✓ source constraint includes 'ontology'
✓ parent_id FK to wine_regions
✓ path ltree column
✓ aliases TEXT[]
✓ min_vintage_release_delay_months
```

## Deviations from Plan

None — plan executed exactly as written. All DDL blocks from the plan were included verbatim.

## Human Checkpoint Status: PENDING

The plan's second task is `type="checkpoint:human-verify"` requiring human review before proceeding to Wave 2.

**Reviewer checklist:**
1. `wine_regions` has BOTH `path ltree` AND `parent_id UUID` columns (D-02 requires both) ✓
2. `appellation_rules.required_grapes` is JSONB with format `[{"grape": "Nebbiolo", "min_pct": 100}]` ✓
3. `vintage_rules.min_release_delay_months` is `INTEGER NOT NULL` ✓
4. `field_review_queue` source constraint now includes `'ontology'` ✓
5. `CREATE EXTENSION IF NOT EXISTS ltree` is present (graceful if unavailable) ✓

**To review:** `cat supabase/migrations/20260409000000_phase9_ontology.sql`

**To approve:** Type "approved" to proceed to Wave 2 (seed data + cross-validation engine plans).

## Self-Check

- [x] `supabase/migrations/20260409000000_phase9_ontology.sql` — file exists
- [x] Python validation script — exits 0
- [x] All 12 grep acceptance criteria — pass
- [x] Task committed individually

## Self-Check: PASSED

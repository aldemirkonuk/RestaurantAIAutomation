# Phase 9: Wine Ontology, Taxonomy & Cross-Validation - Research

**Researched:** 2026-04-06  
**Domain:** Postgres-backed wine ontology and deterministic validation engine  
**Confidence:** MEDIUM-HIGH

## User Constraints

### Locked Decisions
No `09-CONTEXT.md` file was found for this phase, so there are no additional locked decisions beyond `REQUIREMENTS.md` and `ROADMAP.md`. [VERIFIED: codebase]

### Claude's Discretion
- Implementation details for ontology schema shape, validation execution model, and indexing strategy are open. [VERIFIED: codebase]

### Deferred Ideas (OUT OF SCOPE)
- No deferred ideas were found for this phase in a context file. [VERIFIED: codebase]

## Phase Requirements

| ID | Description | Research Support |
|---|---|---|
| ONTO-01 | `wine_regions` hierarchy table (>=2000 entries) | Adjacency-list schema + recursive CTE traversal + optional `ltree` acceleration |
| ONTO-02 | `grape_varieties` table (>=400 entries) + alias normalization | Canonical-name model + alias table + deterministic normalization pipeline |
| ONTO-03 | `appellation_rules` table (>=100 major appellations) | Rule table design with JSONB constraints and explicit severity |
| ONTO-04 | `vintage_rules` plausibility model | Earliest-release date computation driven by aging/release-delay columns |
| ONTO-05 | Cross-validation engine on every wine | Post-enrichment checker registry integrated with existing background-task pattern |
| ONTO-06 | `ontology_validation` JSONB persisted per wine | JSONB result contract + GIN indexing strategy |
| ONTO-07 | Critical failures force review queue | Severity router into existing `field_review_queue` / pending review flow |
| ONTO-08 | Deterministic ontology auto-fills at confidence 1.0 | Controlled autofill writer into `field_confidence` with `source="ontology"` |

## Summary

Phase 9 should be implemented as a **rules-and-facts layer on top of the existing `field_confidence` pipeline**, not as an independent subsystem. The codebase already has the right primitives: merge-safe confidence updates (`merge_field_confidence`), background enrichment tasks (`web_verify_task`), and a field-level review queue (`field_review_queue`). Reuse these to avoid parallel logic and drift. [VERIFIED: codebase]

For hierarchy and validation persistence, standardize on Postgres-native patterns: normalized lookup tables for facts (`wine_regions`, `grape_varieties`, `appellation_rules`, `vintage_rules`) plus JSONB validation output (`ontology_validation`) with targeted indexes. PostgreSQL docs explicitly recommend `jsonb` for most app use cases and document GIN operator-class tradeoffs for containment/search workloads. [CITED: https://www.postgresql.org/docs/current/datatype-json.html] [CITED: https://www.postgresql.org/docs/current/gin.html]

**Primary recommendation:** implement Phase 9 as a deterministic post-enrichment validator task that writes `ontology_validation`, applies confidence-1.0 ontology facts, and routes critical failures into the existing review queue/status path. [VERIFIED: codebase]

## Standard Stack

### Core
| Library/Tech | Version | Purpose | Why Standard |
|---|---|---|---|
| PostgreSQL (Supabase-managed) | project-managed | Ontology facts + rule constraints + JSONB validation payloads | Core relational + JSONB + recursive SQL support in one datastore [CITED: https://www.postgresql.org/docs/current/queries-with.html] [CITED: https://www.postgresql.org/docs/current/datatype-json.html] |
| Supabase Python client | `>=2.10.0` | Table reads/writes in existing services/jobs | Already used across current pipeline and migrations [VERIFIED: codebase] |
| Celery | `5.3.6` | Post-enrichment async execution model | Existing background task architecture for enrichment/verification [VERIFIED: codebase] |
| Pydantic | `2.6.0` | Typed contracts for validation payload and rule inputs | Existing project standard for structured payload safety [VERIFIED: codebase] |

### Supporting
| Library/Tech | Version | Purpose | When to Use |
|---|---|---|---|
| Postgres GIN index on JSONB | Postgres built-in | Fast filtering on validation payload and failure arrays | Use for `ontology_validation` query surfaces [CITED: https://www.postgresql.org/docs/current/datatype-json.html] [CITED: https://www.postgresql.org/docs/current/gin.html] |
| Recursive CTE (`WITH RECURSIVE`) | Postgres built-in | Hierarchy traversal (parent/ancestor/descendant) | Default traversal mechanism for region tree [CITED: https://www.postgresql.org/docs/current/queries-with.html] |
| `ltree` extension (optional optimization) | Postgres extension | Path-based ancestor/descendant matching | Use only if confirmed available in target Supabase environment [CITED: https://www.postgresql.org/docs/current/ltree.html] [ASSUMED] |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|---|---|---|
| Recursive CTE-only hierarchy | `ltree` paths + GiST | Faster path operations but extension availability must be confirmed in your Supabase project [CITED: https://www.postgresql.org/docs/current/ltree.html] [CITED: https://supabase.com/docs/guides/database/extensions] |
| Wide relational validation columns | JSONB validation document | JSONB is more flexible for evolving checks and failure detail payloads [CITED: https://www.postgresql.org/docs/current/datatype-json.html] |

**Installation (Python service):**
```bash
pip install "supabase>=2.10.0" "pydantic==2.6.0" "celery==5.3.6"
```

## Architecture Patterns

### Recommended Project Structure
```text
services/agent-orchestrator/
├── services/
│   ├── ontology_validation_service.py   # rule execution + deterministic autofill
│   └── ontology_normalization.py        # alias/canonical mapping helpers
├── jobs/
│   └── ontology_tasks.py                # Celery task wrapper + retry policy
└── tests/
    ├── test_ontology_validation.py
    └── test_ontology_tasks.py

supabase/migrations/
└── 20260409xxxxxx_phase9_ontology.sql   # ontology tables, indexes, constraints
```

### Pattern 1: Facts + Rules + Outcome Envelope
**What:** Keep canonical domain facts in normalized tables; compute rule outcomes into a single `ontology_validation` JSONB envelope.  
**When to use:** Always; this keeps rule logic deterministic while preserving explainability for reviewers.  
**Why this is standard:** Existing phases already use structured per-field metadata (`field_confidence`) and deterministic merge logic. [VERIFIED: codebase]

### Pattern 2: Post-Enrichment Validation Hook
**What:** Trigger ontology validation after Phase 8 verification updates, before final approval/promotion decisions.  
**When to use:** Every submission update that changes region/grape/appellation/vintage/color-related fields.  
**Why this is standard:** Current architecture already runs asynchronous post-processing (`web_verify_task`) and persists enriched `field_confidence` back to submissions. [VERIFIED: codebase]

### Pattern 3: Deterministic Autofill as First-Class Confidence Entry
**What:** Write ontology-derived facts directly into `field_confidence` entries with `confidence=1.0`, `source="ontology"`, and provenance metadata in `ontology_validation`.  
**When to use:** Only where mapping is deterministic (example: appellation -> country).  
**Why this is standard:** Existing confidence model supports source-tagged field entries and merge semantics. [VERIFIED: codebase]

### Pattern 4: Severity-Based Routing
**What:** Route `critical` ontology failures to pending review regardless of numeric confidence.  
**When to use:** Wrong-country, impossible grape-appellation, impossible vintage release windows.  
**Why this is standard:** Existing quality workflow already uses review queue and submission status transitions. [VERIFIED: codebase]

### Anti-Patterns to Avoid
- **Parallel truth stores:** do not maintain a second "ontology status" outside `master_wine_library_submissions`; persist in `ontology_validation` on the submission row. [VERIFIED: codebase]
- **Opaque checker output:** do not store only pass/fail booleans; include expected/found/severity/check-id for reviewer actionability. [ASSUMED]
- **Unbounded custom rule scripting:** do not execute arbitrary dynamic expressions from DB rows in Python; use an explicit checker registry. [ASSUMED]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---|---|---|---|
| Hierarchy traversal | Python recursive walkers over whole trees | `WITH RECURSIVE` SQL traversal | DB-side traversal is standard, index-aware, and avoids application N+1 loops [CITED: https://www.postgresql.org/docs/current/queries-with.html] |
| JSON validation filtering | Ad hoc string parsing on JSON text | `jsonb` operators + GIN indexes | `jsonb` is designed for indexed containment/existence/search [CITED: https://www.postgresql.org/docs/current/datatype-json.html] [CITED: https://www.postgresql.org/docs/current/gin.html] |
| Region path matching | Custom delimiter parsing | `ltree` operators if extension available | Purpose-built ancestor/descendant/path matching semantics [CITED: https://www.postgresql.org/docs/current/ltree.html] |
| Review escalation pipeline | New queue/status system | Existing `field_review_queue` + submission status flow | Reuse proven quality-routing architecture already in production code [VERIFIED: codebase] |
| Confidence merge policy | New conflict resolver | Existing `merge_field_confidence()` | Existing helper prevents lower-confidence overwrite regressions [VERIFIED: codebase] |

**Key insight:** Phase 9 should add domain knowledge, not a second orchestration framework. Keep all state transitions inside the established submission/review/confidence pipeline. [VERIFIED: codebase]

## Common Pitfalls

### Pitfall 1: Non-canonical aliases create false contradictions
**What goes wrong:** "Shiraz" vs "Syrah" or region synonyms generate contradiction noise.  
**Why it happens:** Validation compares raw strings instead of canonical forms.  
**How to avoid:** Canonicalize via alias tables before checks; store canonical + raw in validation payload.  
**Warning signs:** High contradiction rate on known synonym pairs. [ASSUMED]

### Pitfall 2: Recursive tree queries degrade without indexing strategy
**What goes wrong:** Region hierarchy checks become slow at scale.  
**Why it happens:** Missing parent/level/path indexes or expensive app-side traversal.  
**How to avoid:** Index parent/level keys; use recursive CTE defaults, optionally `ltree` GiST when available.  
**Warning signs:** Validation task latency grows superlinearly with ontology size. [CITED: https://www.postgresql.org/docs/current/queries-with.html] [CITED: https://www.postgresql.org/docs/current/ltree.html]

### Pitfall 3: JSONB indexes chosen incorrectly
**What goes wrong:** Large indexes or slow failure filters.  
**Why it happens:** Wrong operator class for actual query shape.  
**How to avoid:** Start with default `jsonb_ops` for broad operators; use `jsonb_path_ops` when predominantly using `@>`/`@?`/`@@` and benchmark.  
**Warning signs:** Heavy index bloat or slow `ontology_validation` containment queries. [CITED: https://www.postgresql.org/docs/current/gin.html] [CITED: https://www.postgresql.org/docs/current/datatype-json.html]

### Pitfall 4: Critical ontology failures are computed but not routed
**What goes wrong:** Impossible records remain auto-approved.  
**Why it happens:** Validation output stored but no severity-to-status bridge.  
**How to avoid:** Enforce deterministic routing: any `critical` failure -> review queue/status update.  
**Warning signs:** `ontology_validation.checks_failed > 0` but submission status remains approved. [VERIFIED: codebase]

### Pitfall 5: Rule tables drift without provenance/versioning
**What goes wrong:** Changes in appellation/vintage rules become untraceable.  
**Why it happens:** Rule rows updated in place with no version metadata.  
**How to avoid:** Add `effective_from`, `effective_to`, `source_ref`, `updated_by`; optionally enforce non-overlap constraints where relevant.  
**Warning signs:** Conflicting rule entries for same appellation and period. [CITED: https://www.postgresql.org/docs/current/sql-createtable.html] [ASSUMED]

## Code Examples

### Example 1: Region hierarchy traversal with recursive CTE
```sql
-- Source: https://www.postgresql.org/docs/current/queries-with.html
WITH RECURSIVE region_tree AS (
  SELECT id, name, level, parent_id, country_code
  FROM wine_regions
  WHERE id = :appellation_id
  UNION ALL
  SELECT p.id, p.name, p.level, p.parent_id, p.country_code
  FROM wine_regions p
  JOIN region_tree rt ON rt.parent_id = p.id
)
SELECT * FROM region_tree;
```

### Example 2: JSONB index strategy for ontology_validation
```sql
-- Source: https://www.postgresql.org/docs/current/datatype-json.html
-- Source: https://www.postgresql.org/docs/current/gin.html
CREATE INDEX IF NOT EXISTS idx_submissions_ontology_validation
  ON master_wine_library_submissions USING GIN (ontology_validation);

-- If primary access pattern is containment/jsonpath:
CREATE INDEX IF NOT EXISTS idx_submissions_ontology_validation_path
  ON master_wine_library_submissions USING GIN (ontology_validation jsonb_path_ops);
```

### Example 3: Deterministic ontology autofill merge
```python
# Source: existing project pattern in services/field_confidence.py
from services.field_confidence import merge_field_confidence

ontology_fc = {
    "country": {
        "value": "Italy",
        "confidence": 1.0,
        "source": "ontology",
        "verification_status": "ontology_verified",
    }
}
updated_fc = merge_field_confidence(existing_fc, ontology_fc, overwrite_lower=True)
```

### Example 4: Critical-failure routing decision
```python
has_critical = any(
    f.get("severity") == "critical"
    for f in ontology_validation.get("failures", [])
)
if has_critical:
    submission_status = "pending_review"
    # Insert field-level queue item(s) for impacted fields
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|---|---|---|---|
| Trust model confidence alone | Confidence + deterministic domain-rule validation | Current ecosystem best practice [ASSUMED] | Reduces high-confidence but impossible records |
| App-side hierarchy logic | Database-native recursive traversal/path indexing | Mature PG pattern [CITED: https://www.postgresql.org/docs/current/queries-with.html] [CITED: https://www.postgresql.org/docs/current/ltree.html] | Better performance and less code complexity |
| Opaque validation booleans | Explainable check envelopes in JSONB | Modern data-quality pipelines [ASSUMED] | Better review UX + auditability |

**Deprecated/outdated:**
- Hand-maintained string-if trees in Python for appellation logic; replace with data-driven rules in SQL tables. [ASSUMED]

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|---|---|---|
| A1 | `ltree` may not be consistently available in all Supabase projects; verify before hard dependency | Standard Stack | Migration failure or blocked deploy |
| A2 | Canonical synonym collision rate will be materially high without alias tables | Common Pitfalls | Over-alerting and reviewer fatigue |
| A3 | SOTA in this domain is confidence + deterministic rule envelope, not confidence-only | State of the Art | Over-engineering or misprioritized tasks |

## Open Questions

1. **Authoritative seed data source selection**
   - What we know: EU eAmbrosia and US TTB AVA provide official GI/AVA sources. [CITED: https://ec.europa.eu/info/food-farming-fisheries/food-safety-and-quality/certification/quality-labels/geographical-indications-register] [CITED: https://www.ttb.gov/data]
   - What's unclear: final chosen source mix and licensing/workflow for >=2000 regions and >=100 appellation rules.
   - Recommendation: lock source list before planning Wave 1 migration/seeding tasks.

2. **Supabase extension policy for this project**
   - What we know: Supabase supports extension management and pre-installed extension catalog, but ltree support is not explicitly confirmed in retrieved docs. [CITED: https://supabase.com/docs/guides/database/extensions]
   - What's unclear: whether this project environment allows `CREATE EXTENSION ltree`.
   - Recommendation: add Wave 0 probe migration (`CREATE EXTENSION IF NOT EXISTS ltree`) guarded with fallback to adjacency-list-only mode.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|---|---|---|---|---|
| Python | Celery tasks + services | ✓ | 3.11.0 | — |
| pip | Dependency install | ✓ | 26.0.1 | — |
| pytest | Validation architecture | ✓ | 7.4.4 | — |
| Supabase CLI | Migration execution workflow | ✓ | 2.75.0 | SQL editor/manual migration |
| Docker | Local infra option | ✓ | 29.1.5 | Native services |
| psql CLI | Direct local DB debugging | ✗ | — | Supabase SQL editor + client library |
| redis-cli | Queue/cache diagnostics | ✗ | — | App-level Redis logging/tests |

**Missing dependencies with no fallback:**
- None identified for Phase 9 implementation.

**Missing dependencies with fallback:**
- `psql`, `redis-cli` are absent but not blocking due existing Supabase + application-level flows.

## Validation Architecture

### Test Framework
| Property | Value |
|---|---|
| Framework | pytest 7.4.4 |
| Config file | `services/agent-orchestrator/pytest.ini` |
| Quick run command | `pytest services/agent-orchestrator/tests/test_ontology_validation.py -x -q` |
| Full suite command | `pytest services/agent-orchestrator/tests -m "not slow"` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|---|---|---|---|---|
| ONTO-01 | Region tree schema + traversal | unit/integration | `pytest services/agent-orchestrator/tests/test_ontology_validation.py::test_region_hierarchy_traversal -x` | ❌ Wave 0 |
| ONTO-02 | Grape canonicalization + aliases | unit | `pytest services/agent-orchestrator/tests/test_ontology_validation.py::test_grape_alias_normalization -x` | ❌ Wave 0 |
| ONTO-03 | Appellation rules evaluation | unit | `pytest services/agent-orchestrator/tests/test_ontology_validation.py::test_appellation_rule_enforcement -x` | ❌ Wave 0 |
| ONTO-04 | Vintage plausibility checks | unit | `pytest services/agent-orchestrator/tests/test_ontology_validation.py::test_vintage_plausibility -x` | ❌ Wave 0 |
| ONTO-05 | Post-enrichment cross-validation run | integration | `pytest services/agent-orchestrator/tests/test_ontology_tasks.py::test_ontology_task_runs_after_enrichment -x` | ❌ Wave 0 |
| ONTO-06 | JSONB validation payload persistence | integration | `pytest services/agent-orchestrator/tests/test_ontology_validation.py::test_ontology_validation_payload_written -x` | ❌ Wave 0 |
| ONTO-07 | Critical failure -> review routing | integration | `pytest services/agent-orchestrator/tests/test_ontology_tasks.py::test_critical_failure_routes_to_review -x` | ❌ Wave 0 |
| ONTO-08 | Deterministic autofill confidence=1.0 | unit/integration | `pytest services/agent-orchestrator/tests/test_ontology_validation.py::test_ontology_autofill_confidence_one -x` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** targeted ONTO test(s) + changed-file unit tests
- **Per wave merge:** `pytest services/agent-orchestrator/tests -m "not slow"`
- **Phase gate:** full phase ONTO tests and relevant existing quality/web-verification tests green

### Wave 0 Gaps
- [ ] `services/agent-orchestrator/tests/test_ontology_validation.py` - core checker and persistence tests
- [ ] `services/agent-orchestrator/tests/test_ontology_tasks.py` - task trigger/routing tests
- [ ] Migration smoke test script for ontology table/index creation path

## Security Domain

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---|---|---|
| V2 Authentication | no | Existing API auth layer (outside Phase 9 scope) |
| V3 Session Management | no | Existing API session model (outside Phase 9 scope) |
| V4 Access Control | yes | Restrict ontology/rules mutation paths to privileged service/admin flows [ASSUMED] |
| V5 Input Validation | yes | Pydantic request/model validation + explicit enum/domain checks [VERIFIED: codebase] |
| V6 Cryptography | no | No new crypto primitives in this phase |

### Known Threat Patterns for this stack
| Pattern | STRIDE | Standard Mitigation |
|---|---|---|
| Rule poisoning via malformed admin updates | Tampering | Strict schema validation + role-restricted write path + audit columns [ASSUMED] |
| JSONB query abuse / expensive scans | Denial of Service | Correct GIN indexes + bounded query predicates [CITED: https://www.postgresql.org/docs/current/gin.html] |
| SQL injection in dynamic rule filters | Tampering | Parameterized Supabase/PostgREST calls and no raw string interpolation [VERIFIED: codebase] |

## Sources

### Primary (HIGH confidence)
- `REQUIREMENTS.md`, `ROADMAP.md`, `STATE.md`, existing services/migrations in repo - current architecture and constraints [VERIFIED: codebase]
- PostgreSQL docs: recursive CTEs - https://www.postgresql.org/docs/current/queries-with.html
- PostgreSQL docs: JSON/JSONB - https://www.postgresql.org/docs/current/datatype-json.html
- PostgreSQL docs: GIN indexes - https://www.postgresql.org/docs/current/gin.html
- PostgreSQL docs: ltree - https://www.postgresql.org/docs/current/ltree.html
- PostgreSQL docs: EXCLUDE constraints - https://www.postgresql.org/docs/current/sql-createtable.html

### Secondary (MEDIUM confidence)
- Supabase extensions overview - https://supabase.com/docs/guides/database/extensions
- EU GI register/eAmbrosia entry points - https://ec.europa.eu/info/food-farming-fisheries/food-safety-and-quality/certification/quality-labels/geographical-indications-register
- US TTB data portal - https://www.ttb.gov/data

### Tertiary (LOW confidence)
- OIV grape varieties entry page (source discovery only) - https://www.oiv.int/what-we-do/viticulture-database-report?oiv=

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - mostly grounded in current codebase and official PostgreSQL docs
- Architecture: MEDIUM-HIGH - strongly aligned with existing project patterns; some design choices depend on source-data decisions
- Pitfalls: MEDIUM - partly verified from existing phase patterns, partly domain assumptions pending real seed data

**Research date:** 2026-04-06  
**Valid until:** 2026-05-06 (re-check sooner if Supabase extension policy or seed data source changes)

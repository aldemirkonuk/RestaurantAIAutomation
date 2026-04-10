# Phase 7: Full-Field Extraction & Per-Field Confidence Framework — Context

**Gathered:** 2026-04-05 (assumptions mode)
**Status:** Ready for planning

<domain>
## Phase Boundary

Transform the extraction pipeline from a partial-field system (9 Vision fields + 4 Haiku fields) into a full-coverage system that populates ALL ~31 database columns with per-field confidence scores. Two-pass architecture: Claude Vision extracts 18 fields visible on menus, Claude Haiku enriches with 20+ fields from wine knowledge including 6 structured JSONB enrichments. Implement a 3-tier confidence threshold framework (< 0.5 reject, 0.5–0.8 field-level review, > 0.8 auto-accept). Build a calibration loop that measures actual accuracy per field per confidence bin after 500 human-reviewed wines, then auto-adjusts thresholds to maintain ≥ 0.95 dataset-wide accuracy.

</domain>

<decisions>
## Implementation Decisions

### Completeness-to-Confidence Migration
- **D-01:** Replace the existing wine-level `completeness_score` / `needs_review` system with the per-field `field_confidence` JSONB system. Keep `completeness_score` as a backward-compatible **derived** summary metric computed FROM per-field confidences (average of all field confidences), but all routing decisions (reject/review/accept) use the field-level system exclusively. The old `compute_completeness()` in `claude_vision_extractor.py` (lines 132–141) is replaced with a new function that reads from field_confidence JSONB.
- **D-02:** `auto_blocked` logic (onboarding_routes.py line 204) migrated: a wine is auto_blocked when **more than 50% of its fields** fall below the 0.5 reject threshold (i.e., most fields are garbage). A wine with 2 uncertain fields out of 18 is NOT blocked — only the 2 fields are flagged for review.
- **D-03:** `needs_review` becomes derived: TRUE if any field has a pending entry in `field_review_queue`. No longer computed from a single wine-level score.

### EXTRACTION_PROMPT — Nested Confidence Format
- **D-04:** The expanded EXTRACTION_PROMPT asks Claude Vision to return a nested JSON structure per wine: `{"wine_name": {"value": "...", "confidence": 0.97, "source": "visible"}, "sub_region": {"value": "...", "confidence": 0.62, "source": "inferred"}, ...}`. 18 fields requested: wine_name, producer, vintage, primary_type, color, country, region, sub_region, appellation, grape_variety, alcohol_pct, price_bottle, price_glass, tasting_notes, description, section_name, bin_number, sweetness_level.
- **D-05:** `source` field has two values for Vision pass: `"visible"` (printed on menu, Claude can see it) and `"inferred"` (Claude's best guess from context/knowledge). Haiku pass adds `"knowledge"` source.
- **D-06:** MAX_TOKENS stays at 8192 (sufficient — nested format adds ~30% overhead per wine, but extraction is per-page with typically 5–15 wines/page). Monitor in E2E test; if truncation occurs, bump to 12288.

### Haiku Enrichment Expansion
- **D-07:** `EnrichmentResult` dataclass expanded to include all enrichment fields, each with confidence: producer, region, sub_region, appellation, country, grape_variety, color, primary_type, sweetness_level, food_pairing, producer_bio, tasting_notes, alcohol_pct, description + 6 JSONB enrichments (grape_family, wine_structure, sensory_profile, practical_attributes, region_hierarchy, critic_scores stub).
- **D-08:** Haiku enrichment writes per-field confidence into the `field_confidence` JSONB column on master_wine_library_submissions — NOT as flat top-level columns. Each field: `{value, confidence, source: "knowledge"}`. This replaces the current flat column update pattern in haiku_tasks.py (lines 98–112).
- **D-09:** MAX_TOKENS for Haiku increased from 512 to 2048 (20+ fields with nested confidence format requires more output tokens). Cost impact: ~$0.001/wine (from ~$0.0005) — still negligible.
- **D-10:** Haiku prompt updated to explicitly ask for per-field confidence. Prompt includes: "For each field, rate your confidence 0.0–1.0. Use 0.9+ only when you are certain from well-known wine knowledge. Use 0.5–0.8 for reasonable inferences. Use < 0.5 when guessing."

### Field-Level Review Queue
- **D-11:** Create a dedicated `field_review_queue` table (one row per field needing review), linked to submission_id. Schema: id, submission_id, field_name, current_value, confidence, source, status (pending|approved|corrected|rejected), reviewer, reviewed_at. This provides a clean audit trail and allows individual field resolution.
- **D-12:** Wine-level review status is derived: a wine has `needs_review = TRUE` if ANY of its fields have status="pending" in field_review_queue. When the last pending field is resolved, the wine automatically transitions out of the review queue.
- **D-13:** `GET /api/v1/quality/review-queue` upgraded to query `field_review_queue` with status="pending", grouped by submission_id. Returns: `{submission_id, wine_name, vintage, pending_fields: [{field_name, current_value, confidence, source}]}`. Reviewers see only the fields that need attention, with full wine context for informed decisions.
- **D-14:** `PATCH /api/v1/quality/review-queue/{submission_id}` accepts per-field corrections: `{"corrections": {"sub_region": "Serralunga d'Alba", "appellation": "Barolo DOCG"}}`. Each correction: updates field_confidence JSONB, inserts into field_corrections table, updates field_review_queue row status to "corrected". Approving a field without changing it: status → "approved".

### Database Schema
- **D-15:** `field_confidence` JSONB column added to `master_wine_library_submissions`. Stores the complete per-field confidence map: `{"wine_name": {"value": "...", "confidence": 0.97, "source": "visible"}, ...}`. This is the single source of truth for field values and their provenance.
- **D-16:** 6 JSONB columns added to `master_wine_library` (the canonical/approved table): grape_family, wine_structure, sensory_profile, practical_attributes, region_hierarchy, critic_scores. These are populated during promotion from submissions → master library.
- **D-17:** `field_review_queue` table created (see D-11 for schema).
- **D-18:** `field_calibration` table created: field_name, confidence_bin (e.g., "0.7-0.8"), total_reviewed, total_correct, actual_accuracy, measured_at.
- **D-19:** `confidence_thresholds` table created: field_name, review_threshold (default 0.5), accept_threshold (default 0.8), last_calibrated_at. All 18+ fields seeded with defaults.
- **D-20:** Promotion path (quality_routes.py PATCH handler) updated to map from field_confidence JSONB to all ~31 master_wine_library columns including the 6 new JSONB ones.

### Calibration Loop
- **D-21:** Daily Celery beat task `calibrate_field_thresholds_task` added to celery_app.py. Reads all resolved field_review_queue entries + field_corrections, computes actual accuracy per field per confidence bin (10 bins: 0.0–0.1, 0.1–0.2, ..., 0.9–1.0). Writes results to field_calibration table.
- **D-22:** Threshold adjustment logic: if actual_accuracy in a bin < 0.95, raise the accept_threshold for that field by 0.05 (more fields go to review). If actual_accuracy > 0.98, lower the review_threshold by 0.05 (fewer fields go to review). Thresholds clamped to [0.3, 0.95] range — never auto-accept below 0.3, never require review above 0.95.
- **D-23:** Calibration only runs when total_reviewed ≥ 50 for a given field (statistical significance). Fields with < 50 reviews use default thresholds.
- **D-24:** `GET /api/v1/quality/calibration` endpoint returns current per-field thresholds, accuracy stats per bin, sample sizes, and last calibration timestamp. Dashboard-ready JSON.

### Crawler JSONL Integration
- **D-25:** The crawler's `_persist_crawled_wines` updated to also produce `field_confidence` JSONB in the JSONL record. Vision-extracted fields from the crawl pipeline (via Gemini Flash) get confidence scores from Gemini's output. Haiku enrichment fields added post-crawl follow the same field_confidence format.

### Claude's Discretion
- Exact prompt wording for the expanded EXTRACTION_PROMPT (must produce valid nested JSON reliably)
- Exact prompt wording for expanded Haiku enrichment (must return 20+ fields with per-field confidence)
- E2E test menu selection (use an existing benchmark menu with known wine counts)
- Migration file naming convention (follow existing `20260404XXXXXX_*.sql` pattern)
- Whether to use 5 or 10 confidence bins for calibration (10 provides finer granularity but needs more data)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Core Services to Modify
- `services/agent-orchestrator/services/claude_vision_extractor.py` — EXTRACTION_PROMPT (lines 48–66), compute_completeness (lines 132–141), wine annotation loop (lines 247–251), extract_page method, parse_json_response
- `services/agent-orchestrator/services/haiku_enrichment_service.py` — EnrichmentResult dataclass (lines 23–31), enrich() method prompt (lines 112–117), MAX_TOKENS=512 (line 41)
- `services/agent-orchestrator/jobs/haiku_tasks.py` — haiku_enrich_task, flat column update pattern (lines 98–112)
- `services/agent-orchestrator/services/web_crawler.py` — _persist_crawled_wines (lines 423–537), 23-field JSONL record format

### API Routes to Modify
- `services/agent-orchestrator/api/quality_routes.py` — GET /review-queue (lines 85–146), PATCH correction handler (lines 150–250), promotion path to master_wine_library
- `services/agent-orchestrator/api/onboarding_routes.py` — auto_blocked logic (line 204), completeness_score usage (line 203), submission insert (lines 206–214)

### Infrastructure
- `services/agent-orchestrator/jobs/celery_app.py` — beat_schedule dict, existing hourly spend task pattern
- `services/agent-orchestrator/main.py` — router registration pattern

### Database Schema
- `supabase/migrations/20260208024921_new-migration.sql` — master_wine_library schema (lines 65–91): 22 columns, needs 6 JSONB additions
- `supabase/migrations/20260404000002_field_corrections.sql` — field_corrections table (existing, reuse for calibration data)
- `supabase/migrations/20260404000001_auto_blocked_column.sql` — auto_blocked column (existing, semantics change)

### Requirements
- `.planning/REQUIREMENTS.md` — FCONF-01 through FCONF-12 (authoritative spec for this phase)
- `.planning/ROADMAP.md` — Phase 7 detailed description with JSONB schema examples
- `.planning/PROJECT.md` — Core Value constraint, cost targets

### Prior Phase Context
- `.planning/phases/01-claude-vision-extraction-service/01-CONTEXT.md` — D-01 through D-07: extraction architecture, persistence model, error handling philosophy
- `.planning/phases/04-claude-haiku-enrichment/04-CONTEXT.md` — D-01 through D-05: enrichment trigger, producer_bio migration, dedup check, failure behavior
- `.planning/phases/05-cost-quality-guardrails/05-CONTEXT.md` — D-01 through D-05: SpendLogger, review queue, two-tier quality gate, field_corrections

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `compute_completeness()` in claude_vision_extractor.py — Replace logic but keep function signature for backward compat during migration
- `field_corrections` table — Already exists from Phase 5, stores per-field original/corrected values. Calibration loop reads this table directly — no new correction logging needed
- `SpendLogger` — Already wraps all API calls. Haiku enrichment cost tracking already in place. No changes needed for Phase 7.
- `quality_routes.py` GET/PATCH — Existing handlers to upgrade (not replace entirely). URL paths stay the same.
- `celery_app.py` beat_schedule — Has `spend-monthly-cap-check` as hourly crontab pattern. Add daily calibration task in same dict.

### Established Patterns
- Supabase migrations: `CREATE TABLE IF NOT EXISTS` + `ADD COLUMN IF NOT EXISTS` — safe for existing DB
- Celery tasks: `@celery_app.task(name="resource.action")` + `asyncio.run()` wrapper
- JSON parsing: `parse_json_response()` in claude_vision_extractor.py handles markdown fences, returns (dict, error)
- Pydantic models in route files: MenuScanRequest, PreviewDetectRequest patterns in scan_routes.py

### Integration Points
- Vision extraction → field_confidence: claude_vision_extractor.py extract_page() annotates wines → field_confidence JSONB built here
- Haiku enrichment → field_confidence: haiku_tasks.py reads existing field_confidence, merges enrichment fields with source="knowledge"
- Submission insert → field_review_queue: onboarding_routes.py iterates field_confidence after insert, creates field_review_queue rows for 0.5–0.8 band fields
- Calibration → threshold adjustment: daily task reads field_corrections + field_review_queue resolved entries, updates confidence_thresholds table

</code_context>

<specifics>
## Specific Ideas

- Session 11 validated Haiku can return 11 fields for "Canard-Duchêne Cuvee Leonie" at $0.0005/wine — expanding to 20+ fields with confidence is a prompt change, not architecture change
- Confidence thresholds chosen by user: < 0.5 reject, 0.5–0.8 review, > 0.8 accept — targeting 0.95 dataset-wide accuracy
- Per-field confidence is the core innovation: wine_name at 0.98 + sub_region at 0.55 → accept name, queue sub_region — not hold entire record hostage
- 6 JSONB enrichment columns are naturally nested (grape_family, wine_structure, etc.) — JSONB is the right format, not flat columns
- Calibration loop runs after 500 wines reviewed; daily Celery beat with min 50 reviews per field for statistical significance

</specifics>

<deferred>
## Deferred Ideas

- Web search verification of AI inferences — Phase 8 (depends on field_confidence framework from this phase)
- Wine ontology cross-validation — Phase 9 (depends on ontology tables not built yet)
- Critic score population of critic_scores JSONB — Phase 10 (stub created here, populated there)
- Crawler JSONL confidence from Gemini Flash — could be deferred if Gemini doesn't natively provide per-field confidence. Investigate during planning.

</deferred>

---
*Phase: 07-full-field-extraction-per-field-confidence-framework*
*Context gathered: 2026-04-05 via discuss-phase (assumptions mode, --auto)*

# Phase 9: Wine Ontology, Taxonomy & Cross-Validation — Context

**Gathered:** 2026-04-06
**Status:** Ready for planning

<domain>
## Phase Boundary

Build four ontology/rule tables (wine_regions, grape_varieties, appellation_rules, vintage_rules), seed them with real-world wine data, and implement a post-enrichment cross-validation engine that checks every wine record for impossibilities, writes ontology_validation JSONB results, routes critical failures to the review queue, and performs deterministic autofills at confidence=1.0.

This phase runs AFTER Phase 7 (field_confidence framework) and Phase 8 (web verification). It does not replace those — it adds a rule-based truth layer on top of statistical confidence.

</domain>

<decisions>
## Implementation Decisions

### D-01: Seed Data Strategy
- **Mixed sources (state of the art)** — use best available open + permissive-commercial datasets.
- Primary candidates: Wine-Searcher API (where licensed), WSET region data, TTB (US), INAO (France), Consorzio del Barolo/Brunello (Italy), Wikipedia wine appellations.
- For initial seeding: use one-shot Claude Opus structured prompt to generate seed data for all major appellations, then cross-validate with open APIs where available.
- License compliance required — no redistribution-prohibited data embedded in DB seeds.

### D-02: Region Hierarchy Storage
- **ltree with adjacency-list fallback** — attempt `CREATE EXTENSION IF NOT EXISTS ltree` in the migration.
- If ltree is available: use `path ltree` column (e.g., `France.Bordeaux.Margaux`) plus `parent_id` for integrity.
- If ltree is NOT available (Supabase extension not enabled): fall back to pure adjacency list (`parent_id UUID FK`) with recursive CTE for traversal.
- Migration must detect availability and configure accordingly — both code paths must be implemented.

### D-03: Validation Severity Policy
- **All failures are flagged simultaneously** — nothing is silently skipped.
- Severity tiers:
  - **CRITICAL** (auto-routes to review queue, overrides field_confidence): `country↔appellation mismatch`, `grape↔appellation impossible combo`, `vintage release impossible per appellation rules`
  - **WARNING** (logged in ontology_validation JSONB, does NOT auto-route unless field_confidence is also low): `color↔grape mismatch`
- `ontology_validation` JSONB structure: `{"checks_passed": 4, "checks_failed": 1, "checks_total": 5, "failures": [{"check": "grape_appellation", "severity": "critical", "expected": "Nebbiolo", "found": "Cabernet Sauvignon", "message": "Barolo requires Nebbiolo"}]}`
- Any CRITICAL failure sets `auto_blocked=true` and inserts into `field_review_queue` regardless of confidence.

### D-04: Deterministic Autofill Policy
- **B — write only if existing confidence < 0.8** — do NOT overwrite trusted high-confidence fields.
- When ontology deterministically derives a field (e.g., appellation "Pauillac" → region "Bordeaux", country "France"):
  - If field_confidence[field].confidence < 0.8 OR field is NULL: write with `value=derived, confidence=1.0, source="ontology"`.
  - If field_confidence[field].confidence ≥ 0.8: skip — trust the existing verified value.
- Autofill runs AFTER web verification (Phase 8) so it doesn't overwrite web-verified fields.

### D-05: Execution Scope
- Full phase: plan → execute → verify, end-to-end.

### Claude's Discretion
- Seeding order: wine_regions first (tree), then grape_varieties, then appellation_rules (FKs to both), then vintage_rules.
- Minimum seed targets per ROADMAP: ≥2,000 wine_regions rows, ≥400 grape_varieties, ≥100 appellation_rules.
- Cross-validation engine runs as a Celery task triggered post-haiku_tasks (same trigger pattern as web_verify_task).
- Table name conventions: snake_case, plural (wine_regions, grape_varieties, appellation_rules, vintage_rules).
- `ontology_validation` JSONB column added to `master_wine_library_submissions`.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Field confidence pattern (must replicate merge/routing logic)
- `services/agent-orchestrator/services/field_confidence.py` — merge_field_confidence, VISION_FIELDS, route_fields_by_threshold
- `services/agent-orchestrator/jobs/haiku_tasks.py` — trigger pattern for chaining tasks (Phase 9 cross-validation task wires here same way web_verify_task does)

### Existing review queue (CRITICAL failures must write here)
- `services/agent-orchestrator/api/quality_routes.py` — field_review_queue insert pattern
- `supabase/migrations/20260405000001_field_review_queue.sql` — field_review_queue schema

### Existing pipeline entry points
- `services/agent-orchestrator/jobs/web_verify_tasks.py` — trigger + dedup + budget pattern to copy for ontology_tasks.py

### Phase 9 research
- `.planning/phases/09-wine-ontology-taxonomy-cross-validation/09-RESEARCH.md` — standard stack, architecture patterns, pitfalls

### Project requirements
- `.planning/REQUIREMENTS.md` — ONTO-01 through ONTO-08

</canonical_refs>

<specifics>
## Specific Ideas

- Seed data for `wine_regions`: structured Claude Opus prompt to generate ISO-compliant region hierarchy; validate representative rows against open sources.
- ltree path format: dot-separated canonical names, lowercase, no spaces (e.g., `france.bordeaux.margaux`).
- Grape alias normalization: `grape_varieties.aliases TEXT[]` enables matching "Shiraz" → "Syrah" before cross-validation.
- Vintage rule edge case: NV (non-vintage) wines should pass vintage plausibility checks by default (no year to validate).
- Cross-validation Celery task name: `ontology.validate_wine`, mirrors `web_verify.verify_wine` naming convention.

</specifics>

<deferred>
## Deferred Ideas

- Full community contribution mechanism for ontology corrections — deferred to post-Phase 12.
- Appellation boundary GPS polygons — out of scope for v1.0.
- Multi-language appellation name matching (e.g., German/French for Alsace) — deferred, use aliases array instead.

</deferred>

---

*Phase: 09-wine-ontology-taxonomy-cross-validation*
*Context gathered: 2026-04-06 — user design decisions locked*

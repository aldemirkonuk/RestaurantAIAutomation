# Phase 5: Cost & Quality Guardrails — Context

**Gathered:** 2026-04-04
**Status:** Ready for planning

<domain>
## Phase Boundary

Add spend tracking for all API calls (Claude Vision, Claude Haiku, Gemini Flash) via a central
`SpendLogger` service. Enforce a monthly soft cap ($50 Claude / $20 Gemini) with hourly Celery beat
alerts at 80% threshold. Enforce a per-restaurant hard cap of $2.00 via pre-flight check before
extraction. Build a full human review + correction loop: `GET /api/v1/quality/review-queue` +
`PATCH /api/v1/quality/review-queue/{id}`. Introduce a two-tier quality gate:
completeness < 0.5 → `needs_review`, completeness < 0.3 → `auto_blocked` (wine held in submissions,
NOT promoted to `master_wine_library` until human approves). Track per-field acceptance rate from
corrections (QUAL-02).

</domain>

<decisions>
## Implementation Decisions

### Spend Logging (COST-01)
- **D-01:** Create a central `SpendLogger` service (`services/spend_logger.py`). All API-calling
  services invoke it after each API call: `SpendLogger.log(provider, model, input_tokens,
  output_tokens, cost_usd, restaurant_id=None)`. Single place for all Supabase `api_spend` inserts —
  no duplicated insert logic across files. Services covered: `claude_vision_extractor.py`,
  `haiku_enrichment_service.py`, `vlm_extraction_service.py` (Gemini).

### Monthly Cap Alerts (COST-02)
- **D-02:** Celery beat task runs **hourly**. Query: `SELECT SUM(cost_usd) FROM api_spend WHERE
  provider = X AND timestamp >= start_of_month`. If ≥ 80% of cap ($40 Claude / $16 Gemini), send
  email alert via `email_client.py` to `MANAGER_EMAIL`. Alert is **idempotent** — store last alerted
  month+threshold in a Supabase config row; do not re-alert until next calendar month.

### Per-Restaurant Cap (COST-03)
- **D-03:** Pre-flight cap check in `onboarding_routes.py` **before** calling the extractor.
  Query `api_spend` for cumulative spend for `restaurant_id` in current month. If sum + estimated
  cost of this request (page_count × $0.05/page) > $2.00, reject with HTTP 402 and send alert to
  `MANAGER_EMAIL`. No mid-extraction abort logic needed — simple, clean.

### Review Queue (QUAL-01 + QUAL-02)
- **D-04:** Full read + correct loop in a new `quality_routes.py`:
  - `GET /api/v1/quality/review-queue` — returns wines from `master_wine_library_submissions`
    where `needs_review = true` OR `auto_blocked = true`, ordered by completeness_score ASC (worst first).
  - `PATCH /api/v1/quality/review-queue/{submission_id}` — accepts corrected field values.
    On correction: update submission row, compute per-field delta vs extracted value, log to a
    `field_corrections` table (field_name, original_value, corrected_value, submission_id).
    If `auto_blocked = true` and correction raises completeness ≥ 0.5: unblock and promote to
    `master_wine_library`. Per-field acceptance rate is derived from `field_corrections`
    (fields never corrected = accepted; corrected = rejected for that extraction).

### Two-Tier Quality Gate (QUAL-01 + strict verification)
- **D-05:** Two completeness thresholds — no wine passes through silently:
  - `completeness < 0.5` → `needs_review = true` (already implemented in Phase 1; surfaced in queue)
  - `completeness < 0.3` → `auto_blocked = true` (new flag; wine stored in submissions but NOT
    promoted to `master_wine_library` automatically — requires human PATCH approval)
  - `completeness ≥ 0.5` → normal promotion path (no change from current behavior)
  This is a strict gate: the lower 30% of quality wines cannot enter the master library without
  human sign-off. Zero silent accepts.

### Claude's Discretion
- `api_spend` table schema column names (provider, model, input_tokens, output_tokens, cost_usd,
  restaurant_id, timestamp — follow REQUIREMENTS.md COST-01 spec exactly)
- `field_corrections` table schema (create migration; minimal: submission_id, field_name,
  original_value, corrected_value, corrected_at, corrected_by)
- `auto_blocked` column migration (add to `master_wine_library_submissions`)
- Alert deduplication storage (a single-row Supabase config or key-value table is fine)
- Celery beat schedule registration (follow existing celery_app.py pattern)
- Cost estimate for pre-flight check ($0.05/page × page_count is a safe upper bound)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Existing Services to Extend
- `services/agent-orchestrator/services/claude_vision_extractor.py` — Cost computation pattern
  (lines ~225–244); `needs_review` logic (lines ~232–237); `total_cost_usd` accumulation — SpendLogger
  call goes here after each page result
- `services/agent-orchestrator/services/haiku_enrichment_service.py` — Haiku API call; add
  SpendLogger.log() call after enrichment result (provider="anthropic", model="claude-haiku-4-5")
- `services/agent-orchestrator/services/vlm_extraction_service.py` — Gemini extraction; add
  SpendLogger.log() call after each Gemini API response (provider="google", model="gemini-2.5-flash")

### Integration Points
- `services/agent-orchestrator/api/onboarding_routes.py` — Pre-flight cap check goes here, before
  calling extractor. Also where `auto_blocked` flag should be set if completeness < 0.3.
- `services/agent-orchestrator/services/email_client.py` — Existing production email service
  (aiosmtplib + SMTP); use for monthly cap alert and per-restaurant cap alert
- `services/agent-orchestrator/jobs/celery_app.py` — Celery beat schedule configuration; add
  monthly cap check task here
- `services/agent-orchestrator/jobs/tasks.py` — Established task patterns (asyncio.run wrapper,
  naming convention) — follow for the new beat task

### Database
- `supabase/migrations/20260208024921_new-migration.sql` — `master_wine_library` schema (lines 65–95)
- `supabase/migrations/20260208030000_wine_specific_tables.sql` — `master_wine_library_submissions`
  schema — needs `auto_blocked BOOLEAN DEFAULT FALSE` column migration
- New migrations needed: `api_spend` table, `field_corrections` table, `auto_blocked` column

### Requirements (Authoritative Spec)
- `.planning/REQUIREMENTS.md` — COST-01, COST-02, COST-03, QUAL-01, QUAL-02
- `.planning/PROJECT.md` — Core Value constraint ($0.50/restaurant), Key Decisions table

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `email_client.py` — Full async email service (HTML + plain text, retry, delivery tracking).
  Already supports SMTP/SendGrid. Use `send_email(to=MANAGER_EMAIL, subject=..., body=...)`.
- `claude_vision_extractor.py` — `cost_usd` already computed inline; `needs_review` already set.
  SpendLogger just needs to receive these computed values.
- `jobs/celery_app.py` — `celery_app` instance + beat_schedule dict ready for new task registration.
- `config/settings.py` — `MANAGER_EMAIL` env var pattern already exists (check settings for exact attr name).

### Established Patterns
- Celery tasks: `@celery_app.task(name="resource.action")` + `asyncio.run()` wrapper
- Supabase inserts: `create_client(settings.supabase_url, settings.supabase_key).table(X).insert(Y).execute()`
- Background email: fire-and-forget via `asyncio.create_task()` or Celery task

### Integration Points
- Pre-flight cap check: `onboarding_routes.py` POST handler → query `api_spend` → reject or proceed
- Review queue router: new `quality_routes.py` registered in `main.py` at `/api/v1/quality`
- `auto_blocked` gate: set in onboarding route after extraction result assembled; prevents promotion

</code_context>

<specifics>
## Specific Requirements

- Monthly caps: **$50 Claude, $20 Gemini** (from REQUIREMENTS.md COST-02); alert at **80%** ($40 / $16)
- Per-restaurant cap: **$2.00** per extraction request (COST-03); HTTP 402 + email on breach
- Quality thresholds: `< 0.3` → `auto_blocked`, `< 0.5` → `needs_review` (both surfaced in review queue)
- Review queue ordered by `completeness_score ASC` — worst wines first for reviewers
- Correction loop: PATCH endpoint promotes `auto_blocked` wines to master library once completeness ≥ 0.5
  after correction
- Provider strings in `api_spend`: `"anthropic"` for Claude Vision + Haiku, `"google"` for Gemini

</specifics>

<deferred>
## Deferred Ideas

- Secondary AI verification pass (Haiku cross-checking suspicious fields like vintage out-of-range,
  noise wine names) — not needed with strict two-tier gate; revisit if acceptance rate data from
  QUAL-02 shows systematic extraction errors
- Human-gated persistence for ALL wines (not just < 0.3) — more rigorous but too slow for MVP;
  the < 0.3 hard block + < 0.5 review queue is the right balance for now
- Real-time spend dashboard — COST-01 monthly query is sufficient; dashboard is a v2 concern

</deferred>

---
*Phase: 05-cost-quality-guardrails*
*Context gathered: 2026-04-04 via discuss-phase*

---
phase: 05-cost-quality-guardrails
plan: 02
wave: 2
completed: 2026-04-05
---

# Plan 05-02 Summary — Wire SpendLogger + Monthly Cap Celery Task

## Accomplishments

- Wired `get_spend_logger().log()` into `claude_vision_extractor.py` (at cost_usd calculation site in `extract_page()`)
- Wired `get_spend_logger().log()` into `haiku_enrichment_service.py` (after Haiku API response, with cost calculation using 0.80/4.00 per-million pricing)
- Wired `get_spend_logger().log()` into `vlm_extraction_service.py` (after Gemini response, using `usage_metadata` token counts when available)
- Created `jobs/spend_tasks.py` with `monthly_cap_check_task` Celery task — hourly, idempotent (one alert per provider/month), sends Gmail SMTP alert email on breach
- Patched `jobs/celery_app.py`: added `"jobs.spend_tasks"` to imports + hourly beat schedule entry `"spend-monthly-cap-check"`

## Key decisions
- All spend logging wrapped in separate `try/except Exception: pass` blocks — spend failure can never interrupt extraction
- Gemini token counts via `getattr(response, "usage_metadata", None)` — graceful fallback to 0 if not available
- Monthly cap thresholds: Anthropic $40 (80% of $50 hard cap), Google $16 (80% of $20 hard cap)
- Idempotent via `spend_alert_state` upsert — one email per provider per calendar month

## Files Modified
- `services/agent-orchestrator/services/claude_vision_extractor.py` — import + log call in extract_page()
- `services/agent-orchestrator/services/haiku_enrichment_service.py` — import + log call in enrich()
- `services/agent-orchestrator/services/vlm_extraction_service.py` — import + log call in extract_from_image()
- `jobs/celery_app.py` — added spend_tasks import + beat schedule entry

## Files Created
- `services/agent-orchestrator/jobs/spend_tasks.py` — monthly_cap_check_task + helpers

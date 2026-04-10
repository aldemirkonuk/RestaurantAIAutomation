# Phase 7: Full-Field Extraction & Per-Field Confidence Framework - Discussion Log (Assumptions Mode)

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions captured in CONTEXT.md — this log preserves the analysis.

**Date:** 2026-04-05
**Phase:** 07-full-field-extraction-per-field-confidence-framework
**Mode:** assumptions (--auto)
**Areas analyzed:** Completeness-to-Confidence Migration, EXTRACTION_PROMPT Format, Haiku Enrichment Expansion, Field-Level Review Queue, Database Schema, Calibration Loop

## Assumptions Presented

### Completeness-to-Confidence Migration
| Assumption | Confidence | Evidence |
|------------|-----------|----------|
| Replace wine-level completeness_score with per-field field_confidence JSONB; keep completeness as derived summary metric | Likely | claude_vision_extractor.py compute_completeness() lines 132-141, quality_routes.py lines 72-78, onboarding_routes.py line 204 |

### EXTRACTION_PROMPT Output Format
| Assumption | Confidence | Evidence |
|------------|-----------|----------|
| Expanded prompt returns nested JSON with per-field {value, confidence, source} | Confident | Current flat format in EXTRACTION_PROMPT lines 48-66; ROADMAP Phase 7 explicitly shows nested format |

### Haiku Enrichment Persistence
| Assumption | Confidence | Evidence |
|------------|-----------|----------|
| Haiku writes per-field confidence into field_confidence JSONB, not flat columns | Confident | haiku_tasks.py lines 98-112 current flat pattern; FCONF-02/03 require confidence per field |

### Field-Level Review Queue
| Assumption | Confidence | Evidence |
|------------|-----------|----------|
| Dedicated field_review_queue table (one row per field) rather than application-layer filtering of field_confidence JSONB | Likely | quality_routes.py lines 85-146 current wine-level GET; FCONF-05 requires explicit field_review_queue table |

### Database Schema
| Assumption | Confidence | Evidence |
|------------|-----------|----------|
| 6 JSONB columns on master_wine_library; field_confidence on submissions; 3 new config/calibration tables | Confident | master_wine_library schema lines 65-91; ROADMAP specifies JSONB columns; FCONF-08/09/10 require specific tables |

### Calibration Loop
| Assumption | Confidence | Evidence |
|------------|-----------|----------|
| Daily Celery beat task reads field_corrections + resolved field_review_queue entries, adjusts confidence_thresholds | Confident | celery_app.py existing beat schedule pattern; FCONF-11 specifies daily calibration |

## Corrections Made

No corrections — all assumptions auto-confirmed (--auto mode).

## Auto-Resolved

- Completeness-to-Confidence Migration: auto-selected Alternative B (keep completeness as derived summary, route by field-level)
- Field-Level Review Queue: auto-selected Alternative A (dedicated table, one row per field)

## External Research

- Claude Vision structured output reliability: Deferred to planning phase — current evidence (9 flat fields at MAX_TOKENS=8192) is sufficient to proceed; E2E test in FCONF-12 will validate
- Celery Beat daily task pattern: No conflict expected — existing hourly task uses separate name/schedule; daily crontab coexists cleanly

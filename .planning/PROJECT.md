# WineOps AI — Hybrid Extraction Pipeline

## What This Is

WineOps AI is an autonomous restaurant wine inventory and procurement system. This milestone implements the **hybrid extraction pipeline**: Claude Vision handles user-facing onboarding extraction with maximum accuracy, Gemini Flash pre-seeds the library via background web crawling, YOLO 2-class provides real-time camera preview boxes, and Claude Haiku enriches genuinely new wine records.

## Core Value

A restaurant manager scans a menu — photo, PDF, or web — and every wine is correctly identified, enriched, and onboarded at < $0.50 total cost per restaurant.

## Requirements

### Validated

- ✓ PDF scanning pipeline (PyPDF2 + Surya OCR) — working, high confidence — Phase 1
- ✓ EasyOCR → Surya OCR swap in menu_analyzer_agent — Phase 1
- ✓ Image preprocessing for OCR (RGB normalize, upscale, contrast boost) — Phase 1
- ✓ 262 labeled images with Wine Entry + Section Header annotations — Phase 1
- ✓ YOLO 2-class best.pt trained (mAP50 0.34–0.44, sufficient for box preview) — Phase 1
- ✓ OCR baseline benchmark complete (0.8954 overall, 334 images) — Phase 1
- ✓ Architecture decision: Claude Vision as extraction brain — 2026-03-31

### Active

- [ ] Claude Vision extraction service: photo/scan → structured JSON (onboarding path)
- [ ] Gemini Flash web crawler: HTML/PDF → structured JSON (background pre-seeding)
- [ ] YOLO 2-class real-time camera preview: box drawing only, no extraction
- [ ] Claude Haiku enrichment: region/variety/bio for new wine records
- [ ] Onboarding flow E2E: manager uploads photo → wines in inventory in <10s
- [ ] Cost guardrails: per-extraction cost tracking + monthly spend cap enforcement

### Out of Scope

- 13-class YOLO training — retired (sub-field detection mAP50 0.04, not viable)
- Surya OCR as extraction engine — retired (Claude Vision reads text directly)
- EasyOCR — replaced, not revisited
- YOLO as extraction engine — retired (YOLO is UX preview only)
- Invoice OCR pipeline — separate pipeline, not this milestone
- Procurement/RFQ agents — unaffected

## Context

**Architecture pivot (2026-03-31):** After 3 weeks of YOLO training, 13-class detection proved fundamentally limited (sub-field boxes too small at imgsz=640, error compounding across YOLO→OCR→parser). Claude Vision categorically solves different failure modes (abbreviations, multi-line entries, creative layouts).

**Hybrid pipeline roles:**
- **Claude Vision** → onboarding extraction. User-facing. ~$0.009/page, ~$0.45/10-page menu. Accuracy-critical.
- **Gemini Flash** → background crawling. Cost-critical. 93-95% accuracy OK for pre-seeding.
- **YOLO 2-class** → real-time camera feed boxes. Fast visual feedback only. wine_entry + section_header.
- **Claude Haiku** → enrichment of genuinely new wines. Background. ~$0.01/wine.

**Existing services to build on:**
- `services/agent-orchestrator/services/vlm_extraction_service.py` — Gemini extraction (extend, not replace)
- `services/agent-orchestrator/services/web_crawler.py` — Playwright crawler (already exists)
- `services/agent-orchestrator/agents/menu_analyzer_agent.py` — YOLO + extraction orchestrator
- `services/agent-orchestrator/api/scan_routes.py` — API surface

**Cost validation:** Claude Vision benchmark run 2026-04-01 on 8 real Chicago restaurant menus. Results in `scripts/benchmark_results/`.

**YOLO 2-class state:** best.pt trained (mAP50 0.34–0.44). Sufficient for visual box preview. Located at `datasets/wine_menus_2class/runs/train2/weights/best.pt`.

## Constraints

- **Cost**: Claude Vision must stay < $0.50/menu (10-page average). Haiku enrichment < $0.01/wine.
- **Latency**: Onboarding extraction < 10s for a 10-page menu (parallel page processing).
- **Deployment**: Railway CPU-only. No GPU. YOLO must be 2-class only for inference speed.
- **API keys**: CLAUDE_API_KEY + GOOGLE_API_KEY both in .env — confirmed present.
- **Compatibility**: Must not break existing procurement/inventory/RFQ agents. Extraction is additive.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| EasyOCR → Surya OCR | CPU performance, proven in PDF path | ✓ Good |
| 13-class YOLO: retired | mAP50 0.04 on sub-fields; error compounding | ✓ Good |
| YOLO 2-class: UX preview only | wine_entry + section_header sufficient for box drawing | ✓ Good |
| Claude Vision: extraction brain | Categorically solves abbreviation/layout failures | — Pending validation |
| Gemini Flash: crawling brain | 10x cheaper than Claude Vision for bulk crawling | — Pending |
| Surya OCR: retired from extraction | Claude Vision reads text directly from images | ✓ Good |
| Claude Haiku: enrichment | $0.01/wine for background enrichment of new records | — Pending |

---
*Last updated: 2026-04-01 after architecture pivot from YOLO+Surya to hybrid Claude Vision pipeline*

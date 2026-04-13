# OCR Confidence Report — WineOps Menu Scanning Pipeline

**Generated:** 2026-03-31
**Phase:** 3 — Surya OCR Tuning
**Benchmark script:** `datasets/scripts/ocr_benchmark.py`
**Results JSON:** `datasets/ocr_benchmark_results.json`

---

## Baseline (No Preprocessing)

Mode: `baseline` — SuryaOCR called directly on raw annotation images with no preprocessing.

### Summary by Image Type

| Group       | Count | Avg Confidence | Min    | Max    |
|-------------|-------|----------------|--------|--------|
| Screenshots | 29    | 0.9111         | 0.7517 | 0.9858 |
| PDF pages   | 305   | 0.8939         | 0.0000 | 0.9901 |
| **Overall** | **334** | **0.8954**   | 0.0000 | 0.9901 |

### Confidence Distribution (all 334 images)

| Range    | Count | % |
|----------|-------|---|
| < 0.50   | 2     | 0.6% |
| 0.50–0.70 | 1    | 0.3% |
| 0.70–0.80 | 13   | 3.9% |
| 0.80–0.90 | 129  | 38.6% |
| ≥ 0.90   | 189   | 56.6% |

### Low-Confidence Outliers (< 0.70)

| File | Source Type | Confidence |
|------|-------------|------------|
| aba_Wine_Menu_p2.png | pdf_page | 0.0000 |
| aba_Wine_Menu_p7.png | pdf_page | 0.0000 |
| Kinzie_Chophouse_Wine_Menu_p16.png | pdf_page | 0.6871 |

The two `aba_Wine_Menu` pages return 0.0 confidence — Surya detected no text regions. These pages likely contain decorative/image-heavy layouts with minimal text density.

---

## Baseline vs Tuned Comparison

| Metric | Baseline | Tuned | Delta |
|--------|----------|-------|-------|
| Screenshots avg | 0.9111 | TBD | — |
| PDF pages avg | 0.8939 | TBD | — |
| Overall avg | 0.8954 | TBD | — |

Tuning results will be added after Phase 3 Wave 2 (`ocr_tune_preprocessing.py`).

**Rule:** Any preprocessing change that reduces average confidence for either group is reverted (per OCR-04).

---

## Notes

- Screenshots already achieve 0.9111 avg — above 0.90 baseline. Preprocessing may offer marginal gains.
- PDF pages at 0.8939 have more headroom for improvement; dark backgrounds and low-contrast scans are the likely weak points.
- The 3 images below 0.70 (0.9% of corpus) warrant investigation before declaring preprocessing complete.
- `menu_analyzer_agent.py` preprocessing pipeline (`_preprocess_for_ocr`: RGB normalize, 1200px upscale, 1.3× contrast) was designed for the screenshot path; its effect on PDF pages is not yet measured.

"""
OCR Benchmark Script — WineOps AI
Feeds all annotation images through SuryaOCRService with NO preprocessing (baseline mode).
Produces datasets/ocr_benchmark_results.json with per-image confidence scores and summary.

Usage:
    python datasets/scripts/ocr_benchmark.py [output_path] [mode]

    output_path  Optional path override for the results JSON.
                 Default: datasets/ocr_benchmark_results.json
    mode         Optional mode string written to JSON (e.g. "baseline", "tuned").
                 Default: "baseline"
"""

import sys
import json
import os
from pathlib import Path
from datetime import date

# --- sys.path injection: SuryaOCRService lives inside agent-orchestrator package ---
PROJECT_ROOT = Path(__file__).resolve().parents[2]  # Restaurant AI Automation/
AGENT_ROOT = PROJECT_ROOT / "services" / "agent-orchestrator"
sys.path.insert(0, str(AGENT_ROOT))

from services.pdf_extraction_service import SuryaOCRService
from PIL import Image

# ---------------------------------------------------------------------------
# Constants (overridable via CLI)
# ---------------------------------------------------------------------------
IMAGE_DIR = PROJECT_ROOT / "datasets" / "annotation_images"
_DEFAULT_OUTPUT = PROJECT_ROOT / "datasets" / "ocr_benchmark_results.json"


def classify_image(img_path: Path) -> str:
    """Return 'screenshot' or 'pdf_page' based on filename prefix."""
    return "screenshot" if img_path.name.startswith("Screenshot_") else "pdf_page"


def compute_group_stats(entries):
    """Compute count, avg_confidence, min, max for a list of result dicts."""
    valid = [e for e in entries if e["error"] is None]
    if not valid:
        return {"count": len(entries), "avg_confidence": 0.0, "min": 0.0, "max": 0.0}
    confidences = [e["confidence"] for e in valid]
    return {
        "count": len(entries),
        "avg_confidence": round(sum(confidences) / len(confidences), 4),
        "min": round(min(confidences), 4),
        "max": round(max(confidences), 4),
    }


def run_benchmark(output_path: Path, mode: str = "baseline") -> dict:
    """Run the full benchmark and return the output data dict."""
    # Discover images
    images = sorted(IMAGE_DIR.glob("*.png"))
    total = len(images)
    print(f"Found {total} images in {IMAGE_DIR}")

    if total == 0:
        raise RuntimeError(f"No PNG files found in {IMAGE_DIR}")

    # Initialize Surya OCR (lazy — models load on first read_image() call)
    print("Initializing SuryaOCRService... (first call loads models, ~30-60 s)")
    surya = SuryaOCRService()

    if not surya.is_available:
        raise RuntimeError(
            "SuryaOCR is not available. Install with: pip install surya-ocr"
        )

    results = []
    for img_path in images:
        source_type = classify_image(img_path)
        try:
            # Baseline mode: NO preprocessing — raw PIL open only
            pil_img = Image.open(img_path).convert("RGB")
            text, conf = surya.read_image(pil_img)
            word_count = len(text.split()) if text else 0
            results.append(
                {
                    "filename": img_path.name,
                    "source_type": source_type,
                    "confidence": round(conf, 4),
                    "word_count": word_count,
                    "error": None,
                }
            )
        except Exception as e:
            results.append(
                {
                    "filename": img_path.name,
                    "source_type": source_type,
                    "confidence": 0.0,
                    "word_count": 0,
                    "error": str(e),
                }
            )

        # Progress reporting every 10 images
        if len(results) % 10 == 0:
            print(f"  {len(results)}/{total} processed...")

    print(f"  {total}/{total} processed — OCR complete.")

    # --- Summary ---
    screenshots = [r for r in results if r["source_type"] == "screenshot"]
    pdf_pages = [r for r in results if r["source_type"] == "pdf_page"]
    all_valid = [r for r in results if r["error"] is None]

    overall_avg = (
        round(
            sum(r["confidence"] for r in all_valid) / len(all_valid), 4
        )
        if all_valid
        else 0.0
    )

    summary = {
        "screenshot": compute_group_stats(screenshots),
        "pdf_page": compute_group_stats(pdf_pages),
        "overall": {
            "count": total,
            "avg_confidence": overall_avg,
            "errors": sum(1 for r in results if r["error"] is not None),
        },
    }

    output_data = {
        "generated": str(date.today()),
        "mode": mode,
        "preprocessing": "none",
        "total_images": total,
        "results": results,
        "summary": summary,
    }

    # Write JSON
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(output_data, f, indent=2)

    print(f"\nResults written to: {output_path}")

    # One-line summary to stdout
    ss_avg = summary["screenshot"]["avg_confidence"]
    pp_avg = summary["pdf_page"]["avg_confidence"]
    print(
        f"Baseline complete: overall avg_confidence={overall_avg:.4f} "
        f"(screenshots={ss_avg:.4f}, pdf_pages={pp_avg:.4f})"
    )

    return output_data


if __name__ == "__main__":
    # Parse optional CLI arguments
    # argv[1] = output path override
    # argv[2] = mode string
    output_path = Path(sys.argv[1]) if len(sys.argv) > 1 else _DEFAULT_OUTPUT
    mode = sys.argv[2] if len(sys.argv) > 2 else "baseline"

    run_benchmark(output_path=output_path, mode=mode)

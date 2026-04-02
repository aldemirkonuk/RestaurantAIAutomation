"""
Haiku vs Sonnet Benchmark
=========================
Benchmarks claude-haiku-4-5-20251001 vs claude-sonnet-4-20250514 on Phase 1
annotation images to determine whether Haiku can match Sonnet's quality at
lower cost.

Usage:
    python scripts/benchmark_haiku_vs_sonnet.py            # live run
    python scripts/benchmark_haiku_vs_sonnet.py --dry-run  # validates setup only

Output:
    scripts/benchmark_results/haiku_vs_sonnet_results.json
"""

import argparse
import asyncio
import base64
import glob
import json
import os
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

# ---------------------------------------------------------------------------
# Try to import constants from the production extractor; fall back to inlined
# ---------------------------------------------------------------------------
try:
    _svc_path = Path(__file__).parent.parent / "services" / "agent-orchestrator" / "services"
    sys.path.insert(0, str(_svc_path))
    from claude_vision_extractor import EXTRACTION_PROMPT, COMPLETENESS_FIELDS  # noqa: E402
    print("[INFO] Imported EXTRACTION_PROMPT and COMPLETENESS_FIELDS from production extractor.")
except ImportError:
    print("[WARN] Could not import from claude_vision_extractor — using inlined constants.")
    COMPLETENESS_FIELDS = ["wine_name", "vintage", "price_bottle", "region", "country", "section_name"]
    EXTRACTION_PROMPT = """You are a wine menu extraction expert. Extract ALL wines from this menu image into structured JSON.

For each wine, extract these fields:
- wine_name: Full name of the wine (producer + cuvée)
- vintage: Year as integer (null if NV or not shown)
- price_bottle: Bottle price as float (null if not shown)
- price_glass: Glass price as float (null if not shown)
- region: Wine region (e.g., "Bordeaux", "Napa Valley")
- country: Country of origin
- grape_variety: Grape/blend if stated
- section_name: The section/category this wine appears under
- bin_number: Bin/item number if shown

Return ONLY valid JSON in this exact format:
{
  "wines": [...],
  "page_notes": "brief note about this page",
  "total_wines_extracted": 0
}"""

# ---------------------------------------------------------------------------
# Model configurations
# ---------------------------------------------------------------------------
MODELS = [
    {
        "id": "claude-sonnet-4-20250514",
        "label": "sonnet",
        "price_input_per_m": 3.0,
        "price_output_per_m": 15.0,
    },
    {
        "id": "claude-haiku-4-5-20251001",
        "label": "haiku",
        "price_input_per_m": 0.80,
        "price_output_per_m": 4.00,
    },
]

MAX_IMAGES = 10
MAX_TOKENS = 4096
SEMAPHORE_LIMIT = 3

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def load_api_key() -> str:
    """Load Anthropic API key from environment. Fails fast if missing."""
    # The project uses CLAUDE_API_KEY (not ANTHROPIC_API_KEY) per claude_vision_extractor.py
    key = os.getenv("ANTHROPIC_API_KEY") or os.getenv("CLAUDE_API_KEY")
    if not key:
        print("ERROR: Neither ANTHROPIC_API_KEY nor CLAUDE_API_KEY is set in the environment.")
        print("  Set one of them before running this benchmark.")
        sys.exit(1)
    return key


def find_images(base_dir: str) -> List[str]:
    """Return sorted list of first MAX_IMAGES .png images from annotation_images/."""
    pattern = os.path.join(base_dir, "datasets", "annotation_images", "*.png")
    images = sorted(glob.glob(pattern))[:MAX_IMAGES]
    return images


def encode_image(path: str) -> str:
    """Base64-encode an image file."""
    with open(path, "rb") as f:
        return base64.b64encode(f.read()).decode("utf-8")


def parse_json_response(raw_text: str) -> Tuple[dict, bool]:
    """
    Multi-strategy JSON extractor. Returns (parsed_dict, parse_error_bool).
    Handles markdown fences and partial JSON.
    """
    for pattern in [r"```json\s*([\s\S]*?)```", r"```\s*([\s\S]*?)```"]:
        m = re.search(pattern, raw_text)
        if m:
            try:
                return json.loads(m.group(1).strip()), False
            except json.JSONDecodeError:
                pass
    m = re.search(r"\{[\s\S]*\}", raw_text)
    if m:
        try:
            return json.loads(m.group(0)), False
        except json.JSONDecodeError:
            pass
    try:
        return json.loads(raw_text.strip()), False
    except json.JSONDecodeError:
        return {"wines": [], "parse_error": True}, True


def compute_wine_completeness(wine: dict) -> float:
    """Returns 0.0–1.0 completeness for one wine over COMPLETENESS_FIELDS."""
    filled = sum(
        1 for f in COMPLETENESS_FIELDS
        if wine.get(f) is not None and wine.get(f) != ""
    )
    return round(filled / len(COMPLETENESS_FIELDS), 4)


def compute_page_completeness(wines: List[dict]) -> float:
    """Average completeness across all wines on a page. 0.0 if no wines."""
    if not wines:
        return 0.0
    return round(sum(compute_wine_completeness(w) for w in wines) / len(wines), 4)


def compute_per_field_rates(per_image_results: List[dict]) -> Dict[str, float]:
    """Aggregate per-field fill rates across all images and wines."""
    counts = {f: 0 for f in COMPLETENESS_FIELDS}
    total_wines = 0
    for img in per_image_results:
        for wine in img.get("wines", []):
            total_wines += 1
            for f in COMPLETENESS_FIELDS:
                if wine.get(f) is not None and wine.get(f) != "":
                    counts[f] += 1
    if total_wines == 0:
        return {f: 0.0 for f in COMPLETENESS_FIELDS}
    return {f: round(counts[f] / total_wines, 4) for f in COMPLETENESS_FIELDS}


def aggregate_results(per_image: List[dict], model_cfg: dict) -> dict:
    """Compute aggregate stats from per-image results."""
    completeness_scores = [r["field_completeness"] for r in per_image]
    latencies = sorted([r["latency_ms"] for r in per_image])
    total_cost = sum(r["cost_usd"] for r in per_image)
    parse_errors = sum(1 for r in per_image if r.get("parse_error"))
    wines_per_page = [len(r.get("wines", [])) for r in per_image]

    n = len(latencies)
    p50_idx = int(n * 0.50)
    p95_idx = min(int(n * 0.95), n - 1)

    return {
        "avg_field_completeness": round(sum(completeness_scores) / len(completeness_scores), 4) if completeness_scores else 0.0,
        "p50_latency_ms": round(latencies[p50_idx]) if latencies else 0,
        "p95_latency_ms": round(latencies[p95_idx]) if latencies else 0,
        "total_cost_usd": round(total_cost, 6),
        "parse_error_count": parse_errors,
        "avg_wines_extracted": round(sum(wines_per_page) / len(wines_per_page), 2) if wines_per_page else 0.0,
        "per_field_rates": compute_per_field_rates(per_image),
    }


# ---------------------------------------------------------------------------
# Async benchmark core
# ---------------------------------------------------------------------------

async def benchmark_image(
    client: Any,
    model_cfg: dict,
    image_path: str,
    semaphore: asyncio.Semaphore,
) -> dict:
    """Call Claude API for a single image. Returns structured result dict."""
    b64 = encode_image(image_path)
    image_name = os.path.basename(image_path)

    async with semaphore:
        t0 = time.monotonic()
        try:
            response = await client.messages.create(
                model=model_cfg["id"],
                max_tokens=MAX_TOKENS,
                messages=[{
                    "role": "user",
                    "content": [
                        {
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": "image/png",
                                "data": b64,
                            },
                        },
                        {"type": "text", "text": EXTRACTION_PROMPT},
                    ],
                }],
            )
            latency_ms = round((time.monotonic() - t0) * 1000)
        except Exception as e:
            latency_ms = round((time.monotonic() - t0) * 1000)
            return {
                "image": image_name,
                "parse_error": True,
                "api_error": str(e),
                "latency_ms": latency_ms,
                "input_tokens": 0,
                "output_tokens": 0,
                "cost_usd": 0.0,
                "field_completeness": 0.0,
                "wines": [],
            }

    raw_text = response.content[0].text
    parsed, parse_error = parse_json_response(raw_text)

    input_tokens = response.usage.input_tokens
    output_tokens = response.usage.output_tokens
    cost_usd = (
        input_tokens * model_cfg["price_input_per_m"] / 1_000_000
        + output_tokens * model_cfg["price_output_per_m"] / 1_000_000
    )

    wines = parsed.get("wines", []) if not parse_error else []
    field_completeness = compute_page_completeness(wines)

    return {
        "image": image_name,
        "parse_error": parse_error,
        "latency_ms": latency_ms,
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "cost_usd": round(cost_usd, 6),
        "field_completeness": field_completeness,
        "wines_extracted": len(wines),
        "wines": wines,
    }


async def run_model_benchmark(
    client: Any,
    model_cfg: dict,
    image_paths: List[str],
) -> dict:
    """Run benchmark for one model across all images."""
    semaphore = asyncio.Semaphore(SEMAPHORE_LIMIT)
    print(f"\n[{model_cfg['label'].upper()}] Starting benchmark on {len(image_paths)} images...")

    tasks = [
        benchmark_image(client, model_cfg, path, semaphore)
        for path in image_paths
    ]
    per_image = await asyncio.gather(*tasks)

    # Log progress
    for r in per_image:
        status = "ERROR" if r.get("parse_error") else "OK"
        print(f"  [{model_cfg['label']}] {r['image']}: {status} | {r['latency_ms']}ms | "
              f"completeness={r['field_completeness']:.2f} | wines={r.get('wines_extracted', 0)} | "
              f"cost=${r['cost_usd']:.4f}")

    agg = aggregate_results(list(per_image), model_cfg)
    return {"per_image": list(per_image), "aggregate": agg}


async def run_benchmark(image_paths: List[str], api_key: str) -> dict:
    """Run benchmark for all models and return combined results."""
    import anthropic as anthropic_lib
    client = anthropic_lib.AsyncAnthropic(api_key=api_key)

    results = {}
    for model_cfg in MODELS:
        results[model_cfg["label"]] = await run_model_benchmark(client, model_cfg, image_paths)

    return results


# ---------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------

def print_summary_table(model_results: dict) -> None:
    """Print a formatted summary table to stdout."""
    header = f"{'Model':<10} | {'Avg Completeness':>18} | {'p50 Latency':>12} | {'p95 Latency':>12} | {'Total Cost':>11}"
    separator = "-" * len(header)
    print(f"\n{separator}")
    print(header)
    print(separator)
    for label, data in model_results.items():
        agg = data["aggregate"]
        model_id = next(m["id"] for m in MODELS if m["label"] == label)
        print(
            f"{label:<10} | {agg['avg_field_completeness']:>18.4f} | "
            f"{agg['p50_latency_ms']:>10}ms | {agg['p95_latency_ms']:>10}ms | "
            f"${agg['total_cost_usd']:>10.4f}"
        )
    print(separator)


def write_results(output_path: str, run_at: str, images_tested: int, model_results: dict) -> None:
    """Write raw results JSON to disk."""
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    payload = {
        "run_at": run_at,
        "images_tested": images_tested,
        "models": model_results,
    }
    with open(output_path, "w") as f:
        json.dump(payload, f, indent=2)
    print(f"\n[INFO] Results written to {output_path}")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description="Benchmark Haiku vs Sonnet on wine menu images.")
    parser.add_argument("--dry-run", action="store_true", help="Validate setup without calling the API.")
    args = parser.parse_args()

    # Resolve project root relative to this script
    project_root = str(Path(__file__).parent.parent)
    image_paths = find_images(project_root)

    if not image_paths:
        print(f"ERROR: No .png images found in {project_root}/datasets/annotation_images/")
        sys.exit(1)

    print(f"[INFO] Found {len(image_paths)} images (capped at {MAX_IMAGES}):")
    for p in image_paths:
        print(f"  {os.path.basename(p)}")

    if args.dry_run:
        print("\nDRY RUN OK")
        return

    api_key = load_api_key()
    run_at = datetime.now(timezone.utc).isoformat()

    model_results = asyncio.run(run_benchmark(image_paths, api_key))

    print_summary_table(model_results)

    output_path = os.path.join(project_root, "scripts", "benchmark_results", "haiku_vs_sonnet_results.json")
    write_results(output_path, run_at, len(image_paths), model_results)


if __name__ == "__main__":
    main()

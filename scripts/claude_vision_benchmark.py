#!/usr/bin/env python3
"""
Claude Vision Wine Menu Extraction Benchmark
=============================================
Tests Claude Vision's ability to extract structured wine data from menu images.
Validates the architecture decision: Claude Vision as the extraction brain.

Fixes vs v1:
- max_tokens 4096 → 8192: dense pages (RL p9, AVEC p2) truncated mid-JSON at 4096
- asyncio.gather: parallel page processing, ~6s for 10 pages instead of 25s/page
- Robust JSON extraction: regex fallback after code-block parsing
- raw_text passed through in return for debugging parse failures
"""

import anthropic
import asyncio
import base64
import json
import os
import re
import sys
import time
from pathlib import Path
from datetime import datetime

# Config
PROJECT_ROOT = Path(__file__).parent.parent
TEST_IMAGES_DIR = PROJECT_ROOT / "datasets" / "wine_menus" / "images" / "test"
RESULTS_DIR = PROJECT_ROOT / "scripts" / "benchmark_results"
RESULTS_DIR.mkdir(exist_ok=True)

from dotenv import load_dotenv
load_dotenv(PROJECT_ROOT / ".env")
API_KEY = os.getenv("CLAUDE_API_KEY")
if not API_KEY:
    print("ERROR: CLAUDE_API_KEY not found in .env")
    sys.exit(1)

BENCHMARK_IMAGES = [
    "Fioretta_Wine_Menu_December2025_p1.png",
    "Kinzie_Chophouse_Wine_Menu_p6.png",
    "RL_Restaurant_Wine_Menu_p9.png",
    "Rose_Mary_Wine_List_02_18_2026_p6.png",
    "Theodora_Wine_List_December2025_02_18_2026_p3.png",
    "Roka_Chicago_Beverage_Menu_29August2025_p3.png",
    "Obelix_Chicago_Wine_Menu_p6.png",
    "AVEC_West_Loop_Wine_Bev_List_02_18_2026_p2.png",
]

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


def encode_image(image_path: Path) -> str:
    with open(image_path, "rb") as f:
        return base64.standard_b64encode(f.read()).decode("utf-8")


def get_media_type(filename: str) -> str:
    ext = filename.lower().split(".")[-1]
    return {"png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg"}.get(ext, "image/png")


def parse_json_response(raw_text: str) -> tuple[dict, bool]:
    """
    Robustly extract JSON from Claude's response.
    Returns (parsed_dict, parse_error).

    Strategy:
    1. Strip ```json ... ``` code block
    2. Strip ``` ... ``` code block
    3. Regex: find outermost {...} object
    4. Raw strip as last resort
    """
    # Strategy 1 & 2: code block
    for pattern in [r"```json\s*([\s\S]*?)```", r"```\s*([\s\S]*?)```"]:
        m = re.search(pattern, raw_text)
        if m:
            try:
                return json.loads(m.group(1).strip()), False
            except json.JSONDecodeError:
                pass

    # Strategy 3: find outermost { ... }
    m = re.search(r"\{[\s\S]*\}", raw_text)
    if m:
        try:
            return json.loads(m.group(0)), False
        except json.JSONDecodeError:
            pass

    # Strategy 4: raw
    try:
        return json.loads(raw_text.strip()), False
    except json.JSONDecodeError:
        return {"wines": [], "parse_error": True, "raw_text_snippet": raw_text[:300]}, True


async def extract_wines_async(client: anthropic.AsyncAnthropic, image_path: Path, idx: int, total: int) -> dict:
    """Send one image to Claude Vision asynchronously."""
    b64_data = encode_image(image_path)
    media_type = get_media_type(image_path.name)

    start = time.time()
    response = await client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=8192,  # FIX: was 4096 — dense pages like RL p9 need more room
        messages=[{
            "role": "user",
            "content": [
                {"type": "image", "source": {"type": "base64", "media_type": media_type, "data": b64_data}},
                {"type": "text", "text": EXTRACTION_PROMPT},
            ]
        }]
    )
    elapsed = time.time() - start

    raw_text = response.content[0].text
    parsed, parse_error = parse_json_response(raw_text)

    input_tokens = response.usage.input_tokens
    output_tokens = response.usage.output_tokens
    cost = (input_tokens * 3.0 / 1_000_000) + (output_tokens * 15.0 / 1_000_000)

    return {
        "image": image_path.name,
        "wines": parsed.get("wines", []),
        "total_wines": len(parsed.get("wines", [])),
        "page_notes": parsed.get("page_notes", ""),
        "latency_seconds": round(elapsed, 2),
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "output_tokens_hit_limit": output_tokens >= 8100,
        "cost_usd": round(cost, 6),
        "parse_error": parse_error,
        "raw_text_snippet": parsed.get("raw_text_snippet", "") if parse_error else "",
    }


def compute_quality_metrics(result: dict) -> dict:
    wines = result["wines"]
    if not wines:
        return {"field_completeness": 0, "has_prices": False, "has_vintages": False,
                "has_regions": False, "has_sections": False,
                "wines_with_name": 0, "wines_with_price": 0, "wines_with_vintage": 0}

    fields = ["wine_name", "vintage", "price_bottle", "region", "country", "section_name"]
    total_fields = len(wines) * len(fields)
    filled = sum(1 for w in wines for f in fields if w.get(f) is not None and w.get(f) != "")

    return {
        "field_completeness": round(filled / total_fields, 3) if total_fields > 0 else 0,
        "has_prices": any(w.get("price_bottle") or w.get("price_glass") for w in wines),
        "has_vintages": any(w.get("vintage") for w in wines),
        "has_regions": any(w.get("region") for w in wines),
        "has_sections": any(w.get("section_name") for w in wines),
        "wines_with_name": sum(1 for w in wines if w.get("wine_name")),
        "wines_with_price": sum(1 for w in wines if w.get("price_bottle") or w.get("price_glass")),
        "wines_with_vintage": sum(1 for w in wines if w.get("vintage")),
    }


async def run_benchmark():
    print("=" * 70)
    print("  CLAUDE VISION WINE MENU EXTRACTION BENCHMARK  [v2 — parallel]")
    print(f"  Date: {datetime.now().strftime('%Y-%m-%d %H:%M')}")
    print(f"  Model: claude-sonnet-4-20250514  |  max_tokens: 8192")
    print(f"  Mode: parallel asyncio ({len(BENCHMARK_IMAGES)} images simultaneously)")
    print("=" * 70)

    client = anthropic.AsyncAnthropic(api_key=API_KEY)

    available = [TEST_IMAGES_DIR / n for n in BENCHMARK_IMAGES if (TEST_IMAGES_DIR / n).exists()]
    skipped = [n for n in BENCHMARK_IMAGES if not (TEST_IMAGES_DIR / n).exists()]
    for s in skipped:
        print(f"  SKIP: {s} (not found)")

    if not available:
        print("ERROR: No test images found!")
        sys.exit(1)

    print(f"\n  Launching {len(available)} extractions in parallel...\n")
    wall_start = time.time()

    # FIX: parallel asyncio.gather — all images fire simultaneously
    tasks = [extract_wines_async(client, img, i, len(available)) for i, img in enumerate(available, 1)]
    results_raw = await asyncio.gather(*tasks, return_exceptions=True)
    wall_elapsed = time.time() - wall_start

    all_results = []
    for img_path, result in zip(available, results_raw):
        if isinstance(result, Exception):
            print(f"  FAILED {img_path.name}: {result}")
            all_results.append({"image": img_path.name, "error": str(result), "wines": [], "total_wines": 0})
        else:
            quality = compute_quality_metrics(result)
            result["quality"] = quality
            all_results.append(result)
            status = "PARSE_ERR" if result["parse_error"] else ("TOKEN_LIMIT" if result["output_tokens_hit_limit"] else "OK")
            print(f"  {result['image'][:50]:<50} {status:<10} {result['total_wines']:>3} wines  {result['latency_seconds']:>5.1f}s  ${result['cost_usd']:.4f}  {quality['field_completeness']:.0%}")

    print(f"\n  Wall time (parallel): {wall_elapsed:.1f}s  (vs ~{sum(r.get('latency_seconds',0) for r in all_results if 'error' not in r):.0f}s sequential)")

    successful = [r for r in all_results if "error" not in r and not r.get("parse_error")]
    total_cost = sum(r.get("cost_usd", 0) for r in all_results if "error" not in r)
    total_wines = sum(r.get("total_wines", 0) for r in all_results)
    avg_completeness = sum(r["quality"]["field_completeness"] for r in successful) / len(successful) if successful else 0

    print("\n" + "=" * 70)
    print("  BENCHMARK RESULTS SUMMARY")
    print("=" * 70)
    print(f"  Images processed:          {len(available)}")
    print(f"  Successful (no errors):    {len(successful)}/{len(available)}")
    print(f"  Total wines extracted:     {total_wines}")
    print(f"  Avg wines/page:            {total_wines / len(available):.1f}")
    print(f"  Wall time (parallel):      {wall_elapsed:.1f}s")
    print(f"  Total cost:                ${total_cost:.4f}")
    print(f"  Avg cost/page:             ${total_cost / len(available):.4f}")
    print(f"  Avg field completeness:    {avg_completeness:.0%}")
    print(f"  Projected cost/10-pg menu: ${total_cost / len(available) * 10:.3f}")
    print("=" * 70)

    # Flag any remaining issues
    for r in all_results:
        if r.get("parse_error"):
            print(f"  PARSE_ERR: {r['image']} — snippet: {r.get('raw_text_snippet', '')[:120]}")
        if r.get("output_tokens_hit_limit"):
            print(f"  TOKEN_LIMIT: {r['image']} hit 8192 output tokens — may be truncated")

    output_path = RESULTS_DIR / f"benchmark_v2_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    with open(output_path, "w") as f:
        json.dump({
            "meta": {"date": datetime.now().isoformat(), "model": "claude-sonnet-4-20250514",
                     "max_tokens": 8192, "mode": "parallel_async",
                     "images_tested": len(available), "successful": len(successful)},
            "summary": {
                "total_wines": total_wines,
                "avg_wines_per_page": round(total_wines / len(available), 1),
                "wall_time_seconds": round(wall_elapsed, 2),
                "total_cost_usd": round(total_cost, 6),
                "avg_cost_per_page": round(total_cost / len(available), 6),
                "avg_field_completeness": round(avg_completeness, 3),
                "projected_cost_per_menu_10pg": round(total_cost / len(available) * 10, 4),
            },
            "results": all_results,
        }, f, indent=2, default=str)
    print(f"\n  Results saved: {output_path}")

    # Sample extraction
    wine_pages = [r for r in successful if r["total_wines"] > 0]
    if wine_pages:
        sample = wine_pages[0]
        print(f"\n  SAMPLE ({sample['image']}):")
        for w in sample["wines"][:3]:
            print(f"    {w.get('wine_name','?')} | {w.get('vintage','NV')} | ${w.get('price_bottle','?')} | {w.get('region','?')}")
        if len(sample["wines"]) > 3:
            print(f"    ... +{len(sample['wines'])-3} more")
    print()


if __name__ == "__main__":
    asyncio.run(run_benchmark())

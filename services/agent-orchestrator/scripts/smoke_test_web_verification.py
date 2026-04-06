"""
Smoke test: Phase 8 Web Search Verification Pipeline (no Celery, no DB, no mocks)
==================================================================================
Tests the live end-to-end flow:
  1. Serper API → organic search results for a known wine
  2. Gemini 2.5 Flash → WineVerificationResult (structured extraction)
  3. check_concordance() → per-field verdict against hardcoded field_confidence

Run from services/agent-orchestrator/:
    export SERPER_API_KEY=...
    export GOOGLE_API_KEY=...
    python scripts/smoke_test_web_verification.py
"""

import sys
import pathlib

# Allow running as: python scripts/smoke_test_web_verification.py
# from the services/agent-orchestrator/ directory.
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

import os

serper_key = os.environ.get("SERPER_API_KEY")
google_key = os.environ.get("GOOGLE_API_KEY")
missing = [k for k, v in [("SERPER_API_KEY", serper_key), ("GOOGLE_API_KEY", google_key)] if not v]
if missing:
    print(f"ERROR: Missing required env vars: {', '.join(missing)}")
    print("Set them and retry: export SERPER_API_KEY=... GOOGLE_API_KEY=...")
    sys.exit(1)

import asyncio
import json
import logging

logging.basicConfig(level=logging.WARNING)  # suppress debug noise from tenacity/httpx

WINE_NAME = "Chateau Margaux 2015"
PRODUCER = "Chateau Margaux"
VINTAGE = "2015"
QUERY = f"{WINE_NAME} wine producer region grape variety"

# Simulated existing field_confidence from a haiku_enrichment step.
# Intentionally mix correct (region, country, color) and one slightly off
# (grape_variety uses "Cabernet Sauvignon" — web may return "Cabernet Sauvignon blend")
# so we see real "concordance" AND possibly "contradiction" outputs.
EXISTING_FC = {
    "region":        {"value": "Bordeaux",           "confidence": 0.85, "source": "haiku_enrichment"},
    "country":       {"value": "France",             "confidence": 0.90, "source": "haiku_enrichment"},
    "color":         {"value": "red",                "confidence": 0.88, "source": "haiku_enrichment"},
    "grape_variety": {"value": "Cabernet Sauvignon", "confidence": 0.80, "source": "haiku_enrichment"},
    "sub_region":    {"value": "Margaux",            "confidence": 0.75, "source": "haiku_enrichment"},
    "primary_type":  {"value": "red",                "confidence": 0.85, "source": "haiku_enrichment"},
}


async def main():
    from services.serper_client import serper_search
    from services.web_verification_service import (
        WineVerificationResult, parse_search_results, check_concordance
    )

    # --- Step 1: Live Serper search ---
    print(f"\n{'='*60}")
    print(f"STEP 1: Serper search — query: {QUERY!r}")
    print('='*60)
    results = await serper_search(QUERY, num_results=5, api_key=serper_key)
    if not results:
        print("ERROR: Serper returned 0 results. Check SERPER_API_KEY and quota.")
        sys.exit(1)
    print(f"  Got {len(results)} organic results:")
    for r in results:
        print(f"  [{r['position']}] {r['title']}")
        print(f"       {r['link']}")
        print(f"       {r['snippet'][:120]}...")

    # --- Step 2: Live Gemini 2.5 Flash parsing ---
    print(f"\n{'='*60}")
    print("STEP 2: Gemini 2.5 Flash — structured extraction")
    print('='*60)
    # Override google_api_key in settings before calling parse_search_results.
    # get_settings() is lru_cache'd — set the env var so the cached instance picks it up.
    os.environ["GOOGLE_API_KEY"] = google_key  # already set but ensure it propagates
    from config.settings import get_settings
    get_settings.cache_clear()  # clear lru_cache so new env var is picked up

    snippets = [{"title": r["title"], "link": r["link"], "snippet": r["snippet"]} for r in results]
    verification: WineVerificationResult | None = await parse_search_results(
        snippets=snippets,
        wine_name=WINE_NAME,
        producer=PRODUCER,
        vintage=VINTAGE,
    )
    if verification is None:
        print("ERROR: Gemini returned None. Check GOOGLE_API_KEY and model availability.")
        sys.exit(1)

    non_null = {k: v for k, v in verification.model_dump().items() if v is not None}
    print(f"  WineVerificationResult ({len(non_null)} non-null fields):")
    print(json.dumps(non_null, indent=2, default=str))

    # --- Step 3: Concordance check ---
    print(f"\n{'='*60}")
    print("STEP 3: Concordance check against hardcoded field_confidence")
    print('='*60)
    print(f"  Existing FC fields: {list(EXISTING_FC.keys())}")

    # Checkable fields: those present in BOTH the WineVerificationResult and EXISTING_FC
    checkable_fields = [
        f for f in ["region", "country", "color", "grape_variety", "sub_region",
                    "primary_type", "appellation", "sweetness_level"]
        if getattr(verification, f, None) is not None
    ]
    print(f"  Web fields to check: {checkable_fields}\n")

    for field in checkable_fields:
        web_val = getattr(verification, field)
        existing_entry = EXISTING_FC.get(field, {})
        verdict = check_concordance(field, existing_entry, web_val)
        status_icon = {"concordance": "✅", "contradiction": "⚠️ ", "new_data": "➕"}.get(verdict, "?")
        existing_val = existing_entry.get("value", "<missing>")
        print(f"  {status_icon} {field}: existing={existing_val!r}  web={web_val!r}  → {verdict.upper()}")

    print(f"\n{'='*60}")
    print("SMOKE TEST COMPLETE — both APIs responded successfully.")
    print("  • UAT item 1 (Live Serper): PASS")
    print("  • UAT item 2 (Live Gemini 2.5 Flash): PASS")
    print('='*60)


asyncio.run(main())

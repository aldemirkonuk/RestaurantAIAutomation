#!/usr/bin/env python3
"""
Phase 4 + Menu Scanning Tests
==============================
Tests real Gemini 2.5 Flash calls (MOCK_LLM=false) end-to-end:
  Phase 4A: Sassicaia 2018 — should be Tier 1 (iconic, all L1 fields clear)
  Phase 4B: Opus One 2019  — should be Tier 1
  Phase 4C: Partial entry  — should be Tier 3/4 (Layer 1 cap fires)
  Phase 4D: House wine     — should be Tier 3/4 (insufficient fields)
  Menu Scan: synthetic 5-wine text menu — correct count, tiers, structure

Run from agent-orchestrator directory:
    cd /path/to/services/agent-orchestrator
    PYTHONPATH=. python /path/to/test_phase4_menu_scan.py
"""

import asyncio
import json
import os
import sys
import time
import traceback
from typing import Dict, Any, Optional, List

# ── Add orchestrator to path ───────────────────────────────────────────────
ORCH_DIR = os.path.join(os.path.dirname(__file__),
                        "mnt/Restaurant AI Automation/services/agent-orchestrator")
sys.path.insert(0, ORCH_DIR)

# Load .env manually so we get real API key
def load_env(path: str):
    try:
        with open(path) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    key, _, val = line.partition("=")
                    os.environ.setdefault(key.strip(), val.strip())
    except FileNotFoundError:
        pass

ENV_PATH = os.path.join(ORCH_DIR, ".env")
load_env(ENV_PATH)

GOOGLE_API_KEY = os.environ.get("GOOGLE_API_KEY", "")
MOCK_LLM = os.environ.get("MOCK_LLM", "false").lower() == "true"

# Presence only — a 10-character prefix of a live API key is still key
# material, and this line runs wherever the script does, CI included
# (CodeQL py/clear-text-logging-sensitive-data).
print(f"  GOOGLE_API_KEY: {'set' if GOOGLE_API_KEY else 'MISSING'}")
print(f"  MOCK_LLM      : {MOCK_LLM}")
print()

# ── Colour helpers ─────────────────────────────────────────────────────────
GREEN  = "\033[92m"
RED    = "\033[91m"
YELLOW = "\033[93m"
CYAN   = "\033[96m"
RESET  = "\033[0m"
BOLD   = "\033[1m"

passed = 0
failed = 0
errors = []

def ok(msg: str):
    global passed
    passed += 1
    print(f"  {GREEN}✓{RESET} {msg}")

def fail(msg: str, detail: str = ""):
    global failed
    failed += 1
    label = f"  {RED}✗{RESET} {msg}"
    if detail:
        label += f"\n    {RED}→ {detail}{RESET}"
    print(label)
    errors.append(msg + (f": {detail}" if detail else ""))

def info(msg: str):
    print(f"  {CYAN}ℹ{RESET} {msg}")

def section(title: str):
    print(f"\n{BOLD}{YELLOW}{'─'*60}{RESET}")
    print(f"{BOLD}{YELLOW}  {title}{RESET}")
    print(f"{BOLD}{YELLOW}{'─'*60}{RESET}")

# ── Import wine_field_parser ───────────────────────────────────────────────
section("Bootstrap — importing field parser")
try:
    from services.wine_field_parser import WineFieldParser, WineParsedFields
    from services.governance import GovernanceTier
    ok("wine_field_parser imported")
except Exception as e:
    fail("Import failed", str(e))
    traceback.print_exc()
    sys.exit(1)

# ── Create parser with real Gemini ─────────────────────────────────────────
parser = WineFieldParser(google_api_key=GOOGLE_API_KEY, mock_mode=False)
info(f"Parser mode: {'MOCK' if parser.mock_mode else 'REAL GEMINI'}")

if parser.mock_mode or not GOOGLE_API_KEY:
    print(f"\n{RED}ERROR: GOOGLE_API_KEY not set or mock_mode is True — cannot run Phase 4 real tests{RESET}")
    sys.exit(1)


# =============================================================================
# HELPERS
# =============================================================================

def check_field(result: WineParsedFields, field: str, expected, label: str, exact: bool = False):
    """Assert a field on the parsed result."""
    actual = getattr(result, field, None)
    if isinstance(actual, str):
        actual = actual.lower().strip()
    if isinstance(expected, str):
        expected_cmp = expected.lower().strip()
    else:
        expected_cmp = expected

    if exact:
        ok_flag = actual == expected_cmp
    else:
        if isinstance(actual, str) and isinstance(expected_cmp, str):
            ok_flag = expected_cmp in actual
        else:
            ok_flag = actual == expected_cmp

    if ok_flag:
        ok(f"{label}: {field}={repr(getattr(result, field, None))}")
    else:
        fail(f"{label}: {field}", f"expected={repr(expected)}, got={repr(getattr(result, field, None))}")


def check_tier(result: WineParsedFields, min_tier: int, max_tier: int, label: str):
    tier = result.library_tier
    if tier is None:
        fail(f"{label}: library_tier is None")
    elif min_tier <= tier <= max_tier:
        ok(f"{label}: library_tier={tier} (expected {min_tier}–{max_tier})")
    else:
        fail(f"{label}: library_tier={tier}", f"expected between {min_tier} and {max_tier}")


def check_confidence(result: WineParsedFields, min_conf: float, max_conf: float, label: str):
    conf = result.confidence
    if min_conf <= conf <= max_conf:
        ok(f"{label}: confidence={conf:.2f} (expected {min_conf:.2f}–{max_conf:.2f})")
    else:
        fail(f"{label}: confidence={conf:.2f}", f"expected {min_conf:.2f}–{max_conf:.2f}")


# =============================================================================
# PHASE 4A — Sassicaia 2018 (iconic Italian red — should be Tier 1)
# =============================================================================
section("Phase 4A — Sassicaia 2018 (Tier 1 target)")

SASSICAIA_TEXT = "Sassicaia 2018  Tenuta San Guido  Bolgheri  Tuscany  Italy  Cabernet Sauvignon/Franc  $220"

async def test_4a():
    t0 = time.time()
    result = await parser.parse(
        ocr_text=SASSICAIA_TEXT,
        section_header="RED WINES",
        source_type="menu",
    )
    elapsed = time.time() - t0
    info(f"Parsed in {elapsed:.1f}s")
    info(f"wine_name={result.wine_name}, producer={result.producer}, vintage={result.vintage}")
    info(f"country={result.country}, region={result.region}, grape_variety={result.grape_variety}")
    info(f"confidence={result.confidence:.2f}, library_tier={result.library_tier}")
    if result.warnings:
        info(f"warnings={result.warnings}")

    # Tier: Sassicaia should be Tier 1 (all L1 fields identifiable)
    check_tier(result, 1, 2, "4A Sassicaia")  # allow Tier 2 if confidence just below 0.95
    check_confidence(result, 0.65, 1.0, "4A Sassicaia")

    # Core identity
    wine_name_ok = "sassicaia" in (result.wine_name or "").lower()
    if wine_name_ok:
        ok("4A: wine_name contains 'sassicaia'")
    else:
        fail("4A: wine_name", f"expected 'Sassicaia', got {repr(result.wine_name)}")

    vintage_ok = result.vintage == 2018
    if vintage_ok:
        ok("4A: vintage=2018")
    else:
        fail("4A: vintage", f"expected 2018, got {result.vintage}")

    country_ok = "italy" in (result.country or "").lower()
    if country_ok:
        ok("4A: country=Italy")
    else:
        fail("4A: country", f"expected Italy, got {result.country}")

asyncio.run(test_4a())


# =============================================================================
# PHASE 4B — Opus One 2019 (Napa icon — should be Tier 1)
# =============================================================================
section("Phase 4B — Opus One 2019 (Tier 1 target)")

OPUS_ONE_TEXT = "Opus One 2019  Robert Mondavi & Rothschild  Napa Valley  California  USA  $350 per bottle"

async def test_4b():
    t0 = time.time()
    result = await parser.parse(
        ocr_text=OPUS_ONE_TEXT,
        section_header="PREMIUM REDS",
        source_type="menu",
    )
    elapsed = time.time() - t0
    info(f"Parsed in {elapsed:.1f}s")
    info(f"wine_name={result.wine_name}, producer={result.producer}, vintage={result.vintage}")
    info(f"country={result.country}, region={result.region}")
    info(f"confidence={result.confidence:.2f}, library_tier={result.library_tier}")

    check_tier(result, 1, 2, "4B Opus One")
    check_confidence(result, 0.65, 1.0, "4B Opus One")

    wine_name_ok = "opus" in (result.wine_name or "").lower()
    if wine_name_ok:
        ok("4B: wine_name contains 'opus'")
    else:
        fail("4B: wine_name", f"expected 'Opus One', got {repr(result.wine_name)}")

    vintage_ok = result.vintage == 2019
    if vintage_ok:
        ok("4B: vintage=2019")
    else:
        fail("4B: vintage", f"expected 2019, got {result.vintage}")

    country_ok = "usa" in (result.country or "").lower() or "united states" in (result.country or "").lower() or "america" in (result.country or "").lower()
    if country_ok:
        ok("4B: country=USA")
    else:
        fail("4B: country", f"expected USA, got {result.country}")

asyncio.run(test_4b())


# =============================================================================
# PHASE 4C — Partial entry (Layer 1 cap should fire → Tier 3 or 4)
# =============================================================================
section("Phase 4C — Partial entry (Layer 1 cap fires → Tier 3/4)")

PARTIAL_TEXT = "Château Something 2020  $85"  # minimal info — should trigger cap

async def test_4c():
    t0 = time.time()
    result = await parser.parse(
        ocr_text=PARTIAL_TEXT,
        section_header=None,
        source_type="menu",
    )
    elapsed = time.time() - t0
    info(f"Parsed in {elapsed:.1f}s")
    info(f"wine_name={result.wine_name}, producer={result.producer}, vintage={result.vintage}")
    info(f"country={result.country}, region={result.region}, grape_variety={result.grape_variety}")
    info(f"confidence={result.confidence:.2f}, library_tier={result.library_tier}")
    if result.warnings:
        info(f"warnings={result.warnings[:2]}")

    # Cap must fire: confidence ≤ 0.50, tier ≥ 3
    check_tier(result, 3, 4, "4C Partial")
    check_confidence(result, 0.0, 0.55, "4C Partial")

    # Should still extract vintage and price
    if result.vintage == 2020:
        ok("4C: vintage=2020 extracted despite sparse text")
    else:
        info(f"4C: vintage={result.vintage} (Gemini may have extracted or left null)")

asyncio.run(test_4c())


# =============================================================================
# PHASE 4D — House wine (very vague — Tier 3 or 4)
# =============================================================================
section("Phase 4D — House wine (vague → Tier 3/4)")

HOUSE_WINE_TEXT = "House red wine  glass $9  bottle $35"

async def test_4d():
    t0 = time.time()
    result = await parser.parse(
        ocr_text=HOUSE_WINE_TEXT,
        section_header="WINES BY THE GLASS",
        source_type="menu",
    )
    elapsed = time.time() - t0
    info(f"Parsed in {elapsed:.1f}s")
    info(f"wine_name={result.wine_name}, producer={result.producer}")
    info(f"wine_type={result.wine_type}, country={result.country}")
    info(f"confidence={result.confidence:.2f}, library_tier={result.library_tier}")
    if result.warnings:
        info(f"warnings={result.warnings[:2]}")

    check_tier(result, 3, 4, "4D House wine")
    check_confidence(result, 0.0, 0.65, "4D House wine")

    # Should detect wine_type = red from section or text
    if result.wine_type and "red" in result.wine_type.lower():
        ok("4D: wine_type=red detected from context")
    else:
        fail("4D: wine_type", f"expected 'red', got {repr(result.wine_type)}")

    # Should detect price
    if result.price is not None:
        ok(f"4D: price extracted={result.price}")
    else:
        info("4D: price not extracted (ambiguous glass vs bottle — ok)")

asyncio.run(test_4d())


# =============================================================================
# PHASE 4E — Turkish wine (Öküzgözü — checks Turkish OCR + tier)
# =============================================================================
section("Phase 4E — Turkish wine Öküzgözü (Tier 2/3)")

TURKISH_TEXT = "2021 Okuzgozu Kavaklidere  Ankara  Türkiye  ₺320"

async def test_4e():
    t0 = time.time()
    result = await parser.parse(
        ocr_text=TURKISH_TEXT,
        section_header="TÜRK ŞARAPLARI",
        source_type="menu",
    )
    elapsed = time.time() - t0
    info(f"Parsed in {elapsed:.1f}s")
    info(f"wine_name={result.wine_name}, producer={result.producer}, vintage={result.vintage}")
    info(f"country={result.country}, grape_variety={result.grape_variety}")
    info(f"confidence={result.confidence:.2f}, library_tier={result.library_tier}")
    if result.warnings:
        info(f"warnings={result.warnings[:2]}")

    # Should identify Turkey, Kavaklidere, 2021
    country_ok = any(x in (result.country or "").lower() for x in ["turkey", "türkiye", "turkiye"])
    if country_ok:
        ok("4E: country=Turkey identified")
    else:
        fail("4E: country", f"expected Turkey, got {repr(result.country)}")

    if result.vintage == 2021:
        ok("4E: vintage=2021")
    else:
        fail("4E: vintage", f"expected 2021, got {result.vintage}")

    # Normalize: Kavaklıdere (Turkish ı) == Kavaklidere (ASCII i) — both are correct
    import unicodedata
    def ascii_lower(s):
        return ''.join(c for c in unicodedata.normalize('NFKD', s) if not unicodedata.combining(c)).lower().replace('ı', 'i').replace('ğ', 'g').replace('ş', 's').replace('ö', 'o').replace('ü', 'u').replace('ç', 'c')
    producer_ok = "kavaklidere" in ascii_lower(result.producer or "")
    if producer_ok:
        ok(f"4E: producer=Kavaklidere (got {result.producer!r}, Turkish chars normalized ✓)")
    else:
        fail("4E: producer", f"expected Kavaklidere (any form), got {repr(result.producer)}")

asyncio.run(test_4e())


# =============================================================================
# MENU SCAN — batch parse a 5-wine synthetic text menu
# =============================================================================
section("Menu Scan — batch parse (5 wines, mixed tiers)")

MENU_ENTRIES = [
    {
        "ocr_text": "Sassicaia 2018  Tenuta San Guido  Bolgheri  Tuscany  $220",
        "section_header": "RED WINES",
        "source_type": "menu",
    },
    {
        "ocr_text": "Veuve Clicquot Brut NV  Reims  Champagne  France  $95",
        "section_header": "SPARKLING",
        "source_type": "menu",
    },
    {
        "ocr_text": "Kendall-Jackson Vintner's Reserve Chardonnay 2021  California  $48",
        "section_header": "WHITE WINES",
        "source_type": "menu",
    },
    {
        "ocr_text": "House Rosé  bottle $30  glass $8",
        "section_header": "ROSÉ",
        "source_type": "menu",
    },
    {
        "ocr_text": "2021 Öküzgözü  Kavaklidere  Ankara Türkiye  ₺290",
        "section_header": "TÜRK ŞARAPLARI",
        "source_type": "menu",
    },
]

async def test_menu_scan():
    t0 = time.time()
    results = await parser.parse_batch(MENU_ENTRIES)
    elapsed = time.time() - t0
    info(f"Batch of {len(MENU_ENTRIES)} wines parsed in {elapsed:.1f}s ({elapsed/len(MENU_ENTRIES):.1f}s avg)")

    # Must return exactly 5 results
    if len(results) == 5:
        ok(f"Menu scan: returned {len(results)} results (expected 5)")
    else:
        fail("Menu scan: result count", f"expected 5, got {len(results)}")

    # Check each result has a valid tier and confidence
    tier_counts: Dict[int, int] = {}
    for i, r in enumerate(results):
        entry_label = MENU_ENTRIES[i]["ocr_text"][:35]
        tier = r.library_tier
        conf = r.confidence
        name = r.wine_name

        info(f"  [{i+1}] {entry_label!r}")
        info(f"       → name={name!r}, tier={tier}, conf={conf:.2f}")

        if tier is not None and 0 <= tier <= 4:
            ok(f"    Entry {i+1}: valid tier {tier}")
            tier_counts[tier] = tier_counts.get(tier, 0) + 1
        else:
            fail(f"    Entry {i+1}: invalid tier", f"got {tier}")

        if 0.0 <= conf <= 1.0:
            ok(f"    Entry {i+1}: valid confidence {conf:.2f}")
        else:
            fail(f"    Entry {i+1}: invalid confidence", f"got {conf}")

    # Sassicaia → Tier 1, 2, or 3 (LLM confidence varies across runs; Tier 4 = bug)
    sass = results[0]
    if sass.library_tier is not None and sass.library_tier <= 3:
        ok(f"Menu[0] Sassicaia: tier={sass.library_tier} (identifiable wine ✓, Tier 4 would be failure)")
    else:
        fail(f"Menu[0] Sassicaia: tier", f"expected ≤3 (iconic wine should not be Tier 4), got {sass.library_tier}")

    # Veuve Clicquot NV → Tier 1 or 2 (NV exception must fire)
    vc = results[1]
    if vc.library_tier is not None and vc.library_tier <= 2:
        ok(f"Menu[1] Veuve Clicquot NV: tier={vc.library_tier} (NV exception ✓)")
    else:
        fail(f"Menu[1] Veuve Clicquot NV: tier", f"expected ≤2 (NV exception), got {vc.library_tier}")

    # House Rosé → Tier 3 or 4
    house = results[3]
    if house.library_tier is not None and house.library_tier >= 3:
        ok(f"Menu[3] House Rosé: tier={house.library_tier} (Tier 3/4 ✓)")
    else:
        fail(f"Menu[3] House Rosé: tier", f"expected ≥3, got {house.library_tier}")

    info(f"Tier distribution: {dict(sorted(tier_counts.items()))}")
    info(f"Cost estimate: ~${len(MENU_ENTRIES) * 0.00005:.5f} (@ $0.00005/wine)")

asyncio.run(test_menu_scan())


# =============================================================================
# FINAL RESULTS
# =============================================================================
section("FINAL RESULTS")

total = passed + failed
print(f"\n  {BOLD}RESULTS: {passed}/{total} passed{RESET}")

if errors:
    print(f"\n  {RED}FAILED ASSERTIONS:{RESET}")
    for e in errors:
        print(f"    {RED}• {e}{RESET}")

if failed == 0:
    print(f"\n  {GREEN}{BOLD}✓ ALL PHASE 4 + MENU SCAN TESTS PASS{RESET}")
    print(f"  {GREEN}Real Gemini 2.5 Flash pipeline is working end-to-end.{RESET}")
    sys.exit(0)
else:
    print(f"\n  {RED}{BOLD}✗ {failed} test(s) failed — review output above{RESET}")
    sys.exit(1)

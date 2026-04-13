# Locked Files Patch Guide
**Status:** These files are locked by the running orchestrator process.
**Action:** Stop the orchestrator → apply these changes → restart.

---

## 0. Filesystem health (macOS Spotlight & VM mounts) — safe, no data loss

If editors or tools report **read locks**, **EDEADLK**, or Spotlight (`mdutil`) holding files open:

1. **Do not** run `mdutil -a -i off` — that disables Spotlight indexing **everywhere** (heavy-handed).
2. **Do** exclude **only this repo** (or `UnicornProjects`) via **System Settings → Siri & Spotlight → Spotlight Privacy → +**.
3. From the repo root, run the safe helper (read-only checks + tries to open Settings):

   ```bash
   ./scripts/safe-dev-filesystem-setup.sh
   ```

4. For **VM / Docker shared-folder** deadlocks: save all work, then prefer editing from a **native APFS path** or restart **only** the file-sharing layer (Docker Desktop / VM app) when you can afford a brief disruption — never force-unmount with open unsaved files.

This flow does **not** delete or modify project data; it only reduces indexer contention and documents recovery steps.

---

## 1. `services/agent-orchestrator/config/settings.py`

### Change: Disable mock mode defaults

Find the mock mode settings and change their defaults:

```python
# BEFORE (current)
mock_llm: bool = True                    # ← CHANGE to False
cv_yolov8_mock_mode: bool = True         # ← CHANGE to False

# AFTER (target)
mock_llm: bool = False
cv_yolov8_mock_mode: bool = False
```

> **Why:** `mock_mode=True` is the #1 blocker. The entire 4-layer scanning pipeline
> (YOLO → OCR → Gemini → pgvector) never executes because this flag is True.
> Every user gets hardcoded fake wine data instead of real scan results.

### Also verify these settings exist:

```python
# Gemini API
google_api_key: str = ""  # Must be set in .env

# OCR languages (ensure Turkish is included)
cv_ocr_languages: str = "en,tr,fr,it,es,de"

# Scan thresholds
scan_parser_confidence_threshold: float = 0.5
scan_vlm_enabled: bool = True
```

---

## 2. `services/agent-orchestrator/services/wine_field_parser.py`

### Change: Import and use the 3-layer prompt system

At the top of the file, add the import:

```python
from services.wine_prompts import build_wine_prompt
```

Then find the Gemini API call (likely in a `parse()` or `parse_wine()` method) and inject the prompt layers:

```python
# BEFORE (likely something like):
response = model.generate_content(ocr_text)

# AFTER:
prompt = build_wine_prompt(
    ocr_text=ocr_text,
    ocr_confidence=ocr_confidence,  # from OCR pipeline
    normalized_text=normalized_text,  # from text_normalizer
    section_header=section_header,    # from menu context
    restaurant_country=restaurant_country or "USA",
    restaurant_city=restaurant_city,
    restaurant_tier=restaurant_tier or "casual",
    cuisine_type=cuisine_type,
)

response = model.generate_content(
    contents=prompt["user"],
    generation_config={"response_mime_type": "application/json"},
    system_instruction=prompt["system"],
)
```

### Also add: governance tier assignment after parsing

```python
from services.governance import assign_governance_tier, compute_overall_confidence

# After parsing the Gemini response into fields:
overall_conf = compute_overall_confidence(field_confidences)
governance = assign_governance_tier(
    overall_confidence=overall_conf,
    field_confidences=field_confidences,
    field_values=parsed_fields,
    field_sources=field_sources,
)

# Merge governance into result
result["library_tier"] = governance["library_tier"]
result["canonical_name_verified"] = governance["canonical_name_verified"]
result["confidence"] = governance["overall_confidence"]
result["warnings"].extend(governance["warnings"])
```

---

## 3. `services/agent-orchestrator/services/wine_matcher.py`

### Change: Import governance module and assign tiers during matching

At the top:

```python
from services.governance import assign_governance_tier, compute_overall_confidence
```

In the match result construction (after library lookup):

```python
# After matching, assign governance tier to the result
governance = assign_governance_tier(
    overall_confidence=match_confidence,
    field_confidences=field_confidences,
    field_values=matched_wine_data,
    field_sources=field_sources,
)

result["library_tier"] = governance["library_tier"]
result["canonical_name_verified"] = governance["canonical_name_verified"]
result["warnings"].extend(governance["warnings"])
```

---

## 4. `services/agent-orchestrator/services/text_normalizer.py`

### Change: Add Turkish character correction mapping

Add this mapping constant and apply it during normalization:

```python
# Turkish OCR character corrections
TURKISH_CHAR_MAP = {
    'u': 'ü', 'o': 'ö', 'c': 'ç', 's': 'ş', 'g': 'ğ', 'i': 'ı',
    'U': 'Ü', 'O': 'Ö', 'C': 'Ç', 'S': 'Ş', 'G': 'Ğ', 'I': 'İ',
}

TURKISH_WINE_TERMS = {
    'okuzgozu': 'öküzgözü', 'bogazkere': 'boğazkere',
    'kalecik karasi': 'kalecik karası', 'narince': 'narince',
    'emir': 'emir', 'sultaniye': 'sultaniye',
    'cankaya': 'çankaya', 'sarap': 'şarap',
    'kavaklidere': 'kavaklıdere',
}

def correct_turkish_ocr(text: str) -> str:
    """Apply Turkish character corrections to OCR output."""
    result = text
    for ascii_form, turkish_form in TURKISH_WINE_TERMS.items():
        if ascii_form in result.lower():
            result = result.replace(ascii_form, turkish_form)
            result = result.replace(ascii_form.title(), turkish_form.title())
    return result
```

---

## 5. `services/agent-orchestrator/services/wine_research_service.py`

### Change: Wire web enrichment for Tier 2/3 wines

This file already exists. The key change is adding a method that gets called
by the Celery worker (or inline) when a wine is assigned Tier 2 or 3:

```python
async def enrich_wine(self, wine_id: str, fields_to_enrich: list[str]):
    """Background enrichment for Tier 2/3 wines."""
    # 1. Fetch wine from master_wine_library
    # 2. Search producer official website first (trust=1.0)
    # 3. Then consorzio/appellation sites (trust=0.95)
    # 4. Then Decanter/Wine Spectator (trust=0.85)
    # 5. Update enriched fields with source='web_search'
    # 6. Recalculate confidence and potentially promote tier
    pass
```

---

## Execution Order

1. Stop orchestrator: `docker-compose stop agent-orchestrator` (or kill the process)
2. Apply settings.py changes (mock_mode=False)
3. Apply wine_field_parser.py changes (prompt injection)
4. Apply wine_matcher.py changes (governance import)
5. Apply text_normalizer.py changes (Turkish corrections)
6. Run migration: `psql -f services/database/migrations/015_governance_tiers_and_aliases.sql`
7. Restart: `docker-compose up agent-orchestrator`
8. Test: POST a real menu image to `/api/v1/scan/menu`

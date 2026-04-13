# Patch Guide for Locked Files

This document provides exact patches for the three files that remain locked due to VM mount issues. Apply these changes manually in your editor on macOS.

---

## File 1: wine_matcher.py

**Purpose:** Library matching for parsed wines
**Size:** 21,530 bytes
**Changes:** Add governance tier assignment after library matching

### Patch 1.1: Add imports at the top (after existing imports)

**Location:** After line ~25 (after other `from services import` statements)

```python
from services.governance import assign_governance_tier, compute_overall_confidence
```

---

### Patch 1.2: In the main matching function (typically `match_wine()` or similar)

**Pattern to find:** Look for where the function returns a match result to the caller (usually returns `LibraryMatch` or similar)

**Before:** (example - your actual code may vary slightly)
```python
# Match found, return result
return {
    "matched_wine": library_entry,
    "confidence": match_confidence,
    "field_confidences": field_scores,
    ...
}
```

**After:** Insert governance assignment
```python
# ── Apply governance tier assignment ──
field_confidences = field_scores  # or however field confidences are stored
field_values = library_entry  # the matched wine data
field_sources = {}  # map of field→source if available, else empty dict

governance = assign_governance_tier(
    overall_confidence=match_confidence,
    field_confidences=field_confidences,
    field_values=field_values,
    field_sources=field_sources,
)

# Merge governance results into response
result = {
    "matched_wine": library_entry,
    "confidence": governance.get("overall_confidence", match_confidence),
    "library_tier": governance.get("library_tier"),
    "canonical_name_verified": governance.get("canonical_name_verified", False),
    "field_confidences": field_scores,
    "warnings": governance.get("warnings", []),
    ...
}

return result
```

---

## File 2: text_normalizer.py

**Purpose:** OCR text normalization (corrections for abbreviations, special characters, Turkish OCR errors)
**Size:** 18,975 bytes
**Changes:** Add Turkish character correction maps and function

### Patch 2.1: Add Turkish character map constant (near the top, after other constants)

**Location:** After line ~30 (in the constants section)

```python
# Turkish character OCR correction map
# Common Turkish characters misrecognized by OCR
TURKISH_CHAR_MAP = {
    'c': 'ç',      # OCR reads ç as c
    'g': 'ğ',      # OCR reads ğ as g
    's': 'ş',      # OCR reads ş as s
    'u': 'ü',      # OCR reads ü as u
    'o': 'ö',      # OCR reads ö as o
    'i': 'ı',      # OCR reads ı as i
    'C': 'Ç',
    'G': 'Ğ',
    'S': 'Ş',
    'U': 'Ü',
    'O': 'Ö',
    'I': 'İ',
}

# Turkish wine terms and common misspellings
TURKISH_WINE_TERMS = {
    'sevilen': 'Sevilen',
    'paşaeli': 'Paşaeli',
    'vinkara': 'Vinkara',
    'kavaklidere': 'Kavaklidere',
    'doluca': 'Doluca',
    'cankiri': 'Çankırı',
    'ege': 'Aegean',
    'trakya': 'Thrace',
}
```

---

### Patch 2.2: Add Turkish OCR correction function

**Location:** Add as a new method in the `TextNormalizer` class (or as a standalone function if no class exists)

```python
def correct_turkish_ocr(self, text: str) -> str:
    """
    Correct common Turkish OCR errors.

    Applies character-level corrections for Turkish-specific issues:
    - ç/c, ğ/g, ş/s, ü/u, ö/o, ı/i confusions
    - Common Turkish wine producer name corrections

    Args:
        text: Raw OCR text possibly containing Turkish characters

    Returns:
        Corrected text with Turkish OCR errors fixed
    """
    if not text:
        return text

    # Apply character corrections contextually
    # (only in wine/producer name context to avoid false positives)
    corrected = text

    # For known Turkish wine producers, apply term corrections
    for misspelling, correct_term in TURKISH_WINE_TERMS.items():
        # Case-insensitive replacement for wine names
        import re
        corrected = re.sub(
            rf'\b{re.escape(misspelling)}\b',
            correct_term,
            corrected,
            flags=re.IGNORECASE
        )

    # Character-level corrections (more conservative)
    # Only apply in regions with known Turkish OCR patterns
    char_corrected = ""
    for i, char in enumerate(corrected):
        # Only replace isolated characters that match OCR patterns
        # (avoid replacing valid single letters in English text)
        if char in TURKISH_CHAR_MAP and i > 0 and i < len(corrected) - 1:
            prev_char = corrected[i - 1]
            next_char = corrected[i + 1]
            # If surrounded by other Turkish-looking context, apply correction
            if not prev_char.isspace() and not next_char.isspace():
                char_corrected += TURKISH_CHAR_MAP.get(char, char)
            else:
                char_corrected += char
        else:
            char_corrected += char

    return char_corrected
```

---

### Patch 2.3: Call the Turkish correction in the normalize pipeline

**Location:** Find the main `normalize()` method

**Before:**
```python
def normalize(self, text: str) -> Dict[str, Any]:
    """Normalize OCR text."""
    # ... existing normalization steps ...
    return {
        "corrected": normalized_text,
        ...
    }
```

**After:**
```python
def normalize(self, text: str, ocr_languages: Optional[List[str]] = None) -> Dict[str, Any]:
    """Normalize OCR text."""
    # ... existing normalization steps ...

    # Apply Turkish OCR corrections if Turkish was detected in OCR
    if ocr_languages and 'tr' in ocr_languages:
        normalized_text = self.correct_turkish_ocr(normalized_text)

    return {
        "corrected": normalized_text,
        ...
    }
```

---

## File 3: wine_research_service.py

**Purpose:** Web enrichment trigger for provisional wines
**Size:** 14,062 bytes
**Changes:** Wire enrichment queue trigger for Tier 2 wines (confidence 0.70-0.94)

### Patch 3.1: Add imports at the top

**Location:** After other imports (around line ~15-25)

```python
from services.governance import GovernanceTier
from datetime import datetime
```

---

### Patch 3.2: Add enrichment queue trigger function

**Location:** Add as a new function (typically after the class definition or as part of a service module)

```python
async def trigger_enrichment_for_wine(
    supabase_client,
    wine_id: int,
    parsed_data: Dict[str, Any],
    library_tier: int,
    confidence: float,
    restaurant_id: Optional[int] = None,
) -> bool:
    """
    Trigger background web enrichment for provisional wines (Tier 2).

    Tier 2 wines (confidence 0.70-0.94) are candidates for enrichment:
    - Could be improved with web data (ratings, detailed tasting notes)
    - Not yet confident enough for Tier 1 (≥0.95)
    - More confident than Tier 3 (provisional, <0.50)

    Args:
        supabase_client: Authenticated Supabase client
        wine_id: ID of the wine to enrich
        parsed_data: Full WineParsedFields data
        library_tier: Governance tier (0-4)
        confidence: Overall confidence score
        restaurant_id: Optional restaurant context for enrichment

    Returns:
        True if enrichment was queued, False otherwise
    """
    try:
        # Only queue Tier 2 wines for enrichment
        if library_tier != GovernanceTier.WEB_ENRICHED.value:  # Tier 2
            return False

        # Prepare enrichment job payload
        enrichment_job = {
            "wine_id": wine_id,
            "restaurant_id": restaurant_id,
            "current_confidence": confidence,
            "target_sources": [
                "wine_spectator_api",
                "robert_parker_api",
                "vivino_api",
            ],
            "parsed_fields_snapshot": parsed_data,
            "queued_at": datetime.utcnow().isoformat(),
            "status": "pending",
            "priority": 1 if confidence >= 0.85 else 2,  # Higher priority for nearly-Tier1
        }

        # Insert into enrichment_queue table
        response = await supabase_client.table("enrichment_queue").insert(
            enrichment_job
        ).execute()

        if response.data:
            return True
        return False

    except Exception as e:
        logger.error(f"Failed to queue enrichment for wine {wine_id}: {e}")
        return False
```

---

### Patch 3.3: Call enrichment trigger from main scan pipeline

**Location:** Find where wine parsing results are returned (typically in scan_routes.py or a pipeline orchestrator)

**Before:**
```python
# After wine_field_parser returns result
parsed_wine = await field_parser.parse(ocr_text, ...)

# Return to client
return parsed_wine
```

**After:**
```python
# After wine_field_parser returns result
parsed_wine = await field_parser.parse(ocr_text, ...)

# Trigger enrichment for Tier 2 wines (if library_tier is set)
if hasattr(parsed_wine, 'library_tier') and parsed_wine.library_tier == 2:
    await trigger_enrichment_for_wine(
        supabase_client=supabase_client,
        wine_id=None,  # Will be assigned on library insert
        parsed_data=parsed_wine.model_dump(),
        library_tier=parsed_wine.library_tier,
        confidence=parsed_wine.confidence,
        restaurant_id=current_restaurant_id,  # from context
    )

# Return to client
return parsed_wine
```

---

## Summary of Changes

| File | Change | Priority | Complexity |
|------|--------|----------|------------|
| wine_matcher.py | Add governance tier assignment | HIGH | Low |
| text_normalizer.py | Add Turkish OCR corrections | MEDIUM | Medium |
| wine_research_service.py | Wire enrichment queue trigger | MEDIUM | Low |

**Total lines of code to add:** ~150-200 lines
**Estimated time to apply:** 10-15 minutes
**Testing:** After applying, run `python -m py_compile <filename>` to verify syntax

---

## Application Order

1. **text_normalizer.py** (adds constants and helper function, no dependencies)
2. **wine_matcher.py** (imports governance, uses it at return time)
3. **wine_research_service.py** (uses text_normalizer implicitly, triggers enrichment)

---

## Verification After Patching

After applying all patches, run:

```bash
cd /sessions/optimistic-great-planck/mnt/Restaurant\ AI\ Automation/services/agent-orchestrator

# Syntax check all modified files
python -m py_compile services/wine_matcher.py
python -m py_compile services/text_normalizer.py
python -m py_compile services/wine_research_service.py

# If all pass with no output, you're good!
```

If you get any syntax errors, let me know the exact error and I can provide refined patches.

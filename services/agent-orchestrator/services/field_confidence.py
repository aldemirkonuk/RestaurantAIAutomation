"""
Field Confidence Module
=======================
Shared helpers for building, merging, and routing per-field confidence data.

Used by:
- claude_vision_extractor.py   (build_field_confidence)
- haiku_enrichment_service.py  (ENRICHMENT_FIELDS, JSONB_ENRICHMENT_KEYS)
- jobs/haiku_tasks.py          (merge_field_confidence)
- api/onboarding_routes.py     (route_fields_by_threshold, should_auto_block)
- api/quality_routes.py        (route_fields_by_threshold, DEFAULT thresholds)
- jobs/calibration_tasks.py    (VISION_FIELDS, ENRICHMENT_FIELDS)
"""

from typing import Any, Dict, List, Optional, Tuple

# ---------------------------------------------------------------------------
# Field lists
# ---------------------------------------------------------------------------

# 18 fields Claude Vision is asked to extract (FCONF-01 / CONTEXT.md D-04)
VISION_FIELDS: List[str] = [
    "wine_name",
    "producer",
    "vintage",
    "primary_type",
    "color",
    "country",
    "region",
    "sub_region",
    "appellation",
    "grape_variety",
    "alcohol_pct",
    "price_bottle",
    "price_glass",
    "tasting_notes",
    "description",
    "section_name",
    "bin_number",
    "sweetness_level",
]

# Fields Haiku enrichment provides (FCONF-02 / CONTEXT.md D-07)
ENRICHMENT_FIELDS: List[str] = [
    "producer",
    "region",
    "sub_region",
    "appellation",
    "country",
    "grape_variety",
    "color",
    "primary_type",
    "sweetness_level",
    "food_pairing",
    "producer_bio",
    "tasting_notes",
    "alcohol_pct",
    "description",
]

# JSONB structured enrichment keys (FCONF-08 / CONTEXT.md D-07)
JSONB_ENRICHMENT_KEYS: List[str] = [
    "grape_family",
    "wine_structure",
    "sensory_profile",
    "practical_attributes",
    "region_hierarchy",
    "critic_scores",
    "winemaking_details",
]

# ---------------------------------------------------------------------------
# Default thresholds (FCONF-04 / CONTEXT.md D-04) — must match DB seed values
# ---------------------------------------------------------------------------

DEFAULT_REVIEW_THRESHOLD: float = 0.5
DEFAULT_ACCEPT_THRESHOLD: float = 0.8

# Auto-block field ratio (CONTEXT.md D-02):
# wine is auto_blocked when > 50% of its fields fall below review threshold
AUTO_BLOCK_FIELD_RATIO: float = 0.5


# ---------------------------------------------------------------------------
# Core helpers
# ---------------------------------------------------------------------------

def build_field_confidence(
    wine_dict: Dict[str, Any],
    source: str = "visible",
) -> Dict[str, Dict[str, Any]]:
    """
    Build field_confidence JSONB from a flat or nested wine dict returned by Claude Vision.

    - Nested format: {"wine_name": {"value": "Barolo", "confidence": 0.95, "source": "visible"}}
      → kept as-is (normalised to float confidence).
    - Flat format: {"wine_name": "Barolo"}
      → wrapped with confidence=0.5, source=source (legacy / fallback).

    Only includes fields present in VISION_FIELDS.

    Returns: {"field_name": {"value": ..., "confidence": float, "source": str}, ...}
    """
    fc: Dict[str, Dict[str, Any]] = {}
    for field_name in VISION_FIELDS:
        raw = wine_dict.get(field_name)
        if raw is None:
            continue
        if isinstance(raw, dict) and "confidence" in raw:
            fc[field_name] = {
                "value": raw.get("value"),
                "confidence": float(raw.get("confidence", 0.5)),
                "source": str(raw.get("source", source)),
            }
        else:
            fc[field_name] = {
                "value": raw,
                "confidence": 0.5,
                "source": source,
            }
    return fc


def merge_field_confidence(
    existing_fc: Dict[str, Dict[str, Any]],
    new_fc: Dict[str, Dict[str, Any]],
    overwrite_lower: bool = True,
) -> Dict[str, Dict[str, Any]]:
    """
    Merge new field_confidence entries into existing.

    If overwrite_lower=True (default), a new entry replaces existing only when:
    - the field is absent in existing, OR
    - new confidence >= existing confidence

    This prevents lower-confidence Haiku data from overwriting higher-confidence
    Vision data for the same field (CONTEXT.md D-08).
    """
    merged: Dict[str, Dict[str, Any]] = dict(existing_fc)
    for field_name, new_entry in new_fc.items():
        existing_entry = merged.get(field_name)
        if existing_entry is None:
            merged[field_name] = new_entry
        elif overwrite_lower and new_entry.get("confidence", 0.0) >= existing_entry.get("confidence", 0.0):
            merged[field_name] = new_entry
        # else: keep existing (higher confidence)
    return merged


def route_fields_by_threshold(
    fc: Dict[str, Dict[str, Any]],
    review_threshold: float = DEFAULT_REVIEW_THRESHOLD,
    accept_threshold: float = DEFAULT_ACCEPT_THRESHOLD,
) -> Tuple[Dict[str, Any], List[Dict[str, Any]], Dict[str, Any]]:
    """
    Route field_confidence entries through the 3-tier threshold (FCONF-04).

    Tiers:
    - confidence > accept_threshold  → accepted  (auto-accept, no review flag)
    - confidence >= review_threshold → review     (persisted + queued for human review)
    - confidence < review_threshold  → rejected   (field stored as NULL)

    Returns:
        accepted : dict  field_name → value (both accepted AND review-tier fields are persisted)
        review   : list  [{"field_name", "current_value", "confidence", "source"}, ...]
        rejected : dict  field_name → None
    """
    accepted: Dict[str, Any] = {}
    review: List[Dict[str, Any]] = []
    rejected: Dict[str, Any] = {}

    for field_name, entry in fc.items():
        conf = float(entry.get("confidence", 0.0))
        value = entry.get("value")
        source = str(entry.get("source", "unknown"))

        if conf > accept_threshold:
            accepted[field_name] = value
        elif conf >= review_threshold:
            # Persisted (value saved) but flagged for human review
            accepted[field_name] = value
            review.append({
                "field_name": field_name,
                "current_value": str(value) if value is not None else None,
                "confidence": conf,
                "source": source,
            })
        else:
            # Rejected — stored as NULL
            rejected[field_name] = None

    return accepted, review, rejected


def compute_completeness_from_fc(
    fc: Dict[str, Dict[str, Any]],
    fields: Optional[List[str]] = None,
) -> float:
    """
    Compute completeness score from field_confidence JSONB (CONTEXT.md D-01).

    Replaces the old flat-field compute_completeness() that counted non-null values.
    Score = average confidence across all present fields (0.0–1.0).

    If `fields` is provided, only those fields are included in the average.
    Missing or null-value fields contribute 0.0 to the average.
    """
    if not fc:
        return 0.0
    target_fields = fields if fields is not None else list(fc.keys())
    if not target_fields:
        return 0.0

    confidences: List[float] = []
    for f in target_fields:
        entry = fc.get(f)
        if entry and entry.get("value") is not None:
            confidences.append(float(entry.get("confidence", 0.0)))
        else:
            confidences.append(0.0)

    return round(sum(confidences) / len(confidences), 3)


def should_auto_block(fc: Dict[str, Dict[str, Any]]) -> bool:
    """
    Per CONTEXT.md D-02: wine is auto_blocked when > 50% of its fields fall below
    the review threshold (0.5). A wine with 2 bad fields out of 18 is NOT blocked.

    An empty field_confidence map returns True (block by default — nothing extracted).
    """
    if not fc:
        return True
    total = len(fc)
    if total == 0:
        return True
    rejected_count = sum(
        1 for entry in fc.values()
        if float(entry.get("confidence", 0.0)) < DEFAULT_REVIEW_THRESHOLD
    )
    return (rejected_count / total) > AUTO_BLOCK_FIELD_RATIO

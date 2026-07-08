"""
Wine Governance Tier Assignment
================================
5-tier data governance system for master_wine_library.

Imported by wine_matcher.py via:
    from services.governance import assign_governance_tier, GovernanceTier

Tier 0: Canonical (human-verified)
Tier 1: Auto-Validated (LLM confidence ≥0.95, all Layer 1 present)
Tier 2: Web-Enriched (confidence 0.70–0.94, web search may improve)
Tier 3: Provisional (confidence 0.50–0.69, human review recommended)
Tier 4: Unresolved (confidence <0.50 or critical field null)
"""

from typing import Dict, Any
from enum import IntEnum


class GovernanceTier(IntEnum):
    """Wine library governance tiers."""

    CANONICAL = 0  # Human-verified, producer-confirmed
    AUTO_VALIDATED = 1  # High confidence, all Layer 1 fields present
    WEB_ENRICHED = 2  # Medium-high confidence, web enrichment available
    PROVISIONAL = 3  # Low-medium confidence, human review recommended
    UNRESOLVED = 4  # Very low confidence or missing critical fields


# Layer 1 identity fields — the core of wine identification
LAYER_1_FIELDS = [
    "wine_name",
    "producer",
    "vintage",
    "country",
    "region",
    "grape_variety",
    "wine_type",
]

# Confidence threshold for Layer 1 cap rule
LAYER_1_CONFIDENCE_FLOOR = 0.70

# Overall confidence thresholds for tier assignment
TIER_THRESHOLDS = {
    GovernanceTier.AUTO_VALIDATED: 0.95,  # ≥0.95 → Tier 1
    GovernanceTier.WEB_ENRICHED: 0.70,  # 0.70–0.94 → Tier 2
    GovernanceTier.PROVISIONAL: 0.50,  # 0.50–0.69 → Tier 3
    # < 0.50 → Tier 4
}


def check_layer_1_cap(
    field_confidences: Dict[str, float],
    field_values: Dict[str, Any],
) -> tuple:
    """
    Apply the Layer 1 Cap Rule.

    If ANY Layer 1 field has confidence < 0.70 OR is null/unknown:
    → overall_confidence MUST NOT exceed 0.50
    → library_tier MUST be 3 or 4

    Returns:
        (is_capped: bool, capped_overall: float or None, cap_warnings: list[str])
    """
    warnings = []
    is_capped = False

    for field in LAYER_1_FIELDS:
        value = field_values.get(field)
        confidence = field_confidences.get(field, 0.0)

        # Check for null/missing values (vintage null is OK for NV wines)
        if field == "vintage" and value is None:
            # Check if this is explicitly a non-vintage wine
            vintage_quality = field_values.get("vintage_quality", "")
            wine_name_str = str(field_values.get("wine_name", "")).lower()
            wine_type_str = str(field_values.get("wine_type", "")).lower()
            is_nv = (
                vintage_quality == "non_vintage"
                or " nv" in wine_name_str
                or wine_name_str.endswith(" nv")
                or wine_type_str in ("sparkling", "fortified", "dessert")
            )
            if is_nv:
                continue  # NV wines get a pass on vintage field

        if value is None or value == "" or value == "unknown":
            is_capped = True
            warnings.append(
                f"CAP_RULE: {field} is null/unknown → overall confidence capped at 0.50"
            )
            continue

        if confidence < LAYER_1_CONFIDENCE_FLOOR:
            is_capped = True
            warnings.append(
                f"CAP_RULE: {field} confidence {confidence:.2f} < {LAYER_1_CONFIDENCE_FLOOR} → overall confidence capped at 0.50"
            )

    if is_capped:
        return True, 0.50, warnings
    return False, None, []


def assign_governance_tier(
    overall_confidence: float,
    field_confidences: Dict[str, float],
    field_values: Dict[str, Any],
    field_sources: Dict[str, str],
    is_human_verified: bool = False,
    has_web_enrichment: bool = False,
) -> Dict[str, Any]:
    """
    Assign a governance tier to a wine identification result.

    Args:
        overall_confidence: The composite confidence score (0.0–1.0)
        field_confidences: Per-field confidence scores
        field_values: The actual field values (to check for nulls)
        field_sources: Per-field source types
        is_human_verified: Whether a human has verified this wine
        has_web_enrichment: Whether web enrichment has been applied

    Returns:
        {
            "library_tier": int (0-4),
            "tier_name": str,
            "overall_confidence": float (may be capped),
            "canonical_name_verified": bool,
            "warnings": list[str],
            "review_required": bool,
            "web_enrichment_eligible": bool,
        }
    """
    warnings = []

    # Step 1: Check Layer 1 Cap Rule
    is_capped, capped_confidence, cap_warnings = check_layer_1_cap(
        field_confidences=field_confidences,
        field_values=field_values,
    )

    if is_capped:
        overall_confidence = min(overall_confidence, capped_confidence or 0.50)
        warnings.extend(cap_warnings)

    # Step 2: Human-verified wines are always Tier 0
    if is_human_verified:
        return {
            "library_tier": GovernanceTier.CANONICAL,
            "tier_name": "canonical",
            "overall_confidence": overall_confidence,
            "canonical_name_verified": True,
            "warnings": warnings,
            "review_required": False,
            "web_enrichment_eligible": False,
        }

    # Step 3: Count Layer 1 fields present
    layer_1_present = sum(
        1
        for f in LAYER_1_FIELDS
        if field_values.get(f) is not None
        and field_values.get(f) != ""
        and field_values.get(f) != "unknown"
    )
    # Vintage exception for NV wines
    vintage_quality = field_values.get("vintage_quality", "")
    wine_name_str = str(field_values.get("wine_name", "")).lower()
    wine_type_str = str(field_values.get("wine_type", "")).lower()
    is_nv = (
        vintage_quality == "non_vintage"
        or " nv" in wine_name_str
        or wine_name_str.endswith(" nv")
        or wine_type_str in ("sparkling", "fortified", "dessert")
    )
    if field_values.get("vintage") is None and is_nv:
        layer_1_present += 1  # Count NV as "present" for vintage

    all_layer_1_present = layer_1_present >= len(LAYER_1_FIELDS)

    # Step 4: Assign tier based on confidence + Layer 1 completeness
    if (
        overall_confidence >= TIER_THRESHOLDS[GovernanceTier.AUTO_VALIDATED]
        and all_layer_1_present
    ):
        tier = GovernanceTier.AUTO_VALIDATED
    elif overall_confidence >= TIER_THRESHOLDS[GovernanceTier.WEB_ENRICHED]:
        tier = GovernanceTier.WEB_ENRICHED
    elif overall_confidence >= TIER_THRESHOLDS[GovernanceTier.PROVISIONAL]:
        tier = GovernanceTier.PROVISIONAL
    else:
        tier = GovernanceTier.UNRESOLVED

    # Step 5: If capped, tier cannot be above PROVISIONAL
    if is_capped and tier < GovernanceTier.PROVISIONAL:
        tier = GovernanceTier.PROVISIONAL
        warnings.append(
            "TIER_OVERRIDE: Capped to Tier 3 (Provisional) due to Layer 1 Cap Rule"
        )

    tier_names = {
        GovernanceTier.CANONICAL: "canonical",
        GovernanceTier.AUTO_VALIDATED: "auto_validated",
        GovernanceTier.WEB_ENRICHED: "web_enriched",
        GovernanceTier.PROVISIONAL: "provisional",
        GovernanceTier.UNRESOLVED: "unresolved",
    }

    return {
        "library_tier": int(tier),
        "tier_name": tier_names[tier],
        "overall_confidence": round(overall_confidence, 4),
        "canonical_name_verified": False,
        "warnings": warnings,
        "review_required": tier >= GovernanceTier.PROVISIONAL,
        "web_enrichment_eligible": tier
        in (
            GovernanceTier.WEB_ENRICHED,
            GovernanceTier.PROVISIONAL,
        ),
    }


def compute_overall_confidence(field_confidences: Dict[str, float]) -> float:
    """
    Compute overall confidence as a weighted average.
    Layer 1 fields get 3× weight; Layer 2 fields get 1× weight.
    """
    if not field_confidences:
        return 0.0

    weighted_sum = 0.0
    weight_total = 0.0

    for field, conf in field_confidences.items():
        weight = 3.0 if field in LAYER_1_FIELDS else 1.0
        weighted_sum += conf * weight
        weight_total += weight

    return round(weighted_sum / weight_total, 4) if weight_total > 0 else 0.0

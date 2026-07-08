"""
Quality Scoring Pipeline
========================
3-signal quality scoring for extracted wine menu data:
  1. Parser confidence (from local parser or VLM)
  2. Field completeness (how many identity fields are populated)
  3. Cross-validation (if OCR text available, compare with parser output)

Routing:
  - Score >= 85: auto-accept into master library + restaurant dataset
  - Score 50-84: queue for dev review
  - Score < 50:  auto-reject (flag for reprocessing)

Dev review: 10-20% random sample of high-confidence results + all low-confidence.
"""

import hashlib
import logging
import random
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


# =============================================================================
# QUALITY RESULT
# =============================================================================


@dataclass
class QualityResult:
    """Result of quality scoring for an extraction."""

    composite_score: float = 0.0
    parser_confidence: float = 0.0
    field_completeness: float = 0.0
    cross_validation_score: float = 0.0
    decision: str = "reject"  # accept, review, reject
    flagged_for_review: bool = False
    review_reason: Optional[str] = None
    details: Dict[str, Any] = field(default_factory=dict)


@dataclass
class ReviewItem:
    """An extraction flagged for dev review."""

    review_id: str
    restaurant_name: str
    source_url: Optional[str] = None
    quality_score: float = 0.0
    review_reason: str = ""
    extraction_data: Dict[str, Any] = field(default_factory=dict)
    created_at: str = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )
    status: str = "pending"  # pending, approved, corrected, rejected


# =============================================================================
# QUALITY SCORER
# =============================================================================


class QualityScorer:
    """
    Scores extraction quality and routes to accept/review/reject.
    """

    # Thresholds (configurable)
    ACCEPT_THRESHOLD = 85.0
    REVIEW_THRESHOLD = 50.0
    RANDOM_SAMPLE_RATE = 0.15  # 15% of auto-accepted go to review

    # Identity fields that matter for wine dedup
    IDENTITY_FIELDS = [
        "wine_name",
        "producer",
        "vintage",
        "country",
        "region",
        "grape_variety",
        "classification",
        "wine_type",
    ]

    # Weights for composite score
    WEIGHT_PARSER = 0.40
    WEIGHT_COMPLETENESS = 0.40
    WEIGHT_CROSS_VALIDATION = 0.20

    def __init__(
        self,
        accept_threshold: float = 85.0,
        review_threshold: float = 50.0,
        sample_rate: float = 0.15,
    ):
        self.accept_threshold = accept_threshold
        self.review_threshold = review_threshold
        self.sample_rate = sample_rate
        self._review_queue: List[ReviewItem] = []

    # =========================================================================
    # SCORE EXTRACTION
    # =========================================================================

    def score_extraction(
        self,
        wines: List[Dict[str, Any]],
        parser_confidence: float,
        ocr_text: Optional[str] = None,
        restaurant_name: str = "",
        source_url: Optional[str] = None,
    ) -> QualityResult:
        """
        Score the quality of a menu extraction.

        Args:
            wines: List of extracted wine dicts.
            parser_confidence: Overall parser confidence (0.0-1.0).
            ocr_text: Optional OCR text for cross-validation.
            restaurant_name: Restaurant name for review queue.
            source_url: Source URL for review queue.
        """
        result = QualityResult()

        if not wines:
            result.composite_score = 0.0
            result.decision = "reject"
            result.details["reason"] = "No wines extracted"
            return result

        # Signal 1: Parser confidence (0-100 scale)
        result.parser_confidence = parser_confidence * 100

        # Signal 2: Field completeness (0-100 scale)
        result.field_completeness = self._score_completeness(wines)

        # Signal 3: Cross-validation (0-100 scale, 100 if no OCR to compare)
        if ocr_text:
            result.cross_validation_score = self._cross_validate(wines, ocr_text)
        else:
            result.cross_validation_score = 80.0  # neutral if no cross-val

        # Composite score
        result.composite_score = (
            result.parser_confidence * self.WEIGHT_PARSER
            + result.field_completeness * self.WEIGHT_COMPLETENESS
            + result.cross_validation_score * self.WEIGHT_CROSS_VALIDATION
        )

        # Decision
        if result.composite_score >= self.accept_threshold:
            result.decision = "accept"
            # Random sample for dev review
            if random.random() < self.sample_rate:
                result.flagged_for_review = True
                result.review_reason = "random_sample"
        elif result.composite_score >= self.review_threshold:
            result.decision = "review"
            result.flagged_for_review = True
            result.review_reason = "low_confidence"
        else:
            result.decision = "reject"
            result.flagged_for_review = True
            result.review_reason = "very_low_confidence"

        # Add to review queue if flagged
        if result.flagged_for_review:
            review = ReviewItem(
                review_id=hashlib.md5(
                    f"{restaurant_name}_{datetime.now().isoformat()}".encode()
                ).hexdigest()[:12],
                restaurant_name=restaurant_name,
                source_url=source_url,
                quality_score=result.composite_score,
                review_reason=result.review_reason or "",
                extraction_data={
                    "wine_count": len(wines),
                    "wines": wines[:5],  # first 5 for preview
                    "parser_confidence": parser_confidence,
                },
            )
            self._review_queue.append(review)

        result.details = {
            "wine_count": len(wines),
            "parser_confidence_raw": parser_confidence,
            "completeness_score": result.field_completeness,
            "cross_validation": result.cross_validation_score,
            "composite": result.composite_score,
            "threshold_accept": self.accept_threshold,
            "threshold_review": self.review_threshold,
        }

        return result

    # =========================================================================
    # FIELD COMPLETENESS SCORING
    # =========================================================================

    def _score_completeness(self, wines: List[Dict[str, Any]]) -> float:
        """Score how complete the identity fields are across all wines."""
        if not wines:
            return 0.0

        scores = []
        for wine in wines:
            populated = 0
            for f in self.IDENTITY_FIELDS:
                val = wine.get(f)
                if val and val != "Unknown Wine" and val != "unknown":
                    populated += 1

            # wine_name is required, bonus for having it
            if wine.get("wine_name") and wine["wine_name"] != "Unknown Wine":
                score = (populated / len(self.IDENTITY_FIELDS)) * 100
            else:
                score = 0.0

            scores.append(score)

        return sum(scores) / len(scores)

    # =========================================================================
    # CROSS-VALIDATION
    # =========================================================================

    def _cross_validate(self, wines: List[Dict[str, Any]], ocr_text: str) -> float:
        """
        Cross-validate parser output against raw OCR text.
        Check if extracted wine names appear in the OCR text.
        """
        if not wines or not ocr_text:
            return 80.0  # neutral

        ocr_lower = ocr_text.lower()
        matches = 0
        total = 0

        for wine in wines:
            name = wine.get("wine_name", "")
            if not name or name == "Unknown Wine":
                continue

            total += 1
            # Check if significant parts of wine name appear in OCR text
            name_lower = name.lower()
            words = [w for w in name_lower.split() if len(w) > 3]

            if not words:
                matches += 0.5
                continue

            word_matches = sum(1 for w in words if w in ocr_lower)
            match_ratio = word_matches / len(words)

            if match_ratio >= 0.5:
                matches += 1
            elif match_ratio > 0:
                matches += 0.5

        if total == 0:
            return 80.0

        return (matches / total) * 100

    # =========================================================================
    # REVIEW QUEUE
    # =========================================================================

    def get_review_queue(self) -> List[ReviewItem]:
        """Get current review queue."""
        return [r for r in self._review_queue if r.status == "pending"]

    def approve_review(self, review_id: str) -> bool:
        """Approve a review item."""
        for r in self._review_queue:
            if r.review_id == review_id:
                r.status = "approved"
                return True
        return False

    def reject_review(self, review_id: str) -> bool:
        """Reject a review item."""
        for r in self._review_queue:
            if r.review_id == review_id:
                r.status = "rejected"
                return True
        return False

    def correct_review(self, review_id: str, corrected_data: Dict[str, Any]) -> bool:
        """Mark a review as corrected with updated data."""
        for r in self._review_queue:
            if r.review_id == review_id:
                r.status = "corrected"
                r.extraction_data["corrections"] = corrected_data
                return True
        return False

    def get_review_stats(self) -> Dict[str, int]:
        """Get review queue statistics."""
        stats = {"pending": 0, "approved": 0, "rejected": 0, "corrected": 0}
        for r in self._review_queue:
            stats[r.status] = stats.get(r.status, 0) + 1
        return stats


# =============================================================================
# MODULE-LEVEL SINGLETON
# =============================================================================

_scorer_instance: Optional[QualityScorer] = None


def get_quality_scorer(**kwargs) -> QualityScorer:
    """Get module-level singleton quality scorer."""
    global _scorer_instance
    if _scorer_instance is None:
        _scorer_instance = QualityScorer(**kwargs)
    return _scorer_instance

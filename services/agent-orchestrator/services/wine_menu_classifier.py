"""
Wine Menu Classifier
====================
Fast, local quality gate that determines whether extracted text
is actually a wine menu before running the full parsing pipeline.

No API calls. Pure regex + keyword + structure analysis.

Returns:
  - is_wine_menu: bool
  - confidence: 0.0-1.0
  - estimated_wine_count: int
  - content_type: 'wine_menu' | 'food_menu' | 'about_page' | 'terms' | 'blog' | 'other'
"""

import re
import logging
from dataclasses import dataclass
from typing import Dict, List

logger = logging.getLogger(__name__)


# =============================================================================
# WINE SIGNAL PATTERNS
# =============================================================================

WINE_SIGNALS: Dict[str, List[re.Pattern]] = {
    "wine_type_keywords": [
        re.compile(
            r"\b(?:red|white|ros[eé]|sparkling|dessert|fortified)\s+wines?\b", re.I
        ),
        re.compile(r"\b(?:reds|whites|bubbles|sparklings)\b", re.I),
    ],
    "wine_regions": [
        re.compile(
            r"\b(?:bordeaux|burgundy|champagne|napa|sonoma|tuscany|toscana|"
            r"piemonte|piedmont|rioja|barolo|barossa|marlborough|willamette|"
            r"côtes?\s+du\s+rhône|saint-[eé]milion|pauillac|margaux|pommard|"
            r"meursault|chablis|sancerre|pouilly|chianti|brunello|barbaresco|"
            r"languedoc|provence|alsace|loire|mosel|ribera\s+del\s+duero|"
            r"priorat|rueda|douro|mendoza|stellenbosch|mclaren\s+vale|"
            r"paso\s+robles|santa\s+barbara|columbia\s+valley)\b",
            re.I,
        ),
    ],
    "grape_varieties": [
        re.compile(
            r"\b(?:cabernet\s+sauvignon|chardonnay|pinot\s+noir|merlot|"
            r"sauvignon\s+blanc|riesling|syrah|shiraz|malbec|zinfandel|"
            r"sangiovese|nebbiolo|tempranillo|grenache|mourvedre|viognier|"
            r"gewurztraminer|chenin\s+blanc|semillon|gamay|barbera|"
            r"primitivo|gruner\s+veltliner|albarino|verdejo|trebbiano|"
            r"vermentino|muscadet|pinot\s+grigio|pinot\s+gris|"
            r"cabernet\s+franc|petit\s+verdot|carmenere)\b",
            re.I,
        ),
    ],
    "wine_terms": [
        re.compile(
            r"\b(?:vintage|sommelier|cuvée|cuvee|grand\s+cru|premier\s+cru|"
            r"reserva|riserva|brut|prosecco|cava|champagne|"
            r"appellation|terroir|tannins?|bouquet|decant|"
            r"blanc\s+de\s+blancs|blanc\s+de\s+noirs|"
            r"methode\s+(?:traditionnelle|champenoise)|"
            r"vino|vin\s+de|denominazione|denominacion|"
            r"estate\s+grown|single\s+vineyard|old\s+vine[s]?|"
            r"barrel\s+aged|oak\s+aged|biodynamic|"
            r"by\s+the\s+glass|half\s+bottle|magnum)\b",
            re.I,
        ),
    ],
    "vintage_pattern": [
        re.compile(r"\b(?:19|20)\d{2}\b"),
    ],
    "price_with_context": [
        re.compile(r"(?:\$|€|£)\s*\d{2,4}(?:\.\d{2})?"),
        re.compile(r"\d{2,4}(?:\.\d{2})?\s*(?:\$|€|£)"),
    ],
    "wine_producer_pattern": [
        re.compile(
            r"\b(?:ch[aâ]teau|domaine|tenuta|bodega|weingut|maison|"
            r"cantina|estate|vineyard|winery|vignoble|fattoria|"
            r"castello|finca|azienda|cave|clos)\b",
            re.I,
        ),
    ],
    "bottle_serving": [
        re.compile(
            r"\b(?:750\s*ml|375\s*ml|1\.5\s*[lL]|magnum|glass|bottle|carafe|btl)\b",
            re.I,
        ),
    ],
    # Turkish & non-Latin wine signals (producer names, grape varieties, terms)
    "turkish_wine_signals": [
        re.compile(
            r"\b(?:narince|emir|sultaniye|kalecik\s*karas[ıi]|öküzgözü|okuzyozu|"
            r"bogazkere|bo[gğ]azkere|papazkarası|papazkarasi|"
            r"kavaklidere|kavalid[eé]re|doluca|kayra|pamukkale\s+?winery|"
            r"çankaya|cankaya|ancyra|villa\s+doluca|"
            r"beyaz\s+şarap|beyaz\s+sarap|kırmızı\s+şarap|kirmizi\s+sarap|"
            r"rosé\s+şarap|ros[eé]\s+sarap|köpüklü|kopuklu|şampanya|sampanya|"
            r"üzüm|uzum|bağ\s+evi|bag\s+evi)\b",
            re.I,
        ),
        # TRY price pattern (e.g. "890 TRY" or "TRY 890")
        re.compile(r"\b(?:TRY|₺)\s*\d{2,5}|\d{2,5}\s*(?:TRY|₺)\b"),
    ],
    # Greek, Georgian, Armenian, Arabic wine signals (extend as markets expand)
    "eastern_wine_signals": [
        re.compile(
            r"\b(?:assyrtiko|xinomavro|agiorgitiko|moschofilero|"
            r"rkatsiteli|saperavi|areni|"
            r"chateau\s+musar|chateau\s+ksara|bekaa\s+valley)\b",
            re.I,
        ),
    ],
}

# Non-wine signals (high presence means NOT a wine menu)
NON_WINE_SIGNALS: Dict[str, List[re.Pattern]] = {
    "food_keywords": [
        re.compile(
            r"\b(?:appetizer|entree|entrée|main\s+course|desserts?|"
            r"soup|salad|pasta|steak|chicken|fish|seafood|"
            r"sandwich|burger|pizza|sushi|breakfast|lunch|dinner|"
            r"vegetarian|vegan|gluten[\s-]?free|sides?|"
            r"french\s+fries|mashed\s+potato|grilled|fried|"
            r"calories|allergen|ingredients)\b",
            re.I,
        ),
    ],
    "terms_page": [
        re.compile(
            r"\b(?:terms\s+(?:of\s+(?:service|use))|privacy\s+policy|"
            r"cookie\s+policy|refund\s+policy|disclaimer|"
            r"copyright|all\s+rights\s+reserved|"
            r"subscribe|newsletter|sign\s+up|login|"
            r"contact\s+us|about\s+us|our\s+story|"
            r"careers|job\s+openings|employment)\b",
            re.I,
        ),
    ],
    "blog_news": [
        re.compile(
            r"\b(?:posted\s+(?:on|by)|read\s+more|continue\s+reading|"
            r"share\s+this|comments?\s*\(\d+\)|tags?:|category:|"
            r"related\s+(?:posts|articles)|previous\s+post|next\s+post|"
            r"published|author|blog)\b",
            re.I,
        ),
    ],
}


# =============================================================================
# CLASSIFIER RESULT
# =============================================================================


@dataclass
class ClassificationResult:
    """Result of wine menu classification."""

    is_wine_menu: bool
    confidence: float
    estimated_wine_count: int
    content_type: str  # wine_menu, food_menu, about_page, terms, blog, other
    wine_signal_count: int
    non_wine_signal_count: int
    wine_density: float  # wine signals per 100 chars
    details: Dict[str, int]


# =============================================================================
# CLASSIFIER
# =============================================================================


class WineMenuClassifier:
    """
    Fast local classifier to determine if text is a wine menu.
    No API calls -- pure regex + keyword analysis.
    """

    # Thresholds
    WINE_SIGNAL_THRESHOLD = 5  # minimum wine signals to classify as wine menu
    WINE_DENSITY_THRESHOLD = 0.02  # minimum wine signals per 100 chars
    NON_WINE_RATIO_THRESHOLD = 2.0  # if non-wine/wine ratio > this, not wine menu

    def classify(self, text: str) -> ClassificationResult:
        """
        Classify whether the given text is a wine menu.

        Args:
            text: Raw text to classify.

        Returns:
            ClassificationResult with classification details.
        """
        if not text or len(text.strip()) < 20:
            return ClassificationResult(
                is_wine_menu=False,
                confidence=0.0,
                estimated_wine_count=0,
                content_type="other",
                wine_signal_count=0,
                non_wine_signal_count=0,
                wine_density=0.0,
                details={},
            )

        # Count wine signals
        wine_counts: Dict[str, int] = {}
        total_wine = 0
        for category, patterns in WINE_SIGNALS.items():
            count = 0
            for pattern in patterns:
                matches = pattern.findall(text)
                count += len(matches)
            wine_counts[category] = count
            total_wine += count

        # Count non-wine signals
        non_wine_counts: Dict[str, int] = {}
        total_non_wine = 0
        for category, patterns in NON_WINE_SIGNALS.items():
            count = 0
            for pattern in patterns:
                matches = pattern.findall(text)
                count += len(matches)
            non_wine_counts[category] = count
            total_non_wine += count

        # Wine density (signals per 100 chars)
        text_len = max(len(text), 1)
        wine_density = (total_wine / text_len) * 100

        # Estimate wine count (rough: vintages + price patterns)
        vintage_count = wine_counts.get("vintage_pattern", 0)
        price_count = wine_counts.get("price_with_context", 0)
        # Turkish/eastern price signals also count as wine entries
        turkish_count = wine_counts.get("turkish_wine_signals", 0)
        eastern_count = wine_counts.get("eastern_wine_signals", 0)
        estimated_wines = max(vintage_count, price_count, turkish_count + eastern_count)

        # Determine content type
        content_type, is_wine, confidence = self._determine_type(
            wine_counts,
            non_wine_counts,
            total_wine,
            total_non_wine,
            wine_density,
            estimated_wines,
            text_len,
        )

        all_details = {
            **{f"wine_{k}": v for k, v in wine_counts.items()},
            **{f"non_{k}": v for k, v in non_wine_counts.items()},
        }

        return ClassificationResult(
            is_wine_menu=is_wine,
            confidence=confidence,
            estimated_wine_count=estimated_wines,
            content_type=content_type,
            wine_signal_count=total_wine,
            non_wine_signal_count=total_non_wine,
            wine_density=wine_density,
            details=all_details,
        )

    def _determine_type(
        self,
        wine_counts: Dict[str, int],
        non_wine_counts: Dict[str, int],
        total_wine: int,
        total_non_wine: int,
        wine_density: float,
        estimated_wines: int,
        text_len: int,
    ) -> tuple:
        """Determine content type and wine menu probability."""

        # Strong non-wine signals
        if non_wine_counts.get("terms_page", 0) >= 3:
            return ("terms", False, 0.95)

        if non_wine_counts.get("blog_news", 0) >= 3:
            return ("blog", False, 0.90)

        # Strong wine signals
        if total_wine >= self.WINE_SIGNAL_THRESHOLD * 3:
            confidence = min(0.95, 0.7 + (total_wine / 100))
            return ("wine_menu", True, confidence)

        # Mixed: food + wine
        food_count = non_wine_counts.get("food_keywords", 0)
        if food_count > total_wine and food_count >= 5:
            return ("food_menu", False, 0.75)

        # Check against thresholds
        if total_wine >= self.WINE_SIGNAL_THRESHOLD:
            if wine_density >= self.WINE_DENSITY_THRESHOLD:
                confidence = min(0.90, 0.5 + wine_density * 10 + (total_wine / 50))
                return ("wine_menu", True, confidence)

        # Moderate wine signals
        if total_wine >= 3 and estimated_wines >= 5:
            return ("wine_menu", True, 0.60)

        # Low wine signals
        if total_wine >= 2:
            if total_non_wine <= total_wine:
                return ("wine_menu", True, 0.45)
            return ("other", False, 0.40)

        # Very few signals
        if total_wine >= 1:
            return ("other", False, 0.30)

        return ("other", False, 0.10)


# =============================================================================
# MODULE-LEVEL SINGLETON
# =============================================================================

_classifier_instance = None


def get_classifier() -> WineMenuClassifier:
    """Get module-level singleton classifier."""
    global _classifier_instance
    if _classifier_instance is None:
        _classifier_instance = WineMenuClassifier()
    return _classifier_instance

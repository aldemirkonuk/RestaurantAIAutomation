"""
Critic Score Service
====================
Phase 10: Pure Python service for score parsing, normalization, composite computation,
and markup ratio calculation. No DB calls — all methods are stateless and testable.

Used by jobs/score_tasks.py inside _score_async().
"""

import logging
import re
from typing import Dict, List, Optional, Any

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Score weights (D-05 LOCKED — not user-configurable in Phase 10)
# ---------------------------------------------------------------------------
SCORE_WEIGHTS: Dict[str, float] = {
    "wine_advocate": 0.30,
    "wine_spectator": 0.25,
    "vivino": 0.20,
    "decanter": 0.15,
    "jancis_robinson": 0.10,
}

# ---------------------------------------------------------------------------
# Regex patterns for score extraction from Serper snippets
# ---------------------------------------------------------------------------
# 100-pt scale: Wine Advocate, Wine Spectator, Decanter
_WA_WS_DEC_RE = re.compile(r'\b(9[0-9]|8[5-9])\s*(?:points?|pts?|/100)?\b', re.IGNORECASE)
_SCORE_LABEL_RE = re.compile(r'(?:score|rated?|points?)[:\s]+(\d{2,3})\b', re.IGNORECASE)
# Vivino 5-pt scale with decimal
_VIVINO_RE = re.compile(r'\b([3-5]\.\d)\s*(?:out of 5|/5|stars?)?\b', re.IGNORECASE)
# JancisRobinson 20-pt
_JR_RE = re.compile(r'\b(1[2-9](?:\.\d)?|20(?:\.0)?)\s*(?:/20|out of 20)\b', re.IGNORECASE)
_JR_LABEL_RE = re.compile(r'(\d{2}(?:\.\d)?)\s*points?\b', re.IGNORECASE)  # fallback for "16.5 points"
# Wine-Searcher retail price
_WS_PRICE_RE = re.compile(r'\$\s*(\d+(?:\.\d{2})?)\s*(?:average|avg|/bottle)?\b', re.IGNORECASE)
_WS_FROM_RE = re.compile(r'(?:from|starting at)\s*\$\s*(\d+(?:\.\d{2})?)', re.IGNORECASE)

# Domain → source key mapping
_DOMAIN_SOURCE: Dict[str, str] = {
    "wineadvocate.com": "wine_advocate",
    "winespectator.com": "wine_spectator",
    "vivino.com": "vivino",
    "decanter.com": "decanter",
    "jancisrobinson.com": "jancis_robinson",
    "wine-searcher.com": "wine_searcher",
}


def normalize_score(source: str, raw_score: float) -> float:
    """
    CRIT-02: Convert source-native scale to 0-100.

    vivino:          score * 20  (5-pt → 100-pt)
    jancis_robinson: score * 5   (20-pt → 100-pt)
    all others:      pass-through (already 0-100)
    """
    if source == "vivino":
        return round(raw_score * 20, 1)
    elif source == "jancis_robinson":
        return round(raw_score * 5, 1)
    else:
        return round(raw_score, 1)


def compute_composite_score(scores: Dict[str, Dict[str, Any]]) -> Optional[float]:
    """
    CRIT-03: Weighted composite. Returns None if < 2 sources available.

    Weights: WA 30%, WS 25%, Vivino 20%, Decanter 15%, JR 10%.
    Only sources in SCORE_WEIGHTS count toward composite.
    """
    available = {
        src: data["normalized_score"]
        for src, data in scores.items()
        if isinstance(data, dict) and data.get("normalized_score") is not None
        and src in SCORE_WEIGHTS
    }
    if len(available) < 2:
        return None
    total_weight = sum(SCORE_WEIGHTS[src] for src in available)
    if total_weight == 0:
        return None
    weighted_sum = sum(SCORE_WEIGHTS[src] * score for src, score in available.items())
    return round(weighted_sum / total_weight, 1)


def build_critic_score_queries(
    wine_name: str,
    producer: Optional[str],
    vintage: Optional[int],
) -> Dict[str, str]:
    """
    Build Serper search query strings for each scoring source + retail pricing.

    Returns dict with keys: wine_advocate, wine_spectator, vivino, decanter,
                             jancis_robinson, wine_searcher
    """
    # Strip bin numbers and parentheticals from wine_name
    clean_name = re.sub(r'\s*\(.*?\)', '', wine_name).strip()
    clean_name = re.sub(r'^\d+\.\s*', '', clean_name).strip()

    vintage_str = str(vintage) if vintage else ""
    # Use producer + name when producer is known; fall back to name alone
    base = f"{producer} {clean_name}" if producer else clean_name
    base_with_vintage = f"{base} {vintage_str}".strip() if vintage_str else base

    return {
        "wine_advocate": f'"{base_with_vintage}" wine advocate score',
        "wine_spectator": f'"{base_with_vintage}" wine spectator rating',
        "vivino": f'"{base_with_vintage}" vivino rating',
        "decanter": f'"{base_with_vintage}" decanter score points',
        "jancis_robinson": f'"{base_with_vintage}" jancis robinson score',
        "wine_searcher": f'"{base_with_vintage}" wine-searcher average price',
    }


def _detect_source_from_link(link: str) -> Optional[str]:
    """Determine score source from result URL domain."""
    for domain, source in _DOMAIN_SOURCE.items():
        if domain in link:
            return source
    return None


def parse_serper_score_snippets(
    results: List[Dict[str, str]],
    expected_source: str,
) -> Optional[Dict[str, Any]]:
    """
    Extract score from Serper result list for a given source.

    Tries each result in order; returns first successful parse.
    Returns None if no score found in any result (graceful not_found per D-01c).

    Returns dict: {
        "raw_score": float,
        "normalized_score": float,
        "source": str,         # e.g. "wine_advocate"
        "review_date": None,   # populated if date found in snippet
        "reviewer": None,      # populated if reviewer name found
        "link": str,
        "snippet": str,
    }
    """
    if not results:
        return None

    for result in results:
        title = result.get("title", "")
        snippet = result.get("snippet", "")
        link = result.get("link", "")
        text = f"{title} {snippet}"

        # Determine actual source from link; fall back to expected_source
        detected_source = _detect_source_from_link(link) or expected_source

        raw_score: Optional[float] = None

        if detected_source == "vivino":
            m = _VIVINO_RE.search(text)
            if m:
                raw_score = float(m.group(1))
        elif detected_source == "jancis_robinson":
            m = _JR_RE.search(text)
            if m:
                raw_score = float(m.group(1))
            else:
                # Fallback: "16.5 points" when jancisrobinson.com in link
                if "jancisrobinson" in link:
                    m = _JR_LABEL_RE.search(text)
                    if m:
                        raw_score = float(m.group(1))
        elif detected_source == "wine_searcher":
            m = _WS_PRICE_RE.search(text)
            if m:
                raw_score = float(m.group(1))
            else:
                m = _WS_FROM_RE.search(text)
                if m:
                    raw_score = float(m.group(1))
        else:
            # WA, WS, Decanter — 100-point scale
            m = _WA_WS_DEC_RE.search(text)
            if m:
                raw_score = float(m.group(1))
            if raw_score is None:
                m = _SCORE_LABEL_RE.search(text)
                if m:
                    raw_score = float(m.group(1))

        if raw_score is not None:
            return {
                "raw_score": raw_score,
                "normalized_score": normalize_score(detected_source, raw_score),
                "source": detected_source,
                "review_date": None,
                "reviewer": None,
                "link": link,
                "snippet": snippet,
            }

    return None


def classify_markup(markup_ratio: float) -> str:
    """
    CRIT-05: Classify markup ratio into tier string.

    < 1.5   → "value"
    1.5-2.5 → "standard"
    2.5-4.0 → "premium"
    > 4.0   → "luxury_markup"
    """
    if markup_ratio < 1.5:
        return "value"
    elif markup_ratio < 2.5:
        return "standard"
    elif markup_ratio <= 4.0:
        return "premium"
    else:
        return "luxury_markup"


def compute_markup_info(
    menu_price: Optional[float],
    retail_price_avg: Optional[float],
) -> Optional[Dict[str, Any]]:
    """
    CRIT-05 / CRIT-06: Compute markup_ratio, classification, and anomaly flag.

    Returns None if either price is missing/zero (cannot compute ratio).
    Returns dict:
        {
            "markup_ratio": float,           # menu_price / retail_price_avg
            "markup_classification": str,    # value | standard | premium | luxury_markup
            "is_anomaly": bool,              # True if ratio > 5.0 or < 0.8 (CRIT-06)
        }
    """
    if menu_price is None or retail_price_avg is None or retail_price_avg == 0:
        return None
    ratio = round(menu_price / retail_price_avg, 4)
    classification = classify_markup(ratio)
    is_anomaly = ratio > 5.0 or ratio < 0.8
    return {
        "markup_ratio": ratio,
        "markup_classification": classification,
        "is_anomaly": is_anomaly,
    }


class CriticScoreService:
    """
    Thin facade that exposes all score functions as instance methods.
    Stateless — no DB calls, no external I/O.
    """

    def normalize_score(self, source: str, raw_score: float) -> float:
        return normalize_score(source, raw_score)

    def compute_composite_score(self, scores: Dict[str, Dict[str, Any]]) -> Optional[float]:
        return compute_composite_score(scores)

    def build_critic_score_queries(
        self, wine_name: str, producer: Optional[str], vintage: Optional[int]
    ) -> Dict[str, str]:
        return build_critic_score_queries(wine_name, producer, vintage)

    def parse_serper_score_snippets(
        self, results: List[Dict[str, str]], expected_source: str
    ) -> Optional[Dict[str, Any]]:
        return parse_serper_score_snippets(results, expected_source)

    def compute_markup_info(
        self, menu_price: Optional[float], retail_price_avg: Optional[float]
    ) -> Optional[Dict[str, Any]]:
        return compute_markup_info(menu_price, retail_price_avg)

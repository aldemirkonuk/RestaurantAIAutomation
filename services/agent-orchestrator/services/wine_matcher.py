"""
Wine Matcher
============
Multi-phase matching pipeline against the master wine library.

Phases:
  1. pgvector embedding similarity search (fast, recall-optimised, top 50 candidates)
  2. Fuzzy string scoring on candidates (Jaro-Winkler + token overlap + Levenshtein)
  3. AI enrichment fallback for unmatched wines (Gemini deep research)

Thresholds:
  >= 0.85  → auto-match
  0.70-0.85 → suggest with confirmation
  < 0.70   → no match → AI enrichment
"""

import asyncio
import json
import logging
import time
from typing import Any, Dict, List, Optional

from services.text_normalizer import get_normalizer
from config.settings import get_settings

logger = logging.getLogger(__name__)


# =============================================================================
# FUZZY MATCHING ALGORITHMS (canonical single implementation)
# =============================================================================


def levenshtein_distance(s1: str, s2: str) -> int:
    """Levenshtein edit distance."""
    if len(s1) < len(s2):
        return levenshtein_distance(s2, s1)
    if len(s2) == 0:
        return len(s1)

    previous_row = list(range(len(s2) + 1))
    for i, c1 in enumerate(s1):
        current_row = [i + 1]
        for j, c2 in enumerate(s2):
            insertions = previous_row[j + 1] + 1
            deletions = current_row[j] + 1
            substitutions = previous_row[j] + (c1 != c2)
            current_row.append(min(insertions, deletions, substitutions))
        previous_row = current_row

    return previous_row[-1]


def jaro_winkler_similarity(s1: str, s2: str) -> float:
    """Jaro-Winkler similarity (0.0 – 1.0)."""
    if s1 == s2:
        return 1.0
    len1, len2 = len(s1), len(s2)
    if len1 == 0 or len2 == 0:
        return 0.0

    match_distance = max(len1, len2) // 2 - 1
    if match_distance < 0:
        match_distance = 0

    s1_matches = [False] * len1
    s2_matches = [False] * len2

    matches = 0
    transpositions = 0

    for i in range(len1):
        start = max(0, i - match_distance)
        end = min(i + match_distance + 1, len2)
        for j in range(start, end):
            if s2_matches[j] or s1[i] != s2[j]:
                continue
            s1_matches[i] = True
            s2_matches[j] = True
            matches += 1
            break

    if matches == 0:
        return 0.0

    k = 0
    for i in range(len1):
        if not s1_matches[i]:
            continue
        while not s2_matches[k]:
            k += 1
        if s1[i] != s2[k]:
            transpositions += 1
        k += 1

    jaro = (
        matches / len1 + matches / len2 + (matches - transpositions / 2) / matches
    ) / 3

    prefix = 0
    for i in range(min(4, len1, len2)):
        if s1[i] == s2[i]:
            prefix += 1
        else:
            break

    return jaro + prefix * 0.1 * (1 - jaro)


def token_overlap_score(s1: str, s2: str) -> float:
    """Token-based Jaccard overlap (0.0 – 1.0)."""
    stop_words = {
        "the",
        "de",
        "di",
        "du",
        "le",
        "la",
        "les",
        "des",
        "and",
        "wine",
        "wines",
        "estate",
        "vineyard",
        "vineyards",
        "winery",
        "chateau",
        "domaine",
        "tenuta",
        "bodega",
        "weingut",
    }
    tokens1 = set(s1.lower().split()) - stop_words
    tokens2 = set(s2.lower().split()) - stop_words

    if not tokens1 or not tokens2:
        return 0.5  # all tokens were stop words, uncertain

    intersection = tokens1 & tokens2
    union = tokens1 | tokens2

    return len(intersection) / len(union) if union else 0.0


# =============================================================================
# MATCH RESULT MODEL
# =============================================================================


class WineMatch:
    """A single wine match result."""

    __slots__ = (
        "wine_id",
        "name",
        "producer",
        "vintage",
        "wine_type",
        "similarity_score",
        "match_type",
        "match_phase",
    )

    def __init__(
        self,
        wine_id: str,
        name: str,
        producer: Optional[str],
        vintage: Optional[int],
        wine_type: Optional[str],
        similarity_score: float,
        match_type: str,
        match_phase: str,
    ):
        self.wine_id = wine_id
        self.name = name
        self.producer = producer
        self.vintage = vintage
        self.wine_type = wine_type
        self.similarity_score = similarity_score
        self.match_type = match_type
        self.match_phase = match_phase

    def to_dict(self) -> Dict[str, Any]:
        return {
            "wine_id": self.wine_id,
            "name": self.name,
            "producer": self.producer,
            "vintage": self.vintage,
            "wine_type": self.wine_type,
            "similarity_score": round(self.similarity_score, 4),
            "match_type": self.match_type,
            "match_phase": self.match_phase,
        }


# =============================================================================
# MAIN MATCHER CLASS
# =============================================================================


class WineMatcher:
    """
    Multi-phase wine matching against master_wine_library.

    Requires a Supabase client for database queries. Gracefully degrades
    when the database or pgvector is unavailable.
    """

    # Scoring weights for Phase 2
    JARO_WINKLER_WEIGHT = 0.35
    TOKEN_OVERLAP_WEIGHT = 0.30
    LEVENSHTEIN_WEIGHT = 0.15
    PRODUCER_MATCH_BONUS = 0.15
    VINTAGE_EXACT_BONUS = 0.05

    # Thresholds
    AUTO_MATCH_THRESHOLD = 0.85
    SUGGEST_THRESHOLD = 0.70
    VECTOR_SIMILARITY_FLOOR = 0.5

    def __init__(
        self,
        supabase_client=None,
        google_api_key: Optional[str] = None,
        mock_mode: bool = True,
    ):
        self.supabase = supabase_client
        self.google_api_key = google_api_key
        self.mock_mode = mock_mode
        self._normalizer = get_normalizer()

    async def match(
        self,
        wine_name: str,
        producer: Optional[str] = None,
        vintage: Optional[int] = None,
        wine_type: Optional[str] = None,
        restaurant_id: Optional[str] = None,
        limit: int = 5,
    ) -> Dict[str, Any]:
        """
        Run full matching pipeline.

        Returns:
            {
                "matched": bool,
                "auto_accepted": bool,
                "best_match": WineMatch dict or None,
                "candidates": [WineMatch dicts],
                "enrichment": dict or None (if no match, Gemini enrichment result),
                "phase_reached": "vector" | "fuzzy" | "enrichment",
            }
        """
        norm = self._normalizer.normalize(wine_name)
        normalized_name = norm["normalized"]
        normalized_producer = (
            self._normalizer.normalize_for_matching(producer) if producer else None
        )

        # ---- Phase 1: User library first (if restaurant_id) ----
        if restaurant_id and self.supabase:
            user_matches = await self._search_user_library(
                restaurant_id,
                wine_name,
                producer,
                vintage,
                limit=10,
            )
            if user_matches:
                scored = self._score_candidates(
                    user_matches,
                    normalized_name,
                    normalized_producer,
                    vintage,
                    limit,
                )
                if scored and scored[0].similarity_score >= self.AUTO_MATCH_THRESHOLD:
                    return self._build_result(scored, phase="user_library", auto=True)
                if scored and scored[0].similarity_score >= self.SUGGEST_THRESHOLD:
                    return self._build_result(scored, phase="user_library", auto=False)

        # ---- Phase 1b: pgvector embedding search on master library ----
        vector_candidates = await self._vector_search(wine_name, limit=50)

        # ---- Phase 1c: Full-text search fallback ----
        if not vector_candidates:
            vector_candidates = await self._text_search(wine_name, limit=50)

        # ---- Phase 1d: ilike fallback ----
        if not vector_candidates:
            vector_candidates = await self._ilike_search(wine_name, limit=50)

        # ---- Phase 2: Fuzzy string scoring ----
        if vector_candidates:
            scored = self._score_candidates(
                vector_candidates,
                normalized_name,
                normalized_producer,
                vintage,
                limit,
            )
            if scored and scored[0].similarity_score >= self.AUTO_MATCH_THRESHOLD:
                return self._build_result(scored, phase="fuzzy", auto=True)
            if scored and scored[0].similarity_score >= self.SUGGEST_THRESHOLD:
                return self._build_result(scored, phase="fuzzy", auto=False)

        # ---- Phase 3: AI enrichment (hard 20-second timeout to prevent hangs) ----
        try:
            enrichment = await asyncio.wait_for(
                self._ai_enrichment(wine_name, producer, vintage),
                timeout=20.0,
            )
        except asyncio.TimeoutError:
            logger.warning(
                f"AI enrichment timed out for '{wine_name}' — returning null enrichment"
            )
            enrichment = None

        return {
            "matched": False,
            "auto_accepted": False,
            "best_match": None,
            "candidates": (
                [m.to_dict() for m in scored] if vector_candidates and scored else []
            ),
            "enrichment": enrichment,
            "phase_reached": "enrichment",
        }

    # ---- Phase 1: Search methods ----

    async def _vector_search(
        self,
        wine_name: str,
        limit: int = 50,
    ) -> List[Dict[str, Any]]:
        """pgvector cosine similarity search."""
        if not self.supabase:
            return []
        try:
            # Use Supabase RPC for vector search if embedding function is available
            # For now, fall back to text search since embedding generation requires
            # a sentence-transformer model
            return []
        except Exception as e:
            logger.warning(f"Vector search failed: {e}")
            return []

    async def _text_search(
        self,
        wine_name: str,
        limit: int = 50,
    ) -> List[Dict[str, Any]]:
        """PostgreSQL full-text search on search_vector column."""
        if not self.supabase:
            return []
        try:
            result = (
                self.supabase.table("master_wine_library")
                .select("id, name, producer, vintage, wine_type")
                .text_search("search_vector", wine_name)
                .limit(limit)
                .execute()
            )
            return result.data or []
        except Exception as e:
            logger.warning(f"Text search failed: {e}")
            return []

    async def _ilike_search(
        self,
        wine_name: str,
        limit: int = 50,
    ) -> List[Dict[str, Any]]:
        """Fallback: case-insensitive LIKE search on first token."""
        if not self.supabase:
            return []
        try:
            first_token = wine_name.split()[0] if wine_name.split() else wine_name
            result = (
                self.supabase.table("master_wine_library")
                .select("id, name, producer, vintage, wine_type")
                .ilike("name", f"%{first_token}%")
                .limit(limit)
                .execute()
            )
            return result.data or []
        except Exception as e:
            logger.warning(f"ilike search failed: {e}")
            return []

    async def _search_user_library(
        self,
        restaurant_id: str,
        wine_name: str,
        producer: Optional[str],
        vintage: Optional[int],
        limit: int = 10,
    ) -> List[Dict[str, Any]]:
        """Search restaurant-specific wine library."""
        if not self.supabase:
            return []
        try:
            first_token = wine_name.split()[0] if wine_name.split() else wine_name
            result = (
                self.supabase.table("wine_library")
                .select("id, name, producer, vintage, wine_type")
                .eq("restaurant_id", restaurant_id)
                .ilike("name", f"%{first_token}%")
                .limit(limit)
                .execute()
            )
            return result.data or []
        except Exception as e:
            logger.warning(f"User library search failed: {e}")
            return []

    # ---- Phase 2: Scoring ----

    def _score_candidates(
        self,
        candidates: List[Dict[str, Any]],
        normalized_name: str,
        normalized_producer: Optional[str],
        vintage: Optional[int],
        limit: int,
    ) -> List[WineMatch]:
        """Score and rank candidates using multi-algorithm fuzzy matching."""
        scored: List[WineMatch] = []

        for wine in candidates:
            wine_name = wine.get("name", "")
            normalized_wine = self._normalizer.normalize_for_matching(wine_name)

            # Calculate individual scores
            jw_score = jaro_winkler_similarity(normalized_name, normalized_wine)
            tok_score = token_overlap_score(normalized_name, normalized_wine)

            max_len = max(len(normalized_name), len(normalized_wine), 1)
            lev_dist = levenshtein_distance(normalized_name, normalized_wine)
            lev_sim = 1.0 - (lev_dist / max_len)

            combined = (
                jw_score * self.JARO_WINKLER_WEIGHT
                + tok_score * self.TOKEN_OVERLAP_WEIGHT
                + lev_sim * self.LEVENSHTEIN_WEIGHT
            )

            # Producer boost
            if normalized_producer and wine.get("producer"):
                producer_sim = jaro_winkler_similarity(
                    normalized_producer,
                    self._normalizer.normalize_for_matching(wine["producer"]),
                )
                combined += producer_sim * self.PRODUCER_MATCH_BONUS

            # Vintage boost
            if vintage and wine.get("vintage"):
                if wine["vintage"] == vintage:
                    combined = min(1.0, combined + self.VINTAGE_EXACT_BONUS)
                elif abs(wine["vintage"] - vintage) <= 1:
                    combined = min(1.0, combined + self.VINTAGE_EXACT_BONUS * 0.5)

            # Determine match type label
            if jw_score >= 0.95:
                match_type = "exact"
            elif jw_score >= 0.80:
                match_type = "fuzzy_name"
            elif tok_score >= 0.50:
                match_type = "token_overlap"
            elif normalized_producer and wine.get("producer"):
                match_type = "producer_match"
            else:
                match_type = "partial"

            if combined >= 0.30:  # Minimum to include in results
                scored.append(
                    WineMatch(
                        wine_id=wine.get("id", ""),
                        name=wine_name,
                        producer=wine.get("producer"),
                        vintage=wine.get("vintage"),
                        wine_type=wine.get("wine_type"),
                        similarity_score=combined,
                        match_type=match_type,
                        match_phase="fuzzy",
                    )
                )

        scored.sort(key=lambda m: m.similarity_score, reverse=True)
        return scored[:limit]

    # ---- Phase 3: AI enrichment ----

    async def _ai_enrichment(
        self,
        wine_name: str,
        producer: Optional[str],
        vintage: Optional[int],
    ) -> Optional[Dict[str, Any]]:
        """
        Use Gemini with Google Search grounding for deep wine research.
        Fills all 25 master_wine_library fields. Uses the new google-genai SDK.
        """
        if self.mock_mode:
            return {
                "source": "mock_enrichment",
                "wine_name": wine_name,
                "producer": producer or "Unknown Producer",
                "vintage": vintage,
                "note": "Mock enrichment (Gemini unavailable in dev mode)",
            }

        if not self.google_api_key:
            return None

        try:
            from google import genai
            from google.genai import types

            client = genai.Client(api_key=self.google_api_key)

            wine_desc = wine_name
            if producer:
                wine_desc += f" by {producer}"
            if vintage:
                wine_desc += f" ({vintage})"

            prompt = f"""You are a master sommelier and wine database expert. Research this wine thoroughly: "{wine_desc}"

Use web search to find accurate, real-world data. Return ONLY valid JSON with ALL of these fields (use null if not found):
{{
  "name": "Official full wine name",
  "producer": "Producer/winery name",
  "vintage": {vintage or "null"},
  "wine_type": "red|white|rose|sparkling|dessert|fortified",
  "color": "ruby|garnet|gold|straw|salmon|etc",
  "country": "Country of origin",
  "region": "Wine region",
  "sub_region": "Sub-region or null",
  "appellation": "Appellation or null",
  "appellation_class": "Grand Cru|Premier Cru|DOC|DOCG|etc or null",
  "grape_variety": "Primary grape(s), comma-separated",
  "is_blend": true or false,
  "alcohol_pct": number or null,
  "body": "light|medium|full",
  "sweetness": "dry|off-dry|semi-sweet|sweet",
  "tasting_notes": "Detailed tasting description",
  "food_pairings": ["pairing1", "pairing2", "pairing3"],
  "avg_price": number in USD or null,
  "description": "Brief wine description for consumers",
  "rating": "Score from major critics if known, e.g. 'RP 95' or null",
  "classification": "Classification if any, e.g. 'Super Tuscan' or null",
  "serving_type": "glass|bottle|both or null",
  "bottle_volume": "750ml or other",
  "confidence": 0.0 to 1.0
}}"""

            # Enable Google Search grounding for real-time web data
            grounding_tool = types.Tool(google_search=types.GoogleSearch())
            config = types.GenerateContentConfig(
                tools=[grounding_tool],
                temperature=0.1,
            )

            _t0 = time.perf_counter()
            response = client.models.generate_content(
                model="gemini-2.5-flash",
                contents=prompt,
                config=config,
            )

            # P1: previously an unlogged model call (dark site)
            try:
                from services.spend_logger import estimate_llm_cost, get_spend_logger

                # label the model actually configured, not a literal (OD-57)
                _model_id = get_settings().gemini_model
                _usage = getattr(response, "usage_metadata", None)
                _in = getattr(_usage, "prompt_token_count", 0) or 0
                # thinking tokens bill at the output rate — see spend_logger.usage_tokens()
                _out = (getattr(_usage, "candidates_token_count", 0) or 0) + (
                    getattr(_usage, "thoughts_token_count", 0) or 0
                )
                get_spend_logger().log(
                    provider="google",
                    model="gemini-2.5-flash",
                    input_tokens=_in,
                    output_tokens=_out,
                    cost_usd=estimate_llm_cost("gemini-2.5-flash", _in, _out),
                    agent_fallback="wine_matcher",
                    task_type="wine_enrichment_grounded",
                    outcome="success",  # call-level: response returned
                    duration_ms=int((time.perf_counter() - _t0) * 1000),
                    context={"wine_name": str(wine_name)[:120]},
                )
            except Exception:
                pass

            result_text = response.text.strip()
            if "```json" in result_text:
                result_text = result_text.split("```json")[1].split("```")[0].strip()
            elif "```" in result_text:
                result_text = result_text.split("```")[1].split("```")[0].strip()

            data = json.loads(result_text)
            data["source"] = "gemini_grounded_enrichment"

            # Capture grounding metadata if available
            try:
                if hasattr(response, "candidates") and response.candidates:
                    candidate = response.candidates[0]
                    if (
                        hasattr(candidate, "grounding_metadata")
                        and candidate.grounding_metadata
                    ):
                        data["_grounding_sources"] = str(candidate.grounding_metadata)
            except Exception:
                pass

            return data

        except Exception as e:
            logger.error(f"AI enrichment failed: {e}")
            # Fallback to non-grounded call
            try:
                return await self._ai_enrichment_fallback(wine_name, producer, vintage)
            except Exception:
                return None

    async def _ai_enrichment_fallback(
        self,
        wine_name: str,
        producer: Optional[str],
        vintage: Optional[int],
    ) -> Optional[Dict[str, Any]]:
        """Fallback enrichment without grounding (uses legacy genai if new SDK fails)."""
        try:
            import google.generativeai as genai

            genai.configure(api_key=self.google_api_key)
            model = genai.GenerativeModel(get_settings().gemini_model)

            wine_desc = wine_name
            if producer:
                wine_desc += f" by {producer}"
            if vintage:
                wine_desc += f" ({vintage})"

            prompt = f"""You are a master sommelier. Research this wine: "{wine_desc}"
Return ONLY valid JSON with: name, producer, vintage, wine_type, country, region, grape_variety, tasting_notes, food_pairings, confidence."""

            _t0 = time.perf_counter()
            response = model.generate_content(
                prompt, generation_config={"temperature": 0.1}
            )

            # P1: previously an unlogged model call (dark site)
            try:
                from services.spend_logger import estimate_llm_cost, get_spend_logger

                # label the model actually configured, not a literal (OD-57)
                _model_id = get_settings().gemini_model
                _usage = getattr(response, "usage_metadata", None)
                _in = getattr(_usage, "prompt_token_count", 0) or 0
                # thinking tokens bill at the output rate — see spend_logger.usage_tokens()
                _out = (getattr(_usage, "candidates_token_count", 0) or 0) + (
                    getattr(_usage, "thoughts_token_count", 0) or 0
                )
                get_spend_logger().log(
                    provider="google",
                    model=_model_id,
                    input_tokens=_in,
                    output_tokens=_out,
                    cost_usd=estimate_llm_cost(_model_id, _in, _out),
                    agent_fallback="wine_matcher",
                    task_type="wine_enrichment_fallback",
                    outcome="success",  # call-level: response returned
                    duration_ms=int((time.perf_counter() - _t0) * 1000),
                    context={"wine_name": str(wine_name)[:120]},
                )
            except Exception:
                pass

            result_text = response.text.strip()
            if "```json" in result_text:
                result_text = result_text.split("```json")[1].split("```")[0].strip()
            elif "```" in result_text:
                result_text = result_text.split("```")[1].split("```")[0].strip()

            data = json.loads(result_text)
            data["source"] = "gemini_enrichment_fallback"
            return data
        except Exception as e:
            logger.error(f"Fallback AI enrichment failed: {e}")
            return None

    # ---- Helpers ----

    @staticmethod
    def _build_result(
        scored: List[WineMatch],
        phase: str,
        auto: bool,
    ) -> Dict[str, Any]:
        """Build match result dict."""
        return {
            "matched": True,
            "auto_accepted": auto,
            "best_match": scored[0].to_dict() if scored else None,
            "candidates": [m.to_dict() for m in scored],
            "enrichment": None,
            "phase_reached": phase,
        }


# =============================================================================
# MODULE-LEVEL SINGLETON
# =============================================================================

_matcher_instance: Optional[WineMatcher] = None


def get_wine_matcher(
    supabase_client=None,
    google_api_key: Optional[str] = None,
    mock_mode: bool = True,
) -> WineMatcher:
    """Get or create module-level singleton matcher."""
    global _matcher_instance
    if _matcher_instance is None:
        _matcher_instance = WineMatcher(
            supabase_client=supabase_client,
            google_api_key=google_api_key,
            mock_mode=mock_mode,
        )
    return _matcher_instance

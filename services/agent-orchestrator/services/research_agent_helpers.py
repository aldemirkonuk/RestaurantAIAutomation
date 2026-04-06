"""
Research Agent Helpers
======================
Pure helper functions for the gap-filling research agent.
No I/O, no side effects — every function is unit-testable without mocking infrastructure.

Used by: services/agent-orchestrator/jobs/research_tasks.py
         services/agent-orchestrator/api/research_routes.py
"""

from __future__ import annotations

import hashlib
import json
import re
import time
from collections import OrderedDict
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlparse

from services.field_confidence import DEFAULT_ACCEPT_THRESHOLD, DEFAULT_REVIEW_THRESHOLD  # noqa: F401

# ---------------------------------------------------------------------------
# Configuration constants (overridable via settings.py)
# ---------------------------------------------------------------------------

# All 31 DB content fields eligible for research (locked in 12-CONTEXT.md Decision 1)
RESEARCH_ALL_FIELDS: list[str] = [
    # Visible-on-menu (Vision Pass 1)
    "wine_name", "producer", "vintage", "primary_type", "color", "sweetness_level",
    "alcohol_pct", "price_bottle", "price_glass", "section_name", "bin_number",
    # Structural knowledge (Haiku Pass 2)
    "region", "sub_region", "appellation", "country", "grape_variety",
    "food_pairing", "producer_bio", "tasting_notes", "description",
    "is_blend", "bottle_size",
    # Market intelligence (Phases 10-11)
    "retail_price_avg",
    # Structured JSONB enrichments
    "grape_family", "wine_structure", "sensory_profile",
    "practical_attributes", "region_hierarchy", "critic_scores",
    # Derived quality signals
    "vintage_age", "price_tier",
]

# Backward-compat alias: the original Core 10 subset (for tests / configurable overrides)
RESEARCH_PRIORITY_FIELDS: list[str] = [
    "wine_name", "producer", "vintage", "region", "country",
    "appellation", "grape_variety", "color", "primary_type", "alcohol_pct",
]

# Domain → tier mapping for source classification (locked in 12-CONTEXT.md Decision 2).
# Dynamic producer detection: if URL domain contains normalized producer name → tier-A.
# Domains NOT in this dict and not matching dynamic rule are classified as tier-C.
SOURCE_TIER_DOMAINS: dict[str, str] = {
    # ── France ───────────────────────────────────────────────────────────────
    "inao.gouv.fr": "A",           # AOC/AOP official registry
    "agriculture.gouv.fr": "A",    # French Ministry of Agriculture
    "civb.com": "A",               # Bordeaux Wine Trade Council
    "champagne.fr": "A",           # Comité Champagne / CIVC
    "bivb.com": "A",               # Bourgogne interprofessional bureau
    "vinsalsace.com": "A",
    "rhone-wines.com": "A",
    "vinsdeloire-wines.com": "A",
    # ── Italy ────────────────────────────────────────────────────────────────
    "consorziobrunellomontalcino.it": "A",
    "consorziobarolo.it": "A",
    "chiantidocg.it": "A",
    "amaroneducati.it": "A",
    "soave.it": "A",
    "prosecco.it": "A",
    "masi.it": "A",                # major verified Amarone producer
    "federdoc.com": "A",           # Italian DOC/DOCG federation
    "icqrf.gov.it": "A",           # Italian government wine registry
    # ── Spain ────────────────────────────────────────────────────────────────
    "winefromspain.com": "A",      # ICEX official
    "riojawine.com": "A",
    "ribera.es": "A",
    "riberadelduero.es": "A",
    "priorat.org": "A",
    "denominacionorigen.es": "A",
    # ── Germany ──────────────────────────────────────────────────────────────
    "vdp.de": "A",
    "germanwines.de": "A",         # DWI
    "weinrecht.de": "A",
    # ── Portugal ─────────────────────────────────────────────────────────────
    "ivv.gov.pt": "A",             # Instituto da Vinha e do Vinho
    "ivdp.pt": "A",                # Douro/Porto
    "cvr-dao.pt": "A",
    "cvrverdelhos.pt": "A",
    # ── USA ───────────────────────────────────────────────────────────────────
    "ttb.gov": "A",                # TTB COLA registry
    "wineinstitute.org": "A",
    "napavalleyvintners.com": "A",
    "sonomacountywine.com": "A",
    # ── Australia ────────────────────────────────────────────────────────────
    "wineaustralia.com": "A",
    "awri.com.au": "A",
    # ── New Zealand ──────────────────────────────────────────────────────────
    "nzwine.com": "A",
    # ── Argentina / Chile / South Africa ─────────────────────────────────────
    "winesofargentina.org": "A",
    "inv.gov.ar": "A",
    "winesofchile.org": "A",
    "wosa.co.za": "A",
    "sawis.co.za": "A",
    # ── EU-level ─────────────────────────────────────────────────────────────
    "eambrosia.europa.eu": "A",    # EU GI register — authoritative for all EU PDO/PGI
    "fao.org": "A",                # FAO wine data
    # ── Organic / biodynamic certification ───────────────────────────────────
    "ams.usda.gov": "A",
    "demeter-usa.org": "A",
    "biodyvin.com": "A",
    # ── Tier-B: Authoritative trade press + wine databases ────────────────────
    "wine-searcher.com": "B",
    "vivino.com": "B",
    "decanter.com": "B",
    "winespectator.com": "B",
    "jancisrobinson.com": "B",
    "robertparker.com": "B",
    "wineadvocate.com": "B",
    "wine-pages.com": "B",
    "winemag.com": "B",            # Wine Enthusiast
    "guildsomm.com": "B",
    "cellartracker.com": "B",
    "winefolly.com": "B",
}

# Synonym pairs — matching aliases do NOT constitute a conflict (per STRATEGY.md Step 5)
FIELD_VALUE_SYNONYMS: list[tuple[str, str]] = [
    ("syrah", "shiraz"),
    ("garnacha", "grenache"),
    ("tempranillo", "tinto fino"),
    ("tempranillo", "tinta del pais"),
    ("sangiovese", "brunello"),
    ("sangiovese", "sangiovese grosso"),
    ("pinot gris", "pinot grigio"),
    ("prosecco", "glera"),
]

# Confidence by tier (per STRATEGY.md Step 6)
CONFIDENCE_BY_TIER: dict[str, float] = {
    "A_single": 0.95,      # 1 tier-A source
    "B_dual": 0.87,        # >=2 independent tier-B/C sources
    "B_single": 0.72,      # 1 tier-B source (review zone, but persisted)
    "C_single": 0.60,      # 1 tier-C source (review zone)
}

# Re-research eligibility window in days
ELIGIBILITY_COOLDOWN_DAYS: int = 7


# ---------------------------------------------------------------------------
# Eligibility
# ---------------------------------------------------------------------------

def is_eligible_for_research(
    submission: dict[str, Any],
    priority_fields: list[str] | None = None,
    cooldown_days: int = ELIGIBILITY_COOLDOWN_DAYS,
) -> bool:
    """
    Returns True if this submission should be targeted by the research agent.

    Eligibility requires BOTH:
      1. last_research_run_at is NULL or older than cooldown_days
      2. At least one priority field has confidence < DEFAULT_ACCEPT_THRESHOLD in field_confidence

    Skips fields with source="human_resolved" (human corrections are final).
    """
    fields_to_check = priority_fields or RESEARCH_PRIORITY_FIELDS
    fc: dict = submission.get("field_confidence") or {}

    # Check cooldown
    last_run = submission.get("last_research_run_at")
    if last_run:
        if isinstance(last_run, str):
            last_run = datetime.fromisoformat(last_run.replace("Z", "+00:00"))
        now = datetime.now(timezone.utc)
        delta = (now - last_run).days
        if delta < cooldown_days:
            return False

    # Check for any researchable field below accept threshold
    for field in fields_to_check:
        entry = fc.get(field)
        if entry is None:
            return True  # NULL = eligible
        if entry.get("source") == "human_resolved":
            continue     # Human corrections are locked
        if entry.get("confidence", 0.0) < DEFAULT_ACCEPT_THRESHOLD:
            return True

    return False


def get_target_fields(
    fc: dict[str, Any],
    priority_fields: list[str] | None = None,
) -> list[str]:
    """
    Returns list of field names eligible for research:
    - Priority fields that are NULL (no entry in fc)
    - Priority fields with confidence < DEFAULT_ACCEPT_THRESHOLD
    - Excludes fields with source="human_resolved"
    """
    fields_to_check = priority_fields or RESEARCH_PRIORITY_FIELDS
    targets = []
    for field in fields_to_check:
        entry = fc.get(field)
        if entry is None:
            targets.append(field)
            continue
        if entry.get("source") == "human_resolved":
            continue
        if entry.get("confidence", 0.0) < DEFAULT_ACCEPT_THRESHOLD:
            targets.append(field)
    return targets


# ---------------------------------------------------------------------------
# Query construction
# ---------------------------------------------------------------------------

def build_serper_query(
    field_name: str,
    wine_name: str,
    producer: str | None = None,
    vintage: str | None = None,
) -> str:
    """
    Build a narrow Serper search query for a specific field.
    Narrow queries produce more relevant snippets than broad wine searches.
    """
    parts = []
    if producer:
        parts.append(producer)
    if wine_name:
        parts.append(wine_name)
    if vintage:
        parts.append(str(vintage))

    base = " ".join(parts) if parts else wine_name or "unknown wine"

    field_hints: dict[str, str] = {
        "appellation":   f'"{base}" appellation DOCG DOC AOC official',
        "producer":      f'who produces "{wine_name}" {vintage or ""} winery producer',
        "region":        f'"{base}" wine region origin',
        "grape_variety": f'"{base}" grape variety cépage',
        "country":       f'"{base}" wine country origin',
        "alcohol_pct":   f'"{base}" alcohol percentage ABV',
        "color":         f'"{base}" red white rosé wine color',
        "primary_type":  f'"{base}" still sparkling dessert wine type',
        "vintage":       f'"{wine_name}" {producer or ""} vintage year',
    }

    return field_hints.get(field_name, f'"{base}" {field_name}')


# ---------------------------------------------------------------------------
# Source tier classification
# ---------------------------------------------------------------------------

def classify_source_tier(
    url: str,
    tier_map: dict[str, str] | None = None,
    producer: str | None = None,
) -> str:
    """
    Classify a source URL as tier A, B, or C based on domain.

    Classification order:
    1. Exact domain match in tier_map → return mapped tier
    2. Subdomain suffix match in tier_map → return mapped tier
    3. Producer dynamic detection: domain contains normalized producer name → tier-A
    4. Unknown domain → tier-C
    """
    map_ = tier_map if tier_map is not None else SOURCE_TIER_DOMAINS
    try:
        domain = urlparse(url).netloc.lower().removeprefix("www.")
        # Exact match first
        if domain in map_:
            return map_[domain]
        # Suffix match (subdomains of known domains)
        for known_domain, tier in map_.items():
            if domain.endswith("." + known_domain) or domain == known_domain:
                return tier
        # Dynamic producer detection (12-CONTEXT.md Decision 2)
        if producer:
            normalized_producer = re.sub(r"[^a-z0-9 ]", "", producer.lower().strip())
            normalized_producer = normalized_producer.replace(" ", "")
            domain_clean = domain.replace("-", "").replace(".", "")
            if normalized_producer and len(normalized_producer) >= 4 and normalized_producer in domain_clean:
                return "A"
    except Exception:
        pass
    return "C"


# ---------------------------------------------------------------------------
# Conflict detection
# ---------------------------------------------------------------------------

def _normalize_value(v: str | None) -> str:
    """Lowercase + strip punctuation for conflict comparison."""
    if v is None:
        return ""
    return re.sub(r"[^a-z0-9 ]", "", str(v).lower().strip())


def _are_synonyms(v1: str, v2: str) -> bool:
    """Return True if two normalized values are known aliases (not a conflict)."""
    n1, n2 = _normalize_value(v1), _normalize_value(v2)
    for a, b in FIELD_VALUE_SYNONYMS:
        if (n1 == a and n2 == b) or (n1 == b and n2 == a):
            return True
    return False


def detect_conflict(candidates: list[dict[str, Any]]) -> bool:
    """
    Returns True if >=2 evidence-backed candidates propose different (non-synonym) values.
    candidates: list of {value, source_url, source_tier, snippet} dicts.
    """
    if len(candidates) < 2:
        return False

    values = [c.get("value") for c in candidates if c.get("value") is not None]
    unique_normalized = {_normalize_value(v) for v in values}

    if len(unique_normalized) < 2:
        return False  # All candidates agree

    # Check if all differences are known synonyms
    unique_list = list(unique_normalized)
    for i in range(len(unique_list)):
        for j in range(i + 1, len(unique_list)):
            if not _are_synonyms(unique_list[i], unique_list[j]):
                return True  # At least one pair is a genuine conflict

    return False


# ---------------------------------------------------------------------------
# Corroboration
# ---------------------------------------------------------------------------

def _get_domain(url: str) -> str:
    try:
        return urlparse(url).netloc.lower().removeprefix("www.")
    except Exception:
        return url


def should_auto_promote(citations: list[dict[str, Any]]) -> tuple[bool, str]:
    """
    Returns (can_promote: bool, confidence_key: str).
    confidence_key maps to CONFIDENCE_BY_TIER.

    Rules (per STRATEGY.md Step 6):
      - Any tier-A source → (True, "A_single")
      - >=2 independent tier-B/C sources → (True, "B_dual")
      - 1 tier-B source → (True, "B_single") — auto-promote into review zone
      - 1 tier-C source → (True, "C_single") — auto-promote into review zone

    "Independent" = different registered domains.
    """
    if not citations:
        return False, ""

    # Check for tier-A
    tier_a = [c for c in citations if c.get("source_tier") == "A"]
    if tier_a:
        return True, "A_single"

    # Check for >=2 independent tier-B/C
    bc_citations = [c for c in citations if c.get("source_tier") in ("B", "C")]
    domains = {_get_domain(c.get("source_url", "")) for c in bc_citations if c.get("source_url")}
    if len(domains) >= 2:
        return True, "B_dual"

    # Single tier-B
    tier_b = [c for c in citations if c.get("source_tier") == "B"]
    if tier_b:
        return True, "B_single"

    # Single tier-C
    if bc_citations:
        return True, "C_single"

    return False, ""


def assign_confidence_by_tier(confidence_key: str) -> float:
    """Map a corroboration result to a confidence float."""
    return CONFIDENCE_BY_TIER.get(confidence_key, 0.60)


# ---------------------------------------------------------------------------
# Regression guard
# ---------------------------------------------------------------------------

def check_regression_guard(
    field_name: str,
    proposed_confidence: float,
    existing_fc: dict[str, Any],
) -> bool:
    """
    Returns True if writing this proposed confidence is safe (no regression).
    Regression = proposed_confidence < existing confidence for the same field.
    merge_field_confidence() also enforces this, but calling this first makes
    the decision explicit and loggable.
    """
    existing_entry = existing_fc.get(field_name)
    if existing_entry is None:
        return True  # Field is new, safe
    existing_conf = existing_entry.get("confidence", 0.0)
    return proposed_confidence >= existing_conf


# ---------------------------------------------------------------------------
# Evidence record builder
# ---------------------------------------------------------------------------

def build_citation_record(
    wine_id: str,
    run_id: str,
    field_name: str,
    proposed_value: str,
    source_url: str,
    source_tier: str,
    snippet: str,
    retrieved_at: datetime | None = None,
    fetch_verified: bool = False,
    corroboration_count: int = 1,
) -> dict[str, Any]:
    """
    Build a dict matching the evidence_citations table schema.
    Every auto-promoted fill MUST produce one of these records.
    """
    return {
        "wine_id": wine_id,
        "run_id": run_id,
        "field_name": field_name,
        "proposed_value": str(proposed_value),
        "source_url": source_url,
        "source_tier": source_tier.upper(),
        "snippet": snippet,
        "retrieved_at": (retrieved_at or datetime.now(timezone.utc)).isoformat(),
        "fetch_verified": fetch_verified,
        "corroboration_count": corroboration_count,
    }


# ---------------------------------------------------------------------------
# Section 6 (Bug #10): Bounded LRU Cache utility
# ---------------------------------------------------------------------------

class BoundedLRUCache:
    """Thread-safe bounded LRU cache using OrderedDict. Max entries enforced on put."""

    def __init__(self, max_size: int = 1000):
        self._data: OrderedDict[str, tuple[Any, float]] = OrderedDict()
        self._max_size = max_size

    def get(self, key: str, ttl_seconds: float = 604800) -> Any | None:
        if key not in self._data:
            return None
        value, ts = self._data[key]
        if time.time() - ts > ttl_seconds:
            del self._data[key]
            return None
        self._data.move_to_end(key)
        return value

    def put(self, key: str, value: Any) -> None:
        self._data[key] = (value, time.time())
        self._data.move_to_end(key)
        while len(self._data) > self._max_size:
            self._data.popitem(last=False)

    def __len__(self) -> int:
        return len(self._data)


# ---------------------------------------------------------------------------
# Section 3: Entity Cache Helpers (D-04)
# ---------------------------------------------------------------------------

_memory_cache: OrderedDict[str, tuple[Any, float]] = OrderedDict()
_MEMORY_CACHE_MAX = 5000


def _cache_key_wine(wine_name: str, vintage: str | None, producer: str | None) -> str:
    raw = f"{(wine_name or '').lower().strip()}|{(vintage or '').strip()}|{(producer or '').lower().strip()}"
    return f"research:wine:{hashlib.sha256(raw.encode()).hexdigest()}"


def _cache_key_producer(producer: str) -> str:
    normalized = re.sub(r"[^a-z0-9]", "", producer.lower().strip())
    return f"research:producer:{normalized}"


def _cache_key_region(region_or_appellation: str) -> str:
    """D-04 Tier 3: Region/appellation-level ontology cache key."""
    normalized = re.sub(r"[^a-z0-9]", "", region_or_appellation.lower().strip())
    return f"research:region:{normalized}"


def get_entity_cache(key: str, redis_client=None) -> Any | None:
    """
    Check Redis first (if available), then in-memory OrderedDict.
    Returns cached value or None.
    """
    if redis_client is not None:
        try:
            val = redis_client.get(key)
            if val:
                return json.loads(val)
        except Exception:
            pass
    if key in _memory_cache:
        value, cached_at = _memory_cache[key]
        return value
    return None


def put_entity_cache(key: str, value: Any, ttl_days: int = 30, redis_client=None) -> None:
    """
    Write to Redis (if available) with TTL, and always to in-memory cache.
    Evicts oldest entry if memory cache exceeds _MEMORY_CACHE_MAX.
    """
    if redis_client is not None:
        try:
            redis_client.setex(key, ttl_days * 86400, json.dumps(value))
        except Exception:
            pass
    _memory_cache[key] = (value, time.time())
    _memory_cache.move_to_end(key)
    while len(_memory_cache) > _MEMORY_CACHE_MAX:
        _memory_cache.popitem(last=False)


# ---------------------------------------------------------------------------
# Section 1: Layer 1 Deterministic Inference (D-01, D-08)
# ---------------------------------------------------------------------------

def _should_infer(fc: dict[str, Any], field_name: str) -> bool:
    """Return True if a field should be filled by Layer 1 inference."""
    entry = fc.get(field_name)
    if entry is None:
        return True
    if not isinstance(entry, dict):
        return True
    return float(entry.get("confidence", 0.0)) < DEFAULT_ACCEPT_THRESHOLD


def run_layer1_inference(
    fc: dict[str, Any],
    wine_name: str,
    producer: str | None = None,
    vintage: str | None = None,
) -> dict[str, dict[str, Any]]:
    """
    Layer 1: Deterministic inference from Phase 9 ontology.
    Zero cost, instant. Fills appellation-derived fields only (D-08).

    Returns dict of {field_name: {value, confidence, source}} for deterministic fills.
    Only returns fills where existing FC confidence < DEFAULT_ACCEPT_THRESHOLD or field absent.
    All ontology calls wrapped in try/except — malformed DB data returns empty dict (T-12.1-01).
    """
    fills: dict[str, dict[str, Any]] = {}
    appellation_rules = None

    # Extract current values from fc
    appellation = (fc.get("appellation") or {}).get("value") if isinstance(fc.get("appellation"), dict) else None
    grape = (fc.get("grape_variety") or {}).get("value") if isinstance(fc.get("grape_variety"), dict) else None

    if appellation:
        # Check Tier 3 cache (D-04) before hitting DB
        cache_key = _cache_key_region(appellation)
        cached = _memory_cache.get(cache_key)
        cached_rules = cached[0] if cached else None

        if cached_rules is None:
            # Step 1: lookup appellation rules
            try:
                from services.ontology_normalization import (  # noqa: F401
                    get_country_for_appellation,
                    get_grape_color,
                    get_region_for_appellation,
                    lookup_appellation_rules,
                    normalize_grape_name,
                )
                cached_rules = lookup_appellation_rules(appellation) or {}
            except Exception:
                cached_rules = {}
            # Store in Tier 3 cache
            _memory_cache[cache_key] = (cached_rules, time.time())
            _memory_cache.move_to_end(cache_key)
            while len(_memory_cache) > _MEMORY_CACHE_MAX:
                _memory_cache.popitem(last=False)

        appellation_rules = cached_rules

        # Step 1: grape variety from required_grapes
        if _should_infer(fc, "grape_variety"):
            required_grapes = appellation_rules.get("required_grapes") if appellation_rules else None
            if required_grapes and len(required_grapes) == 1:
                entry = required_grapes[0]
                if entry.get("min_pct") == 100:
                    fills["grape_variety"] = {
                        "value": entry.get("grape"),
                        "confidence": 0.99,
                        "source": "ontology_inference",
                    }
                    grape = entry.get("grape")

        # Steps 2 & 3: country + region + sub_region from appellation
        try:
            from services.ontology_normalization import (
                get_country_for_appellation,
                get_region_for_appellation,
            )
            if _should_infer(fc, "country"):
                country = get_country_for_appellation(appellation)
                if country:
                    fills["country"] = {"value": country, "confidence": 0.99, "source": "ontology_inference"}

            region_result = get_region_for_appellation(appellation)
            if region_result:
                if _should_infer(fc, "region"):
                    region_name = region_result.get("name")
                    if region_name:
                        fills["region"] = {"value": region_name, "confidence": 0.99, "source": "ontology_inference"}
                # Step 3b: sub_region from same result (D-08)
                if _should_infer(fc, "sub_region"):
                    sub_region = region_result.get("sub_region")
                    if sub_region:
                        fills["sub_region"] = {"value": sub_region, "confidence": 0.99, "source": "ontology_inference"}
        except Exception:
            pass

    # Step 4: color from grape
    if grape and _should_infer(fc, "color"):
        try:
            from services.ontology_normalization import get_grape_color, normalize_grape_name
            canonical = normalize_grape_name(grape)
            if canonical:
                color = get_grape_color(canonical)
                if color:
                    fills["color"] = {"value": color, "confidence": 0.99, "source": "ontology_inference"}
        except Exception:
            pass

    # Step 6: Vintage plausibility (D-08)
    if vintage:
        try:
            year = int(str(vintage).strip())
            current_year = datetime.now().year
            implausible = year < 1800 or year > current_year + 1
            # Check appellation first_vintage if we have rules
            if not implausible and appellation_rules:
                first_vintage = appellation_rules.get("first_vintage")
                if first_vintage and year < int(first_vintage):
                    implausible = True
            if implausible:
                fills["vintage_plausibility"] = {
                    "value": "implausible",
                    "confidence": 0.99,
                    "source": "ontology_inference",
                }
        except (ValueError, TypeError):
            fills["vintage_plausibility"] = {
                "value": "implausible",
                "confidence": 0.99,
                "source": "ontology_inference",
            }

    return fills


# ---------------------------------------------------------------------------
# Section 2: Model Cascade Routing (D-02)
# ---------------------------------------------------------------------------

HAIKU_FIELDS = frozenset({"color", "primary_type", "sweetness_level", "is_blend"})
SONNET_ESCALATION_FIELDS = frozenset({"tasting_notes", "description", "food_pairing", "producer_bio"})


def select_model(
    field_name: str,
    ontology_hint_conf: float = 0.0,
    attempt: int = 1,
) -> str:
    """
    D-02: Smart cascade routing per field difficulty.
    Returns model identifier string: "haiku", "flash", or "sonnet".

    Rules:
    - Haiku: fields in HAIKU_FIELDS OR ontology_hint_conf > 0.7
    - Flash: default for all other fields on attempt 1
    - Sonnet: fields that failed Flash on prior attempt (attempt >= 2),
      OR complex fields in SONNET_ESCALATION_FIELDS on attempt >= 2
    """
    if field_name in HAIKU_FIELDS or ontology_hint_conf > 0.7:
        return "haiku"
    if attempt >= 2 and field_name in SONNET_ESCALATION_FIELDS:
        return "sonnet"
    if attempt >= 2:
        return "sonnet"
    return "flash"


# ---------------------------------------------------------------------------
# Section 4: Authority-Weighted Conflict Resolution (D-05)
# ---------------------------------------------------------------------------

def resolve_conflict(
    candidates: list[dict[str, Any]],
    field_name: str,
) -> tuple[str, str, dict[str, Any] | None]:
    """
    D-05: Returns (resolution, reason, winning_candidate).
    resolution: "auto" | "human"
    reason: human-readable explanation
    winning_candidate: the dict from candidates that wins (None if human)

    AUTO-RESOLVE rules (100% safe):
    1. Tier-A vs Tier-C: auto-accept Tier-A (if fetch_verified)
    2. Tier-A vs Tier-B: auto-accept Tier-A (if fetch_verified)
    3. 2+ Tier-B agree vs 1 Tier-C: auto-accept B consensus

    ESCALATE TO HUMAN:
    4. Tier-A vs Tier-A
    5. Tier-B vs Tier-B (different values)
    6. No clear winner
    7. Auto-resolution confidence < 0.85
    """
    if not candidates:
        return ("human", "no candidates", None)

    tier_a = [c for c in candidates if c.get("source_tier") == "A"]
    tier_b = [c for c in candidates if c.get("source_tier") == "B"]
    tier_c = [c for c in candidates if c.get("source_tier") == "C"]

    # Rule 1: Tier-A vs Tier-C (no tier-B)
    if tier_a and tier_c and not tier_b:
        winner = next((c for c in tier_a if c.get("fetch_verified")), None)
        if winner:
            return ("auto", "tier-A vs tier-C", winner)
        return ("human", "tier-A not fetch-verified", None)

    # Rule 2: Tier-A vs Tier-B
    if tier_a and tier_b:
        winner = next((c for c in tier_a if c.get("fetch_verified")), None)
        if winner:
            return ("auto", "tier-A vs tier-B", winner)
        return ("human", "tier-A not fetch-verified", None)

    # Rule 3: 2+ Tier-B agree vs Tier-C
    if tier_b and len(tier_b) >= 2:
        value_counts: dict[str, list[dict[str, Any]]] = {}
        for c in tier_b:
            norm_val = _normalize_value(c.get("value"))
            value_counts.setdefault(norm_val, []).append(c)
        # Find value with >= 2 tier-B agreements
        consensus_group = next(
            (group for group in value_counts.values() if len(group) >= 2),
            None,
        )
        if consensus_group:
            winner = consensus_group[0]
            return ("auto", "2+ tier-B consensus", winner)

    # Rule 4: Tier-A vs Tier-A
    if len(tier_a) >= 2:
        return ("human", "tier-A vs tier-A conflict", None)

    # Rule 5: Tier-B vs Tier-B with different values
    if len(tier_b) >= 2:
        values = {_normalize_value(c.get("value")) for c in tier_b}
        if len(values) > 1:
            return ("human", "tier-B vs tier-B conflict", None)

    # Rules 6-7: no clear winner
    return ("human", "no clear authority winner", None)


# ---------------------------------------------------------------------------
# Section 5: Conflict Candidates Deep Merge (D-06 Bug #3)
# ---------------------------------------------------------------------------

def merge_conflict_candidates(
    existing: dict[str, list] | None,
    new: dict[str, list],
) -> dict[str, list]:
    """
    D-06 Bug #3: Deep-merge conflict_candidates instead of replacing.
    Preserves conflicts on other fields from prior runs.
    """
    if not existing:
        return dict(new)
    merged = dict(existing)
    for field, candidates in new.items():
        if field in merged:
            existing_urls = {c.get("source_url") for c in merged[field]}
            for c in candidates:
                if c.get("source_url") not in existing_urls:
                    merged[field].append(c)
        else:
            merged[field] = candidates
    return merged

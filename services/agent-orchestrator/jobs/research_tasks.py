"""
Research Agent Celery Task
==========================
Phase 12.1: Three-layer SOTA research agent — core evidence loop.

Three-layer architecture per record (D-01):
  Layer 1: Deterministic Inference (zero cost) — ontology fills
  Layer 2: Cascade LLM Enrichment (cached) — Haiku/Flash/Sonnet routing
  Layer 3: Deep Research with Reflexion (D-03) — adaptive retry with plateau detection

Evidence loop per wine record:
  1. Daily budget cap pre-flight (T-12-08) + Redis budget flag check
  2. Load submission, eligibility gate (cooldown + confidence)
  3. Create research_run row
  4. _process_record():
       Layer 1: run_layer1_inference() → deterministic fills at $0
       Layer 2: per-field loop with entity cache + cascade model dispatch
         a. Entity cache check (D-04) — skip Serper on cache hit
         b. select_model() — route to Haiku/Flash/Sonnet (D-02)
         c. Serper search → snippets
         d. _extract_field_candidates(model_tier=...) → Anthropic/Gemini (D-02 BLOCKER)
         e. resolve_conflict() — auto-resolve safe conflicts (D-05)
         f. Bug #1 fix: select candidate matching winning tier
         g. Fetch-verify top candidate
         h. resolution_challenges insert when tier-A challenges human_resolved (D-07)
         i. Corroboration + regression guard
         j. put_entity_cache() — cache result for producer re-use (D-04)
       Layer 3: Reflexion retry for remaining fields (D-03)
         - plateau detection: stop if same value as prior attempt
         - cascade escalation: select_model(attempt=N) escalates to Sonnet
         - research_exhausted marking after max retries (D-03)
  5. _write_results(): merge + route + DB writes (with merge_conflict_candidates bug #3)
  6. Write research_run_stats row (time_to_fill_hours bug #5, regression_blocked_count bug #6)
  7. Update last_research_run_at

Threat mitigations:
  T-12-05 (SSRF): validate https://, DNS resolution via socket.getaddrinfo (bug #8), block private IP
  T-12-06 (DoS): stop_rule (call_counter >= max) + per-record cost ceiling
  T-12-07 (Tampering): merge_field_confidence() before every DB write
  T-12-08 (DoS): _check_daily_budget() pre-flight + Redis flag
  T-12-09 (PII): regex filter on snippets; blocked snippets never written to evidence_citations
  T-12.1-11 (DoS): BoundedLRUCache(1000) replaces unbounded _url_cache (bug #10)
"""

from __future__ import annotations

import asyncio
import ipaddress
import json
import logging
import re
import socket
import time
import unicodedata
from datetime import datetime, timedelta, timezone
from typing import Any, Optional
from urllib.parse import urlparse

import httpx
from supabase import create_client

from config.settings import get_settings
from jobs.celery_app import celery_app
from services.field_confidence import (
    DEFAULT_ACCEPT_THRESHOLD,
    DEFAULT_REVIEW_THRESHOLD,
    merge_field_confidence,
    route_fields_by_threshold,
)
from services.research_agent_helpers import (
    RESEARCH_ALL_FIELDS,
    assign_confidence_by_tier,
    build_citation_record,
    build_serper_query,
    check_regression_guard,
    classify_source_tier,
    detect_conflict,
    get_target_fields,
    is_eligible_for_research,
    should_auto_promote,
    # New Plan 01 imports (Wave 1):
    run_layer1_inference,
    select_model,
    get_entity_cache,
    put_entity_cache,
    resolve_conflict,
    merge_conflict_candidates,
    BoundedLRUCache,
    _cache_key_wine,
    _cache_key_producer,
)
from services.serper_client import serper_search
from services.spend_logger import estimate_llm_cost, get_spend_logger

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# PII detection patterns (T-12-09)
_PII_EMAIL_RE = re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b")
_PII_PHONE_RE = re.compile(r"\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b")

# Wine content keywords for Playwright trigger decision
WINE_KEYWORDS = frozenset(
    {
        "wine",
        "grape",
        "vintage",
        "appellation",
        "region",
        "producer",
        "winery",
        "vino",
        "cuvee",
        "château",
        "domaine",
    }
)

# Private IP networks for SSRF protection (T-12-05)
_PRIVATE_NETWORKS: list[ipaddress.IPv4Network | ipaddress.IPv6Network] = [
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("172.16.0.0/12"),
    ipaddress.ip_network("192.168.0.0/16"),
    ipaddress.ip_network("127.0.0.0/8"),
    ipaddress.ip_network("169.254.0.0/16"),  # link-local
    ipaddress.ip_network("::1/128"),
    ipaddress.ip_network("fc00::/7"),
]

# Numeric fields: use exact float comparison, not string matching
NUMERIC_RESEARCH_FIELDS = frozenset(
    {
        "alcohol_pct",
        "vintage",
        "price_bottle",
        "price_glass",
        "retail_price_avg",
    }
)

# URL page-text TTL (days)
_URL_CACHE_TTL_DAYS = 7

# Bug #10 fix: BoundedLRUCache(max_size=1000) replaces unbounded dict (T-12.1-11)
_url_cache = BoundedLRUCache(max_size=1000)


# ---------------------------------------------------------------------------
# T-12-05: SSRF protection (bug #8: DNS resolution added)
# ---------------------------------------------------------------------------


def _is_safe_url(url: str) -> bool:
    """
    Returns True if URL is safe to fetch.
    Blocks non-https:// and private/loopback IP ranges.
    Bug #8 fix: DNS resolution via socket.getaddrinfo catches DNS rebinding attacks.
    """
    try:
        parsed = urlparse(url)
        if parsed.scheme != "https":
            return False
        host = parsed.hostname or ""
        if not host:
            return False
        # Bug #8 fix: resolve hostname to catch DNS rebinding (169.254.169.254, etc.)
        try:
            addr_infos = socket.getaddrinfo(host, None)
            for _family, _, _, _, sockaddr in addr_infos:
                ip_str = sockaddr[0]
                addr = ipaddress.ip_address(ip_str)
                for network in _PRIVATE_NETWORKS:
                    if addr in network:
                        logger.debug(
                            "SSRF guard: %s resolves to private IP %s", host, ip_str
                        )
                        return False
        except socket.gaierror:
            return False  # Cannot resolve hostname — block
        # Also check if host itself is a raw IP (before DNS)
        try:
            addr = ipaddress.ip_address(host)
            for network in _PRIVATE_NETWORKS:
                if addr in network:
                    return False
        except ValueError:
            pass  # Domain name, not a raw IP — already resolved above
        return True
    except Exception:
        return False


# ---------------------------------------------------------------------------
# T-12-09: PII detection
# ---------------------------------------------------------------------------


def _has_pii(text: str) -> bool:
    """Returns True if snippet contains detectable PII (email or phone)."""
    return bool(_PII_EMAIL_RE.search(text)) or bool(_PII_PHONE_RE.search(text))


# ---------------------------------------------------------------------------
# Decision 5: Semantic match algorithm
# ---------------------------------------------------------------------------


def _normalize_text(text: str) -> str:
    """Lowercase + strip diacritics (NFKD → ASCII) + collapse whitespace."""
    nfkd = unicodedata.normalize("NFKD", text.lower())
    ascii_text = nfkd.encode("ascii", "ignore").decode("ascii")
    return re.sub(r"\s+", " ", ascii_text).strip()


def _levenshtein(s1: str, s2: str) -> int:
    """Compute Levenshtein edit distance between two strings."""
    if s1 == s2:
        return 0
    if len(s1) > len(s2):
        s1, s2 = s2, s1
    row = list(range(len(s1) + 1))
    for c2 in s2:
        new_row = [row[0] + 1]
        for j, c1 in enumerate(s1):
            new_row.append(min(new_row[j] + 1, row[j + 1] + 1, row[j] + (c1 != c2)))
        row = new_row
    return row[-1]


def _numeric_match(proposed_value: str, page_text: str) -> bool:
    """Exact numeric match after stripping non-numeric chars (Decision 5, step 4)."""
    try:
        val_str = re.sub(r"[^\d.]", "", proposed_value)
        if not val_str:
            return False
        float_val = float(val_str)
        nums = re.findall(r"\d+\.?\d*", page_text)
        return any(abs(float(n) - float_val) < 0.01 for n in nums)
    except (ValueError, TypeError):
        return False


def _semantic_match(proposed_value: str, page_text: str, field_name: str = "") -> bool:
    """
    Three-step semantic match per 12-CONTEXT.md Decision 5:
      1. Normalize + word-boundary regex
      2. Levenshtein distance ≤ floor(len(value) × 0.15)
      3. Numeric fields: exact float match after stripping non-numeric chars
    """
    if not proposed_value or not page_text:
        return False

    if field_name in NUMERIC_RESEARCH_FIELDS:
        return _numeric_match(proposed_value, page_text)

    norm_value = _normalize_text(proposed_value)
    norm_text = _normalize_text(page_text[:20000])

    if not norm_value:
        return False

    escaped = re.escape(norm_value)
    if re.search(r"\b" + escaped + r"\b", norm_text):
        return True

    val_len = len(norm_value)
    if val_len < 4:
        return norm_value in norm_text

    max_dist = max(1, int(val_len * 0.15))
    step = max(1, val_len // 2)
    for i in range(0, max(1, len(norm_text) - val_len + 1), step):
        window = norm_text[i : i + val_len]
        if len(window) == val_len and _levenshtein(norm_value, window) <= max_dist:
            return True

    return False


# ---------------------------------------------------------------------------
# Decision 5: Playwright trigger logic
# ---------------------------------------------------------------------------


def _should_use_playwright(response_body: str, source_tier: str) -> bool:
    """
    Decision 5: upgrade to Playwright render when:
    - source_tier == 'A' (regulatory/producer sites use JS)
    - response body < 2KB (SPA indicator)
    - no wine-related keywords in static render
    """
    if source_tier == "A":
        return True
    if len(response_body) < 2000:
        return True
    body_lower = response_body.lower()
    if not any(kw in body_lower for kw in WINE_KEYWORDS):
        return True
    return False


async def _fetch_with_playwright(url: str) -> str:
    """Render page with Playwright, return page body text. Returns '' on error."""
    try:
        from playwright.async_api import async_playwright
    except ImportError:
        logger.debug(
            "Playwright not installed — skipping Playwright render for %s", url
        )
        return ""

    try:
        async with async_playwright() as pw:
            browser = await pw.chromium.launch(headless=True)
            page = await browser.new_page()
            await page.goto(url, timeout=15000, wait_until="networkidle")
            text = await page.inner_text("body")
            await browser.close()
            return text
    except Exception as exc:
        logger.debug("Playwright fetch failed for %s: %s", url, exc)
        return ""


# ---------------------------------------------------------------------------
# Decision 5: URL cache (evidence_url_cache)
# Bug #10 fix: BoundedLRUCache replaces unbounded _url_cache dict
# ---------------------------------------------------------------------------


def _get_cached_page_text(url: str, supabase) -> Optional[str]:
    """
    Check BoundedLRUCache then Supabase evidence_url_cache.
    Returns page text if cache hit within TTL, else None.
    """
    # In-memory bounded LRU cache (bug #10 fix)
    cached = _url_cache.get(url, ttl_seconds=_URL_CACHE_TTL_DAYS * 86400)
    if cached is not None:
        return cached

    # Supabase cache
    now = datetime.now(timezone.utc)
    try:
        result = (
            supabase.table("evidence_url_cache")
            .select("page_text,cached_at")
            .eq("url", url)
            .maybe_single()
            .execute()
        )
        if result.data:
            cached_at_str = result.data.get("cached_at", "")
            if cached_at_str:
                cached_dt = datetime.fromisoformat(cached_at_str.replace("Z", "+00:00"))
                if (now - cached_dt).days < _URL_CACHE_TTL_DAYS:
                    text = result.data["page_text"]
                    _url_cache.put(url, text)
                    return text
    except Exception as exc:
        logger.debug("URL cache lookup failed (non-fatal): %s", exc)

    return None


def _store_cached_page_text(
    url: str, page_text: str, fetch_method: str, supabase
) -> None:
    """Store page text in BoundedLRUCache and Supabase evidence_url_cache."""
    _url_cache.put(url, page_text)
    now = datetime.now(timezone.utc)
    try:
        supabase.table("evidence_url_cache").upsert(
            {
                "url": url,
                "page_text": page_text[:50000],
                "cached_at": now.isoformat(),
                "fetch_method": fetch_method,
            }
        ).execute()
    except Exception as exc:
        logger.debug("URL cache write failed (non-fatal): %s", exc)


# ---------------------------------------------------------------------------
# Decision 5: Fetch-verify pipeline
# ---------------------------------------------------------------------------


async def _fetch_verify_value(
    proposed_value: str,
    source_url: str,
    source_tier: str,
    field_name: str,
    supabase,
) -> bool:
    """
    Fetch-verify: confirm proposed_value appears on source page.
    Pipeline: httpx → Playwright (if needed) → semantic match.
    T-12-05: validates URL safety (including DNS resolution) before any HTTP call.
    """
    if not _is_safe_url(source_url):
        logger.debug("SSRF guard: skipping unsafe URL %s", source_url)
        return False

    page_text = _get_cached_page_text(source_url, supabase)
    fetch_method = "cache"

    if page_text is None:
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.get(
                    source_url,
                    headers={"User-Agent": "WineOps-ResearchAgent/1.0"},
                    follow_redirects=True,
                )
                resp.raise_for_status()
                page_text = resp.text
                fetch_method = "httpx"
        except Exception as exc:
            logger.debug("httpx fetch failed for %s: %s", source_url, exc)
            page_text = ""

        if _should_use_playwright(page_text or "", source_tier):
            playwright_text = await _fetch_with_playwright(source_url)
            if playwright_text:
                page_text = playwright_text
                fetch_method = "playwright"

        if page_text:
            _store_cached_page_text(source_url, page_text, fetch_method, supabase)

    if not page_text:
        return False

    return _semantic_match(proposed_value, page_text, field_name)


# ---------------------------------------------------------------------------
# D-02 BLOCKER FIX: Cascade model dispatch in _extract_field_candidates
# ---------------------------------------------------------------------------


async def _extract_field_candidates(
    field_name: str,
    wine_name: str,
    vintage: Optional[str],
    snippets: list[dict],
    spend_logger,
    model_tier: str = "flash",  # D-02: "haiku", "flash", or "sonnet"
) -> list[dict[str, Any]]:
    """
    Extract candidates for a specific field from Serper snippets.
    D-02 cascade: dispatches to Haiku/Sonnet (Anthropic) or Flash (Gemini) per model_tier.

    Returns list of {value, source_url, snippet_used, confidence} dicts.
    Returns [] if no evidence found or API unavailable.
    """
    settings = get_settings()
    if not snippets:
        return []

    wine_ctx = f"{wine_name} {vintage}".strip() if vintage else wine_name
    snippets_text = "\n\n".join(
        f"Source {i + 1} (URL: {s.get('link', 'unknown')}):\n"
        f"Title: {s.get('title', '')}\n"
        f"Snippet: {s.get('snippet', '')}"
        for i, s in enumerate(snippets[:5])
    )
    prompt = (
        f"You are a wine data extraction expert.\n"
        f"Extract the value for field '{field_name}' from these search results "
        f"for wine: '{wine_ctx}'.\n\n"
        f"Search results:\n{snippets_text}\n\n"
        f"Return a JSON array. Each element must have:\n"
        f"  - value: the extracted string value for '{field_name}'\n"
        f"  - source_url: the exact URL this value came from\n"
        f"  - snippet_used: the exact snippet text supporting this value\n"
        f"  - confidence: 0.0–1.0 (your confidence in this extraction)\n\n"
        f"Include ONLY values explicitly stated in the snippets. "
        f"If '{field_name}' is not mentioned in any snippet, return [].\n"
        f"Return ONLY valid JSON, no markdown, no explanation."
    )

    # ── Anthropic path: Haiku or Sonnet (D-02 cascade) ──
    if model_tier in ("haiku", "sonnet") and settings.claude_api_key:
        model_name = (
            settings.research_cascade_haiku_model
            if model_tier == "haiku"
            else settings.research_cascade_sonnet_model
        )
        try:
            import anthropic

            client = anthropic.Anthropic(api_key=settings.claude_api_key)
            _t0 = time.perf_counter()
            response = client.messages.create(
                model=model_name,
                max_tokens=1024,
                messages=[{"role": "user", "content": prompt}],
            )
            raw = response.content[0].text.strip()
            if raw.startswith("```"):
                raw = re.sub(r"^```[a-z]*\n?", "", raw)
                raw = re.sub(r"\n?```$", "", raw)
                raw = raw.strip()
            try:
                in_tok = response.usage.input_tokens or 0
                out_tok = response.usage.output_tokens or 0
                cost_per_in = 0.80 if model_tier == "haiku" else 3.00
                cost_per_out = 4.00 if model_tier == "haiku" else 15.00
                cost = (in_tok * cost_per_in / 1_000_000) + (
                    out_tok * cost_per_out / 1_000_000
                )
                spend_logger.log(
                    provider="anthropic",
                    model=model_name,
                    input_tokens=in_tok,
                    output_tokens=out_tok,
                    cost_usd=cost,
                    agent="research_agent",
                    task_type="field_extraction",
                    outcome="success",  # call-level: completion returned
                    duration_ms=int((time.perf_counter() - _t0) * 1000),
                    context={"field": field_name, "model_tier": model_tier},
                )
            except Exception:
                pass
            candidates = json.loads(raw)
            if not isinstance(candidates, list):
                return []
            return [c for c in candidates if isinstance(c, dict) and c.get("value")]
        except Exception as exc:
            logger.debug(
                "Anthropic extraction failed field=%s model=%s: %s",
                field_name,
                model_name,
                exc,
            )
            return []

    # ── Google Gemini Flash path (default / fallback for "flash" tier) ──
    if not settings.google_api_key:
        logger.debug(
            "GEMINI_API_KEY not configured — skipping Gemini extraction for %s",
            field_name,
        )
        return []

    try:
        from google import genai

        client = genai.Client(api_key=settings.google_api_key)
        flash_model = getattr(
            settings, "research_cascade_flash_model", "gemini-2.5-flash"
        )
        _t0 = time.perf_counter()
        response = client.models.generate_content(
            model=flash_model,
            contents=prompt,
            config={"response_mime_type": "application/json"},
        )
        raw = (response.text or "").strip()

        if raw.startswith("```"):
            raw = re.sub(r"^```[a-z]*\n?", "", raw)
            raw = re.sub(r"\n?```$", "", raw)
            raw = raw.strip()

        try:
            usage = getattr(response, "usage_metadata", None)
            in_tok = getattr(usage, "prompt_token_count", 0) or 0
            # thinking tokens bill at the output rate — see spend_logger.usage_tokens()
            out_tok = (getattr(usage, "candidates_token_count", 0) or 0) + (
                getattr(usage, "thoughts_token_count", 0) or 0
            )
            # Was an inline 0.075/0.30 literal — the retired gemini-2.0-flash rate,
            # applied to whatever flash_model actually is. Route through the
            # audited table so one correction fixes every site.
            cost = estimate_llm_cost(flash_model, in_tok, out_tok)
            spend_logger.log(
                provider="google",
                model=flash_model,
                input_tokens=in_tok,
                output_tokens=out_tok,
                cost_usd=cost,
                agent="research_agent",
                task_type="field_extraction",
                outcome="success",  # call-level: completion returned
                duration_ms=int((time.perf_counter() - _t0) * 1000),
                context={"field": field_name, "model_tier": "flash"},
            )
        except Exception as spend_err:
            logger.debug("Gemini spend log failed (non-fatal): %s", spend_err)

        candidates = json.loads(raw)
        if not isinstance(candidates, list):
            return []
        return [c for c in candidates if isinstance(c, dict) and c.get("value")]

    except Exception as exc:
        logger.debug("Gemini extraction failed for field=%s: %s", field_name, exc)
        return []


# ---------------------------------------------------------------------------
# Core evidence loop — Three-Layer Architecture (D-01)
# ---------------------------------------------------------------------------


async def _process_record(
    submission: dict[str, Any],
    run_id: str,
    settings,
    dry_run: bool,
    supabase,
    spend_logger,
    redis_client=None,  # D-04: Redis client for entity cache
) -> dict[str, Any]:
    """
    Three-layer evidence loop for one wine record. Returns stats dict for research_run_stats.

    Layer 1: Deterministic Inference — zero cost, fills appellation-derived fields instantly.
    Layer 2: Cascade LLM Enrichment — entity cache + Haiku/Flash/Sonnet routing per field.
    Layer 3: Deep Research with Reflexion — adaptive retry + plateau detection + escalation.

    Bug fixes applied: #1 (tier-correct promotion), #3 (merge conflicts), #5 (time_to_fill_hours),
    #6 (regression_blocked_count), D-03 (research_exhausted), D-04 (entity cache),
    D-05 (conflict auto-resolution), D-07 (resolution_challenges + notification).
    """
    wine_id = str(submission.get("id", ""))
    wine_name = submission.get("wine_name") or ""
    producer = submission.get("producer") or ""
    vintage = str(submission.get("vintage", "")) if submission.get("vintage") else None
    existing_fc: dict = submission.get("field_confidence") or {}

    target_fields = get_target_fields(existing_fc, RESEARCH_ALL_FIELDS)

    total_fields = len(RESEARCH_ALL_FIELDS)
    null_count_before = sum(1 for f in RESEARCH_ALL_FIELDS if not existing_fc.get(f))
    null_rate_before = null_count_before / total_fields if total_fields else 0.0

    started_at = datetime.now(timezone.utc)  # Bug #5: track start time
    call_counter = 0
    record_cost = 0.0
    new_fc_entries: dict[str, Any] = {}
    citation_records: list[dict] = []
    conflict_updates: dict[str, list] = {}
    pii_policy_flags = 0
    fields_filled = 0
    fields_conflicted = 0
    fields_unchanged = 0
    regression_blocked_count = 0  # Bug #6: track actual regressions

    # ── Layer 1: Deterministic Inference (D-01, D-08) ──
    layer1_fills = run_layer1_inference(existing_fc, wine_name, producer, vintage)
    for field_name, fill_entry in layer1_fills.items():
        if field_name in target_fields:
            new_fc_entries[field_name] = fill_entry
            fields_filled += 1
            target_fields.remove(field_name)
            citation_records.append(
                build_citation_record(
                    wine_id=wine_id,
                    run_id=run_id,
                    field_name=field_name,
                    proposed_value=str(fill_entry.get("value", "")),
                    source_url="ontology://phase9",
                    source_tier="A",
                    snippet="Deterministic inference from Phase 9 ontology",
                    fetch_verified=True,
                    corroboration_count=1,
                )
            )
    # Layer 2/3 see Layer 1 fills in existing_fc for regression guard
    existing_fc = {**existing_fc, **{k: v for k, v in new_fc_entries.items()}}

    # ── Layer 2: Cascade LLM Enrichment (D-02, D-04) ──
    wine_cache_key = _cache_key_wine(wine_name, vintage, producer)

    for field_name in list(target_fields):
        # Stop rule (T-12-06)
        if call_counter >= settings.research_max_calls_per_record:
            logger.info(
                "research_agent: stop rule (%d calls) — stopping field loop wine_id=%s",
                call_counter,
                wine_id,
            )
            break

        # Per-record budget ceiling (T-12-06)
        if record_cost >= settings.research_max_cost_per_record_usd:
            logger.info(
                "research_agent: cost ceiling ($%.4f) — stopping field loop wine_id=%s",
                record_cost,
                wine_id,
            )
            break

        # ── Entity cache check (D-04) ──
        cached_result = get_entity_cache(f"{wine_cache_key}:{field_name}", redis_client)
        if cached_result is not None:
            new_fc_entries[field_name] = cached_result
            fields_filled += 1
            target_fields.remove(field_name)
            continue

        # Producer-level cache for shared producer fields
        if producer and field_name in (
            "country",
            "region",
            "sub_region",
            "producer_bio",
        ):
            producer_cache_key = _cache_key_producer(producer)
            cached_producer = get_entity_cache(
                f"{producer_cache_key}:{field_name}", redis_client
            )
            if cached_producer is not None:
                new_fc_entries[field_name] = cached_producer
                fields_filled += 1
                target_fields.remove(field_name)
                continue

        # ── Model selection (D-02) ──
        ontology_hint_conf = layer1_fills.get(field_name, {}).get("confidence", 0.0)
        model_tier = select_model(field_name, ontology_hint_conf, attempt=1)

        # ── Serper search ──
        query = build_serper_query(field_name, wine_name, producer, vintage)
        call_counter += 1
        serper_cost = settings.serper_cost_per_query
        record_cost += serper_cost

        search_results: list = []
        search_ok = True
        _t0 = time.perf_counter()
        try:
            search_results = await serper_search(query, num_results=5)
        except Exception as exc:
            search_ok = False
            logger.warning(
                "Serper search failed for field=%s wine_id=%s: %s",
                field_name,
                wine_id,
                exc,
            )

        try:
            spend_logger.log(
                provider="serper",
                model="search",
                input_tokens=0,
                output_tokens=0,
                cost_usd=serper_cost,
                agent="research_agent",
                task_type="field_search",
                choice=f"search:{len(search_results)}_results",
                # `results_v1`: a FAILED search stays `failure` (search_ok is a
                # real signal). A search that succeeded and found nothing is
                # `null` — untestable — rather than the `success` it used to be.
                outcome=(
                    ("success" if search_results else None) if search_ok else "failure"
                ),
                duration_ms=int((time.perf_counter() - _t0) * 1000),
                context={
                    "outcome_basis": "results_v1",
                    "field": field_name,
                    "wine_id": wine_id,
                    "results_count": len(search_results),
                    **(
                        {"untestable": "search_returned_no_results"}
                        if search_ok and not search_results
                        else {}
                    ),
                },
            )
        except Exception as spend_err:
            logger.debug("Serper spend log failed (non-fatal): %s", spend_err)

        if not search_results:
            fields_unchanged += 1
            continue

        # PII filter (T-12-09)
        clean_snippets: list[dict] = []
        for sr in search_results:
            snippet = sr.get("snippet", "")
            if _has_pii(snippet):
                pii_policy_flags += 1
                logger.debug("PII flag: blocked snippet from %s", sr.get("link", ""))
                continue
            clean_snippets.append(sr)

        if not clean_snippets:
            fields_unchanged += 1
            continue

        if call_counter >= settings.research_max_calls_per_record:
            break

        call_counter += 1
        record_cost += 0.0001

        # ── Cascade extraction (D-02: dispatches to Haiku/Flash/Sonnet per model_tier) ──
        candidates = await _extract_field_candidates(
            field_name,
            wine_name,
            vintage,
            [
                {"title": sr["title"], "link": sr["link"], "snippet": sr["snippet"]}
                for sr in clean_snippets
            ],
            spend_logger,
            model_tier=model_tier,
        )

        if not candidates:
            fields_unchanged += 1
            continue

        for cand in candidates:
            url = cand.get("source_url", "")
            cand["source_tier"] = classify_source_tier(
                url, producer=producer if producer else None
            )

        # ── Conflict detection with auto-resolution (D-05) ──
        if detect_conflict(candidates):
            resolution, reason, winner = resolve_conflict(candidates, field_name)
            if resolution == "auto" and winner is not None:
                logger.info(
                    "Conflict auto-resolved field=%s wine_id=%s: %s",
                    field_name,
                    wine_id,
                    reason,
                )
                top_candidate = winner
            else:
                logger.info(
                    "Conflict → human field=%s wine_id=%s: %s",
                    field_name,
                    wine_id,
                    reason,
                )
                conflict_updates[field_name] = candidates
                fields_conflicted += 1
                continue
        else:
            # ── Bug #1 fix: select candidate matching winning tier ──
            can_promote, conf_key = should_auto_promote(candidates)
            if not can_promote:
                fields_unchanged += 1
                continue
            if conf_key == "A_single":
                tier_a = [c for c in candidates if c.get("source_tier") == "A"]
                top_candidate = tier_a[0] if tier_a else candidates[0]
            elif conf_key == "B_dual":
                tier_bc = [c for c in candidates if c.get("source_tier") in ("B", "C")]
                top_candidate = (
                    max(tier_bc, key=lambda c: c.get("confidence", 0))
                    if tier_bc
                    else candidates[0]
                )
            else:
                top_candidate = candidates[0]

        # ── Fetch-verify ──
        fetch_verified = False
        if (
            settings.research_fetch_verify_enabled
            and call_counter < settings.research_max_calls_per_record - 1
        ):
            top_url = top_candidate.get("source_url", "")
            proposed_value = str(top_candidate.get("value", ""))
            top_tier = top_candidate.get("source_tier", "C")
            if top_url and proposed_value:
                call_counter += 1
                record_cost += 0.001
                fetch_verified = await _fetch_verify_value(
                    proposed_value, top_url, top_tier, field_name, supabase
                )

        top_candidate["fetch_verified"] = fetch_verified

        # ── D-07: resolution_challenges — tier-A challenges human_resolved ──
        existing_entry = existing_fc.get(field_name, {})
        if (
            isinstance(existing_entry, dict)
            and existing_entry.get("source") == "human_resolved"
            and top_candidate.get("source_tier") == "A"
            and top_candidate.get("fetch_verified") is True
        ):
            existing_value = str(existing_entry.get("value", ""))
            proposed_value = str(top_candidate.get("value", ""))
            if existing_value.lower().strip() != proposed_value.lower().strip():
                try:
                    supabase.table("resolution_challenges").insert(
                        {
                            "submission_id": wine_id,
                            "field_name": field_name,
                            "existing_value": existing_value,
                            "challenging_value": proposed_value,
                            "challenging_source_url": top_candidate.get(
                                "source_url", ""
                            ),
                            "challenging_source_tier": "A",
                            "snippet": top_candidate.get("snippet_used", ""),
                            "status": "open",
                        }
                    ).execute()
                    # D-07: Challenge notification
                    try:
                        supabase.table("notifications").insert(
                            {
                                "type": "resolution_challenge",
                                "title": f"Tier-A challenge: {field_name}",
                                "message": (
                                    f"Tier-A source challenges human_resolved {field_name} "
                                    f"for wine {wine_name}: '{existing_value}' → '{proposed_value}'"
                                ),
                                "metadata": json.dumps(
                                    {
                                        "submission_id": wine_id,
                                        "field_name": field_name,
                                    }
                                ),
                                "status": "unread",
                            }
                        ).execute()
                    except Exception:
                        logger.info(
                            "challenge_notification: %s",
                            json.dumps(
                                {
                                    "type": "resolution_challenge",
                                    "wine_id": wine_id,
                                    "field": field_name,
                                    "existing": existing_value,
                                    "challenging": proposed_value,
                                }
                            ),
                        )
                except Exception as exc:
                    logger.warning(
                        "resolution_challenges insert failed (non-fatal): %s", exc
                    )
                fields_unchanged += 1
                continue

        # Corroboration check (layer 2 path — used when no conflict detected)
        if not detect_conflict(candidates):
            can_promote, conf_key = should_auto_promote(candidates)
            if not can_promote:
                fields_unchanged += 1
                continue
        else:
            can_promote = True
            conf_key = (
                "A_single" if top_candidate.get("source_tier") == "A" else "B_dual"
            )

        confidence = assign_confidence_by_tier(conf_key)
        proposed_value = str(top_candidate.get("value", ""))

        # Regression guard (T-12-07)
        if not check_regression_guard(field_name, confidence, existing_fc):
            logger.debug(
                "Regression guard blocked field=%s wine_id=%s (proposed=%.2f < existing)",
                field_name,
                wine_id,
                confidence,
            )
            regression_blocked_count += 1  # Bug #6
            fields_unchanged += 1
            continue

        citation = build_citation_record(
            wine_id=wine_id,
            run_id=run_id,
            field_name=field_name,
            proposed_value=proposed_value,
            source_url=top_candidate.get("source_url", ""),
            source_tier=top_candidate.get("source_tier", "C"),
            snippet=top_candidate.get("snippet_used", ""),
            retrieved_at=datetime.now(timezone.utc),
            fetch_verified=fetch_verified,
            corroboration_count=len(candidates),
        )
        citation_records.append(citation)

        new_fc_entries[field_name] = {
            "value": proposed_value,
            "confidence": confidence,
            "source": "research_agent",
        }
        fields_filled += 1
        target_fields.remove(field_name)

        # ── Cache the result (D-04) ──
        put_entity_cache(
            f"{wine_cache_key}:{field_name}",
            new_fc_entries[field_name],
            ttl_days=settings.research_cache_wine_ttl_days,
            redis_client=redis_client,
        )
        if producer and field_name in (
            "country",
            "region",
            "sub_region",
            "producer_bio",
        ):
            put_entity_cache(
                f"{_cache_key_producer(producer)}:{field_name}",
                new_fc_entries[field_name],
                ttl_days=settings.research_cache_producer_ttl_days,
                redis_client=redis_client,
            )

    # ── Layer 3: Deep Research with Reflexion (D-03) ──
    remaining_targets = [f for f in target_fields if f not in new_fc_entries]
    for field_name in remaining_targets:
        if call_counter >= settings.research_max_calls_per_record:
            break
        if record_cost >= settings.research_max_cost_per_record_usd:
            break

        prev_values: list[str] = []
        filled_in_layer3 = False

        for attempt in range(1, settings.research_max_reflexion_retries + 1):
            if call_counter >= settings.research_max_calls_per_record:
                break

            # D-02: cascade dispatch — model_tier escalates to sonnet on retry
            model_tier = select_model(field_name, 0.0, attempt=attempt)
            query = build_serper_query(field_name, wine_name, producer, vintage)
            # Reflexion: exclude previous value from next search
            if prev_values:
                query += f' -"{prev_values[-1]}"'

            call_counter += 1
            record_cost += settings.serper_cost_per_query

            search_results = []
            search_ok = True
            _t0 = time.perf_counter()
            try:
                search_results = await serper_search(query, num_results=5)
            except Exception:
                search_ok = False

            # P1: this Layer-3 Serper call was previously entirely unlogged —
            # money left the building with no api_spend row (dark site).
            try:
                spend_logger.log(
                    provider="serper",
                    model="search",
                    input_tokens=0,
                    output_tokens=0,
                    cost_usd=settings.serper_cost_per_query,
                    agent="research_agent",
                    task_type="field_search_reflexion",
                    choice=f"search:{len(search_results)}_results",
                    # `results_v1` — same reading as field_search above.
                    outcome=(
                        ("success" if search_results else None)
                        if search_ok
                        else "failure"
                    ),
                    duration_ms=int((time.perf_counter() - _t0) * 1000),
                    context={
                        "outcome_basis": "results_v1",
                        "field": field_name,
                        "wine_id": wine_id,
                        "attempt": attempt,
                        "results_count": len(search_results),
                        **(
                            {"untestable": "search_returned_no_results"}
                            if search_ok and not search_results
                            else {}
                        ),
                    },
                )
            except Exception as spend_err:
                logger.debug("Serper spend log failed (non-fatal): %s", spend_err)

            if not search_ok:
                break

            if not search_results:
                break

            clean = [sr for sr in search_results if not _has_pii(sr.get("snippet", ""))]
            if not clean:
                break

            if call_counter >= settings.research_max_calls_per_record:
                break
            call_counter += 1
            record_cost += 0.0001

            candidates = await _extract_field_candidates(
                field_name,
                wine_name,
                vintage,
                [
                    {"title": sr["title"], "link": sr["link"], "snippet": sr["snippet"]}
                    for sr in clean
                ],
                spend_logger,
                model_tier=model_tier,
            )
            if not candidates:
                break

            # Plateau detection (D-03): stop if same value as prior attempt
            curr_value = str(candidates[0].get("value", "")).lower().strip()
            if curr_value in [v.lower().strip() for v in prev_values]:
                logger.info(
                    "Reflexion plateau field=%s wine_id=%s attempt=%d — stopping",
                    field_name,
                    wine_id,
                    attempt,
                )
                break
            prev_values.append(curr_value)

            for c in candidates:
                c["source_tier"] = classify_source_tier(
                    c.get("source_url", ""), producer=producer if producer else None
                )

            if detect_conflict(candidates):
                resolution, reason, winner = resolve_conflict(candidates, field_name)
                if resolution == "auto" and winner:
                    top_candidate = winner
                else:
                    conflict_updates[field_name] = candidates
                    fields_conflicted += 1
                    break
            else:
                can_promote, conf_key = should_auto_promote(candidates)
                if not can_promote:
                    continue
                if conf_key == "A_single":
                    tier_a = [c for c in candidates if c.get("source_tier") == "A"]
                    top_candidate = tier_a[0] if tier_a else candidates[0]
                elif conf_key == "B_dual":
                    tier_bc = [
                        c for c in candidates if c.get("source_tier") in ("B", "C")
                    ]
                    top_candidate = (
                        max(tier_bc, key=lambda c: c.get("confidence", 0))
                        if tier_bc
                        else candidates[0]
                    )
                else:
                    top_candidate = candidates[0]

            # Fetch-verify
            fetch_verified = False
            if (
                settings.research_fetch_verify_enabled
                and call_counter < settings.research_max_calls_per_record
            ):
                call_counter += 1
                record_cost += 0.001
                fetch_verified = await _fetch_verify_value(
                    str(top_candidate.get("value", "")),
                    top_candidate.get("source_url", ""),
                    top_candidate.get("source_tier", "C"),
                    field_name,
                    supabase,
                )

            top_candidate["fetch_verified"] = fetch_verified
            confidence = assign_confidence_by_tier(conf_key)
            proposed = str(top_candidate.get("value", ""))

            if not check_regression_guard(field_name, confidence, existing_fc):
                regression_blocked_count += 1
                break

            citation_records.append(
                build_citation_record(
                    wine_id=wine_id,
                    run_id=run_id,
                    field_name=field_name,
                    proposed_value=proposed,
                    source_url=top_candidate.get("source_url", ""),
                    source_tier=top_candidate.get("source_tier", "C"),
                    snippet=top_candidate.get("snippet_used", ""),
                    fetch_verified=fetch_verified,
                    corroboration_count=len(candidates),
                )
            )
            new_fc_entries[field_name] = {
                "value": proposed,
                "confidence": confidence,
                "source": "research_agent",
            }
            fields_filled += 1
            filled_in_layer3 = True
            break  # Field filled — exit retry loop

        # D-03: fields exhausting all Reflexion retries → mark research_exhausted
        if (
            not filled_in_layer3
            and field_name not in new_fc_entries
            and field_name not in conflict_updates
        ):
            new_fc_entries[field_name] = {
                "value": None,
                "confidence": 0.0,
                "source": "research_exhausted",
            }

    # Compute null_rate_after
    tentative_fc = {**existing_fc, **new_fc_entries}
    null_count_after = sum(1 for f in RESEARCH_ALL_FIELDS if not tentative_fc.get(f))
    null_rate_after = null_count_after / total_fields if total_fields else 0.0

    return {
        "new_fc_entries": new_fc_entries,
        "citation_records": citation_records,
        "conflict_updates": conflict_updates,
        "fields_targeted": len(
            get_target_fields(
                submission.get("field_confidence") or {}, RESEARCH_ALL_FIELDS
            )
        ),
        "fields_filled": fields_filled,
        "fields_conflicted": fields_conflicted,
        "fields_unchanged": fields_unchanged,
        "null_rate_before": null_rate_before,
        "null_rate_after": null_rate_after,
        "call_counter": call_counter,
        "cost_usd": record_cost,
        "pii_policy_flags": pii_policy_flags,
        # Bug #5 fix: time_to_fill_hours
        "time_to_fill_hours": (datetime.now(timezone.utc) - started_at).total_seconds()
        / 3600,
        # Bug #6 fix: actual regression count
        "regression_blocked_count": regression_blocked_count,
    }


# ---------------------------------------------------------------------------
# Write results to Supabase
# ---------------------------------------------------------------------------


async def _write_results(
    submission_id: str,
    new_fc_entries: dict[str, Any],
    citation_records: list[dict],
    conflict_updates: dict[str, list],
    run_id: str,
    existing_fc: dict[str, Any],
    existing_conflicts: dict[str, list],  # Bug #3 fix: deep-merge instead of replace
    supabase,
    dry_run: bool,
) -> dict[str, Any]:
    """
    Persist research results to Supabase.

    a. merge_field_confidence() — regression guard enforced here (T-12-07)
    b. route_fields_by_threshold() — split into accepted / review / rejected
    c. Write field_review_queue rows for review-tier fields
    d. Batch insert evidence_citations
    e. Update master_wine_library_submissions (field_confidence + conflict_candidates)
       Bug #3 fix: uses merge_conflict_candidates() to deep-merge conflicts
    """
    if dry_run:
        logger.info(
            "DRY RUN: skipping all Supabase writes for submission_id=%s", submission_id
        )
        return {"dry_run": True}

    updated_fc = merge_field_confidence(existing_fc, new_fc_entries)

    accepted, review_list, _rejected = route_fields_by_threshold(
        updated_fc,
        DEFAULT_REVIEW_THRESHOLD,
        DEFAULT_ACCEPT_THRESHOLD,
    )

    now_iso = datetime.now(timezone.utc).isoformat()
    if review_list:
        queue_rows = []
        for item in review_list:
            source_raw = item.get("source", "research_agent")
            db_source = (
                "knowledge" if source_raw not in ("visible", "inferred") else source_raw
            )
            queue_rows.append(
                {
                    "submission_id": submission_id,
                    "field_name": item["field_name"],
                    "current_value": item.get("current_value"),
                    "confidence": item.get("confidence", 0.0),
                    "source": db_source,
                    "status": "pending",
                }
            )
        try:
            supabase.table("field_review_queue").insert(queue_rows).execute()
        except Exception as exc:
            logger.warning("field_review_queue insert failed (non-fatal): %s", exc)

    if citation_records:
        try:
            supabase.table("evidence_citations").insert(citation_records).execute()
        except Exception as exc:
            logger.warning("evidence_citations insert failed (non-fatal): %s", exc)

    update_payload: dict[str, Any] = {
        "field_confidence": updated_fc,
        "last_research_run_at": now_iso,
    }
    if conflict_updates:
        # Bug #3 fix: deep-merge with merge_conflict_candidates instead of replace
        update_payload["conflict_candidates"] = merge_conflict_candidates(
            existing_conflicts, conflict_updates
        )

    try:
        supabase.table("master_wine_library_submissions").update(update_payload).eq(
            "id", submission_id
        ).execute()
    except Exception as exc:
        logger.warning("master_wine_library_submissions update failed: %s", exc)

    return {
        "fields_accepted": len(accepted),
        "fields_in_review": len(review_list),
    }


# ---------------------------------------------------------------------------
# T-12-08: Daily budget cap check (bug #2 fix: sum ALL providers)
# ---------------------------------------------------------------------------


async def _check_daily_budget() -> bool:
    """
    Returns True if today's research API spend is below the daily cap.
    Bug #2 fix: sums ALL providers (not just serper).
    Fails open on any error — infra failure must not block research.
    """
    settings = get_settings()
    if not settings.supabase_url or not settings.supabase_key:
        return True

    supabase = create_client(settings.supabase_url, settings.supabase_key)
    today = datetime.now(timezone.utc).date().isoformat()

    try:
        # Bug #2 fix: sum ALL providers (no provider filter)
        result = (
            supabase.table("api_spend")
            .select("cost_usd")
            .gte("timestamp", today)
            .execute()
        )
        # `or 0` not `, 0` — cost_usd is nullable since OD-61, and NULL means the
        # model had no rate, not that the call was free. `.get("cost_usd", 0)`
        # returns None for a present-but-NULL key, and float(None) raises
        # TypeError straight into the fail-open handler below: a single unpriced
        # call would have silently switched this budget gate OFF for the rest of
        # the day. Unknown spend cannot be summed, so it is skipped — the same
        # thing _get_monthly_spend and _preflight_cap_check do, and the same
        # thing SUM() does in SQL.
        total_today = sum(float(r.get("cost_usd") or 0) for r in (result.data or []))
        return total_today < settings.research_daily_budget_usd
    except Exception as exc:
        logger.warning("Budget check failed (fail-open): %s", exc)
        return True


# ---------------------------------------------------------------------------
# Async implementation
# ---------------------------------------------------------------------------


async def _research_async(submission_id: str, dry_run: bool) -> None:
    """
    Full async research pipeline for one wine submission.
    Called from research_agent_task via asyncio.run().
    """
    settings = get_settings()
    spend_logger = get_spend_logger()

    # Pre-flight: daily budget cap (T-12-08)
    if not await _check_daily_budget():
        logger.info(
            "research_agent: daily budget cap reached — skipping submission_id=%s",
            submission_id,
        )
        return

    if not settings.supabase_url or not settings.supabase_key:
        logger.warning(
            "research_agent: Supabase not configured — skipping submission_id=%s",
            submission_id,
        )
        return

    supabase = create_client(settings.supabase_url, settings.supabase_key)

    # Initialize Redis client for entity cache (D-04)
    redis_client = None
    if settings.redis_url:
        try:
            import redis

            redis_client = redis.Redis.from_url(
                settings.redis_url, decode_responses=True
            )
            redis_client.ping()
        except Exception as exc:
            logger.debug(
                "Redis not available for entity cache (falling back to in-memory): %s",
                exc,
            )
            redis_client = None

    # Check Redis budget flag (D-06 bug #4)
    if redis_client:
        try:
            today = datetime.now(timezone.utc).date().isoformat()
            if redis_client.get(f"research:budget_exceeded:{today}"):
                logger.info(
                    "research_agent: Redis budget flag set — skipping submission_id=%s",
                    submission_id,
                )
                return
        except Exception:
            pass  # Fail open

    # Load submission record
    submission: Optional[dict] = None
    try:
        sub_resp = (
            supabase.table("master_wine_library_submissions")
            .select("*")
            .eq("id", submission_id)
            .maybe_single()
            .execute()
        )
        submission = sub_resp.data
    except Exception as exc:
        logger.error("Failed to load submission %s: %s", submission_id, exc)
        return

    if not submission:
        logger.warning("Submission %s not found — skipping", submission_id)
        return

    if not is_eligible_for_research(
        submission,
        priority_fields=RESEARCH_ALL_FIELDS,
        cooldown_days=settings.research_eligibility_cooldown_days,
    ):
        logger.info(
            "research_agent: submission %s not eligible (cooldown/confidence gate)",
            submission_id,
        )
        return

    run_id: Optional[str] = None
    try:
        run_resp = (
            supabase.table("research_runs")
            .insert(
                {
                    "status": "running",
                    "started_at": datetime.now(timezone.utc).isoformat(),
                    "records_eligible": 1,
                }
            )
            .execute()
        )
        run_id = (run_resp.data or [{}])[0].get("id")
    except Exception as exc:
        logger.warning(
            "Failed to create research_run row: %s — continuing without run_id", exc
        )

    existing_fc: dict = submission.get("field_confidence") or {}
    existing_conflicts: dict = (
        submission.get("conflict_candidates") or {}
    )  # Bug #3: for deep-merge
    run_id_str = str(run_id) if run_id else "unknown"

    # Evidence loop
    stats = await _process_record(
        submission=submission,
        run_id=run_id_str,
        settings=settings,
        dry_run=dry_run,
        supabase=supabase,
        spend_logger=spend_logger,
        redis_client=redis_client,
    )

    # Persist results
    await _write_results(
        submission_id=submission_id,
        new_fc_entries=stats.get("new_fc_entries", {}),
        citation_records=stats.get("citation_records", []),
        conflict_updates=stats.get("conflict_updates", {}),
        run_id=run_id_str,
        existing_fc=existing_fc,
        existing_conflicts=existing_conflicts,
        supabase=supabase,
        dry_run=dry_run,
    )

    now_iso = datetime.now(timezone.utc).isoformat()

    if not dry_run:
        # Write research_run_stats row (RSCH-07) with bug #5 and #6 fixes
        try:
            supabase.table("research_run_stats").insert(
                {
                    "run_id": run_id_str,
                    "wine_id": submission_id,
                    "fields_targeted": stats.get("fields_targeted", 0),
                    "fields_filled": stats.get("fields_filled", 0),
                    "fields_conflicted": stats.get("fields_conflicted", 0),
                    "fields_unchanged": stats.get("fields_unchanged", 0),
                    "cost_usd": stats.get("cost_usd", 0.0),
                    "attempts": stats.get("call_counter", 0),
                    "null_rate_before": stats.get("null_rate_before", 0.0),
                    "null_rate_after": stats.get("null_rate_after", 0.0),
                    "time_to_fill_hours": stats.get(
                        "time_to_fill_hours", 0.0
                    ),  # Bug #5
                    "regression_blocked_count": stats.get(
                        "regression_blocked_count", 0
                    ),  # Bug #6
                }
            ).execute()
        except Exception as exc:
            logger.warning("research_run_stats insert failed (non-fatal): %s", exc)

        try:
            supabase.table("master_wine_library_submissions").update(
                {"last_research_run_at": now_iso}
            ).eq("id", submission_id).execute()
        except Exception as exc:
            logger.warning("last_research_run_at update failed (non-fatal): %s", exc)

        if run_id:
            run_status = "completed" if stats.get("fields_filled", 0) > 0 else "partial"
            try:
                supabase.table("research_runs").update(
                    {
                        "status": run_status,
                        "completed_at": now_iso,
                        "records_processed": 1,
                        "fields_filled": stats.get("fields_filled", 0),
                        "cost_usd": stats.get("cost_usd", 0.0),
                        "pii_policy_flags": stats.get("pii_policy_flags", 0),
                    }
                ).eq("id", run_id).execute()
            except Exception as exc:
                logger.warning("research_run update failed (non-fatal): %s", exc)

    logger.info(
        "research_agent: DONE submission=%s fields_filled=%d cost=$%.4f calls=%d dry_run=%s",
        submission_id,
        stats.get("fields_filled", 0),
        stats.get("cost_usd", 0.0),
        stats.get("call_counter", 0),
        dry_run,
    )


# ---------------------------------------------------------------------------
# Celery task entry points
# ---------------------------------------------------------------------------


@celery_app.task(name="research.agent_task")
def research_agent_task(submission_id: str, dry_run: bool = False) -> None:
    """
    Celery task: run gap-filling research agent on one wine submission.

    Args:
        submission_id: UUID string of master_wine_library_submissions row.
        dry_run: If True, all computation runs but no Supabase writes occur (testable).
    """
    asyncio.run(_research_async(submission_id, dry_run))


@celery_app.task(name="research.dispatch_batch")
def research_dispatch_batch_task(batch_size: Optional[int] = None) -> dict:
    """
    Celery task: queue research for wines the matcher could not resolve.

    Why this exists
    ---------------
    Until now research_agent_task only ran when a human POSTed
    /api/v1/research/trigger. Nothing dispatched it for wines created by a menu
    import, so a restaurant could import a 485-wine list and every unmatched
    bottle sat as a tier-3 stub with primary_type='unknown' forever. This is
    the missing link between "the importer created a provisional" and "the
    research agent fills it in".

    Why it does not reuse the endpoint's batch query
    -----------------------------------------------
    That query selects any submission with last_research_run_at IS NULL. Since
    library matching started working, an import creates a submission for every
    wine including the ones that auto-linked to a fully-populated canonical
    row, so that query would spend the daily budget re-deriving facts already
    in the library. Selection lives in
    public.research_eligible_submissions() instead, which returns only wines
    still carrying no real data, emptiest first.

    Safety
    ------
    - Skips entirely while another research run is in flight, matching the
      endpoint's T-12-11 guard. Two concurrent runs would race the budget.
    - Per-record cost ceilings and the daily cap stay where they were, in
      research_agent_task's own pre-flight — this only decides *which* records
      are worth offering, never how much may be spent on them.
    - A broker outage returns a count rather than raising: the next tick
      re-queries eligibility, so nothing is lost by failing quietly here.
    """
    settings = get_settings()
    if not settings.research_dispatch_enabled:
        logger.info("research.dispatch_batch: disabled by settings — skipping")
        return {"queued": 0, "skipped": "disabled"}

    if not settings.supabase_url or not settings.supabase_key:
        logger.warning("research.dispatch_batch: Supabase not configured — skipping")
        return {"queued": 0, "skipped": "no_db"}
    supabase = create_client(settings.supabase_url, settings.supabase_key)

    # Same one-run-at-a-time guard the HTTP trigger enforces (T-12-11).
    try:
        running = (
            supabase.table("research_runs")
            .select("id", count="exact")
            .eq("status", "running")
            .execute()
        )
        if (running.count or 0) > 0:
            logger.info(
                "research.dispatch_batch: a run is already in progress — skipping"
            )
            return {"queued": 0, "skipped": "run_in_progress"}
    except Exception as exc:
        logger.warning(
            "research.dispatch_batch: could not check running status (non-fatal): %s",
            exc,
        )

    limit = batch_size or settings.research_dispatch_batch_size
    try:
        resp = supabase.rpc(
            "research_eligible_submissions",
            {
                "p_limit": limit,
                "p_cooldown_days": settings.research_eligibility_cooldown_days,
            },
        ).execute()
        eligible = resp.data or []
    except Exception as exc:
        logger.error("research.dispatch_batch: eligibility query failed: %s", exc)
        return {"queued": 0, "error": str(exc)}

    if not eligible:
        logger.info("research.dispatch_batch: nothing eligible")
        return {"queued": 0}

    queued, errors = 0, []
    for row in eligible:
        try:
            research_agent_task.delay(row["submission_id"])
            queued += 1
        except Exception as exc:
            errors.append(str(exc))

    if errors:
        logger.error(
            "research.dispatch_batch: %d/%d dispatch(es) failed — first: %s",
            len(errors),
            len(eligible),
            errors[0],
        )
    logger.info(
        "research.dispatch_batch: queued %d of %d eligible record(s)",
        queued,
        len(eligible),
    )
    return {"queued": queued, "eligible": len(eligible), "errors": len(errors)}


@celery_app.task(name="research.daily_budget_check")
def research_daily_budget_check_task() -> None:
    """
    Bug #4 fix: log result AND set Redis flag when budget exceeded.
    The authoritative check is inside research_agent_task's _research_async() pre-flight.
    """
    result = asyncio.run(_check_daily_budget())
    settings = get_settings()
    logger.info("research_daily_budget_check: within_budget=%s", result)
    if not result:
        logger.warning(
            "research_daily_budget_check: BUDGET EXCEEDED — setting Redis flag"
        )
        if settings.redis_url:
            try:
                import redis

                r = redis.Redis.from_url(settings.redis_url, decode_responses=True)
                today = datetime.now(timezone.utc).date().isoformat()
                r.setex(f"research:budget_exceeded:{today}", 86400, "1")
            except Exception as exc:
                logger.debug("Redis flag set failed (non-fatal): %s", exc)


# ---------------------------------------------------------------------------
# D-07: Staleness re-verification task (weekly)
# ---------------------------------------------------------------------------


@celery_app.task(name="research.staleness_reverify")
def staleness_reverify_task() -> None:
    """
    D-07: Weekly re-verification of human_resolved fields older than 180 days.

    Queries master_wine_library_submissions for field_confidence entries where:
      - source = 'human_resolved'
      - The entry is older than 180 days (checked via evidence_citations.retrieved_at)

    For each stale field:
      1. Look up original citation URL from evidence_citations
      2. Re-fetch the URL via _fetch_verify_value
      3. If value no longer present on page:
         - Downgrade confidence from 1.0 to 0.85
         - Change source to "human_resolved_stale"
         - Insert into field_review_queue with status="pending"
      4. If value still present: no change (re-verified successfully)

    Limits to 50 records per run to avoid long-running tasks.
    """
    asyncio.run(_staleness_reverify_async())


async def _staleness_reverify_async() -> None:
    settings = get_settings()
    if not settings.supabase_url or not settings.supabase_key:
        logger.warning("staleness_reverify: Supabase not configured — skipping")
        return

    supabase = create_client(settings.supabase_url, settings.supabase_key)
    cutoff = (datetime.now(timezone.utc) - timedelta(days=180)).isoformat()

    # Find evidence_citations for human_resolved fields older than 180 days
    try:
        resp = (
            supabase.table("evidence_citations")
            .select("wine_id, field_name, source_url, proposed_value")
            .lt("retrieved_at", cutoff)
            .limit(50)
            .execute()
        )
        stale_citations = resp.data or []
    except Exception as exc:
        logger.error("staleness_reverify: citation query failed: %s", exc)
        return

    if not stale_citations:
        logger.info("staleness_reverify: no stale citations found")
        return

    downgraded = 0
    for citation in stale_citations:
        wine_id = citation.get("wine_id")
        field_name = citation.get("field_name")
        source_url = citation.get("source_url")
        proposed_value = citation.get("proposed_value", "")

        if not wine_id or not field_name or not source_url:
            continue

        # Check if field is still human_resolved
        try:
            sub_resp = (
                supabase.table("master_wine_library_submissions")
                .select("field_confidence")
                .eq("id", wine_id)
                .maybe_single()
                .execute()
            )
            if not sub_resp.data:
                continue
            fc = sub_resp.data.get("field_confidence") or {}
            entry = fc.get(field_name, {})
            if entry.get("source") != "human_resolved":
                continue
        except Exception:
            continue

        # Re-fetch verify
        still_valid = await _fetch_verify_value(
            proposed_value, source_url, "A", field_name, supabase
        )

        if still_valid:
            logger.debug(
                "staleness_reverify: field=%s wine=%s still valid", field_name, wine_id
            )
            continue

        # Value no longer present → downgrade
        logger.info(
            "staleness_reverify: STALE field=%s wine=%s — downgrading to 0.85",
            field_name,
            wine_id,
        )
        fc[field_name] = {
            "value": entry.get("value"),
            "confidence": 0.85,
            "source": "human_resolved_stale",
        }

        try:
            supabase.table("master_wine_library_submissions").update(
                {
                    "field_confidence": fc,
                }
            ).eq("id", wine_id).execute()
        except Exception as exc:
            logger.warning(
                "staleness_reverify: FC update failed wine=%s: %s", wine_id, exc
            )
            continue

        # Insert into field_review_queue
        try:
            supabase.table("field_review_queue").insert(
                {
                    "submission_id": wine_id,
                    "field_name": field_name,
                    "current_value": str(entry.get("value", "")),
                    "confidence": 0.85,
                    "source": "knowledge",
                    "status": "pending",
                }
            ).execute()
        except Exception as exc:
            logger.warning("staleness_reverify: review queue insert failed: %s", exc)

        downgraded += 1

    logger.info(
        "staleness_reverify: processed %d citations, downgraded %d",
        len(stale_citations),
        downgraded,
    )

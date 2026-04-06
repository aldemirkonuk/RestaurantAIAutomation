"""
Research Agent Celery Task
==========================
Phase 12: Gap-filling research agent — the core evidence loop.

Evidence loop per wine record:
  1. Daily budget cap pre-flight (T-12-08)
  2. Load submission, eligibility gate (cooldown + confidence)
  3. Create research_run row
  4. _process_record(): for each target field:
       a. Serper search → snippets (call_counter += 1)
       b. Gemini Flash per-field extraction → candidates (call_counter += 1)
       c. PII filter on snippets (T-12-09)
       d. Conflict detection → conflict_candidates JSONB (not field_confidence)
       e. Fetch-verify top candidate: httpx → Playwright → semantic match (call_counter += 1)
       f. Corroboration check → should_auto_promote()
       g. Regression guard → check_regression_guard()
       h. Build citation record
  5. _write_results(): merge + route + DB writes
  6. Write research_run_stats row
  7. Update last_research_run_at

Threat mitigations:
  T-12-05 (SSRF): validate https:// scheme, block private IP ranges before any fetch
  T-12-06 (DoS): stop_rule (call_counter >= max) + per-record cost ceiling
  T-12-07 (Tampering): merge_field_confidence() before every DB write
  T-12-08 (DoS): _check_daily_budget() pre-flight in research_agent_task
  T-12-09 (PII): regex filter on snippets; blocked snippets never written to evidence_citations
"""

from __future__ import annotations

import asyncio
import ipaddress
import json
import logging
import re
import unicodedata
from datetime import datetime, timezone
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
)
from services.serper_client import serper_search
from services.spend_logger import get_spend_logger

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# PII detection patterns (T-12-09)
_PII_EMAIL_RE = re.compile(r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b')
_PII_PHONE_RE = re.compile(r'\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b')

# Wine content keywords for Playwright trigger decision
WINE_KEYWORDS = frozenset({
    "wine", "grape", "vintage", "appellation", "region",
    "producer", "winery", "vino", "cuvee", "château", "domaine",
})

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
NUMERIC_RESEARCH_FIELDS = frozenset({
    "alcohol_pct", "vintage", "price_bottle", "price_glass", "retail_price_avg",
})

# URL page-text TTL (days)
_URL_CACHE_TTL_DAYS = 7

# In-process URL cache (populated from Supabase on first lookup)
_url_cache: dict[str, tuple[str, datetime]] = {}


# ---------------------------------------------------------------------------
# T-12-05: SSRF protection
# ---------------------------------------------------------------------------

def _is_safe_url(url: str) -> bool:
    """
    Returns True if URL is safe to fetch.
    Blocks non-https:// and private/loopback IP ranges.
    """
    try:
        parsed = urlparse(url)
        if parsed.scheme != "https":
            return False
        host = parsed.hostname or ""
        if not host:
            return False
        try:
            addr = ipaddress.ip_address(host)
            for network in _PRIVATE_NETWORKS:
                if addr in network:
                    return False
        except ValueError:
            pass  # Domain name, not a raw IP — safe
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
        nums = re.findall(r'\d+\.?\d*', page_text)
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

    # Numeric fields: use float comparison
    if field_name in NUMERIC_RESEARCH_FIELDS:
        return _numeric_match(proposed_value, page_text)

    norm_value = _normalize_text(proposed_value)
    # Cap page_text to 20K chars for performance (wine info is near page top)
    norm_text = _normalize_text(page_text[:20000])

    if not norm_value:
        return False

    # Step 1: exact word-boundary match
    escaped = re.escape(norm_value)
    if re.search(r'\b' + escaped + r'\b', norm_text):
        return True

    # Step 2: Levenshtein window (only for values >= 4 chars)
    val_len = len(norm_value)
    if val_len < 4:
        return norm_value in norm_text

    max_dist = max(1, int(val_len * 0.15))

    # Slide over norm_text in half-word steps to find close matches
    step = max(1, val_len // 2)
    for i in range(0, max(1, len(norm_text) - val_len + 1), step):
        window = norm_text[i:i + val_len]
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
        logger.debug("Playwright not installed — skipping Playwright render for %s", url)
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
# ---------------------------------------------------------------------------

def _get_cached_page_text(url: str, supabase) -> Optional[str]:
    """
    Check in-memory cache then Supabase evidence_url_cache.
    Returns page text if cache hit within TTL, else None.
    """
    now = datetime.now(timezone.utc)

    # In-memory cache (valid for current task run)
    if url in _url_cache:
        text, cached_at = _url_cache[url]
        if (now - cached_at).days < _URL_CACHE_TTL_DAYS:
            return text

    # Supabase cache
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
                    _url_cache[url] = (text, cached_dt)
                    return text
    except Exception as exc:
        logger.debug("URL cache lookup failed (non-fatal): %s", exc)

    return None


def _store_cached_page_text(url: str, page_text: str, fetch_method: str, supabase) -> None:
    """Store page text in in-memory cache and Supabase evidence_url_cache."""
    now = datetime.now(timezone.utc)
    _url_cache[url] = (page_text, now)
    try:
        supabase.table("evidence_url_cache").upsert({
            "url": url,
            "page_text": page_text[:50000],  # cap at 50KB
            "cached_at": now.isoformat(),
            "fetch_method": fetch_method,
        }).execute()
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
    T-12-05: validates URL safety before any HTTP call.
    """
    if not _is_safe_url(source_url):
        logger.debug("SSRF guard: skipping unsafe URL %s", source_url)
        return False

    # Check cache first (prevent redundant re-fetches)
    page_text = _get_cached_page_text(source_url, supabase)
    fetch_method = "cache"

    if page_text is None:
        # Tier-1: httpx async GET
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

        # Tier-2: Playwright if httpx result is insufficient
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
# Gemini Flash per-field candidate extraction
# ---------------------------------------------------------------------------

async def _extract_field_candidates(
    field_name: str,
    wine_name: str,
    vintage: Optional[str],
    snippets: list[dict],
    spend_logger,
) -> list[dict[str, Any]]:
    """
    Use Gemini Flash to extract candidates for a specific field from Serper snippets.

    Returns list of {value, source_url, snippet_used, confidence} dicts.
    Returns [] if no evidence found or API unavailable.
    """
    settings = get_settings()
    if not settings.google_api_key:
        logger.debug("GOOGLE_API_KEY not configured — skipping Gemini extraction for %s", field_name)
        return []
    if not snippets:
        return []

    from google import genai

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

    try:
        client = genai.Client(api_key=settings.google_api_key)
        response = client.models.generate_content(
            model="gemini-2.0-flash",
            contents=prompt,
            config={"response_mime_type": "application/json"},
        )
        raw = (response.text or "").strip()

        # Strip markdown code fences if present (defensive)
        if raw.startswith("```"):
            raw = re.sub(r"^```[a-z]*\n?", "", raw)
            raw = re.sub(r"\n?```$", "", raw)
            raw = raw.strip()

        # Log Gemini spend (non-fatal)
        try:
            usage = getattr(response, "usage_metadata", None)
            in_tok = getattr(usage, "prompt_token_count", 0) or 0
            out_tok = getattr(usage, "candidates_token_count", 0) or 0
            cost = (in_tok * 0.075 / 1_000_000) + (out_tok * 0.30 / 1_000_000)
            spend_logger.log(
                provider="google",
                model="gemini-2.0-flash",
                input_tokens=in_tok,
                output_tokens=out_tok,
                cost_usd=cost,
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
# Core evidence loop
# ---------------------------------------------------------------------------

async def _process_record(
    submission: dict[str, Any],
    run_id: str,
    settings,
    dry_run: bool,
    supabase,
    spend_logger,
) -> dict[str, Any]:
    """
    Evidence loop for one wine record. Returns stats dict for research_run_stats.

    Enforces:
    - Stop rule: call_counter >= max_calls → break (T-12-06)
    - Budget ceiling: record_cost >= max_cost → break (T-12-06)
    - Conflict routing to conflict_candidates JSONB (not field_confidence) (RSCH-05)
    - merge_field_confidence() in _write_results before every DB write (T-12-07)
    - PII filter on snippets (T-12-09)
    """
    wine_id = str(submission.get("id", ""))
    wine_name = submission.get("wine_name") or ""
    producer = submission.get("producer") or ""
    vintage = str(submission.get("vintage", "")) if submission.get("vintage") else None
    existing_fc: dict = submission.get("field_confidence") or {}

    target_fields = get_target_fields(existing_fc, RESEARCH_ALL_FIELDS)

    # Null rate before (fraction of RESEARCH_ALL_FIELDS with no FC entry)
    total_fields = len(RESEARCH_ALL_FIELDS)
    null_count_before = sum(1 for f in RESEARCH_ALL_FIELDS if not existing_fc.get(f))
    null_rate_before = null_count_before / total_fields if total_fields else 0.0

    call_counter = 0
    record_cost = 0.0
    new_fc_entries: dict[str, Any] = {}
    citation_records: list[dict] = []
    conflict_updates: dict[str, list] = {}
    pii_policy_flags = 0
    fields_filled = 0
    fields_conflicted = 0
    fields_unchanged = 0

    for field_name in target_fields:
        # Stop rule (T-12-06): checked before every tool call
        if call_counter >= settings.research_max_calls_per_record:
            logger.info(
                "research_agent: stop rule (%d calls) — stopping field loop wine_id=%s",
                call_counter, wine_id,
            )
            break

        # Per-record budget ceiling (T-12-06)
        if record_cost >= settings.research_max_cost_per_record_usd:
            logger.info(
                "research_agent: cost ceiling ($%.4f) — stopping field loop wine_id=%s",
                record_cost, wine_id,
            )
            break

        # --- Serper search (call_counter += 1) ---
        query = build_serper_query(field_name, wine_name, producer, vintage)
        call_counter += 1
        serper_cost = settings.serper_cost_per_query
        record_cost += serper_cost

        search_results: list = []
        try:
            search_results = await serper_search(query, num_results=5)
        except Exception as exc:
            logger.warning(
                "Serper search failed for field=%s wine_id=%s: %s", field_name, wine_id, exc
            )

        # SpendLogger — wrapped in try/except, must never interrupt task
        try:
            spend_logger.log(
                provider="serper",
                model="search",
                input_tokens=0,
                output_tokens=0,
                cost_usd=serper_cost,
            )
        except Exception as spend_err:
            logger.debug("Serper spend log failed (non-fatal): %s", spend_err)

        if not search_results:
            fields_unchanged += 1
            continue

        # PII filter on snippets (T-12-09): blocked snippets never written to citations
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

        # --- Gemini Flash extraction (call_counter += 1) ---
        # Enforce stop rule before next tool call
        if call_counter >= settings.research_max_calls_per_record:
            break

        call_counter += 1
        gemini_cost = 0.0001  # Decision 4: ~$0.0001 per Gemini Flash call
        record_cost += gemini_cost

        candidates = await _extract_field_candidates(
            field_name,
            wine_name,
            vintage,
            [
                {"title": sr["title"], "link": sr["link"], "snippet": sr["snippet"]}
                for sr in clean_snippets
            ],
            spend_logger,
        )

        if not candidates:
            fields_unchanged += 1
            continue

        # Classify source tier for each candidate
        for cand in candidates:
            url = cand.get("source_url", "")
            cand["source_tier"] = classify_source_tier(url, producer=producer if producer else None)

        # Conflict detection (RSCH-05): conflicted fields → conflict_candidates, NOT field_confidence
        if detect_conflict(candidates):
            logger.info(
                "Conflict detected field=%s wine_id=%s — routing to conflict_candidates",
                field_name, wine_id,
            )
            conflict_updates[field_name] = candidates
            fields_conflicted += 1
            continue

        top_candidate = candidates[0]

        # --- Fetch-verify (call_counter += 1) ---
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
                record_cost += 0.001  # fetch-verify cost (Decision 4)
                fetch_verified = await _fetch_verify_value(
                    proposed_value, top_url, top_tier, field_name, supabase
                )

        top_candidate["fetch_verified"] = fetch_verified

        # Corroboration check (RSCH-03)
        can_promote, conf_key = should_auto_promote(candidates)
        if not can_promote:
            fields_unchanged += 1
            continue

        confidence = assign_confidence_by_tier(conf_key)
        proposed_value = str(top_candidate.get("value", ""))

        # Regression guard (T-12-07): explicit pre-check before merge
        if not check_regression_guard(field_name, confidence, existing_fc):
            logger.debug(
                "Regression guard blocked field=%s wine_id=%s (proposed=%.2f < existing)",
                field_name, wine_id, confidence,
            )
            fields_unchanged += 1
            continue

        # Build citation record (RSCH-02): every promoted fill produces one
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

        # Accumulate new field_confidence entry
        new_fc_entries[field_name] = {
            "value": proposed_value,
            "confidence": confidence,
            "source": "research_agent",
        }
        fields_filled += 1

    # Compute null_rate_after using tentative merged FC
    tentative_fc = {**existing_fc, **new_fc_entries}
    null_count_after = sum(1 for f in RESEARCH_ALL_FIELDS if not tentative_fc.get(f))
    null_rate_after = null_count_after / total_fields if total_fields else 0.0

    return {
        "new_fc_entries": new_fc_entries,
        "citation_records": citation_records,
        "conflict_updates": conflict_updates,
        "fields_targeted": len(target_fields),
        "fields_filled": fields_filled,
        "fields_conflicted": fields_conflicted,
        "fields_unchanged": fields_unchanged,
        "null_rate_before": null_rate_before,
        "null_rate_after": null_rate_after,
        "call_counter": call_counter,
        "cost_usd": record_cost,
        "pii_policy_flags": pii_policy_flags,
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
    """
    if dry_run:
        logger.info("DRY RUN: skipping all Supabase writes for submission_id=%s", submission_id)
        return {"dry_run": True}

    # (a) Merge: merge_field_confidence() called before every DB write (T-12-07)
    updated_fc = merge_field_confidence(existing_fc, new_fc_entries)

    # (b) Route by threshold
    accepted, review_list, _rejected = route_fields_by_threshold(
        updated_fc,
        DEFAULT_REVIEW_THRESHOLD,
        DEFAULT_ACCEPT_THRESHOLD,
    )

    # (c) Write field_review_queue rows for review-tier fields
    # Map source "research_agent" → "knowledge" to satisfy the DB CHECK constraint
    now_iso = datetime.now(timezone.utc).isoformat()
    if review_list:
        queue_rows = []
        for item in review_list:
            source_raw = item.get("source", "research_agent")
            # DB CHECK: source IN ('visible', 'inferred', 'knowledge')
            db_source = "knowledge" if source_raw not in ("visible", "inferred") else source_raw
            queue_rows.append({
                "submission_id": submission_id,
                "field_name": item["field_name"],
                "current_value": item.get("current_value"),
                "confidence": item.get("confidence", 0.0),
                "source": db_source,
                "status": "pending",
            })
        try:
            supabase.table("field_review_queue").insert(queue_rows).execute()
        except Exception as exc:
            logger.warning("field_review_queue insert failed (non-fatal): %s", exc)

    # (d) Batch insert evidence_citations (RSCH-02)
    if citation_records:
        try:
            supabase.table("evidence_citations").insert(citation_records).execute()
        except Exception as exc:
            logger.warning("evidence_citations insert failed (non-fatal): %s", exc)

    # (e) Update submission: field_confidence + conflict_candidates + last_research_run_at
    update_payload: dict[str, Any] = {
        "field_confidence": updated_fc,
        "last_research_run_at": now_iso,
    }
    if conflict_updates:
        update_payload["conflict_candidates"] = conflict_updates

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
# T-12-08: Daily budget cap check
# ---------------------------------------------------------------------------

async def _check_daily_budget() -> bool:
    """
    Returns True if today's research API spend is below the daily cap.
    Reads api_spend rows for provider="serper" since midnight UTC today.
    Fails open on any error — infra failure must not block research.
    """
    settings = get_settings()
    if not settings.supabase_url or not settings.supabase_key:
        return True  # Not configured — fail open

    supabase = create_client(settings.supabase_url, settings.supabase_key)
    today = datetime.now(timezone.utc).date().isoformat()

    try:
        result = (
            supabase.table("api_spend")
            .select("cost_usd")
            .eq("provider", "serper")
            .gte("timestamp", today)
            .execute()
        )
        total_today = sum(float(r.get("cost_usd", 0)) for r in (result.data or []))
        return total_today < settings.research_daily_budget_usd
    except Exception as exc:
        logger.warning("Budget check failed (fail-open): %s", exc)
        return True  # Fail open — infra failure must not block research


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
            "research_agent: Supabase not configured — skipping submission_id=%s", submission_id
        )
        return

    supabase = create_client(settings.supabase_url, settings.supabase_key)

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

    # Eligibility gate: cooldown + confidence threshold check
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

    # Create research_run row (batch-level accounting)
    run_id: Optional[str] = None
    try:
        run_resp = (
            supabase.table("research_runs")
            .insert({
                "status": "running",
                "started_at": datetime.now(timezone.utc).isoformat(),
                "records_eligible": 1,
            })
            .execute()
        )
        run_id = (run_resp.data or [{}])[0].get("id")
    except Exception as exc:
        logger.warning("Failed to create research_run row: %s — continuing without run_id", exc)

    existing_fc: dict = submission.get("field_confidence") or {}
    run_id_str = str(run_id) if run_id else "unknown"

    # Evidence loop
    stats = await _process_record(
        submission=submission,
        run_id=run_id_str,
        settings=settings,
        dry_run=dry_run,
        supabase=supabase,
        spend_logger=spend_logger,
    )

    # Persist results
    await _write_results(
        submission_id=submission_id,
        new_fc_entries=stats.get("new_fc_entries", {}),
        citation_records=stats.get("citation_records", []),
        conflict_updates=stats.get("conflict_updates", {}),
        run_id=run_id_str,
        existing_fc=existing_fc,
        supabase=supabase,
        dry_run=dry_run,
    )

    now_iso = datetime.now(timezone.utc).isoformat()

    if not dry_run:
        # Write research_run_stats row (RSCH-07)
        try:
            supabase.table("research_run_stats").insert({
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
            }).execute()
        except Exception as exc:
            logger.warning("research_run_stats insert failed (non-fatal): %s", exc)

        # Update last_research_run_at — even on partial runs (prevents hammering same record)
        try:
            supabase.table("master_wine_library_submissions").update(
                {"last_research_run_at": now_iso}
            ).eq("id", submission_id).execute()
        except Exception as exc:
            logger.warning("last_research_run_at update failed (non-fatal): %s", exc)

        # Close research_run row
        if run_id:
            run_status = "completed" if stats.get("fields_filled", 0) > 0 else "partial"
            try:
                supabase.table("research_runs").update({
                    "status": run_status,
                    "completed_at": now_iso,
                    "records_processed": 1,
                    "fields_filled": stats.get("fields_filled", 0),
                    "cost_usd": stats.get("cost_usd", 0.0),
                    "pii_policy_flags": stats.get("pii_policy_flags", 0),
                }).eq("id", run_id).execute()
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


@celery_app.task(name="research.daily_budget_check")
def research_daily_budget_check_task() -> None:
    """
    Advisory hourly budget check task.
    The authoritative check is inside research_agent_task's _research_async() pre-flight.
    """
    asyncio.run(_check_daily_budget())

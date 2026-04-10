# Phase 8: Web Search Verification & Deep Enrichment — Research

**Researched:** 2026-04-06
**Domain:** Web search API integration, Celery async task dedup, Gemini Flash structured extraction, Supabase upsert, producer knowledge graph
**Confidence:** HIGH (all critical claims verified against live sources or codebase)

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| WSRCH-01 | `web_verify_task` Celery task: accepts wine_id, constructs search query, executes via Serper/Tavily | Serper httpx pattern verified; Celery task pattern from haiku_tasks.py |
| WSRCH-02 | Top-5 search results parsed by Gemini Flash into structured fields matching master_wine_library schema | Gemini 2.5 Flash + `response_mime_type: application/json` pattern verified via google-genai SDK |
| WSRCH-03 | Concordance engine: concordance → boost confidence to 0.95+ with verification_source; contradiction → flag for review | merge_field_confidence(overwrite_lower=True) already handles boosting; add verification_status key to FC entry |
| WSRCH-04 | `producers` table: normalized_name, country, region, certifications, portfolio, verification metadata | Supabase upsert on_conflict="normalized_name" verified in supabase-py docs |
| WSRCH-05 | Producer graph lookup BEFORE web search — known producer = instant enrichment, no API call | Supabase .select().eq() pattern from existing codebase |
| WSRCH-06 | `verification_status` added to field_confidence JSONB entries: "unverified"/"web_verified"/"contradicted"/"producer_graph" | Extends existing {value, confidence, source} structure with 4th key |
| WSRCH-07 | Tiered search strategy: only search wines where low confidence OR new producer OR never verified | Supabase query with OR conditions pattern |
| WSRCH-08 | Daily web search budget cap (default $5/day), enforced before task execution | api_spend table from Phase 5 + new web_search_spend_today() helper |
| WSRCH-09 | E2E test: submit wine → web_verify_task → field_confidence updated with verification_source | pytest-mock + respx for HTTP mocking; pattern from test_field_confidence.py |
</phase_requirements>

---

## Summary

Phase 8 builds a per-wine background web search agent on top of the Phase 7 field_confidence framework. The core pipeline is: Celery task receives wine_id → constructs query → calls Serper API (Google Search proxy) → passes top-5 snippets to Gemini 2.5 Flash for structured extraction → concordance engine compares web data against existing field_confidence → updates JSONB entries with verification_status → updates or creates `producers` knowledge graph record.

The technical stack decision is clear: **Serper API over Tavily** for cost reasons ($0.001/query vs $0.005/query), using httpx directly (no SDK needed, avoids a new dependency). **Gemini 2.5 Flash** over 2.0 Flash for structured extraction, using the `google-genai` SDK (already in requirements.txt at v1.66.0) with `response_mime_type: "application/json"` and a Pydantic response schema. **Redis SET NX** for Celery task deduplication (Redis already in requirements.txt). **Supabase upsert with on_conflict="normalized_name"** for the producers table, protected by a UNIQUE constraint in the migration.

The most non-obvious decision: `verification_status` lives INSIDE each field_confidence JSONB entry as a 4th key alongside `{value, confidence, source}` — not as a separate column. This is because WSRCH-06 explicitly requires per-field verification tracking, and the existing `merge_field_confidence()` function already merges at the field-entry level, so adding `verification_status` there is zero-friction.

**Primary recommendation:** Use Serper (httpx) → Gemini 2.5 Flash (response schema) → concordance against field_confidence → producers upsert. Follow the exact pattern of haiku_tasks.py for the Celery task.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| httpx | 0.28.1 (installed) | Serper API HTTP calls | Already in requirements.txt; async-native; used throughout codebase |
| google-genai | 1.66.0 (installed) | Gemini 2.5 Flash structured extraction | Already in requirements.txt; used in vlm_extraction_service.py |
| celery | 5.3.6 (installed) | Async background task | Already in requirements.txt; established pattern in haiku_tasks.py |
| redis | 5.0.1 (installed) | Celery broker + task dedup SET NX lock | Already in requirements.txt |
| supabase-py | ≥2.10.0 (installed) | Producers table upsert + field_confidence update | Already in requirements.txt |
| python-slugify | 8.0.4 | Producer name normalization (unidecode-backed) | Standard for Unicode slug normalization |
| unidecode | 1.4.0 | Unicode transliteration for producer names | Referenced throughout wine data normalization literature |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| tenacity | 8.2.3 (installed) | Retry with backoff for Serper/Gemini calls | Non-200 responses; rate limit transients |
| pydantic | 2.6.0 (installed) | WineVerificationResult schema for Gemini response | All structured Gemini outputs |

### New Dependencies (not currently installed)
| Library | Version | Purpose | Installation |
|---------|---------|---------|--------------|
| python-slugify[unidecode] | 8.0.4 | Producer name normalization | `pip install "python-slugify[unidecode]"` |

**Note:** `unidecode` is NOT currently installed. python-slugify[unidecode] adds both. [VERIFIED: pip3 show unidecode returned not found]

**Installation:**
```bash
pip install "python-slugify[unidecode]"
```

**Version verification:** [VERIFIED: pip3 show on the system — google-genai=1.66.0, httpx=0.28.1, celery=5.3.6, redis=5.0.1]

---

## Architecture Patterns

### Recommended Project Structure
```
services/agent-orchestrator/
├── jobs/
│   └── web_verify_tasks.py        # web_verify_task Celery task (WSRCH-01)
├── services/
│   ├── serper_client.py           # Serper API httpx wrapper
│   ├── web_verification_service.py # Concordance engine + producer graph logic
│   └── producer_normalization.py  # normalize_producer_name() helper
└── tests/
    └── test_web_verification.py   # E2E + unit tests (WSRCH-09)
```

### Pattern 1: Serper API via httpx (no SDK)

**What:** POST to `https://google.serper.dev/search` with `X-API-KEY` header. Returns organic results with title, link, snippet, position. Top 5 organic results sufficient for wine verification.

**When to use:** All web search calls. No official Python SDK — httpx is the right choice.

```python
# Source: Serper API docs (https://serper.dev/) + GraphBit documentation example
import httpx
import json

async def serper_search(query: str, num_results: int = 5) -> list[dict]:
    url = "https://google.serper.dev/search"
    headers = {
        "X-API-KEY": settings.serper_api_key,
        "Content-Type": "application/json",
    }
    payload = {"q": query, "num": num_results}
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.post(url, headers=headers, json=payload)
        resp.raise_for_status()
        data = resp.json()
    return data.get("organic", [])[:num_results]
```

The response `organic` list contains: `{title, link, snippet, position}`. Pass `title + snippet` to Gemini Flash — not the raw URL content (that would require separate fetching).

### Pattern 2: Gemini 2.5 Flash Structured Extraction

**What:** Use `google-genai` SDK (already installed at v1.66.0) with `response_mime_type: "application/json"`. Define a Pydantic model for the wine field extraction response and pass its JSON schema. [VERIFIED: Gemini structured output docs at ai.google.dev, googleapis/python-genai GitHub]

**Model to use:** `gemini-2.5-flash` — confirmed available and preferred over `gemini-2.0-flash` for structured extraction tasks per Google docs. The codebase already uses `gemini-2.5-flash` in `vlm_extraction_service.py` (as confirmed in Session 5 STATE.md).

```python
# Source: ai.google.dev/gemini-api/docs/structured-output [CITED]
from google import genai
from pydantic import BaseModel, Field
from typing import Optional

class WineVerificationResult(BaseModel):
    producer: Optional[str] = Field(None, description="Producer/winery name")
    region: Optional[str] = Field(None, description="Wine region")
    sub_region: Optional[str] = Field(None, description="Sub-region")
    appellation: Optional[str] = Field(None, description="Appellation/DOC/AOC")
    country: Optional[str] = Field(None, description="Country of origin")
    grape_variety: Optional[str] = Field(None, description="Primary grape variety")
    color: Optional[str] = Field(None, description="red/white/rosé/amber")
    primary_type: Optional[str] = Field(None, description="red/white/rosé/sparkling/dessert/fortified/orange")
    alcohol_pct: Optional[float] = Field(None, description="ABV percentage")
    # Source confidence per field (0.0-1.0) based on source reliability
    source_confidence: Optional[float] = Field(None, description="Confidence in this web source (0.0-1.0)")

client = genai.Client(api_key=settings.google_api_key)
response = client.models.generate_content(
    model="gemini-2.5-flash",
    contents=prompt,
    config={
        "response_mime_type": "application/json",
        "response_json_schema": WineVerificationResult.model_json_schema(),
    },
)
result = WineVerificationResult.model_validate_json(response.text)
```

### Pattern 3: Celery Task with Redis Dedup Lock

**What:** Before queuing `web_verify_task`, check Redis for an existing lock key `wine:verify:{wine_id}`. If key exists, skip (already queued or running). Set key with NX (only if not exists) + EX TTL=3600 inside the task prologue.

**When to use:** Every `web_verify_task` invocation. Prevents multiple concurrent tasks for the same wine_id when onboarding triggers fire in rapid succession.

```python
# Source: Standard Redis NX pattern + celery-singleton docs [VERIFIED: alessandrofuda.github.io + pypi.org/celery-singleton]
import redis as redis_lib

@celery_app.task(name="web_verify.verify_wine", bind=True, max_retries=3)
def web_verify_task(self, wine_id: str) -> Optional[dict]:
    r = redis_lib.from_url(settings.celery_broker_url)
    lock_key = f"wine:verify:{wine_id}"
    # SET NX EX — set only if not exists, expire in 1 hour
    acquired = r.set(lock_key, "1", nx=True, ex=3600)
    if not acquired:
        logger.info("web_verify_task already queued/running for wine_id=%s, skipping", wine_id)
        return None
    try:
        result = asyncio.run(_verify_async(wine_id))
        return result
    except Exception as exc:
        retry_num = self.request.retries
        countdown = 60 * (2 ** retry_num)
        raise self.retry(exc=exc, countdown=countdown)
    finally:
        r.delete(lock_key)  # release on completion
```

### Pattern 4: Producer Normalization

**What:** `unidecode(name).lower()` → strip all non-alphanumeric chars → collapse spaces/hyphens → strip whitespace. This is the standard for wine producer name keys.

```python
# Source: python-slugify docs + unidecode docs [VERIFIED: pypi.org/project/python-slugify, pypi.org/project/Unidecode]
import re
from unidecode import unidecode

def normalize_producer_name(name: str) -> str:
    """
    Normalize producer name to a stable lookup key.
    "Château Müller-Catoir" → "chateau-muller-catoir"
    "Domaine de la Romanée-Conti" → "domaine-de-la-romanee-conti"
    """
    if not name:
        return ""
    # 1. Transliterate Unicode → ASCII (Château → Chateau, Müller → Muller)
    text = unidecode(name)
    # 2. Lowercase
    text = text.lower()
    # 3. Replace non-alphanumeric with hyphens, collapse runs
    text = re.sub(r'[^\w]+', '-', text)
    text = text.strip('-')
    return text
```

### Pattern 5: Supabase Producers Upsert

**What:** Single-column upsert on `normalized_name` with UNIQUE constraint in migration. supabase-py supports `on_conflict="normalized_name"` for single-column constraints. [VERIFIED: supabase.com/docs/reference/python/upsert]

```python
# Source: Supabase Python docs [CITED: https://supabase.com/docs/reference/python/upsert]
supabase.table("producers").upsert(
    {
        "name": producer_name,
        "normalized_name": normalized_name,  # UNIQUE column
        "country": country,
        "region": region,
        "certifications": certifications_jsonb,
        "portfolio": portfolio_jsonb,
        "verified_at": datetime.utcnow().isoformat(),
        "verification_sources": [source_name],
    },
    on_conflict="normalized_name",  # only works on single UNIQUE column
).execute()
```

**Critical migration requirement:** `ALTER TABLE producers ADD CONSTRAINT producers_normalized_name_key UNIQUE (normalized_name);` — without this, the upsert becomes a plain INSERT and will duplicate rows.

### Pattern 6: Concordance Engine

**What:** Field-by-field comparison of web-extracted values against existing `field_confidence` entries. Uses normalized string comparison for region aliases.

```python
# [ASSUMED] - no standard library for wine concordance; hand-implement is correct approach
REGION_ALIASES: dict[str, str] = {
    "burgundy": "bourgogne",
    "bourgogne": "bourgogne",
    "champagne": "champagne",
    "bordeaux": "bordeaux",
    "rhone valley": "rhone",
    "rhône valley": "rhone",
    # ... expand for common aliases
}

def check_concordance(
    field_name: str,
    existing_entry: dict,      # {value, confidence, source, verification_status}
    web_value: str,
    source_confidence: float,
) -> str:
    """Returns: 'concordance' | 'contradiction' | 'new_data'"""
    existing_value = existing_entry.get("value")
    if existing_value is None:
        return "new_data"
    
    # Normalize both for comparison
    norm_existing = normalize_for_compare(str(existing_value), field_name)
    norm_web = normalize_for_compare(str(web_value), field_name)
    
    if norm_existing == norm_web:
        return "concordance"
    
    # Apply alias check for region/country fields
    if field_name in ("region", "sub_region", "appellation"):
        alias_existing = REGION_ALIASES.get(norm_existing, norm_existing)
        alias_web = REGION_ALIASES.get(norm_web, norm_web)
        if alias_existing == alias_web:
            return "concordance"
    
    return "contradiction"
```

### Pattern 7: verification_status in field_confidence JSONB

**What:** WSRCH-06 requires per-field `verification_status`. Add as a 4th key to existing `{value, confidence, source}` entries. The existing `merge_field_confidence(overwrite_lower=True)` correctly handles confidence boosts. [VERIFIED: field_confidence.py in codebase]

Structure after web verification:
```json
{
  "region": {
    "value": "Burgundy",
    "confidence": 0.95,
    "source": "web_search",
    "verification_status": "web_verified"
  },
  "sub_region": {
    "value": "Côte de Nuits",
    "confidence": 0.72,
    "source": "knowledge",
    "verification_status": "contradicted",
    "contradicted_value": "Côte de Beaune"
  }
}
```

`merge_field_confidence(existing_fc, web_fc, overwrite_lower=True)` handles confidence boost to 0.95+ correctly: `new_confidence(0.95) >= existing_confidence(0.85)` → overwrites. This is the correct behavior per WSRCH-03.

### Anti-Patterns to Avoid
- **Fetching full page content from search result URLs:** Serper gives us snippets. For Phase 8, snippets are sufficient for concordance checks. Full page fetching belongs in Phase 12 (fetch-verify). Don't make Playwright calls here.
- **Using Tavily instead of Serper:** Tavily is 5x more expensive ($0.005/query) and includes AI processing overhead that we'd throw away (we parse with Gemini ourselves). Serper raw results are what we need.
- **Using the old `google-generativeai` SDK:** The project uses `google-genai` (new SDK, v1.66.0). `google-generativeai` v0.3.2 is also installed but is the deprecated API. Use `from google import genai` pattern.
- **Task dedup via `celery-singleton` or `celery-once-task`:** Adds a new dep. Redis NX pattern achieves the same with existing Redis dep.
- **Multi-column ON CONFLICT in Supabase upsert:** supabase-py has limited multi-column ON CONFLICT support (confirmed via SO research). Use single-column `normalized_name` with proper UNIQUE constraint.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Web search execution | Custom Google scraper | Serper API | ToS compliance; rate limiting built-in; $0.001/query |
| Unicode transliteration | Custom char table | unidecode + python-slugify | Handles 100K+ Unicode → ASCII mappings correctly |
| Structured LLM output | JSON prompt + regex parse | Gemini response_mime_type + Pydantic schema | Gemini will hallucinate JSON structure without schema enforcement |
| Task deduplication | Custom Celery result checking | Redis SET NX EX lock | Atomic, TTL-safe, zero new deps |
| Retry/backoff | Custom sleep loops | Celery autoretry_for + countdown escalation | Established pattern already in haiku_tasks.py |
| Producer name matching | Edit distance or embedding | normalize_producer_name() exact match | For a key lookup, deterministic normalization beats fuzzy match |

**Key insight:** The search execution problem is solved (Serper). The LLM parsing problem is solved (Gemini structured output). The only custom code is the concordance logic and producer normalization — both are well-scoped and simple.

---

## Common Pitfalls

### Pitfall 1: Region Alias Mismatch Causes False Contradictions
**What goes wrong:** Web source says "Burgundy", existing field_confidence says "Bourgogne" → concordance engine flags as contradiction when they mean the same thing. Creates noisy review queue.
**Why it happens:** Wine regions have legal names (French Bourgogne) and common English names (Burgundy) used interchangeably.
**How to avoid:** Maintain `REGION_ALIASES` dict that maps both forms to a canonical key. Apply normalization before concordance comparison for `region`, `sub_region`, `appellation` fields.
**Warning signs:** Review queue filling with `region` contradictions across all French wines simultaneously.

### Pitfall 2: Old google-generativeai SDK vs New google-genai SDK
**What goes wrong:** Import `from google.generativeai import GenerativeModel` (old API) instead of `from google import genai` (new API). Both are installed — old at v0.3.2, new at v1.66.0.
**Why it happens:** Training data has the old SDK; both packages coexist in requirements.txt.
**How to avoid:** Always use `from google import genai` and `client = genai.Client()`. The `response_mime_type: "application/json"` structured output feature is only in the new SDK.
**Warning signs:** `AttributeError: module 'google.generativeai' has no attribute 'Client'`

### Pitfall 3: Daily Budget Cap Not Atomic
**What goes wrong:** Multiple Celery workers each check the daily spend independently, all see $4.90 (under $5 cap), all proceed — resulting in $4.90 + N×search_cost overspend.
**Why it happens:** The cap check and task execution are not atomic across distributed workers.
**How to avoid:** Use Redis INCRBYFLOAT for the daily spend counter: `r.incrbyfloat("web_search:daily_spend:{date}", cost_estimate)`. Check the return value — if it exceeds the cap, the current worker is over budget.
**Warning signs:** Daily api_spend rows for web_search_task summing to > $5 × multiple.

### Pitfall 4: Supabase Upsert Fails Without UNIQUE Constraint
**What goes wrong:** `supabase.table("producers").upsert({...}, on_conflict="normalized_name")` silently inserts duplicates if the UNIQUE constraint doesn't exist in the DB migration.
**Why it happens:** supabase-py upsert doesn't validate the constraint exists before executing.
**How to avoid:** Migration MUST include `CREATE UNIQUE INDEX IF NOT EXISTS producers_normalized_name_key ON producers(normalized_name);`
**Warning signs:** `producers` table accumulates duplicate rows with same normalized_name.

### Pitfall 5: Serper Cost Is $0.001/Query, Not $0.005/Query
**What goes wrong:** Phase 12 CONTEXT.md (written 2026-04-06) quotes `SERPER_COST_PER_QUERY = $0.005` ($5/1000). But the actual Serper Starter plan is $50/50K = **$0.001/query** ($1/1000). [VERIFIED: serper.dev live pricing]
**Why it matters:** Budget calculations using $0.005 are 5x too conservative. The real daily $5 cap allows 5,000 searches/day, not 1,000.
**How to avoid:** Use `SERPER_COST_PER_QUERY = 0.001` for Starter plan in settings.py. (Standard plan: $0.00075. Scale: $0.0005.)
**Warning signs:** Tasks stopping too early because budget appears exhausted when it isn't.

### Pitfall 6: Concordance for Numeric Fields
**What goes wrong:** `alcohol_pct` web says "13.5" vs existing "13.50" → both are equal but string comparison fails.
**Why it happens:** Numeric fields may have inconsistent decimal representation in web snippets.
**How to avoid:** For numeric fields (`alcohol_pct`, `price_bottle`), compare as floats with tolerance: `abs(float(web) - float(existing)) < 0.01`.

### Pitfall 7: Celery Task Lock Not Released on Exception
**What goes wrong:** Redis SET NX acquired, but task crashes before `r.delete(lock_key)` — wine_id locked for 3600s.
**Why it happens:** Exception in `_verify_async()` bypasses the `finally` block if not structured correctly.
**How to avoid:** Always release lock in `finally:` block, not just success path. TTL is the safety net (1 hour expiry).

---

## Code Examples

### Search Query Construction
```python
# Source: Phase 8 ROADMAP.md spec + Serper docs pattern [CITED]
def build_search_query(producer: str, wine_name: str, vintage: Optional[str]) -> str:
    """Constructs wine-specific search query per WSRCH-01 spec."""
    parts = []
    if producer:
        parts.append(producer)
    if wine_name:
        parts.append(wine_name)
    if vintage:
        parts.append(str(vintage))
    return " ".join(parts)

# Example: "Domaine Leflaive Puligny-Montrachet 2019"
# Serper searches this against Google — returns Wine-Searcher, Vivino, producer site results
```

### web_verify_task Celery Task Pattern
```python
# Source: haiku_tasks.py pattern in codebase [VERIFIED: codebase read]
@celery_app.task(
    name="web_verify.verify_wine",
    bind=True,
    max_retries=3,
    autoretry_for=(Exception,),
    default_retry_delay=60,
)
def web_verify_task(self, wine_id: str) -> Optional[dict]:
    """WSRCH-01: Background web verification for a single wine."""
    r = redis_lib.from_url(settings.celery_broker_url)
    lock_key = f"wine:verify:{wine_id}"
    if not r.set(lock_key, "1", nx=True, ex=3600):
        logger.info("web_verify_task deduplicated for wine_id=%s", wine_id)
        return None
    try:
        result = asyncio.run(_verify_async(wine_id))
        return result
    except Exception as exc:
        retry_num = self.request.retries
        countdown = 60 * (2 ** retry_num)
        logger.warning("web_verify_task failed for wine_id=%s (attempt %d/3): %s", wine_id, retry_num + 1, exc)
        if retry_num >= self.max_retries - 1:
            logger.warning("web_verify_task exhausted retries for wine_id=%s", wine_id)
            return None
        raise self.retry(exc=exc, countdown=countdown)
    finally:
        r.delete(lock_key)
```

### Triggering web_verify_task after Haiku Enrichment
```python
# Source: onboarding_routes.py pattern [VERIFIED: codebase read]
# In haiku_tasks.py, after merge_field_confidence completes:
from jobs.web_verify_tasks import web_verify_task

def _should_web_verify(fc: dict, producer_in_graph: bool) -> bool:
    """WSRCH-07: tiered search strategy."""
    if not producer_in_graph:
        return True
    any_low_confidence = any(
        entry.get("confidence", 1.0) < 0.8
        for entry in fc.values()
        if isinstance(entry, dict)
    )
    never_verified = not any(
        entry.get("verification_status") != "unverified"
        for entry in fc.values()
        if isinstance(entry, dict)
    )
    return any_low_confidence or never_verified
```

### Daily Budget Cap via Redis INCRBYFLOAT
```python
# Source: Redis INCRBYFLOAT docs + Pitfall 3 analysis [ASSUMED pattern, verified via Redis docs]
import redis as redis_lib
from datetime import date

def check_and_reserve_search_budget(cost_per_search: float = 0.001) -> bool:
    """
    Returns True if budget is available, False if cap reached.
    Uses Redis INCRBYFLOAT for atomic check-and-increment.
    """
    r = redis_lib.from_url(settings.celery_broker_url)
    today_key = f"web_search:daily_spend:{date.today().isoformat()}"
    # INCRBYFLOAT is atomic — safe for concurrent workers
    new_total = r.incrbyfloat(today_key, cost_per_search)
    r.expire(today_key, 86400 * 2)  # 2-day TTL for cleanup
    cap = getattr(settings, "web_search_daily_budget_usd", 5.0)
    if new_total > cap:
        # Undo the increment — we're over budget
        r.incrbyfloat(today_key, -cost_per_search)
        return False
    return True
```

### field_confidence Update After Web Verification
```python
# Source: haiku_tasks.py merge pattern [VERIFIED: codebase read]
from services.field_confidence import merge_field_confidence

def apply_concordance_result(
    existing_fc: dict,
    field_name: str,
    web_value: str,
    web_confidence: float,
    concordance: str,
) -> dict:
    """WSRCH-03: update field_confidence entry based on concordance result."""
    if concordance == "concordance":
        # Boost to 0.95+ with web_verified status
        new_entry = {
            "value": existing_fc.get(field_name, {}).get("value", web_value),
            "confidence": max(0.95, web_confidence),
            "source": "web_verified",
            "verification_status": "web_verified",
        }
    elif concordance == "contradiction":
        existing_entry = existing_fc.get(field_name, {})
        new_entry = {**existing_entry, "verification_status": "contradicted", "contradicted_value": web_value}
    else:  # new_data
        new_entry = {
            "value": web_value,
            "confidence": web_confidence,
            "source": "web_search",
            "verification_status": "web_verified",
        }
    return merge_field_confidence(existing_fc, {field_name: new_entry}, overwrite_lower=True)
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| SerpAPI (expensive, Python SDK) | Serper (httpx, no SDK) | 2024+ | 10x cheaper; raw JSON sufficient |
| `google-generativeai` (old SDK) | `google-genai` (new SDK) | 2024-11 | New SDK supports structured output, caching |
| `gemini-2.0-flash` | `gemini-2.5-flash` | 2025-Q4 | Better accuracy; thinking capability; same price tier |
| celery-singleton library | Redis SET NX EX pattern | Ongoing | Fewer deps; same guarantees |
| Supabase `.insert()` with try/except | `.upsert(on_conflict=...)` | supabase-py ≥2.0 | Atomic insert-or-update without race condition |

**Deprecated/outdated:**
- `from google.generativeai import GenerativeModel` — old API, deprecated. Use `from google import genai` instead.
- `celery-once` / `celery-once-task` — adds deps; Redis NX achieves the same.
- Tavily for raw search — correct for AI-native answer synthesis, but wrong for our use case (we parse ourselves).

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Serper returns Wine-Searcher and Vivino snippets in organic results for wine queries | Architecture Patterns (Pattern 1) | Serper might filter these; mitigate by testing first query in validation |
| A2 | Daily budget cap via Redis INCRBYFLOAT is correctly atomic across workers | Common Pitfalls (Pitfall 3) / Code Examples | Race condition could allow overspend; consider Supabase row-level lock as fallback |
| A3 | Region alias dict covers the most common mismatch cases | Architecture Patterns (Pattern 6) | Incomplete alias dict causes false contradictions; mitigate by logging for review |
| A4 | `gemini-2.5-flash` is accessible via `google-genai` v1.66.0 at runtime | Standard Stack | Model availability depends on Google API key tier; fallback to `gemini-2.0-flash` |
| A5 | haiku_tasks.py pattern (asyncio.run in Celery) works for web_verify_task | Architecture Patterns (Pattern 3) | asyncio.run in Celery worker requires no active event loop; this is established pattern in the codebase |

---

## Open Questions

1. **Serper vs producer website direct scraping**
   - What we know: Serper returns snippets from organic Google results, which include Wine-Searcher, Vivino, and producer sites.
   - What's unclear: Whether snippet content (200-400 chars) is sufficient for all field types, or whether full-page fetch is sometimes needed.
   - Recommendation: For Phase 8, snippets are sufficient for concordance (is the value consistent?). Full-page fetch is Phase 12's fetch-verify step. Keep Phase 8 scoped to snippets only.

2. **web_verify_task trigger placement**
   - What we know: ROADMAP says "per-wine background web search agent" — triggered after onboarding or enrichment.
   - What's unclear: Whether trigger is (a) after haiku_enrich_task completes, or (b) directly from onboarding_routes.py like haiku_enrich_task.delay().
   - Recommendation: Trigger from `haiku_tasks.py` after merge completes (not from onboarding_routes.py), so Phase 8 doesn't modify the already-tested onboarding path. This also ensures we have Phase 7 field_confidence populated before web verification runs.

3. **`producers` table — portfolio JSONB structure**
   - What we know: ROADMAP specifies `portfolio JSONB: list of known wines`.
   - What's unclear: Exact schema — list of wine names, or list of wine_ids (UUIDs)?
   - Recommendation: List of wine name strings with vintage: `[{"wine_name": "Puligny-Montrachet 1er Cru", "vintage": "2019"}, ...]`. Avoid UUIDs — web search doesn't return our internal IDs.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Python 3.11 | All tasks | ✓ | 3.11.0 | — |
| Redis | Celery broker + dedup lock | ✗ (not running locally) | — | Docker: `docker run -p 6379:6379 redis:7-alpine` |
| celery | Background tasks | ✓ | 5.3.6 | — |
| httpx | Serper API calls | ✓ | 0.28.1 | — |
| google-genai | Gemini 2.5 Flash | ✓ | 1.66.0 | — |
| supabase-py | producers table upsert | ✓ | ≥2.10.0 | — |
| python-slugify[unidecode] | Producer normalization | ✗ (not installed) | — | Must install; no alternative |
| SERPER_API_KEY env var | Serper API | Unknown | — | Free tier: 2,500 queries |
| GOOGLE_API_KEY env var | Gemini Flash | ✓ (in settings.py) | — | Required |

**Missing dependencies with no fallback:**
- `python-slugify[unidecode]` — must be added to requirements.txt and installed
- `SERPER_API_KEY` — must be added to settings.py and env; Wave 0 task

**Missing dependencies with fallback:**
- Redis: Not running locally, but required for Celery. Existing docker-compose.yml likely has Redis; check before Wave 1.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | pytest 7.4.4 |
| Config file | `services/agent-orchestrator/pytest.ini` or inline `pyproject.toml` |
| Quick run command | `pytest services/agent-orchestrator/tests/test_web_verification.py -x` |
| Full suite command | `pytest services/agent-orchestrator/tests/ -x --timeout=30` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| WSRCH-01 | web_verify_task accepts wine_id, constructs query | unit | `pytest tests/test_web_verification.py::test_web_verify_task_constructs_query -x` | ❌ Wave 0 |
| WSRCH-02 | Gemini Flash parses top-5 results into structured fields | unit | `pytest tests/test_web_verification.py::test_gemini_parses_search_results -x` | ❌ Wave 0 |
| WSRCH-03 | Concordance: concordance→boost, contradiction→flag | unit | `pytest tests/test_web_verification.py::test_concordance_engine -x` | ❌ Wave 0 |
| WSRCH-04 | `producers` table schema + upsert | unit | `pytest tests/test_web_verification.py::test_producers_upsert -x` | ❌ Wave 0 |
| WSRCH-05 | Producer graph lookup before web search | unit | `pytest tests/test_web_verification.py::test_producer_graph_lookup -x` | ❌ Wave 0 |
| WSRCH-06 | verification_status in field_confidence JSONB | unit | `pytest tests/test_web_verification.py::test_verification_status_in_fc -x` | ❌ Wave 0 |
| WSRCH-07 | Tiered search strategy filters correctly | unit | `pytest tests/test_web_verification.py::test_tiered_search_strategy -x` | ❌ Wave 0 |
| WSRCH-08 | Daily budget cap enforced | unit | `pytest tests/test_web_verification.py::test_daily_budget_cap -x` | ❌ Wave 0 |
| WSRCH-09 | E2E: low-confidence wine → verify → FC updated | integration | `pytest tests/test_web_verification.py::test_e2e_web_verify_flow -x` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `pytest tests/test_web_verification.py -x --timeout=30`
- **Per wave merge:** `pytest tests/ -x --timeout=30`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `tests/test_web_verification.py` — all 9 WSRCH tests
- [ ] `services/serper_client.py` — Serper httpx wrapper
- [ ] `services/web_verification_service.py` — concordance + producer graph
- [ ] `jobs/web_verify_tasks.py` — Celery task with Redis dedup
- [ ] `services/producer_normalization.py` — normalize_producer_name() helper
- [ ] `supabase/migrations/20260408000000_producers_table.sql` — producers + UNIQUE constraint

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | N/A — internal Celery task |
| V3 Session Management | No | N/A — background worker |
| V4 Access Control | No | N/A — no user-facing endpoint in this phase |
| V5 Input Validation | Yes | Pydantic `WineVerificationResult` validates Gemini output; `normalize_producer_name()` sanitizes external producer strings before DB insert |
| V6 Cryptography | No | N/A |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Prompt injection via wine name | Tampering | wine_name sanitized before inserting into Gemini prompt; no user-controlled templates |
| Serper API key exposure | Info Disclosure | Key stored in settings.py via `SERPER_API_KEY` env var (consistent with `CLAUDE_API_KEY` pattern) |
| Daily budget DoS (many tasks queued) | Denial of Service | Redis INCRBYFLOAT cap check before task execution; tasks paused, not rejected — queue drains when budget resets |
| Supabase injection via producer name | Tampering | normalized_name is pure lowercase alphanumeric+hyphen; safe as ON CONFLICT key |

---

## Sources

### Primary (HIGH confidence)
- Serper API live website (serper.dev) — pricing, endpoint, response format [VERIFIED 2026-04-06]
- Supabase Python docs (supabase.com/docs/reference/python/upsert) — upsert on_conflict pattern [CITED]
- googleapis/python-genai GitHub + ai.google.dev structured output docs — Gemini 2.5 Flash response schema [CITED]
- services/agent-orchestrator/services/field_confidence.py — merge_field_confidence(), existing JSONB structure [VERIFIED: codebase read]
- services/agent-orchestrator/jobs/haiku_tasks.py — Celery task pattern, retry policy [VERIFIED: codebase read]
- services/agent-orchestrator/requirements.txt — installed package versions [VERIFIED: pip3 show]

### Secondary (MEDIUM confidence)
- pypi.org/project/python-slugify + pypi.org/project/Unidecode — normalization approach [CITED]
- pypi.org/project/celery-singleton + alessandrofuda.github.io — Redis NX dedup pattern [CITED, multiple sources agree]
- dataclean.to/use-cases/clean-attributes-in-wine-data — wine data cleaning canonical producer approach [CITED]

### Tertiary (LOW confidence — flagged in assumptions log)
- Region alias list completeness — generated from training knowledge; not validated against a live wine database

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all packages verified via pip3 show against live environment
- Architecture: HIGH — patterns follow established codebase (haiku_tasks.py, onboarding_routes.py, field_confidence.py)
- Pitfalls: HIGH for SDK/cost issues (verified sources), MEDIUM for concordance alias coverage (assumed)
- Environment: HIGH — tools verified via shell commands

**Research date:** 2026-04-06
**Valid until:** 2026-05-06 (Gemini model names change quarterly; Serper pricing stable)

# Phase 2: Gemini Flash Crawler — Research

**Researched:** 2026-04-02
**Domain:** Gemini Flash text extraction, web crawling, deduplication
**Confidence:** HIGH

---

## Summary

Phase 2 updates two existing files — `vlm_extraction_service.py` and `web_crawler.py` — to form a complete background pre-seeding pipeline. The crawler already handles HTML DOM extraction and PDF downloading via Playwright. What it currently lacks is the VLM extraction step after crawling and persistence of results to the `restaurant_menus` dataset with deduplication logic.

The current `vlm_extraction_service.py` already uses `google-genai` with a synchronous `genai.Client()`, but runs the model as `gemini-2.5-flash` — not the `gemini-2.0-flash` specified by the requirements. The requirement explicitly names `gemini-2.0-flash`. The google-genai SDK (version 1.66.0, installed) supports `AsyncClient` for async usage, which is the correct path given the surrounding asyncio-based crawler code.

There is no existing `restaurant_menus` Supabase table in the migrations. The requirement says "stored in `restaurant_menus` dataset" — this is the local filesystem dataset directory (`datasets/restaurant_menus/`), not a Supabase table. However, the crawl_log and restaurant_directory tables ARE in Supabase and must be updated when crawling. Deduplication against the master library means checking Supabase `master_wine_library` before inserting crawled wines.

**Primary recommendation:** Wire `WebCrawlerService.crawl_restaurant()` output into a new `GeminiFlashExtractor` (or extend `VLMExtractionService`) that calls `gemini-2.0-flash` async, then persist results to the local `datasets/restaurant_menus/` JSONL file with deduplication against `master_wine_library` in Supabase.

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| GMFL-01 | Crawler sends HTML text and PDF text to Gemini Flash for extraction (not Claude Vision) | `vlm_extraction_service.py` already has Gemini client; model name change to `gemini-2.0-flash` + async needed |
| GMFL-02 | Web crawler pipeline: restaurant URL → HTML DOM extraction → Gemini Flash → structured wines | `web_crawler.py` already handles URL → HTML/PDF; missing VLM extraction call + storage step |
| GMFL-03 | Crawled wines stored in `restaurant_menus` dataset with source_type = "crawled", confidence score | No Supabase table; target is local `datasets/restaurant_menus/` JSONL directory + optional Supabase `crawl_log` update |
| GMFL-04 | Crawler respects robots.txt and rate limits (max 100 sites/day default) | Rate limiter already in `WebCrawlerService` (100/day); robots.txt check is MISSING — must be added |
| GMFL-05 | Duplicate detection: crawled wines matched against master library before inserting | No deduplication exists today; must implement wine_name + vintage + restaurant_id match |
</phase_requirements>

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| google-genai | 1.66.0 (installed) | Gemini Flash API client | Already in requirements.txt; `AsyncClient` available for async usage |
| playwright | 1.55.0 (installed) | Headless browser for HTML/PDF extraction | Already used in web_crawler.py |
| supabase | >=2.10.0 (in requirements) | Dedup queries against master_wine_library | Already used throughout codebase |
| pydantic | 2.6.0 (installed) | Data models | Project standard — used in all services |
| pytest-asyncio | 0.23.3 (installed) | Async test support | Used in existing test suite |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| urllib.robotparser | stdlib | robots.txt parsing | Add to web_crawler.py before crawling any URL |
| urllib.parse | stdlib | URL construction, urljoin | Already used in web_crawler.py |
| hashlib | stdlib | Content hash for dedup | Already used in web_crawler.py |
| json | stdlib | JSONL persistence | Used for local dataset storage |
| tenacity | 8.2.3 (installed) | Retry with backoff on Gemini API errors | Already in requirements |

### No new packages required
All dependencies are already in `requirements.txt`. No `pip install` additions needed for this phase.

**Version verification:** google-genai 1.66.0 confirmed via `pip3 show google-genai`. AsyncClient and `AsyncModels.generate_content` confirmed available.

---

## Architecture Patterns

### Recommended Project Structure — Phase 2 Changes

Only two files are modified (per ROADMAP.md goal statement). One new test file is added.

```
services/agent-orchestrator/
├── services/
│   ├── vlm_extraction_service.py     # MODIFY: switch to gemini-2.0-flash async
│   └── web_crawler.py                # MODIFY: add robots.txt check + VLM call + storage
└── tests/
    └── test_gemini_flash_crawler.py  # NEW: unit tests for Phase 2 behaviour
datasets/
└── restaurant_menus/                 # Storage target: JSONL files per restaurant
    └── <crawl_date>_<slug>.jsonl
```

### Pattern 1: AsyncClient for Gemini Flash (async pipeline)

The current `VLMExtractionService` uses synchronous `genai.Client()`. The web crawler is fully async (asyncio). The planner MUST use `AsyncClient` to avoid blocking the event loop.

```python
# Source: google-genai 1.66.0 — verified via python3 -c "from google.genai.client import AsyncClient"
from google.genai.client import AsyncClient

class GeminiFlashCrawlerExtractor:
    def __init__(self):
        self._client: Optional[AsyncClient] = None

    def _get_client(self) -> AsyncClient:
        if self._client is None:
            api_key = os.getenv("GOOGLE_API_KEY")
            if not api_key:
                raise RuntimeError("GOOGLE_API_KEY not set")
            self._client = AsyncClient(api_key=api_key)
        return self._client

    async def extract_from_text(self, text: str, restaurant_name: str) -> dict:
        response = await self._get_client().aio.models.generate_content(
            model="gemini-2.0-flash",
            contents=CRAWL_TEXT_PROMPT.format(text=text[:50000], restaurant=restaurant_name),
        )
        return self._parse(response.text)
```

**CRITICAL NOTE:** The existing `VLMExtractionService.extract_from_text()` uses `self._client.models.generate_content(...)` (sync call inside async method — this is a blocking call in an async context and is a latent bug). Phase 2 must use `AsyncClient` to fix this correctly.

### Pattern 2: robots.txt Check (missing today — GMFL-04 requires it)

```python
# Source: Python stdlib urllib.robotparser
from urllib.robotparser import RobotFileParser
from urllib.parse import urljoin

async def _is_crawl_allowed(self, url: str) -> bool:
    """Check robots.txt before crawling. Returns True if allowed."""
    parsed = urlparse(url)
    robots_url = f"{parsed.scheme}://{parsed.netloc}/robots.txt"
    rp = RobotFileParser()
    rp.set_url(robots_url)
    try:
        rp.read()
    except Exception:
        return True  # If robots.txt unreadable, allow crawl (conservative default)
    return rp.can_fetch("*", url)
```

Add this check at the start of `crawl_restaurant()` before any Playwright browser launch.

### Pattern 3: Deduplication against master_wine_library (GMFL-05)

```python
# Source: existing Supabase pattern from onboarding_routes.py
def _wine_is_duplicate(self, supabase, wine: dict, restaurant_id: str) -> bool:
    """
    Check master_wine_library for existing wine_name + vintage match.
    Also checks restaurant_menus local cache via content_hash to skip re-crawl.
    """
    if not supabase:
        return False
    name = (wine.get("wine_name") or "").strip().lower()
    vintage = wine.get("vintage")
    try:
        query = supabase.table("master_wine_library").select("id").ilike("name", name)
        if vintage:
            query = query.eq("vintage", vintage)
        result = query.limit(1).execute()
        return bool(result.data)
    except Exception:
        return False
```

### Pattern 4: Local JSONL persistence for restaurant_menus dataset (GMFL-03)

```python
# Source: existing _cache_result pattern in web_crawler.py
import json
from pathlib import Path

RESTAURANT_MENUS_DIR = PROJECT_ROOT / "datasets" / "restaurant_menus"

def _persist_crawled_wines(self, wines: list, restaurant_name: str, source_url: str):
    RESTAURANT_MENUS_DIR.mkdir(parents=True, exist_ok=True)
    slug = re.sub(r"[^\w]", "_", restaurant_name.lower())[:50]
    ts = datetime.now(timezone.utc).strftime("%Y%m%d")
    out_file = RESTAURANT_MENUS_DIR / f"{ts}_{slug}.jsonl"
    with open(out_file, "a") as f:
        for wine in wines:
            record = {
                **wine,
                "source_type": "crawled",
                "source_url": source_url,
                "restaurant_name": restaurant_name,
                "crawled_at": datetime.now(timezone.utc).isoformat(),
            }
            f.write(json.dumps(record) + "\n")
```

### Anti-Patterns to Avoid

- **Blocking Gemini call in async context:** `self._client.models.generate_content()` (sync) inside an `async def` blocks the event loop. Use `AsyncClient` and `await`.
- **robots.txt check after page load:** Check robots.txt BEFORE launching Playwright. Fetching the page first and then checking robots.txt is backwards.
- **Calling Claude Vision in the crawler:** Requirements explicitly say Gemini Flash, not Claude Vision, for the crawl path (cost optimization). Do not reuse `ClaudeVisionExtractor`.
- **Creating a new Supabase table for restaurant_menus:** The ROADMAP says "restaurant_menus dataset" — this is the local `datasets/restaurant_menus/` directory. No migration needed.
- **Using gemini-2.5-flash instead of gemini-2.0-flash:** Requirements (GMFL-01) specifically name `gemini-2.0-flash`. The current `vlm_extraction_service.py` incorrectly uses `gemini-2.5-flash`. Phase 2 must switch to the specified model.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| robots.txt parsing | Custom HTTP + regex parser | `urllib.robotparser.RobotFileParser` | stdlib; handles Crawl-delay, Allow/Disallow correctly |
| Rate limiting | Custom time tracker | Existing `_daily_count` in `WebCrawlerService` | Already implemented, just needs robots.txt gating added |
| Async Gemini calls | Thread pool + sync client | `google.genai.client.AsyncClient` | Native async; no thread overhead; `await client.aio.models.generate_content()` |
| HTML text cleaning | BeautifulSoup re-implementation | Existing `_extract_page_text()` in web_crawler.py | Already handles selector fallback + body fallback |
| PDF text extraction | Write pypdf parser | Existing `pdf_extraction_service.py` + PyPDF2 already in requirements | Already proven in codebase |
| JSON response parsing | New parser | Mirror `parse_json_response()` from `claude_vision_extractor.py` | Multi-strategy: fence strip → `{...}` search → raw parse |

**Key insight:** The hard parts (browser automation, PDF download, rate limiting, JSON parsing) are already built. Phase 2 is fundamentally a "wire things together" phase.

---

## Common Pitfalls

### Pitfall 1: Sync Gemini client blocks event loop
**What goes wrong:** `VLMExtractionService` uses `genai.Client()` (sync), then calls `self._client.models.generate_content()` inside `async def extract_from_text()`. This is a hidden blocking call — it works but starves the event loop during API latency (~1-3s per call).
**Why it happens:** The existing implementation was written before the crawler's async architecture was finalized.
**How to avoid:** Use `AsyncClient` from `google.genai.client`. Call `await client.aio.models.generate_content(model=..., contents=...)`.
**Warning signs:** Tests pass but crawl_batch() takes N × latency instead of max(latency) for parallel calls.

### Pitfall 2: model name mismatch
**What goes wrong:** Current `vlm_extraction_service.py` uses `gemini-2.5-flash`. GMFL-01 requires `gemini-2.0-flash`. Using the wrong model violates the requirement and may have different cost/capability characteristics.
**Why it happens:** VLM service was likely updated to a newer model after the requirements were written.
**How to avoid:** Hardcode `MODEL_ID = "gemini-2.0-flash"` in the crawler extraction path. The VLM service can keep using `gemini-2.5-flash` for its own (dataset labeling) purposes — these are separate paths.

### Pitfall 3: robots.txt check uses blocking HTTP fetch
**What goes wrong:** `RobotFileParser.read()` is synchronous and makes an HTTP request. Calling it inside `async def crawl_restaurant()` blocks the event loop.
**Why it happens:** `urllib.robotparser` predates asyncio.
**How to avoid:** Run the robots.txt check in `asyncio.get_event_loop().run_in_executor(None, rp.read)` OR fetch robots.txt via Playwright itself (already have a browser open). Simplest: use `asyncio.to_thread(rp.read)` (Python 3.9+; project uses Python 3.11).

### Pitfall 4: Deduplication false negatives from name variations
**What goes wrong:** "Château Margaux 2015" in the crawled wine doesn't match "Chateau Margaux 2015" in `master_wine_library` due to accents/capitalization.
**Why it happens:** Wine names from different sources have encoding and capitalization differences.
**How to avoid:** Use `.ilike()` (case-insensitive LIKE) in Supabase query. For accent normalization, a simple `.lower().strip()` on both sides is sufficient for MVP — not perfect but good enough for Phase 2 dedup.

### Pitfall 5: Crawl rate limit reset not wired to scheduler
**What goes wrong:** `_daily_count` resets only when `reset_daily_count()` is called explicitly. If the service restarts mid-day, the count resets to 0.
**Why it happens:** Count is in-memory only, not persisted.
**How to avoid:** Phase 2 scope — document this as a known limitation. The count is per-instance and per-day. For MVP this is acceptable; a restart effectively resets the counter. Note it in the code, don't over-engineer it.

### Pitfall 6: Gemini returns non-JSON even when asked for JSON
**What goes wrong:** Gemini Flash occasionally wraps output in ```json ... ``` markdown fences, or prepends explanatory text.
**Why it happens:** Default model behavior despite explicit instructions.
**How to avoid:** Mirror the `parse_json_response()` multi-strategy parser from `claude_vision_extractor.py` — strip fences, search for `{...}`, fallback to raw parse. Do NOT re-implement from scratch.

---

## Code Examples

### Async Gemini Flash call (verified against installed SDK)

```python
# Source: google-genai 1.66.0 AsyncModels.generate_content — verified signature
from google.genai.client import AsyncClient

async def extract_html_with_gemini(text: str, restaurant_name: str) -> str:
    client = AsyncClient(api_key=os.getenv("GOOGLE_API_KEY"))
    response = await client.aio.models.generate_content(
        model="gemini-2.0-flash",
        contents=CRAWL_TEXT_PROMPT.format(text=text[:50000], restaurant=restaurant_name),
    )
    return response.text or ""
```

### robots.txt check using asyncio.to_thread (Python 3.11)

```python
# Source: Python stdlib — asyncio.to_thread available since 3.9
import asyncio
from urllib.robotparser import RobotFileParser

async def is_crawl_allowed(url: str) -> bool:
    parsed = urlparse(url)
    robots_url = f"{parsed.scheme}://{parsed.netloc}/robots.txt"
    rp = RobotFileParser()
    rp.set_url(robots_url)
    try:
        await asyncio.to_thread(rp.read)
    except Exception:
        return True  # unreadable robots.txt = allow
    return rp.can_fetch("*", url)
```

### Deduplication query (Supabase pattern from existing codebase)

```python
# Source: existing supabase insert pattern in onboarding_routes.py
def wine_exists_in_master_library(supabase, wine_name: str, vintage: Optional[int]) -> bool:
    try:
        q = supabase.table("master_wine_library").select("id").ilike("name", wine_name.strip())
        if vintage:
            q = q.eq("vintage", vintage)
        return bool(q.limit(1).execute().data)
    except Exception:
        return False  # on error, allow insert (fail open for dedup)
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Sync genai.Client in async methods | AsyncClient + await | google-genai 1.0+ | Correct async behavior, no event loop blocking |
| gemini-2.5-flash (current vlm service) | gemini-2.0-flash (required by GMFL-01) | GMFL-01 spec | Phase 2 crawler path must use 2.0-flash specifically |
| No robots.txt check | urllib.robotparser via asyncio.to_thread | Phase 2 scope | Legal/ethical compliance for crawling |

**Note on model naming:** As of April 2026, `gemini-2.0-flash` is the stable model in the 2.0 family. The existing VLM service upgraded to `gemini-2.5-flash` at some point. GMFL-01 requires `gemini-2.0-flash` — the planner should use exactly this string.

---

## Open Questions

1. **Where exactly do crawled wines land?**
   - What we know: ROADMAP says "stored in `restaurant_menus` dataset". The `datasets/restaurant_menus/` directory exists on disk but is empty. No Supabase migration for `restaurant_menus` table was found across all migrations.
   - What's unclear: Is a new Supabase table expected, or is JSONL on disk sufficient for Phase 2 MVP?
   - Recommendation: Use local JSONL (mirrors the existing `_cache_result` pattern in web_crawler.py) for Phase 2. A Supabase table can be added in Phase 5 if needed for the quality dashboard.

2. **Does vlm_extraction_service.py get refactored or does a new class get added?**
   - What we know: Phase 1 CONTEXT.md explicitly says `vlm_extraction_service.py` stays untouched for Phase 1. Phase 2 ROADMAP says "Update `vlm_extraction_service.py`".
   - What's unclear: Whether to add a new `GeminiFlashCrawlerExtractor` class inside vlm_extraction_service.py or modify the existing `VLMExtractionService`.
   - Recommendation: Add a new `GeminiFlashCrawlerExtractor` class to `vlm_extraction_service.py` that uses `AsyncClient` and `gemini-2.0-flash`. Leave the existing `VLMExtractionService` class unchanged (it serves dataset labeling, a different purpose).

3. **Integration test URL selection**
   - What we know: GMFL success criteria requires "crawl one real restaurant URL and verify >= 1 wine extracted".
   - What's unclear: Which URL should be used for the integration test (hardcoded fixture vs configurable).
   - Recommendation: Hardcode a known wine-list URL in the test (e.g., a restaurant with a simple HTML wine list) and mark it as `@pytest.mark.integration` so it's skipped in CI but runnable locally.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| google-genai | GMFL-01 Gemini Flash extraction | Yes | 1.66.0 | — |
| playwright | GMFL-02 HTML DOM extraction | Yes | 1.55.0 | — |
| Python 3.11 | asyncio.to_thread for robots.txt | Yes | 3.11.0 | — |
| GOOGLE_API_KEY | All Gemini calls | In env.example, assumed set in .env | — | Tests mock the client |
| SUPABASE_URL + KEY | GMFL-05 dedup queries | In env.example, assumed set in .env | — | Dedup skipped gracefully if None |
| datasets/restaurant_menus/ | GMFL-03 crawled wine storage | Directory does not exist | — | Create on first write (mkdir parents=True) |

**Missing dependencies with no fallback:** None.

**Missing dependencies with fallback:** `datasets/restaurant_menus/` directory — created automatically on first write via `Path.mkdir(parents=True, exist_ok=True)`.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | pytest 7.4.4 + pytest-asyncio 0.23.3 |
| Config file | None found — may need `pytest.ini` or `pyproject.toml` section |
| Quick run command | `cd services/agent-orchestrator && python -m pytest tests/test_gemini_flash_crawler.py -x -q` |
| Full suite command | `cd services/agent-orchestrator && python -m pytest tests/ -q` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| GMFL-01 | VLM extraction uses gemini-2.0-flash model string | unit | `pytest tests/test_gemini_flash_crawler.py::test_model_is_gemini_2_0_flash -x` | No — Wave 0 |
| GMFL-01 | extract_from_text() returns VLMExtractionResult with wines | unit | `pytest tests/test_gemini_flash_crawler.py::test_extract_from_text_returns_wines -x` | No — Wave 0 |
| GMFL-02 | crawl_restaurant() calls Gemini extraction after HTML extraction | unit | `pytest tests/test_gemini_flash_crawler.py::test_crawl_calls_gemini_after_html -x` | No — Wave 0 |
| GMFL-03 | Crawled wines written to restaurant_menus JSONL with source_type=crawled | unit | `pytest tests/test_gemini_flash_crawler.py::test_crawled_wines_written_to_dataset -x` | No — Wave 0 |
| GMFL-04 | robots.txt disallow blocks crawl | unit | `pytest tests/test_gemini_flash_crawler.py::test_robots_txt_disallow_blocks_crawl -x` | No — Wave 0 |
| GMFL-04 | Rate limit: 101st call returns error result | unit | `pytest tests/test_gemini_flash_crawler.py::test_rate_limit_enforced -x` | No — Wave 0 |
| GMFL-05 | Duplicate wine (name+vintage match) is skipped | unit | `pytest tests/test_gemini_flash_crawler.py::test_duplicate_wine_skipped -x` | No — Wave 0 |
| GMFL-05 | Wine not in master_library is inserted | unit | `pytest tests/test_gemini_flash_crawler.py::test_non_duplicate_wine_inserted -x` | No — Wave 0 |
| Integration | Crawl real URL and get >= 1 wine | integration | `pytest tests/test_gemini_flash_crawler.py -m integration` | No — Wave 0 |

### Sampling Rate
- **Per task commit:** `cd services/agent-orchestrator && python -m pytest tests/test_gemini_flash_crawler.py -x -q`
- **Per wave merge:** `cd services/agent-orchestrator && python -m pytest tests/ -q`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/test_gemini_flash_crawler.py` — covers GMFL-01 through GMFL-05 (all 9 test cases above)

*(No framework gaps — pytest + pytest-asyncio already installed and used in test_claude_vision_extractor.py)*

---

## Project Constraints (from CLAUDE.md)

No `CLAUDE.md` found in the working directory. No project-specific directives to enforce.

**Inferred conventions from codebase inspection:**
- Singleton pattern for service classes: `_service_instance` + `get_X_service()` getter (followed in both `vlm_extraction_service.py` and `web_crawler.py`)
- Lazy init: `_initialize()` or `_get_client()` pattern — do not initialize in `__init__`
- Pydantic v2 models for all data structures (project uses pydantic 2.6.0)
- `logger = logging.getLogger(__name__)` at module level
- Async methods: `async def` throughout; do not mix sync blocking calls into async methods
- File-level module docstring with service description
- Section dividers: `# ===...===` comment blocks

---

## Sources

### Primary (HIGH confidence)
- `services/agent-orchestrator/services/vlm_extraction_service.py` — current Gemini client pattern, model name discrepancy confirmed
- `services/agent-orchestrator/services/web_crawler.py` — current crawler structure, missing robots.txt + VLM extraction step confirmed
- `services/agent-orchestrator/services/claude_vision_extractor.py` — Phase 1 reference pattern for async extraction + JSON parsing
- `services/agent-orchestrator/requirements.txt` — all dependencies confirmed installed
- `supabase/migrations/20260225000000_restaurant_directory.sql` — crawl_log and restaurant_directory schema confirmed
- `supabase/migrations/20260208024921_new-migration.sql` — master_wine_library schema confirmed (name, vintage, producer fields)
- python3 live inspection: google-genai 1.66.0, AsyncClient + AsyncModels.generate_content confirmed available

### Secondary (MEDIUM confidence)
- REQUIREMENTS.md — GMFL-01 through GMFL-05 acceptance criteria
- ROADMAP.md — Phase 2 goal statement, success criteria
- env.example — GOOGLE_API_KEY confirmed as the env var name for Gemini

### Tertiary (LOW confidence — needs validation)
- `gemini-2.0-flash` exact model string availability in google-genai 1.66.0: not verified by live API call; assumed valid based on Google's documented model naming. Integration test will confirm.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all packages verified installed with exact versions
- Architecture: HIGH — based on reading actual source files, not assumptions
- Pitfalls: HIGH — based on code inspection (blocking sync client in async, model name mismatch identified directly in source)
- Deduplication approach: MEDIUM — Supabase `.ilike()` pattern is proven; wine name normalization is MVP-level only

**Research date:** 2026-04-02
**Valid until:** 2026-05-02 (stable stack; google-genai model availability may change sooner)

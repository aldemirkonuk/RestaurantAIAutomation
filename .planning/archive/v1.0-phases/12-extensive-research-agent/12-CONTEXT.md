# Phase 12: Extensive Gap-Filling Research Agent — Finalized Context

**Status:** All 5 questions answered. Use this file as ground truth for execution.
**Supersedes:** `QUESTIONS.md` (which contains the draft options these answers resolved)
**Date locked:** 2026-04-06

---

## Decision 1 — Eligibility Gate: ALL 31 DB Content Fields

**Answer:** The eligibility gate targets **all 31 content fields** in the DB — not just the
original Core 10 default. Every field that can carry meaningful knowledge about a wine is eligible
for research.

**Canonical field list (RESEARCH_ALL_FIELDS — 31 fields):**

```python
RESEARCH_ALL_FIELDS: list[str] = [
    # ── Visible-on-menu fields (Vision Pass 1) ──────────────────────────────
    "wine_name",       "producer",         "vintage",
    "primary_type",    "color",            "sweetness_level",
    "alcohol_pct",     "price_bottle",     "price_glass",
    "section_name",    "bin_number",
    # ── Structural knowledge fields (Haiku Pass 2) ──────────────────────────
    "region",          "sub_region",       "appellation",
    "country",         "grape_variety",    "food_pairing",
    "producer_bio",    "tasting_notes",    "description",
    "is_blend",        "bottle_size",
    # ── Market intelligence fields (Phases 10–11) ───────────────────────────
    "retail_price_avg",
    # ── Structured JSONB enrichments ────────────────────────────────────────
    "grape_family",    "wine_structure",   "sensory_profile",
    "practical_attributes", "region_hierarchy", "critic_scores",
    # ── Derived quality signals ──────────────────────────────────────────────
    "vintage_age",     "price_tier",
]
```

**Practical note for the executor:** Fields like `section_name`, `bin_number`, `price_bottle`, and
`price_glass` are restaurant-menu-specific and rarely researchable online — the evidence loop will
simply return no candidates, consume ≤ 1 tool call, and mark them `fields_unchanged`. Include
them in the gate so null rate tracks correctly, but don't burn extra calls when no snippet is found.

**Implementation:** Replace `RESEARCH_PRIORITY_FIELDS` (Core 10) in `research_agent_helpers.py`
with `RESEARCH_ALL_FIELDS` (31). The original Core 10 can remain as a
`RESEARCH_PRIORITY_FIELDS` alias used by tests and configurable overrides.

---

## Decision 2 — Tier-A Source List: Expanded Official Registry

**Answer:** Tier-A is expanded beyond the initial CIVB/Consorzio/TTB/INAO seed. The principle
is: **tier-A = primary sources that publish authoritative data as part of their official function**.
This includes producer websites, all national and regional appellation regulatory bodies, and
government wine agencies.

### Tier-A domain allowlist (additions to existing list)

```python
SOURCE_TIER_DOMAINS: dict[str, str] = {

    # ── Producer's own website (dynamic detection — see note below) ─────────
    # Producer sites are detected at runtime: if the URL's registered domain matches
    # a known producer name (normalized) in the producers table → tier-A.
    # Fallback: any URL that is NOT in tier-B known-bad list and passes the
    # "about this wine" content heuristic.

    # ── France ───────────────────────────────────────────────────────────────
    "inao.gouv.fr":          "A",   # AOC/AOP official registry
    "agriculture.gouv.fr":   "A",   # French Ministry of Agriculture
    "civb.com":              "A",   # Bordeaux Wine Trade Council
    "champagne.fr":          "A",   # Comité Champagne (Syndicat + CIVC)
    "bivb.com":              "A",   # Bourgogne wine interprofessional bureau
    "vinsalsace.com":        "A",   # Alsace wines official body
    "rhone-wines.com":       "A",   # Vins du Rhône interprofessional
    "vinsdeloire-wines.com": "A",   # Loire official

    # ── Italy ────────────────────────────────────────────────────────────────
    "consorziobrunellomontalcino.it": "A",
    "consorziobarolo.it":            "A",
    "chiantidocg.it":                "A",
    "amaroneducati.it":              "A",
    "soave.it":                      "A",
    "prosecco.it":                   "A",
    "masi.it":                       "A",   # major verified Amarone producer
    "federdoc.com":                  "A",   # Italian DOC/DOCG federation
    "icqrf.gov.it":                  "A",   # Italian government wine registry

    # ── Spain ────────────────────────────────────────────────────────────────
    "winefromspain.com":     "A",   # Spain official wine body (ICEX)
    "riojawine.com":         "A",   # DOCa Rioja Consejo Regulador
    "ribera.es":             "A",   # Ribera del Duero Consejo Regulador
    "riberadelduero.es":     "A",
    "priorat.org":           "A",
    "denominacionorigen.es": "A",   # Spanish appellation registry

    # ── Germany ──────────────────────────────────────────────────────────────
    "vdp.de":            "A",   # VDP Verband Deutscher Prädikatsweingüter
    "germanwines.de":    "A",   # DWI (Deutsches Weininstitut)
    "weinrecht.de":      "A",   # German wine law database

    # ── Portugal ─────────────────────────────────────────────────────────────
    "ivv.gov.pt":    "A",   # Instituto da Vinha e do Vinho
    "ivdp.pt":       "A",   # Douro/Porto (Port wine)
    "cvr-dao.pt":    "A",   # Dão wine region
    "cvrverdelhos.pt":"A",

    # ── USA ───────────────────────────────────────────────────────────────────
    "ttb.gov":                 "A",   # TTB COLA registry (approved labels)
    "wineinstitute.org":       "A",   # California wine official body
    "napavalleyvintners.com":  "A",   # Napa Valley official body
    "sonomacountywine.com":    "A",

    # ── Australia ────────────────────────────────────────────────────────────
    "wineaustralia.com":   "A",   # Wine Australia (government agency)
    "awri.com.au":         "A",   # Australian Wine Research Institute

    # ── New Zealand ──────────────────────────────────────────────────────────
    "nzwine.com":  "A",   # New Zealand Winegrowers (statutory body)

    # ── Argentina ────────────────────────────────────────────────────────────
    "winesofargentina.org":  "A",   # Wines of Argentina (gov-backed body)
    "inv.gov.ar":            "A",   # Instituto Nacional de Vitivinicultura

    # ── Chile ────────────────────────────────────────────────────────────────
    "winesofchile.org":  "A",

    # ── South Africa ─────────────────────────────────────────────────────────
    "wosa.co.za":   "A",   # Wines of South Africa
    "sawis.co.za":  "A",   # SA Wine Industry Systems

    # ── EU-level ─────────────────────────────────────────────────────────────
    "eambrosia.europa.eu":  "A",   # EU GI register (authoritative for all EU PDO/PGI)
    "fao.org":              "A",   # FAO wine data (where applicable)

    # ── Organic/biodynamic certification ─────────────────────────────────────
    "ams.usda.gov":      "A",   # USDA organic certification
    "demeter-usa.org":   "A",   # Biodynamic certification
    "biodyvin.com":      "A",   # French biodynamic wine body

    # ── Tier-B: Authoritative trade press + wine databases ────────────────────
    "wine-searcher.com":       "B",
    "vivino.com":              "B",
    "decanter.com":            "B",
    "winespectator.com":       "B",
    "jancisrobinson.com":      "B",
    "robertparker.com":        "B",
    "wineadvocate.com":        "B",
    "wine-pages.com":          "B",
    "winemag.com":             "B",   # Wine Enthusiast
    "guildsomm.com":           "B",   # Guild of Sommeliers (educational/professional)
    "cellartracker.com":       "B",   # CellarTracker community notes
    "winefolly.com":           "B",
}
```

**Producer-site dynamic detection (implemented in `classify_source_tier()`):**

When the URL domain doesn't match any known entry, the function checks if the domain contains the
normalized producer name (from the submission's `producer` field). If yes → tier-A. This handles
the long tail of producer websites without hardcoding thousands of domains.

```python
# Pseudocode added to classify_source_tier():
if normalized_producer and normalized_producer in domain.replace("-", " "):
    return "A"   # Producer's own website
```

---

## Decision 3 — Conflict Queue Lifecycle: Provenance-Based Consensus with Staleness Decay

**Answer:** State-of-the-art data quality systems (dbt contracts, Great Expectations,
Databricks data quality) use **optimistic locking with challenge escalation**. We adopt this pattern:

### The 4 states of a resolved field

```
human_resolved (conf=1.0)
    │
    ├──► LOCKED: agent skips this field in all future eligibility checks.
    │    merge_field_confidence() refuses to overwrite conf=1.0 records.
    │
    ├──► CHALLENGE: if new tier-A evidence directly contradicts the human value,
    │    the agent writes a challenge record to `resolution_challenges` table.
    │    The field is NOT updated — but the human reviewer is notified that a
    │    tier-A source has surfaced new evidence. The human decides whether to
    │    accept the challenge or dismiss it.
    │
    └──► STALE: every human_resolved field older than 180 days is re-verified
         (not re-researched from scratch — just fetch-verified: is the original
         source URL still returning the same value?). If the URL now says something
         different, the field drops from conf=1.0 to conf=0.85 and re-enters the
         review queue for human re-confirmation.
```

### Implementation additions

**New table: `resolution_challenges`** (add to migration 20260412000003):

```sql
CREATE TABLE IF NOT EXISTS resolution_challenges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    submission_id UUID NOT NULL,
    field_name VARCHAR(100) NOT NULL,
    existing_value TEXT NOT NULL,
    challenging_value TEXT NOT NULL,
    challenging_source_url TEXT NOT NULL,
    challenging_source_tier CHAR(1) NOT NULL DEFAULT 'A',
    snippet TEXT,
    challenged_at TIMESTAMPTZ DEFAULT NOW(),
    status VARCHAR(20) NOT NULL DEFAULT 'open',
    resolved_by TEXT,
    resolved_at TIMESTAMPTZ,
    CONSTRAINT valid_challenge_status CHECK (status IN ('open', 'accepted', 'dismissed'))
);

CREATE INDEX IF NOT EXISTS idx_challenges_submission ON resolution_challenges(submission_id);
CREATE INDEX IF NOT EXISTS idx_challenges_open ON resolution_challenges(status) WHERE status = 'open';
```

**Staleness re-verification task** (weekly Celery beat):
- Query `master_wine_library_submissions` for `field_confidence` entries where:
  - `source = 'human_resolved'`
  - `resolved_at < NOW() - INTERVAL '180 days'` (stored as metadata in FC entry)
- Re-fetch the original citation URL from `evidence_citations` where `wine_id + field_name` matches
- If fetch-verify fails (value no longer present): drop confidence to 0.85, add to `field_review_queue`
- New `field_confidence` source value: `"human_resolved_stale"` (signals the review is about re-confirming, not correcting)

**Key rule:** The agent can ONLY open a challenge when it finds tier-A evidence. Tier-B and tier-C
evidence that contradicts a human resolution is silently discarded — not worth overturning human
judgment with trade-press snippets.

---

## Decision 4 — Per-Record Budget Ceiling: Math-First Derivation

**Answer:** Use a hard ceiling derived from first-principles cost modeling, not an arbitrary cap.

### Cost equation

```
BUDGET_PER_RECORD_MAX = (
    SERPER_COST_PER_QUERY  × MAX_TOOL_CALLS             # search calls
  + LLM_PARSE_COST_PER_CALL × MAX_TOOL_CALLS           # snippet parsing
  + FETCH_VERIFY_COST       × ceil(MAX_TOOL_CALLS / 2) # one verify per field
) × SAFETY_FACTOR
```

**Current values (2026-04-06 pricing):**

| Variable | Value | Source |
|----------|-------|--------|
| `SERPER_COST_PER_QUERY` | $0.001 | Serper API ($1/1000 queries, verified 2026-04-06 at serper.dev) |
| `LLM_PARSE_COST_PER_CALL` | $0.0001 | Gemini Flash 2.0 (~500 tokens × $0.075/1M in + $0.30/1M out) |
| `FETCH_VERIFY_COST` | $0.001 | Playwright compute amortized (Phase 6 infra) |
| `MAX_TOOL_CALLS` | 8 | Stop rule default |
| `SAFETY_FACTOR` | 3.0 | Buffer for model cost changes, token overruns, retry overhead |

**Calculation (updated 2026-04-06 — Phase 8 research corrected Serper to $0.001/query):**

```
raw = (0.001 × 8) + (0.0001 × 8) + (0.001 × 4)
    = 0.008 + 0.0008 + 0.004
    = 0.0128

BUDGET_PER_RECORD_MAX = 0.0128 × 3.0 = $0.0384  → round up to $0.04
```

**Daily capacity guarantee:**

```
records_per_day_min = floor(RESEARCH_DAILY_BUDGET_USD / BUDGET_PER_RECORD_MAX)
                    = floor($5.00 / $0.04)
                    = 125 records/day guaranteed at default settings
```

**Settings.py additions:**

```python
RESEARCH_DAILY_BUDGET_USD: float = float(os.getenv("RESEARCH_DAILY_BUDGET_USD", "5.00"))
RESEARCH_MAX_COST_PER_RECORD_USD: float = float(
    os.getenv("RESEARCH_MAX_COST_PER_RECORD_USD", "0.04")
)
RESEARCH_MAX_TOOL_CALLS_PER_RECORD: int = int(
    os.getenv("RESEARCH_MAX_TOOL_CALLS_PER_RECORD", "8")
)
RESEARCH_ELIGIBILITY_COOLDOWN_DAYS: int = int(
    os.getenv("RESEARCH_ELIGIBILITY_COOLDOWN_DAYS", "7")
)
```

**Behavior at ceiling breach:** Task writes a `research_run_stats` row with `status="partial"`,
sets `last_research_run_at`, and returns gracefully. The record won't be re-tried for 7 days
(cooldown applies even to partial runs — prevents the same expensive record from monopolizing budget).

---

## Decision 5 — Fetch-Verify: Comprehensive Tiered with Semantic Matching

**Answer:** State-of-the-art approach — do NOT use simple substring matching. Use:

### Three-tier verification pipeline

```
Tier-1: httpx async GET (static pages, ~0.3–0.8s)
    ↓ if response body < 2KB OR no wine-related keywords detected
Tier-2: Playwright headless render (SPAs, dynamic pages, ~3–5s)
    ↓ always applied for tier-A sources (regulatory/producer sites often use JS)
Both tiers output plain text → Semantic match phase
```

### Semantic match algorithm (not substring)

```python
def _semantic_match(proposed_value: str, page_text: str) -> bool:
    """
    1. Normalize both strings: lowercase, strip diacritics (unicodedata.normalize
       NFC → ASCII transliteration), collapse whitespace.
    2. Exact word-boundary match: re.search(r'\b{escaped_value}\b', normalized_text)
    3. If fails: Levenshtein distance ≤ floor(len(proposed_value) × 0.15)
       — catches minor OCR/formatting differences ("Brunello di Montalcino" vs
       "Brunello diMontalcino" or "Brunello Di Montalcino")
    4. For numeric fields (alcohol_pct, vintage, price): exact numeric match
       after stripping non-numeric chars from both sides.
    """
```

**Why not exact substring:** Regulatory pages often have minor formatting differences. EU GI
pages render accented characters differently across locales. The 15% Levenshtein window catches
these without allowing false matches.

### URL caching (prevent redundant re-fetches)

Store verified page text in `evidence_url_cache` (in-memory dict keyed by URL, TTL 7 days).
On re-fetch request: if URL in cache and cached_at < 7 days ago → use cached text, skip HTTP.
This matters when multiple fields from the same wine need verification against the same producer page.

Persistent cache for cross-session use: a simple `evidence_url_cache` Supabase table:

```sql
CREATE TABLE IF NOT EXISTS evidence_url_cache (
    url TEXT PRIMARY KEY,
    page_text TEXT NOT NULL,
    cached_at TIMESTAMPTZ DEFAULT NOW(),
    fetch_method VARCHAR(20) NOT NULL  -- 'httpx' or 'playwright'
);
CREATE INDEX IF NOT EXISTS idx_url_cache_age ON evidence_url_cache(cached_at);
```

Purge entries older than 7 days in the staleness re-verification task.

### Tier-A always gets Playwright

Regardless of page size:

```python
def _should_use_playwright(url: str, response_body: str, source_tier: str) -> bool:
    if source_tier == "A":
        return True        # Regulatory bodies often use JS-rendered content
    if len(response_body) < 2000:
        return True        # SPA indicator
    if not any(kw in response_body.lower() for kw in WINE_KEYWORDS):
        return True        # No wine content found in static render
    return False
```

### fetch_verify_pass_rate differentiated by tier

The `evidence_citations` table already stores `source_tier` and `fetch_verified`. The metrics
endpoint will break down `fetch_verify_pass_rate` by tier (A/B/C) so you can see whether
tier-A sites have higher pass rates than tier-C (expected: yes, since official sources are stable).

---

## Summary: Constants Changed from Plan Defaults

| Constant | Plan Default | Locked Value | File |
|----------|-------------|--------------|------|
| `RESEARCH_PRIORITY_FIELDS` | Core 10 | All 31 fields (`RESEARCH_ALL_FIELDS`) | `research_agent_helpers.py` |
| Tier-A domains | 7 entries | 40+ entries across 15 countries | `research_agent_helpers.py` |
| Conflict lifecycle | Option A (locked forever) | Option C+ (locked + challenge + 180d staleness) | `research_tasks.py` + new table |
| `RESEARCH_MAX_COST_PER_RECORD_USD` | $0.25 | $0.04 (math-derived, Serper $0.001 corrected) | `settings.py` |
| Fetch-verify | httpx only | Tiered: httpx → Playwright fallback + semantic match + URL cache | `research_tasks.py` |

---

*Context locked: 2026-04-06*
*Authored from user answers — these decisions replace the defaults in QUESTIONS.md*
*Execute: `/gsd-execute-phase 12` (Wave 1 first, then Waves 2+3)*

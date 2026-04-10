---
phase: quick-260403-dgf
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - services/agent-orchestrator/services/web_crawler.py
  - services/agent-orchestrator/services/vlm_extraction_service.py
  - scripts/e2e_crawl_harness.py
autonomous: true
requirements: []
must_haves:
  truths:
    - "JSONL records written by _persist_crawled_wines contain all 23 specified fields plus nulls for future enrichment"
    - "Gemini extraction prompt asks for primary_type, price_reference, sub_region, appellation — not wine_type or price"
    - "E2E harness scores and validates against new field names without KeyError or mapping hacks"
  artifacts:
    - path: "services/agent-orchestrator/services/web_crawler.py"
      provides: "_persist_crawled_wines with full Supabase-aligned schema"
      contains: "signature_hash"
    - path: "services/agent-orchestrator/services/vlm_extraction_service.py"
      provides: "CRAWL_TEXT_PROMPT requesting primary_type and price_reference"
      contains: "primary_type"
    - path: "scripts/e2e_crawl_harness.py"
      provides: "SCORED_FIELDS and validate_schema aligned to new schema"
      contains: "price_reference"
  key_links:
    - from: "vlm_extraction_service.py CRAWL_TEXT_PROMPT"
      to: "web_crawler.py _persist_crawled_wines"
      via: "wine dict field names must match between extractor output and persist logic"
      pattern: "primary_type.*price_reference"
    - from: "web_crawler.py _persist_crawled_wines"
      to: "e2e_crawl_harness.py SCORED_FIELDS"
      via: "JSONL field names read by score_completeness must match what _persist writes"
      pattern: "price_reference"
---

<objective>
Update three files so the crawl pipeline outputs JSONL records that are Supabase-aligned
and ready for insert into master_wine_library without field renaming at insert time
(except wine_name to name, which is intentional per user decision).

Purpose: Close the schema gap between what the crawler currently writes (ad-hoc fields)
and what Supabase's master_wine_library expects. Adds dedup fields, derived fields,
and data_enrichment JSONB so downstream insert logic is trivial.

Output:
- web_crawler.py — _persist_crawled_wines writes the full 23-field record
- vlm_extraction_service.py — CRAWL_TEXT_PROMPT and _parse_crawl_response use new field names
- e2e_crawl_harness.py — SCORED_FIELDS, validate_schema, and write_report use new field names
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
</context>

<tasks>

<task type="auto">
  <name>Task 1: Rewrite _persist_crawled_wines in web_crawler.py</name>
  <files>services/agent-orchestrator/services/web_crawler.py</files>
  <action>
Two changes to this file:

1. Add a module-level helper function `_normalize_wine_field(s)` just before the
   `_persist_crawled_wines` method (inside the class body, before the JSONL PERSISTENCE
   section comment). The function:

   def _normalize_wine_field(s: str) -> str:
       return re.sub(r"[^a-z0-9 ]", "", (s or "").lower().strip())

   Note: `re` is already imported at the top of the file — no new import needed.

2. Replace the entire body of `_persist_crawled_wines` (keeping the method signature
   and docstring unchanged). Replace only the inner logic — the file open, the loop,
   and the logger.info call — with the following:

   RESTAURANT_MENUS_DIR.mkdir(parents=True, exist_ok=True)
   slug = re.sub(r"[^\w]", "_", restaurant_name.lower())[:50]
   ts = datetime.now(timezone.utc).strftime("%Y%m%d")
   out_file = RESTAURANT_MENUS_DIR / f"{ts}_{slug}.jsonl"

   count = 0
   crawled_at = datetime.now(timezone.utc).isoformat()
   crawl_year = datetime.now(timezone.utc).year

   BOTTLE_SIZE_PATTERNS = {
       "magnum": r"\bmagnum\b|1\.5\s*l",
       "half":   r"\bhalf\s*bottle\b|375\s*ml",
       "split":  r"\bsplit\b|187\s*ml",
   }

   with open(out_file, "a") as f:
       for wine in wines:
           # -- core fields --
           wine_name     = wine.get("wine_name", "") or ""
           producer      = wine.get("producer", "") or ""
           vintage_raw   = wine.get("vintage")
           vintage       = int(vintage_raw) if vintage_raw and str(vintage_raw).isdigit() else None
           primary_type  = wine.get("primary_type") or wine.get("wine_type")
           country       = wine.get("country")
           region        = wine.get("region")
           grape_variety = wine.get("grape_variety")
           sub_region    = wine.get("sub_region")
           appellation   = wine.get("appellation")
           price_ref_raw = wine.get("price_reference") or wine.get("price")
           price_reference = float(price_ref_raw) if price_ref_raw else None
           price_glass   = wine.get("price_glass")

           # -- derived fields --
           bottle_size = "standard"
           for size_name, pattern in BOTTLE_SIZE_PATTERNS.items():
               if re.search(pattern, wine_name, re.I):
                   bottle_size = size_name
                   break

           is_blend    = bool(grape_variety and len(grape_variety.split(",")) > 1)
           vintage_age = (crawl_year - vintage) if vintage else None

           if price_reference is None:
               price_tier = None
           elif price_reference < 50:
               price_tier = "entry"
           elif price_reference < 150:
               price_tier = "mid"
           elif price_reference < 500:
               price_tier = "premium"
           else:
               price_tier = "luxury"

           # -- dedup fields --
           norm_name      = self._normalize_wine_field(wine_name)
           norm_producer  = self._normalize_wine_field(producer)
           sig_input      = norm_name + norm_producer + str(vintage or "") + self._normalize_wine_field(region or "")
           signature_hash = hashlib.md5(sig_input.encode()).hexdigest()

           # -- data_enrichment JSONB --
           data_enrichment = {
               "source_url":      source_url,
               "source_type":     "crawled",
               "restaurant_name": restaurant_name,
               "crawled_at":      crawled_at,
               "confidence":      wine.get("confidence"),
               "extraction_model": wine.get("extraction_model", "gemini-2.5-flash"),
           }

           record = {
               # Direct columns
               "wine_name":           wine_name,
               "producer":            producer,
               "vintage":             vintage,
               "primary_type":        primary_type,
               "country":             country,
               "region":              region,
               "grape_variety":       grape_variety,
               "sub_region":          sub_region,
               "appellation":         appellation,
               "price_reference":     price_reference,
               # Derived
               "price_glass":         price_glass,
               "bottle_size":         bottle_size,
               "is_blend":            is_blend,
               "vintage_age":         vintage_age,
               "price_tier":          price_tier,
               # Dedup
               "signature_hash":      signature_hash,
               "normalized_name":     norm_name,
               "normalized_producer": norm_producer,
               # JSONB metadata
               "data_enrichment":     data_enrichment,
               # Future enrichment stubs (Haiku Phase 4 fills these)
               "color":               None,
               "sweetness_level":     None,
               "food_pairing":        None,
               # Submissions staging
               "restaurant_id":       None,
           }
           f.write(json.dumps(record) + "\n")
           count += 1

   logger.info(f"Persisted {count} crawled wines for {restaurant_name} to {out_file.name}")

   IMPORTANT: `hashlib` is already imported at line 24 of web_crawler.py. Do NOT add a
   duplicate import. `_normalize_wine_field` must be an instance method (self parameter)
   or a module-level function — either works; instance method is preferred to keep it
   inside the class namespace consistently.
  </action>
  <verify>
    <automated>cd "/Users/aldemirkonuk/Desktop/UnicornProjects/Restaurant AI Automation" && python -c "
import sys, json, re
from pathlib import Path
from datetime import datetime, timezone
sys.path.insert(0, 'services/agent-orchestrator')
from services.web_crawler import WebCrawlerService

fake_wine = {
    'wine_name': 'Chateau Margaux Magnum',
    'producer': 'Chateau Margaux',
    'vintage': 2015,
    'primary_type': 'red',
    'country': 'France',
    'region': 'Bordeaux',
    'grape_variety': 'Cabernet Sauvignon, Merlot',
    'sub_region': 'Margaux',
    'appellation': 'Margaux AOC',
    'price_reference': 450.0,
    'price_glass': None,
    'confidence': 0.95,
}
svc = WebCrawlerService()
svc._persist_crawled_wines([fake_wine], 'SchemaTest Restaurant', 'https://example.com')

slug = re.sub(r'[^\w]', '_', 'schematest_restaurant')[:50]
ts = datetime.now(timezone.utc).strftime('%Y%m%d')
out = Path('datasets/restaurant_menus') / f'{ts}_{slug}.jsonl'
record = json.loads(out.read_text().strip().splitlines()[-1])

required = ['wine_name','producer','vintage','primary_type','country','region',
            'grape_variety','sub_region','appellation','price_reference',
            'price_glass','bottle_size','is_blend','vintage_age','price_tier',
            'signature_hash','normalized_name','normalized_producer',
            'data_enrichment','color','sweetness_level','food_pairing','restaurant_id']
missing = [f for f in required if f not in record]
assert not missing, f'Missing fields: {missing}'
assert record['price_tier'] == 'premium', f'price_tier: {record[\"price_tier\"]}'
assert record['is_blend'] == True, 'is_blend wrong'
assert record['bottle_size'] == 'magnum', f'bottle_size: {record[\"bottle_size\"]}'
assert record['signature_hash'], 'signature_hash empty'
assert isinstance(record['data_enrichment'], dict), 'data_enrichment not dict'
assert 'price' not in record, 'old key price must not exist'
assert 'wine_type' not in record, 'old key wine_type must not exist'
assert 'source_type' not in record, 'source_type must be inside data_enrichment only'
print('PASS')
"
    </automated>
  </verify>
  <done>
    python -c import passes. Verification script prints "PASS". All 23 required fields
    present in output JSONL. Old keys (price, wine_type, source_type at top level) absent.
    Derived fields (price_tier=premium, is_blend=True, bottle_size=magnum) computed correctly.
  </done>
</task>

<task type="auto">
  <name>Task 2: Update CRAWL_TEXT_PROMPT and _parse_crawl_response in vlm_extraction_service.py</name>
  <files>services/agent-orchestrator/services/vlm_extraction_service.py</files>
  <action>
Two targeted changes in vlm_extraction_service.py:

CHANGE 1 — CRAWL_TEXT_PROMPT (around line 462-477):
Replace the For each wine extract line with an updated field list:

OLD:
  For each wine extract: wine_name, producer, vintage (int or null), wine_type, country, region,
  grape_variety, price (bottle price as float or null), price_glass (float or null),
  price_currency, section_path, confidence (0.0-1.0).

NEW:
  For each wine extract: wine_name, producer, vintage (int or null), primary_type
  (red|white|rose|sparkling|dessert|fortified), country, region, sub_region (if visible),
  appellation (AOC/DOC/AVA if visible), grape_variety, price_reference (bottle price as
  float or null), price_glass (float or null), section_path, confidence (0.0-1.0).

Also update the example JSON object in the prompt. Replace the example wines list entry:

OLD example dict fields: wine_name, producer, vintage, price, confidence
NEW example dict fields: wine_name, producer, vintage, primary_type, price_reference,
                         sub_region, appellation, confidence

Full replacement of the example in CRAWL_TEXT_PROMPT:

  "wines": [{{"wine_name": "...", "producer": "...", "vintage": 2018,
              "primary_type": "red", "country": "...", "region": "...",
              "sub_region": null, "appellation": null,
              "grape_variety": "...", "price_reference": 150.0,
              "price_glass": null, "section_path": "...", "confidence": 0.9}}]

CHANGE 2 — _parse_crawl_response method (around line 530-563):
No structural changes needed — the method already does `wines = data.get("wines", [])` and
stores them verbatim. The field name changes are in the prompt; the parser is field-agnostic.
However, add one comment above `result.wines = wines` to document intent:

  # Field names in wine dicts match CRAWL_TEXT_PROMPT schema:
  # primary_type (not wine_type), price_reference (not price)

Also update the TEXT_FALLBACK_PROMPT field list (around line 173) for consistency.
In the line that lists fields to extract, replace `wine_type` with `primary_type` and
replace `price` with `price_reference`. Also add `sub_region` and `appellation` to
that same field list if not already present.

OLD TEXT_FALLBACK_PROMPT extract line:
  - wine_name, producer, vintage, wine_type, country, region, sub_region,
    appellation, grape_variety, price, price_glass, price_currency,

NEW:
  - wine_name, producer, vintage, primary_type, country, region, sub_region,
    appellation, grape_variety, price_reference, price_glass,

Note: sub_region and appellation are already in TEXT_FALLBACK_PROMPT — only rename
wine_type and price in that prompt's field list.
  </action>
  <verify>
    <automated>cd "/Users/aldemirkonuk/Desktop/UnicornProjects/Restaurant AI Automation" && python -c "
import sys
sys.path.insert(0, 'services/agent-orchestrator')
from services.vlm_extraction_service import CRAWL_TEXT_PROMPT, TEXT_FALLBACK_PROMPT

assert 'primary_type' in CRAWL_TEXT_PROMPT, 'CRAWL_TEXT_PROMPT missing primary_type'
assert 'price_reference' in CRAWL_TEXT_PROMPT, 'CRAWL_TEXT_PROMPT missing price_reference'
assert 'wine_type' not in CRAWL_TEXT_PROMPT, 'CRAWL_TEXT_PROMPT still has wine_type'
assert '\"price\"' not in CRAWL_TEXT_PROMPT or 'price_reference' in CRAWL_TEXT_PROMPT, 'price rename issue'
assert 'sub_region' in CRAWL_TEXT_PROMPT, 'CRAWL_TEXT_PROMPT missing sub_region'
assert 'appellation' in CRAWL_TEXT_PROMPT, 'CRAWL_TEXT_PROMPT missing appellation'

assert 'primary_type' in TEXT_FALLBACK_PROMPT, 'TEXT_FALLBACK_PROMPT missing primary_type'
assert 'price_reference' in TEXT_FALLBACK_PROMPT, 'TEXT_FALLBACK_PROMPT missing price_reference'
print('PASS')
"
    </automated>
  </verify>
  <done>
    Both CRAWL_TEXT_PROMPT and TEXT_FALLBACK_PROMPT contain primary_type and price_reference.
    Neither contains wine_type as a field name to extract (wine_type may appear in comments
    but not in the instruction list).
  </done>
</task>

<task type="auto">
  <name>Task 3: Update SCORED_FIELDS, validate_schema, and write_report in e2e_crawl_harness.py</name>
  <files>scripts/e2e_crawl_harness.py</files>
  <action>
Three targeted changes in e2e_crawl_harness.py:

CHANGE 1 — SCORED_FIELDS constant (line 37):
OLD:  SCORED_FIELDS = ["wine_name", "vintage", "region", "price_bottle", "country", "grape_variety"]
NEW:  SCORED_FIELDS = ["wine_name", "vintage", "region", "price_reference", "country", "grape_variety"]

CHANGE 2 — score_completeness function (lines 44-67):
Remove the `lookup_key = "price" if field == "price_bottle" else field` mapping hack entirely.
Replace the entire inner lookup with a direct field read:

OLD inner loop body:
  for field in SCORED_FIELDS:
      # price_bottle in SCORED_FIELDS maps to "price" key in actual JSONL
      lookup_key = "price" if field == "price_bottle" else field
      value = wine.get(lookup_key)
      if value is not None and value != "" and value != 0:
          present_count += 1

NEW inner loop body:
  for field in SCORED_FIELDS:
      value = wine.get(field)
      if value is not None and value != "" and value != 0:
          present_count += 1

Also remove the comment block above the lookup_key line explaining the price_bottle mapping.

CHANGE 3 — write_report sample wines table (lines 192-204):
Update the sample wines table header and data extraction to use price_reference:

OLD table header:
  lines.append("| wine_name | vintage | region | country | price | grape_variety |")
  lines.append("|-----------|---------|--------|---------|-------|---------------|")

NEW table header:
  lines.append("| wine_name | vintage | region | country | price_reference | grape_variety |")
  lines.append("|-----------|---------|--------|---------|-----------------|---------------|")

OLD data extraction line:
  price = w.get("price", "")

NEW data extraction line:
  price = w.get("price_reference", "")

No other changes to write_report. The validate_schema function only checks for
wine_name, source_type, source_url, restaurant_name, crawled_at — these keys are all
present in the new record (source_type and source_url moved into data_enrichment, but
validate_schema still checks top-level keys).

WAIT — re-check: after Task 1, source_type and source_url are INSIDE data_enrichment,
NOT at the top level of the record. The current validate_schema requires them as top-level
keys. Update validate_schema required_keys accordingly:

OLD required_keys: ["wine_name", "source_type", "source_url", "restaurant_name", "crawled_at"]
NEW required_keys: ["wine_name", "signature_hash", "data_enrichment"]

Update the docstring accordingly: "Required keys: wine_name, signature_hash, data_enrichment"

Also add nested validation for data_enrichment contents:
After the main loop, add:
  de = wine.get("data_enrichment")
  if isinstance(de, dict):
      for de_key in ["source_url", "source_type", "restaurant_name", "crawled_at"]:
          if not de.get(de_key):
              violations.append(f"Missing or empty data_enrichment.{de_key}")
  else:
      violations.append("data_enrichment must be a dict")
  </action>
  <verify>
    <automated>cd "/Users/aldemirkonuk/Desktop/UnicornProjects/Restaurant AI Automation" && python -c "
import sys
sys.path.insert(0, 'services/agent-orchestrator')
from scripts.e2e_crawl_harness import SCORED_FIELDS, score_completeness, validate_schema

# Check SCORED_FIELDS
assert 'price_reference' in SCORED_FIELDS, 'SCORED_FIELDS missing price_reference'
assert 'price_bottle' not in SCORED_FIELDS, 'price_bottle still in SCORED_FIELDS'

# Check score_completeness with new schema
wines = [{'wine_name': 'Test', 'vintage': 2019, 'region': 'Bordeaux',
          'price_reference': 80.0, 'country': 'France', 'grape_variety': 'Merlot'}]
score = score_completeness(wines)
assert score == 1.0, f'Expected 1.0 completeness, got {score}'

# Check validate_schema with new schema
valid_record = {
    'wine_name': 'Test',
    'signature_hash': 'abc123',
    'data_enrichment': {
        'source_url': 'https://example.com',
        'source_type': 'crawled',
        'restaurant_name': 'Test Restaurant',
        'crawled_at': '2026-04-03T00:00:00+00:00',
    }
}
violations = validate_schema(valid_record)
assert not violations, f'Unexpected violations: {violations}'

# Invalid record missing data_enrichment
bad_record = {'wine_name': 'Test', 'signature_hash': 'abc'}
violations2 = validate_schema(bad_record)
assert violations2, 'Should have violations for missing data_enrichment'

print('PASS')
" 2>&1
    </automated>
  </verify>
  <done>
    SCORED_FIELDS contains price_reference (not price_bottle). score_completeness returns
    1.0 for a fully populated new-schema wine dict. validate_schema catches missing
    data_enrichment. No mapping hacks remain in the file.
  </done>
</task>

</tasks>

<verification>
After all three tasks, run a final integration check:

  cd "/Users/aldemirkonuk/Desktop/UnicornProjects/Restaurant AI Automation"
  python -c "
import sys
sys.path.insert(0, 'services/agent-orchestrator')
from services.vlm_extraction_service import CRAWL_TEXT_PROMPT
from scripts.e2e_crawl_harness import SCORED_FIELDS, score_completeness, validate_schema
from services.web_crawler import WebCrawlerService
import json, re
from pathlib import Path
from datetime import datetime, timezone

# 1. Field name consistency: extractor prompt matches persist output
assert 'primary_type' in CRAWL_TEXT_PROMPT
assert 'price_reference' in CRAWL_TEXT_PROMPT

# 2. Harness SCORED_FIELDS aligned
assert 'price_reference' in SCORED_FIELDS

# 3. Round-trip: persist a wine, score it
fake = {
    'wine_name': 'Integration Test Wine', 'producer': 'Test Producer',
    'vintage': 2018, 'primary_type': 'white', 'country': 'Italy',
    'region': 'Tuscany', 'grape_variety': 'Sangiovese',
    'price_reference': 75.0, 'confidence': 0.9,
}
svc = WebCrawlerService()
svc._persist_crawled_wines([fake], 'IntegrationTest', 'https://test.com')
slug = re.sub(r'[^\w]', '_', 'integrationtest')[:50]
ts = datetime.now(timezone.utc).strftime('%Y%m%d')
out = Path('datasets/restaurant_menus') / f'{ts}_{slug}.jsonl'
record = json.loads(out.read_text().strip().splitlines()[-1])
score = score_completeness([record])
violations = validate_schema(record)
assert score == 1.0, f'Score: {score}'
assert not violations, f'Violations: {violations}'
print('INTEGRATION PASS')
"
</verification>

<success_criteria>
1. _persist_crawled_wines writes records with all 23 fields specified in the field spec.
   Old keys (price, wine_type) do not appear at the top level.
2. CRAWL_TEXT_PROMPT instructs Gemini to return primary_type and price_reference.
3. SCORED_FIELDS = ["wine_name", "vintage", "region", "price_reference", "country", "grape_variety"]
   with no mapping hack in score_completeness.
4. validate_schema checks wine_name, signature_hash, data_enrichment (with nested checks).
5. Integration verification prints "INTEGRATION PASS".
</success_criteria>

<output>
After completion, create `.planning/quick/260403-dgf-update-crawler-jsonl-output-schema-to-su/260403-dgf-SUMMARY.md`
</output>

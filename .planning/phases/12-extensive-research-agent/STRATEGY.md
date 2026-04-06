# Phase 12: Extensive Gap-Filling Research Agent — Strategy

**Document type:** Pre-execution rehearsal — read this before approving the plans.
**Purpose:** Walk through every step the agent takes, in order, using real table and column names.
Confirm this matches your mental model before a single line of code is written.

---

## The Problem This Phase Solves

After Phases 7 through 11, a wine record in `master_wine_library_submissions` looks something like
this in its `field_confidence` JSONB column:

```json
{
  "wine_name":    { "value": "Brunello di Montalcino",  "confidence": 0.97, "source": "visible" },
  "producer":     { "value": null,                       "confidence": 0.00, "source": "visible" },
  "vintage":      { "value": "2018",                    "confidence": 0.95, "source": "visible" },
  "region":       { "value": "Tuscany",                 "confidence": 0.73, "source": "inferred" },
  "appellation":  { "value": null,                       "confidence": 0.00, "source": "visible" },
  "grape_variety":{ "value": "Sangiovese",              "confidence": 0.65, "source": "knowledge" },
  "country":      { "value": "Italy",                   "confidence": 0.88, "source": "knowledge" }
}
```

The wine name and vintage are solid. But producer is NULL, appellation is NULL, and both region
(0.73) and grape_variety (0.65) are in the review zone — meaning three humans will have to look
at them. The research agent's job is to fill producer and appellation with cited evidence, and
push region and grape_variety confidence high enough to auto-promote — eliminating those human
review items without ever guessing.

The key contract: **every value the agent proposes must be traceable to a URL, a snippet of text
from that URL, and a timestamp of when it was retrieved.** An unfounded AI inference is not a fill;
it is a liability.

---

## Step 1 — Eligibility Gate

Before the agent touches a record, it asks two questions.

First, has this record been through a research run within the past 7 days? The
`last_research_run_at` column on `master_wine_library_submissions` answers this. If the timestamp
is recent, the agent skips this record entirely — there is no point hammering the same wine twice
a week.

Second, does this record actually have fields worth researching? The agent reads `field_confidence`
and looks for any field in the configured priority list (default: wine_name, producer, vintage,
region, country, appellation, grape_variety, color, primary_type, alcohol_pct) where the
confidence value is below 0.8. If every priority field is already above 0.8, this record needs no
research.

A record passes the gate only if both conditions are true: not recently researched, and has at
least one eligible field.

---

## Step 2 — Run Accounting

The moment a record passes the gate, the agent inserts a row into the `research_runs` table.
This row captures the run ID, when it started, how many records are eligible in this batch, and
sets status to `running`. At the end of the run, it is updated with completion time, how many
fields were actually filled, total cost, and final status (`completed`, `partial`, or `failed`).

This run record is the unit of auditability. Every `research_run_stats` row for individual wines,
and every `evidence_citations` row for individual field fills, links back to this run ID. You can
always reconstruct what happened in a given batch.

---

## Step 3 — Stop Rule Initialization

Each wine record gets a call counter, initialized to zero, with a configurable ceiling (default 8).
This counter increments with every external tool call — every Serper search, every LLM parsing
call, every fetch-verify HTTP request. If the counter reaches the ceiling before all target fields
are resolved, the agent stops for this record and marks the run as `partial`. The record is still
updated with whatever was found, and `last_research_run_at` is set — so it won't be re-tried for
7 days.

The stop rule is not optional. Without it, a record with 8 NULL fields, each generating 2 search
queries plus a follow-up, could easily make 20+ calls. The stop rule is how `attempts_per_filled_field`
stays bounded and how the agent avoids runaway cost on difficult records.

---

## Step 4 — Evidence Loop (Per Target Field)

For each target field, the agent executes a structured evidence-gathering loop.

**Search query construction.** The agent builds a Serper query tailored to the specific field it
is trying to fill. For `appellation`, the query is: `"{wine_name} {vintage} appellation official"`
plus the known producer if available. For `producer`, the query is: `"who makes {wine_name}
{vintage} winery"`. The query is deliberately narrow — a broad query about the wine returns
too many irrelevant snippets.

**Serper execution.** The query is sent to the Serper API (the same integration built in Phase 8).
Top 5 results are returned as `{url, title, snippet}` objects. Each result is tentatively assigned
a source tier based on its domain: the producer's own website or a known regulatory body (INAO,
TTB, Consorzio) is tier-A; Wine-Searcher, Vivino, Decanter, Wine Spectator, Jancis Robinson are
tier-B; anything else is tier-C. The tier assignment happens via a domain lookup against a
configurable blocklist/allowlist.

**Candidate extraction.** The snippets from Serper results are passed to Gemini Flash with a
structured extraction prompt that asks: "From these search snippets, what is the most likely value
for `{field_name}` for this wine? Return a JSON array of candidates, each with {value, source_url,
source_tier, confidence, snippet_used}." The LLM is not asked to guess — it is asked to extract
from the provided text. If no candidate is extractable, the field is skipped for this run.

**Fetch-verify.** For the top-ranked candidate, the agent re-fetches the source URL and checks
whether the proposed value string is present in the live page content. This catches the common
failure mode where a search snippet is stale (the page was updated since indexing) or where the
snippet was truncated in a misleading way. If the fetch-verify passes, `fetch_verified = true` is
recorded on the evidence row. If it fails (value not found on live page), the candidate is
downgraded but not discarded — it still contributes to tier-C evidence with `fetch_verified = false`.
The `fetch_verify_pass_rate` metric tracks the ratio globally.

The call counter increments by 2 for this field: once for the Serper call and once for the
fetch-verify HTTP request. If the counter is at 7 of 8 and the current field needs a Serper call
(count: 1) plus fetch-verify (count: 1), the counter would hit 9 — so the agent stops before
initiating those calls.

---

## Step 5 — Conflict Detection

After candidate extraction, the agent checks whether the results themselves agree. A conflict
exists when two or more evidence-backed candidates (each with a supporting snippet) propose
different values for the same field. For example: Serper result #1 (tier-B, Wine-Searcher) says
`grape_variety = "Sangiovese"` and Serper result #2 (tier-B, producer site) says `grape_variety
= "Sangiovese Grosso"`. These are arguably compatible — one is an alias of the other.

The conflict detection algorithm uses exact string comparison on the extracted values after
normalization (lowercasing, stripping punctuation). Compatible aliases (Syrah/Shiraz,
Garnacha/Grenache) are pre-defined in a synonym table within `research_agent_helpers.py`; matching
aliases do NOT constitute a conflict.

When a genuine conflict is detected, the agent writes all candidate objects into the
`conflict_candidates` JSONB column on the submission record under the relevant field key:

```json
{
  "grape_variety": [
    { "value": "Syrah", "source_url": "...", "source_tier": "B", "snippet": "..." },
    { "value": "Merlot", "source_url": "...", "source_tier": "B", "snippet": "..." }
  ]
}
```

The field is NOT auto-promoted. It is NOT written to `field_confidence`. The conflict sits in
`conflict_candidates` until a human reviews it via `GET /api/v1/research/conflicts`. This is the
`conflict_rate` metric's denominator — and it is intentionally not zero. Some fields genuinely
have conflicting evidence, and surfacing that conflict is more valuable than picking one at random.

---

## Step 6 — Corroboration Check

If no conflict was detected and at least one candidate was extracted, the agent applies the
corroboration rule before deciding whether to auto-promote:

- **Tier-A source (producer/regulator):** Single source is sufficient. Confidence assigned: 0.95.
- **Two or more independent tier-B/C sources:** Auto-promote. Independence means different registered
  domains — `wine-searcher.com` and `decanter.com` are independent; two wine-searcher.com URLs are
  not. Confidence assigned: 0.87.
- **Single tier-B source:** Cannot auto-promote. Value is proposed with confidence 0.72 (falls in
  the review zone, goes to `field_review_queue` but IS persisted). The human can approve it.
- **Single tier-C source:** Cannot auto-promote. Value is proposed with confidence 0.60 (review zone).

The `independent_corroboration_rate` metric measures what fraction of auto-promoted fields had
either a tier-A source or ≥2 independent sources. The target is ≥ 60%.

---

## Step 7 — Regression Guard

Before writing anything, the agent calls `merge_field_confidence()` from `field_confidence.py`
(built in Phase 7). This function refuses to overwrite an existing field entry with a lower-confidence
value. So if Vision extraction already gave `country = Italy` at confidence 0.95, and the research
agent found country = Italy at 0.87, the 0.95 value is kept. If the research agent found country =
France at 0.88 (a genuine contradiction), the merge would also keep the existing 0.95 value, but
this situation is caught earlier by conflict detection.

The `regression_rate` metric monitors how often a run increases the null count or overwrites a
higher-confidence value. The target is zero. The regression guard enforces this mechanically —
it is not a metric that the team hopes to hit; it is a check that makes violations impossible by
construction.

---

## Step 8 — Evidence Persistence

For every proposed value that will be written (auto-promoted or queued for review), the agent
inserts a row into `evidence_citations`:

```
wine_id            = submission_id
field_name         = "appellation"
proposed_value     = "Brunello di Montalcino DOCG"
source_url         = "https://www.consorziobrunellomontalcino.it/..."
source_tier        = "A"
snippet            = "The production zone of Brunello di Montalcino DOCG..."
retrieved_at       = "2026-04-12T14:23:01Z"
fetch_verified     = true
corroboration_count= 1
```

The `citation_completeness` metric measures what fraction of proposed values have all five
required fields populated: source_url, snippet, retrieved_at, source_tier, and fetch_verified.
The target is 100% for auto-promoted fills. There is no value in an uncited fill.

---

## Step 9 — Field Confidence Merge and Routing

The agent now merges the new evidence into `field_confidence` using `merge_field_confidence()`.
The resulting updated JSONB is written back to `master_wine_library_submissions`.

Then `route_fields_by_threshold()` runs on the updated `field_confidence`. Fields newly above 0.80
are auto-accepted. Fields between 0.50 and 0.80 get rows inserted into `field_review_queue` with
status `pending`. Fields below 0.50 remain NULL in the record.

The `promotion_rate` metric is computed from this routing step: how many proposed values ended
up auto-promoted (above 0.80) versus routed to review versus rejected. The `null_rate_after`
stat is also captured here by counting how many target fields are still NULL after the run.

---

## Step 10 — Run Stats Write

After processing the record, the agent writes to `research_run_stats`:

```
run_id               = current run ID
wine_id              = submission_id
fields_targeted      = 5   (fields that were below 0.8 at start)
fields_filled        = 3   (fields now above 0.5 with evidence)
fields_conflicted    = 1   (written to conflict_candidates, not filled)
fields_unchanged     = 1   (no evidence found, still NULL)
cost_usd             = 0.031  (total Serper + LLM cost for this record)
attempts             = 7   (tool calls consumed)
null_rate_before     = 0.71  (5/7 target fields were NULL)
null_rate_after      = 0.43  (3/7 still NULL after fill)
time_to_fill_hours   = computed from record creation timestamp to now
```

Finally, `last_research_run_at` on `master_wine_library_submissions` is set to now().

---

## Step 11 — Metrics API

The `GET /api/v1/research/metrics` endpoint aggregates across all runs and exposes five metric
categories from the tables written in Steps 2 and 10:

**Gap closure:** `null_rate_before / null_rate_after` from `research_run_stats` (average across
all runs), `fields_filled_per_record` distribution, `time_to_fill` median.

**Quality:** `promotion_rate` from `research_run_stats` (fields_filled / fields_targeted),
`human_override_rate` from `field_corrections` JOIN `evidence_citations` (corrections where
original value came from research agent), `conflict_rate` from `research_run_stats`.

**Evidence hygiene:** `citation_completeness` from `evidence_citations` (fraction with all 5
required columns non-null), `independent_corroboration_rate` from `evidence_citations`
(corroboration_count >= 2 OR source_tier = 'A'), `fetch_verify_pass_rate` from `evidence_citations`
(fetch_verified = true / total).

**Throughput and cost:** `records_processed_per_day` from `research_runs`, `cost_per_filled_field`
from `research_runs.cost_usd / research_run_stats.fields_filled` (aggregated), `attempts_per_filled_field`
from `research_run_stats.attempts / fields_filled`.

**Safety:** `pii_policy_flags` from a dedicated counter column on `research_runs`,
`regression_rate` is zero by construction (enforced by `merge_field_confidence`).

---

## What the Agent Does NOT Do

It does not hallucinate fills. If no evidence is found in 8 calls, the field stays NULL. The dataset
gets a well-documented gap rather than a plausible lie.

It does not overwrite human corrections. Fields with `source: "human_resolved"` in `field_confidence`
are excluded from the eligibility check — the agent skips them at the eligibility gate.

It does not auto-promote conflicted fields. A genuine source disagreement goes into
`conflict_candidates` for human resolution, never into the canonical `field_confidence` map.

It does not bypass the budget. The daily cap on `api_spend` (already enforced in Phase 5) is
checked before each research task runs. The per-record ceiling ($0.25 by default) caps individual
record cost. Neither can be circumvented by the task itself.

---

## DB Tables at a Glance

| Table / Column | Written by | Read by |
|----------------|-----------|---------|
| `research_runs` | Agent, start + end of batch | Metrics API, run history API |
| `research_run_stats` | Agent, per record | Metrics API, run history API |
| `evidence_citations` | Agent, per proposed value | Metrics API, conflicts API |
| `conflict_candidates` JSONB | Agent, when ≥2 sources disagree | Conflicts API, human review |
| `last_research_run_at` | Agent, end of record processing | Eligibility gate |
| `field_confidence` JSONB | Agent via `merge_field_confidence()` | Every downstream phase |
| `field_review_queue` | Agent via `route_fields_by_threshold()` | Human review queue (Phase 7 API) |
| `api_spend` | SpendLogger (existing Phase 5) | Budget cap gate |

---

*Strategy authored: 2026-04-06 — Phase 12 planning*
*Read alongside the numbered PLAN files (12-01 through 12-04) before executing.*

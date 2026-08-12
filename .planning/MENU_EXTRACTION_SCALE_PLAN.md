# Menu Extraction at 1000+ Restaurants

Plan for bulk menu ingestion at enterprise scale. Every number here is measured
against the real corpus in `datasets/annotation_inbox/pdfs` (26 restaurant wine
lists, 305 pages) — not estimated.

---

## 0. The honest constraint on "no errors acceptable"

**You cannot get zero errors out of an LLM extraction pipeline.** Any plan that
claims otherwise is lying. What is achievable, and what this plan targets:

> **Zero *silent* errors.** Every extraction is either verified correct by a
> deterministic check, or routed to human review. Nothing is imported on trust.

That distinction drives the whole architecture. The expensive part is not the
model — it is the verifier that makes failure visible.

---

## 1. Measured baseline

From the backtest (4 menus spanning 0.05–4.40 MB, 2–13 pages, three models):

| Model | $/page | s/page | Wines found | Agreement with Opus 5 |
|---|---|---|---|---|
| `claude-haiku-4-5` | $0.0065 | 5.6 | 486 | **99.0%** (producer+vintage), prices identical |
| `claude-sonnet-5` | $0.0150 | 7.5 | 485 | 99.5% |
| `claude-opus-5` | $0.0377 | 9.0 | 485 | — |

Corpus average: **11.7 pages/menu** (305 pages / 26 menus).

Projected to 1000 restaurants ≈ **11,700 pages**:

| Strategy | Cost | Wall clock (sequential) |
|---|---|---|
| Haiku, synchronous (today's code) | $76 | **18.2 hours** |
| Opus 5, synchronous | $441 | 29.3 hours |
| **Haiku, Batch API (50% off)** | **$38** | ≤ 24h, typically < 1h |
| Haiku batch + 10% Sonnet escalation | **$47** | ≤ 24h |

**Cost is not the problem — $76 vs $441 is noise at enterprise scale.**
Throughput and correctness are the problem.

---

## 2. Blockers in the current code (verified, not hypothetical)

### 2.1 The import endpoint is synchronous
`POST /menus/import` → `menusService.importMenu()` → `scanParser.parse()` →
a blocking `axios.post` to Anthropic with a 60s timeout, inside the HTTP
request. 1000 restaurants onboarding means 1000 concurrent connections each
held open for ~60s. The Node event loop and the connection pool will fail long
before Anthropic does.

### 2.2 Unbounded fan-out per menu
`menus.service.ts:305` — `Promise.all(items.map(...))` resolves every wine
against the library with **no concurrency limit**. A 199-wine menu fires 199
simultaneous Supabase round trips. Ten concurrent imports = ~2,000 in-flight
queries.

### 2.3 The library race silently unlinks wines
`master_wine_library` has a partial unique index on `signature_hash`, so the
race cannot create duplicate rows — good. But `resolveOrCreateLibraryWine`
failures are caught as *non-fatal* and return `masterWineId: null`. Under
concurrency the losing side of a race produces a wine that imports **with no
library link**, so it never matches inventory and never reaches analytics.
This is exactly the silent-error class the requirement forbids.

### 2.4 No idempotency
Nothing keys on `(restaurant_id, file_hash)`. A retry after a partial failure
re-imports the whole menu. At 1000 restaurants, retries are certain.

### 2.5 Prompt caching cannot help this workload
The extraction prompt is ~200 tokens. Haiku 4.5's minimum cacheable prefix is
**4096 tokens**, so a `cache_control` marker would silently never cache. Each
PDF is unique, so there is no shared prefix to cache either. Do not spend
effort here.

---

## 3. Target architecture

```
upload → hash → dedupe gate → queue
                                │
                                ▼
                      ┌── Batch API (Haiku) ──┐
                      │   50% cost, async     │
                      └───────────┬───────────┘
                                  ▼
                      ┌── deterministic verifier ──┐
                      │  text-layer coverage       │
                      │  price sanity              │
                      │  duplicate detection       │
                      │  required-field fill       │
                      └───────┬────────────┬───────┘
                        pass  │            │ fail
                              ▼            ▼
                     bounded library   escalate to Sonnet 5
                     resolution         (batch) → re-verify
                     (concurrency 10)         │
                              │          still fail
                              ▼               ▼
                          imported      human review queue
```

### Phase 1 — Move extraction to the Batch API
The single highest-leverage change. Batches are asynchronous by construction
(no HTTP timeout problem), accept up to 100,000 requests per batch, and cost
**50% less**. Poll `processing_status` until `ended`, then stream results and
key them by `custom_id` — **results arrive in arbitrary order**, so never index
by position.

`custom_id` should be the idempotency key: `menu:{restaurant_id}:{file_sha256}`.

### Phase 2 — The deterministic verifier (this is how you get "no silent errors")
For text-layer PDFs — the majority — you get a free ground-truth signal by
counting priced lines with `pdfplumber` and comparing to the extracted count.
The backtest validated this and also exposed its failure mode: on a *beverage*
menu (Mia Francesca) the proxy counted cocktail prices, so coverage read 54.9%
when extraction was actually correct. The verifier must therefore gate on a
**band**, not a floor, and treat out-of-band as *review*, not *reject*:

| Check | Pass condition | On failure |
|---|---|---|
| Coverage ratio (extracted / priced lines) | 0.75 – 1.60 | escalate |
| Any wine with a null price | < 5% of wines | escalate |
| Duplicate `(producer, name, vintage)` | 0 | auto-dedupe, log |
| Producer field populated | > 90% of wines | escalate |
| `stop_reason == "max_tokens"` | never | **hard fail** → split & retry |
| No text layer (scanned PDF) | — | skip coverage, escalate by default |

### Phase 3 — Selective escalation, not blanket upgrade
The backtest showed Haiku and Opus agree on **99% of wines with identical
prices**. Paying 5.8× for the other 1% across the whole corpus is waste. Send
only verifier-flagged menus to Sonnet 5, re-verify, and route persistent
failures to human review. Expected escalation rate ~10% → **+$9 per 1000
restaurants**.

The one systematic Haiku weakness measured: it stuffs region/grape into the
`name` field (4.7 words avg vs Opus 3.1). Fix this in the **prompt**, not by
changing model — add an explicit instruction that `name` excludes region and
grape, and add the field-length check to the verifier.

### Phase 4 — Durability
- Idempotency key on `(restaurant_id, file_sha256)`; a replay is a no-op.
- Bounded concurrency (`p-limit`, cap 10) on library resolution — removes 2.2.
- Make library-resolution failure **loud**: on a `23505` race, re-read the
  winner's row and link to it instead of returning `masterWineId: null`.
  A genuine failure goes to the review queue, never to a silent null.
- Dead-letter queue with the raw model response retained for replay.

---

## 4. Rate limits

11,700 pages ≈ **23M input tokens** (~2,000 tok/page measured). Batch API
requests draw on separate, higher limits than the synchronous API, but the
organization's ITPM/OTPM still applies. Before a 1000-restaurant run:

1. Check the tier's Haiku 4.5 limits (separate pool from other models).
2. Chunk into batches of ~500 menus rather than one 1000-menu batch, so a
   rejected batch costs one chunk, not the whole run.
3. The SDK retries 429/5xx with exponential backoff by default (`max_retries`);
   do not hand-roll this.

---

## 5. Implementation order

| # | Change | Unblocks | Effort |
|---|---|---|---|
| 1 | Idempotency key + dedupe gate | safe retries | S |
| 2 | Bounded concurrency on library resolution | 2.2 | S |
| 3 | Fix the silent-null library race | 2.3 | S |
| 4 | Deterministic verifier + review queue | "no silent errors" | M |
| 5 | Move extraction to Batch API | 2.1, cost, throughput | M |
| 6 | Selective escalation to Sonnet 5 | accuracy at low cost | S |
| 7 | Prompt fix for `name` field hygiene | Haiku's one weakness | S |

Items 1–3 are worth doing regardless of scale — they are correctness bugs that
merely become *visible* at 1000 restaurants.

---

## 6. What NOT to do

- **Do not upgrade to Opus 5 across the board.** Measured 99% agreement with
  Haiku at 5.8× the cost. Escalate selectively instead.
- **Do not add prompt caching.** Prompt is below Haiku's 4096-token minimum.
- **`max_tokens: 16,000` is NOT enough for this corpus — verified.** 3 of the
  4 largest menus truncate (§7). 16,000 is the practical *non-streaming*
  ceiling before HTTP timeout, so the fix is splitting by page range or
  streaming — not a higher synchronous cap (Haiku's hard cap is 64,000).
- **Do not size `max_tokens` off priced-line counts.** Theodora has 328 priced
  lines but only 204 wines and fits fine. Size off measured output tokens:
  **58.3 tokens per wine**, so ~270 wines is the 16,000-token ceiling.
- **Do not rate-limit by uploads/day.** Cost tracks *pages*, not uploads —
  the corpus has a 0.85 MB / 65-page menu and a 1.66 MB / 2-page menu. Cap
  pages per restaurant per period if a guardrail is needed.

---

## 7. VERIFIED: 16,000 output tokens does not cover the corpus

**Status: measured, not estimated.** Run against `claude-haiku-4-5` at
`max_tokens: 16000` with the production schema.

| Menu | Pages | Priced lines | Output tokens | Wines salvaged | `stop_reason` |
|---|---|---|---|---|---|
| RL_Restaurant | 12 | 491 | **16,000** | 218 | `max_tokens` — **truncated** |
| Saison Cellar & Wine Bar | 34 | 465 | **16,000** | 285 | `max_tokens` — **truncated** |
| Obelix Chicago | 13 | 325 | **16,000** | 248 | `max_tokens` — **truncated** |
| Theodora | 65 | 328 | 11,885 | 204 | `end_turn` — fits |

**3 of the 4 largest menus truncate.** Extrapolating the 26-menu corpus by
priced-line count, roughly **12-15% of real menus exceed the cap**.

Two corrections to the earlier estimate:

1. **Priced lines over-predict wine count.** Theodora has 328 priced lines but
   only 204 wines and fit comfortably — its 65 pages carry many section headers
   and non-wine lines. Do not size `max_tokens` off priced lines; size it off
   *measured* output tokens.
2. **The 59.3 tokens/wine figure holds.** Theodora measured 11,885 / 204 =
   **58.3 tokens per wine**. That is the number to plan with: a menu over
   roughly **270 wines** will not fit in 16,000 output tokens.

### What this means for the fixes already shipped

The `stop_reason == "max_tokens"` check and the salvage parser in
`scan-parser.service.ts` are **load-bearing for this corpus, not defensive
extras**. Before them, all three truncating menus imported **zero wines
silently** (the cut-off JSON failed `JSON.parse` and the catch returned `[]`).
After them, they import 218 / 285 / 248 wines with a loud error log.

**But partial is still data loss.** RL_Restaurant salvages 218 wines from a
menu whose priced-line count suggests substantially more. Salvage converts a
silent total failure into a visible partial one — it does not solve the limit.

### RESOLVED — adaptive recursive page splitting (shipped)

`ScanParserService` now splits large PDFs into page ranges, extracts each
separately, and merges with a `(producer, name, vintage)` dedupe at the seam.
Measured on RL Restaurant, the densest menu in the corpus:

| Configuration | Wines extracted |
|---|---|
| Original (`max_tokens: 4096`) | **0** — silent failure |
| `max_tokens: 16000` alone | 193 — truncated, salvaged |
| Single-level split (6-page chunks) | 326 |
| **Adaptive recursive split** | **485** (475 uniquely priced) |

485 extracted against 491 priced lines in the text layer is ~99% coverage.

Three design points, each forced by a measurement rather than chosen up front:

1. **Page count cannot decide the split.** RL truncates at 12 pages (~41
   priced lines/page); Theodora fits at 65 (~5/page). So the trigger is
   `stop_reason == "max_tokens"`, not page count — the cap reports itself.
2. **The 60s HTTP timeout had to move first.** A full 16,000-token response
   takes ~100s at Haiku's ~160 tok/s, so the old timeout fired *before*
   truncation was observable, turning a recoverable truncation into a hard
   503. Now 180s.
3. **One split is not always enough.** Even 6-page chunks of RL overflow, so
   the splitter recurses (bounded at depth 3, halving to 2-page chunks) and
   keeps whichever pass recovered more.

Remaining lever, not yet taken: the extraction prompt requests `raw_text`,
persisted to `menu_items.raw_extracted_text`. It raises per-wine output from
~58 to ~84 tokens — roughly **45% of output spend** — and is what pushes dense
menus over the cap in the first place. Dropping it would cut cost and reduce
splitting, but it is a real audit field, so it needs a product decision rather
than a silent removal.

**Latency is now the constraint, not correctness:** 516s for RL Restaurant.
That is acceptable for an async import and reinforces §3 Phase 1 — this work
belongs on the Batch API, not on a synchronous HTTP request.

### Reproducing

```bash
python3 scripts/build_finetune_dataset.py \
    --pdf-dir datasets/annotation_inbox/pdfs \
    --out /tmp/ft --teacher claude-haiku-4-5
```

Records whose `flags` contain `truncated_response` are the affected menus.

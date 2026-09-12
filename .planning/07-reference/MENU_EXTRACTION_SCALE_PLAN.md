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

### 2.2 Unbounded fan-out per menu — RESOLVED
`menus.service.ts` used `Promise.all(items.map(...))` to resolve every wine
against the library with **no concurrency limit**. A 485-wine menu fired 485
simultaneous Supabase round trips; ten concurrent imports meant ~4,850
in-flight queries.

First bounded at concurrency 8, then removed entirely: the fan-out is now a
single batched call (§11). Bounding concurrency was treating the symptom —
485 round trips at 8-at-a-time is still 485 round trips, and it was the round
trips, not the parallelism, that cost 183 seconds.

### 2.3 The library race silently unlinks wines — RESOLVED
`master_wine_library` has a partial unique index on `signature_hash`, so the
race could not create duplicate rows — but the loser of the race threw, was
caught as *non-fatal*, and returned `masterWineId: null`. That wine imported
**with no library link**, so it never matched inventory and never reached
analytics: exactly the silent-error class the requirement forbids.

Worse, the upsert used the default merge-on-conflict. Once every row carries a
signature (see §8), a colliding upsert would have *overwritten* the existing
row — stamping `primary_type` back to `"unknown"` and `library_tier` back to 3
on a curated wine.

Now `ignoreDuplicates: true`, and when the insert is skipped the row is
re-read by signature. Losing the race is expected and handled; the winner's
row is the one we want. A matcher *failure* is now rethrown rather than
downgraded to "no match", because silently treating an outage as "this wine is
new" is what fabricates duplicates.

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

### RESOLVED — `raw_text` removed from the prompt

`raw_text` was requested and persisted to `menu_items.raw_extracted_text` as an
audit trail. It looked like a cost-versus-audit trade. It was not — measurement
showed it was costing accuracy outright.

Method: six real menus, three runs each — **A** with `raw_text`, **B1** without,
**B2** without again. B2 is the point. Comparing A against B alone says nothing
without knowing how much the model disagrees with *itself*, and the first
analysis pass nearly produced a wrong answer for exactly that reason: keyed on
`(producer, name, vintage)` it reported ~0 agreement between two runs of the
identical prompt, which is not a model result but a broken key. The runs found
the same wines and merely phrased `name` differently. Re-keyed on
`(producer, vintage, price)` — what the menu prints, not how it reads:

| | |
|---|---|
| identity agreement A vs B | **0.909** |
| identity agreement B vs B (self-variance) | **0.888** |

Dropping `raw_text` agrees with the original *more* than the original agrees
with its own rerun. The delta is inside sampling noise.

Absolute priced-wine counts on the four menus that fit in one response: **331
with, 331 without.** Identical. Rate-based field completeness looked like a 7pp
price regression, but that was an artifact — B found 9 extra *unpriced* rows on
one menu, which lowers the rate without losing anything. Absolute counts are the
honest measure.

Piccolo Sogno settled it. With `raw_text` the response hit the 16,000-token cap
and returned **122** priced wines; without it the same menu completed at 12,127
tokens and returned **159–173**, against 174 priced lines in the PDF text layer.
The audit field was costing whole wines.

Output cost fell **27–32%** per wine as a side effect.

**The real cost, stated plainly:** `raw_text` *was* faithful — spot-checked
against the PDF text layer it reproduced source lines verbatim apart from smart
quotes. And `restaurant_menus` stores no source file, so nothing else retains
what the menu said. Nothing reads `raw_extracted_text` today, and losing a
whole wine is strictly worse than losing one wine's audit line, so removing it
is right — but the provenance gap is now at the document level. **Retaining the
uploaded file is the correct fix and is not done.** A composed string built
from the other columns would be derivable from its neighbours and therefore
worthless as provenance; it is deliberately not implemented.

### Also fixed: `name` was a coin flip

The old wording let the model choose between `"Merlot"` and `"Duckhorn Merlot"`.
It chose differently between runs of the same menu — Rose Mary returned
`"Santa Lucia Malvasia Istria"` once and `"Kozlović 'Santa Lucia' Malvasia
Istria"` the next time. `name` feeds `master_wine_library.normalized_name`,
which is a **match key**, so that coin flip meant the same wine failed to match
itself across two imports. The prompt now states the rule: name is the cuvée
only, never repeating the producer, never carrying vintage/region/price.

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

---

## 8. VERIFIED: library matching had never worked

Extraction was never the weakest stage. Matching was, and it was worse than the
earlier note in this document claimed.

### The root cause: every wine creation returned HTTP 400

`resolveOrCreateLibraryWine` creates a provisional wine with
`.upsert(payload, { onConflict: "signature_hash" })`, which PostgREST turns
into `INSERT ... ON CONFLICT (signature_hash)`. The only unique index on that
column was **partial** (`WHERE signature_hash IS NOT NULL`). Postgres will not
infer a partial index as an `ON CONFLICT` target unless the statement repeats
the index predicate, and PostgREST cannot emit one. So every insert failed:

```
42P10: there is no unique or exclusion constraint matching the
       ON CONFLICT specification
```

Verified by POSTing that exact payload to PostgREST: **HTTP 400**.

It was invisible because `menus.service.ts` catches resolution failures as
non-fatal and falls back to `masterWineId: null`. The import reported success
while every wine landed with no library link — so no inventory row, and no
analytics. The library is the proof: across 293 rows there is **not one** with
`source = 'menu_import'`.

Fixed in `20260813020000` by making the index non-partial. That is not weaker —
Postgres treats NULLs as distinct in a unique index, so rows without a
signature are still permitted; the index simply becomes inferrable. Re-probed
after the migration: insert `201`, duplicate `201` with `[]`, which the
`ignoreDuplicates` + re-read path in §2.3 handles.

### What was measured on the live library

- **`normalized_name` and `normalized_producer` were NULL on all 293 rows.**
  The fallback lookup compares a value against a universally-NULL column, so it
  could never match. The earlier figure of "201 of 293 unmatchable" understated
  it — via that path *every* row was unmatchable.
- `signature_hash` was set on only 92 rows, all synthetic sim seeds.
- The library already showed the damage: **14 `(name, producer)` groups holding
  2–3 identical rows each** — the same wine re-imported as a fresh provisional
  every time.
- `buildSignature` included `primary_type` from `submitWine` but not from
  `resolveOrCreateLibraryWine`, so **the same bottle hashed two different ways
  depending on which door it came through.**
- The fallback was `.limit(1)` with **no `ORDER BY`**, so when duplicates
  existed the same menu linked to a different row on each import.
- The fallback ignored vintage entirely: a 2018 and a 2019 of one wine
  collapsed onto whichever row came back first.

### What shipped

Three migrations (`20260812000000`, `20260813000000`, `20260813010000`):

1. **Backfill.** `normalized_name` / `normalized_producer` for all 293 rows;
   `signature_hash` recomputed for all of them under one contract with
   `primary_type` removed. 282 keyed, **11 left NULL and reported** — those are
   genuine duplicates that need a human merge, surfaced rather than silently
   collapsed.
2. **One normalization rule in two languages.** `public.wine_normalize_text`
   mirrors the TypeScript normalizer exactly. It deliberately does **not** use
   `unaccent()` (a dictionary fold with different coverage, and not installed
   here) and does not use `pgcrypto.digest()` (installed into the `extensions`
   schema); core `normalize(…, NFD)` and `sha256()` have no such dependency.
   Order matters: combining marks must be stripped *before* non-alphanumerics
   become spaces, or NFD-decomposed `Château` becomes `cha teau`.
   **Cross-checked over all 293 rows × 3 fields: 0 mismatches**, and pinned by
   `wine-submissions.service.spec.ts` so drift fails a test instead of
   producing an unmatchable wine.
3. **`match_library_wine` RPC.** Replaces three PostgREST round trips per wine
   (~1,500 for a 485-wine menu) with one indexed query returning ranked
   candidates.

### Why `word_similarity`, not `similarity`

The library holds two naming styles because two importers wrote it:
`"chardonnay"` and `"2022 olivier leflaive les setilles bourgogne france"`.
Plain trigram similarity penalises the length gap and makes half the library
unreachable:

| probe | `similarity` | `word_similarity` |
|---|---|---|
| `les setilles bourgogne` | 0.438 | **1.000** |
| `jeune blanc` | 0.235 | **1.000** |
| `setilles` | 0.188 | **1.000** |

Best *false* candidate scores 0.238, so the threshold sits in a wide empty band
rather than being tuned to the data.

Name similarity alone is too loose — a bare library name like `"chardonnay"`
matches any verbose probe containing the word. Precision comes from an
independent producer gate. Measured: true producer matches 0.733–1.000, best
false candidate 0.571 (`chateau musar` vs `chateau de bligny` — a shared trade
word). Both gates must clear.

### Confidence, and why it is continuous

The first tier scheme was ordinal buckets, and measuring it exposed the flaw:
the library holds `"2015 Louis Roederer Cristal Champagne"`, and a menu
printing producer `Louis Roederer` / name `Cristal` / vintage 2015 matched it
on every field at similarity 1.00 — and scored **69**, below a bucket meaning
"same name, *wrong* vintage". The fuzzy branch ignored vintage entirely.

Now: `100` for a signature match, otherwise `round(LEAST(name_sim,
producer_sim) × 100)` less `0 / 10 / 30` as vintage agrees, is unknown on one
side, or disagrees. Auto-link at **≥ 85**.

### Measured recall — 847 probes derived from real rows

Each probe is a real library row perturbed the way menus actually print it, so
the correct answer is known for every one.

| perturbation | n | recall | top-1 | median confidence |
|---|---|---|---|---|
| verbatim | 281 | 1.000 | 0.932 | 100 |
| name without glued-on vintage | 227 | 1.000 | 0.952 | 100 |
| producer trade suffix dropped | 71 | 1.000 | 1.000 | 100 |
| producer reduced to first word | 189 | 1.000 | 0.984 | 100 |
| both name and producer reduced | 66 | 1.000 | 1.000 | 100 |
| producer abbreviated (`Dom.`) | 13 | 1.000 | 1.000 | 100 |

Getting there took two fixes and one correction to the measurement itself.

**Abbreviations went from 0.692 to 1.000.** The first figure was also
*optimistic*: it counted candidate recall, and a wider probe over every
abbreviable producer in the library found auto-link recall was **0 of 27** —
`Dom. Faiveley` returned no candidate at all for `Domaine Faiveley`, and
`Ten. di Arceno` scored 62 against `Tenuta di Arceno`. Every one of them
silently created a duplicate. Trigram similarity is simply the wrong
instrument for a prefix truncation: `dom` and `domaine` share two trigrams out
of five however exactly the rest of the name agrees. Fixed in normalization
rather than by lowering the gate — see `20260813060000`.

**Trade-word omission (`Alban Vineyards` printed as `Alban`) scored 0.80**,
just under the floor. Lowering the gate to admit it would also admit
`chateau musar` vs `chateau de bligny` at 0.571. Instead the matcher now
compares producers *both* in full and reduced to their distinctive words. That
moves precision and recall the same direction rather than trading them: the
true cases match exactly, and the false ones get *worse*, because `chateau
musar` and `chateau de bligny` reduce to `musar` and `de bligny`, which share
nothing.

**The last three "misses" were a broken benchmark, not a broken matcher.**
Inspecting them individually showed the perturbation function was stripping
trade words with a naive regex and leaving fragments — `Kavaklıdere  Co.`,
`Alban  "Patrina"`, `Fekete  Somló` — forms no menu prints. Measuring against
inputs that cannot occur says nothing about accuracy. The perturbation now
collapses whitespace and trims, and a harder realistic case
(producer reduced to its first word, 189 probes) was added.

### Measured precision — 1,058 adversarial probes

Recall was measured exhaustively; precision had been measured on seven
hand-picked negatives, which is far too thin to support a claim about false
links. So the hard negatives are built out of the library itself:

| probe family | n | false auto-links | precision |
|---|---|---|---|
| cross-producer (real name, unrelated producer) | 265 | 0 | 1.0000 |
| cross-name (real producer, unrelated name) | 265 | 0 | 1.0000 |
| wrong vintage (same wine, one year off) | 255 | 0 | 1.0000 |
| near-miss producer (one character deleted) | 222 | 0 | 1.0000 |
| **overall** | **1,007** | **0** | **1.0000** |

Getting here took fixing the DATA and fixing the TEST, not the matcher.

The first run scored 0.9981, and both failures were one corrupt seed row
(§below). Repairing it took precision to 1.0000. A later run showed 0.9990,
and that one was the test's fault: some library rows put the cuvée in the
producer field ("Paul Hobbs 'Goldrock Estate'"), so grafting "Paul Hobbs" onto
that wine's name produces a correct description of a real wine, not an
adversarial probe. A probe now only counts as adversarial if its producer is
not simply a terser form of the matched row's.

Cases that could legitimately match — where the library holds the same wine
under both rows — are excluded rather than counted as errors.

### The precision ceiling is the seed data, not the matcher

That row reads:

```
producer  "Antonio Facchin & Figli"
name      "2010 Guiseppe Rinaldi Brunate Barolo"
```

Two different producers. **39 rows share that one producer value** while their
names say Chateau Latour, Vega Sicilia, Shafer, Dal Forno Romano — the
`wineops_basic_v1` seed importer applied one producer across a whole page and
misaligned the vintage column with it (`1966 Chateau Longueville…` carries
vintage 2023).

Measured over the 195 long-form rows from that source — the ones whose name
begins with a year, so the producer *should* appear in it:

| | |
|---|---|
| producer appears nowhere in its own name | **45 (23.1%)** |
| vintage disagrees with the year in its own name | 33 |
| both | 33 |

**No matcher can be more correct than its inputs.** This is the ceiling on
library accuracy until that seed is re-imported, and it is worth naming rather
than absorbing as unexplained match noise.

`library_data_quality_issues()` (migration `20260813100000`) reports these
rows. It deliberately does not fix them: the vintage half is mechanically
recoverable from the name, but the producer half means guessing how many
leading words are the producer, and guessing wrong writes a false producer into
the canonical library. Bare-style rows are excluded — a row named
`CHARDONNAY` with producer `CANUS` is correct and simply does not embed its
producer; counting those flags 96% of the sim seed and makes the number
useless.

### The end-to-end test that reproduces the original bug

Recall against perturbed rows is a proxy. The real question is whether a menu
matches itself on **re-import** — the exact scenario that produced the 14
duplicate groups.

`reimport_roundtrip.py` extracts a menu twice with two independent model calls,
writes run 1 to `master_wine_library` exactly as the service does, then matches
run 2 against it, inside a transaction that is rolled back:

```
Elske_Wine_Menu.pdf: run1=82 wines, run2=82 wines
import #1 created 82 library row(s)
import #2 of the same menu:
  auto-linked           : 82/82  (100.0%)
  review                : 0/82
  new (would duplicate) : 0/82
```

Because run 2 is a separate extraction, this covers the name-phrasing failure
too — under the old prompt the two runs disagreed on whether `name` includes
the producer, and that alone was enough to miss. Measured on the same menu with
the new prompt: **name stability 1.000** over 79 shared wines, and **0 of 82**
names repeat the producer.

### Index shape matters more than the current numbers suggest

The first RPC ORed the signature, exact and trigram tests together. No index
can serve a disjunction, so the planner chose `Seq Scan` — 3.6ms, which looks
fine at 293 rows and is the trap. One import runs this once per wine (485 times
for RL Restaurant); at 1000 restaurants the library is ~300k rows. Rewritten as
a `UNION` of separately-indexable branches, `EXPLAIN` now shows an index scan
on each: unique btree on `signature_hash`, btree on
`(normalized_name, normalized_producer, vintage)`, and a bitmap scan on the GIN
trigram index via `%>`.

One caveat the caller must know: `<%` prefilters using
`pg_trgm.word_similarity_threshold` (default 0.6), **not** `p_min_name_sim` —
Supabase denies `SET pg_trgm.*` on a function at migration time. So 0.6 is a
hard floor and `p_min_name_sim` can only tighten. No measured recall cost: the
perturbations above score 1.000 on name.

### There were four normalizers writing the same columns

Unifying them was not cosmetic — each variant put wines into a key space the
others could not reach:

| location | what it did |
|---|---|
| `wine-submissions.service.ts` | the canonical one, mirrored in SQL |
| `wines.service.ts` | narrower diacritic class; signature joined with `.filter(Boolean)` so empty fields **collapsed instead of holding position**; included `primary_type` and `appellation`; lowercase `"nv"` |
| `menus.service.ts` | `name.toLowerCase().trim()` — folded nothing, so `"Château Margaux"` stayed `"château margaux"` |
| `public.wine_normalize_text` | the SQL mirror |

`wines.service.ts` writes `master_wine_library.signature_hash` directly, so its
variant was actively populating the shared column with unreachable keys. All
three TypeScript copies now delegate to the one implementation, and
`.filter(Boolean)` is gone — dropping empty segments is the exact bug
`vendor-intel/wine-identity.ts` documents at length, because it lets a missing
producer shift the name into the producer's slot.

### Extraction, re-measured with the shipped prompt

Two independent runs per menu, prompt read out of the service so the test
cannot drift from what ships:

| menu | run 1 / run 2 | stop_reason | tok/wine | name stability |
|---|---|---|---|---|
| Elske | 82 / 82 | end_turn / end_turn | 87.6 | 1.000 |
| Piccolo Sogno | 159 / 182 | end_turn / end_turn | 84.4 | 0.993 |
| Elina's | 67 / 67 | end_turn / end_turn | 56.8 | 0.902 |
| Rose Mary | 194 / 198 | max_tokens / end_turn | 82.5 | 0.878 |

Rose Mary is the clearest before/after: under the old prompt **all three** A/B
runs truncated and returned 165–189 wines. It now reaches **198** against 202
priced lines in the text layer, with one of the two runs completing cleanly.

On "name repeats the producer": Elina's flags 15 of 67, but 13 are
`name == producer`, which is the prompt's own fallback for spirits and
single-name items ("Monkey Shoulder", "Hendrick's") and is harmless for
matching — both sides agree. The genuine violation rate is 2/67.

## 9. RESOLVED: the 11 duplicates are merged

`merge_library_wines(keeper, loser)` (migrations `20260813030000`,
`20260813040000`) collapses a duplicate safely. "Safely" is carrying weight:

- **15 columns across 15 tables** reference `master_wine_library.id`, and five
  of those FKs are `ON DELETE CASCADE`. Deleting a duplicate without repointing
  first silently deletes a restaurant's inventory.
- **Seven referencing tables** carry UNIQUE constraints that include the FK
  column, so a blind repoint raises 23505 part-way through.
- **`restaurant_inventory` cannot be repointed at all.** It is UNIQUE on
  `(restaurant_id, master_wine_id)`, and measured on all 11 duplicates the
  keeper and loser hold stock *in the same restaurant every time*. Those rows
  have to be merged.

FKs are discovered from the catalog, not listed in the function. A hard-coded
list is wrong the moment someone adds a referencing table, and wrong silently —
which is the failure mode this entire line of work exists to remove.

Stock is never written directly: `inventory_lots` is the source of truth and
`stock_live` is a projection maintained by `trg_project_stock_from_lots` (see
`scripts/check_no_direct_stock_writes.sh`), so the merge moves lots and lets
the trigger recompute. Summing `stock_live` by hand would both violate that
contract and drift from the lots.

Dry run is the default, performs the real work, and rolls back — a dry run
that only predicts is worthless on an operation whose risk lives in the parts
you did not predict. The step log travels out in the exception `DETAIL`,
because `RETURN NEXT` rows do not survive the rollback.

**Result: 293 → 282 rows, 0 unkeyed.** Every keeper's post-merge lot total
matched the prediction captured beforehand, `stock_live` agreed with the lots
on all 11, and the global invariant held — **1,103 bottles before and after**.
A merge must move bottles, never create or destroy them.

## 10. RESOLVED: enrichment dispatch is wired

`research_agent_task` only ever ran when a human POSTed
`/api/v1/research/trigger`. Nothing dispatched it for wines created by an
import, so a restaurant could import a 485-wine list and every unmatched bottle
would sit as a tier-3 stub forever. `research.dispatch_batch` now runs hourly
at `:30`.

It deliberately does **not** reuse the endpoint's batch query, which selects any
submission with `last_research_run_at IS NULL`. That was defensible when
nothing matched; now that matching works, an import creates a submission for
*every* wine including ones that auto-linked to fully-populated canonical rows,
so that query would spend the daily budget re-deriving facts the library
already holds. Selection moved to `research_eligible_submissions()`, which
returns only wines still carrying no real data — and orders them emptiest
first, because with a daily cap the sort order *is* the budget.

**Off by default** (`RESEARCH_DISPATCH_ENABLED=false`). Enabling it starts
recurring billable outbound web searches, which is a spend decision rather than
a deployment detail. The existing per-record ($0.04) and daily ($5.00) ceilings
still apply once on.

## 11. Matching is now one round trip per menu, not per wine

`match_library_wine` runs in single-digit milliseconds off its indexes. That
was never the cost. Against the pooler each *call* is ~320–380ms, almost
entirely network, and the importer made one per wine.

| | 485 wines |
|---|---|
| per wine | 183.12s (378ms each) |
| batched | **0.91s** |
| | **202×** |

`match_library_wines_batch` takes the menu as JSON and returns one row per
input, in input order. Ordinality is the join key rather than name, because the
same wine legitimately appears twice on a menu — by the glass and by the bottle
— so position is the only correct alignment. An import is now three statements
regardless of size: match, bulk-insert whatever matched nothing, read back.

The read-back is load-bearing: `ignoreDuplicates` omits rows a concurrent
import already created, and those are exactly the ones still needing ids.
Wines sharing a signature within one menu are inserted once and fanned back
out, rather than letting Postgres reject the statement for touching one
conflict target twice.

A whole-batch failure is now fatal. Per-wine failures used to be caught as
non-fatal and become `masterWineId: null` — which is how an import reported
success while linking nothing.

## 12. Duplicate finding, and why it does not auto-merge everything

`find_library_duplicates()` reuses `match_library_wine` rather than
reimplementing similarity. That is not just convenience: a finder with
different rules from the importer would report pairs the importer never
creates, or miss the ones it keeps creating. It is bounded by index lookups per
row, not the O(n²) pairwise form — 45 billion comparisons at 300k rows.

It found **30 pairs the signature index cannot see**, since a duplicate that
survived did so precisely by differing somewhere ("Massican" vs "Massican
Winery").

But the matcher is deliberately forgiving so a menu line reaches its wine, and
that forgiveness is **wrong** for deciding whether two *library rows* are one
wine. So pairs are classified:

| kind | meaning | action |
|---|---|---|
| `identical` | differ only in punctuation, case, accents | safe to merge |
| `name_extends` | one name's words are a superset — a cuvée or vineyard | review |
| `fuzzy` | similar but neither contains the other | review |

That distinction earned itself immediately. **`Ultramarine … Blanc de Noir` vs
`Blanc de Blancs` scored 88.** Those are different wines — red grapes versus
white — and an unattended merge would have destroyed one.

15 `identical` merges applied: 282 → 267 rows, **1,103 bottles before and
after**. 10 pairs left for a human. Merging also lifted top-1 ranking
(verbatim 0.932 → 0.985), because fewer near-identical rows compete for first
place.

## 13. Enrichment cost: the cap is the constraint, and caching cannot fix it

Research is billed per record ($0.04 ceiling) under a $5.00/day cap — ~125
records/day. At 1000 restaurants × ~300 wines that is 300,000 records:
**$12,000, and 6.6 years to clear at the cap.**

The obvious hope is that restaurants carry the same wines so the library
amortises the work. Measured on four real extracted lists, they do not:

| | |
|---|---|
| cross-menu bypass rate | 0.0%, 0.5%, 2.0% |
| wines per producer | 1.3 |
| producers shared across 4 menus | 18 of 419 |

Independent wine lists barely overlap — that is the *point* of a wine list. So
caching, producer-level rollups and dedup cannot close a 6.6-year gap; they
were never going to. This document previously assumed the opposite; measuring
it showed that was wrong.

Re-importing the **same** menu does bypass at 100% (verified end to end), which
is what makes menu updates free. That is a real saving but a different one, and
it does not touch first-import volume.

What does close the gap is not researching wines nobody sells:

| | records | cost | time at the same cap |
|---|---|---|---|
| everything | 300,000 | $12,000 | 6.6 years |
| top 30% by demand | 90,000 | $3,600 | 2.0 years |
| top 15% by demand | 45,000 | $1,800 | 1.0 years |

`research_eligible_submissions` is therefore ordered by demand — sold in the
last 30 days, then has sold, then in stock, then carried, then not carried.
Nothing is excluded; a wine with no stock is still researched eventually. But
with a hard daily cap **the order is the budget**, and the wine a sommelier was
asked about this week should not wait behind 200 bottles nobody has poured.

**This still needs a decision:** even at top-15% the backlog is a year. Either
the daily cap rises, or enrichment stays demand-gated and the long tail is
simply never enriched. That is a spend question, not an engineering one.

### Still open

- **Enrichment spend needs a decision** — see §13. Demand ordering makes the
  budget go to the right wines; it does not make 300,000 records fit in
  $5.00/day.
- **10 duplicate pairs** await a human: `SELECT * FROM find_library_duplicates()
  WHERE NOT safe_to_merge;`
- **`embedding` is 0/267**, so the pgvector similarity bypass is unavailable.
  The trigram matcher covers the lexical case; embeddings would cover the
  semantic one (a menu naming a wine by its grape where the library names it by
  its cuvée).
- **`processPendingSubmissions` still uses `.limit(1)` with no `ORDER BY`** and
  exact-equality name matching. It now benefits from the backfilled columns,
  but it should move to `match_library_wine` for the same reasons the import
  path did.
- **The source menu file is still not retained**, so provenance for a scanned
  menu rests on the extracted fields alone (see §7).
- **Import is still synchronous.** RL Restaurant takes 516s. Correctness is no
  longer the constraint; latency is. That is §3 Phase 1, the Batch API.

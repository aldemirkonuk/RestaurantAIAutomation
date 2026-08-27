# Handoff — P3.B, beverages first: the oracle, and two defects it uncovered

> Stage record for **P3.B** ([ADR 0029 §2](../decisions/0029-p3-plan-of-record.md)).
>
> This branch **does not touch** `.planning/decisions/OPEN-DECISIONS.md` or
> `.planning/decisions/CLAIMS.jsonl` — a concurrent session owns both this
> session, and adding one register row re-anchors citations across two dozen
> files ([ADR 0025](../decisions/0025-citations-must-disagree-loudly.md)). The
> rows and claims it proposes are §5 and §6 below, for the founder to apply
> centrally.
>
> **Retire-to-write (CLAUDE.md §4).** This document proposes nothing new to
> retire on its own account: it is the stage record for one ADR 0029 stage and
> follows the same `HANDOFF-*.md` convention as the five already in
> `04-specs/`. It should be **merged into ADR 0029's consequences and deleted**
> when P3.B closes, the same way `HANDOFF-schema-guard.md` folds into ADR 0026.

---

## 1. What P3.B's exit criterion asked for, and what was actually there

ADR 0029 §5: *"beverage extraction runs on the same graded basis as wine, with
the verdict reaching the footprint."*

Measured first, before building, because this corpus has repeatedly described
things that were never built:

| Claim in the docs | Measured 2026-08-27 |
|---|---|
| a beverage extraction path exists | **False.** 31 distinct Python `task_type=` literals and 7 in the gateway; **none names a beverage**. The closest are `wine_*`, `menu_page_extraction` and `menu_scan`, all wine-shaped |
| `public.beverages` has a writer | **False.** The table is real (`supabase/migrations/20260817070000_beverages_table.sql:217`, 40+ columns, identity key, views, RLS). Its only writers are two offline scripts, `scripts/migrate_beverages.py:96` and `scripts/populate_embeddings.py:123` |
| non-wine beverages are therefore ungraded | **False, and worse.** They *are* graded — as **success** — by a validator that examined nothing. §2 |

So "beverage extraction on the same graded basis as wine" could not mean
"port the wine grader across": there is no second pipeline to port it to, and
the grader on the existing one is not sound for these rows. Non-wine beverages
already flow through the *wine* pipeline — that is why
`20260817060000_beverage_kind_classification.sql` had to add a `beverage_kind`
column to `master_wine_library` in the first place.

## 2. The defect this lane exists to have found

`OntologyValidationService.run_ontology_validation()` hard-codes

    checks_total = 4          ontology_validation_service.py:585

and each of its four checkers returns `None` — indistinguishable from
"passed" — when the field it needs is absent
(`:118`, `:183`, `:249`, `:328`). A single-malt Scotch has no appellation, no
grape, no vintage and no colour, so all four rules skip, `checks_failed` is 0,
and `ontology_verdict(4, 0, 4)` returns **success**.

Reproduced against the real service with a mocked client, on
`"Lagavulin 16 Year Old"`:

```
RESULT:  checks_passed=4  checks_failed=0  checks_total=4  failures=[]
VERDICT: {'outcome': 'success',
          'evidence': {'checks_passed': 4, 'checks_failed': 0, 'checks_total': 4}}
```

`ontology_verdict`'s own docstring anticipates exactly this — *"a wine with
three empty fields would otherwise score identically to one that satisfied
every rule"* — and guards it with a `checks_total == 0` branch. **That branch
is unreachable from the live caller**, because the caller's `checks_total` is a
constant. The strongest grader in the tree stamps a fabricated success on every
row it cannot examine, and every non-wine beverage is such a row by
construction.

This is ADR 0029 §6.1 arriving early: *"a coverage number that looks like
grading and is still mostly shape-checking"* — except it is worse than shape
checking, because a shape check at least ran.

**Not fixed on this branch.** Fixing it properly means changing the four
checkers' return contract from `Optional[failure]` to something that separates
*skipped* from *passed*, which rewrites ~20 assertions in
`tests/test_ontology_validation.py` and is a wine-path operation, not a
beverage one (CLAUDE.md §2, one operation per branch; ADR 0029 §6.2, the lanes
must not drift into each other's queue). Proposed as an ADR in §5.

## 3. The second defect: `ontology_v1` never wrote a verdict at all

Found while writing the beverage twin of `grade_wine_extractions`, because the
twin copied the same line.

`services/ontology_verdict.py` filtered the NF query as

```python
.eq("context->>wine_id", str(wine_id))     # correct — a JSON path
.in_("task_type", list(GRADABLE_TASK_TYPES))   # WRONG — not a column
```

`task_type` has never been a column on `neural_footprint_event`. The table
declares `id / subject_type / subject_id / stimulus / context / internal_state
/ choice / outcome / cost_usd / input_tokens / output_tokens / duration_ms /
correlation_id / restaurant_id / occurred_at` and nothing else
(`supabase/migrations/20260824141116_neural_footprint_event.sql`).
`spend_logger.py:395` writes the task type **into `context`**, and
`nf_a_verdict_coverage` reads it back as `e.context->>'task_type'`
(`20260825180000_nf_verdict.sql:172`).

PostgREST rejects a filter on a column that does not exist. The surrounding
`try/except` in `grade_wine_extractions` then logs it as a non-fatal warning —
so the grader wrote **zero verdicts and reported nothing wrong**. That is this
repository's signature defect (machinery that structurally cannot report
failure) inside the instrument built to detect it, shipped hours earlier in
PR #124.

**Fixed on this branch**, one line, at `services/ontology_verdict.py:124`.

*Honest limit on this claim:* the production consequence is inferred from three
schema citations, not observed — this session has no production access and did
not query it. What is directly demonstrated is the query shape: the guard test
in §4 fails against the pre-fix tree and passes after.

## 4. What shipped

All inside `services/agent-orchestrator/**`. **No migration** — `nf_verdict.basis`
is free text and `nf_a_verdict_coverage` groups by it, so a new basis needs no
schema change. No new model call sites, so
`scripts/check_task_types_are_graded.py` needs no new exemption.

| File | What it is |
|---|---|
| `services/beverage_ontology.py` *(new)* | Five hard rules for non-wine beverages, pure functions, no I/O. `checks_total` **counts the rules that ran** |
| `services/beverage_verdict.py` *(new)* | `beverage_ontology_verdict()` + `grade_beverage_extractions()`, writing basis `beverage_ontology_v1` as an `(event_id, basis)` sidecar |
| `jobs/ontology_tasks.py` | Wires the beverage grader into the existing deferred rail, beside `ontology_v1` |
| `services/ontology_verdict.py` | The §3 one-line fix |
| `tests/test_beverage_ontology.py` *(new)* | 50 tests |
| `tests/test_beverage_verdict.py` *(new)* | 17 tests, including the §3 regression lock |

### 4.1 The rules, and why each is admissible

The bar is the one `ontology_v1` set: provable with no human in the loop.

| Rule | Ground truth | Severity |
|---|---|---|
| `abv_proof` | US proof is *defined* as twice ABV (27 CFR 5.1). Arithmetic | critical |
| `abv_category` | A distilled spirit at 4.5% ABV is not a distilled spirit | critical |
| `protected_origin` | Bourbon must be made in the USA (27 CFR 5.22(b)(1)(i)), Scotch in Scotland, Cognac in France, Tequila in Mexico. Law, not taste | critical |
| `age_statement` | A bottle whose name says "16 year old" while `age_years` says 12 contradicts itself | critical |
| `volume_unit` | A 0.75 ml bottle is a unit error | warning |

Three design choices that a later reader will otherwise want to undo:

- **Every rule is self-grounding.** None reads a classification column. The
  first draft keyed the ABV band on `beverage_kind`, which would have been a
  second home for the classifier `20260817060000_beverage_kind_classification.sql`
  already owns in PL/pgSQL. Each rule now fires only on positive evidence in the
  row's own text plus the number it needs.
- **Bare integers are never read as ages.** `BEVERAGE_CATALOGUE_ARCHITECTURE.md:190`
  measured what that costs: *"`Weller 107` is a proof, `Macallan 12` is an age"*.
  Only an explicit unit counts.
- **Wine rows get no verdict at all**, not an untestable one.
  `applies_to_row()` returns `False` on a grape, an appellation or a four-digit
  vintage, and `grade_beverage_extractions` then returns `None` rather than `0`.
  An untestable verdict still counts as *graded* in `nf_a_verdict_coverage`, so
  emitting one per wine would inflate the only number that currently reports
  coverage honestly.

### 4.2 What the disagreement buys

Where both graders touch one event, the sidecar keeps the disagreement instead
of resolving it: `ontology_v1 = success` and `beverage_ontology_v1 = null` on
one Scotch is §2's defect as a queryable row rather than a sentence in a
document nobody re-reads. `nf_verdict`'s own comment is explicit that this is
what a second basis is for.

### 4.3 Coverage will start low, and that is the honest result

`BEVERAGE_CATALOGUE_ARCHITECTURE.md:122` measured discriminator coverage on
spirit rows at **13% age, 10% cask, 0% proof, 0% volume**. Enrichment writes
`alcohol_pct` (`haiku_enrichment_service.py:74`) but not `proof`, `age_years`
or `volume_ml`, so on today's data the rules that can usually run are
`abv_category` and `protected_origin`, and many rows will come back
`null`/untestable.

That is the point. Today those rows return `success`. After this they return
"nothing could be checked", which is true, and coverage rises as extraction
starts capturing ABV, proof and volume — a measurable target rather than a
number that was always already 100%.

## 5. Proposed ADR — not written, because it is a decision

**"Skipped is not passed: a checker must report which rules ran."** §2's fix.
The fork the founder owns is the blast radius: changing the four wine checkers'
return contract touches `ontology_validation_service.py` and ~20 assertions in
`tests/test_ontology_validation.py`, and it changes the meaning of
`checks_total` in every `ontology_validation` JSONB already written to
`master_wine_library_submissions`. Those historical payloads are not rewritten
by any option — they are already wrong; the question is only whether new ones
stop being.

## 6. Proposed register rows and claims — apply centrally

**`OPEN-DECISIONS.md`** — two rows, both verified against the tree today:

- *`ontology_v1` counts skipped checks as passed.* `ontology_validation_service.py:585`
  hard-codes `checks_total = 4`; the four checkers cannot distinguish
  skip from pass (`:118`, `:183`, `:249`, `:328`). Fixing it is §5's ADR.
  **Status: open.**
- *`public.beverages` still has no application writer.* Verified: only
  `scripts/migrate_beverages.py:96` and `scripts/populate_embeddings.py:123`.
  The catalogue is built and dormant, the same shape as NF-B in ADR 0029 §3.
  **Status: open.** This is the next P3.B increment, not a defect.

**`CLAIMS.jsonl`** — one claim under id `ADR-0029`, `status: resolved`:

```
neither ontology grader filters a bare `task_type` column
  cmd: cd services/agent-orchestrator && python3 -m pytest \
       tests/test_beverage_verdict.py -k TaskTypeFilter -q
```

Proven to fail against the pre-fix tree before it was written (memory:
*solve it once = add a guard*). Deliberately a pytest selection rather than a
new `scripts/check_*.py`: the invariant is "this call builds this query", which
a test asserts directly and a grep-based guard could only approximate.

## 7. What was deliberately not done

- **No new extraction pipeline.** No beverage `task_type` is emitted, no model
  is called on a beverage-specific prompt, `public.beverages` still has no
  application writer. The oracle grades the rows the existing wine pipeline
  already produces.
- **§2 not fixed** — §5, and the reason is scope, stated rather than hidden.
- **No migration, nothing applied to production.** Nothing here needs one.
- **Not verified against production data.** No live query was run, so the *rate*
  at which each rule fires on the real corpus is unknown. Every number in this
  document is from the tree or from a local test run.
- **The `LOOKBACK_HOURS = 24` constant in `ontology_verdict.py` is still dead**
  — declared, documented, never used in the query. Noticed, left alone: it is
  wine-path, and it is cosmetic next to §2 and §3.

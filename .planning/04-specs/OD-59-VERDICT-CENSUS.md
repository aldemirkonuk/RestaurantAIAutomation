# OD-59 — Doneability verdict census

> **Status:** research output, no code changed. Every claim below carries a
> `file:line` verified against the worktree at `feat/od-59-doneability`
> (base `origin/main`, read 2026-08-25).
>
> **Question answered:** for every NF-A emit point, does a machine-checkable
> ground truth *already exist* downstream, is it knowable synchronously, and
> what is the cheapest honest verdict if not?
>
> **Scope note:** this is a census, not a recommendation. It does not pick the
> opener — that is OD-59 and the founder's call.
>
> **Provenance warning — all citations are against `HEAD` (`fdaa7fa0`), not the
> working tree.** A concurrent session is editing this same worktree and has
> uncommitted changes to `model-client.service.ts`, `document-extractor.service.ts`
> and `parsed-document.ts`, plus new untracked files
> (`common/model-client/nf-verdict.service.ts`,
> `procurement/documents/reconciliation-verdict.ts`,
> `supabase/migrations/20260825180000_nf_verdict.sql`,
> `.planning/04-specs/OD-59-READOUT-AUDIT.md`). Three citations in an earlier
> draft of this file reflected those in-flight edits and have been corrected to
> `HEAD`. **Someone appears to be implementing a `document_extraction`
> reconciliation verdict already** — reconcile this census against that work
> before acting on it, and re-verify line numbers, which will drift.

---

## 0. Corrections to the record

Three claims in circulation are wrong or imprecise. Filed first because the
rest of the document depends on getting them straight.

### 0.1 `invoice_extraction` EXISTS — but not where EVA-Q1 thinks

`evaluation-doneability-questions.md` §EVA-Q1 proposes `invoice_extraction` as
the opener and justifies it with *"Extracted line items either reconcile to the
invoice total or they do not."*

Both halves are individually true and they do not describe the same task type.

| | |
|---|---|
| `invoice_extraction` | **REAL.** `services/agent-orchestrator/agents/visual_verification_agent.py:648`. Haiku extracting invoice fields from **email body text**. Has **no tie-out**. |
| `document_extraction` | **REAL.** `apps/api-gateway/src/procurement/documents/document-extractor.service.ts:135`. Vision extraction of a PDF/image procurement document. **This** is the one with the reconciliation. |

The reconciliation EVA-Q1 describes is `applyTieOut()`
(`apps/api-gateway/src/procurement/documents/parsed-document.ts:104`), and it is
reachable only from `document_extraction`. A correction filed as "the task type
does not exist" would also be wrong — it exists, on a different runtime, in a
different language, with a different downstream. Both halves of the confusion
matter: picking `invoice_extraction` on the strength of the tie-out argument
would ship a verdict basis that the chosen path cannot produce.

`invoice_extraction` *does* have a ground truth of its own —
`_compare_invoice_to_order()` at `visual_verification_agent.py:664`, which
compares invoice totals, quantities and vintages against the stored order — but
see §3.9: it is not wired to the path that emits the NF row.

### 0.2 The call-site count is 50, not 35

EVA-Q1 says *"a definition covering all 35 call sites"*. Verified counts:

| | Count | Note |
|---|---|---|
| TypeScript `nf: { taskType }` blocks | **7** | `grep -rn "taskType" apps/api-gateway/src --include="*.ts"` returns 9; two are the interface field (`model-client.service.ts:74`) and the write (`:346`). |
| Python `task_type=` grep hits | 38 | |
| — minus docstring example | −1 | `services/spend_logger.py:41` is usage documentation, not a site. |
| — minus **false positive** | −1 | `provider_conversation_agent.py:1219` is `genai.embed_content(task_type="retrieval_document")` — the **Gemini API's own parameter**, not an NF task type. Anyone counting by grep will over-count here. |
| = real Python emit statements | **36** | |
| — of which are shared helpers | −4 | see §0.3 |
| — plus resolved helper callers | +11 | |
| **Effective Python emit points** | **43** | |
| **Total emit points** | **50** | |
| **Distinct `task_type` strings** | **46** | 7 TS + 39 Python |

### 0.3 Four Python `task_type=` sites are helper pass-throughs

These resolve to eleven distinct literals at their callers. A census by grep
alone reports four opaque `task_type=task_type` and misses nine task types.

| Helper | Callers → literal |
|---|---|
| `provider_conversation_agent.py:946` | `:980` → `intelligence_extraction`; `:1952` → `draft_response`; `:2164` → `session_summary` |
| `email_parsing_agent.py:393` | `:453` → `order_matching`; `:580` → `thread_summary` |
| `sommelier_agent.py:441` | `:487` → `query_interpretation`; `:566` → `wine_response`; `:676` → `wine_enrichment_grounded`; `:700` → `wine_enrichment_fallback` |
| `email_composer_service.py:461` | `:483` → `style_analysis`; `:609` → `email_compose` |

### 0.4 Verified TRUE

- **`@Cron */5` on document intake** — `apps/api-gateway/src/procurement/documents/document-intake.service.ts:581`, `@Cron("*/5 * * * *", { name: "procurement-document-intake-sweep" })`. EVA-Q1's volume argument holds *for `document_extraction`*.
- **`outcome_basis: "call_level_v0"`** is written on every graded row from both runtimes — `model-client.service.ts:347` (TS) and `neural_footprint.py:32,94` (Python).
- **`call_level_v0` already declines to call truncation success** — `model-client.service.ts:319-325` grades `stop_reason: "max_tokens"` as `partial` and `"refusal"` as `failure`.

---

## 1. The blocking defect: ~10 Python sites emit BEFORE they parse

This is not a doneability *design* question — it is a correctness bug in the
instrument that any doneability work inherits, and it systematically biases the
existing numbers toward `success`.

At these sites the `spend_logger.log(..., outcome="success")` call is placed
*above* the `json.loads` / `model_validate_json` that can still fail. A model
that returned prose instead of JSON is recorded as a **success**:

| Site | Emit | Parse that can still fail |
|---|---|---|
| `agents/rfq_agent.py` | `:470-481` | `json.loads` `:488` |
| `agents/calendar_agent.py` | `:239-251` | `json.loads` `:261` |
| `agents/email_intel_agent.py` | `:324-336` | `json.loads` `:341`, `EmailClassification(**data)` `:342` |
| `agents/email_intel_agent.py` | `:591-603` | `json.loads` `:614`, `PromoDetails(**data)` `:615` |
| `agents/provider_conversation_agent.py` | `:980-985` | fence strip + parse `:987+` |
| `services/haiku_enrichment_service.py` | `:233-245` | `json.loads` `:258` (raises `ValueError`) |
| `services/wine_matcher.py` | `:587-598` | `json.loads` `:608` |
| `services/wine_field_parser.py` | `:592-602` | `json.loads` `:615` |
| `services/web_verification_service.py` | `:242-253` | `model_validate_json` `:258` |
| `services/auction_wine_service.py` | `:140-151` | `_parse_ai_response` `:156` |

**Two sites get it right, deliberately**, and their comments say why — the
pattern to copy:

- `agents/visual_verification_agent.py:606-651`: *"tokens were spent the moment the call returned, so the spend log must NOT sit behind json.loads"* — parses first into a `parse_failed` flag, then emits on **both** outcomes with `outcome="partial" if parse_failed else "success"`.
- `services/claude_vision_extractor.py:490` → `:509`: `parsed, parse_error = parse_json_response(raw_text)` then `outcome="partial" if parse_error else "success"`.

**Consequence for OD-59:** for ten task types, moving the emit below the parse
is *both* the bug fix and a free upgrade from `call_level_v0` to a real
`parse_v1` basis. It costs nothing extra and it is a prerequisite for trusting
any richer verdict layered on top.

---

## 2. TypeScript call sites (7)

All route through `ModelClientService.call()`
(`apps/api-gateway/src/common/model-client/model-client.service.ts`), which owns
the `neural_footprint_event` insert at `:371` and grades outcome at `:319-325`.

### 2.1 `document_extraction`

- **Site:** `apps/api-gateway/src/procurement/documents/document-extractor.service.ts:135`
- **Ground truth:** **YES — the strongest in the codebase.**
  `applyTieOut()` at `parsed-document.ts:104`. Sums line totals plus charges
  (freight, fuel surcharge, split-case fee, delivery fee, deposits, tax, other
  charges, minus discounts) and compares to the stated total. Tolerance is
  `Math.max(1, doc.lines.length)` cents (`parsed-document.ts:137`) — one cent
  per line, because vendors round per line and the rounding accumulates.
  Returns `tiesOut: true | false | null`, where **`null` is "untestable", not
  "failed"**: `parsed-document.ts:124-133` explicitly refuses to call a document
  with no stated total a tie-out failure, on the reasoning that doing so *"would
  train people to ignore the flag."*
- **Synchronous?** **YES.** `applyTieOut` runs at `document-extractor.service.ts:267`
  inside `normalize()`, which is called at `:146` on the return path of the same
  method that made the model call. The verdict is on the object the call site
  already holds. **No new computation is required — only plumbing.**
- **Second, deeper verdict (deferred):** `computeMatch()` at
  `apps/api-gateway/src/procurement/invoice-match.ts:149`, with
  `isDiscrepancy()` `:402` and `isClaimable()` `:412` — a three-way match of the
  document against PO and receiving records. Catches what tie-out cannot (right
  arithmetic, wrong vendor/SKU). Deferred: needs a PO and a receiving record to
  exist.
- **Confidence coupling already exists:** `document-extractor.service.ts:268-271`
  drops confidence to ≤0.35 when `tiesOut === false`, and
  `document-intake.service.ts:270-275` routes `tiesOut === false` to
  `status: "needs_review"`. The verdict is already load-bearing in the product;
  it is simply not written to the NF row.
- **Proposed basis:** `reconciliation_v1`. Narrower than "done" — arithmetic
  consistency only. `tiesOut: null` must map to NF `outcome: NULL`
  (unknown), never `success`.

### 2.2 `vendor_page_extraction`

- **Site:** `apps/api-gateway/src/vendor-intel/vendor-page-extractor.service.ts:218`
- **Ground truth:** **YES, partial.** `normalizeExtraction()` at
  `vendor-page-extraction.ts:248`, called at `vendor-page-extractor.service.ts:233`.
  Per-row `validateItem()` produces `items` vs `rejected[]` with reasons, and
  `vendor-page-extraction.ts:313-318` raises an explicit warning when
  `rejected > rows.length / 2`: *"treat this page's parser as broken rather than
  the catalogue as small."* That threshold is already a stated failure verdict.
- **Synchronous?** **YES**, ~15 lines after the call.
- **Cheapest honest verdict:** `failure` on non-JSON or no recognisable item
  array (`:264`, `:280`), `partial` when the >50% rejection warning fires,
  `success` otherwise. **Basis: `parse_yield_v1`.**
- **Caveat:** a genuinely empty catalogue page and a broken parse are
  indistinguishable at zero items. The existing `skippedReason` field carries
  the distinction for fetch failures but not for this.

### 2.3 `inbound_email_response`

- **Site:** `apps/api-gateway/src/common/orchestrator/inbound-responder.service.ts:753`
- **Ground truth:** **YES, shallow.** `parseAnalysis()` at `:766` returns `null`
  on non-JSON, on a missing `{`/`}`, or when `reply_body` is absent or not a
  string (`:779`). A `null` here means the whole call produced nothing usable.
- **Synchronous?** **YES** — `:757` calls it directly on the payload.
- **Deferred, and the real one:** `computeGuardrails()` at `:826` computes
  `needs_approval` from commitment language, price-above-target, quantity/budget
  change, round count and sender trust. Beyond that, the human approve/send
  decision is the genuine verdict. Per the project's own rule the system
  **never auto-sends**, so "the draft was sent" is always a human-gated,
  deferred signal.
- **Cheapest honest verdict:** `failure` when `parseAnalysis` returns `null`,
  else `success`. **Basis: `parse_v1`.** A `approval_v1` re-grade path against
  the approve/dismiss record is the honest version and needs a deferred join.

### 2.4 `menu_scan`

- **Site:** `apps/api-gateway/src/menus/parsers/scan-parser.service.ts:315`
- **Ground truth:** **Partial.** `parseJsonResponse(content)` at `:326` plus the
  `truncated` flag at `:332` (`stop_reason === "max_tokens"`). Truncation is
  already `partial` at call level and is *load-bearing* — the caller re-runs the
  PDF split into page ranges off that flag.
- **Synchronous?** **YES.**
- **Weakness, stated plainly:** `items.length === 0` cannot distinguish "this
  menu had no wines" from "the parse failed" — the comment at `:329-331` names
  exactly this as the historical bug. A page-count-vs-items heuristic would be a
  guess, not a verdict.
- **Cheapest honest verdict:** keep truncation as `partial`; add `failure` when
  `parseJsonResponse` yields zero items **and** the response was non-empty and
  untruncated. **Basis: `parse_yield_v1`.**
- **Deferred upgrade available:** `QualityScorer._cross_validate()` at
  `services/agent-orchestrator/services/quality_scorer.py:231` checks whether
  extracted wine names actually appear in the OCR text — a genuine machine
  ground truth for menu extraction. It is a different runtime; joining it to
  the TS `menu_scan` row is a re-grade path, not a same-request write.

### 2.5 `photo_count`

- **Site:** `apps/api-gateway/src/inventory/photo-count.service.ts:89`
- **Ground truth:** **NO — and the honest one is not reachable today.**
  `parseResponse()` at `:115` yields `suggestedQty: null` + `confidence: "low"`
  when the model declines or returns non-JSON. That is a *declination* signal,
  not a correctness verdict.
- **The real ground truth exists in the world but is not recorded:** the human's
  committed count. `inventory.service.ts:424-427` states the design explicitly —
  *"a vision suggestion only. Never writes anything; the caller drops the result
  into the same quantity field the voice path fills, and the human still has to
  call `recordSpotCount`."* The suggestion is returned to the client at
  `inventory.service.ts:460` and **never persisted**, so there is nothing to
  join the eventual `recordSpotCount` against.
- **Cheapest honest verdict today:** `failure` when `suggestedQty === null`,
  else `outcome: NULL` (unknown). Anything stronger is a lie.
- **What a real verdict costs:** persist `(nf_event_id, suggested_qty)` at
  suggestion time, then re-grade against the committed count. Machine-checkable
  once that link exists — `|suggested − committed| <= tolerance`. This is the
  one task type where a small, well-defined *write* unlocks an exact verdict.

### 2.6 `consultant_analysis`

- **Site:** `apps/api-gateway/src/analytics/consultants.service.ts:183`
- **Ground truth:** **NO.** Refusal is caught at `:193` and JSON parse at
  `:200-206`, both shape-only. The output is 3–8 weighted claims, and the
  service's own disclaimer at `:214` concedes they are *"LLM interpretations of
  deterministic analytics"* requiring verification against cited evidence.
- **Cheapest honest verdict:** `failure` on refusal or non-JSON; `partial` when
  `claims.length` falls outside the requested 3–8; `success` otherwise.
  **Basis: `schema_v1`.**
- **Does it need a human rubric?** **YES**, for anything past shape. One cheaper
  machine check is available and does not exist: each claim carries
  `evidence_refs`, and those could be validated against
  `Object.keys(evidence)` — a claim citing evidence that was never supplied is
  machine-detectably wrong. That is a *grounding* check, not a correctness one,
  but it is the only non-human signal on this task type.

### 2.7 `ux_proposals`

- **Site:** `apps/api-gateway/src/ux-optimizer/ux-optimizer.service.ts:282`
- **Ground truth:** **NO.** `:295-308` parses JSON and filters rows lacking
  `targetKey` / `title` / `kind`, then caps at 5. Shape only.
- **Cheapest honest verdict:** `failure` on non-JSON or zero surviving
  proposals; `success` otherwise. **Basis: `schema_v1`.**
- **A cheap machine check that does not exist:** the prompt at `:257` constrains
  `kind` to `copy | default | surface | affordance | layout` and demands *"a
  stable target_key"*, but `:303-305` accepts any string for both. Validating
  `kind` against the enum and `targetKey` against observed friction keys would
  be machine-checkable grounding. Correctness ("did this proposal actually
  reduce friction") is an A/B outcome — deferred by weeks, and the module never
  auto-applies anything, so it is human-gated too.

---

## 3. Python emit points (43)

All flow through `SpendLogger.log()`
(`services/agent-orchestrator/services/spend_logger.py:260`) → `build_agent_event()`
(`services/neural_footprint.py:61`) → `insert_event()` (`:118`).

Note `neural_footprint.py:90-92`: an invalid `outcome` degrades to `NULL` with
the raw value preserved in `context["outcome_invalid"]`. NULL never means
success — that invariant is already enforced and any new basis inherits it.

### 3.1 `snippet_parse` — best Python candidate

- **Site:** `services/web_verification_service.py:249`
- **Ground truth:** **YES.** `WineVerificationResult.model_validate_json(response.text)`
  at `:258` — a strict Pydantic gate. The request itself is issued with
  `response_json_schema=WineVerificationResult.model_json_schema()` (`:223`), so
  a validation failure is a real provider-side breach, not sloppy prompting.
  Returns `None` on failure (`:271`).
- **Synchronous?** **YES**, nine lines after the emit — but the emit is
  **above** the validate (see §1), so a validation failure currently records
  `success`.
- **Cheapest honest verdict:** move the emit below `:258`; `failure` when
  validation raises, `success` otherwise. **Basis: `schema_v1`.** Cheapest fix
  in the Python tree: it is a code motion, not new logic.

### 3.2 `email_classification` / `email_classification_escalation`

- **Sites:** `agents/email_intel_agent.py:332` and `:401`
- **Ground truth:** **YES, two independent ones.**
  1. `EmailClassification(**data)` at `:342` — Pydantic construction, throws on
     a bad shape. Site emits *above* it (§1).
  2. **A confidence gate that already governs behaviour:** `:349` compares
     `primary.confidence` against `settings.email_intel_escalation_threshold`
     and escalates below it. That is a persistence/behaviour gate, not decor.
  3. **An agreement signal that is computed and thrown away:** `_escalate_classification`
     (`:357`) re-classifies the *same* email on a different, ~10x pricier model.
     Primary-vs-escalated agreement is a free second-opinion verdict, and the
     escalated row at `:401` records `success` regardless of whether it agreed.
- **Synchronous?** **YES** for all three.
- **Note on the eval claim:** the comment at `:344-348` cites a 54-case eval
  where the primary model scored 54/54 with a measured 0% escalation rate. The
  narrative is in the comment; **no labelled 54-case fixture was found in
  `tests/`** (`tests/test_email_intel_agent.py` exists but was not verified to
  contain it). Treat the 54/54 figure as unverified for this census.
- **Basis:** `schema+confidence_v1` synchronously; an `agreement_v1` upgrade is
  available for the escalated minority at zero extra model spend.

### 3.3 `menu_page_extraction` / `pdf_extraction` — already past call level

- **Sites:** `services/claude_vision_extractor.py:507` and `:659`
- **Ground truth:** **YES, and already wired.** `parse_json_response()` at
  `:490` yields `parse_error`, consumed at `:509` as
  `outcome="partial" if parse_error else "success"`, with
  `context={"parse_error": bool(parse_error)}`. `choice` carries the yield
  (`f"wines:{len(parsed.get('wines', []))}"`).
- **These two rows are already graded on a parse basis but stamped
  `call_level_v0`** — the basis string understates what the code does. Correcting
  the stamp to `parse_v1` is a one-line honesty fix with no behaviour change.
- **Deferred upgrade:** `build_field_confidence()` (`services/field_confidence.py:89`)
  runs at `:524`, and `QualityScorer.score_extraction()`
  (`services/quality_scorer.py:109`) produces a `decision` of
  `accept`/`review`/`reject` from parser confidence, field completeness and
  **OCR cross-validation** (`_cross_validate`, `:231`). Wired at
  `agents/menu_analyzer_agent.py:216`, `api/scan_routes.py:662`,
  `jobs/tasks.py:502` — same process, later in the job. A `quality_v1` re-grade
  is genuinely available here.

### 3.4 `email_draft` — a real constraint check already runs

- **Site:** `agents/provider_communication_agent.py:588`
- **Ground truth:** **YES, and it is behavioural, not cosmetic.**
  `ConstraintEngine.check_hard_constraints(draft_body)` at `:600`, plus
  `check_annotating_constraints` `:601` and `check_length_cap` `:602`
  (engine at `services/constraint_engine.py:110`, `:187`, `:308`). A draft that
  trips a hard constraint is, by the system's own definition, not a usable draft.
- **Already better than call level:** `:590` grades
  `outcome="success" if draft_generated else "failure"` — `draft_generated` is
  False when the Haiku call or its parse failed and the canned fallback template
  at `:564-574` was substituted. That is a real product-level verdict already
  being written under a `call_level_v0` stamp.
- **Synchronous?** **YES**, 12–14 lines after the emit.
- **Basis:** `constraint_v1` — `failure` on fallback, `partial` when hard
  constraints trip, `success` on a clean parsed draft.

### 3.5 `order_matching` — a DB-record match

- **Site:** `agents/email_parsing_agent.py:453` (via helper `:393`)
- **Ground truth:** **YES in principle.** The task matches an inbound email to
  an existing order; the answer either resolves to a real order row or it does
  not — a match against an existing DB record, exactly the class OD-59 asks for.
- **Synchronous?** **YES** — resolution happens in the same handler.
- **Caveat that keeps this out of the top tier:** "resolved to *an* order" is
  not "resolved to the *right* order". A confidently wrong match is
  indistinguishable from a correct one without the human correction record. The
  cheap verdict is `resolution_v1` (resolved / unresolved); correctness needs the
  correction feedback loop.

### 3.6 Serper search sites — `field_search`, `field_search_reflexion`, `score_search`, `price_search`, `web_verify_search`

- **Sites:** `jobs/research_tasks.py:759`, `:1054`; `jobs/score_tasks.py:183`,
  `:236`; `jobs/web_verify_tasks.py:318`
- **Ground truth:** **Partial, and two of five already use it.**
  `research_tasks.py:761` and `:1056` grade
  `outcome="success" if search_ok else "failure"` from a real exception flag.
  All five write `results_count` into context and `choice=f"search:{n}_results"`.
- **The honest verdict is one step further down:** a search is done when its
  snippets **yielded a usable value**, not when the HTTP call returned. That is
  machine-checkable and already computed:
  - `parse_serper_score_snippets()` (`services/critic_score_service.py:142`)
    returns falsy → `score_tasks.py:197,218` writes `{"status": "not_found"}`.
  - `web_verify_tasks.py:332` returns `{"status": "no_search_results"}`.
  - `research_tasks.py:772-774` counts `fields_unchanged` on empty results.
- **Synchronous?** **YES** — all within the same loop iteration, 10–40 lines below.
- **Basis:** `results_parsed_v1`. Cheap, and it is the number that actually
  matters: a paid search returning five irrelevant snippets currently reads
  identical to one that found the answer.

### 3.7 `field_extraction`, `wine_field_parse`, `wine_enrichment*`, `vision_extraction`, `text_extraction`, `crawl_extraction`

- **Sites:** `jobs/research_tasks.py:524`, `:590`; `services/wine_field_parser.py:599`;
  `services/wine_matcher.py:594`, `:679`; `agents/sommelier_agent.py:676`, `:700`;
  `services/haiku_enrichment_service.py:241`; `services/vlm_extraction_service.py:333`,
  `:420`, `:655`
- **Synchronous ground truth:** shape only — `json.loads` + `isinstance(list)` +
  a non-empty `value` filter (`research_tasks.py:531-534`, `:598-601`). All the
  `json.loads` sites emit above the parse (§1). The three
  `vlm_extraction_service` sites do parse first (`_parse_response` at `:316`,
  `:403`, `:638`) and put the yield in `choice=f"wines:{result.total_wines}"`,
  but grade a flat `success` regardless.
- **Deferred ground truth: YES, and it is substantial.**
  `OntologyValidationService.run_ontology_validation()`
  (`services/ontology_validation_service.py:527`) applies four hard, wholly
  machine-checkable domain rules to extracted wine fields:
  `check_region_country_consistency` `:96`, `check_grape_appellation_compatibility`
  `:160`, `check_vintage_plausibility` `:231`, `check_color_grape_consistency`
  `:306`, producing typed `OntologyCheckFailure` rows (`:64`) and routing at
  `_route_failures` `:437`. **A Bordeaux appellation with a Nebbiolo grape is
  wrong, provably, with no human in the loop.**
- **Why deferred:** it runs as a Celery task keyed by `wine_id`
  (`jobs/ontology_tasks.py:105`), not in the extraction request. Re-grading needs
  a `wine_id` + `correlation_id` join back to the NF row. Several of these sites
  already put `wine_id` in context (`research_tasks.py:765`,
  `haiku_enrichment_service.py:244`) — the join key exists on some rows and not
  others.
- **Also available, also deferred:** `should_auto_block()`
  (`services/field_confidence.py:230`) and `route_fields_by_threshold()` (`:153`)
  are confidence gates that already govern persistence.

### 3.8 `date_extraction` and `rfq_response_parse` — free agreement signal

- **Sites:** `agents/calendar_agent.py:247`, `agents/rfq_agent.py:477`
- **Ground truth:** **Available and unused.** Both have a deterministic regex
  fallback that computes the same answer —
  `_regex_date_extraction(conversation)` (`calendar_agent.py:272`) and
  `_fallback_parse_response(response_text)` (`rfq_agent.py:494`). Agreement
  between the model and the deterministic parser is a machine-checkable
  corroboration signal at **zero additional model spend**.
- Additionally, a returned date is either ISO-parseable and plausible relative
  to `today` (passed into the prompt at `calendar_agent.py:211`) or it is not —
  a pure arithmetic check.
- **Both emit above the parse (§1)**, so today a prose response records
  `success` and then silently falls through to regex.
- **Basis:** `parse_v1` after the emit is moved; `agreement_v1` if the fallback
  is run alongside.

### 3.9 `invoice_extraction` — ground truth exists, on the wrong path

- **Site:** `agents/visual_verification_agent.py:648`
- **Already better than call level:** `:650` grades
  `outcome="partial" if parse_failed else "success"`, parsing at `:620` first.
  This is one of the two sites that gets the ordering right (§1).
- **Ground truth exists:** `_compare_invoice_to_order()` at `:664` — compares
  invoice total against `order.final_price_per_bottle * order.quantity` within
  `self.price_tolerance_percent`, plus quantity and vintage mismatch flags.
  A reconciliation against a stored DB record.
- **But it is NOT wired to this path.** Verified call graph:
  - `_compare_invoice_to_order` is called **once**, at `:212`, downstream of
    `_scan_invoice()` (`:446`) — which is **local EasyOCR**
    (`self.ocr_reader.readtext`, `:498`), makes **no model API call**, and
    therefore **emits no NF row at all**.
  - `_extract_invoice_from_email_text()` (`:563`), the method that *does* emit
    `invoice_extraction`, is called from
    `agents/provider_communication_agent.py:1253` — a path that never reaches
    `_compare_invoice_to_order`.
- **Consequence:** the reconciliation and the NF row are on disjoint code paths.
  Giving `invoice_extraction` a reconciliation verdict requires wiring work,
  not just plumbing — which is materially more expensive than
  `document_extraction`, where the verdict is already on the returned object.

### 3.10 `embedding` — a mis-grade worth naming

- **Site:** `agents/provider_conversation_agent.py:1231`
- **Ground truth:** a returned vector of the right dimension. Nearly
  tautological, so the verdict adds little.
- **But the failure path is actively wrong:** `:1238-1243` catches any exception
  and returns a **sha384 byte hash as a fake embedding**. That fallback vector
  is meaningless for similarity search, and **no NF row is emitted on that
  path** — the emit at `:1224` sits inside the `try`, above the failure. So an
  embedding failure is invisible in NF rather than recorded as `failure`. Same
  shape as the `date_extraction` / `rfq_response_parse` silent-fallback problem,
  but worse: here the fallback value flows into stored data.

### 3.11 Genuinely human-rubric task types (no machine verdict available)

Shape checks are possible for all of these; **correctness is not machine-checkable
without a labelled set or a human grader.**

`summarization` (`provider_communication_agent.py:1206`),
`profile_extraction` (`:1068`),
`session_summary` / `thread_summary` (`provider_conversation_agent.py:2164`, `email_parsing_agent.py:580`),
`draft_response` (`provider_conversation_agent.py:1952`),
`intelligence_extraction` (`:980`),
`correction_preference` (`:2107`),
`query_interpretation` / `wine_response` (`sommelier_agent.py:487`, `:566`),
`style_analysis` / `email_compose` (`email_composer_service.py:483`, `:609`),
`promo_extraction` (`email_intel_agent.py:599`),
`auction_wine_research` (`auction_wine_service.py:147`, `:196`),
`book_vision_extraction` / `book_text_extraction` (`wine_book_scraper.py:340`, `:458`),
`consultant_analysis` and `ux_proposals` (TS, §2.6–2.7).

Two partial exceptions worth recording:
- `profile_extraction` and `summarization` write to real tables
  (`providers.profile_dynamic` at `provider_communication_agent.py:1041`;
  `negotiation_facts` at `:1170-1181`) and carry `choice=f"fields:{n}"` /
  `choice=f"facts:{n}"`. A zero-yield extraction is machine-detectably useless,
  which is a floor, not a verdict.
- `correction_preference` is *itself* derived from a human correction
  (`provider_conversation_agent.py:2067-2073` logs the manager's edit). The
  human-edit record is a ground-truth **corpus** for other task types even though
  this task type has no verdict of its own.

---

## 4. Ranked: cheapest real verdict first

Cost ranks the *engineering* to write an honest, non-call-level verdict.
"Sync" = knowable inside the same request. "Deferred" = needs a re-grade join.

| # | Task type | Runtime | Existing check (`file:line`) | Sync? | Cost | Proposed basis |
|---|---|---|---|---|---|---|
| 1 | `document_extraction` | TS | `applyTieOut` `parsed-document.ts:104`, applied `document-extractor.service.ts:267` | **Sync** | **Trivial** — value already on returned object | `reconciliation_v1` |
| 2 | `menu_page_extraction`, `pdf_extraction` | Py | `parse_json_response` → `parse_error` `claude_vision_extractor.py:490,509,661` | **Sync** | **Trivial** — already graded; only the basis string is wrong | `parse_v1` |
| 3 | `snippet_parse` | Py | `WineVerificationResult.model_validate_json` `web_verification_service.py:258` | **Sync** | **Trivial** — move emit below parse | `schema_v1` |
| 4 | `email_draft` | Py | `check_hard_constraints` `provider_communication_agent.py:600`; `draft_generated` `:590` | **Sync** | **Low** — read 3 existing flags | `constraint_v1` |
| 5 | `email_classification` (+`_escalation`) | Py | `EmailClassification(**data)` `email_intel_agent.py:342`; confidence gate `:349` | **Sync** | **Low** — move emit below `:342` | `schema+confidence_v1` |
| 6 | `vendor_page_extraction` | TS | `normalizeExtraction` `vendor-page-extraction.ts:248`; >50% reject `:313` | **Sync** | **Low** — read `rejected`/`items` | `parse_yield_v1` |
| 7 | 5 Serper search types (§3.6) | Py | `parse_serper_score_snippets` `critic_score_service.py:142`; `not_found` `score_tasks.py:197` | **Sync** | **Low** — move emit past the parse | `results_parsed_v1` |
| 8 | `inbound_email_response` | TS | `parseAnalysis` → `null` `inbound-responder.service.ts:766,779` | **Sync** | **Low** (sync); real verdict is human-gated | `parse_v1` → `approval_v1` |
| 9 | `date_extraction`, `rfq_response_parse` | Py | regex fallback `calendar_agent.py:272`, `rfq_agent.py:494` | **Sync** | **Low–Med** — move emit + optionally run fallback | `parse_v1` / `agreement_v1` |
| 10 | `menu_scan` | TS | `parseJsonResponse` + `truncated` `scan-parser.service.ts:326,332` | **Sync** | **Med** — zero-items is ambiguous | `parse_yield_v1` |
| 11 | `order_matching` | Py | order resolution `email_parsing_agent.py:453+` | **Sync** | **Med** — resolution ≠ correctness | `resolution_v1` |
| 12 | `field_extraction`, `wine_field_parse`, `wine_enrichment*`, `vision/text/crawl_extraction` | Py | `run_ontology_validation` `ontology_validation_service.py:527` (4 hard rules `:96,160,231,306`) | **Deferred** | **Med** — needs `wine_id` join; strongest domain truth in the tree | `ontology_v1` |
| 13 | `document_extraction` (2nd pass) | TS | `computeMatch` `invoice-match.ts:149`, `isDiscrepancy` `:402` | **Deferred** | **Med–High** — needs PO + receiving | `three_way_match_v1` |
| 14 | `menu_scan` / `menu_page_extraction` (2nd pass) | Py | `QualityScorer.score_extraction` `quality_scorer.py:109`, `_cross_validate` `:231` | **Deferred** | **Med–High** — cross-runtime join | `quality_v1` |
| 15 | `invoice_extraction` | Py | `_compare_invoice_to_order` `visual_verification_agent.py:664` | **Deferred + unwired** | **High** — reconciliation is on a disjoint path (§3.9) | `order_match_v1` |
| 16 | `photo_count` | TS | none; `suggestedQty === null` only `photo-count.service.ts:119` | **Deferred + unrecorded** | **High** — must persist the suggestion first | `human_count_v1` |
| 17 | `embedding` | Py | dimension only; silent hash fallback `provider_conversation_agent.py:1238` | Sync | **Low value** — fix the missing failure emit first | n/a |
| 18 | 18 task types in §3.11 + `consultant_analysis`, `ux_proposals` | Both | shape only | Sync (shape) | **Genuine human rubric** for correctness | `schema_v1` floor |

---

## 5. What this census does and does not settle

**Settles:** where every verdict lives, whether it is synchronous, and what it
costs. `document_extraction` is the cheapest real verdict in the codebase by a
wide margin — the value already exists on the object the call site holds, is
already load-bearing in the product (review routing, confidence), and honestly
distinguishes untestable (`tiesOut: null`) from failed.

**Does not settle:** whether it is the right opener. That is OD-59.

**Raises, and belongs in `OPEN-DECISIONS.md`:**
1. The ~10 emit-before-parse sites (§1) are a correctness defect in the existing
   instrument, independent of doneability. Ten task types currently over-report
   `success`. Fixing them is a prerequisite for trusting any richer basis, and
   it doubles as a free `parse_v1` upgrade.
2. Two task types are **already graded better than `call_level_v0`** but stamped
   with it: `menu_page_extraction`/`pdf_extraction` (`parse_error`) and
   `email_draft` (`draft_generated`). The stamp understates the code. Correcting
   the string costs nothing and stops a future re-grade from redoing work that
   is already done.
3. `embedding` (§3.10) emits **no row at all** on failure and stores a fake
   hash vector — a data-quality bug surfaced by this census, not a doneability
   question.

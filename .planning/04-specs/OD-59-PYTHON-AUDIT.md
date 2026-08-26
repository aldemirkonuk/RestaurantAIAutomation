# OD-59 Python audit — can the agent-orchestrator express a task-level verdict?

Companion to `OD-59-READOUT-AUDIT.md` (view layer). This one covers the **Python
emitter**: what it writes today, whether a later pass can reach the row it wrote,
and what ground truth exists on this side to grade with.

Audited 2026-08-25 against the worktree at branch `feat/od-59-doneability`
(base `fdaa7fa0`). Every claim below is read off source or a run, never off a
comment; §7 lists the claims that turned out to be false.

**Live-development warning.** While this audit was being written, a concurrent
session added the **gateway's** OD-59 answer into the same worktree, uncommitted
and untracked (§4.3). Its API is provisional. Everything in §1–§3 and §5 is about
committed code and is stable.

---

## 0. The answer in one paragraph

The Python emitter **returns nothing**. `SpendLogger.log()` is `-> None`,
`insert_event()` returns a bare `bool` and throws away the row PostgREST hands
back, and `build_agent_event()` never puts an `id` in the row — so the primary
key is minted server-side and no Python caller ever learns it. A verdict that
becomes knowable after the emit has no way to name the row it grades. This is a
discarded capability, not a missing one: `BaseAgent.log_decision` reads
`result.data[0]["id"]` off the identical client, three files away.

---

## 1. How `outcome` and `outcome_basis` are set today

### 1.1 The only code that sets them

`services/agent-orchestrator/services/neural_footprint.py:88-94`:

```python
    ctx: Dict[str, Any] = dict(context or {})

    if outcome is not None and outcome not in VALID_OUTCOMES:
        ctx["outcome_invalid"] = str(outcome)[:100]
        outcome = None
    if outcome is not None:
        ctx.setdefault("outcome_basis", OUTCOME_BASIS)
```

with `VALID_OUTCOMES = ("success", "failure", "partial")` and
`OUTCOME_BASIS = "call_level_v0"` at `neural_footprint.py:31-32`.

`outcome` itself is never computed here — it arrives from the call site and is
only *validated*. Call sites decide the grade; 41 of the 44 emitting sites pass
a hardcoded `outcome="success"` meaning "the response returned".

There is exactly one route into this function: `SpendLogger.log()` →
`build_agent_event(...)` at `services/spend_logger.py:393-405`. `SpendLogger` is
the sole Python NF entry point (`spend_logger.py:5-13`), which is verified —
nothing else in the tree imports `build_agent_event` or `insert_event`.

### 1.2 Yes — a caller can ALREADY override the basis, today, unchanged

`setdefault` at `:94` is a no-op when the key is already present, and the caller's
`context` dict is what `ctx` is seeded from at `:88`. The public path is open too:
`SpendLogger.log(context=...)` merges caller keys **last** into the NF context
(`spend_logger.py:377-384`, `nf_context.update(context)`), so a caller key beats
`provider`, `model` and `task_type` as well.

Verified by running it, not by reading it:

```
caller override kept -> reconciliation_v1
default              -> call_level_v0
```

So `SpendLogger.log(..., outcome="success", context={"outcome_basis":
"reconciliation_v1"})` already writes a `reconciliation_v1` row. **No emitter
change is needed to express a new basis string.** What is missing is not the
vocabulary — it is the row handle (§3).

**The gateway is caller-overridable in the same way, by accident of key order.**
`model-client.service.ts:347` hardcodes `outcome_basis: "call_level_v0"`, but
`...(nf.context ?? {})` spreads at `:366` — *after* it — so a caller-supplied
`context.outcome_basis` wins there too. Neither runtime has a test pinning this
behaviour in either direction.

### 1.3 Why `:86` asserts the basis is present and `:183` asserts it is absent

Both tests call the same emitter. The only difference is the `outcome` argument.

| | `test_spend_logger.py:52-90` | `test_spend_logger.py:162-183` |
|---|---|---|
| `outcome` passed | `"success"` | `"great_success"` |
| in `VALID_OUTCOMES`? | yes | **no** |
| `:90-92` fires? | no | yes → `context["outcome_invalid"]`, `outcome = None` |
| `:93` guard `outcome is not None` | True → stamp | **False → no stamp** |
| assertion | `context["outcome_basis"] == "call_level_v0"` (`:86`) | `"outcome_basis" not in context` (`:183`) |

The invariant the pair pins is: **the basis is stamped if and only if the row
carries a grade.** A NULL-outcome row is never labelled with a grading basis,
because a basis without a verdict is a claim to have measured something that was
not measured. `test_legacy_positional_call_still_emits_both_rows` (`:114`) exercises
the other NULL path — `outcome` simply not passed.

`tests/test_spend_logger.py` — 31 passed in 0.17s (run in this worktree).

### 1.4 Hazard OD-59 inherits: the invariant covers the auto-stamp only

The guard at `:93` protects the *default*. It does not protect a *caller-supplied*
basis, which is copied through at `:88` before any validation. Verified:

```
invalid outcome -> outcome None | basis reconciliation_v1 | invalid great_success
```

That is a row asserting it was graded by `reconciliation_v1` while carrying
`outcome = NULL`. If the Python side ships a verdict by stuffing the basis into
`context` — the only route that exists today — one typo'd outcome string produces
a row that lies about having been graded, and the readout counts it as ungraded
while the basis population says otherwise. This is a direct argument for a
companion row over an in-context basis, and it matches where the gateway landed
independently (§4.3).

---

## 2. Machine-checkable ground truth on the Python side

Three candidates were examined. None of them currently connects a real verdict to
an NF row, but they fail for three *different* reasons, which matters for picking
the opener.

### 2.1 `drift_agent.py` — best ground truth, **no event to grade**

The reconciliation is genuinely deterministic and needs no human:

- catalog snapshot hash, `drift_agent.py:35-52`, compared at `:146-149`
- price: SimPOS catalog price vs `restaurant_inventory` menu price,
  `_maybe_price_change` `:396-426`
- stock: `physical_stock` vs `stock_live`, and catalog-active vs inventory-inactive,
  `_maybe_stock_mismatch` `:428-501`
- findings persisted to `drift_findings` with severity/status, `:503-533`, `:594-624`

**But `DriftAgent` emits zero NF rows.** It never imports `spend_logger` (verified:
no occurrence of `spend_logger` or `SpendLogger` in the file), because it makes no
paid model call — its only infra writes are `log_decision` → `decision_log` and the
`drift_findings` insert. Since `SpendLogger.log()` is the sole NF entry point, a
deterministic agent produces **no** `neural_footprint_event` rows at all. Grading it
would first require a non-spend NF emit path, which is a larger change than OD-59
needs and a separate decision.

### 2.2 `email_intel_agent.py` — truth exists **offline**, not per row

NF emits: `:324-336` (`email_classification`) and `:393-406`
(`email_classification_escalation`), both hardcoded `outcome="success"` at `:333`
and `:402`.

**The verdict is already knowable after the emit, and is already being missed.**
`json.loads(raw)` runs at `:341` — *after* the log call at `:324`. A response whose
body is not parseable JSON has already been written as `success`. The escalation
path has the same ordering: the JSON dig at `:413-419` is downstream of the log at
`:393`. (`visual_verification_agent.py:607-610` documents this exact ordering
choice: the row must not sit behind `json.loads`, or failure paths vanish from the
ledger. Correct for spend; it is precisely why an after-the-fact verdict is needed.)

The real ground truth here is a **labelled corpus, scored offline**:

- `tests/fixtures/email_classification_eval.jsonl` — 39 labelled cases
- `tests/fixtures/email_classification_holdout.jsonl` — 15 labelled cases
- scored by `scripts/eval_email_classification.py` (fixture paths at `:35-36`),
  which imports the production prompt rather than copying it (`:58-60`)

54 cases total, which corroborates the "54/54 combined" claim at
`email_intel_agent.py:47-48`. But this grades *the prompt and model*, offline,
against fixtures. It never touches `neural_footprint_event` (the string does not
appear in the script; its only spend import is `estimate_llm_cost` at `:122`), and
a fixture case has no production row to attach to. The only runtime self-check
available is "did the output parse into `EmailClassification`" — a parse-level
verdict, honest but not doneability.

### 2.3 `visual_verification_agent.py` — a real reconciliation, **wired to the wrong path**

This is the closest thing to `reconciliation_v1` in Python, and it matches OD-59's
proposed opener by name.

- **NF emit**: `_extract_invoice_from_email_text`, `:563-662`. Writes
  `task_type="invoice_extraction"` (`:648`), `choice` = `invoice:parsed` /
  `invoice:parse_failed` (`:649`), `outcome="partial" if parse_failed else
  "success"` (`:650`). Parse-level, not task-level.
- **The reconciliation**: `_compare_invoice_to_order`, `:664-707`. Compares invoice
  total against `order.final_price_per_bottle * order.quantity` under
  `self.price_tolerance_percent` (`:684-696`) and per-line quantity (`:699-705`),
  returning `price_mismatch` / `quantity_mismatch` / `vintage_mismatch` /
  `wine_name_mismatch`. Machine-checkable, no human grader, exactly the shape
  OD-59 describes.

**The two are in disjoint call paths.** `_compare_invoice_to_order` is called only
from `_process_invoice:212`, whose data comes from `_scan_invoice` (`:205` →
`:446-512`) — the EasyOCR path, which makes no model call and therefore emits **no
NF row**. The NF-emitting `_extract_invoice_from_email_text` is called only from
`provider_communication_agent.py:1253`, and that path never reaches the comparison.

So Python has the verdict function and the graded event, but nothing joins them.
Connecting them is a small, honest change — and it still needs a row handle (§3).

---

## 3. **Does the emitter return the row id, or any handle? — No.**

This is the load-bearing finding.

### 3.1 Three independent places the handle is dropped

1. **`insert_event`, `neural_footprint.py:118-134`.** The insert result is
   evaluated and discarded:

   ```python
        supabase.table("neural_footprint_event").insert(row).execute()
        return True
   ```

   `:124`. Return type is `bool` — written, or not written. Nothing about *which* row.

2. **`build_agent_event`, `neural_footprint.py:61-115`.** The returned dict has no
   `id` key. Verified by running it — the 14 keys are `subject_type, subject_id,
   stimulus, context, internal_state, choice, outcome, cost_usd, input_tokens,
   output_tokens, duration_ms, correlation_id, restaurant_id, occurred_at`. So the
   PK is minted server-side by `id uuid primary key default gen_random_uuid()`
   (`supabase/migrations/20260824141116_neural_footprint_event.sql:18`) and is never
   seen by the process that caused it.

3. **`SpendLogger.log`, `spend_logger.py:260-278`.** Declared `-> None`, and every
   branch falls off the end. `insert_event`'s bool is not even bound at `:406`.
   `test_log_returns_none_when_supabase_not_configured` (`:277-292`) pins `None`.

### 3.2 The capability exists in this repo and is being thrown away

`BaseAgent.log_decision` (`core/base_agent.py:743-790`) reads the id off the same
supabase-py client, on an insert with no `.select()` chained:

```python
            if result.data and len(result.data) > 0:
                return result.data[0].get("id")
```

`:785-787`. Its comment at `:776-782` records that supabase-py ≥ 2.x returns the
inserted representation from `.execute()` already, verified against 2.28.0, and
`tests/test_base_agent_infra.py:235-257` pins it with a `spec`'d mock. So
`neural_footprint.py:124` discarding the result is a **choice**, not a client
limitation.

### 3.3 `correlation_id` is not a substitute

The obvious "join it later" answer fails on uniqueness. `correlation_id` is
per-message, not per-row: `email_intel_agent.py:335` and `:404` both pass
`self._current_correlation_id`, so one inbound email can produce two NF rows under
one correlation. `(correlation_id, task_type)` is not unique either — see
`research_tasks.py:524` and `:590`, both `field_extraction`. Nothing in the table
constrains it: the only unique key is `id`, and the index `nfe_correlation`
(migration `:59-61`) is non-unique by construction.

### 3.4 Smallest change that gives Python a handle

**Option A — mint the id client-side (recommended).** Roughly four lines, no
migration, no round-trip:

- `build_agent_event`: add `"id": str(_uuid.uuid4())` to the returned dict. The
  module already imports `uuid as _uuid` (`neural_footprint.py:25`), and the column
  is a PK *with a default*, not `GENERATED ALWAYS`, so an explicit value is legal.
- `insert_event`: return `Optional[str]` — `row["id"]` on success, `None` on the
  drop path — instead of `bool`. Callers checking truthiness are unaffected.
- `SpendLogger.log`: bind that at `:406` and return it; change `-> None` to
  `-> Optional[str]`.

Why this over reading it back: the id is known *before* the insert, so it survives
the "never raises, count the drop" contract intact; it costs no `RETURNING`
round-trip on the other 43 emitting sites; and returning `None` on a dropped insert
gives the verdict writer the same "do not grade a row that does not exist" signal
the gateway built deliberately (`nf-verdict.service.ts:71-74`).

**Option B — read it back.** `res = ...insert(row).execute()` then
`res.data[0]["id"]`, mirroring `log_decision` exactly. Truer to "the row that
actually exists", but couples the handle to PostgREST returning a representation
and yields nothing when the insert is dropped.

**Nothing breaks either way.** All 44 call sites ignore `log()`'s return value, and
no test asserts the return type — `test_log_returns_none_when_supabase_not_configured`
asserts `None` on the *unconfigured* early return (`spend_logger.py:307-311`), which
still returns `None` under both options. Verified by reading all 31 tests.

**Constraint on any alternative shape:** the verdict must not be a second
`neural_footprint_event` row. `nf_a_cost_per_completed_task` counts `count(*) as
tasks` (`20260824153600_nf_a_readout.sql:103`), so an appended verdict row would
double-count tasks and skew `avg_cost` — silently corrupting the exact headline
metric OD-59 exists to unblock.

---

## 4. Is there an "update an already-written NF row" path in EITHER runtime?

### 4.1 No. None. In either runtime.

Exhaustive grep across the repo (excluding `node_modules`, `.git`) for every
reference to `neural_footprint_event`. The complete set of code touching it:

| Operation | Where |
|---|---|
| INSERT (Python) | `services/neural_footprint.py:124` |
| INSERT (gateway) | `apps/api-gateway/src/common/model-client/model-client.service.ts:369-390` |
| SELECT (gateway) | `model-client.service.ts:462-472` — spend-ceiling sum, read-only |
| SELECT (views) | `20260824153600_nf_a_readout.sql:98-143` |
| SELECT (readout) | `scripts/nf_readout.py` — reads the two views only |

No `UPDATE`, no `upsert`, no `DELETE`. The `.update(` calls in `base_agent.py`
(`:882`, `:898`, `:932`) are all against `saga_state`. `nf_context.update(context)`
at `spend_logger.py:384` is a Python dict method, not a DB write.

### 4.2 An update would be *permitted* — it is simply not implemented

The table is RLS-on with one policy, `for all to service_role using (true) with
check (true)` (`20260824153600_nf_a_readout.sql:67-71`), and both writers hold the
service-role key (recorded at `:59-62` of that migration). So the gap is code, not
grants. Worth noting the table also has no `updated_at` column and no unique key
besides `id`, so an in-place regrade would be untraceable after the fact.

### 4.3 The gateway is answering this right now — and deliberately does *not* add one

Landed into this worktree at ~14:57 on 2026-08-25 by a concurrent session,
**uncommitted and untracked**. Treat the API as provisional:

- `supabase/migrations/20260825180000_nf_verdict.sql` — new table `nf_verdict`:
  `event_id uuid not null references public.neural_footprint_event(id) on delete
  cascade` (`:27-28`), `basis text not null` (`:36`), same tri-state `outcome`
  check (`:42`), `evidence jsonb` (`:46`), `unique (event_id, basis)` (`:53`).
- `apps/api-gateway/src/common/model-client/nf-verdict.service.ts` — `NfVerdictService.record()`,
  upsert on `event_id,basis` (`:76-89`), fire-and-forget with a drop counter, and a
  refusal to write an orphan verdict when the emit was dropped (`:71-74`).
- `model-client.service.ts` (modified) — `NfEventRef`, a promise settled with the
  inserted id via a **conditional** `.select("id").single()`, taken only when a
  caller asked for it, and settled `null` when the emit drops.
- Wired in `model-client.module.ts:20-21`.

Its own header records that shape (a), overwriting `outcome` in place, was rejected
partly because *"neither runtime has an update path for an NF row today"* — which
independently corroborates §4.1, reached here by grep before that file existed.

**What this means for Python.** The gateway's contract needs one thing the Python
side cannot currently supply: **the NF row's `id`, to put in `nf_verdict.event_id`.**
Whatever else diverges, §3.4 is the change that has to happen, and `NfEventRef`'s
promise-shaped handle is the gateway's answer to the same problem — the Python
emitter is synchronous, so a plain return value (Option A) is the equivalent.

---

## 5. `task_type` strings the Python side actually emits

44 emitting sites, **40 distinct values**. (`spend_logger.py:41` is a docstring
example, not a call site.)

### 5.1 Literal at the `log()` call — 33 sites

| `task_type` | `file:line` |
|---|---|
| `date_extraction` | `agents/calendar_agent.py:247` |
| `rfq_response_parse` | `agents/rfq_agent.py:477` |
| `email_draft` | `agents/provider_communication_agent.py:588` |
| `profile_extraction` | `agents/provider_communication_agent.py:1068` |
| `summarization` | `agents/provider_communication_agent.py:1206` |
| `retrieval_document` | `agents/provider_conversation_agent.py:1219` |
| `embedding` | `agents/provider_conversation_agent.py:1231` |
| `correction_preference` | `agents/provider_conversation_agent.py:2107` |
| `invoice_extraction` | `agents/visual_verification_agent.py:648` |
| `email_classification` | `agents/email_intel_agent.py:332` |
| `email_classification_escalation` | `agents/email_intel_agent.py:401` |
| `promo_extraction` | `agents/email_intel_agent.py:599` |
| `vision_extraction` | `services/vlm_extraction_service.py:333` |
| `text_extraction` | `services/vlm_extraction_service.py:420` |
| `crawl_extraction` | `services/vlm_extraction_service.py:655` |
| `web_verify_search` | `jobs/web_verify_tasks.py:318` |
| `score_search` | `jobs/score_tasks.py:183` |
| `price_search` | `jobs/score_tasks.py:236` |
| `field_extraction` | `jobs/research_tasks.py:524`, `jobs/research_tasks.py:590` |
| `field_search` | `jobs/research_tasks.py:759` |
| `field_search_reflexion` | `jobs/research_tasks.py:1054` |
| `auction_wine_research` | `services/auction_wine_service.py:147`, `:196` |
| `snippet_parse` | `services/web_verification_service.py:249` |
| `wine_enrichment` | `services/haiku_enrichment_service.py:241` |
| `book_vision_extraction` | `services/wine_book_scraper.py:340` |
| `book_text_extraction` | `services/wine_book_scraper.py:458` |
| `menu_page_extraction` | `services/claude_vision_extractor.py:507` |
| `pdf_extraction` | `services/claude_vision_extractor.py:659` |
| `wine_enrichment_grounded` | `services/wine_matcher.py:594` |
| `wine_enrichment_fallback` | `services/wine_matcher.py:679` |
| `wine_field_parse` | `services/wine_field_parser.py:599` |

### 5.2 Forwarded through a per-file spend helper — 11 sites

Four files wrap `log()` in a helper taking `task_type: str`, so the grep at the
`log()` call shows a variable. Resolved to their literals:

| Helper (`log()` at) | `task_type` | call site |
|---|---|---|
| `agents/provider_conversation_agent.py:946` | `intelligence_extraction` | `:982` |
| " | `draft_response` | `:1954` |
| " | `session_summary` | `:2166` |
| `agents/sommelier_agent.py:441` | `query_interpretation` | `:490` |
| " | `wine_response` | `:569` |
| " | `wine_enrichment_grounded` | `:679` |
| " | `wine_enrichment_fallback` | `:703` |
| `agents/email_parsing_agent.py:393` | `order_matching` | `:455` |
| " | `thread_summary` | `:582` |
| `services/email_composer_service.py:461` | `style_analysis` | `:485` |
| " | `email_compose` | `:611` |

### 5.3 The two runtimes share **zero** task_type strings

The gateway emits 7: `ux_proposals` (`ux-optimizer.service.ts:282`),
`vendor_page_extraction` (`vendor-page-extractor.service.ts:218`),
`inbound_email_response` (`inbound-responder.service.ts:753`), `photo_count`
(`photo-count.service.ts:89`), `document_extraction`
(`document-extractor.service.ts:135`), `menu_scan` (`scan-parser.service.ts:315`),
`consultant_analysis` (`consultants.service.ts:183`).

Intersection with the 40 Python values: **empty**. So `context.task_type` today
partitions the table *by runtime* as a side effect, and the same conceptual work is
named differently on each side — see §7.2.

---

## 6. What OD-59 has to decide for Python, stated as forks

1. **Row handle.** Option A (client-minted uuid) or Option B (read-back)? §3.4.
   Nothing else in this audit can proceed without one.
2. **Where the verdict lands.** `nf_verdict` (the gateway's committed direction,
   §4.3) or something Python-local? A second NF row is ruled out by §3.4's
   double-count constraint, and an in-place update by §4.1 plus the missing
   `updated_at`.
3. **Which task type opens.** `invoice_extraction` has the reconciliation function
   already written (§2.3) but needs its two call paths joined, and does **not**
   carry the cron volume OD-59 attributes to it (§7.2).
4. **Whether the caller-supplied-basis hole gets closed** (§1.4) before or after a
   real basis ships.

---

## 7. Claims checked against source — what turned out to be false

**7.1 "Every graded row is stamped `call_level_v0`" — false as written.**
`spend_logger.py:299` and the docstring at `neural_footprint.py:15` both state the
stamp unconditionally. It is a `setdefault` (`:94`), so a caller-supplied
`context["outcome_basis"]` wins, and the merge at `spend_logger.py:384` makes that
reachable from the public API. Verified by execution (§1.2). Convenient for OD-59
— but the docs currently describe a stricter emitter than the one that ships.

**7.2 OD-59's own opener rationale does not hold as a pairing.**
OD-59 (`OPEN-DECISIONS.md:98`) proposed opening with `invoice_extraction` and justified
the volume with "the dominant real path (`@Cron */5` email sweep)". Those are two
different runtimes. The cron is gateway-side —
`procurement/documents/document-intake.service.ts:581`,
`@Cron("*/5 * * * *", { name: "procurement-document-intake-sweep" })` — and its
extractor emits `taskType: "document_extraction"`
(`document-extractor.service.ts:135`). The only emitter of `invoice_extraction`
anywhere is `visual_verification_agent.py:648`, reached from
`provider_communication_agent.py:1253`, which has nothing to do with that sweep.
Since the readout partitions on `context->>'task_type'`
(`20260824153600_nf_a_readout.sql:102,109`), a `reconciliation_v1` slice scoped to
`task_type = 'invoice_extraction'` selects **only** the Python path and misses the
gateway volume entirely. Either the opener or the volume claim has to give.

*Since resolved: the volume claim gave. The row has been rewritten as ✅ Resolved and no
longer carries the sentence quoted above — it now records this finding as its own premise
(b), and OD-59 closed on `document_extraction` rather than on the proposed opener.*

**7.3 The gateway holds a far stronger invoice ground truth than Python does.**
`apps/api-gateway/src/procurement/invoice-match.ts` reconciles four documents
(ordered / shipped / received / billed) into a `MatchVerdict` union, with a
backtest spec beside it. Python's `_compare_invoice_to_order` (§2.3) checks price
tolerance and per-line quantity only. If `reconciliation_v1` is defined once for
both runtimes, Python cannot currently produce the gateway's verdict — the bases
would agree in name and disagree in strength.

**7.4 `email_intel_agent.py:50`'s script reference is correct, but path-relative.**
It names `scripts/eval_email_classification.py`; the file is at
`services/agent-orchestrator/scripts/eval_email_classification.py`. There is no
such file under the repo-root `scripts/`. Not a defect — noted because grepping
from the repo root makes it look like rot, and it is not.

**7.5 Verified TRUE, and load-bearing:** `email_intel_agent.py:47-48`'s "54/54
combined" matches the fixtures exactly (39 + 15 lines). `base_agent.py:755-757`'s
claim that `log_decision` returns the inserted id is true and pinned by
`test_base_agent_infra.py:235-257` — which is what proves §3.2.

---

## 8. Files read

`services/agent-orchestrator/services/neural_footprint.py`,
`services/spend_logger.py`, `core/base_agent.py`,
`tests/test_spend_logger.py`, `tests/test_base_agent_infra.py`,
`agents/drift_agent.py`, `agents/email_intel_agent.py`,
`agents/visual_verification_agent.py`, `scripts/eval_email_classification.py`,
`apps/api-gateway/src/common/model-client/model-client.service.ts`,
`apps/api-gateway/src/common/model-client/nf-verdict.service.ts`,
`apps/api-gateway/src/procurement/invoice-match.ts`,
`supabase/migrations/20260824141116_neural_footprint_event.sql`,
`supabase/migrations/20260824153600_nf_a_readout.sql`,
`supabase/migrations/20260825180000_nf_verdict.sql`, `scripts/nf_readout.py`.

**Not verified:** no query was run against the live database, so every volume claim
here is a code claim. Production NF row counts, the actual distribution across the
40 task types, and whether `invoice_extraction` has any rows at all are unknown
from this audit.

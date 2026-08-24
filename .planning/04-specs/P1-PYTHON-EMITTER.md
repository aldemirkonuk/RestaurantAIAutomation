---
type: spec
id: P1-PY
title: P1 Python emitter — architecture proposal
status: proposed
updated: 2026-08-24
links: ["[[P1-NF-A-INSTRUMENTATION]]", "[[0008-nf-column-contract]]", "[[0006-neural-footprint-architecture]]"]
---

# P1 — Python emitter architecture (proposal)

> Answers the six architecture questions for the Python side of P1
> ([P1 spec §5.2](P1-NF-A-INSTRUMENTATION.md)). Column contract is locked
> ([ADR 0008](../decisions/0008-nf-column-contract.md)). Everything below is
> **proposed**, with evidence; no implementation exists yet.

## The 16 call sites (verified inventory)

All non-test writers to `SpendLogger.log()`, grouped by runtime context:

| # | Site | Context | Provider |
|---|---|---|---|
| 1 | `agents/provider_communication_agent.py:516` | BaseAgent method (email draft) | anthropic |
| 2 | `agents/provider_communication_agent.py:985` | BaseAgent method (profile extraction) | anthropic |
| 3 | `agents/provider_communication_agent.py:1112` | BaseAgent method (summarization) | anthropic |
| 4 | `agents/visual_verification_agent.py:616` | BaseAgent method (invoice extraction) | anthropic |
| 5 | `jobs/web_verify_tasks.py:307` | Celery task (`bind=True`) | serper |
| 6 | `jobs/research_tasks.py:515` | Celery task (field extraction) | anthropic |
| 7 | `jobs/research_tasks.py:569` | Celery task (field extraction) | google |
| 8 | `jobs/research_tasks.py:730` | Celery task (field search) | serper |
| 9 | `jobs/score_tasks.py:172` | Celery task (`bind=True`, score search) | serper |
| 10 | `jobs/score_tasks.py:213` | Celery task (`bind=True`, price search) | serper |
| 11 | `services/vlm_extraction_service.py:283` | shared service (vision extract) | google |
| 12 | `services/vlm_extraction_service.py:551` | shared service (crawl extract) | google |
| 13 | `services/web_verification_service.py:236` | shared service (snippet parse) | google |
| 14 | `services/haiku_enrichment_service.py:230` | shared service (wine enrichment) | anthropic |
| 15 | `services/claude_vision_extractor.py:498` | shared service (menu page) | anthropic |
| 16 | `services/claude_vision_extractor.py:640` | shared service (PDF) | anthropic |

All paths relative to `services/agent-orchestrator/`.

---

## Q1 — Where does the emitter live?

**Options.**

- **A — extend `SpendLogger.log()` to dual-write** (`api_spend` + `neural_footprint_event`
  in one call).
- **B — separate `NeuralFootprintLogger`**, call sites invoke both loggers.
- **C — A's surface with a separated writer:** `SpendLogger.log()` stays the *only*
  entry point and dual-writes, but NF row construction/insert lives in a small
  `services/neural_footprint.py` module that SpendLogger delegates to.

**Evidence.**

- All 16 sites already funnel through one method (`services/spend_logger.py:41`);
  the funnel is the single most valuable asset the Python side has.
- ADR 0008 keeps `api_spend`'s writers ("not dropped… written alongside",
  `0008-nf-column-contract.md:81-83`), so the api_spend insert cannot move.
- D2 (`decision_log` and `api_spend` unjoinable) happened precisely because two
  loggers with overlapping concerns evolved separately — `log_decision`
  (`core/base_agent.py:743`) and `SpendLogger` never shared a key. Option B
  recreates that failure mode: 16 sites each must remember two calls, and the
  first site that calls one but not the other reintroduces the split.

**Recommendation: C.** One entry point (no call-site churn for baseline emission;
a site that changes nothing still produces an NF row), one separable NF writer
(so the future NF-B guest writer and any gateway-parity work share row-building
vocabulary without importing "spend" semantics). Guarding order inside `.log()`:
api_spend insert first (primary ledger), NF insert second, each in its own
try/except, never-raise preserved (`spend_logger.py:82-84`).

**Cost.** Edit one file, add one small module. Zero call-site edits required for
day-one emission; enrichment (Q2) is incremental.

## Q2 — Signature change: does keyword-only-with-defaults hold?

**Verified: yes, for all 16.** Every site passes every argument by keyword
(`provider=`, `model=`, …); none positional. Adding keyword-only params
(`*, agent=None, task_type=None, correlation_id=None, outcome=None,
duration_ms=None, context=None`) breaks **zero** sites. No exceptions found.

**Who can supply `agent` (→ `subject_id`) honestly:**

| Sites | Can supply? | How |
|---|---|---|
| 1–4 (BaseAgent methods) | Yes | `self.agent_name` is in scope |
| 5–10 (Celery tasks) | Yes | stable worker identity literal (`web_verify`, `research_agent`, `score_agent`) |
| 11–16 (shared services) | **Not by themselves** | a library cannot know its caller; hardcoding the service name labels the library, not the actor |

For 11–16 the honest default is ambient context (Q3): `subject_id` from the
contextvar when an agent/task set one, else the service-name literal as fallback
(better than null — `subject_id` is NOT NULL per ADR 0008).

**Who can supply `task_type`:** all 16 — each has an obvious local literal
(`email_draft`, `profile_extraction`, `summarization`, `invoice_extraction`,
`web_verify_search`, `field_extraction`, `field_search`, `score_search`,
`price_search`, `vision_extraction`, `crawl_extraction`, `snippet_parse`,
`wine_enrichment`, `menu_page_extraction`, `pdf_extraction`). No site would be
forced to pass a useless `None` for `task_type`.

**A constraint the spec does not mention:** `stimulus` and `choice` are NOT NULL
(`0008:52-58`). A spend event must write *something*. Proposed convention:
`stimulus` = the task-type descriptor of what triggered the call; `choice` = a
compact artifact descriptor (e.g. `completion:parsed`, `search:5_results`);
payload details go in `context` jsonb. Full prompts/outputs do **not** go in
these columns (size + PII; the wide research store, still unbuilt per
`0008:123`, is where raw payloads belong). This vocabulary needs sign-off — see
Founder decisions.

**Incidental defect found (pre-existing):** four sites abuse `restaurant_id` to
carry a **wine id**: `jobs/web_verify_tasks.py:313`, `jobs/score_tasks.py:178`,
`jobs/score_tasks.py:220`, `services/haiku_enrichment_service.py:237`
(`restaurant_id=wine_id`). Any consumer of `api_spend.restaurant_id` gets wine
UUIDs for these providers today. The NF emitter should put wine ids in
`context`, not `restaurant_id`; the api_spend misuse belongs in
`v3.0-TECH-DEBT.md` (currently has no spend entries).

**Cost.** Mechanical kwarg additions at 16 sites, doable incrementally; rows are
useful (agent + task_type) at 10 of 16 sites with literals alone, all 16 with
ambient context.

## Q3 — `correlation_id` propagation

**How `decision_log` gets it today.** `BaseAgent._process_with_retry` extracts it
from the incoming RabbitMQ message (or mints a uuid4) into
`self._current_correlation_id` (`core/base_agent.py:549-551`), and
`log_decision` writes that instance attribute (`core/base_agent.py:767`). The
same value also reaches structured logs via `set_log_context`
(`core/base_agent.py:552-555`).

**Is it reachable from SpendLogger call sites?**

- Sites 1–4: **yes** — they are methods on BaseAgent subclasses;
  `self._current_correlation_id` is in scope and can be passed explicitly.
- Sites 5–16: **no**. Celery tasks have no message correlation concept (the
  `bind=True` tasks at `jobs/web_verify_tasks.py:143-150` and
  `jobs/score_tasks.py:59-64` do have a Celery task id, `self.request.id`, which
  is a legitimate correlation value for job-originated work). Shared services
  have neither.

**The cheapest honest path.** The codebase already has an ambient-context
mechanism — but it is broken for asyncio: `utils/logger.py:20` stores context in
`threading.local()`, and every coroutine on one event-loop thread shares it, so
concurrently interleaved message handlers clobber each other's
`correlation_id` (last-writer-wins in logs today).

**Options.**

- **a — thread it through signatures.** Honest but high-churn: every
  intermediate function between agent/task entry and the 12 non-agent sites
  grows a parameter. Rejected as the default (fine for sites 1–4 where it is
  one hop).
- **b — `contextvars.ContextVar` ambient context.** Convert `utils/logger.py`'s
  storage from `threading.local` to `ContextVar` (works for threads *and*
  asyncio tasks; values are copied per task). Set it exactly where context is
  already set: `_process_with_retry` (`base_agent.py:552-555`) and a Celery
  `task_prerun` signal handler (sets worker identity + `task_id` as
  correlation). `SpendLogger.log()` reads the ambient values as defaults when
  the caller passes none. Also fixes the existing async log-context bug for
  free.
- **c — do nothing; jobs write null.** Honest but forfeits the join P1 exists to
  create for 12 of 16 sites.

**Recommendation: b**, with explicit `self._current_correlation_id` at sites 1–4
(explicit beats ambient where it costs one line). **Cost:** one storage change in
`utils/logger.py`, one signal handler in the Celery app module, ~4 lines in
SpendLogger. No signature threading anywhere.

## Q4 — Who can honestly set `outcome`?

Per ADR 0008, `null` = *unknown*, never *success* (`0008:105-110`). Site-by-site,
at the line where `.log()` runs today:

**Gradable now — parse result already in scope before the log call (5 sites):**

| Site | Evidence |
|---|---|
| `claude_vision_extractor.py:498` | `parse_json_response` at `:488` returns `parse_error` before the log |
| `claude_vision_extractor.py:640` | parse at `:630`, log after |
| `vlm_extraction_service.py:283` | `_parse_response` at `:276`, log after |
| `vlm_extraction_service.py:551` | `_parse_crawl_response` at `:544`, log after |
| `visual_verification_agent.py:616` | log runs only after `json.loads` succeeds (`:604`) — see defect below |

**Gradable after a small, honest refactor — move the log below the parse (7 sites):**
`research_tasks.py:515` (parse at `:524`), `research_tasks.py:569` (parse at
`:579`), `haiku_enrichment_service.py:230` (parse at `:241`),
`web_verification_service.py:236` (`model_validate_json` at `:246`),
`provider_communication_agent.py:516/985/1112` (draft/fields/summary artifacts
already materialized in scope).

**Cannot honestly grade — write null (4 sites):** the Serper sites
(`web_verify_tasks.py:307`, `research_tasks.py:730`, `score_tasks.py:172`,
`score_tasks.py:213`). An empty result set is a *successful search that found
nothing* — grading it `failure` would poison the metric. Record
`context.results_count` instead and leave `outcome` null.

**So `outcome` is real on day one** for 5 sites unmodified and 12 with log-call
moves — *if* parse-level grading is admissible. That is the open question:
"produced a parseable artifact" is a doneability definition in miniature, and
ADR 0008 risk 1 reserves doneability for People & Agent Ops. Mitigation if
approved: write `context.outcome_basis = "parse"` on every graded row so the
basis is explicit and re-gradable later. **This is a founder call** (below).

**Defect found:** at `visual_verification_agent.py:616` the spend log sits
*after* `json.loads` inside the same try; a parse failure jumps to the except
(`:628`) and the regex fallback — **tokens spent, row never written**. Failure
paths are currently under-counted in `api_spend`. The NF refactor should hoist
the log so both outcomes emit.

## Q5 — The client-per-call pattern

**The facts.** `spend_logger.py:68-70` runs `create_client(...)` on every call.
Meanwhile `Settings.supabase_client` is already a lazy singleton property
(`config/settings.py:225-237`) behind the `lru_cache`'d `get_settings()`
(`config/settings.py:240-242`) — the sanctioned pattern exists and SpendLogger
ignores it. Per-call cost: client object construction plus a **fresh TCP+TLS
handshake per insert** (no connection reuse), executed synchronously — including
from async contexts, where the docstring's "<50ms" assumption
(`spend_logger.py:36-38`) is optimistic for a cold connection; realistic
cold-path is ~100–300ms of event-loop blocking. *Not benchmarked — reasoned
estimate.*

**Expected volume.** Budget-capped: web-search $5/day at $0.001/query ≤ 5,000
Serper calls/day (`config/settings.py:55-59`), research 125+ records/day at
≤ $0.04/record (`config/settings.py:62-70`, ~20 calls/record ceiling). Order of
low thousands of `.log()` calls/day, bursty inside Celery batches. Dual-write
doubles the insert count.

**Options.** Leave it (volume survivable; "optimise" is not free); switch to
`get_settings().supabase_client` (one line, existing pattern); build an
async/queued emitter (no evidence of need).

**Recommendation: switch to the existing singleton — now, because the file is
being rewritten anyway.** This is not speculative optimisation: the singleton
already exists as this codebase's pattern, the change is one line, and dual-write
doubles the price of keeping the bad pattern. Do **not** build batching or a
background queue — nothing at this volume justifies it, and a queue adds a
losable buffer to a ledger whose whole point is honesty. One caveat to verify at
implementation time: the shared sync client's behavior under Celery prefork
(lazy init per worker process makes this a non-issue in the default setup) and
under any threaded/gevent pool.

## Q6 — `base_agent.py`, OD-52, and where agent-level emission hooks in

**The constraint.** `core/base_agent.py` has zero LLM integration — it is
RabbitMQ/saga/DLQ/idempotency infrastructure (OD-52,
`.planning/decisions/OPEN-DECISIONS.md:46`). A BaseAgent lifecycle hook or
middleware **cannot observe token usage it never sees**; option (a) below is
rejected on that evidence, not on taste.

**What the codebase actually has:**

- The sanctioned LLM seam exists: `services/model_clients.py` singletons
  (`get_gemini_client` `:52`, `get_haiku_client` `:73`) — but **18 files
  construct SDK clients directly**, bypassing it (grep for
  `AsyncAnthropic(`/`genai.Client(` across `agents/ services/ jobs/`).
- **12 of those files make model calls with zero spend logging** — the Python
  side has its own D3. Verified call-site counts: `agents/sommelier_agent.py`
  (4), `agents/email_parsing_agent.py` (2), `services/wine_matcher.py` (2),
  `services/email_composer_service.py` (2), `agents/rfq_agent.py` (1); the
  remaining 7 files (calendar, provider_conversation, procurement,
  auction_wine, wine_book_scraper, wine_field_parser, menu_analyzer) create
  clients but were not individually audited for call counts. **These are outside
  P1's 16-site scope** — see Founder decisions.

**Options.**

- **a — BaseAgent lifecycle/middleware hook.** Impossible; see above.
- **b — instrument `model_clients.py`** (wrap the returned clients so every
  `messages.create`/`generate_content` emits). Covers only compliant callers —
  a minority today — and proxying two SDK surfaces is fragile across versions.
- **c — ambient context + one funnel + a CI ratchet.**
  `_process_with_retry` sets the Q3 contextvars, so *any* emission anywhere in
  an agent's call tree is attributed to the right agent and correlation without
  touching the 26 agent modules; `SpendLogger.log()` stays the single emission
  funnel; and the P1 CI guard (spec §5.4) gets a Python mirror —
  `scripts/check_model_calls_logged.sh` also fails a Python file that contains
  `messages.create`/`generate_content` but never references the funnel, and
  flags SDK-client construction outside `model_clients.py`. The 12 dark files
  become an explicit, shrinking allowlist rather than an invisible hole.

**Recommendation: c.** Attribution is automatic for every agent; emission
remains at the call site because there is no honest zero-touch way to observe
tokens the base class never sees. Revisit **b** as the long-term consolidation
when OD-52's real question ("which reasoning layer sits ON our messaging
infra") is resolved — a reasoning layer, unlike BaseAgent, *would* be the
natural single seam.

---

## Founder decisions needed

1. **May `outcome` be graded on a parse-level basis** (recorded as
   `context.outcome_basis = "parse"`), or must Python rows stay `null` until
   People & Agent Ops defines doneability? Determines whether `outcome` is real
   on day one at up to 12 of 16 sites, and touches ADR 0008 accepted-risk 1.
2. **The `stimulus`/`choice` vocabulary for machine spend events.** Both columns
   are NOT NULL; the proposed convention (stimulus = task descriptor, choice =
   compact artifact descriptor, payloads in `context`, never raw prompts) is a
   semantic commitment about what a footprint *is* — ADR 0006/0008 territory,
   not an implementation detail.
3. **Scope of the 12 dark files.** P1's Python scope is the 16 SpendLogger
   sites; the 12 files making unlogged model calls are a second, larger hole.
   Instrument them inside P1 (scope grows materially), or ratchet via the CI
   allowlist and burn down as a follow-up (hole persists, but visibly)?

*Not founder calls, recorded for the register:* the `restaurant_id=wine_id`
misuse (4 sites, Q2) and the visual-verification lost-spend-on-parse-failure
defect (Q4) are pre-existing bugs to fix in passing and to add to
`v3.0-TECH-DEBT.md`.

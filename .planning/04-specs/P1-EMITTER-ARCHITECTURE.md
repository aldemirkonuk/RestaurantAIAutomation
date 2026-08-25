---
type: spec
id: P1-EMITTER
title: NF-A gateway emitter architecture
status: proposed
updated: 2026-08-24
links: ["[[P1-NF-A-INSTRUMENTATION]]", "[[0008-nf-column-contract]]"]
---

# P1 Emitter — architecture proposal for the NestJS gateway

> Detail spec for [P1 §5 step 3](P1-NF-A-INSTRUMENTATION.md) (the "gateway emitter").
> **Retire-to-write:** this document is scheduled to merge back into the P1 spec (as a
> resolved §5.3 appendix) once the emitter ships — it names its own retirement.
> All `path:line` citations verified on branch `feat/p1-nf-instrumentation`, 2026-08-24.
> Research only — no implementation code was written.

## 0. The call-site survey (evidence backbone)

All seven sites hit `https://api.anthropic.com/v1/messages` over raw HTTP. **None reads
`response.usage`. None computes cost. None writes to `api_spend` or
`neural_footprint_event`.** (`grep -rn '\.usage' <7 files>` → zero hits.)

| # | Site | HTTP lib | Timeout | Retry | Model (source) | Failure handling today |
|---|---|---|---|---|---|---|
| 1 | `apps/api-gateway/src/ux-optimizer/ux-optimizer.service.ts:266` | fetch | **none** | none | `UX_OPTIMIZER_MODEL` env → `claude-haiku-4-5-20251001` (:248-250) | throw → caught at :212, falls back to `heuristicProposals` :214 |
| 2 | `apps/api-gateway/src/vendor-intel/vendor-page-extractor.service.ts:179` | fetch | 120s (`AbortSignal.timeout`, :192) | none (the 2s delay at :331 is scrape politeness, not retry) | `ANTHROPIC_EXTRACTION_MODEL` env → `claude-haiku-4-5` (:68-73) | non-OK / throw → `skippedReason`, result returned (:196, :204) |
| 3 | `apps/api-gateway/src/common/orchestrator/inbound-responder.service.ts:758` | axios | 60s (:768) | none | `NEGOTIATION_MODEL = "claude-haiku-4-5"` const (:21) | catch → `return null` (:774-778); analysis silently absent |
| 4 | `apps/api-gateway/src/inventory/photo-count.service.ts:57` | axios | 30s (:88) | none | `claude-haiku-4-5` hardcoded (:60) | catch → `ServiceUnavailableException` (:94-99) |
| 5 | `apps/api-gateway/src/procurement/documents/document-extractor.service.ts:117` | fetch | **none** | none | `DOCUMENT_EXTRACTION_MODEL` env → `claude-haiku-4-5` (:72-77) | non-OK → throw (:132-134); propagates to caller |
| 6 | `apps/api-gateway/src/menus/parsers/scan-parser.service.ts:258` | axios | 180s (:301) | **yes** — truncation-triggered PDF re-chunking, recursive, depth ≤ 3 (:125-141, :154-225, cap :164); failed chunks tolerated (:199-217) | `claude-haiku-4-5` hardcoded (:261) | catch → `ServiceUnavailableException` (:321-326) |
| 7 | `apps/api-gateway/src/analytics/consultants.service.ts:159` | fetch | **none** | none | `ANALYTICS_CONSULTANT_MODEL` env → **`claude-opus-4-8`** (:154-156) | non-OK / catch → `{enabled:true, error}` payload (:179-184, :212-215) |

Confirms Architecture Review AR-3 exactly: 1/7 retries (and it is a *semantic* re-chunk
retry, not a transport retry), 3/7 no timeout, the other four disagree (30/60/120/180s).
Sites 3, 4, 6 use axios; 1, 2, 5, 7 use fetch — two error-object shapes for the same API.

Two sites already read `stop_reason`: scan-parser uses `max_tokens` as its truncation
signal (:306-313) and consultants checks `refusal` (:187). Any emitter design must hand
the **raw response payload** back to the call site — a text-only convenience wrapper
would break both.

Relevant infrastructure:

- `apps/api-gateway/src/database/database.service.ts:8` — `public supabase: SupabaseClient`,
  persistent client created once at module init (:22). `DatabaseModule` is `@Global()`
  (`database/database.module.ts:5`), so any provider can inject it with zero imports plumbing.
- `common/` module convention: one directory, `<name>.module.ts` (providers + exports only,
  see `common/cache/cache.module.ts:4-8`) + `<name>.service.ts` with `Logger`, `ConfigService`
  injection, and **degrade-gracefully posture** — CacheService runs with `client = null` when
  Redis is absent and every method no-ops (`cache.service.ts:19-21, 55-63`).
- Python precedent `services/agent-orchestrator/services/spend_logger.py`: creates a Supabase
  client **per call** (:68-70), swallows every exception with an explicit "NEVER re-raise"
  comment (:82-84), and documents the insert at **< 50ms** (:36-39).

---

## 1. Emitter shape — thin logger vs model-client wrapper

### Option A — thin logger

`NfEmitterService.emit(row)` only. Call sites keep their own fetch/axios and call `emit()`
after each request.

- **Diff size:** emitter module ~2 files (~100-130 lines incl. pricing map). Per site:
  +12–20 lines — start a timer, extract `payload.usage`, call `emit()` on the success path
  *and* in every catch/non-OK branch. Seven sites × two paths ≈ **+100–140 lines of
  per-site boilerplate**, all of it copy-paste-prone in exactly the way that produced
  today's 4-way timeout disagreement.
- **Risk:** near zero — no HTTP semantics change.
- **Fatal flaw 1:** it does not consolidate retry/timeout, which P1 §5.3 names as part of
  this step (AR-3). Three sites keep running with no timeout at all.
- **Fatal flaw 2:** the CI guard (P1 §5.4) becomes weak. It must verify every
  `api.anthropic.com` occurrence is *paired with* an emit on *both* paths — a semantic
  check a shell script cannot do reliably. A new call site can call `emit()` on success
  only and pass the guard.

### Option B — model-client wrapper (thin-opinion variant) — **recommended**

One `common/model-client/` module (matching the cache/crypto convention). The service owns:
the URL, API-key resolution, headers, a **default timeout with mandatory per-call
override capability**, **transport-only retry** (network error / 429 / 529 / 5xx, ~2
attempts, jittered, honor `retry-after`; never 4xx, never `refusal` — those are answers,
not transport failures), duration measurement, `usage` extraction, cost computation, and
the `neural_footprint_event` insert. It takes the request **body verbatim** and returns
the **raw parsed payload** — it has no opinion about prompts, models, `temperature`,
beta headers, or what the response means.

- **Diff size:** emitter module ~2 files (~200-250 lines incl. pricing map + retry). Per
  site: **net negative** — each site deletes 20–35 lines of fetch/axios + header + key
  boilerplate and replaces them with one call carrying `{ body, timeoutMs?, headers?,
  nf: { subjectId, taskType, stimulus, restaurantId?, correlationId?, ... } }`.
- **Risk:** concentrated in two edits:
  - **inbound-responder** (1322-line production vendor-email path): must pass through the
    `anthropic-beta: pdfs-2024-09-25` header (:756) and `temperature: 0.4` (:763)
    unchanged. Verbatim-body + extra-headers passthrough covers both; the risk is only
    that the migration edit forgets one.
  - **axios → fetch error-shape change** (sites 3, 4, 6): their catch blocks read
    `error?.response?.data?.error?.message` (inbound-responder:775). All three catch
    generically and degrade, so behavior is preserved, but log detail changes unless the
    wrapper surfaces the API error body on thrown errors (it should).
- **CI guard becomes trivial and strong:** `api.anthropic.com` may appear in exactly one
  file. `scripts/check_model_calls_logged.sh` is a grep, and it cannot be half-passed.

### Which sites resist a wrapper, and why

- **scan-parser (6)** — least, but most instructive: its "retry" is semantic re-chunking
  keyed off `stop_reason === "max_tokens"`, which is an HTTP-200 response; a transport
  retry never touches it. Resistance is only that the wrapper must return the full payload
  (it does) and must not impose its own truncation opinion. Its 180s timeout is
  load-bearing (:295-301 documents why 60s corrupted the truncation signal) — hence the
  mandatory per-call timeout override.
- **inbound-responder (3)** — resists any wrapper that owns the request *body or headers*;
  does not resist a verbatim-passthrough wrapper.
- **photo-count (4)** — its 30s timeout is a product choice (interactive counting UI);
  per-call override again.
- Sites 1, 2, 5, 7 adopt with no friction.

**Recommendation: Option B.** One emission choke point, AR-3 solved in the same edit, a
grep-strength CI guard, and net-negative call-site diff. Cost: two careful migration
edits (3 and 6) that need their existing tests re-run, and the wrapper must stay
opinion-free about response semantics.

Two shared-code details that fall out either way:

- **Cost map lives in the emitter.** Python callers compute `cost_usd` themselves; no
  gateway site does. The emitter holds one `model → $/MTok` table (`claude-haiku-4-5`
  1.00/5.00, `claude-opus-4-8` 5.00/25.00) and writes `cost_usd = null` (never 0) for an
  unrecognized model, so a model swap can't silently write free rows. Tokens are always
  recorded regardless.
- **`stimulus` and `choice` are NOT NULL** (ADR 0008), so the emitter API must *require*
  them. Proposed convention: `stimulus` = what arrived ("inbound_email", "menu_pdf",
  "shelf_photo", "vendor_page", "evidence_pack", "friction_summary", "procurement_doc");
  `choice` = what the call produced (short, per-site, e.g. "analysis+draft",
  "extracted:<n> items"). `subject_id` = service name in the existing `decision_log`
  `agent_name` style — inbound-responder already writes `agent_name: "InboundResponder"`
  (inbound-responder.service.ts:1142) and the emitter should match it exactly so the two
  tables agree on identity.

---

## 2. Write posture — awaited vs fire-and-forget

**Latency:** one HTTPS round trip to Supabase REST — the same hop as every other gateway
DB write. The Python side documents the identical insert at < 50ms
(`spend_logger.py:36-39`), and the gateway is better positioned: it reuses the persistent
client (`database.service.ts:22`) where Python creates one per call (:68-70). Not
re-measured live in this pass (no credentials in the research session) — flagged per §0.5.

**Existing async patterns checked:**

- The gateway convention for best-effort side writes is **`void this.<promise>`**
  fire-and-forget: `inbound-responder.service.ts:368,436,577`,
  `idempotency.interceptor.ts:65`, `promotion-extractor.service.ts:225`,
  `rabbitmq-bridge.service.ts:639` (~30 occurrences repo-wide).
- **No outbox exists** — `inventory-ledger.service.ts:508` explicitly declined one
  ("needs to survive one request, not an offline outbox"); the mobile "outbox" is
  client-side.
- **No gateway→queue publish path** — `rabbitmq-bridge.service.ts` is consume-only
  (Python publishes, gateway bridges to WebSocket).

**Recommendation: fire-and-forget, no queue.** `emit()` returns `void` and resolves its
own promise internally (equivalent to the `void this.` convention, but enforced inside
the emitter so no call site can forget it). Rationale: three of the seven sites are
interactive user paths (photo-count, scan-parser, consultants) where +50ms of ledger
latency buys nothing; the gateway is a long-lived process (RabbitMQ consumer, WebSocket
gateway), so an un-awaited promise is not at risk of a serverless teardown. Inventing a
queue/outbox for a ledger insert would violate the observe-before-deciding posture of P1
— the DB write is the same class of write `logDecision` already does inline.

Trade-off accepted: a crash between response and flush loses that row. The Python side
accepts the identical trade; P1 is a measurement system, not an accounting system of record.

---

## 3. Failure posture — should the gateway match "never re-raise"?

**Yes, exactly.** The Python contract (`spend_logger.py:82-84`) is the correct one here,
and the blast radius if an emit failure propagates is concrete at every site:

- **consultants.service.ts:212** — the catch would convert a *paid, successful* Opus call
  into a user-facing `{error: "Consultant call failed"}`. Money spent, answer discarded,
  and the failure is attributed to the model rather than the ledger.
- **document-extractor.service.ts** — there is no try/catch after the response (:137-141);
  an emit throw propagates out of `extract()` and a correctly parsed invoice is lost
  downstream after paying for the extraction.
- **inbound-responder.service.ts:774-778** — a throw inside the analyze path returns
  `null` analysis: the vendor email is never summarized, never drafted, never synced onto
  the order. A telemetry insert failing would silently stall a live negotiation.
- **scan-parser / photo-count** — both convert any throw into
  `ServiceUnavailableException`: a Supabase blip would present to staff as "menu scan
  unavailable" while the Anthropic call actually succeeded.

The instrument must never break the thing it measures. **Contract:** every emit path is
wrapped; on failure, `Logger.warn` (matching CacheService's degraded posture) plus
optionally `SentryService.captureMessage` so sustained emitter failure is visible —
silent-forever is the one way "never re-raise" goes wrong, and the Python side has only a
log line. The wrapper's *transport* errors (the model call itself failing) still throw to
the call site exactly as today — only *emission* is swallowed.

---

## 4. `outcome` per site — honest determinability on day one

ADR 0008: `null` = unknown, never success; a site that cannot honestly determine writes
null. Assessment of what each site can *honestly* know at the call site, today:

| # | Site | success | failure | partial | Basis (evidence) |
|---|---|---|---|---|---|
| 1 | ux-optimizer | ✅ proposals parsed | ✅ throw (falls back to heuristic, :212-214) | — | parse is strict (`JSON.parse` :290); no middle state |
| 2 | vendor-page-extractor | ✅ items extracted | ✅ `skippedReason` from model call (:196,:204) | ⚠️ defensible when `extraction.rejected > 0` (:210) — but `items=0` on a real page is ambiguous (empty page vs failed extraction) → write **null** for that case |
| 3 | inbound-responder | ✅ `parseAnalysis` non-null (:773) | ✅ call error or unparseable (:777, :836) | — | binary by construction: reply_body required (:795) |
| 4 | photo-count | ✅ JSON parsed (:114) — note `suggestedQty: null` with a clean parse is still success (an honest "can't count") | ✅ throw (:94) | ✅ model replied but unparseable (:133-142) | |
| 5 | document-extractor | ✅ JSON parsed | ✅ HTTP error/throw (:132-134) | ✅ the confidence-0 "did not return readable JSON" sentinel (:159-184). Do **not** map `tiesOut=false` to partial — a failed tie-out can be the *vendor's* arithmetic, not the model's (:150 doc comment) | richest site |
| 6 | scan-parser | ✅ parsed, not truncated | ✅ throw (:321-326) | ✅ **the clearest partial in the codebase**: `stop_reason === "max_tokens"`, salvaged items (:306-319); chunk-level gaps too (:212-217) | |
| 7 | consultants | ✅ ≥1 claim parsed (:198) | ✅ HTTP error (:179), `refusal` (:187), throw (:212) | ✅ 200 with non-JSON output → `claims=[]` (:199-201) | |

**Conclusion: `outcome` is *not* mostly-null on day one.** All seven can honestly write
success/failure at the *call* level; four (4, 5, 6, 7) have an honest partial. The P1 §2
`outcome_unknown` count would be small and confined to genuinely ambiguous cases (e.g.
vendor page with zero items).

**The caveat that makes this a founder decision:** these are **call-level** outcomes
("did this model call return a usable artifact"), not the task-level doneability that
People & Agent Ops owns. ADR 0008 accepted risk 1 says the column must not pre-empt that
definition, and its revisit trigger is "outcome semantics diverge across call sites."
Writing call-level outcomes now is useful and honest *if* labeled: proposal — record the
tri-state as above and stamp `context.outcome_basis = "call_level_v0"` on every gateway
row, so a future doneability definition can re-grade or exclude v0 rows without
archaeology. The alternative (failure-only now, success→null) keeps the column pure but
makes `cost_per_completed_task` all-unknown from the gateway on day one. See §7.

---

## 5. `correlation_id` — what exists, and the cheapest honest join

**The gateway has no request-scoped correlation.** Verified:

- The only global interceptor is Sentry (`app.module.ts:127-131`), which captures
  url/method/user on *errors only* and mints no ID (`sentry.interceptor.ts:24-46`).
  Guards are RateLimit + Tenant; no middleware, no `AsyncLocalStorage`/CLS anywhere
  (repo-wide grep: zero hits).
- The `events` table's `correlation_id` is **client-supplied** via DTO
  (`events.service.ts:127`) — not a server facility.
- Precedent for per-operation IDs exists: `analytics/recommendations.service.ts:398`
  mints `crypto.randomUUID()` per logical operation.

**How Python rows get theirs:** `correlation_id` rides the RabbitMQ message —
`base_agent.py:549-550` (`message.get("correlation_id") or uuid4()`), re-injected on
publish (:660-662, `message_bus.py:672-680`) and written to `decision_log`
(`base_agent.py:773`).

**Exactly one gateway flow shares a correlation chain with Python:** inbound email.
Python email agents publish `email.inbound.received` (with correlation_id in the body);
the gateway consumes it (`rabbitmq-bridge.service.ts:227-229` → `handleInboundEmail`
:528) — **and drops the correlation_id on the floor**: `InboundContext`
(inbound-responder.service.ts:72-88) has no field for it.

**Cheapest honest plan:**

1. **Inbound-email path (site 3):** extract `msg.correlation_id` in `handleInboundEmail`,
   add one optional field to `InboundContext`, pass it to the emitter. This is the only
   place a gateway NF row can *truthfully* join a Python `decision_log` row, and it costs
   ~5 lines. **Bonus fix discovered:** the gateway's own `decision_log` insert
   (inbound-responder.service.ts:1135-1168) also omits `correlation_id` despite the
   column existing — thread the same value there and the two tables join for free.
2. **The other six sites:** no Python counterpart exists, so any "join" would be
   fabricated. Mint `crypto.randomUUID()` **per logical operation** (not per HTTP call),
   matching the recommendations precedent. This is not busywork: scan-parser's N chunk
   calls and vendor-sweep's per-vendor calls then share one ID, which is what lets the §2
   query see "one menu import cost $X across 9 calls" — a real query today's schema
   cannot answer.
3. **Do not build** request-scoped correlation (CLS interceptor + header propagation) for
   P1. It is the right eventual answer if operator-facing HTTP requests ever need to join
   NF rows (`subject_type='operator'` — ADR 0008 tracking decision), but it is a
   cross-cutting change to every request path, and nothing in P1's done-criteria needs it.
   Named here so it is deferred deliberately, not forgotten.

---

## 6. Incidental findings (recorded so they are not rediscovered)

1. **Gateway `decision_log` rows have null `correlation_id`** — writer exists
   (inbound-responder.service.ts:1135) but never sets the column. Fixable in P1 step 3
   for ~2 lines (§5.1 above).
2. **No site reads `usage`** — token capture is new code everywhere; the emitter shape
   decision changes *where* it lives, not *whether* it must be written.
3. **Model inventory in play:** `claude-haiku-4-5` (5 sites, one as the dated
   `-20251001` pin at ux-optimizer:250), `claude-opus-4-8` (consultants), plus 4 env
   overrides (`UX_OPTIMIZER_MODEL`, `ANTHROPIC_EXTRACTION_MODEL`,
   `DOCUMENT_EXTRACTION_MODEL`, `ANALYTICS_CONSULTANT_MODEL`). The pricing map needs
   exactly two entries today; unknown models must produce `cost_usd = null`, not 0.
4. **Retry accounting:** with transport retry in the wrapper, one wrapper invocation =
   one NF row (duration spans retries, `context.attempts = n`). Failed transport attempts
   are not billed by Anthropic, so per-invocation rows remain an honest cost ledger.

---

## 7. Founder decisions needed

Only items that genuinely need a human call; everything else above is proposed and will
proceed as written unless overruled.

1. **Emitter shape.** Adopt the model-client wrapper (Option B)? It edits all seven
   production call paths — including the live vendor-negotiation path — in exchange for
   AR-3 consolidation and a grep-strength CI guard. The thin logger is the low-risk /
   low-value alternative and leaves P1 §5.3's retry/timeout consolidation undone.
2. **`outcome` day-one semantics.** (a) Call-level tri-state now, stamped
   `context.outcome_basis = "call_level_v0"` (recommended — makes §4's table real
   immediately), or (b) failure-only, success→null, until People & Agent Ops defines
   doneability. This touches ADR 0008 accepted-risk 1; (a) arguably needs a one-line
   amendment to that ADR's mitigation text.
3. **Default transport retry on for all sites.** Behavioral change: six sites currently
   fail on the first 429/529 and would now silently retry (bounded, ~2 attempts). Photo
   count and menu scan are interactive — retry adds worst-case latency there. On by
   default with per-call opt-out, or off by default?
4. **Correlation threading scope.** Including the rabbitmq-bridge + `InboundContext` +
   `logDecision` correlation fix in P1 step 3 touches files outside the seven call sites.
   Include (recommended — it is the only real Python-join and ~7 lines), or split to its
   own branch per the one-operation-per-branch rule?

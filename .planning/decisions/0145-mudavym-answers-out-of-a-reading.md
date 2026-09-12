# 0145 — Mudavym answers out of a reading, and only the query that ran may mint one

- **Status:** Locked on the founder's call, 2026-09-12 — the deferred half of [[0133-a-public-page-has-no-house-so-the-public-door-has-one-switch]] decision 2. Five forks named below are deliberately NOT defaulted and remain open.
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Date:** 2026-09-12
- **Keywords:** ask, /ask, Mudavym, assistant, reading, finding, provenance, hollow build, refusal shapes, seal, ask-ai, sommelier
- **Links:** [[0133-a-public-page-has-no-house-so-the-public-door-has-one-switch]] (locked the surface, deferred the design), [[0113-the-assistant-proposes-the-seal-applies]], [[0083-a-page-may-not-claim-a-write-it-never-makes]], [[0020-no-fabricated-answers]], [[0114-connections-are-the-houses-profile-is-the-persons]] (new route, off = redirect), [[0143-the-arrival-the-desk-the-sommelier-and-the-two-rooms]] §3 (the sommelier is pointed at `ask-ai` and its conversations move behind the gateway), [[0115-the-house-item-is-the-ledgers-key]], [[0124-a-bottle-has-one-identity-and-every-price-names-it]], [[0111-the-calendar-is-the-houses-day-book]]

---

## The choice, in one paragraph

Three designs were drawn independently and each was attacked twice. All three reached the same answer to the `/sommelier` failure — compute the evidence first, make the sentence a caption bound to it — so that inversion is not what you are choosing. What you are choosing is **what a builder is forced to produce before the page will render anything**, and there are three candidate forcing functions: a *shelf* at the top of the page that counts every register the house keeps and forbids any figure whose register is not on it (Option 1); a *ticket* that makes answering and acting the same typed work object, so an answer and a purchase order travel the same rails (Option 2); or a *binding* in which every figure in every sentence carries an id that must resolve inside the reading that produced it, and a sentence whose id does not resolve is demoted to a refusal (Option 3). The six adversarial passes agreed on one thing, and it is the finding that decides this record: **none of the three forces anything, because in all three the provenance is a field a builder fills in** — a shelf state, a `sourcesQueried` array, a `scanned` count are all strings and numbers somebody types, and a page shipped with an empty engine behind an honest-looking shelf renders identically to a working one, passes every check the designs name, and looks finished. Worse, on this estate the *correct* build refuses most questions, so the one alarm the designs propose — a high refusal rate — is also the designed, expected state. So the recommendation is Option 3's binding, with the provenance moved out of the builder's hands and into the query runner, plus a compile-time census of what the page can be asked, plus a named non-zero floor of working readings as a condition of shipping at all. **The sentence to accept or overrule: build the bound reading, mint every figure and every source outcome from the query that actually ran, declare the question classes exhaustively so an unbuilt one fails to compile, and do not ship /ask until a named list of readings passes a per-reading fixture test.**

---

## Context

[[0133-a-public-page-has-no-house-so-the-public-door-has-one-switch]] locked four things about the assistant on 2026-09-06 and deferred one. Locked, verbatim from that record (read at `origin/feat/mudavym-new-pages:.planning/decisions/0133-…md:87-93`): the assistant is *"a page plus the Ask AI panel"*, the page's route is `/ask`, the panel stays where it is and opens the same backend; the flag is `mudavym_design_ask` meaning *"this surface exists here"* with off a redirect, not an old design; and the name is **Mudavym** — *"The house answers as itself. Every sentence the assistant speaks, the nav entry and the page title say Mudavym, never 'agent', 'AI' or 'bot'."* Deferred: *"The assistant's design is NOT decided here — it becomes its own record after the research fan-out."* This is that record.

Two other locked records bind it. [[0113-the-assistant-proposes-the-seal-applies]] Rule 6: every proposal row names the source it was drawn from, because *"a read the owner cannot trace is a read they cannot judge"*. [[0083-a-page-may-not-claim-a-write-it-never-makes]] and [[0020-no-fabricated-answers]]: a page may not claim what it does not do, and may not invent a number.

### The cautionary example, and why it is not the example everyone thinks it is

`/sommelier` was measured on 2026-09-12 and found to be four defects at once: it posts to `/api/v1/sommelier/chat`, a route the Python orchestrator does not mount (re-verified here: `grep -rn "include_router" services/agent-orchestrator/main.py | grep -ci sommelier` returns **0**, while `apps/web/src/pages/SommelierAI.tsx:241` posts to exactly that URL); it reads its history browser-to-Supabase on the anon key under a `user_id = auth.uid()` policy with no session given to that client; its loader turns a denial and an empty account into the same value; and its footer claims it *"uses your inventory and sales data"* while calling no sales endpoint and running no model.

The instinct is that the lesson is "wire the backend". It is not. **Four of those four defects were committed by a builder, and zero by a model.** Every apparatus the three designs propose for constraining the model — route-as-JSON, grounding against a candidate set, no bare digits in prose, slot-filling — is aimed at a channel that was never the problem. That observation, made independently by the first adversary against Option 1, is the single most load-bearing input to this decision.

### What the gateway can do today, and what it cannot

Measured by me on this tree (`/Users/aldemirkonuk/Projects/wt-p4`, `feat/mudavym-design-p4`, `git log --oneline -1` = **ca869d72**; note this is *not* the `86575566` the briefing packets quote — `git log --oneline 86575566..HEAD | wc -l` returns 1, and `git log --oneline 86575566..HEAD -- apps/api-gateway/src/ask-ai/ apps/web/src/components/askai/ | wc -l` returns **0**, so the briefing's ask-ai measurements still describe the tree):

- The module is **11 files** (`git ls-tree -r --name-only HEAD -- apps/api-gateway/src/ask-ai/`) and **none** is a DTO. Both POST bodies are inline TypeScript type literals, so the global `ValidationPipe` validates nothing.
- It answers no questions. It maps one utterance onto one of two allowlisted acts — `procurement.reorder`, `communications.vendor_draft` — or declines.
- Its one genuinely good property is worth preserving verbatim: a failed candidate read **throws** rather than returning an empty list (`ask-ai.service.ts:214-227`, read this session: the loop over `[inventory, providers, orders]` logs and then `throw new ServiceUnavailableException("Ask AI is temporarily unavailable.")`). That is the `/sommelier` collapse already closed, once, in one place.
- `grep -rn "ThrottlerModule\|@Throttle\|ThrottlerGuard\|nestjs/throttler" apps/api-gateway/src | wc -l` → **0**. `grep -rn "APP_FILTER" … | wc -l` → **0**. `grep -rn "@Catch" … | wc -l` → **0**. `grep -rn "SealChallengeService" apps/api-gateway/src/ask-ai/ | wc -l` → **0**.
- `SEAL_SUBJECT_KINDS` (`apps/api-gateway/src/common/seal/seal-subject.ts:129-139`) has exactly **9** members — `mcp_tool`, `mcp_tool_grant`, `procurement_order`, `payment_method`, `price_index_upload`, `house_mail_export`, `text_credit_purchase`, `commodity_exposure`, `procurement_document`. None is a read, a proposal, or a configuration batch.
- Neither the route nor the flag exists here: `grep -rn 'mudavym_design_ask' apps supabase services | wc -l` → **0**, and `MUDAVYM_PAGES` (`apps/web/src/lib/mudavym/useMudavymDesign.ts:34-61`) has 19 entries and no `'ask'`. Both exist on the sibling branch (`git grep -n "mudavym_design_ask" origin/feat/mudavym-new-pages` → `feature-flag-registry.ts:276`, plus `/help` already rendering a link to `/ask`).

### The house this page is for

Every production row count below is an earlier session's dated measurement, re-read from records on this tree and **not re-measured by me** — the instruction was repository-only and I queried no database. They should not be quoted without their dates. As of 2026-09-03: `restaurant_inventory` 206 rows across 7 of 14 restaurants; `inventory_lots` 138; `procurement_orders` 2, neither carrying a date; `pos_checks` 173 rows over 26 distinct days, 22 of them one restaurant; `procurement_documents`, `vendor_price_observations`, `price_history` 0. Gateway attention is inversely correlated with that reality — `procurement_documents` 36 call sites over 0 rows, `vendor_price_observations` 19 over 0 (call-site counts from the grounding pass, not re-counted here).

Two schema facts I did re-measure, because they change what the page may honestly say:

- **Registers are not all house-keyed by one column.** `awk '/^CREATE TABLE public.providers \(/,/^\);/' supabase/migrations/20260805000000_baseline_from_production.sql | grep -n restaurant_id` → `restaurant_id uuid,` — **nullable**, with `restaurant_providers` as a parallel ownership table. Same for `vendor_price_observations` (`20260805154027_vendor_price_observations.sql`, line 7: `restaurant_id uuid,`). `DevTruthService.reach()`'s `.eq("restaurant_id", restaurantId)` count is safe only over its own seven sources, all of which are `NOT NULL`.
- **Values that are present are frequently defaults nobody chose.** In the `restaurant_inventory` block: `threshold_min integer DEFAULT 3 NOT NULL`, `unit_type … DEFAULT 'BOTTLE'`, `pour_size_ml double precision DEFAULT 150`, `bottle_size_ml integer` (nullable). In the library: `bottle_size_ml integer DEFAULT 750 NOT NULL` (baseline:3521). And `inventory.service.ts:70-77`, read verbatim this session, computes `glassesPerBottle` from `row.master_wine_library?.bottle_size_ml ?? 750` and `row.pour_size_ml ?? defaultPourMl`. Because the library column is `NOT NULL`, that `?? 750` **cannot fire** — the operand arrives non-null and full of the default. A keg reports as five glasses and no nullish check anywhere can see it.

### The precedents this house has already earned

Three, and they matter because the recommendation is built out of them rather than invented:

1. `logs-timeline.service.ts` returns `sourcesQueried` and `failedSources` beside its events, with the comment *"`null` — not an empty result — is what says 'not queried', so the skip is reported as a skip"*. Read this session: `SourceResult` is `{source, events, error}`, and `sourcesQueried: queried.map((r) => r.source)` is **derived** from the settled results of six enumerated fetches. It exposes two outcomes and nothing else — no row count, no read instant, no connection state.
2. `dev-truth.service.ts:88-101` returns `rows: number | null` per source with the comment *"A count that could not be read is null, never 0. Reporting an unreadable count as zero is the failure this whole surface exists to expose."* Its `SOURCE_TABLE` is a fixed seven-entry map.
3. `one-tap-workflow.ts:55-123` is the census as code: `ONE_TAP_DISPOSITIONS: Record<OneTapActionType, OneTapDisposition>`, *"Exhaustive over `OneTapActionType` on purpose: a tenth type added without a decision about what its 'done' does will fail to compile rather than fall into a default that quietly records"*, with seven of nine acts `{kind: "unbuilt", sentence}` and `dispositionOf` treating an unknown runtime string as unbuilt because *"guessing that an unrecognised act is harmless is how a stub becomes a silent success"*.

And one counter-precedent, which is why a fourth mechanism is needed. `dev-truth.service.ts:289` still asserts, inside a hand-written `limits` array stamped with `generatedAt: new Date().toISOString()`, that *"wine_consumption_log has 0 rows, so no demand series can be truncated at all"* — while the 2026-09-03 census measured 107. Authored claims, server-stamped, rendered as truth, already false. That is the `/sommelier` footer wearing a timestamp, and it is living in the very service two of the three designs propose to promote.

---

## Options considered

All three inherit the same shape for the route: new route, flag `mudavym_design_ask`, off = redirect ([[0114-connections-are-the-houses-profile-is-the-persons]], per [[0133-a-public-page-has-no-house-so-the-public-door-has-one-switch]] decision 2); the ⌘⇧K panel keeps its job as the quick door and its auto-attached page context; the propose→confirm chain is reused whole. They differ in what the page's unit is, which is the same as asking what a builder must produce.

### Option 1 — The catalogued Finding (shelf, book, drawer)

The unit is a **Finding**: a named, catalogued *reading* that was run, the rows it returned, the figure computed from them, the sources touched, the sources that failed, and the instant of the read. The model enters at exactly two points and holds a number at neither — it picks which reading to run (before any data exists) and it writes prose of named slots (after the figure exists). A bare digit in model prose is a hard reject. The page is a **shelf** (one row per register, with a live state), a **book** (a ledger column of folios, each addressable), and a **drawer** (the actual rows behind any figure chip). Its best moment is the unanswerable question: the refusal is a *computed* requirement table — *"to answer this I would read Invoices (0 rows, needs lines on 1+ invoice), Prices (0 rows), Order book (2 rows, satisfied but 1 line item)"* — generated from the reading's declared `requires` plus a live count, which is `DevTruthService.reach()` generalised and un-gated from dev.

**What it costs.** A curated catalogue of fifteen to twenty-five readings, each with an id, a canonical question, an args schema, declared requirements, a unit, a query and a Finding mapper — and each **owned forever**. Conversational range: the assistant answers the catalogue and declines the rest, visibly and often. Fluency: slot-filled prose reads like a ledger clerk. Latency and spend: two model calls per turn on a route with no rate limit. Multi-turn refinement is given up — follow-ups edit stored args rather than growing a message array.

**What the adversaries found, and it is fatal as written.** (a) *The Finding is a struct, not a proof.* Nothing ties any Finding field to an executed query. A reading whose executor is a `return` of a literal renders the design's showcase answer chip for chip, passes grounding, passes the no-bare-digits check, obeys the shelf rule, and touches no database. The design's own sentence — *"printed FROM `Finding.sourcesQueried`, so it cannot name a source the query did not touch"* — is exactly the defect it diagnoses: a sentence about data with no structural dependency on the data existing. The three cited precedents derive honestly only because their source sets are **closed** (six enumerated fetches; a seven-entry map; an array's own `.length`); the catalogue is open and per-reading by the design's own admission. (b) *The designed refusal camouflages the shell.* A build shipping the shelf, six reply components and a stub catalogue answers nothing and looks candid; its counters are indistinguishable from a correct build's, because on this estate the correct build also refuses sales, price and delivery-time questions. The one alarm the design names — a 100 percent `could_not_read` rate — is the one failure a stub never produces. (c) *The shelf's scalar-per-register type is wrong for at least two of the nine registers it names* — `providers` and `vendor_price_observations` are not house-keyed by one column — and because the askable list, the requirement table and the forward path are all computed from the shelf, one mis-keyed scalar produces not one wrong cell but one coherent, cited, timestamped false story: *"Vendors 0, read, as of 14:22"* → *"you have no vendors"* → *"add a vendor"*, to a house that has a vendor.

### Option 2 — The Pass (ticket and work order)

The unit is a **ticket**: an addressable object at `/ask/t/<id>` carrying what was asked, what was read, what was computed and what a person did. Acting and answering are the same machine — a reading is a ticket whose disposition is `answer`, a work order one whose disposition is `act` — and both cite with the same chip. Six card shapes over an exhaustive capability register, the `ONE_TAP_DISPOSITIONS` trick borrowed. Its strongest original contribution is the **work order as a document**: a verb line, `before → after` per field plus an explicit *removes* list, a `because` line per row, a computed *downstream* line, prune-then-seal, and a per-item receipt (`written` / `refused (reason)` / `not attempted (reason)`) carrying a correlation id and the revoke window. It degrades, it claims, to a work-order desk with zero readers.

**What it costs.** The readers are the product and most have no corpus; the capability register is mostly `unbuilt` on day one. Free-form conversation, breadth, speed and voice are all given up. Four blockers must be built first (DTOs, rate limiting, an exception filter, a real seal), and per-item batch receipts, undo, and `configuration_step_skipped` have no data structure behind them.

**What the adversaries found.** (a) *TypeScript types shape, never provenance.* The reach rail — the flagship, whose whole claim is *"a capability claim on this page is a server measurement"* — has no probe anywhere in the design. A builder writes `{id, state:'available', reason}` as literals, stamps `asOf: new Date().toISOString()`, and the rail renders a hand-written claim wearing a fresh timestamp; and `unbuilt` is unmeasurable by definition, so on the design's own account the *majority* of the rail is authored prose the day it ships. The repo has already shipped that artifact and it has already rotted (dev-truth.service.ts:289). (b) *The compile-time trick does not cross HTTP.* The precedent's own `dispositionOf` falls back to `known ?? {kind:"unbuilt"}` at runtime, which is the honest model, not the compile-time one. (c) *The `downstream` line — the one thing the design most insists is a computation — is specified against a column that does not exist.* I verified this: `restaurant_feature_flags` has seven columns (`id, restaurant_id, flag_name, enabled, metadata, created_at, enable_ai_autonomous_send`) and **no `auto_send_enabled`**; `grep -rn "auto_send_enabled" supabase/migrations/ | wc -l` → 0; `grep -rn "auto_send_enabled" apps/ | wc -l` → 0; the only hits in the tree are `services/agent-orchestrator/agents/provider_communication_agent.py:890,900,905`, i.e. a *different process* selecting a column no migration declares. The `0.80` threshold is `settings.py:236`, `float(os.getenv("AUTO_SEND_HEALTH_THRESHOLD", "0.80"))` — another process's environment, which the gateway cannot read. And the gateway swallows the draft trigger's failure, so it cannot know whether a draft was even created. A computation from a wrong model is exactly as false as copy, and now looks verified. (d) *Presence is the wrong axis.* Four rail states measure presence and three provenance classes classify source table; neither can say "present, and nobody stated it", which is the state of most columns in a 40-row house.

### Option 3 — The bound Reading

The unit is a **Reading**: the typed, per-source list of what the house consulted and what each source returned, computed first and rendered first. The sentence is a *dependent view* — a span list where every figure carries a `cellId` that must resolve inside that Reading, validated server-side before the response leaves the gateway and rendered client-side only through a `<Cell>` that looks the id up. An unresolvable span does not warn; it demotes the whole response to a refusal, which is the mechanism `checkActionGrounded` already applies to model-invented ids. Six reply shapes as a discriminated union with no shared fallback; `not_in_your_books` and `could_not_read` are different *types* with different renderers, so the page has no component that could render a denial as an emptiness. The model is gated on the Reading: if a needed source came back unreachable the verdict is decided before the model call, at zero token cost. The ask row is written **before** the model call, which fixes a measured race (the browser aborts at 30 s while the row is inserted after the model returns, orphaning a `proposed` row). The page has memory the panel structurally cannot have: a folio per ask with a URL, standing questions that store a recipe rather than a sentence, and open seals.

**What it costs.** Speed, deliberately — the source-by-source read is spent on screen. Fluency: no free-text summarising of figures, ever. Wine knowledge from the model's own head has no Reading and is therefore either an out-of-scope class or a separately-marked library source (the design explicitly refuses to default this). Multi-turn conversation is not promised. Standing questions are unbuilt in every part.

**What the adversaries found.** (a) *It types the inside of an answer and never the existence of answers.* Every enforcement mechanism lives inside the `answer` shape; the other five shapes reach the screen with no cell, no span and no model call. The cheap build ships the lintel, the ask row, the URL, the seal folios and five of six renderers, and leaves `answer` as a union member never constructed. No type system complains that a producer only ever emits five of six. There is no `not_built` member, so an unfinished answering half must be spelled `out_of_scope` — a claim about the house used to describe what the builder did not finish. (b) *Its single tripwire is unbuildable where it says to build it.* `check_decision_claims.sh` runs `bash -c "$verify"` over the checked-out tree; of 299 CLAIMS rows, none opens a database connection, and a verify that needs production rows lands on the `CANNOT_RUN` classifier and exits 2. (c) *The verdict layer it inherits is defined to ignore this failure*: `ask-ai-verdict.ts:47-50` returns `outcome: null, untestable: "model_declined_out_of_scope_ask"` for a decline — correct for a proposal, exactly wrong for an answering surface whose hollow mode is refusing everything. (d) *The per-source vocabulary has no word for the real state.* Most registers are not empty and not broken; they have never held a row for anyone. Because the shelf and the refusals are possessive — *"Invoices — 0 in your books"* — the page's most prominent element attributes the product's own absence to the operator's bookkeeping. (e) Two of its worked examples are estate totals presented as one house's figures, and its marquee provenance sentence *"from your cellar ledger — 3 lots"* names a register with exactly one gateway read site, which I verified is the SimPOS scenario verifier (`grep -rn '.from("inventory_lots")' apps/api-gateway/src | grep -v spec` → `simpos/scenario-verify.service.ts:463`, one line). Every product read of on-hand is `stock_live`, a trigger projection with a measured second writer that bypasses lots.

---

## Decision

**Build Option 3's binding, with four grafts and nine named repairs. One sentence for the founder to accept or overrule: the page's unit is a Reading, every figure and every source outcome is minted by the query that actually ran rather than written by the reading's author, the question classes are declared exhaustively so an unbuilt one fails to compile, and `/ask` does not ship until a named, non-zero list of readings passes a per-reading fixture test.**

### Why the binding, and not the shelf or the ticket

The three forcing functions are not equally checkable, and that is the whole argument.

A **shelf rule** ("no figure whose register is not on the shelf") is a rule about a page's *content*, and the repo has already measured that this class is not statically decidable — `scripts/check_windowed_figures.py:40-45` says of the near-identical rule that it is *"NOT decidable by static analysis… Any guard claiming to do that would be lying, and a lying guard is worse than none"*, then narrows to seven syntactic proxies. A **ticket type** is a rule about a payload's *shape*, and TypeScript checks shape, never provenance: `state: 'available'` and `scanned: 412` type-check identically whether they came from a `count: 'exact'` query or from a builder's belief. A **binding** — this figure carries an id; that id must resolve inside this Reading; an unresolvable id demotes the response — is the only one of the three that is a *relation between two runtime values*, which means it can be enforced at the seam the response crosses rather than by reading the diff. That is the same mechanical posture `checkActionGrounded` already takes against model-invented ids, with 7 passing tests behind it.

But a binding still only proves the sentence matches the Reading. It proves nothing about where the Reading came from — which is precisely adversary 1's kill on Option 1, restated. So the binding is necessary and not sufficient, and the decisive repair is R1 below: **the runner mints the provenance, not the reading.** With that, the binding becomes a chain that reaches the database: a sentence cannot render without a cell, a cell cannot exist without a Finding, and a Finding cannot exist without a recorded query call.

### Why the honesty apparatus has to be guarded and not merely designed

This repo carries 53 `check_*` guards (`ls scripts/check_*.py scripts/check_*.sh | wc -l` → 53) and 299 CLAIMS rows (`wc -l < .planning/decisions/CLAIMS.jsonl` → 299) precisely because it has already learned that a type and a review are not enough. The exact precedent is `scripts/check_analytics_cost_honesty.py` rule (B), read this session:

> A bare number can be spotted in review. A `basis` label that names a source the value did not come from *survives* review — it is the thing a reviewer checks the number against.

Its remedy is the one this record adopts wholesale: such an entry *"must be built at runtime from the rows it actually covered… so the label cannot drift away from the number the way it already did twice."* `sourcesQueried`, `failedSources`, `rowsScanned` and every cell value on `/ask` are that label.

### What is taken from the rejected options, and why

From **Option 1**: the computed requirement table in a refusal (*"to answer this I would read X, which has N rows and needs M"*), generalised from `DevTruthService.reach()`'s per-source `rows: number | null` counting and un-gated from dev; the rule that thresholds are stated on screen as assumptions, because the service already labels them that way; the forward path offered only where the missing thing can actually arrive; and the re-runnable folio with a versioned reading, so a two-week-old answer says *"as of"* and offers `[read again]` rather than quietly re-asserting itself. This is Option 1's best work and it survives its own adversaries intact.

From **Option 2**: the exhaustive census as code, copied from `ONE_TAP_DISPOSITIONS` including its runtime fallback discipline; the `not_built` disposition with an operator-visible sentence, which Option 3 lacks entirely and without which an implementation gap hides inside `out_of_scope`; and the work order as a *document* — verb line, `before → after` per field, an explicit *removes* list that renders even when empty, a `because` per row, and a per-item receipt rather than one "Done".

**Not** taken from Option 2: the reach rail as specified (authored states), and the `downstream` prediction. The auto-send decision is made later, in another process, on an env-configured threshold the gateway cannot read, against a column no migration declares, behind a trigger whose failure the gateway swallows. `/ask` states only what the gateway itself does, and names the unknown as a first-class state: *"this opens a PENDING order and asks the vendor agent for a draft; whether that letter is auto-sent is decided by the agent when it runs, and this desk cannot see that decision."* Fixing the underlying gate is a separate record, not a clause here.

**Not** taken from Option 1: the nine-register shelf with one scalar per register. The shelf stays, repaired by R6 and R7.

### The repairs, which are part of the decision and not commentary

- **R1 — the runner mints provenance.** Readings receive a recording client whose `.from(t)` / `.rpc(t)` appends the relation and the error-or-rowcount to a per-request trace. After the reading returns, the **runner** builds `sourcesQueried`, `failedSources`, `rowsScanned`, `asOf` and every `cellId` from that trace. A reading that returns a figure whose trace is empty throws — `ask-ai.service.ts:214-227`'s posture applied to a read. Cells are mintable only by the executor; a hand-built Reading literal is not a thing that can exist.
- **R2 — the guard, modelled line for line on `check_analytics_cost_honesty.py` rule (B).** Blocking in CI; exit 2 when it cannot check; proven against a deliberately hollow pre-fix tree. Four arms: no literal assignment to `sourcesQueried` / `failedSources` / `rowsScanned` / a cell value anywhere under the readings directory; no `?? 0` on a register count; no `<HoldToApprove` under the `/ask` page tree without `onChallenge`; no card type declaring a bare `string` field outside a reason-code enum (that last is what actually makes *"uses your inventory and sales data"* untypeable — today nothing stops it).
- **R3 — the census as code.** `Record<QuestionClass, AskDisposition>`, exhaustive, each class mapping either to a named reading or to `{kind: "not_built", sentence}`. A seventh wire shape `not_built` joins the six. An unknown kind arriving from the server falls to `could_not_read`, and that is tested — the compile-time property does not cross HTTP and this record does not pretend it does.
- **R4 — split the counter so the detector can tell the two worlds apart.** `not_built` (the catalogue does not cover this class), `no_reading_matched`, `reading_matched_requirements_unsatisfied` (name the empty registers), `not_in_your_books`, `could_not_read`. One hundred percent of the first means the build is hollow; one hundred percent of the third means the house is empty. Option 3 collapsed these into one bucket and thereby blinded itself. The production distribution is a counter on a route asserted in the nightly, **not** a CLAIMS row — CLAIMS runs over the tree and cannot reach a database.
- **R5 — a stated non-zero floor as an exit criterion.** The build record names the first N readings and their fixtures before a line is written. Nothing in any of the three designs forbids `/ask` shipping with the shelf, the reply shapes, the folio and two readings; that is a shipped shell that passes every check.
- **R6 — a register earns its place on the shelf by declaring one house key, as data.** Each register names exactly one of: a `NOT NULL restaurant_id` column, a named join (`providers` via `restaurant_providers.provider_id`), or a scope function (`vendor_price_observations` via the price-register scope, which has five named read scopes and no single number). A register with no declared key is **absent** from the shelf, not zero, and the page says why. Guarded, in the shape of the existing `scripts/check_price_register_reads_are_scoped.py`.
- **R7 — the sixth state, and a ban on the possessive.** `not_in_service` — Mudavym does not keep this register yet — computed per relation from `scripts/check_queried_tables_exist.py`'s debt tags plus a dated census, written as CLAIMS rows so it re-checks. No chip and no refusal sentence may use a second-person possessive about a register in that state. *"Invoices — 0 in your books"* becomes *"Invoices — Mudavym does not keep these yet."*
- **R8 — statedness is a second axis, not a fourth class.** Every cell carries `{source: house | library | neither}` and `{provenance: stated | defaulted | derived}`. The statedness predicate is per field and is `value <> column_default`, never nullishness — because `?? 750` cannot fire against a `NOT NULL DEFAULT 750` column, which makes Option 1's and Option 2's marquee example a case their own named mechanism misses. The precedent to generalise is `restaurants.threshold_configured`. A figure resting entirely on defaulted cells renders as an assumption, not an answer.
- **R9 — the subject pick is a third model-held decision.** The model chooses the reading, the args, **and which row**; grounding is a set-membership test by its own docblock and cannot catch a wrong pick, and 53 of 206 inventory rows carry a blank name (2026-09-03, not re-measured here) and enter the candidate prompt as identical placeholders. The Finding carries an ambiguity count; when it is not 1 the reading refuses and returns a `clarify` whose branches are the matching rows by id and label.

### The acting half

[[0113-the-assistant-proposes-the-seal-applies]] is unchanged — the assistant proposes, only a person's seal applies — with three additions. Every payload field carries exactly one provenance: *from the books* (with its cell), *you said it* (quoting the span), or *Mudavym's suggestion, from nothing* — in those words. A field with no provenance does not render, so the proposer cannot quietly invent a quantity. The Finding is stored with the proposal and re-run at seal time: if a figure moved, the seal does **not** apply, both numbers render, and it asks again (`verifyStoredAction` already re-checks existence, vendor-active and order-open; the extension is numeric). And the seal is a seal: `HoldToApprove` with `onChallenge`, whose docblock is explicit that a token fetched at the moment of approval *"would be one more thing the same request asked for itself, which is the assertion model with extra steps"*, and that if the challenge cannot be minted the hold does not approve. `onChallenge` is **optional** on that component (read this session) — omitting it compiles, renders identically and approves with `null`, which is why R2 makes its absence on this page a build failure rather than a convention.

---

## Consequences

**Accepted costs.** The assistant declines, visibly and often, and on today's estate that is the majority answer. Prose is stiffer than a chatbot's, because there is no channel through which a model can put a number on screen. Latency is higher and is spent on screen deliberately. There is no multi-turn conversation: a follow-up is a new ask that may inherit the previous Reading, and *"make it 8 instead"* is an edit on the card. Every reading is owned forever, and a reading whose requirements go unsatisfied disappears from the askable list rather than answering badly.

**What must be built, as tasks, none of which exists today.** Each was measured, not assumed:

1. The recording client and the Reading runner (R1). New.
2. The provenance guard (R2), plus a deliberately hollow fixture tree to prove it against. New.
3. The question-class census and its guard (R3), modelled on `check_task_types_are_graded.py`. New.
4. The first N readings, each with two tests — one against a fixture DB with known rows asserting the figure equals the value computed from those rows, one forcing a query error and asserting the reply is `could_not_read` and never `not_in_your_books`. New; this is the largest single item and the real cost.
5. A shelf endpoint: `DevTruthService.reach()` generalised past its seven sources, un-gated from dev (it is 404 under `NODE_ENV=production` today), with the register-key declaration of R6 and the `not_in_service` state of R7.
6. Folio persistence: one new table behind the gateway (utterance, reading id and version, args, Finding jsonb, reply type, proposal id), RLS service-role only with no `authenticated` policy, exactly as `ai_proposed_actions` does it. `sommelier_conversations` **cannot** be reused — it is keyed on `user_id` with no `restaurant_id` column and its only reader in the repo is a browser hook. Per [[0143-the-arrival-the-desk-the-sommelier-and-the-two-rooms]] §3 this one table serves both surfaces and must be scoped that way from the start.
7. DTOs for both ask-ai POST bodies. Today the global `ValidationPipe` validates nothing.
8. Rate limiting. Zero throttler hits in the gateway; the only spend ceiling suppresses retries, never first attempts. A page whose primary control is a text box cannot ship without one. Add the cheap pre-model gate too: when every candidate set is empty, refuse before the model call.
9. The gateway's first exception filter, or return the stored `failure_reason` in the confirm response. Zero `APP_FILTER`, zero `@Catch`; an executor failure is a bare 500 with the real reason only in the row and the log.
10. A seal subject kind for an assistant act, `SealModule` imported into `AskAiModule`, and the challenge redeemed at confirm. Today's confirm is a compare-and-swap under `JwtAuthGuard` alone, with no `created_by` predicate — any member can confirm another member's proposal.
11. `correlation_id` written on the audit row, so `logs-timeline.service.ts:302`'s filter finally has a producer; and `ai_proposed_actions` added as a timeline source so a sealed act from `/ask` appears in `/logs`.
12. A migration adding a Finding, a reason and a correlation id to `ai_proposed_actions`, correcting in the same change the documented-vs-code mismatch on `idempotency_key` (the migration says client-supplied; the service mints it server-side; the exactly-once property actually comes from the CAS).
13. The route, the flag and the `MUDAVYM_PAGES` entry. Both the flag and the entry exist only on `origin/feat/mudavym-new-pages`, where `/help` already links to `/ask` with no route behind it.
14. Removing `AskAiBar.tsx:110`'s `.catch(() => {})`, whose own comment reads *"Fails quiet — an empty list and a broken list look the same to a user."* The panel and the page share a backend and cannot disagree about whether a failed read is an emptiness.
15. Deciding what `WineAgentFab` does. It still floats on every authenticated page pointing at `/sommelier`, labelled "Wine Agent", two lines above the Ask AI mount, and [[0133-a-public-page-has-no-house-so-the-public-door-has-one-switch]] retired "agent" as a word.

**Consequences for other work.** `/sommelier`'s repair ([[0143-the-arrival-the-desk-the-sommelier-and-the-two-rooms]] §3) and `/ask` are now one build, not two: same backend, same folio table, same reply shapes. `DevTruthService` stops being a dev-only surface. The `/logs` timeline gains its first `correlation_id` producer. And item 12's migration must take a version past everything on `main`, per the standing rule.

---

## What this decision does NOT settle

Five of these are genuine founder calls and are surfaced rather than defaulted, per the standing rule that a fork is asked the moment it is found.

1. **The model class and the latency budget, and this is a blocker rather than a detail.** Two model calls per turn against a client that aborts at exactly 30000 ms and a gateway model budget that is itself 30 s, with nothing in the path streaming. `MODEL_FOR_CLASS` maps `lookup`/`help` to `claude-haiku-4-5`, `compose` to `claude-sonnet-5`, `consult` to `claude-opus-4-8`, and its own docblock says the registry exists under an open decision *"which is open precisely because 'no place in the repo says which model does which job'"*. Routing the route step to `lookup` probably closes the budget; nothing records that choice. Founder or architecture call.
2. **Whether Mudavym may answer from the model's own knowledge at all** — *"what goes with lamb"* — as a named out-of-scope class, or as a separately-marked `library` source. The library/house line is real and enforced by the database rather than by editorial policy, so either answer is implementable; which one ships changes the shelf, the placeholder and the decline rate.
3. **What the seal is over** — the proposal id, or the order the proposal creates. Those have different revocation semantics, and none of the nine existing subject kinds fits either.
4. **Whether `/ask` ships to every house or only above a stated floor.** For the house that actually exists the page's honest content is a shelf of mostly-zeros and a list of refusals. That is correct behaviour and better than `/sommelier`; it is also a page named *Mudavym* that mostly declines.
5. **Whether `/sommelier` redirects into `/ask` or the two keep distinct front doors over one store.** [[0143-the-arrival-the-desk-the-sommelier-and-the-two-rooms]] §3 routes the sommelier at `ask-ai` and moves its conversations behind the gateway, but does not say which route survives.

Also not settled, and each belongs to its own record rather than to this one: the catalogue's starting contents (which readings are satisfiable for a given house on a given day is unknown until someone counts, and choosing the first fifteen needs a live count first); reading **versioning and retirement** policy, without which `[read again]` on an old folio compares two different questions; **standing questions**, which are proposed from the page's purpose and have no table, condition language, evaluator or sweep; **mobile**, which has no ask-ai surface at all and for which the shelf-book-drawer shape and a ⌘⇧K door do not transfer; the **auto-send gate's true owner**, which is an orchestrator-versus-gateway question this record deliberately refuses to answer by re-implementing it; and a **real provenance column** for statedness, which R8's `value <> column_default` predicate approximates and cannot replace — it will silently miss a value a person deliberately typed that happens to equal the default.

---

## Founder answers, 2026-09-12 — four of the five forks above

Asked in session the same day the record was locked, each with the measured facts
and the options' costs. Recorded here rather than in a new record, because each
answer closes a fork this record itself named.

**Fork 1, the model and the time budget — answered: pick on Haiku, answer on Sonnet 5.**
The routing step runs as the `lookup` class on `claude-haiku-4-5`; the answer runs as
the `compose` class on `claude-sonnet-5` (`MODEL_FOR_CLASS`,
`apps/api-gateway/src/common/model-client/model-routing.ts:140-144`). `/ask` gets its
own 60 s client budget **on that route only**; every other request keeps the web
client's 30 000 ms (`apps/web/src/services/api/client.ts:52`). Rejected: streaming the
answer — new plumbing on both sides, since today only the MCP runtime streams anything,
and streamed prose is harder to bind to minted provenance, which is this record's
central rule; one Sonnet 5 call doing both — every refusal would cost a Sonnet call and
the pick would stop being a separate, checkable step; Opus 4.8 for consult-class
questions — slowest and most expensive, and without streaming it breaches the budget on
exactly the questions it exists for.

[CORRECTED 2026-09-12, measured at `a914b8cf`: the Context above speaks of "a gateway
model budget that is itself 30 s". That describes Ask AI's call site —
`ask-ai.service.ts:349` passes `timeoutMs: 30_000` — not the model client, whose
`DEFAULT_TIMEOUT_MS` is `60_000` (`model-client.service.ts:12`). The fork stood either
way, because the web client's 30 s abort is the binding limit.]

**Fork 2, answering from the model's own knowledge — answered: yes, marked as not from
the house's books.** "What goes with lamb" gets an answer. It carries a source value of
its own, distinct from `house` and from `library` in R8's `{source}` axis, and renders
as not from the house's books. It is **never** mixed into a figure: a sentence whose
source is the model cannot carry a `cellId`, and the runner, not the reading, sets that
source — the same discipline as R1 applied to prose, so the label cannot be dropped by a
builder any more than a row count can be typed. Rejected: declining everything not in
the books — it declines exactly the questions a new house asks first; allowing model
knowledge only for pairing and service — a class boundary the router must get right on
every straddling question.

**Fork 4, reach — answered: every house, behind the same switch.** `/ask` ships the way
every redesigned page ships: merged dark, flipped per house by the founder. No
readiness floor. A house whose books are thin sees the honest shelf — what Mudavym does
not keep yet — rather than a gate. Rejected: a stated floor below which the page only
explains what unlocks it — a floor to define and defend, a second page state, and a
number that can itself be wrong; holding the page off everywhere — it cannot improve
from real use while off, and "fuller" has no date.

**Fork 5, the sommelier — answered: `/sommelier` redirects into `/ask`.** One front
door, one conversation store, one surface to keep honest. The route survives as a
redirect so no bookmark breaks, the same shape as `/admin/health` folding into `/admin`
([[0143-the-arrival-the-desk-the-sommelier-and-the-two-rooms]] section 2). That removes
the page [[0143-the-arrival-the-desk-the-sommelier-and-the-two-rooms]] section 3
measured as hollow instead of rebuilding it; its repair becomes `/ask`'s build.
Rejected: two front doors over one store — two entry points and a cellar-scoped variant
of every reply shape; rebuilding `/sommelier` first — the same build done twice.

**Fork 3, what the seal is over — answered: the order, at approval.** Asked the same
day, after measuring what a confirm actually does. Confirming an `/ask` proposal
creates only a DRAFT: a reorder goes to `procurement.createOrder` tagged
`source: "ask_ai"`, a vendor reply goes to a draft letter, and the service's own
docblock calls confirm "the FIRST of two human gates, not the only one"
(`ask-ai.service.ts`, `execute`). So confirm on `/ask` stays an ordinary tap, and the
held seal sits where money is actually committed — approving the order, sealed as
`procurement_order` with the act `approve`. That kind already exists
(`apps/api-gateway/src/common/seal/seal-subject.ts:129-139`, nine kinds), so there is
no new subject kind and no migration rebuilding the constraint. It is the shape the
one-tap delivery flow already chose, for the reason it gives: "two cards pointing at
one order must not be two independent permissions"
(`one-tap-actions/one-tap-workflow.ts:145`). For a vendor letter, the seal sits on the
send.

This moves where "The acting half" above re-checks its figures, and the move is part of
the answer rather than a detail: **the reading behind the proposal travels with the
draft order and is re-run at approval.** If a figure moved between the ask and the
approval, the seal does not apply, both numbers render, and it asks again — the same
rule, applied at the gate that commits.

[CORRECTED 2026-09-12 by the answer above: "The acting half" says the Finding is
"re-run at seal time" and that the seal is `HoldToApprove` with `onChallenge` on this
page. Both hold, but the seal and therefore the re-run now happen at order approval,
not on `/ask`.]

Rejected: sealing the proposal at confirm — a new subject kind and a constraint
migration, and one purchase would take two held seals because the order still needs
its own approval; one seal that confirms and approves at once — it removes the second
human gate the service was deliberately built with, so a question becomes a committed
purchase in one gesture.

With this, all five forks this record named are answered.

## Measurement provenance

Everything cited above as a file, a line, a column or a grep count was run by me this session, read-only, on `/Users/aldemirkonuk/Projects/wt-p4` at `feat/mudavym-design-p4`, **HEAD `ca869d72`** — not the `86575566` the briefing packets quote; the branch moved by one commit under the design pass, and that commit touched no ask-ai or askai file, so the briefing's module measurements still describe the tree. Two guards were executed: `scripts/check_queried_tables_exist.py` (PASS, exit 0, 6 shrink-only debt entries) and `scripts/check_read_errors_not_swallowed.py` (PASS, 1444 files scanned, 190 sites, 190 baselined).

**I ran nothing else.** No gateway boot, no HTTP request to any route, no browser, no test suite, no typecheck, no lint, and no database of any kind. Every production row count in this record — 206 inventory rows, 138 lots, 2 orders, 173 `pos_checks` over 26 days, the zeros on `procurement_documents` / `vendor_price_observations` / `price_history`, 4,226 library rows at 750 ml, 53 blank inventory names, 14 houses on USD — is an earlier session's dated measurement re-read from ADRs on this tree, and none should be quoted without its date. The test counts (47 gateway, 27 web), the call-site counts (36 / 25 / 19), and the 14-of-28 `HoldToApprove` split are the briefing's, measured by others and not re-measured here. The live state of the auto-send flags for any house is unknown to me; I measured only that the gateway names a column that does not exist and a threshold it cannot read.
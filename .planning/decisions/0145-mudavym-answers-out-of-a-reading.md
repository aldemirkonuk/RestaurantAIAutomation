# 0145 — Mudavym answers out of a reading, and only the query that ran may mint one

- **Status:** Locked on the founder's call, 2026-09-12 — the deferred half of [[0133-a-public-page-has-no-house-so-the-public-door-has-one-switch]] decision 2. Five forks named below are deliberately NOT defaulted and remain open. **[2026-09-17, ADR 0149 row 33: the launch floor is Codex's fifteen house readings after audit; standing questions are not in v1 and get their own record; the floating "Wine Agent" button (`WineAgentFab`) is removed, so `/ask` and the palette panel are the two doors — this answers build item 15.]** **[2026-09-19, founder batch 4, KL lane — a NEW rule not among this record's original 15 build tasks: price, vendor, open-order and sales readings are owner/manager only, server-enforced per reading. Built. The cell picker is confirmed as `bound-ask.service.ts`'s existing compose step (Sonnet 5 selects up to 8 cell ids, writes no prose) -- Fork 1's intended, stricter reading, and it was already built. Two questions stay OPEN, to be settled with the `/ask` sketch: whether staff reach `/ask` at all, and what `/ask`'s date handling is. See "Amendment, 2026-09-19" below.]** **[2026-09-21, KL lane round 5 -- closed a role-gate bypass: `orders.late_deliveries` returned the same open orders `orders.open` now withholds from staff, so it is OWNER_MANAGER_ONLY too (six restricted readings, not five). Corrected the cell-picker section above, which had wrongly recorded the founder's answer as naming an unbuilt future UI. Relabelled two of this record's own paraphrases -- the cell-picker answer and the `/ask`-dates answer -- that had been recorded as his verbatim words (a matching fix landed on three more in ADR 0144, and on the reading-catalogue.ts and CLAIMS.jsonl copies of the same claims). See "Amendment, 2026-09-19"'s own dated corrections below.]** **[2026-09-21, same round, later -- a seventh reading restricted: the posted-targets reading (`goals.targets`) is OWNER_MANAGER_ONLY too, a money measure. This does NOT touch who may open `/ask` itself, which stays open with the founder (see "Still open, deliberately not decided here" below, unchanged). See "Amendment, 2026-09-21 -- goals.targets joins the restricted set" below.]** **[2026-09-21, KL round 5, later again -- the founder chose the option "Rules in code, label rows": permissions and spend never live in the model. Built: a staff refusal is now SAVED (the folio CHECK lacked `not_permitted`, so every refusal was a 503 on a real database); every field a Reading shows carries a data class and one role-policy table decides who sees what, which answer kinds each role gets and each role's share of the house's daily ask allowance -- the seven restricted Readings are now DERIVED from their fields, not hand-set; every ask is captured once (role snapshot, who chose the Reading, the raw pick, model ids, content hashes); a labels table with `POST /ask/folios/:id/feedback`; a redacted export view. No training. Who may open `/ask` itself stays open. See "Amendment, 2026-09-21 -- rules in code, label rows" below.]**
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
- `grep -rn "ThrottlerModule\|@Throttle\|ThrottlerGuard\|nestjs/throttler" apps/api-gateway/src | wc -l` → **0**. [CORRECTED 2026-09-12: the count is right and the conclusion drawn from it was wrong. That grep searches the NestJS library's names; this gateway's limiter is called `RateLimitGuard` and is bound as an `APP_GUARD` (`app.module.ts:167`). See build item 8 below and ADR 0146.] `grep -rn "APP_FILTER" … | wc -l` → **0**. `grep -rn "@Catch" … | wc -l` → **0**. `grep -rn "SealChallengeService" apps/api-gateway/src/ask-ai/ | wc -l` → **0**.
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
7. DTOs for both ask-ai POST bodies. Today the global `ValidationPipe` validates nothing. [DONE 2026-09-12 on PR #366, `fix/ask-ai-is-gated`, recorded as ADR 0146: `ProposeDto` and `ConfirmDto` are classes, and a spec runs the real pipe against both.]
8. Rate limiting. Zero throttler hits in the gateway; the only spend ceiling suppresses retries, never first attempts. [CORRECTED 2026-09-12: "zero throttler hits" is FALSE, and the same false reading was repeated to the founder before it was caught. The search was for the NestJS library's name. The gateway has `RateLimitGuard`, bound as an `APP_GUARD` at `app.module.ts:167`; because Nest runs global guards before the controller-level `JwtAuthGuard`, it keys on the IP, and this route fell through to its default of 100 requests a minute. The per-person and per-house limit and the first-attempt spend gate are DONE on PR #366, ADR 0146. The pre-model refusal on an empty candidate set, below, was not built as of `4784f5af`.] A page whose primary control is a text box cannot ship without one. Add the cheap pre-model gate too: when every candidate set is empty, refuse before the model call.
9. The gateway's first exception filter, or return the stored `failure_reason` in the confirm response. Zero `APP_FILTER`, zero `@Catch`; an executor failure is a bare 500 with the real reason only in the row and the log.
10. A seal subject kind for an assistant act, `SealModule` imported into `AskAiModule`, and the challenge redeemed at confirm. [SUPERSEDED 2026-09-12 by the founder's answer to fork 3, below: the seal is over the ORDER at approval, using the existing `procurement_order` kind, so no assistant subject kind is created and the confirm on this page is not sealed. The cross-member confirm this item describes is closed separately by `@Roles("owner", "manager")` on PR #366.] Today's confirm is a compare-and-swap under `JwtAuthGuard` alone, with no `created_by` predicate — any member can confirm another member's proposal.
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

---

## Amendment, 2026-09-17 — what the KL lane actually built, against this record's 15 build tasks

Two fix rounds on `feat/p1-readout` worktree `wt-fin-KL` built R1 (the runner)
and a working slice of the reply/acting surface. A prior adversarial audit
scored the result at roughly 35–40% against this record's 15-item build list;
this amendment does not re-score it, only records what changed since and what
this lane's own scope explicitly left out. Recorded per CLAUDE.md §0.4.

**Founder's row 33 answer** (ADR 0149's table, quoted verbatim): *"Codex's
fifteen house readings after audit; standing questions later in their own
record; the floating 'Wine Agent' button removed, so /ask and the palette
panel are the two doors."*

**Built:**
- **R1 (build task 1), the recording client and the Reading runner.**
  `RecordingSession` (`ask-readings/recording-session.ts`) proxies `.from`/
  `.rpc`, refuses writes at the proxy, and traces only on `.then`.
  `ReadingRunner` builds every cell, `sourcesQueried`, `rowsScanned` from that
  trace — never from a literal a reading's author typed. A filter that
  matched nothing is `empty_register` only when the trace scanned zero rows,
  never when it scanned rows and found none matching (this was conflated
  before this lane's fix rounds; it is R4's split, applied).
- **Fifteen readings** in `reading-catalogue.ts` — matching the founder's row
  33 count.
- **Build task 6, the folio table.** `ask_reading_folios`
  (migration `20260921111000`): a personal (`user_id ON DELETE CASCADE`),
  house-scoped (`restaurant_id`) record, written BEFORE the model call so a
  resubmitted request id replays rather than paying twice; RLS,
  `service_role` only. `ai_proposed_actions` gained `reading_folio_id` with an
  explicit `ON DELETE SET NULL` on the pointer column only, so deleting a
  person never fails 23503 on a proposal their Reading backed.
- **Model-failure honesty.** A model-side failure (the spend ceiling, an
  outage, a reply that failed validation) is its own `could_not_answer`
  reason, distinct from a books-side `could_not_read` — the union this record
  calls for at line 126's R4, extended to the model side.

**What this round (KL2, 2026-09-17) added, and why.** This round's brief
explicitly withheld building `/ask` itself — its sketch is under review
elsewhere — so `POST /ask/folios` (`BoundAskController`) remained, as the
first fix round's own judge found it: fully wired (a typed DTO, `JwtAuthGuard`
→ `AuthedRateLimitGuard` → `RolesGuard`, a per-person and per-house rate
limit, the first-attempt spend gate) but reachable by anyone holding a valid
JWT, with no page and no palette entry calling it. A route the product cannot
yet reach from a page is not a route that cannot be reached at all — curl, a
stale mobile build, or a future bug in an unrelated page could each reach it —
and every hit is still a paid Sonnet-5 compose call. `BoundAskService.submit`
now refuses with `503 Service Unavailable`, before writing a folio row or
calling the model, unless `ASK_LAUNCHED` reads exactly `"true"` — an
environment value unset everywhere in this repo today, so the route is closed
by default in every deployment. `scripts/check_ask_ai_is_gated.py` §9 now
asserts this gate is the first statement `submit` can reach, strictly before
`this.folios.begin(`, and is proven to fail (exit 1) by deleting the gate,
then restored and re-verified green.

**The page itself is owed.** Per this record's own build task 13 and the
founder's row 33 answer, `/ask` still needs: the route and the
`mudavym_design_ask` flag (neither exists in `apps/web/src/App.tsx` or
`feature-flag-registry.ts` as of this amendment — `grep -rn "mudavym_design_ask"
apps supabase services` finds nothing); the `WineAgentFab` removed
(`apps/web/src/guidance/components/WineAgentFab.tsx` is still mounted from
`DashboardLayout.tsx`, still labelled "Wine Agent" and pointed at
`/sommelier`); and the `/sommelier` → `/ask` redirect Fork 5's answer calls
for (`/sommelier` still renders the legacy `SommelierAI` page, `App.tsx:415`,
unchanged). None of that is built by this lane, by design — a dedicated,
founder-reviewed sketch is the intended next step, not a KL-lane addition.
`.planning/06-pages/authorize-integration.md` §15 [corrected 2026-09-19, was
§13b before that page's own sections were reordered after its Roadmap
(D-b, KL2 confirm)] carries a short pointer to this state since no
`.planning/06-pages/ask.md` exists yet to hold it.

**Still not built, unchanged from the first fix round's judge (not
re-measured or re-scored by this amendment):** R2 (the provenance guard
modelled on `check_analytics_cost_honesty.py`), R6/R7 (the shelf register-key
declaration and the `not_in_service` state), R3's compile-time-census guard,
build task 5 (the un-gated shelf endpoint), tasks 9, 11, 14 and 15, and the
60-second client budget Fork 1 above names. `bound-ask.service.ts`'s compose
step has the Sonnet-5 call select up to 8 cell ids and write no prose of its
own — narrower than Fork 1's "answer on Sonnet 5" — a question this amendment
repeats rather than answers, since no row in ADR 0149 covers it.
**[ANSWERED 2026-09-19 — this is exactly the question the founder's "cell
picker confirmed" answer resolves: see "Confirmed and built: the cell
picker" in the "Amendment, 2026-09-19" section just below.]**

---

## Amendment, 2026-09-19 — role-gated readings, and the still-open `/ask` questions (founder batch 4)

Not one of this record's original 15 build tasks — a new rule the founder
gave the KL lane in the same session as the `/authorize` frame fix (see
[[0144-the-book-opens-on-evidence-and-three-pages-get-a-job]]'s matching
2026-09-19 amendment). His words, on `/ask` roles: *"do not give money or
sensitive incentives like sales etc to the staff, maybe we should exclude
staff from this equation."*

### Built: per-reading role enforcement

Price, vendor, open-order and sales readings are **owner and manager only**,
enforced on the SERVER, PER READING — not a blanket gate on the `/ask`
endpoint, because most of the fifteen readings are not money- or
sales-shaped and this rule does not touch them:

- `ReadingDescriptor` (`reading.types.ts`) gained a required `allowedRoles`
  field — required, never defaulted, the same discipline this record's own
  `Provenance`/`ReadingOutcome` types already hold to (an omitted field
  silently meaning "open to everyone" is exactly the unstated assumption
  R8's statedness rule exists to forbid).
- Six readings carry `OWNER_MANAGER_ONLY` (`reading-catalogue.ts`):
  `receipts.verified_line` (price — the only reading carrying a price
  basis), `vendors.active` (vendor), `orders.open` and
  `orders.late_deliveries` (open-order — the recorded category for both,
  not the founder's own word), `sales.check_activity` and
  `sales.consumption` (sales). The other nine keep `ALL_ROLES`, unchanged
  from today.
  **[CORRECTED 2026-09-21, KL round 5: `orders.late_deliveries` was left off
  this list and off `OWNER_MANAGER_ONLY` when this section was first
  written. `reading-runner.ts` builds it from the exact same `open` order
  set `orders.open` computes, filtered further by date, and lists the same
  three columns (`order_number`, `status`, `expected_delivery_date`) — so a
  staff caller refused `orders.open` could ask for late deliveries over a
  wide past window and read every one of those rows anyway. Closed by
  setting `orders.late_deliveries` to `OWNER_MANAGER_ONLY` alongside
  `orders.open`; see `reading-catalogue.spec.ts`'s matrix and
  `CLAIMS.jsonl`'s `ADR-0145-ASK-ROLE-GATE-RESTRICTS-EXACTLY-SIX-READINGS`
  (renamed from `...-EXACTLY-FIVE-READINGS`).]**
  **[Seven restricted and eight open since later the same day: `goals.targets` joined the restricted set — see "Amendment, 2026-09-21 — goals.targets joins the restricted set" below.]**
- `isReadingAllowedForRole(id, role)` mirrors `RolesGuard`'s own
  admin-equivalence rule (`auth/guards/roles.guard.ts`) rather than
  reimplementing role logic a second time: owner/manager/admin pass a
  restricted reading, staff and a null/unrecognised role do not; every role
  passes an open reading, exactly as before this change (a null role is
  NOT newly blocked from the open readings — only the restricted
  ones are newly gated; nine and six respectively as of 2026-09-21, see
  the corrected bullet above). **[Eight and seven since later the same day: `goals.targets` joined the restricted set — see "Amendment, 2026-09-21 — goals.targets joins the restricted set" below.]**
- `BoundAskService.submit` checks this AFTER the question is classified to a
  reading (by the page's own choice or the Haiku pick call) but BEFORE
  `ReadingRunner` is ever constructed — zero DB reads, zero compose-model
  cost for a refused ask, the same zero-cost-refusal shape this record's own
  `ASK_LAUNCHED` gate uses. A refusal is minted by `notPermittedReply`
  (`bound-reply.ts`), a new `BoundReply` member — `{ kind: "not_permitted",
  reason: "owner_manager_only", readingId }` — deliberately its OWN kind
  rather than folded into `ReadingOutcome`: a role refusal is never a fact
  about the house's books (`not_in_your_books` / `could_not_read`) and never
  a model-side failure (`could_not_answer`), the same reasoning this
  record's Fork-adjacent `could_not_answer` split already established for
  the model side. It never carries a `Finding` — the books were never
  queried — and `ReadingFolioStore.finish` was extended to back-fill
  `reading_id` from the refusal itself (the one non-`finding` outcome that
  DOES name a real reading), so a naturally-worded question that got refused
  still records WHICH reading it was refused for, not just that it was.
  `GET /ask/catalogue` is filtered by the same predicate — a menu should not
  list a dish the kitchen will refuse to serve — though the execution gate is
  the one that actually matters, since the catalogue carries no house data.
- **Tests, failing before / passing after (shown in this session, not
  merely written):** `reading-catalogue.spec.ts` (the exhaustive
  role-by-reading matrix, all fifteen readings), `bound-reply.spec.ts`
  (`notPermittedReply` and `isBoundReply`'s new branch), and seven new cases
  in `bound-ask.service.spec.ts` proving the gate at the actual dispatch
  boundary — including that a role refusal costs zero DB reads (`getClient`,
  a jest spy, is asserted never called) and that the ten open readings are
  provably untouched. Disabling the gate
  (`else if (false && !isReadingAllowedForRole(...))`) reproduces three
  failing assertions before restoring it; all 82 tests across the four
  touched files pass after. `apps/api-gateway`'s full `tsc --noEmit -p
  tsconfig.spec.json` is clean.

### The cell picker: confirmed and built [RETITLED 2026-09-21 — was "Confirmed, recorded, not built: the cell picker"]

Founder batch 4 — the recorded answer, not a quotation: cell picker
confirmed. Recorded as
his direction for whatever `/ask` sketch is drawn next. **Honestly: this
session could not find a prior specification of "the cell picker" anywhere
in this repository** — no `.planning/06-pages/ask.md` exists yet (per this
record's own 2026-09-17 amendment), no sketch file, no code under that name,
and no other ADR names it. It is recorded here as a confirmed FOUNDER
INTENT for the page's eventual designer to pick up, not as a built or even
fully specified feature — do not treat this bracket as describing a UI that
exists. If the concept lived in a workflow scratchpad or a verbal pitch this
session did not have access to, whoever draws the `/ask` sketch should
recover its actual shape from the founder rather than reverse-engineering it
from this paragraph.

**[CORRECTED 2026-09-21, KL round 5 — the paragraph above misread this
answer, on both counts the retitled heading now fixes. "Cell picker
confirmed" is not a free-floating intent with no prior specification: it
answers this record's OWN still-open question, bracketed ANSWERED 2026-09-19
two sections above (the pre-amendment text ending "a question this amendment
repeats rather than answers, since no row in ADR 0149 covers it") — whether
`bound-ask.service.ts`'s compose step, which has Sonnet 5 select up to eight
cell ids from a Finding and write no prose of its own, is Fork 1's intended,
STRICTER reading of "answer on Sonnet 5". It is confirmed as exactly that.
And it is not unbuilt: `BoundAskService.compose()` has shipped this exact
shape since the first KL round (2026-09-17), proven in
`bound-ask.service.spec.ts`, unchanged by this correction. No new code
follows from this bracket — only the record. "His words" above should read
as this session's recorded answer to that question, not a verbatim
quotation; the founder's two verbatim sentences from this same 2026-09-19
session are quoted in full in the "Amendment, 2026-09-19" heading's
paragraph above and in the staff-reach bullet below.]**

### Still open, deliberately not decided here: staff reach, and dates

Two items the founder was explicit about deferring to the `/ask` sketch
itself, recorded as OPEN rather than defaulted (CLAUDE.md §0.1) — **no new
`OPEN-DECISIONS.md` row was filed for either, because this session's OD
numbers (125-131) were pre-allocated to other lanes' topics and no lane may
file outside its allocation this round; recording the fork here, at the
decision it belongs to, is the substitute for this round only.** A future
session should still give each its own OD row when numbers are next
allocated, rather than leaving them findable only by reading this ADR.

- **Whether staff reach `/ask` at all.** His words: *"do not give money or
  sensitive incentives like sales etc to the staff, maybe we should exclude
  staff from this equation."* His LEANING is to exclude staff from `/ask`
  entirely, not only from the restricted readings (six as of 2026-09-21 —
  see the corrected count above) — but he named this
  as something to confirm with the `/ask` page sketch, not a standing
  decision. Nothing in this session narrows `/ask` access by role beyond
  those six readings; a staff caller can still reach `/ask` itself and every
  one of the nine open readings today. **[Seven restricted and eight open since later the same day: `goals.targets` joined the restricted set — see "Amendment, 2026-09-21 — goals.targets joins the restricted set" below.]**
  Who may open `/ask` itself is unchanged by that amendment and still open.
- **`/ask`'s date handling.** The recorded answer, not a quotation:
  `/ask`'s dates are to be decided with the
  `/ask` sketch. `ReadingArgs.from`/`to` (`reading.types.ts`) exist and
  several readings already declare `window: true`, but how a person actually
  picks or types a date range on the page itself is undecided and unbuilt.

**Founder question this session could not settle, with options and a
recommendation, for whoever runs the `/ask` sketch session:** given the
founder's stated leaning (exclude staff from `/ask` outright) sits ONE STEP
past what is actually built (staff excluded only from six readings as of
2026-09-21), should
an interim, pre-sketch state (a) leave `/ask` reachable by staff for the nine
open readings, as built here — cheapest, matches his literal instruction
("money or sensitive... readings"), but staff can still use the page in the
meantime; or (b) gate the whole `/ask` route to owner/manager now, ahead of
the sketch, matching his stated leaning more closely but pre-empting a
question he explicitly asked to answer later and potentially reversing a
UI decision (staff `/ask` access) before its sketch exists? **Recommendation:
(a)** — the built state is the literal, narrower thing he confirmed
("readings... owner and manager only"); his broader leaning is explicitly
provisional ("to be confirmed with the /ask page sketch"), and `/ask` itself
is not yet reachable by anyone (`ASK_LAUNCHED` unset, no page, no route) so
(a) vs (b) has no live effect until the page ships — the sketch session
should decide it with the page in front of the founder, not this one
pre-empting it from a text amendment.

---

## Amendment, 2026-09-21 — goals.targets joins the restricted set (KL round 5, founder answer)

Asked directly, in the same round-5 session as the `orders.late_deliveries`
bypass fix above: does the posted-targets reading belong in the
owner/manager-only set alongside price, vendor, open-order and sales?

**Founder's answer, recorded 2026-09-21 — the recorded answer, not a
quotation (no verbatim sentence was given for this one, unlike the
`/authorize` styling answer recorded in ADR 0144's review trail the same
round): on `/ask`, the posted-targets reading (`goals.targets`) is
owner/manager only (money measures).**

This session's reading of why, not his words: a posted goal or target is a
money measure, the same kind of figure his 2026-09-19 "sales etc" answer
named. His four 2026-09-19 categories (price, vendor, open-order, sales) did
not name goals, so `goals.targets` stayed on `ALL_ROLES` until he was asked.
It is the only reading in the catalogue whose shelf is `analytics_goals`
(`reading-catalogue.ts`; the only `analytics_goals` read in
`ask-readings/` is `reading-sources.ts:123`), so no other reading
reaches the same target rows — the bypass shape `orders.late_deliveries`
had against `orders.open` does not recur here.

**Built:** `reading-catalogue.ts`'s `goals.targets` entry now carries
`allowedRoles: OWNER_MANAGER_ONLY`, mirroring the same six readings above
it. Seven readings now restricted (`orders.open`, `orders.late_deliveries`,
`receipts.verified_line`, `sales.check_activity`, `sales.consumption`,
`vendors.active`, `goals.targets`), eight open (six and nine before this
addition). `isReadingAllowedForRole` is untouched — the
mechanism already generalises over any `OWNER_MANAGER_ONLY` entry, so no
code beyond the catalogue declaration changed.

**Tests, failing before / passing after:**
`reading-catalogue.spec.ts`'s `RESTRICTED`/`OPEN` matrix now includes
`goals.targets` in `RESTRICTED` (26 cases total in the file, all green);
mutation-tested 2026-09-21 by widening `goals.targets` back to `ALL_ROLES`
and confirming `CLAIMS.jsonl`'s
`ADR-0145-ASK-ROLE-GATE-RESTRICTS-EXACTLY-SEVEN-READINGS` verify flips PASS
→ FAIL, then restoring the file byte-identically (md5
`6990c16d8ab6456423bcd5457d4238ae`, unchanged before and after). The last
call re-ran that mutation and also ran the spec under it: 3 of 26 cases
failed (the exact-set case and both `goals.targets` role cases), and the
claim's verify failed; restored byte-identically, verify passing again. A
comment-only edit to `reading-catalogue.ts` followed (a "recorded verbatim"
that contradicted "not a quotation"), so the file's md5 is no longer the one
above; the mutation was re-run on the final file (md5
`696fbb1c70d51bc205865af878e7c7f3` before and after): verify PASS → FAIL →
PASS, spec 26/26 → 3 failed → 26/26. Full
`verify_index.sh` run green: `gw_tsc`, `gw_tsc_spec`,
`reading-catalogue.spec.ts` (26/26), `bound-ask.service.spec.ts` (role-gate
describe block unaffected — its own fixtures use `orders.open`,
`vendors.active` and `sales.check_activity`, none of which changed), and
`scripts/check_decision_claims.sh` (399/399 holding).

**Explicitly does NOT touch:** who may open `/ask` at all. That question is
still open with the founder — see "Still open, deliberately not decided
here: staff reach, and dates" above; its question is unchanged by this
amendment (a dated count bracket was added there, nothing else). A staff
caller can still reach `/ask` and every one of the now-eight open readings;
only the seventh money-shaped reading was added to the refusal set.

---

## Amendment, 2026-09-21 -- rules in code, label rows (KL round 5, founder answer)

**The fork.** How should `/ask` hold roles, guardrails and a possible future
fine-tune? A research pass (three documents: a state-of-the-art survey, a code
audit, and a judge's verdict with an adversarial kill pass; the judge's report
is `ask-judge.md` in the orchestrating session's scratchpad, not in the repo)
put three options to the founder:

1. **Rules outside the model, labels on every row, train later** (recommended).
2. Minimal columns now: a role, a hand-bumped prompt version, a model id, one
   feedback value on the folio, mirrored into `nf_verdict`.
3. A separate assistant per role (catalogue, prompt and tuned model per role).

**Founder's answer, 2026-09-21 -- recorded answer, relayed by the
orchestrating session; the only verbatim words available are the option's
own label, which he chose: "Rules in code, label rows".** The orchestrating
session's gloss of it, not his words: permissions and spend never live in the
model; staff reach to `/ask` as a whole stays as built and is decided later.

**Why option 1, and what killed the others (from the judge's kill pass).**
Permission learned by a model can be talked out of it; a table cannot. Option
2 carries four defects: a hand-bumped prompt version goes stale the day a
catalogue row's wording changes (2,971 of the pick prompt's 3,493 characters
are catalogue JSON, measured by the judge); one undifferentiated "wrong"
poisons a dataset because it cannot say whether the pick, the shown cells or
the books were wrong; `nf_verdict` has nothing to hang a label on for a
refusal or a page-chosen Reading (no NF row exists for them); and the gate
stays hand-set per Reading, the shape that failed twice in three days
(`orders.late_deliveries`, `goals.targets`). Option 3 splits an empty dataset
three ways and turns permission into model behaviour. Fine-tuning is not
assumed: the judge found Claude 3 Haiku is the one Anthropic model on
Bedrock's fine-tuning list, and neither model `/ask` routes to is on it, so the
rows are built to serve an eval set first.

### Built

1. **The blocker -- a role refusal is saved.** `20260921111000:19`'s
   `reply_kind` CHECK listed nine kinds and not `not_permitted`, so on a real
   database every staff refusal failed the finish update: the folio stayed
   `pending` and the person got a 503 "saved state is uncertain". Jest missed
   it because the store specs use a client double. Migration
   `20260921115300_a_role_refusal_is_saved_on_its_folio.sql` re-adds the
   constraint with `not_permitted`. **Measured (PGlite, the full 197-migration
   corpus of this branch, superuser, no Supabase platform):** without the new
   migrations the update is refused `23514`; with them it is accepted, and an
   unknown kind is still refused.
2. **Data classes and one role-policy table**
   (`apps/api-gateway/src/ask-readings/reading-data-classes.ts`).
   `FIELD_CLASS` tags every `relation.column` a Reading can show
   (`relation.*` for a row count) as money, sales, suppliers, people or stock.
   `ROLE_POLICY` is one row per role: the classes it sees, the answer kinds it
   is given (`reading`, `model_knowledge`), and `dailyAskBudgetShare`, its
   share of the house's daily allowance (ADR 0146). `admin` reads the owner
   row; any other or absent role reads the least-privileged (`staff`) row.
   Each Reading now declares `shows`; its `classes` and `allowedRoles` are
   derived (`reading-catalogue.ts`), and `isReadingAllowedForRole` reads the
   table. The runner refuses at run time to mint a cell from an undeclared
   field (`undeclared_field`, `recording-session.ts`), and
   `scripts/check_ask_field_classes.py` (CI, with a nine-mutation self-test)
   fails on an untagged shown field, an undeclared runner column or unit, a
   stale tag, a malformed policy row, and -- through CLAIMS row
   `ADR-0145-ASK-ROLE-GATE-RESTRICTS-EXACTLY-SEVEN-READINGS` -- any change to
   the derived restricted set. `goals.targets` stays owner/manager: every field
   it shows is money. A refusal now names why: `class_not_visible` with the
   withheld classes, or `answer_kind_not_permitted`. A share below 1 is read
   per ask from the NF ledger by the policy row the ask ran under (`context
   ask_policy_role`), and an unreadable ledger REFUSES (`allowance_unreadable`)
   -- unlike the house gate, which fails open by ADR 0146's design.
3. **Capture on the folio, written once** (`20260921115310`): `asked_as_role`
   (the token's role at ask time), `reading_chosen_by` (`page`|`model`), the
   raw `pick_class` and `pick_args` (so `forecast`, `landed_cost`,
   `sales_revenue` and `lot_expiry` are no longer lost inside `not_built`),
   `pick_model`, `compose_model`, and sha256 of the pick prompt, the compose
   prompt, the catalogue and the policy, each computed from content at call
   time. A trigger refuses any change to the ask-time snapshot, and any change
   to the model capture once the folio has left `pending`.
4. **Labels.** `ask_folio_labels` (folio, step `pick|compose|knowledge|books`,
   label `correct|incorrect`, optional gold class, basis `person|re_ask`,
   `labeled_by`, `labeled_by_role`, `at`), keyed by the folio -- the
   interaction -- not by an NF row. `POST /ask/folios/:id/feedback` is scoped
   exactly like `GET /ask/folios/:id` and refuses a step that did not run. A
   re-ask that names its Reading (`previous_folio_id` + page-chosen) labels the
   pick of the model-picked folio it follows: a different Reading is
   `incorrect` with the named Reading as gold class; the same Reading (a
   clarification follow-up) is `correct`. It is written by trigger in the
   re-ask's own insert transaction. A rephrased re-ask derives nothing.
   [Added 2026-09-21, last-call review: a person's corrected class must agree
   with the label -- `correct` naming another class, or `incorrect` naming
   the class the model chose, is refused 400 (`ReadingFolioStore.label`).]
5. **Export.** `ask_folio_training_export`, a `security_invoker` view keyed by
   folio id: inner-joined to `public.users` (a deleted person drops out at
   once; their folios and labels also cascade), no user id, no raw utterance,
   no answer text, no Finding, no `books` labels, service role only.
   `ask_redact_utterance` masks e-mail addresses, links and digit runs of seven
   or more, and keeps ISO dates (the pick's spans). **It does not find
   names.** Nothing reads the view; no training is built.

**Evidence, measured 2026-09-21:** PGlite probe, 29 of 29 assertions (blocker,
capture shape, written-once, re-ask derivation in five shapes, label rules,
export columns and ranking, redaction, erasure, grants, RLS, idempotent
re-run); on the staged index, gateway jest over `ask-readings`, `ask-ai`,
`model-client` and `settings` 391 of 391 (28 suites), both gateway `tsc`
configurations and web `tsc` clean, CLAIMS 421 of 421; eleven on-disk CLAIMS
mutations and nine jest mutations, every one caught and every file restored
byte-identically.

### Tags that reproduce the 2026-09-19 split -- open, not decided

The classes were chosen so that no Reading changes who receives it. Four tags
are judgement calls that keep a Reading open to staff; each is a founder
question, listed with the others below:

- an order's number and contents (`orders.lines`) and the document register
  (`documents.waiting`) are **stock** -- the door receives against them;
- every calendar field is **people**, and the staff row sees people, so staff
  still see calendar titles, private events included (the judge's section 1.4);
- stock movements (`inventory.movements`) are **stock**, although a net
  movement over a window with no delivery is consumption -- the judge's
  section 1.3 leak, unchanged;
- an open order's state and date, and the count of orders, are **suppliers**.

### Founder questions this amendment does not answer

- Whether staff reach `/ask` at all (unchanged, still open above).
- Whether staff are given `model_knowledge` (today: yes, the table says so).
- Each role's `dailyAskBudgetShare` (today: 1 for every row -- no per-role cap
  is in force until a number below 1 is chosen) and any per-role rate bucket
  (the rate guard has only `user` and `restaurant` scopes).
- The four tags above: whether staff see people-class calendar entries,
  whether order contents and the document register are stock, whether stock
  movement counts as sales.
- Consent and notice for using asks to improve models, and whether any later
  training is per house or pooled after redaction (KVKK/GDPR, cross-border;
  unverified, needs legal review). Names are not redacted.
- What `reading_version` means (open since this record's fork 5).
- For the `/ask` sketch [added 2026-09-21, last-call review]: whether a
  follow-up the page offers to a DIFFERENT Reading (for example "where is it
  held?" after a stock answer) carries `previous_folio_id`. The trigger cannot
  tell a correction from a follow-up, so such a follow-up would label a right
  pick `incorrect`. Either the page sends `previous_folio_id` with a page-chosen
  Reading only when the person corrects or clarifies the pick, or the request
  must say which it is.

### Not built, not verified

- No `/ask` page or palette caller exists; `ASK_LAUNCHED` is unset, so none of
  this runs in production until the page ships.
- A typed question still pays one Haiku pick before the role gate (the
  judge's section 1.4); refusing earlier needs the role's policy to rule out
  every Reading, which today it does not.
- The per-role share is checked once per ask, so an ask under way can finish
  its second model call past the share by that one call.
- The PGlite runs have the harness's fidelity limits (superuser, no Supabase
  platform). No production query was made; traffic and role counts are
  unknown.
- [Added 2026-09-21, last-call review.] The classes govern a Finding's CELLS,
  not its source trace. Every Finding still carries each relation it read with
  that read's row count (`trace[].rowsScanned`, `matchedRows`), so an
  `orders.lines` Finding, open to staff, tells them how many orders the house
  has -- a `procurement_orders.*` count, tagged suppliers above. Neither the
  guard nor the run-time `undeclared_field` check reads the trace.
- A pick refused by the role share or by the house's first-attempt gate still
  records the pick model and prompt hash it would have been sent;
  `failure_reason` is what says no call was made.

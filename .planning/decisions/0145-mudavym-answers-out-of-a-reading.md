# 0145 — Mudavym answers out of a reading, and only the query that ran may mint one

- **Status:** Locked on the founder's call, 2026-09-12 — the deferred half of [[0133-a-public-page-has-no-house-so-the-public-door-has-one-switch]] decision 2. Five forks named below are deliberately NOT defaulted and remain open. **[2026-09-17, ADR 0149 row 33: the launch floor is Codex's fifteen house readings after audit; standing questions are not in v1 and get their own record; the floating "Wine Agent" button (`WineAgentFab`) is removed, so `/ask` and the palette panel are the two doors — this answers build item 15.]** **[2026-09-19, founder batch 4, KL lane — a NEW rule not among this record's original 15 build tasks: price, vendor, open-order and sales readings are owner/manager only, server-enforced per reading. Built. The cell picker is confirmed as `bound-ask.service.ts`'s existing compose step (Sonnet 5 selects up to 8 cell ids, writes no prose) -- Fork 1's intended, stricter reading, and it was already built. Two questions stay OPEN, to be settled with the `/ask` sketch: whether staff reach `/ask` at all, and what `/ask`'s date handling is. See "Amendment, 2026-09-19" below.]** **[2026-09-21, KL lane round 5 -- closed a role-gate bypass: `orders.late_deliveries` returned the same open orders `orders.open` now withholds from staff, so it is OWNER_MANAGER_ONLY too (six restricted readings, not five). Corrected the cell-picker section above, which had wrongly recorded the founder's answer as naming an unbuilt future UI. Relabelled two of this record's own paraphrases -- the cell-picker answer and the `/ask`-dates answer -- that had been recorded as his verbatim words (a matching fix landed on three more in ADR 0144, and on the reading-catalogue.ts and CLAIMS.jsonl copies of the same claims). See "Amendment, 2026-09-19"'s own dated corrections below.]** **[2026-09-21, same round, later -- a seventh reading restricted: the posted-targets reading (`goals.targets`) is OWNER_MANAGER_ONLY too, a money measure. This does NOT touch who may open `/ask` itself, which stays open with the founder (see "Still open, deliberately not decided here" below, unchanged). See "Amendment, 2026-09-21 -- goals.targets joins the restricted set" below.]** **[2026-09-21, KL round 5, later again -- the founder chose the option "Rules in code, label rows": permissions and spend never live in the model. Built: a staff refusal is now SAVED (the folio CHECK lacked `not_permitted`, so every refusal was a 503 on a real database); every field a Reading shows carries a data class and one role-policy table decides who sees what, which answer kinds each role gets and each role's share of the house's daily ask allowance -- the seven restricted Readings are now DERIVED from their fields, not hand-set; every ask is captured once (role snapshot, who chose the Reading, the raw pick, model ids, content hashes); a labels table with `POST /ask/folios/:id/feedback`; a redacted export view. No training. Who may open `/ask` itself stays open. See "Amendment, 2026-09-21 -- rules in code, label rows" below.]** **[2026-09-21, KL round 6 -- two founder answers. Staff on `/ask`: his pick, verbatim, "Yes, own-work only" -- staff reach `/ask`, see stock, receiving and today's deliveries, and are refused money, supplier prices and people data with a one-line reason; general knowledge is allowed and counts toward the house's daily limit. Trace counts: his pick, verbatim, "Hide by data type" -- a Finding's source trace shows a table's row count only to a role that sees that table's class. Built. See "Amendment, 2026-09-21 -- staff own work, and a trace that hides by data type" and the review trail at the end.]** **[2026-09-21, KL round 4 -- six founder answers (round 6r), his picks verbatim: "J4 wins, hide size (Recommended)", "Classify now, forecast=sales (Recommended)", "Same as the wine pool (Recommended)", "Two labels (Recommended)", "Stays stock (Recommended)", "No, user+house (Recommended)". Built: staff are told a failed read's source and never why or how big; the unbuilt money and sales questions refuse staff with the class's line; an owner-only, audited per-house training opt-out, and an export with no free text that leaves opted-out houses out; re-asks labelled `follow_up` or `correction`. `reading_version` answered from the code. Area-gated staff order lookup waits for PR #441. See "Amendment, 2026-09-21 -- round 6r".]** **[2026-09-22, KL round 5 -- the three forks round 6r left open, his picks verbatim: "Never (Recommended)" (opting back in never releases a question asked while opted out -- each folio snapshots the house's answer at ask time), "Text-free until lawyer (Recommended)" (the export stays as built, no free text; a name remover is the first training lane's job), "Add to /privacy now" (a short training notice, his own choice over the lawyer route). Built: migration 20260922200600 adds `ask_reading_folios.asked_while_opted_out`, derived and written once like `asked_as_role`, backfilled from each house's current answer; the export excludes a snapshot-true folio forever, on top of the existing current-state check, and (last call) no longer carries a re-ask label or `reask_kind` drawn from a folio asked while opted out; `/privacy` gained the notice. See "Amendment, 2026-09-22 -- round 6y".]**
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
  (migration `20260922200000`): a personal (`user_id ON DELETE CASCADE`),
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

- **Whether staff reach `/ask` at all.** [ANSWERED 2026-09-21, round 6: "Yes, own-work only" -- see the round-6 amendment at the end.] His words: *"do not give money or
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
`ADR-0145-ASK-ROLE-GATE-RESTRICTS-EXACTLY-SEVEN-READINGS` [renamed `...-EXACTLY-EIGHT-READINGS`, round 6] verify flips PASS
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

1. **The blocker -- a role refusal is saved.** `20260922200000:19`'s
   `reply_kind` CHECK listed nine kinds and not `not_permitted`, so on a real
   database every staff refusal failed the finish update: the folio stayed
   `pending` and the person got a 503 "saved state is uncertain". Jest missed
   it because the store specs use a client double. Migration
   `20260922200300_a_role_refusal_is_saved_on_its_folio.sql` re-adds the
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
   `ADR-0145-ASK-ROLE-GATE-RESTRICTS-EXACTLY-SEVEN-READINGS` [renamed `...-EXACTLY-EIGHT-READINGS`, round 6] -- any change to
   the derived restricted set. `goals.targets` stays owner/manager: every field
   it shows is money. A refusal now names why: `class_not_visible` with the
   withheld classes, or `answer_kind_not_permitted`. A share below 1 is read
   per ask from the NF ledger by the policy row the ask ran under (`context
   ask_policy_role`), and an unreadable ledger REFUSES (`allowance_unreadable`)
   -- unlike the house gate, which fails open by ADR 0146's design.
3. **Capture on the folio, written once** (`20260922200400`): `asked_as_role`
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

### Tags that reproduce the 2026-09-19 split -- open, not decided [three of four ANSWERED 2026-09-21, round 6 -- see each bullet]

The classes were chosen so that no Reading changes who receives it. Four tags
are judgement calls that keep a Reading open to staff; each is a founder
question, listed with the others below:

- an order's number and contents (`orders.lines`) and the document register [ANSWERED round 6: they are **receiving**, a class staff see -- the lane's reading of his word "receiving" (the door receives against them), not his words.]
  (`documents.waiting`) are **stock** -- the door receives against them;
- every calendar field is **people**, and the staff row sees people, so staff [ANSWERED round 6: people data is refused to staff; the staff row no longer sees people, so `calendar.upcoming` is refused.]
  still see calendar titles, private events included (the judge's section 1.4);
- stock movements (`inventory.movements`) are **stock**, although a net [STILL OPEN after round 6: his answer lets staff ask about stock and does not say whether a movement is sales.] [ANSWERED 2026-09-21, round 6r: "Stays stock (Recommended)" -- movements are stock, open to staff.]
  movement over a window with no delivery is consumption -- the judge's
  section 1.3 leak, unchanged;
- an open order's state and date, and the count of orders, are **suppliers**. [ANSWERED round 6: split -- today's open deliveries are **todays_deliveries** (the `procurement_orders@due_today` row view, `orders.due_today`); the whole book, its state, dates and count stay suppliers.]

### Founder questions this amendment does not answer

- Whether staff reach `/ask` at all (unchanged, still open above). [ANSWERED round 6: "Yes, own-work only".]
- Whether staff are given `model_knowledge` (today: yes, the table says so). [ANSWERED round 6: yes, and it counts toward the house's daily limit.]
- Each role's `dailyAskBudgetShare` (today: 1 for every row -- no per-role cap [ANSWERED round 6 for staff: no per-role cap, the share stays 1 -- the orchestrating session's gloss of "count toward the house's daily limit". A per-role rate bucket was not asked and is still open.]
  is in force until a number below 1 is chosen) and any per-role rate bucket
  (the rate guard has only `user` and `restaurant` scopes). [Rate bucket ANSWERED 2026-09-21, round 6r: "No, user+house (Recommended)" -- none until the spend ledger shows staff asks costing too much.]
- The four tags above: whether staff see people-class calendar entries, [three answered round 6; movements still open.] [movements ANSWERED round 6r: stays stock.]
  whether order contents and the document register are stock, whether stock
  movement counts as sales.
- Consent and notice for using asks to improve models, and whether any later
  training is per house or pooled after redaction (KVKK/GDPR, cross-border;
  unverified, needs legal review). Names are not redacted. [ANSWERED 2026-09-21, round 6r: "Same as the wine pool (Recommended)" -- notice, owner opt-out per house, names removed before any export, a lawyer before the first real training run. The export now carries no free text; see the round-6r amendment, item 3.]
- What `reading_version` means (open since this record's fork 5). [ANSWERED 2026-09-21, round 6r, from the code, not a founder fork: the version of a Reading's definition; see the round-6r amendment, item 7.]
- For the `/ask` sketch [added 2026-09-21, last-call review]: whether a
  follow-up the page offers to a DIFFERENT Reading (for example "where is it
  held?" after a stock answer) carries `previous_folio_id`. The trigger cannot
  tell a correction from a follow-up, so such a follow-up would label a right
  pick `incorrect`. Either the page sends `previous_folio_id` with a page-chosen
  Reading only when the person corrects or clarifies the pick, or the request
  must say which it is. [ANSWERED 2026-09-21, round 6r: "Two labels (Recommended)" -- the database labels a different Reading `follow_up` and the same Reading `correction`, and a follow-up no longer says the pick was wrong; see the round-6r amendment, item 4.]

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
- [Added 2026-09-21, last-call review.] The classes govern a Finding's CELLS, [FIXED 2026-09-21, round 6, "Hide by data type": the trace now hides a count by its relation's class -- see the round-6 amendment.]
  not its source trace. Every Finding still carries each relation it read with
  that read's row count (`trace[].rowsScanned`, `matchedRows`), so an
  `orders.lines` Finding, open to staff, tells them how many orders the house
  has -- a `procurement_orders.*` count, tagged suppliers above. Neither the
  guard nor the run-time `undeclared_field` check reads the trace.
- A pick refused by the role share or by the house's first-attempt gate still
  records the pick model and prompt hash it would have been sent;
  `failure_reason` is what says no call was made.

---

## Amendment, 2026-09-21 -- staff own work, and a trace that hides by data type (KL round 6, founder answers)

**The forks.** Two questions the rules-in-code amendment above left open,
put to the founder by the orchestrating session in round 6: may staff use
`/ask`, and what may they ask; and should a Finding's source trace show a
table's row count to a role that may not see that table.

**Founder's answers, 2026-09-21 -- his picks, verbatim, relayed by the
orchestrating session** (quoted in full in the review trail below):

1. Staff on `/ask`: **"Yes, own-work only"**, with this meaning, which he
   approved, verbatim: *"Staff can ask about stock, receiving and today's
   deliveries. Money, supplier prices and people data are refused with a
   one-line reason. General-knowledge answers are allowed but count toward
   the house's daily limit."*
2. Trace row counts: **"Hide by data type"** -- the orchestrating session's
   statement of it, not his words: a Finding's source trace shows a table's
   row count only when the asking role may read that table's class, and
   otherwise says the count is withheld, never 0.

### Built

1. **Two classes and the staff row** (`reading-data-classes.ts`).
   `DATA_CLASSES` gains `receiving` (what the door receives against: an
   order's number and contents, the document register, a receipt's printed
   quantities -- retagged from `stock`) and `todays_deliveries`. The staff
   `ROLE_POLICY` row sees exactly `stock`, `receiving`, `todays_deliveries`;
   `people` left it. Staff keep `reading` and `model_knowledge` answers and a
   `dailyAskBudgetShare` of 1: no per-role cap (the orchestrating session's
   gloss), and every `/ask` model call already meters the house's daily
   allowance through ADR 0146's first-attempt gate. Owner and manager see all
   seven classes. `/ask` stays reachable by staff (no `@Roles` on
   `BoundAskController`, unchanged).
2. **Today's deliveries, split from the order book.** A new Reading,
   `orders.due_today` ("Which open deliveries are expected today?"): the
   house's open orders whose stated date is today (runner clock, UTC), by
   number, state and date. The split is a **row view**:
   `RecordingSession.view(evidence, "due_today", test)` keeps the rows `test`
   keeps and relabels the relation `procurement_orders@due_today`, so its cells
   mint only from `procurement_orders@due_today.*` tags (class
   `todays_deliveries`), never from the whole book's `suppliers` tags. The
   Reading reads the whole book so an empty book is still "not in your books"
   (KL audit J4) rather than a quiet zero; that read's count is in the trace,
   withheld from staff by item 4. It shows no order count beyond today's, no
   price and no value. `orders.open` and `orders.late_deliveries` stay
   suppliers.
3. **A one-line reason on every refusal** (`bound-reply.ts`). A
   `class_not_visible` refusal carries `line`, built from `CLASS_LABEL`
   naming every withheld class (for example "Refused for your role: this
   answer shows money (prices, supplier prices, costs, values, margins)."); an
   `answer_kind_not_permitted` refusal carries a fixed line per kind.
   `isBoundReply` refuses a saved `not_permitted` answer without a one-line
   reason, so a bare refusal is never served as complete. Supplier prices are
   `money`-tagged fields (`procurement_document_lines.unit_price` and its
   basis), so they are refused as money; no separate class was added.
4. **The trace hides by data type.** Every relation a Reading reads (its
   `shelves`) now carries a `relation.*` count tag (seven were added:
   `restaurants`, `storage_locations`, `procurement_document_lines`,
   `procurement_document_links`, `calendar_recurrence_rules`,
   `calendar_recurrence_exceptions`, `restaurant_providers`).
   `withholdTraceCounts(finding, policy)` keeps a trace entry's counts only
   when the row sees that tag's class; otherwise the entry keeps its relation
   and time and its `outcome`, `rowsScanned` and `matchedRows` become
   `withheld` / `withheld_for_your_role` (an `empty` outcome is a count of zero,
   so it goes too); the Finding's `rowsScanned` total is withheld as well,
   since it would let the hidden count be subtracted out. A failed read has no
   count and is unchanged; an untagged relation is withheld from every role.
   `BoundAskService.submit` applies it to the runner's Finding before the
   compose call, the reply and the saved folio, so no copy of the whole count
   survives. The named leak is closed: staff asking `orders.lines` no longer
   see the house's order count; a manager still does. [Last call, 2026-09-21:
   not closed as first built. A read pages 500 rows at a time and writes one
   trace entry per page, so staff still saw one withheld entry per page -- a
   1,041-order book gave three, which dates it to 1,001-1,500 orders
   (measured). A withheld relation now leaves one entry per relation read; a
   jest case on a 1,041-order book and a unit case pin it, and turning the
   rule off fails both.]
5. **The guard** (`scripts/check_ask_field_classes.py`) reads row-view tags,
   treats a read relation's `.*` tag as live, fails `UNTAGGED COUNT` on a read
   relation with no count tag, and its self-test is thirteen mutations (was
   nine).

**Who reaches what now (derived, measured by the guard):** restricted from
staff -- `calendar.upcoming` (people), `goals.targets` (money),
`receipts.verified_line` (money), `orders.open`, `orders.late_deliveries`,
`vendors.active` (suppliers), `sales.check_activity`, `sales.consumption`
(sales). Open to staff -- the five `inventory.*` Readings (stock),
`orders.lines` and `documents.waiting` (receiving), `orders.due_today`
(today's deliveries).

**Evidence, measured 2026-09-21 in the worktree:** gateway jest over
`ask-readings` and `ask-ai`, 15 suites, 271 tests, all passing (was 14 / 235) [last call, re-measured with the two paging cases: 15 / 273],
including `ask-ai/ask-staff-own-work.spec.ts`, which runs the real
`BoundAskService`, runner, session, policy and withholding on an in-memory
book (a staff ask per allowed class answers; a staff ask per refused class
refuses with its line and never reads the books; the order-book count is
withheld for staff and shown for a manager) and the real `ModelClientService`
on an in-memory ledger (a staff general-knowledge ask writes $0.018 of NF rows
to the house's ledger, and the next ask in that house -- an owner's, on a
second instance -- is refused `spend_ceiling` against a $0.015 limit, while
another house is not). Eleven jest mutations (the class split undone, the view
keeping every order, the service not withholding, the rule always showing, the
total left in place, staff seeing people again, a refusal without its line, the
knowledge call metered outside the house, an `empty` outcome kept, a saved
refusal without a line served, a view not mapped to its relation when
counting) each failed at least one test; every file was restored
byte-identically. CLAIMS rows `ADR-0145-ASK-ROLE-GATE-RESTRICTS-EXACTLY-EIGHT-READINGS`
(renamed from `...-SEVEN-...`), `ADR-0145-ASK-STAFF-ROW-SEES-OWN-WORK-ONLY`,
`ADR-0145-ASK-TRACE-COUNTS-HIDE-BY-DATA-TYPE` and
`ADR-0145-ASK-ROLE-REFUSAL-CARRIES-ONE-LINE`: nine on-disk mutations, each
flipping its verify PASS -> FAIL, each restored byte-identically. No
migration: `reading_id` has no CHECK list, and the folio stores the Finding and
answer as JSON.

### Still open after round 6

- Whether a stock movement (`inventory.movements`, tagged stock, open to staff)
  is sales: a net movement over a window with no delivery is consumption (the
  judge's section 1.3). His answer allows stock and does not say. [ANSWERED 2026-09-21, round 6r: "Stays stock (Recommended)".]
- `orders.lines` finds its order by number among ALL the house's orders,
  closed ones included, and a clarifying reply lists up to 30 matching order
  numbers. Order numbers are `receiving`, so a staff member can still count
  orders by searching numbers 30 at a time, and can read a closed order's
  contents. Whether staff's order lookup is limited to open orders is his call;
  the trace no longer leaks the count directly. [WAITING 2026-09-21, round 6r: his words, "all orders depending on staff area task, if its the warehouse or storage staff then yes, if waiter or other no" -- area-gated once areas (PR #441) merge; not built this round.]
- A per-role rate bucket (the rate guard has only `user` and `restaurant`
  scopes) was not asked. [ANSWERED 2026-09-21, round 6r: "No, user+house (Recommended)".]
- [Added 2026-09-21, last call.] One bit of the order book's size still
  reaches staff, outside the trace: `orders.due_today` reads the whole book so
  that an empty book is "not in your books" rather than a quiet zero (KL audit
  J4), so a staff member who asks it learns whether the house has any orders
  at all. His answer covers the trace; hiding this bit means reporting an
  empty book as zero deliveries, which J4 forbids. Which rule wins is his
  call; nothing else open to staff decides "not in your books" on a relation
  staff cannot count. [ANSWERED 2026-09-21, round 6r: "J4 wins, hide size (Recommended)" -- the empty-book bit stays (staff are told "No orders recorded yet."); the ceiling is hidden (staff are told "Couldn't read the order book right now.", no reason, no size); the timing channel below is still open and not built.] [Second last call, 2026-09-21: a second bit, a ceiling.
  `RecordingSession.read` refuses a relation over 20,000 rows (`maxRows`), so
  a book over 20,000 orders makes `orders.due_today` and `orders.lines`
  answer `could_not_read` / `source_limit` for staff too. Same fork.]
  [Third last call, 2026-09-21: a third channel, timing -- read from the
  code, not measured against a live database. Every 500-row page is a round
  trip with its own `asOf`, and the one withheld entry keeps the first
  page's, so the gap to the next trace entry's `asOf` (or to the Finding's
  `asOf`, or from the folio's `created_at` when the page chose the Reading)
  grows by one round trip per 500 orders -- the page count the one-entry rule
  hides. Not a fork: closing it means counting the book in one query and
  filtering today's orders and the named order in the query, instead of
  paging the whole book for a staff-open Reading. Not built.]
- [Added 2026-09-21, second last call.] A staff question the pick files under
  a class that is not built -- `landed_cost` (money), `sales_revenue` (sales),
  `forecast` -- is answered "not built", not refused with a one-line reason.
  Nothing is read or shown, but his rule says money is refused. Giving each
  unbuilt class a data class (so staff get the refusal line now) is his call. [ANSWERED 2026-09-21, round 6r: "Classify now, forecast=sales (Recommended)" -- built.]
- Unchanged from the amendment above: consent and notice for training, what
  `reading_version` means, and whether a page follow-up to a different Reading
  carries `previous_folio_id` (a follow-up versus a correction label). [ALL THREE ANSWERED 2026-09-21, round 6r -- see that amendment, items 3, 7 and 4.]

### Not built, not verified

- "Today" is the runner's clock in UTC, as for `orders.late_deliveries`: for a
  house at UTC+3, between midnight and 03:00 local, today's deliveries are
  yesterday's. The house's time zone is not on this path.
- A typed question still pays one Haiku pick before the role gate; a staff
  question that picks a refused Reading costs that pick, which counts toward
  the house's daily limit.
- No `/ask` page exists and `ASK_LAUNCHED` is unset: nothing here runs in
  production. No production query was made.

## Amendment, 2026-09-21 -- round 6r: the size is hidden, the unbuilt are classed, asks train only on terms, two re-ask labels (KL round 4, founder answers)

**The forks.** The six questions the round-6 amendment above left open, put to
the founder by the orchestrating session in round 6r, plus one question this
lane answers from the code (`reading_version`).

**Founder's answers, 2026-09-21 -- his picks, verbatim.** Each option's own
words, which he read when he chose, follow in quotation marks; the question
and option text are the orchestrating session's, the pick is his:

1. Empty book versus hidden size: **"J4 wins, hide size (Recommended)"** --
   *"Staff see 'no orders recorded yet' (true, and they need it at the door).
   The over-20,000 case says only 'couldn't read the order book right now',
   never why."*
2. Unbuilt questions: **"Classify now, forecast=sales (Recommended)"** --
   *"landed cost is money, sales revenue and forecast are sales. Staff are
   refused with the right reason today, and nothing changes for them when the
   feature ships."*
3. Training on asks: **"Same as the wine pool (Recommended)"** -- *"A notice
   in our Terms and on /ask, and an owner opt-out per house. Names are removed
   before any export. We ask a lawyer about KVKK and GDPR before the first real
   training run."*
4. Re-ask labels: **"Two labels (Recommended)"** -- *"'follow_up' and
   'correction' are stored separately. Corrections are the valuable signal
   (where Mudavym misread the ask), so keeping them apart makes that data
   usable."*
5. Stock movements: **"Stays stock (Recommended)"** -- *"Storage and receiving
   staff need movements to do their job. Only money-valued sales (revenue,
   sales by the bottle with prices) are sales data."*
6. A staff rate limit: **"No, user+house (Recommended)"** -- *"The per-user
   limit already stops one person running up cost, and the house limit caps
   the total. Add a per-role limit only if the spend ledger shows staff asks
   costing too much."*

**Waiting, not built this round** (his words, verbatim, relayed by the
orchestrating session): staff order lookup and the document register become
area-gated -- *"all orders depending on staff area task, if its the warehouse
or storage staff then yes, if waiter or other no"* -- once areas (PR #441)
merges. Until then the round-6 behaviour stands: every staff row reaches
`orders.lines` and `documents.waiting`.

### Built

1. **What staff are told when the books do not answer** (answer 1).
   `FAILURE_DETAIL` (`reading-data-classes.ts`) is one line per role, like
   `ROLE_POLICY`: owner and manager `full`, staff `source_only`; any other or
   absent role reads the staff line. `withholdFailureDetail` shapes the
   Finding before the reply, the composer and the saved folio see it:
   - `could_not_read`, for EVERY reason, not only `source_limit`: the reason
     becomes `withheld_for_your_role`; each trace entry keeps its relation,
     operation and time and loses its outcome, counts and failure code (one
     entry per relation); `failedSources` and the total are withheld. Every
     reason, because the reasons are told apart from each other and one of
     them is a size: a query error and a book over 20,000 rows now give staff
     the same Finding, fingerprint included, apart from its times.
   - The fingerprint is recomputed (`finding-fingerprint.ts`, now the one
     function `RecordingSession.finish` uses too): it hashes the reason, and
     the runner's reasons are a short public list, so a fingerprint left in
     place would have named the withheld reason to anyone who hashed the
     candidates.
   - `not_in_your_books` keeps its outcome and reason (J4 wins) and loses its
     cells, whose only content is the register's zero counts.
   The reply carries the one line staff are told (`bound-reply.ts`
   `READING_BOOK`, keyed by `ReadingId` so a new Reading does not compile
   without its lines): "Couldn't read the order book right now." for the four
   `orders.*` Readings, "No orders recorded yet." for their empty book, and a
   line per book for the others (the stock records, the document register,
   ...). A runner that threw outside its own refusals answers staff the same
   way (`couldNotReadReply`). `isBoundReply` refuses a saved withheld reason
   without its line, or on any kind but `could_not_read`. The runner's reason
   is not lost: `BoundAskService` logs it with the folio id for operators. Owners and
   managers are unchanged: the full reason, and the measured zero on an empty
   register (the runner still writes it; the pinned "an empty real register is
   a measured empty result" case passes unchanged).
2. **The unbuilt questions have a class** (answer 2).
   `UNBUILT_QUESTION_CLASS` = `landed_cost` money, `sales_revenue` sales,
   `forecast` sales. A pick of one of them by a row that does not see its
   class is refused with `classRefusalLine` (reply `not_permitted`,
   `questionClass`, no `readingId`, no book read, no second model call);
   owner and manager still get `not_built` until each ships. `lot_expiry` was
   not in the question and stays `not_built` for every role; its data would be
   stock, which staff see, so classifying it would change no answer. The
   policy hash now covers both tables.
3. **Asks train only on his terms** (answer 3). Migration
   `20260922200500_ask_training_opt_out_and_reask_labels.sql`:
   - `ask_training_opt_outs`: one row per house that has answered, RLS on,
     service role only; no row = not opted out (his default). `set_by` is a
     `public.users(user_id)` FK (`on delete set null`: the house's choice
     outlives the person); `set_by_role` can only be `owner`.
   - `GET /settings/ask-training` (any member of the token's house) and
     `PUT /settings/ask-training` (`HouseAskTrainingController`,
     `HouseAskTrainingService`). The write resolves the caller's role IN THIS
     HOUSE (`OrganizationsService.resolveRestaurantRole`: the active
     `user_restaurant_access` row, else the legacy `users` row for this
     house) and refuses anything but `owner` --
     a manager, staff, `admin`, or a role that could not be read -- because
     `RolesGuard` lets a manager through any owner gate. Every accepted write
     files a `system_audit_log` row (`ask_training_opt_out_changed`, register
     `ask-training`) with both values; an unreadable current value refuses the
     write, since the audit row would have no "from". A failed read answers
     `readable: false`, never the default.
   - The Mudavym settings page (`SettingsNext`) gains a register, "Training
     use" under The house: one switch, on by default, disabled for everyone
     but the owner with the sentence "Only the house's owner can change this."
     It uses `SectionKit`'s existing `Toggle`, so no new motion. The register
     is on the Mudavym page only (`mudavym_design_settings`); where that flag
     is off, the legacy `/settings` has no control and the owner's only way to
     opt out is the endpoint.
   - **The export carried names; fixed.** As built in round 5,
     `ask_folio_training_export` exported `ask_redact_utterance(f.utterance)`
     and the pick's subject span, and that function masks e-mails, links and
     numbers and does not find names. His rule is names removed before any
     export, and nothing in the product can find a name, so the export now
     carries NO free text: the utterance and the subject span are gone, and a
     pick's from/to are kept only when each has an ISO date's shape (the pick
     model may return any ten-character span of the question there). It also leaves out
     every opted-out house. Getting question text back into it needs a name
     remover, which does not exist [last call, 2026-09-21: there was no
     founder-questions section below for this to point to; whether to build a
     name remover before the first training run is put to the founder by the
     lane report, and the gap is recorded under "Not built, not verified
     (round 6r)" below].
   - **The notice.** No Terms page exists in `apps/web` (grep: `/privacy` is
     routed, no `/terms`, no Terms page file), and ADR 0163's lane records the
     same. The notice therefore lives in the plain Terms of Service ADR 0163
     ships before pooling (its "Notice, opt-out, our ToS" answer); this is the
     paragraph for it:
     > **Questions you ask Mudavym.** When someone in your house asks Mudavym
     > a question, we keep the question, the answer and how the answer was
     > reached, so the answer can be checked later. Unless your house's owner
     > turns this off in Settings, we may also use these questions to improve
     > Mudavym. Names are removed before any question is used that way. No
     > training has started. Turning it off does not change how Mudavym
     > answers you.
     And the one line for the `/ask` UI lane, under the question box:
     > Questions asked here may help improve Mudavym, with names removed. Your
     > house's owner can turn this off in Settings.
     [2026-09-22, round 6y, KL5 last call: both drafts above are stale.
     "Names are removed" / "with names removed" describe no code -- the
     export carries no question text at all ("Text-free until lawyer
     (Recommended)") -- and neither says that a question asked while
     training is off stays out after it is turned back on ("Never
     (Recommended)"). The Terms and `/ask` lanes take their wording from
     `/privacy`'s "Questions you ask Mudavym" section
     (`apps/web/src/pages/Privacy.tsx`), not from these drafts.]
   - **The lawyer gate** stands as his condition: nothing reads the export and
     no training is built; a lawyer (KVKK/GDPR) is asked before the first real
     training run.
4. **Two re-ask labels** (answer 4), same migration.
   `ask_reading_folios.reask_kind` is derived by a BEFORE INSERT trigger --
   never a client's word; a sent value is overwritten -- for a re-ask that
   names its Reading: `correction` when the folio it follows was the SAME
   Reading (for a model's folio, the class it picked), `follow_up` when it was
   a different one; null when there is nothing to compare yet. It joins the
   written-once snapshot. The derived pick label on a model-picked folio is
   now that kind, never `correct` / `incorrect`: a `correction` carries the
   Reading as gold class and the arguments the person re-ran with as gold
   arguments -- "no, I meant last week" -- and a `follow_up` carries neither,
   because a new question is no verdict on the last one. A person's own label
   stays `correct` / `incorrect`; one CHECK ties each label to its basis.
   Existing rows are converted once [last call, 2026-09-21: a converted
   round-5 `correct` row had no gold arguments, because round 5 wrote none for
   the same Reading; the conversion now reads them from the re-ask folio
   (`from_folio_id`'s `reading_args`), so a converted correction carries the
   arguments the person re-ran with like a new one -- PGlite-pinned]. The export has the person's label
   (`pick_label`, `gold_class`) and the derived one (`reask_label`,
   `reask_gold_class`) as separate columns, and each folio's own `reask_kind`.
   Two consequences, stated: a page re-ask that fixes a wrong Reading is
   labelled `follow_up` under this rule, so a wrong pick is said by the
   person's own label (`POST /ask/folios/:id/feedback`); and a correction made
   by choosing among a `clarify` answer's matches is a clarification, not a
   misread -- the corrected folio's exported `reply_kind` is `clarify`, so an
   eval can leave it out.
5. **Stock movements stay stock** (answer 5). No change:
   `inventory_transactions.*`, `.stock_type` and `.quantity_change` stay
   `stock`, which the staff row sees. Pinned by a CLAIMS row.
6. **No per-role rate bucket** (answer 6). No change: the rate guard keeps its
   `user` and `restaurant` scopes. The trigger to revisit is his: the spend
   ledger showing staff asks costing too much. It is measurable today: every
   `/ask` model call writes `ask_policy_role` into its ledger row's context
   (`BoundAskService.route`), and `ModelClientService.dailyShareOfAllowance`
   already sums a role's spend from it.
7. **What `reading_version` means, from the code.** It is the version of a
   Reading's definition -- its query, its fields, its meaning:
   `ReadingDescriptor.version` is typed as the literal `1`, and all sixteen
   catalogue rows carry 1. `ReadingRunner.run` refuses any other version with
   `not_built` / `unknown_reading_version` before any read, so a folio saved
   under one definition cannot be re-run under another by accident. The page
   may name a version for a Reading it chose (the DTO allows 1 to 100000); the
   folio stores it. Two defects fixed: `RecordingSession.finish` wrote
   version 1 whatever was asked, so a refused version-2 ask was recorded as
   version 1; and a Reading the MODEL picked ran at the client-sent version.
   Not a founder fork today: the first time a Reading's query changes, that
   change decides whether its version is bumped by hand or derived from
   content (`catalogue_sha` already hashes the catalogue per ask).

**Evidence, measured 2026-09-21 in the worktree:** see the review-trail row
below and the lane report; every number there was measured on the staged
index.

### Not built, not verified (round 6r)

- **Timing still dates the order book.** Hiding the reason and the count does
  not hide how long a read took: a staff ask of `orders.due_today` or
  `orders.lines` still pages the whole book, 500 rows a round trip, so the
  response time -- and the withheld entry's `asOf` against the Finding's --
  grows with the book. Closing it means counting the book in one query and
  filtering today's orders and the named order in the query. Engineering, not
  a fork; not built.
- No Terms page and no `/ask` page exist, so neither notice line is live
  anywhere. [2026-09-22, round 6y: `/privacy` now carries the notice instead
  -- his own pick, "Add to /privacy now" -- see the round-6y amendment below;
  the Terms and `/ask` lines above still have no page to land on.] The
  settings register is rendered in vitest only; it was not opened in a
  browser (it needs a signed-in owner and the gateway).
- The export carries no question text until a name remover exists. [ANSWERED
  2026-09-22, round 6y: "Text-free until lawyer (Recommended)" -- stays
  exactly as built; a name remover is the first training lane's job, not
  built here. See the round-6y amendment below.]
- **[Last call, 2026-09-21, FIXED 2026-09-22, round 6y] Opting back in
  releases what was asked while opted out.** `ask_training_opt_outs` holds
  the house's CURRENT answer only, and the export checks it at read time, so
  an owner who turns training off and later on again puts the questions
  asked while it was off back into the export. Whether a question asked
  while the house was opted out may ever be used is the founder's call (put
  to him by the lane report); nothing reads the export yet, so no question
  has been used either way. If he says never, each folio needs the house's
  answer snapshotted at ask time, like `asked_as_role`. **His answer:
  "Never (Recommended)". Built:** migration 20260922200600 adds
  `ask_reading_folios.asked_while_opted_out`, derived and written once; see
  the round-6y amendment below.
- `/privacy` ("Privacy & data", `apps/web/src/pages/Privacy.tsx`) exists and
  lists what Mudavym stores and what the house controls; it does not mention
  `/ask` or this switch. His words put the notice in the Terms and on `/ask`,
  so it was not added there (put to him by the lane report). [ANSWERED
  2026-09-22, round 6y: "Add to /privacy now" -- he chose this over the
  lawyer-review route offered as the recommended default. Built: see the
  round-6y amendment below.]
- `ASK_LAUNCHED` is unset: none of `/ask` runs in production. No production
  query was made. [Still true 2026-09-22.]

## Amendment, 2026-09-22 -- round 6y: the opt-out gap closes, the export stays as built, /privacy gets the notice (KL round 5, founder answers)

**The forks.** The three questions the round-6r amendment above left open,
put to the founder by the KL4b last-call report: whether a question asked
while a house is opted out may ever be used once the house opts back in;
whether to build a name remover now or keep the export text-free until a
lawyer's review; and where the training notice belongs given neither the
Terms page nor `/ask` exists yet.

**Founder's answers, 2026-09-22 -- his picks, verbatim.** The option label
he picked is in quotation marks; the words after each are the orchestrating
session's brief, not his:

1. Opt-out gap: **"Never (Recommended)"** -- each ask folio records the
   house's training choice at the moment of asking, like `asked_as_role`;
   the export leaves out anything asked while opted out, even after opting
   back in.
2. Export text: **"Text-free until lawyer (Recommended)"** -- as built,
   record; the name remover is the first training lane's job.
3. `/privacy`: **"Add to /privacy now"** -- over the lawyer route offered as
   the recommended default. A short, plain training notice, matching the
   Terms and `/ask` wording already drafted in the round-6r amendment above.

### Built

1. **The opt-out gap closes** (answer 1). Migration
   `20260922200600_ask_training_opt_out_snapshot_at_ask_time.sql` adds
   `ask_reading_folios.asked_while_opted_out boolean not null default
   false`, modelled line for line on `asked_as_role`
   (`20260922200400`):
   - A BEFORE INSERT trigger (`ask_reading_folios_opt_out_is_derived`)
     derives it from `ask_training_opt_outs` inside the same insert -- never
     a client's word; a sent value is overwritten. The function is revoked
     from `public`, `anon` and `authenticated`.
   - It joins the existing written-once snapshot
     (`ask_reading_folios_capture_is_written_once`): once set, neither
     direction (true -> false or false -> true) can be changed.
   - Pre-existing rows are backfilled once, guarded by the trigger's own
     existence (`if not exists (select 1 from pg_trigger where tgname =
     ...)`, so the backfill cannot re-fire on a re-run), from each house's
     CURRENT opt-out answer at the moment the migration runs. That matches
     what the old view returned for those rows at that moment. It is not a
     reconstruction: the switch's history is in `system_audit_log`
     (`ask_training_opt_out_changed`), and a row asked during an earlier
     opt-out in a house that has since opted back in is backfilled false.
     Production has no such row: `ask_reading_folios` (`20260922200000`) is
     not on main and ships in the same PR, and `ASK_LAUNCHED` is unset, so
     the backfill runs on zero production rows. [Last call, 2026-09-22: the
     build's wording, "the only information a pre-migration row has", was
     wrong and is replaced here and in the migration.]
   - `ask_folio_training_export` is replaced (drop + create, same columns as
     `20260922200500`) with three added clauses. The first, `and not
     f.asked_while_opted_out`, sits on top of -- not instead of -- the
     existing `not exists (... where opted_out)` current-state check.
     Together: opted out right now hides every folio of that house;
     asked-while-opted-out hides that one folio forever, even once the
     house's current answer moves on. The other two were added on the last
     call (below): a re-ask label is exported only when the re-ask that wrote
     it was asked while opted in, and a folio's `reask_kind` only when the
     folio it compares against exists and was asked while opted in.
2. **The export stays as built** (answer 2). No code change: `utterance`,
   the subject span, `gold_args`, `reading_args`, the answer and the Finding
   were already absent from `ask_folio_training_export` (round 6r); this
   round confirms that stays the product's answer until a lawyer's review,
   and records that building a name remover is explicitly the first training
   lane's job, not this one's.
3. **`/privacy` carries the notice** (answer 3).
   `apps/web/src/pages/Privacy.tsx` gains a "Questions you ask Mudavym"
   section (icon `MessageSquare`, `Section` component, same list every other
   row on the page uses) stating: what `/ask` keeps (the question, the
   answer, and how the answer was reached); that the house's owner can turn
   training off in Settings -> Training use, and asking/answering keep
   working either way; that a question asked while training is off is never
   used for training even once the owner turns it back on (this round's
   answer 1); and that an export carries no question text, only facts such
   as the question's kind and when it was asked (this round's answer 2),
   with "No training has started." closing it, matching the round-6r Terms
   and `/ask` wording this same record already drafted, except where those
   drafts say names are removed (no code does that; see the bracket under
   them). `Privacy.test.tsx`
   (new) renders the page and asserts all four sentences are present. The
   Terms page and `/ask` still do not exist, so their own notice lines
   (drafted in the round-6r amendment above) remain unlanded; this section
   does not attempt to stand in for them, and does not change what
   round-6r's ADR 0163 lane still owes.

**Fixed on verify (KL5, 2026-09-22).** `AskTrainingSection.tsx`
(`Settings → Training use`) still said "Names are removed first" / "with
names removed" -- the *option's* original wording (round 6r's founder pick,
still quoted verbatim in this file's own header), not what was built. As
built (round 6r) and reconfirmed this round (answer 2, "Text-free until
lawyer"), the export carries NO question text at all -- there is no free
text for a name remover to act on, and none is built -- so the settings copy
was describing a redaction step that does not exist, directly contradicting
this same round's new `/privacy` notice. Corrected both strings to say the export "carries no
question text at all," matching `/privacy`'s wording; `AskTrainingSection.
test.tsx`'s assertion updated to match (6/6 passing); a file-header note
records the correction and points at `/privacy`. Not a new decision -- the
"no free text" fact was already locked (round 6r, reconfirmed round 6y); this
only fixes stale prose describing it (CLAUDE.md §5b).

**Evidence, measured 2026-09-22 in the worktree (wt-r5-KL, on HEAD
`a04aaa4e1`, no merge in progress).** PGlite `KL5-opt-out-snapshot.mjs`, 19
of 19 assertions, run both directly against the worktree's migrations and
against the archived staged index tree `bf3b2744a7393a3a7fb5ec0e7e0051570e32334a`
(backfill from current state; the gap closed -- opting back in does not
release a folio asked while opted out; a forged client value overwritten by
the trigger; written-once both directions; no
`anon`/`authenticated`/`PUBLIC` grant on the derive function; a re-run is a
no-op). CLAIMS: 435 of 435 on that same tree, including the new row
(`ADR-0145-ASK-TRAINING-OPT-OUT-SNAPSHOT-AT-ASK-TIME`) and the existing
export row re-pointed at `20260922200600` (its checks hold unchanged on the
recreated view). `verify_index.sh` on tree `bf3b2744a7`: `gw_tsc`,
`gw_tsc_spec`, `web_tsc`, `web_eslint` (the two changed web files), `claims`
(435/435), `boots`, `prefixes`, the PGlite probe, and `vitest`
(`Privacy.test.tsx`, 5/5) -- ALL GREEN. Eleven product guards run in the
worktree: `check_migration_versions_unique` (no collision against
origin/main + 56 other open PRs), `check_new_tables_are_locked_down`,
`check_fk_targets_exist`, `check_queried_tables_exist`,
`check_read_columns_exist`, `check_flag_readby_anchors` (unaffected --
`feature-flag-registry.ts` was not touched), `check_ask_field_classes`,
`check_ask_ai_is_gated`, `check_migration_probe_safety`,
`check_migrations_single_home`, `check_route_exposure` -- all PASS. Four
git-reading guards: `check_adr_numbers_unique.py` (no new number; next free
still 0219), `check_citation_pairing.py`, `check_no_conflict_markers.py`,
`check_od_ids_exist.py` -- all PASS. `check_migration_ledger.py` and
`check_definer_functions_closed.py`: CANNOT CHECK (no database reachable in
this worktree), exit 2 -- the honest-failure shape, not a false PASS.
Mutation-tested twice on the migration file (restored byte-identically both
times, md5 `7c2ddbdfd5c827cb8a5ac9c75f7209c9`): dropping the export's
snapshot clause flipped 2 of the 19 PGlite assertions and the new CLAIMS
verify from PASS to FAIL; making the trigger trust the client's value
instead of deriving it flipped 4 of the 19 assertions and the same CLAIMS
verify. No Python touched under `services/agent-orchestrator`, so `ruff`/
`black` do not apply to this round. See the review trail below.

**Last call (KL5, 2026-09-22).** Four things were wrong; all fixed and staged.

1. *A question asked while opted out still reached the export, through
   another folio.* A re-ask writes its `correction`/`follow_up` label (and,
   for a correction, the Reading it names as the gold class) onto the
   EARLIER folio, and the later folio's own `reask_kind` is derived from the
   earlier folio's pick. The build filtered folios, not what one folio
   carries from another, so (a) a correction asked while opted out, on a
   question asked while opted in, was exported as that question's
   `reask_label`/`reask_gold_class` once the house opted back in, and (b) a
   re-ask asked while opted in exported a `reask_kind` that gives away the
   pick of a question asked while opted out. That breaks answer 1 as written
   ("the export leaves out anything asked while opted out") and `/privacy`'s
   "never used for training". Fixed in `20260922200600`'s view: a re-ask
   label is exported only when the folio that wrote it exists and was asked
   while opted in, and `reask_kind` only when the folio it compares against
   exists and was asked while opted in (a deleted one fails closed). The
   labels themselves are kept; only the export leaves them out.
2. *Two records said more than was true.* The migration's header put a
   sentence in quotation marks as his pick's words; only the label "Never
   (Recommended)" is his, so the rest is now marked as the brief's. The
   backfill was described as using "the only information a pre-migration row
   has"; `system_audit_log` holds the switch's history, so that is corrected
   above and in the migration, with the fact that makes it moot (zero
   production rows).
3. *Settings said more than the code.* `Settings → Training use` said "On.
   The questions may be used", which now includes questions asked while it
   was off. The On and Off lines now say those stay out.
4. *The Terms and `/ask` drafts were stale.* The round-6r paragraph and
   line drafted for those lanes still promise names removed and say nothing
   of the opt-out rule; bracketed in place, pointing those lanes at
   `/privacy`'s wording.

The CLAIMS row `ADR-0145-ASK-TRAINING-OPT-OUT-SNAPSHOT-AT-ASK-TIME` now also
requires the two re-ask clauses, the `create trigger` itself (the row
checked the function body only, so removing the trigger left it PASS), and
that `20260922200600` is the LAST file defining the view and the
written-once function (a later file redefining either would have left it
PASS). Evidence: see the review trail.

### Not built, not verified (round 6y)

- No Terms page and no `/ask` page exist; their notice lines (drafted in the
  round-6r amendment) remain unlanded. `/privacy`'s new section does not
  stand in for them.
- The name remover: not built, explicitly the first training lane's job
  (answer 2).
- `Privacy.test.tsx` was run with `vitest`, not opened in a browser; no
  production query (`ASK_LAUNCHED` unset); `check_migration_ledger.py` and
  `check_definer_functions_closed.py` could not run (no database reachable).
  Full (non-scoped) gateway jest / web vitest was not run -- only the
  changed page's suite, per this round's own scope (no gateway code
  changed this round).
- [Last call] `/privacy` sends the owner to `Settings → Training use`, which
  exists only on the new Settings page (`mudavym_design_settings`;
  `settings` is not in `LIVE_PAGES`). A house on the old Settings page has no
  switch to find. Nothing is asked yet (`ASK_LAUNCHED` unset); put to the
  founder by the KL5 last-call report as a launch condition.
- [Last call] A person's own label (`basis = 'person'`) given while the house
  is opted out, on a question asked while opted in, is exported once the
  house opts back in. His answer covers questions asked; a label is not a
  question, so this is recorded, not decided (KL5 last-call report).
- [Last call] `/privacy` does not say that a question is sent to an AI model
  provider to be answered. That was never part of this round's notice; it
  is the lawyer's KVKK/GDPR review to settle, recorded here.
- [Last call] The new `/privacy` section uses the page's own `Section` rows
  (the page is not rebuilt in the Mudavym components); a browser render was
  not done.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-21 | Aldemir (founder), round 6, relayed by the orchestrating session | Staff on `/ask`, his pick verbatim: "Yes, own-work only", with the meaning he approved, verbatim: "Staff can ask about stock, receiving and today's deliveries. Money, supplier prices and people data are refused with a one-line reason. General-knowledge answers are allowed but count toward the house's daily limit." Finding trace row counts, his pick verbatim: "Hide by data type". Built by the KL lane the same day; see the round-6 amendment above. Still open: movements-as-sales, staff order lookup over closed orders, training consent, `reading_version`, follow-up versus correction. |
| 2026-09-21 | Opus last call, KL round 6 | Built as he chose, with one leak closed and one bit recorded. Closed: a paged read left staff one withheld trace entry per 500 rows, so the entry count still dated the order book (1,041 orders gave three); now one entry per relation read, jest-pinned and mutation-tested. The trace CLAIMS verify also passed with withholding under the owner row; it now requires the asker's `policy`. Recorded, not decided: `orders.due_today` tells staff whether the order book is empty at all (J4 versus "Hide by data type", his call). |
| 2026-09-21 | Opus second last call, KL round 6 | Both answers re-derived from the code and held; ready. One guard hole closed: the trace CLAIMS verify could not see the withheld entry itself (keeping a page's own `rowsScanned` left it PASS while three jest cases failed); it now requires the entry's `withheld` outcome and counts, mutation-tested. Recorded, not decided: a 20,000-row ceiling is a second bit of order-book size staff can learn, and an unbuilt money or sales question answers "not built" rather than a refusal line. |
| 2026-09-21 | Opus third last call, KL round 6 | Both answers held on the tree merged with origin/main (#424). Mutation: widening today's deliveries to every open order dated today or earlier failed four jest cases across two suites. Recorded: the one withheld entry's `asOf` and the paging round trips still date the order book by timing (engineering follow-up, not built); a code comment that called the `receiving` tag his words now says it is the lane's reading. |
| 2026-09-21 | Aldemir (founder), round 6r, relayed by the orchestrating session | His picks, verbatim: "J4 wins, hide size (Recommended)"; "Classify now, forecast=sales (Recommended)"; "Same as the wine pool (Recommended)"; "Two labels (Recommended)"; "Stays stock (Recommended)"; "No, user+house (Recommended)". Waiting, his words: "all orders depending on staff area task, if its the warehouse or storage staff then yes, if waiter or other no" (area gating, after PR #441). Each option's own words are quoted in the round-6r amendment above. |
| 2026-09-21 | KL lane, round 4 (build, on the tree merged with origin/main 9cfc4e96d) | Built all six; `reading_version` answered from the code (the version of a Reading's definition). Found and fixed on the way: the round-5 export carried names (the redacted utterance); a Finding's fingerprint would have named a withheld reason; a refused version was recorded as 1; a model pick ran at the client's version. Measured on staged index tree 5a6ef4c3: gateway tsc (both configurations) and web tsc clean; gateway eslint on the 14 changed gateway files and web eslint on the 6 changed web files clean; gateway jest over `ask-readings`, `ask-ai`, `settings`, `settings-audit` 24 suites / 420 tests; web vitest `pages/settings/next` 4 files / 83 tests; field-class guard PASS (self-test 13/13); CLAIMS 434 of 434; PGlite probe `KL4b-ask-optout-reask.mjs` 39 of 39 (the 197 migrations before `20260922200500`, round-5 rows planted, then the new migration and a re-run of it). Mutations: 15 on-disk CLAIMS mutations over the seven new rows and the two corrected ones (`...-TRACE-COUNTS-HIDE-BY-DATA-TYPE`, whose old verify failed on the new code, and `...-EXPORT-DROPS-DELETED-USERS`), 12 jest/vitest mutations and 2 PGlite mutations: every one caught, every file restored byte-identically (one jest mutation, the one-entry-per-relation rule on a failed read, was first NOT caught; a test was added and it is). Not built: the timing channel; no Terms page or `/ask` page exists, so the notice lines are recorded here for those lanes. |
| 2026-09-21 | Opus last call, KL round 4 (round 6r), on the tree merged with origin/main 9cfc4e96d | All six answers re-derived from the code and held; ready. Fixed: the migration's one-time conversion left a round-5 same-Reading re-ask a `correction` with no gold arguments; it now reads them from the re-ask folio (PGlite-pinned, and mutation-tested: keeping the old line fails the new assertion). Fixed in this record: a pointer to a founder-questions section that did not exist. Recorded, not decided: opting back in releases the questions asked while the house was opted out (the table holds the current answer only), and `/privacy` does not mention `/ask`. Measured on staged index tree a1cd1f3c: PGlite 40 of 40, CLAIMS 434 of 434, gateway jest 5 suites / 126 tests; a second mutation (a withheld failure keeping its fingerprint) failed 2 jest cases across 2 suites; both files restored byte-identically. |
| 2026-09-22 | Aldemir (founder), round 6y, relayed by the orchestrating session | His picks, verbatim: "Never (Recommended)" (opt-out gap); "Text-free until lawyer (Recommended)" (export); "Add to /privacy now" (over the lawyer-review default). The brief's reading of each (its words, not his) is in the round-6y amendment above. |
| 2026-09-22 | KL lane, round 5 (build, on HEAD a04aaa4e1, no merge in progress) | Built all three. Migration `20260922200600` adds `ask_reading_folios.asked_while_opted_out` (derived, written once, backfilled) and a second export clause; `/privacy` gained the "Questions you ask Mudavym" section; `Privacy.test.tsx` added. Measured on staged index tree `bf3b2744a7393a3a7fb5ec0e7e0051570e32334a`: `verify_index.sh` ALL GREEN across `gw_tsc`, `gw_tsc_spec`, `web_tsc`, `web_eslint`, `claims` (435/435), `boots`, `prefixes`, PGlite `KL5-opt-out-snapshot.mjs` (19/19), `vitest` (`Privacy.test.tsx`, 5/5); eleven product guards and four git-reading guards all PASS; `check_migration_ledger.py` / `check_definer_functions_closed.py` CANNOT CHECK (no database reachable), the honest-failure shape. Mutations: 2 on the migration file (dropping the export's snapshot clause; letting the trigger trust the client's value) each flip the new CLAIMS verify and 2-4 PGlite assertions from PASS/OK to FAIL; both restored byte-identically, md5 `7c2ddbdfd5c827cb8a5ac9c75f7209c9` confirmed before and after. CLAIMS: one row added (`ADR-0145-ASK-TRAINING-OPT-OUT-SNAPSHOT-AT-ASK-TIME`), one re-pointed at the new migration file (`...-EXPORT-LEAVES-OUT-OPTED-OUT-HOUSES-AND-FREE-TEXT`, its checks unchanged on the recreated view). Not built: the Terms page and `/ask` page still do not exist (their notice lines from round 6r remain unlanded); the name remover (explicitly out of scope, answer 2); no production query, no browser render of `/privacy` (vitest only). |
| 2026-09-22 | KL lane, round 5 (verify) | Re-ran the build's checks on its tree and matched every number. Fixed: the Settings copy still said names are removed before an export; it now says the export carries no question text, matching `/privacy` ("Fixed on verify" above). Re-measured on staged index tree 858487c3: `verify_index.sh` ALL GREEN, vitest 2 files / 11 tests. |
| 2026-09-22 | Opus last call, KL round 5 (round 6y), HEAD a04aaa4e1, no merge in progress | Not ready as built: a re-ask carried a question asked while opted out into the export through another folio, both ways (PGlite `KL5-lastcall-reask-optout.mjs`, the build's 19 assertions plus 7 re-ask ones: 2 FAILED on the build's migration). Fixed in the view, with an all-opted-in control kept: 26 of 26. `verify_index.sh` on staged index tree 06c38532: `web_tsc`, `web_eslint` (the 4 changed web files), `claims` 435/435, `prefixes`, that PGlite probe, vitest 2 files / 11 tests -- ALL GREEN; the later edits are to this record only, after which the four git-reading guards and CLAIMS (435/435) were re-run. Gateway tsc and jest not re-run: no gateway file changed. Mutations: dropping the re-ask label clause, and exporting `reask_kind` unguarded, each fail one PGlite assertion; the strengthened CLAIMS verify fails on those two, on a missing `create trigger`, and on a later file redefining the view; all restored byte-identically. Also corrected: the migration header's unsourced quotation, the backfill's "only information" wording, the Settings On/Off lines, and the round-6r Terms and `/ask` drafts (bracketed). Recorded, not decided: the Settings switch is reachable only on the new Settings page; a person's label given while opted out; `/privacy` does not name the AI model provider. |

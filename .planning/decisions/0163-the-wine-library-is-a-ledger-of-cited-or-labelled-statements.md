# 0163 — The wine library is a ledger of cited or labelled statements

- **Status:** Proposed 2026-09-18. The founder locks it. Its index row in
  `README.md` follows separately (that file is gate-owned and was not edited here).
  **Amended the same day (round 2)** with his answers to this ADR's own questions
  (Context, "Round 2"). It is still Proposed: the answers shape the text, and he
  locks the whole.
- **Date:** 2026-09-18
- **Decider:** Aldemir (founder). The design was drafted by a research workflow
  (six evidence lanes, three candidate designs, one judge, two adversarial passes;
  round 2 added two research lanes, on /studio and on menu prices and the notice);
  none of it binds until he locks it.
- **Keywords:** wine library, master_wine_library, enrichment, provenance, cell,
  evidence, citation, inference, growth, crawl, robots.txt, terms, market price,
  batch, spend cap, lease, health, wine_profile_v1, WineProfile, LWIN, ADR 0130,
  studio, sommelier, reviewer, gold set, menu price, restaurant list price, class M,
  data notice, opt-out, two writers, cutover
- **Links:** [[wine-intelligence-foundations]] (the measured plan this answers),
  [[0020-no-fabricated-answers]], [[0026]] (gen types rejected; views carry no RLS),
  [[0117-a-price-sighting-names-its-source-its-date-and-its-unit]],
  [[0124-a-bottle-has-one-identity-and-every-price-names-it]],
  [[0126-a-price-behind-a-licence-is-not-a-posting]],
  [[0130-a-generic-name-stays-the-venues-own-wine]],
  [[0145-mudavym-answers-out-of-a-reading]], [[0146-asking-costs-money-so-asking-is-bounded]],
  [[0161-a-failed-queue-read-is-not-a-quiet-minute]] (on another branch when written),
  [[0048-domain-quant-under-research-math]],
  [[0113-the-assistant-proposes-the-seal-applies]] (the opt-out stays outside it),
  [[0143-the-arrival-the-desk-the-sommelier-and-the-two-rooms]] and
  [[0149-mudavym-is-the-only-design-finish-every-page-then-delete-legacy-once]]
  (Studio kept as an internal tool)

## Context

`wine-intelligence-foundations.md` §2 found the pipeline broken: no running process
enriches a library row after it is created, 159 of the 173 stocked wines have no
profile or embedding, every scheduled wine job is an undeployed Celery entry, the
research path cannot reach the stubs, 44 seed rows carry one copied sparkling
profile, the rich 200-wine file was never loaded, and `GET /wines` has no live
filter (`wine-intelligence-foundations.md:116-219`). It left six forks, F1–F6, to the
founder (`:391-426`).

**The founder answered five of them on 2026-09-18.** The quotes below were relayed
to this session by the orchestrating workflow; they are his words as relayed, not
text this writer saw him type.

| Fork | Question (foundations §7) | Answer | Date |
|---|---|---|---|
| F1 | What runs enrichment | *"most advanced pipeline to output highest results with high quality"* — the best-quality pipeline, not the cheapest or simplest | 2026-09-18 |
| F2 | What to enrich | *"everything beyond stocked and more, every day more extractions, more wines, just like the beginning of this project"* — every row, not only stocked, and the library grows daily as the 2026-08-14..16 menu-corpus build did | 2026-09-18 |
| F3 | The rich data set | *"Repair, then load"* — skip the 39 wrong producer stories, drop the 'estimated' ratings, re-profile the 44 copied rows, stories only when sourced | 2026-09-18 |
| F4 | Market price | *"Both, labelled"* — the house price index (ADR 0117/0126) first, a public retail figure beside it marked as a public listing | 2026-09-18 |
| F5 | Inferred values | Inferred values are shown, labelled honestly with their provenance (relayed as a paraphrase; answered before F1–F4) | 2026-09-18 |
| F6 | Where the read contract lives | **Not asked.** This ADR recommends one (Decision §7) | — |

Standing rules carried in: nothing is invented (a value without a source is absent);
provenance on every field; "absence reported as health" is a known failure class, so
health must prove presence; ADR 0130 keeps a generic house name as the venue's own
wine; people-facing pages stay simple.

**Five facts found by this research change the foundations plan** (each re-measured
or re-read by this writer on 2026-09-18 unless marked):

1. **A second pipeline is live, and it can write to production.** Four Claude Desktop
   scheduled tasks are enabled: `wine-menu-discovery-enrichment` (`0 2 * * *`, last
   run 2026-09-18T06:06Z), `wine-extract-nightly` (`0 3 * * *`, 07:05Z),
   `wine-verify-nightly` (`0 4 * * *`, 08:10Z) and `wine-audit-weekly` (`0 5 * * 0`,
   2026-09-13) (`~/Library/Application Support/Claude/local-agent-mode-sessions/0ca3256d-…/1138b209-…/scheduled-tasks.json`).
   Their prompts are `~/Documents/Claude/Scheduled/wine-*/SKILL.md` (the `filePath` of
   each task); `wine-audit-weekly/SKILL.md:26` runs `UPDATE master_wine_library SET
   review_status='approved'`. The code they drive lives in the gitignored
   `datasets/annotation_inbox/` (`.gitignore:92` on `origin/main`), on one laptop.
   [Critic, 2026-09-18, production SELECT: today's three runs left no row. The last
   writes those tasks could have made are `research_runs` started 2026-09-16 06:06Z,
   `evidence_citations` and `source_registry` 2026-09-12 08:28Z and 08:23Z, and a
   library `updated_at` of 2026-09-12 14:50Z. So "enabled and running" is measured;
   "writing every night" is not.] The foundations doc called these runs "unattributed"
   and said desktop scheduled tasks were ruled out (`wine-intelligence-foundations.md:247`);
   that was wrong, and the doc now says so.
2. **The copied-profile problem is far larger than 44 rows.** The 2026-08-16 18:00Z
   load wrote 1,717 `menu_corpus` rows (1,443 live) carrying only 157 distinct
   profiles; the largest group is 421 identical reds across 53 grapes and 161 regions;
   no git ref holds the generator (repo-assets lane, production SELECT). [Critic
   re-measure, 2026-09-18: the distinct count depends on which columns form "the
   profile". Over the 1,717 rows there are 104 distinct `wine_structure`, 155 distinct
   `sensory_profile` and 175 distinct pairs, and the largest `wine_structure` group,
   with no colour filter, is 426 rows. The lane's 157/421 definition was not recorded.]
3. **Provenance in production is not provenance.** `field_confidences` is one of four
   constant objects on all 3,276 flagged rows (`CONFIDENCE`, `scripts/load_enriched_wines.py:52`);
   every enriched row says `claude-haiku-4-5` because the loader writes that literal
   (`:203`); the loader writes model output into `primary_type`, `grape_variety`,
   `country` and `region` on insert (`:294-297`), so those "identity" columns are
   model output on the 3,032 eligible `menu_corpus` rows; and `fn_uncited_fields`
   never compares a citation's `proposed_value` with the row's value
   (`supabase/migrations/20260826175836_evidence_gate_v1.sql:103-125`; quality lane T12).
4. **Every robots reader in the gateway fails open** on any non-2xx status and on a
   network error (`vendor-intel/shop-reference-sweep.service.ts:435-465`: `!res.ok` and
   the `catch` both return `allowed: true`; `vendor-intel/vendor-page-extractor.service.ts:140-143`
   states the same rule). RFC 9309 §2.3.1.4 forbids the 5xx and network half; §2.3.1.3
   permits reading a 4xx as allow, and this ADR disallows it anyway (§8). Three of the
   four armable price shops' terms forbid what the sweep does, and the fourth's terms
   are silent on it (Decision §9).
5. **The price registers are empty.** `price_index_postings` = 0 rows (writer W1), and
   `vendor_price_observations` and `price_history` are 0 too (`wine-intelligence-foundations.md:241`).

Re-measured by this writer (`scratchpad/wine-pipeline/writer-queries.sql`, W1–W4): 3,589
live rows; 3,314 eligible under today's predicate (live, `beverage_kind='wine'`,
`identity_status='normal'`, not provisional); 95 of those are stocked, and 13 of the 95
carry a body; 173 stocked wines on active lines; 12 distinct wines held by houses whose
names do not begin "Sim "; 49 provisional; 197 under-identified; 4 `research_runs`
stuck at `running`; 287 citations, the last at 2026-09-12 08:28Z; `enrichment_queue` 0.

### Round 2: the founder's answers to this ADR's questions (2026-09-18)

He answered in three AskUserQuestion batches the same day, and the orchestrating
workflow relayed the answers to this session. The two long answers were spoken and
transcribed by speech-to-text. They are copied exactly as relayed, transcription errors
included; the bracketed glosses inside quote R are the relay's. **Every reading below
is ours and is marked as a reading.** Where a reading had to choose between two
meanings, the choice is listed under "Still open".

| Batch | Question | His answer (as relayed) | Our reading | Lands in |
|---|---|---|---|---|
| 1 | Step 0.1: the four laptop wine tasks | *"Keep until the repo pipeline runs"* | The tasks stay enabled until the repo pipeline's first clean night (cutover, §15), and he disables them then | §15; steps 0.1, 1.10 |
| 1 | Q1: wines sourced a day (N) | *"Every wine from day one"* | N equals intake from the first night the pipeline spends money, and the 3,314 eligible rows are sourced once as a backlog. "Day one" is read as the first paid night, not today, because Stage 0 spends nothing | §4 sourcing order; §11; Stage 1; Cost |
| 1 | Q8: the 3,346 legacy profiles | *"Stop showing, redo them"* | They retire from display and are re-derived | §7; §10 |
| 1 | Q9: the estimate boundary | *"Confirm that boundary"* | Descriptive traits are estimated and labelled; attributive facts are stated, sourced or absent. The relay says this amends ADR 0020 and ADR 0130 as proposed, so Q9 (a) and (b) are both taken as accepted | §1; §2 |
| 2 | Q2: the publish rule | Quote P below | Houses' menus are the main source. Their wine values and prices are checked. The market price comes **from menu prices**, or is an estimated value price based on them. Houses are told their menu data may be used for others, for training and for analytics. **It does not choose between Q2's paths (a) and (b)** | §4 P1; §9; §14 |
| 2 | Q3: quality floors | *"0.95 / 0.90 / 0.80"* | Sourced ≥ 0.95, recalled ≥ 0.90, inferred ≥ 0.80, each a Wilson lower bound | §5 |
| 2 | Q4: review capacity | Quote R below | The early design already has the reviewers. Developers approve each menu's extracted wines; paid sommeliers approve and add wines and features; the /studio page exists for this. "Solias" is read as sommeliers, and "paying" as being paid, although the words admit the reverse (Q14) | §13 |
| 2 | Q6 and Q7: crawling and stored copies | *"Crawl; quotes only; upload"* | Resume public-list crawling under §8 (robots.txt, terms, an identifying agent, never OpenTable); store only a quote, a hash and a date; upload the 41 laptop menu PDFs | §4 P1; §8 |
| 3 | The data notice | *"A notice with an opt-out"* | Every house is told that its menu wines and prices feed the shared library, training and analytics. A house setting opts out, and the house's own analytics keep working | §14 |
| 3 | Q7: Serper to find URLs | *"No"* | Serper is never used, not even to find URLs | §8; rejected sources |
| 3 | Q12: shop prices | *"Use Hi-Time, ask the rest"* | Show Hi-Time labelled as a public listing, and ask Tanners, BBR and Slurp for written permission | §9; step 0.9 |
| 3 | Q11: the four May houses | None of them is a real house (relayed as a choice, not quoted) | YAREN, ALDEMIR, ADMIN 1 and ADMIN ROOM are flagged `is_simulation`. Together with the Sim rows, this means **no house that stocks a wine is real today** | §2; step 0.3 |

**Quote P (Batch 2, the publish rule), verbatim as relayed:**

> "estimated page occurs I'll let me have the data usually or let me let's say let me
> extract wine menus from restaurants. We're gonna check their values. We're gonna check
> their prices and we're gonna give them a dropout saying that this state might be used
> for other peoples for our best training and for your analytics type of thing to get
> that out and then doing that be my just create those things but other than that, each
> man will be extracted and their market price will be sold there so from menu will be
> the market price or estimated value price based on that"

**Quote R (Batch 2, review capacity), verbatim as relayed:**

> "if you can't see the documents from the very early areas, you're gonna see that for
> each menu, there will be developers, approving those wines that the menu has that the
> menu has extracted. There will be Solias [sommeliers] who will be paying to approve and
> add those wines for adding features and there is a/Studyo [/studio] page just for that
> matter"

**Four more facts from the round-2 research** (re-checked by this writer on 2026-09-18
where marked "this writer"; the rest come from the lanes):

6. **/studio is the designed review surface, and it has never promoted a wine.**
   - **Design.** Phase 13 designed it on 2026-04-07
     (`fbae60dea:.planning/phases/13-dev-onboarding-ui-with-manual-override-access/13-CONTEXT.md:9, :21-22, :40-44`,
     read from git by this writer). It has three invite-only roles: `developer`,
     `certified_contributor` and `review_admin`. A new contributor's overrides queue for
     a review_admin until 5 approvals in a row. Developers and review_admins promote
     instantly. The roadmap named its outside users *"certified accounts
     (sommeliers/producers/approved groups)"* (`5c9820de7:.planning/ROADMAP.md:24`).
   - **Status.** It is live at `/studio`, `/studio/queue` and `/studio/certify`
     (`apps/web/src/App.tsx:189-207`), and it is kept as an internal tool
     (`0143-…md:136`; ADR 0149 row 32).
   - **Production** (this writer's SELECT): 21 `onboarding_sessions`, all on 2026-04-07.
     0 `override_events`, 0 `invite_tokens`, 0 `field_corrections` and 0
     `field_calibration`. 5 `user_roles`: 2 developer, 2 review_admin and 1
     certified_contributor. [Verifier, 2026-09-18, production SELECT: the 5 rows
     belong to **three accounts**. One account holds all three roles, including the
     only certified_contributor; one holds developer and has no `users` row; one holds
     review_admin. With 0 invites ever issued, no sommelier holds a role.] 0 library
     rows with source `studio_promotion`. Library `review_status` over all rows:
     approved 3, rejected 1, pending 3,463, needs_review 786 [verifier: over live rows
     it is approved 3, pending 3,463, needs_review 123, which sums to the 3,589 live
     rows].
   - **Its promote path cannot succeed.** `promote_to_library` inserts `price`,
     `price_glass`, `color`, `sweetness_level`, `tasting_notes` and `description`
     (`services/agent-orchestrator/api/studio_routes.py:1031-1048`).
     `master_wine_library` has none of these columns (information_schema, this writer).
     The retry drops only the three audit columns (`:1064-1072`).
   - **The other two promotion paths fail too.** The override auto-promotion and the
     quality PATCH select enrichment columns that the submissions table lacks
     (`services/override_service.py:356-360`, `api/quality_routes.py:205-210`; the lane
     reproduced `42703` on that SELECT). Promotion also requires status `pending_review`
     (`override_service.py:376`), and no submission has it: 92 are `accepted` and 1 is
     `pending` (this writer).
   - **Invites fail for newcomers.** A person with no account cannot redeem one
     (`08-softwares/wine-studio.md:46-48`).
   - **The docs overstate it.** Two docs list promotion as working
     (`08-softwares/wine-studio.md:42`, `06-pages/studio.md:40`), and none of these
     defects is in `v3.0-TECH-DEBT.md`.
   - **Payment was never designed.** Paying sommeliers was only a deferred idea
     (*"points/rewards … for certified sommeliers/producers"*, `13-CONTEXT.md:56`), and
     nothing is built. The Stripe client throws on any `transfers` or `payouts` path,
     because pricing is OD-23 and still open (`apps/api-gateway/src/billing/stripe.client.ts:22-28`).
7. **No real house has a menu price in production.**
   - **The only priced menu data** is the 26 public PDFs loaded 2026-08-14..16: 3,893
     `menu_corpus` rows (this writer). 25 of the menus are from Chicago and 1 from San
     Francisco [verifier: only five file names in `datasets/menu_corpus/extracted/`
     state a city; the rest are placed by restaurant name, which was not checked].
   - **Each row keeps a single price.** Up to 7 menus can name the same row, because
     the loader keeps the first price (`scripts/load_enriched_wines.py:292`,
     `ON CONFLICT … DO NOTHING`). It also writes 750 ml on every row (`:286`).
     [Verifier, production SELECT on `data_enrichment->'menus'`: the rows naming 4–7
     menus are all deleted or superseded. A live row names at most 3 restaurant
     groups, and 3 live rows do.]
   - **Format and date were never captured.** The extraction prompt asks for no bottle
     size, pour, currency, section or list date
     (`apps/api-gateway/src/menus/parsers/scan-parser.service.ts:47`).
   - **The house price tables are empty.** `menu_price_versions`, `wine_menu_prices`
     and `restaurant_wine_roster` all have 0 rows (this writer). `menu_items` holds only
     Sim Bistro's 342 lines.
   - **Coverage.** The git-tracked per-menu files keep each menu's own price. Counted
     by restaurant group, 3,843 wines appear on one list, 61 on two and 9 on three. **At
     a floor of 5 restaurants no wine has a list price today; at 3, 9 would**
     (`scratchpad/adr0163-r2/menu_price_coverage.py`).
   - **Where the PDFs are.** The 41 laptop PDFs (CA 14, IL 4, NY 18, WA 5) and the 26
     corpus PDFs exist only in the gitignored `datasets/annotation_inbox/pdfs/` (this
     writer, `find`).
8. **The product's one known promise about wine lists points the other way.**
   - `apps/web/src/components/settings/ServicesPermissions.tsx:88` says analytics
     *"Never includes your wine list contents"*. [Verifier: the line describes the
     "Product analytics" switch, meaning anonymous usage signals (`:86-88`). It does not
     speak about a shared library, but a house can fairly read it as covering its list,
     so §14 amends it.]
   - /privacy says nothing about menus, a shared library or training. No Terms of
     Service page exists (lane).
   - A house's menu import already writes onto shared library rows
     (`apps/api-gateway/src/wines/wine-submissions.service.ts:323` copies its
     `priceReference`). All 78 `menu_import` rows (this writer) come from simulation
     houses (lane; verifier SELECT: created 2026-09-03..05, and the only houses holding
     them are Sim Meyhouse and Sim Vanilla Kaleiçi), so no real house has contributed
     under the old promise.
9. **No house that stocks a wine is real.**
   - Production has 14 `restaurants` rows (this writer's SELECT).
   - **Who holds the stock.** Every stocked wine is held by a "Sim " row or by one of
     the four May houses the founder ruled not real:
     - Sim Bistro 81; Sim Meyhouse `a229f22b` 53; Sim Vanilla Kaleiçi 27; and a
       second, empty Sim Meyhouse `aaecdb17`;
     - ADMIN ROOM 10, ADMIN 1 2, YAREN 1 and ALDEMIR 1.
   - **Six rows are unasked.** Gullit's Tavern, Yaren's Fine Dine, Meyhouse Palo Alto,
     YARDOM, Chez Community and The Old House Pub stock nothing and have no menu line.
     Nobody has said whether they are real (Q11).

## Options considered

The research ran six evidence lanes (repo assets, state-of-the-art methods, sources
and licences, infrastructure, quality, growth loop), drew three designs from them,
scored them with weights quality 3, growth 1.5, honesty 1.5, legality 1,
operability 1, cost 1, and then sent the winner through two independent adversarial
passes (15 kills, 30 required changes). Queries and working files are in the
session scratchpad `wine-pipeline/`.

1. **C1 — Evidence-first cell ledger, quality-maximal (7.6).** Every new wine takes
   the full sourced pass; a deterministic span check, a self-hosted MiniCheck and an
   Opus judge verify each value; stocked cells are audited before publication.
   *Rejected as the backbone:* it grows at 3 lists a night, about a third of F2's
   "like the beginning" pace; it costs about $64–80 a day at that pace; it needs a
   Python worker from step 2; and MiniCheck is English-only while Italy is the
   largest stocked country. Its verification stack and its "audit before publish"
   rule for real houses are grafted in. [Critic, 2026-09-18: the pace and cost reasons
   are one dial, not a design flaw. The lane's own model
   (`scratchpad/wine-pipeline/quality-max-cost-model.py`) prices C1 at 10 lists a
   night at $214–268 a day; 3 lists was a spend choice. Under F1 cost is not a reason
   to reject quality. The reasons that stand are the Python worker from step 2 and
   MiniCheck's English-only coverage. The amended C3 matches C1's sourcing coverage
   when N, the wines sourced a day, equals daily intake (Q1).] [Round 2, 2026-09-18:
   *"Every wine from day one"* sets N to intake and brings sourcing, and so the Python
   `wine-worker`, into Stage 1 (§11). The worker therefore no longer separates C1 from
   C3. C3 stays the backbone because the other answers build on its cell model, its
   value-bound citations and its URL-only search.]
2. **C2 — Staged pragmatic pipeline (7.7).** New wines from night one, 10 lists a
   night, live gateway `@Cron`, a static parity test. *Rejected as the backbone:*
   it publishes inferred cells before any gold set exists, verifies Opus with Sonnet
   (same family; LLM judges favour their own family, Panickssery et al. NeurIPS 2024),
   shows legacy profiles that pass G1–G4 although no content rule catches all the
   template groups (the three lanes counted them as 1,285, 1,288 and 1,486), and
   relies on a robots check that fails open. Its staging, hosting, run ledger and
   static type test are grafted in.
3. **C3 — The Evidence Ledger (8.1). Chosen as the backbone** and amended below.
   Statement-shaped cells with value-bound citations, never infers attributive
   facts, web search used only to find URLs. Its weaknesses (growth waits for the
   pilot; type generation needs a database at build time) are fixed by the grafts.
4. **Do nothing.** The stocked profile gap stays at 160 of 173; the laptop tasks keep
   writing unreviewed rows; the 1,443 templated profiles stay one read away from a
   page. Cost: every downstream feature named in foundations §5–§6 stays blocked.

**Rejected hosts** (infrastructure lane, measured):

| Host | Why not |
|---|---|
| Orchestrator Celery worker and beat | The image runs uvicorn only (`services/agent-orchestrator/Dockerfile:33`); the broker defaults to `redis://localhost` (`config/settings.py:50-55`); the Railway project has no Redis, worker or beat; the orchestrator redeployed 21 times in 7 days |
| GitHub Actions schedule | This repo's scheduled workflows started 4–5 hours late on every one of 15 days (`gh run list --event schedule`); the repo is public |
| Vercel cron | Production web is a Vite SPA with no functions; no retry; best-effort delivery |
| `pg_net` or Edge Functions | A web-searching call can outlast the 400 s wall clock; `pg_net` responses are unlogged and fire-and-forget |
| Claude Desktop scheduled tasks | Laptop-bound; their tools went silently absent on 2026-08-31 (`wine-pipeline/RUN_2026-08-31_extract-nightly_ABORTED.md`); cost is modelled, not metered; four runs left `running` |
| Managed Agents scheduled deployments | Beta, no batch discount; a candidate only for open-ended discovery later |

**Rejected sources:** Vivino, Wine-Searcher scraping, CellarTracker and OpenTable
(their terms forbid automated collection; sources lane); Serper as a price issuer
(it resells scraped Google results, and `price-sources.md:207-208` already rejects a
reseller as issuer); the Kaggle WineEnthusiast set and WineSensed (non-commercial);
X-Wines as "sourced" (its origin is unnamed); model recall as a source of attributive
facts (ADR 0020). [Round 2:] Serper even only to find URLs (founder, 2026-09-18:
*"No"*); Hi-Time's prices as training or fitting data for the estimated value price
(its terms are silent, and training is a further use than display, §9).

**Rejected mechanisms:** a jsonb `field_provenance` per row instead of an
observation table (simpler, but loses the history that calibration, drift and batch
rollback need; the migration that deferred the table named "a consumer" as its
trigger, `20260817010000_enrichment_observed_at.sql:10-18`, and this is it);
`supabase gen types` for the contract type (ADR 0026 option 6 rejected it,
`0026-…md:137-141`, and CI has no database); a column-specific enqueue trigger
(Decision §4 P4). [Round 2:] dividing a menu price by a fixed markup to get a shop or
wholesale price (§9); menu prices in `price_index_postings`, which has no
`restaurant_id` and whose `source_class` CHECK allows three values
(`supabase/migrations/20260904200000_a_posted_price_names_its_state.sql:51-52`), so
neither the opt-out nor the restaurant count can be enforced there; reusing the
per-person `servicePermissions.privacy_sharing` switch, which nothing reads, as the
house opt-out (§14); a new review page when /studio exists (§13).

## Decision

**The wine library becomes a ledger of statements: every displayed wine field is a
cell that names where its value came from; every wine is sourced before it is
inferred; the library grows every night, mainly from houses' menus and then from
lawful public lists; the market price is read from those menus; a cell reaches a page
only through mechanical gates and a measured audit by named reviewers in /studio, read
through one database view; and every house is told how its menu is used and can opt
out.** [Round 2, 2026-09-18: the draft said "values are sourced before they are
inferred where a real house depends on them" and "from lawful sources". The founder's
answers in Context, round 2, widened sourcing to every wine, named menus as the main
source, and added the reviewers and the notice.]

### 1. The cell, and what may be inferred

Every displayed field is a **cell** `(wine, field)` carrying a value and:

- **provenance**, one of: `stated` (a named person said it, `set_by`), `sourced`
  (entailed by a fetched source we can re-check), `recalled` (a model named the
  bottling), `inferred` (a model estimated it from grape, region and vintage),
  `rule_inferred` (an appellation rule permits it), `legacy_unattributed` (written
  before this ADR, model and prompt unknown);
- `source_ref` (a citation id, a run id, or a person), `issuer`, `licence`,
  `model_id`, `prompt_hash`, `run_id`, `batch_id`, `observed_at`, all taken from the
  run, never from a constant (the `load_enriched_wines.py:203` literal is the defect).

**The boundary (F5 read with ADR 0020; confirmed by the founder 2026-09-18, *"Confirm
that boundary"*).** DESCRIPTIVE traits may be inferred and
shown labelled: body, sweetness band, acidity, tannin level, aromas, serving
temperature, ageing window, glass, decanting. ATTRIBUTIVE facts are stated, sourced or
absent, never inferred: critic scores, awards, producer story, tasting note, prices,
ABV, farming, blend %, certifications. This **narrows ADR 0020** for descriptive
traits only. ADR 0020 rejected "label the mocks" because "a caption does not undo a
number the owner has already read and acted on" (`0020-no-fabricated-answers.md:40-45`)
and ruled fabricated analysis "deleted, not labelled" (`:58`). A labelled estimate
of a wine's body is not a mock of the house's own numbers; a template profile, an
"estimated" rating or an invented price is, and stays deleted. Locking this ADR locks
that narrowing.

**Two priced values the boundary allows** [round 2]. Neither of them is a seller's
price, which stays attributive.

1. **The restaurant list price** (§9) is a statistic over approved menu sightings,
   each one sourced. It is not a claim about any one seller, so it is `sourced`.
2. **The estimated value price** is what the founder asked for in Batch 2, where he
   called it an *"estimated value price based on that"*.
   - **What it is.** A model output about what restaurants charge, labelled
     *"estimated from N restaurant listings of similar wines"*. [Verifier, 2026-09-18:
     the draft label said "N listings". §9's shop line is labelled "public listing", so
     the bare word could read as shop prices; the label now names restaurants.]
   - **What it never does.** It never names or implies a seller's price. It is never
     written into a price field, a posting, or another house's cell.
   - **How it publishes.** It is the only priced value a model may produce, and it
     publishes only under §9.
   - Whether this carve-out stands is confirmed at lock (Q16).

**What a reviewer states** [round 2; the recommendation in Q13].

- **In their own voice.** A reviewer in /studio (§13) who writes a tasting note, a
  pairing or service advice makes a `stated` cell. `set_by` names them, and the page
  shows it as "tasting note by <name>".
- **A fact about someone else.** A reviewer who adds a third-party attributive fact
  (a score, an award, ABV, blend %, farming, a certification or a producer story)
  supplies its URL. The fact then goes through P6–P7 and ends up `sourced` or in
  `review`.
- An attributive fact a reviewer adds without a citation never publishes.

**Labels on people-facing pages are inline words, not tooltips**, and few: "from the
producer" (sourced, with the issuer on tap), "from your menu" (stated by the house),
"from a wine list" (a listing fact), "estimated" (inferred or recalled), "not verified"
(legacy). The per-cell agreement score is **never shown as a confidence or a
probability** until G6 has calibrated it against gold (sampled consistency is
overconfident; Xiong et al., ICLR 2024).

**ADR 0145 mapping.** `stated` and `sourced` map to the library source; `inferred` and
`recalled` map to model knowledge (ADR 0145 Fork 2: shown as not from the house's
books, never mixed into a figure); `legacy_unattributed` maps to neither. The
one-sentence description and any story are span lists: every fact carries a `cell_id`
that resolves in `wine_profile_v1` for that row; a model-written clause with no cell
("known for elegance") removes the whole sentence; the sentence takes the lowest
provenance among its inputs.

### 2. Scope: what "everything" means (F2 read with ADR 0130)

**Eligible for shared inference:** live, `beverage_kind='wine'`,
`identity_status='normal'`, not provisional, **and — proposed amendment to ADR 0130 —
a producer stated on the source that is not blank, not the wine's name, and not a
generic or style word** (House, House Wine, Cava, Prosecco, Rosé, Brut, a grape name),
and a name that is not generic (house, carafe, by the glass, Ev Şarabı, Sangria). For
new rows, specificity counts only parse parts tagged "on the source" in P2, never
inferred ones.

Why an amendment and not a reading: ADR 0130's locked formula is `name AND (producer OR
(vintage AND region))` (`0130-…md:109`), so row `ac6a550f` "HOUSE WHITE" 2023
California (source `sim`, held by Sim Bistro, no producer) is eligible today (writer
W1), and the health check would stay red until the pipeline invented a profile for
"HOUSE WHITE". **Cost of the amendment today:** at most 13 of the 3,314 eligible rows
leave (1 with no producer, 5 with a generic producer word, 7 with a generic name
pattern; W3, overlapping). Public by-the-glass lines such as "Chardonnay 2022
Sonoma" never become shared rows.

**Own buckets, never counted as covered or as missing:** venue-own provisional (49;
ADR 0130 gives them no shared enrichment, `0130-…md:247-250`; they show only what the
house states, and the 39–41 that carry a producer inside the name are parsed and
proposed to `beverage_identity_candidates` for a person to decide, because ADR 0124
rejects auto-promotion, `0124-…md:551-556`); unclassified (29 stocked,
non-provisional); under-identified (197, no profile); generic (the amendment above);
candidate-pending (a row with a pending candidate, excluded from eligibility and spend
until a person decides).

**Priority:** stocked by a real house, then stocked by a simulation house, then on two
or more lists, then in a house's market, then the rest. All 173 stocked wines are held
by simulation or admin houses today (12 distinct wines outside the three "Sim "
houses, W2), so without a flag "stocked first" would spend first on simulation data.
Add `restaurants.is_simulation boolean NOT NULL DEFAULT false`; every house counts as
real unless flagged. Never infer it from the "Sim " name prefix.

**No house that stocks a wine is real today** [round 2]. The founder ruled the four
May houses not real (Context, fact 9), so the first tier is empty. Until a real house
arrives, "stocked first" means only two things:

- **The 173 simulation-stocked wines go first in the backlog**, because the demos and
  the pilot sample read them. They get no pre-publication review: G7's first clause is
  for real houses only.
- **A real house's first menu jumps every queue the moment it arrives.** A developer
  approves the menu's extraction in /studio (§13), each of its wines is sourced and
  inferred that night, and its cells are reviewed before they show.

Health never reads the empty tier as covered: it reports "real houses: 0" as its own
line (§6). Every wine is sourced (Q1), so this order matters only when the spend cap
binds, and for how soon a wine is reached.

### 3. Data model (reuse first)

**New:**

- `wine_field_observations` (append-only): `wine_id, field, value_raw, value_norm,
  provenance, source_ref, issuer, licence, model_id, prompt_hash, run_id, batch_id,
  sample_idx, agreement (k of n), conditioned_on (observation ids), status (staged,
  validated, review, published, withdrawn, deprecated), is_current, observed_at,
  runner, deployment_id, git_sha`. **One current cell per `(wine_id, field,
  provenance)`** (partial unique index WHERE `is_current`); the view picks the highest
  provenance present. Two sources that disagree inside one provenance class send the
  cell to `review` and neither publishes. `status='review'` IS the review queue;
  `field_review_queue` (keyed on submission_id, 0 rows) retires. Ingest is unique on
  `(batch_id, custom_id, field, sample_idx)`.
- `source_documents`: `url, registrable_domain, fetched_at, http_status,
  robots_verdict, robots_read_at, terms_verdict, tier (joined from source_registry),
  licence, attribution, licence_url, content_sha256, cited_span, storage_path
  (nullable), retention_until NOT NULL`. **Default storage is the URL, date, hash and
  the short cited span, not the page body** (Decision §8).
- `job_leases(job, holder, fencing_token, lease_until)`, renewed while running; every
  write a job makes carries its fencing token.
- `wine_profile_v1`, a view (§7).
- `restaurants.is_simulation` (§2).
- [Round 2] `menu_price_sightings` (class M, §9), with one row per priced menu line:
  - **What was listed:** `master_wine_id`, `format` (bottle, half, magnum, glass,
    carafe, other), `volume_ml`, `pour_ml`, `price_minor` and `currency`.
  - **Who listed it:** exactly one of `restaurant_id` or `restaurant_directory_id`,
    plus a `group_key` (one restaurant group).
  - **Which list, where and when:** `source_document_id`, `region` and `country`,
    `list_read_on` and `list_effective_on`.
  - **Its review:** `extracted_run_id`, `approved_by` and `approved_at`.
  - **Access:** RLS scopes it to the house. The only read across houses is an
    aggregate function, `menu_list_price(wine, vintage, area)`, which enforces §9's
    rules and never returns a contributor.
- [Round 2] `house_data_sharing(restaurant_id, contributes, notice_version,
  decided_by, decided_at)`, append-only with one current row, and
  `notice_acknowledgements(restaurant_id, user_id, notice_version, surface, shown_at)`
  (§14). The pattern already exists in `guests.consent_notice_version`,
  `consent_captured_at` and `consent_withdrawn_at`.

**Reused and extended:** `evidence_citations` gains FKs to observation and source
document, span offsets, one verdict per checker, and writer identity; corroboration
becomes the number of distinct registrable domains bound to the same `value_norm`
(1 on every row today). `enrichment_queue` gains `lease_until, stage, priority,
batch_id, last_attempt_model, last_attempt_prompt_hash, next_attempt_at, reason`.
`research_runs` becomes the single run ledger, **one row per submitted batch or tick**,
gaining `stage, runner, deployment_id, git_sha, considered, emitted, withheld_reason,
anthropic_batch_id, manifest_sha256, reserved_usd, cost_usd, cost_basis (metered |
modelled)`. `restaurant_wine_roster` (sightings, 0 rows) gains `master_wine_id`,
because `signature_hash` moves. `beverage_identity_keys` / `_candidates` hold LWIN,
Wikidata and TTB COLA keys and fuzzy candidates. `field_evidence_policy` covers every
displayed field with a class (attributive or descriptive). `field_calibration` is keyed
on `(field, provenance, model_id, prompt_hash)`. `wine_repair_log`'s FK stops
cascading (`20260813120000_wine_repair_log.sql:15` erases a row's repair history on
delete). `source_registry` gains writer identity and a terms verdict. [Round 2]
**Reviewer verdicts reuse `override_events`**, which has 0 rows and is keyed on
`submission_id` today (production columns read by this writer).
- **Re-keyed:** it gains `observation_id` and `verdict` (confirm, correct or reject),
  and its `citation_url` becomes the source the reviewer checked against.
- **Double review:** it gains `double_review` for the 1-in-10 second review.
- **Corrections append:** a correction adds a new observation and never edits one in
  place.
- **Calibration input:** `field_calibration` is fed only from these verdicts (§13).

**Identity freeze and identity display.** The six hashed columns (`producer, name,
vintage, country, region, grape_variety`) stay the KEY and are never written by
enrichment, because `trg_sync_signature_hash` re-keys a row when any of them changes
(repo-assets and growth lanes). They are **not** displayed as fact: origin, grape,
appellation and `primary_type` reach pages only as cells. Legacy values carry
`legacy_unattributed`, show "not verified", and pass G1 and G3 at read time, so a
Barolo typed white or a red "White Blend" is withheld, not shown. Name, producer and
vintage carry their listing source ("from a wine list", with the list id; "from your
menu"; "from the February seed"). Identity corrections happen only through curated
repairs logged in `wine_repair_log`.

**Legacy writers.** The gateway's profile writers (`wines/wine-submissions.service.ts:333-334`,
`wines/wines.service.ts:383-384`) write `wine_structure` and `sensory_profile`
straight to the library. They are routed into `stated` cells scoped to the house
(`asserted_for_restaurant_id`, ADR 0124's alias shape) or retired; a house-stated cell
never reaches a shared row other houses read without a person promoting it.

### 4. Stages

Stage names are P1–P13; the foundations schedule S1–S8 maps onto them
(`wine-intelligence-foundations.md` §3 now points here).

- **P1 Intake, as sightings** [gateway `@Cron`; house paper the same day]. Each line
  becomes a roster sighting naming its list and read date; a menu price is a
  sighting, never a library cell (a class-M row, §3, §9). **Houses' menus are the
  main source** (Batch 2, our reading). Each house menu, and each admitted public
  list, opens one /studio review session. Its sightings and prices count only after a
  developer approves the extraction (§13). Public lists are crawled: Q7 was answered
  yes on 2026-09-18 (*"Crawl; quotes only; upload"*), and every fetch goes through the
  fetch module (§8). [Round 2: the draft held public lists until that answer.]
  **The extraction prompt gains** format, bottle size, pour size, currency, section
  heading and the list's own date. Today's prompt asks for none of them
  (`apps/api-gateway/src/menus/parsers/scan-parser.service.ts:47`). The 26 corpus
  menus are re-read under the new prompt before their prices count as class M.
  **The 41 laptop menu PDFs are uploaded** to private project storage (the answer)
  and enter under the admission rule that follows. The 26 corpus PDFs sit in the same
  gitignored folder, and a re-read needs them uploaded too: that is our reading, not
  his words (Q18). A laptop copy of a list is admitted only for
  `crawl_log.result_type` in (`pdf_link`, `html_menu`), only when its sha256 equals
  `crawl_log.content_hash`, never when that hash is the empty-input hash
  `e3b0c442…b855` (9 error rows carry it), and only when the `crawl_log` URL's
  registrable domain and platform host pass the fetch module's never-list and terms
  verdict today (§8), so a copy fetched from a forbidding host cannot enter by the side
  door. Extraction reuses the scan-parser prompt (`scripts/extract_menu_corpus.py:64-81`)
  in a batch. **Model (F1):** Opus 5 by default. The 2026-08 build used Haiku 4.5
  (`scripts/extract_menu_corpus.py:48`); a cheaper model replaces Opus 5 only if the
  Stage 1 pilot measures it as non-inferior on page-level gold. Cost cannot decide it:
  Opus 5 costs about $0.22 a list against Haiku 4.5's $0.04, $1.75 a day at 10 lists
  (Cost).
- **P2 Classify and parse** [gateway; synchronous when a house is waiting, else batch].
  Carry the menu section into `data_enrichment.menu_category` (`LibraryResolutionInput`
  has no category today, `wine-submissions.service.ts:38-45`). Parse the line into
  producer, cuvée, grape, region, vintage and kind as **cells**, each tagged on the
  source or inferred. **Never write a model-parsed `primary_type`:**
  `wine_classify_beverage_kind` treats any non-empty type other than 'unknown' as
  proof of wine (growth lane, production definition). A row with no stated section
  stays in the unclassified bucket for a person.
- **P3 Identity** [SQL]. Exact match on normalised `(producer, name, vintage)`, not
  `signature_hash` (91% of eligible rows have a hash over model-filled origin: the 3,032
  `menu_corpus` rows of 3,314, W3); then
  `match_library_wines_batch` (0.999 precision, `MENU_EXTRACTION_SCALE_PLAN.md:509-536`);
  then `find_library_duplicates`, where 'identical' attaches only when
  `safe_to_merge` is true (19 of 54 today) and `name_extends`/`fuzzy` go to candidates
  for a person; a specific identity with no match becomes a new shared row. LWIN,
  Wikidata QIDs and TTB COLA ids attach as keys, never as bulk rows.
- **P4 Enqueue** [Postgres]. Two row triggers on one function: `AFTER INSERT … FOR EACH
  ROW`, and `AFTER UPDATE … FOR EACH ROW WHEN (OLD.beverage_kind IS DISTINCT FROM
  NEW.beverage_kind OR OLD.identity_status IS DISTINCT FROM NEW.identity_status OR
  OLD.provisional_for_restaurant_id IS DISTINCT FROM NEW.provisional_for_restaurant_id)`.
  The function enqueues only rows eligible under §2, inserts with `ON CONFLICT DO
  NOTHING`, and never raises, because it sits on the menu-import path. [Critic
  correction, 2026-09-18: the draft put that WHEN clause on one `AFTER INSERT OR UPDATE`
  trigger. That cannot be created, because *"INSERT triggers cannot refer to OLD"*
  (postgresql.org/docs/current/sql-createtrigger.html, fetched 2026-09-18).] A
  column-list trigger would never fire: both columns are set by BEFORE triggers, and
  *"changes made to the row's contents by BEFORE UPDATE triggers are not considered"*
  (same page, re-read by the critic). A swallowed error is caught by the sweep below
  and reported by health (§6, trigger miss). A nightly reconciling sweep enqueues only eligible rows
  with no attempt at the current `(model_id, prompt_hash)` inside an exponential
  backoff window; a gate-rejected row waits with a reason code for a model or prompt
  change instead of being paid for every night. Claims go through an RPC with `FOR
  UPDATE SKIP LOCKED` and a lease.
- **P5 Discover and fetch** [batch: Sonnet 5 with web search, `max_uses` 3,
  `blocked_domains` = the never-list]. The model returns URLs only; any values it
  writes are discarded. Serper is never used, not even to find URLs (founder,
  2026-09-18: *"No"*). The gateway fetches each page itself through the fetch module.
  The wine-worker renders JavaScript pages only for URLs holding a fresh "allowed"
  verdict; it never decides robots itself.
- **P6 Cited extraction** [batch]. Opus 5 reads the fetched pages as document blocks
  with citations. Fable 5.1 is A/B-tested in the pilot, and under F1 the more accurate
  model on gold wins, although Fable 5.1 costs twice as much ($5/$25 batch per MTok
  against Opus 5's $2.50/$12.50, pricing page fetched 2026-09-18). A separate Sonnet 5 pass normalises into
  the schema and keeps the citation ids, because citations and structured outputs
  cannot share a request (citations doc, via the SOTA lane). Deterministic checks: the
  cited text is an exact substring of the page whose hash was recorded, and
  `value_norm` equals the normalised claim. `fn_uncited_fields` is rewritten to bind
  citations to values.
- **P7 Verify.** A value is auto-accepted as `sourced` only when (a) the deterministic
  check passes; (b) a self-hosted checker from a different model family agrees:
  `MiniCheck-Flan-T5-Large` for English (MIT; fine-tuned on 21K ANLI plus 14K synthetic
  examples, English, HF card fetched 2026-09-18) and
  `MoritzLaurer/mDeBERTa-v3-base-xnli-multilingual-nli-2mil7` otherwise (MIT, 0.3B, NLI
  fine-tuned on 27 languages including it, fr, es, de and tr, **not Greek**, HF card
  fetched 2026-09-18); (c) an Opus 5 judge with an independent prompt agrees; and (d)
  one tier-A source (producer site or official register) or two independent tier-B
  domains support it. A menu PDF counts only for listing facts. Anything less goes to
  `review`; disagreeing sources stay as competing observations. (c) belongs to the same
  model family as P6, the objection this ADR raises against C2, so (c) is not counted as
  independent: independence rests on (a), (b) and (d), which C2 lacked. A claim in a
  language neither checker covers (Greek today) cannot meet (b) and goes to `review`.
- **P8 Infer, descriptive fields only** [batch]. Enum outputs (WSET SAT levels;
  sweetness bands per Reg. (EU) 2019/33 Annex III Part B). Samples: 1 Opus 5 + 2
  Sonnet 5, emit at ≥2 of 3, else coarsen or omit; stocked wines 5 samples, emit at ≥4
  of 5. Conditioned on stated and sourced cells, plus legacy identity cells **only as
  low-trust input and only when they pass G1 and G3**, never as stated. Every inferred
  cell records `conditioned_on`; when a sourced cell lands, a capped, paid
  re-inference is enqueued. `rule_inferred` inputs are not used until P8's loader for
  them exists (Stage 2). `recalled` displays as "estimated" until audits separate it
  from `inferred` (today their Wilson intervals overlap: known 23/24, inferred 54/65,
  quality lane).
- **P9 Gates and publish** (§5). The publish RPC flips `is_current` and records the
  `batch_id` in one transaction under a per-batch lease, so a batch can be rolled back.
  [Round 2] It also compares the row's `signature_hash` with the hash recorded when
  the observation was staged. If they differ, because an identity column changed in
  between, the cell goes to `review` instead of publishing (§15). /studio approvals
  publish through this same RPC (§13).
- **P10 Market price** at read time (§9).
- **P11 Re-verify**, weekly: re-fetch, compare hash; a change marks the cell stale and
  re-runs P6–P7. The 105 `file://` citations are re-archived or retired before they
  count as sourced.
- **P12 Embeddings, deferred until a reader exists.** A new table keyed
  `(wine_id, model_id, text_version)`; every reader filters on `model_id`; the legacy
  column and `scripts/populate_embeddings.py` retire; the 3,431 MiniLM vectors are
  tagged legacy and not reused. An identity vector from names only (multilingual) and a
  style vector from published cells `recalled` or better; the model is chosen by a
  measured bake-off on decided identity candidates; ivfflat is rebuilt after each bulk
  load with lists ≈ rows/1000.
- **P13 Health** (§6).

**Sourcing order (Q1 answered 2026-09-18: *"Every wine from day one"*).**

- **Source first, for every wine.** Every eligible wine attempts sourcing (P5–P7)
  before inference, from the first night the pipeline spends money (Stage 1). P8 then
  runs on what sourcing found, so a sourced cell conditions the estimate instead of
  paying for a re-inference later.
- **New wines** are sourced the night they arrive (N equals intake).
- **The backlog.** The 3,314 eligible rows are sourced and re-inferred at 500 a night,
  about 7 nights. [Verifier, 2026-09-18: the backlog starts on the first paid night,
  beside the pilot (step 1.8), and its cells stay staged until each field's pilot
  audit clears (§5). Sourcing only after the audit would push "day one" back by the
  audit's length, which his answer does not allow. The 500 a night is the draft's
  re-inference pace carried over. Its only stated reason is the cap, so the pace is
  still his (Q1 (b)).]
- **The cost of this answer.** A new wine waits for its sourcing batch to be ingested
  before any cell exists. That is usually the same night and at most two 24-hour batch
  windows. Meanwhile the page says "coming soon".
- **No source found.** The wine is inferred and labelled "estimated".
- **Real-house stocked wines** are still reviewed before publication.
- **What still limits sourced coverage** is how many wines have a findable producer or
  register page. That is unmeasured until the pilot.

[Round 2: this replaces the rule below, which assumed N was below intake. The founder's
answer removes that premise, so Q5 is answered by Q1. The earlier text is kept as the
record:] *Wines stocked by a real house attempt sourcing
before inference, and in Stage 1 (before sourcing exists) their inferred cells publish
only after a person reviews them. Every other eligible row is inferred first and
re-inferred when a sourced cell lands. The judged design's "sourced before any
inference" would leave a new wine blank until its sourcing pass ran, and it contradicts
its own delivery plan.* [Critic, 2026-09-18: the draft also said it "cannot hold" at
about 1,000 new wines a day against about 100 sourced a day. That was circular: 100 a
day is the spend dial N this ADR recommends (Q1), not a measured ceiling. The
arithmetic the founder needs is this. At N = 100 and an intake of 1,000–1,250 a day,
the unsourced backlog grows by 900–1,150 a day, and only 8–10% of new wines ever
carry a sourced cell. At N equal to intake, every new wine gets a sourcing attempt.
What then limits sourced coverage is how many wines have a findable producer or
register page, which is unmeasured until the pilot (Cost).]

### 5. Gates

Every gate **exits 2 or marks cells `unchecked` when its input or its reference table
is empty or does not cover the batch.** A bad value rejects the cell, not the row.

- **G0 presence:** n > 0, every id resolves, run metadata present.
- **G1 vocabulary:** rejects sentinels ('Unknown', 'unknown', 750, 0), regexes (33
  seed appellations), bare tier words and prose; adds a CHECK on `primary_type` (12
  spellings today) once the canonical set is chosen (Q10).
- **G2 contract:** `unknown` ⇒ no attributes; attributive cells stated, sourced or
  absent; no profile on bucketed rows.
- **G3 cross-field:** a reference table built from Candiago et al. 2022 (1,177 wine
  PDOs, authorised varieties, CC BY 4.0) and grape berry colour from Wikidata grape
  items (CC0); **the TTB AVA list is dropped from G3** because it carries no colour or
  grape rules. Barolo typed white fails; a white wine from a red grape goes to review.
  Coverage is measured per appellation; an uncovered appellation is `unchecked`.
- **G4 duplication:** a hit sends ROWS to review, never fails the batch; a
  batch-level distinct-fingerprint ratio gate (measured 0.749 on the good 2026-08-14
  batch and 0.096 on the 08-16 template batch, free-text proxy) is re-calibrated on the
  Stage 1 enum pilot before arming, because the pinned fingerprint flags 79% of a good
  batch once coarsened to enums (adversarial pass, measured proxy). Identical free text
  across producers is rejected. The three look-alike `menu_corpus` rows are negative
  tests.
- **G5 provenance integrity:** value-bound citations; no `file://` source; provenance
  written with its value.
- **G6 gold canary:** per-field Wilson lower bound ≥ floor, and a model or prompt
  change must be non-inferior. Too little gold means FAIL. [Round 2] **Gold grows from
  the reviewers' checks in /studio (§13):**
  - Only an explicit confirm, correct or reject on a cell, checked against its source,
    counts as gold. Instant promotes and bulk approvals do not, and neither does
    `review_status`, because *"a pre-label a human never looked at is not gold"*
    (`01-org/platform/data/teams/annotation-ground-truth/annotation-ground-truth-charter.md:49`).
  - 1 verdict in 10 goes to a second reviewer, so agreement is measured per field.
- **G7 audit:** before publication for wines a real house stocks; for every other
  inferred cell, a 60-cell stratified audit within 7 days of publication. **If the
  audit is not done in 7 days, the batch's inferred cells withdraw and health turns
  red.** A field below its floor withdraws until the model or prompt hash changes.
  [Round 2] **Who and where:** the reviewer roles do the audit in /studio. No real
  house exists today, so the first clause covers no wine yet (§2). A contributor who
  has earned auto-promotion stays inside this sample.
- **G8:** an inferred value never overwrites a stated or sourced one.
- **G9 drift:** an alarm only, blocking only with a G6 degradation.

**A field publishes for the first time only after a PRE-publication pilot audit clears
its floor.**

- **The floors are set.** The founder answered on 2026-09-18, *"0.95 / 0.90 /
  0.80"*: sourced ≥ 0.95, recalled ≥ 0.90 and inferred ≥ 0.80, each a Wilson lower
  bound.
- **What he was told before setting them.** Frontier models score about 0.63–0.64 on
  wine feature completion (SommBench, arXiv 2603.12117, via the SOTA lane). At 38 of
  60 correct, the Wilson lower bound is about 0.50. So at 0.80 several descriptive
  fields may never publish uncoarsened.
- [Round 2] **The estimated value price (§9) is held to the inferred floor**, read as
  coverage: the range it shows must contain the held-out wine's own restaurant list
  price. That needs at least 16 wines with a list price, and none has one at k = 5
  today (§9) [verifier].

### 6. Health that proves presence (P13)

`wine_pipeline_health()` reads `wine_profile_v1`, **throws when a read fails** (the ADR
0161 pattern), and is written as a durable row every hour. It is RED when any of:

- an eligible real-house or simulation stocked wine has no published profile after
  24 h (95 today), reported per required field, with abstentions counted apart from
  missing values;
- a stocked wine is unclassified after 24 h (29 today);
- a bucket (provisional, under-identified, unclassified, generic, candidate-pending)
  grows, or a stocked row moves into one — so a regression cannot shrink the
  denominator;
- a crawled list has 0 sightings and no reason code; no new rows or sightings in 24 h
  without a reason;
- a job's ledger is older than twice its cadence; **a disarmed job is its own red
  state**, never "considered 0";
- a batch is in progress over 24 h, or ended and not ingested; a lease expired; a run
  is still `running` past its window (4 today);
- month-to-date spend exceeds the cap, or includes any `cost_basis='modelled'`;
- a pipeline model call with tokens > 0 has `cost_usd` NULL (scoped so the 23
  NULL-cost DocumentExtractor failures with NULL tokens, measured by the adversarial
  pass, do not paint it red from day one);
- **any foreign writer row** (a `research_runs`, `evidence_citations`, `source_registry`
  or observation row whose `runner` is not the declared host);
- duplicate identity groups grow (34 today); a G7 audit is overdue;
- [critic additions, 2026-09-18, so F2's "everything" is proven and not assumed] **an
  eligible row of any kind, stocked or not,** has no attempt at the current `(model_id,
  prompt_hash)` beyond the backlog the cap allows, or the sweep's `considered` differs
  from health's own count of eligible, unattempted, out-of-backoff rows (an armed sweep
  that sees nothing reads red, not quiet);
- a run has `considered > 0`, `emitted = 0` and no `withheld_reason` (a sourcing or
  inference pass that yields nothing is not a healthy run);
- **trigger miss:** an eligible row inserted more than an hour ago has no
  `enrichment_queue` row. Without this rule the nightly sweep would hide a P4 trigger
  that has stopped working;
- [round 2] **real houses: 0** is its own reported line. While it is 0, the
  real-house rules above read "no real house", never green;
- a house menu has waited more than 48 h for developer approval in /studio, or the
  review queue has passed its set depth (§13);
- the class-M compute cannot read `house_data_sharing`. It throws (the ADR 0161
  pattern). A house with no row counts as "not told yet" and is excluded, never
  counted as contributing (§14);
- **the laptop writer, until cutover (§15).** Until cutover, a row from a runner that
  is not declared is reported as the named state `laptop_writer_armed`, with its
  count. That state is neither healthy nor an unexplained red. After cutover, the
  foreign-writer rule above applies unchanged. The spend rules count only
  pipeline-runner rows, and the laptop's modelled cost is reported apart.

An empty price register reads "no index", never as absent. **An outside dead-man alarm
is a Stage 0 exit criterion**, because a check inside a process cannot report its own
process missing: Sentry Crons if the gateway reports to Sentry (unverified: the Sentry
org has no Node project), otherwise a `pg_cron` witness on the founder's word.

### 7. F6 recommendation: a database view, with a hand-written type

`wine_profile_v1` returns, **per field, `(value, provenance, source_ref, issuer,
observed_at, cell_id, licence)`**, choosing the highest provenance present (stated,
sourced, recalled, inferred or rule_inferred, legacy), ties by tier, then
corroboration, then recency. `legacy_unattributed` is a candidate only for the
identity and listing fields (§3). **The view never returns it for a profile field**
(structure, aromas, serving, ageing, quality), because §10 and Q8 retire the 3,346
legacy profiles from display (Q8 answered 2026-09-18: *"Stop showing, redo them"*). Without this rule the ranking above would show them as
"not verified" wherever nothing better exists [critic, 2026-09-18]. The missing-value
rule is applied once: 750, 0 and 'Unknown' read as absent. It is `SECURITY INVOKER`, granted to `service_role` only,
because a view carries no RLS (`0026-…md:363-366`). Market price is **not** in it (§9).

**Why a view:** pages, the analytics loaders and the health check then read exactly one
projection, so a monitor can never measure something different from what a page shows
(itself an instance of absence reported as health); the missing-value rule lives in one
place; and the statement shape already exists in `evidence_citations`. **Why a
hand-written type:** CI has no database, CLAIMS verifies must be static, and ADR 0026
rejected generated types; a static CI test pins the `WineProfile` type against the
view's column list in the migration. `mapWine` and the five `master_wine_library(primary_type)`
embeds move to the view; a static guard fails any new direct read of profile columns.
Wine-360 stays computed in the gateway, because it is tenant data. **Cost:** SQL is
harder to unit-test; PGlite and the local-Postgres recipe the repo already uses cover it.

### 8. One fetch module, lawful by construction

One shared gateway module replaces the three fail-open readers and enforces:

1. the never-list (Vivino, Wine-Searcher, CellarTracker, OpenTable, Google `/search`,
   Serper) **at fetch time and after every redirect**, not only as web-search
   `blocked_domains`;
2. robots.txt parsed only from a 200 with a `text/plain` body; any other 2xx, an empty
   or HTML body, or a WAF-challenge header (CellarTracker answers 202, empty,
   `x-amzn-waf-action: challenge`) is undefined, meaning disallow;
3. 401, 403 and 429 disallow (RFC 9309 §2.3.1.3 only says a 4xx MAY be read as allow);
4. 5xx, network and TLS errors disallow, with no 30-day relaxation;
5. a terms verdict per registrable domain in `source_registry` (unread, silent,
   permits, forbids). `forbids` is never fetched. `unread` and `silent` (a terms page
   was read and says nothing about automated reading or reuse) are fetched only under
   snippet-only storage. Silence is not permission [critic, 2026-09-18];
6. a User-Agent with a working contact URL (`wineops.ai/bot` and `mudavym.com/bot`
   return 404 today, per the adversarial pass);
7. terms checks for the platform hosts behind the 57 list URLs (hub.binwise.com 12,
   the getbento CDN 9, indd.adobe.com, canva.link, framerusercontent, the Webflow CDN),
   not only the restaurants.

[Round 2, answered 2026-09-18: *"Crawl; quotes only; upload"*.]

- **Crawling resumes.** Public-list crawling resumes under rules 1–7. That is the
  legal remainder of F2 (Q7), now accepted.
- **Storage.** For every fetched page, storage is the URL, the date, the hash and the
  short quoted span. `storage_path` stays null (Q6 (a)).
- **The one exception** is the uploaded laptop menus (§4 P1). How long they are kept
  is Q18.
- **Serper** is on the never-list for every use, URL discovery included.

Licence, attribution and licence URL travel with every stored or keyed value, as
`commodity.service.ts:51` already does: LWIN (CC BY 4.0, "indicate if changes were
made"), Candiago 2022 (CC BY 4.0), INAO (etalab-2.0). OpenStreetMap is used only from a
planet extract, for discovery only, never displayed. `rule_inferred` values render as
"permitted by the <appellation> rules", never as the bottle's composition, and never
fill a grape cell unless the rule mandates a single variety.

### 9. Market price: read from menus, beside what houses pay and a public listing

The founder's answers here (Context, round 2):

- **F4:** *"Both, labelled"*: the house index, and a public listing beside it.
- **Batch 2 (quote P):** the market price comes *"from menu … or estimated value price
  based on that"*.
- **Q12:** *"Use Hi-Time, ask the rest"*.

[Round 2: the draft had two lines, the house index and the public listing. The menu
answer adds a third and names it the market price.]

Market price is **never a cell in the shared view**. Every line is computed at read
time for the house reading it. A page shows up to three lines. They are never merged,
and no difference between them is ever computed (ADR 0117).

**Line 1, "Restaurants list it at": the market price (class M).**

This is a proposed new row in ADR 0117's class table: a restaurant list price, meaning
what a guest pays, markup included. Adding the row amends a locked ADR (Q16). It is
compared only with other class-M prices, and it is never placed beside a supplier
quote as if the two were comparable.

- **The restaurant list price (sourced).** The median 750 ml bottle price over
  approved class-M sightings. The rules:
  - one price per restaurant group, from its latest list;
  - the same vintage (vintages are pooled only when the line says so);
  - one currency, never converted;
  - one state or region (a pooled figure names its area);
  - only lists read in the last 18 months;
  - outliers beyond 3 median absolute deviations trimmed.

  It is shown with the number of restaurants, the date range and the spread. Glass
  prices are a separate line, with the pour size when the list states it, and are
  never converted into a bottle price.
- **The minimum.** The line needs at least **k = 5 restaurant groups**, and no single
  house may carry more than 25% of the weight. Below k it reads "fewer than 5
  restaurants list this — no list price yet". One other house's single price is never
  shown on its own. [Verifier, 2026-09-18: a median over an odd number of lists *is*
  one list's price, and a min–max spread shows two. Those prices are printed on public
  menus, but no house can be promised that its price stays out of every figure. §14's
  notice says so, and how the spread is shown is Q16 (f).]
- **The estimated value price (inferred, labelled; §1).**
  - **When:** only when fewer than k restaurants list the wine.
  - **What:** a range built from similar wines' class-M prices. It looks first at the
    same producer's other vintages, then the same appellation and tier, then the same
    grape and region.
  - **Label:** "estimated from N restaurant listings of similar wines" (§1), under the
    line's own heading, so it never reads as a shop price.
  - **Publication:** only once its held-out coverage clears the inferred floor (§5).
    [Verifier, 2026-09-18: a held-out test needs wines that have a restaurant list
    price to hold out. A Wilson lower bound (z = 1.96) reaches 0.80 only at 16 of 16
    covered (16/19.84 = 0.806; 15 of 15 gives 0.796), so the test needs at least 16
    such wines. Today there are 0 at k = 5 and 9 at k = 3, so **the estimate cannot
    publish under either k yet.** Holding out single sightings instead would allow an
    earlier but weaker test; that choice is Q16 (g).]
- **Why not divide a menu price by a markup.** Deriving a shop or wholesale price that
  way is rejected, because markups vary too much for one divisor. Dearden, Guo and
  Meyerhoefer (*Journal of Wine Economics* 16(3), 2021, doi:10.1017/jwe.2021.25) studied
  375 New York City restaurants: the mean menu price was $57.74 against $14.87
  wholesale, and each extra wholesale dollar added only $1.23 to the menu price. One
  divisor would give a precise-looking wrong number, which ADR 0020 forbids.
- **Coverage today:** 0 wines at k = 5 and 9 at k = 3 (Context, fact 7). Until at
  least 16 wines reach k, the estimate cannot clear its test either (above), so **the
  restaurant line is blank for almost every wine at first**. After that, most wines
  will show the estimate. [Verifier, 2026-09-18: the draft said "the estimate line or
  nothing" from the start.]
- **Checking the houses' prices.** Batch 2 says *"We're gonna check their values.
  We're gonna check their prices"*. A class-M sighting therefore counts only after a
  developer approves its menu's extraction in /studio (§13). A price that fails either
  check below goes back to review:
  - it lies more than 3 median absolute deviations from the wine's class-M median;
  - it breaks its format, for example a bottle priced below the same list's glass.

**Line 2, "Houses pay": the house index (F4's first line) under ADR 0117's classes.**

- **Classes.** Class A (own paper) is for this house only. Class B is for the same
  state only. Class C follows ADR 0126.
- **Registers.** `price_index_postings` is the jurisdiction register for B and D. It
  has no `restaurant_id`, so it cannot serve a shared view.
- **Empty registers.** When a register is empty, as all three are today, the line
  reads "no house index for your market yet". Sim Bistro and Sim Vanilla Kaleiçi have
  no `state_province`, so no class-B line can exist for them.
- **Your markup.** Beside this line, and for this house only, "your markup" is its menu
  price divided by its own invoice price. Both are class A, and the figure is never
  pooled.

**Line 3, the public listing (class D),** answered 2026-09-18: *"Use Hi-Time, ask the
rest"*. It uses only shops whose **terms page** (not robots.txt)
was read and does not forbid the use. Today that is **Hi-Time alone**, and its terms
are *silent*, not permissive. [Critic, 2026-09-18: hitimewine.net/terms-conditions/
covers shipping, prices, returns and pictures, and hitimewine.net/privacy-policy/
covers personal data. Neither has a clause on copying, automated access or commercial
reuse. Both were fetched 2026-09-18. The registry records Hi-Time's terms as "robots.txt
only." (`vendor-intel/price-reference-shops.ts:318`), the same defect as the other
three, so step 0.9 corrects it to `silent`. Arming it stays the founder's call (Q12).] Tanners: *"You may not,
except with our express written permission, distribute or commercially exploit the
content. Nor may you transmit it or store it in any other website or other form of
electronic retrieval system."* (tanners-wines.co.uk/pages/terms-conditions, fetched by
this writer 2026-09-18.) Berry Bros & Rudd: *"You may not otherwise reproduce, modify,
copy, distribute or use for commercial purposes any of the materials or content on the
Site without our written permission."* (bbr.com/about/website-terms, fetched
2026-09-18.) Slurp §7 requires prior written consent and allows links to the home page
only (adversarial pass; not re-fetched). The registry recorded robots.txt as the terms
for all three (`vendor-intel/price-reference-shops.ts:197-198, :219, :239`), against
its own header rule that a shop whose terms could not be read is recorded as unarmed
with the reason (`:59-62`). Those entries are corrected and unarmed with reason `terms_forbid` until
written permission exists; no Slurp product page is ever linked. The listing names the
shop as issuer, a "read on" date and the label "public listing"; it runs weekly on
stocked wines. Serper is never a price source.

[Round 2]

- **Hi-Time is armed** on the founder's answer. Its prices are displayed only. They are
  never used to train or fit the estimated value price.
- **Tanners, BBR and Slurp** are asked for written permission. The letters are drafted
  for the founder to send; nothing is sent on his behalf. Until permission exists they
  stay unarmed with `terms_forbid`.
- **The line order is a proposal:** restaurants, then houses, then the shop. His F4
  answer put the house index first, before the menu answer existed, so the order is
  confirmed at lock (Q16).

**Guards on pooling menu prices.** This is not legal advice. A lawyer reviews it
before the first real house's prices pool (Q17). The rules:

- only lists currently in effect;
- never pool costs, invoices, POS data or sales across houses;
- aggregates only, with k met and no house above 25% of the weight;
- the market price never feeds a price recommendation automatically (`pricing_analyses`
  has no writer, and keeps none);
- no price on any page that needs no sign-in. For Türkiye, Law 4250 art. 6 bans
  alcohol advertising and promotion (`07-reference/price-sources.md:268`, recorded
  there as unverified at the primary source). Whether that ban reaches a signed-out
  price page is for the lawyer (Q17 (f)). [Verifier, 2026-09-18: the draft said the
  rule "is required by" the law, which states a legal conclusion that no source here
  supports.]

The reason for the guards: the US agencies withdrew the information-exchange "safety
zone" in 2023, and the Justice Department's proposed RealPage settlement (24 November
2025) bars live use of competitors' non-public data (lane; not re-fetched here).
Printed menus are public, and that is the main mitigation.

**`price_reference` leaves the shared projection.** `mapWine` sends `price:
row.price_reference ?? 0` (`wines/wines.service.ts:161`): another restaurant's list
price with no issuer, date or unit and a default of 0, which already breaches ADR
0117. A menu price becomes a roster sighting that names its list and read date.
[Round 2] That sighting is a class-M row (§3). The write in
`wines/wine-submissions.service.ts:323`, which copies a house's `priceReference` onto
the shared library row, stops, and the value becomes that house's sighting.

**ABV.** A sourced ABV is its own labelled cell ("the producer's sheet for 2019 says
13.5%"). It never writes `abv_percent` and never feeds `duty.ts`, because that column
is typed by a person with nothing inferred or backfilled
(`20260906120000_a_strength_is_stated_by_a_person.sql`).

### 10. F3: repair, then load

[Q8 answered 2026-09-18: *"Stop showing, redo them"*. The 3,346 legacy profiles
retire from display and are re-derived; nothing is deleted.]

From `library/restaurant_wine_dataset.jsonl`: identity from `original_data` only (the
menu line, 197 rows). Dropped: the 187 'estimated' ratings, the 197 estimated prices,
the placeholder blocks, and the 39 Facchin stories; the row-level `verified: true`
never outranks a block-level status. The 33 regex appellations are rejected by G1.
Producer facts from `stage1_producer_research_raw.json` (5,382 observations with a URL)
are re-fetched through the fetch module before any loads. A story is composed only
from sourced spans (§1). The file's descriptive blocks (serving temperature, glass,
ageing; the fields the founder's test in foundations §2 found missing) name no model
and no source. Under §1 they are `legacy_unattributed`, so they load, if at all, as
observations the view never shows (§7), and P8 re-derives those fields. [This is the
critic's reading of §1 and §7; the draft was silent, and F3 did not address these
blocks.] The 44 copied rows and the 1,443 templated 08-16 profiles are
**not repaired in place**: all 3,346 legacy profiles retire from display (Q8) and are
re-derived through P8; nothing is deleted, and nothing a page shows today is lost,
because `mapWine` sends no profile (`wine-intelligence-foundations.md:187-193`).

### 11. Hosts and money

- **Postgres** holds state, gates, the view and health.
- **Gateway `@Cron` plus `ModelClientService`**, with three changes: a batch
  transport (it posts only to `/v1/messages`, `model-client.service.ts:7`); a
  `claude-opus-5` price, the batch discount and the $10 per 1,000 search fee (its table
  has only haiku-4-5, sonnet-5 and opus-4-8, `:25-37`); and a month-to-date pre-flight
  for background submissions that **fails closed** (the current per-restaurant ceiling
  fails open on a ledger error by design, `:600-606`; the synchronous house-waiting P2
  path keeps that behaviour but is counted).
- **Crons are gated by role.** `ScheduleModule.forRoot()` is unconditional
  (`app.module.ts:84`), so every gateway process with production credentials would run
  paid crons. Wine crons register only when `WINE_PIPELINE_ROLE=primary` and
  `RAILWAY_DEPLOYMENT_ID` is present; the holder is recorded on each ledger row; health
  is red when a non-Railway holder claims a job. Locks are real leases with fencing
  tokens; `house-letters.service.ts:742-752` is a status flip with no expiry and is
  not the pattern.
- **Anthropic Message Batches** in a dedicated workspace with its own spend limit:
  100,000 requests or 256 MB per batch, 24 h expiry, results for 29 days; server tools
  work in batches; canceled requests are not billed; and **"batches may go slightly
  over your Workspace's configured spend limit"** (batch-processing doc :43-48, :60,
  :713, fetched 2026-09-18). **Two-phase submission:** write the `research_runs` row
  as `submitting` with its manifest and run-prefixed `custom_id`s; submit; record the
  batch id; on boot, list recent batches and ingest or cancel orphans by prefix. The
  pre-flight **reserves** a worst case for every batch in flight (requests ×
  `max_tokens` × output price + input + `max_uses` × $0.01 + a search-result token
  bound), released at ingest. A 429 `enforced_spend_limit_reached` or a 400 workspace
  limit is a HALT that cancels in-flight batches, never a per-row failure.
- **One Railway cron service, `wine-worker` (Python), from Stage 1:** rendering, the
  MIT checkers, embeddings. Its deployment is proven by the Railway `cronSchedule`
  and its ledger rows, never by code. [Round 2: moved from Stage 2. Every wine is
  sourced from the first paid night (Q1), and P7 needs the self-hosted checker.]

### 12. Retired

The Celery lane; `score_tasks`, `critic_score_service`, `haiku_enrichment_service`,
`haiku_tasks`; the Vivino, Wine-Searcher and CellarTracker scrapers and
`image_collector`'s Vivino call; `opentable_discovery`; `web_verification_service`;
research Layer-1 `ontology://` citations; the `AddWineModal` mock; `load_enriched_wines.py`;
`calibration_tasks.py`; the constant `field_confidences`; `enrichment_observed_at` as a
freshness signal; `field_review_queue`; `source_registry` rows for vivino.com and
wine-searcher.com; `__menu_pdf__` as tier A beyond listing facts;
`scripts/populate_embeddings.py` and the legacy `embedding` column; the four Desktop
wine tasks, and the gitignored pipeline folder once `evidence.py` and `signature.py`
logic is in the repo. [Round 2] The Desktop tasks retire **at cutover (§15), not
before** (founder, 2026-09-18). Also retired: Studio's direct library insert
(`promote_to_library`, `services/agent-orchestrator/api/studio_routes.py:926-1114`);
the override auto-promotion insert (`services/override_service.py`); and the quality
PATCH insert (`api/quality_routes.py`). The publish RPC replaces all three (§13).
Serper is retired for every use. The analytics promise in `ServicesPermissions.tsx:88`
is amended, not retired (§14).

### 13. Review happens in /studio (Q4 answered)

**What he said** (quote R): the early design already has the reviewers. It does
(Context, fact 6). /studio becomes this ADR's review surface, and no new page is
built. The roles stay as designed and invite-only: `developer`, `review_admin`, and
`certified_contributor`, meaning sommeliers, producers and approved groups
(roles and invites `13-CONTEXT.md:21-22`; the outside users `5c9820de7:.planning/ROADMAP.md:24`).

**Who does what:**

- **Developers approve each menu's extraction.** Every house menu, and every admitted
  public list, opens one Studio session.
  - **The check.** A developer checks each extracted line (identity, section, format,
    price) against the menu, then approves, corrects or rejects it.
  - **Until then** the menu's sightings and prices do not count (§9), and its new
    identities stay candidates.
  - **What it replaces.** This is the review of P1–P3. It replaces
    `wine-audit-weekly`'s blanket `UPDATE … review_status='approved'` (Context, fact
    1), which approves rows no person looked at.
- **Sommeliers (certified contributors) approve cells and add wines and features.**
  - **Approving:** they confirm, correct or reject staged and published cells.
  - **Adding:** they add wines a menu missed. They add features as a `stated` tasting
    note in their own voice, or as a third-party fact with its URL, which P6–P7 check
    (§1).
  - **Promotion:** a new contributor's work goes to a review_admin until 5 approvals
    in a row (D-12). After that it publishes without the queue, but stays inside
    G7's sample. Whether this auto-promotion, and developers' instant promotion (D-13),
    are kept is still open (Q15) [verifier].
- **Review admins** run the queue, the invites and the 1-in-10 double review.

**The queue is the observations.**

- **What it shows.** `/studio/queue` reads `wine_field_observations` where
  `status='review'`, plus staged cells awaiting a first-publication audit.
- **Approve** publishes the cell through the publish RPC (§4 P9).
- **Correct** appends a new observation with the reviewer as `set_by`.
- **Tables.** `field_review_queue` retires (§3), and `override_events` holds the
  verdicts (§3).

**The gold set grows from their checks** (G6):

- **What counts as gold.** Every explicit verdict on a cell checked against its source
  is a gold label for G6 and `field_calibration`. An instant promote or a bulk approval
  is not.
- **The pilot audit** (step 1.6) is done here, by the reviewer roles, not by the
  founder alone.

**Capacity is measured, not assumed.**

- **Today** three accounts hold roles, one of them with no `users` row, and no
  sommelier has been invited (Context, fact 6). [Verifier, 2026-09-18: the draft said
  two people. `user_roles` has 3 distinct `user_id`s.]
- **What health watches.** It reports the queue's depth and age (§6).
- **When the queue is full.** Intake pauses when the queue passes its set depth, and
  the pause names its reason.
- **Raising the pace.** The daily dial rises only when measured reviewer throughput
  covers intake.

**What must be fixed first** (Stage 0, step 0.17):

- the promote path writes through the publish RPC, instead of inserting columns the
  table does not have;
- the override and quality paths stop selecting absent columns, or retire;
- an invite works for a person with no account;
- `/api/v1/quality/*` is reachable through the gateway, or retired (lane: it has no
  gateway proxy and returns 404 on mudavym.com);
- the two docs that list promotion as working are corrected;
- the defects are filed in `v3.0-TECH-DEBT.md`. That filing is owed; this edit does not
  touch the register.

**Payment is not designed.** "Paid sommeliers" is our reading; quote R's "paying" also
admits the reverse. Nothing pays anyone today, and any cash payout collides with the
Stripe guard and OD-23 (Context, fact 6). The question is Q14.

### 14. Every house is told, and can opt out (answered: *"A notice with an opt-out"*)

**The notice.**

- **When:** before a house's first menu counts.
- **What it says:**
  - the menu's wines and their bottle and glass prices feed the shared library,
    training and analytics;
  - other houses see only figures built from at least k restaurants, never the
    house's name. A figure such as a median or a range end can equal the price printed
    on its public menu; [verifier, 2026-09-18: the draft promised "never … its prices".
    A median over an odd number of lists is one list's price, so that promise could
    not be kept (§9, Q16 (f)).]
  - its costs, invoices, POS data and sales are never pooled;
  - it can stop at any time, and its own analytics keep working.
- **Where it is shown:** at sign-up, at the first menu upload, on /privacy and in
  settings.
- **The record.** Each showing is recorded with its notice version in
  `notice_acknowledgements` (§3).
- **Wording.** The round-2 research holds draft wording, which goes to a lawyer with
  the Terms of Service (Q17).

**The opt-out.**

- **Where.** A new house settings section, `shared-library`, of kind `restaurant`,
  appended to `SECTION_IDS`. Ids are appended there and never inserted
  (`apps/web/src/pages/settings/next/st-format.ts:107-115`).
- **Storage.** It is backed by `house_data_sharing` (§3).
- **Who may change it.** Only the owner. Changes show in the settings ledger.
- **Not the setup assistant.** It is outside what the setup assistant may propose (ADR
  0113), because it changes who sees the house's data.
- **Rejected homes:**
  - the Features section, whose meaning is *"The switches that change what the system
    does on its own."* (`st-format.ts:152-153`);
  - `servicePermissions.privacy_sharing`, which is per person and read by nothing.

**What opting out does** (a proposal; Q17):

- the house's sightings leave the next class-M recompute and every future training set;
- its menu still resolves against the library for its own analytics;
- a wine the library lacks stays the house's own (ADR 0130's venue-own shape), instead
  of becoming a shared row;
- models already trained are not retrained, and the notice says so.

**Before any pooling**, three things ship before the first real house's menu counts
toward class M or training:

- `ServicesPermissions.tsx:88` (*"Never includes your wine list contents"*) is amended;
- /privacy gains the section;
- Terms of Service exist.

No real house has uploaded a menu (Context, fact 8). So no customer house's menu is
held today, and the notice has nothing to cover retroactively. [Verifier, 2026-09-18:
the draft concluded that "nothing already held needs consent". That is a legal
conclusion this ADR cannot draw. The library already holds prices from 26 public
menus of restaurants that are not customers (fact 7), and the 41 laptop menus will
join them. Whether pooling those needs anything beyond their being public is for the
lawyer (Q17 (g)).]

### 15. Two writers until the repo pipeline runs (answered: *"Keep until the repo pipeline runs"*)

**When cutover happens.** The four Desktop tasks stay enabled until cutover. Cutover
is the first night on which the repo pipeline meets all three conditions:

- it runs under `WINE_PIPELINE_ROLE=primary` on Railway;
- it has a ledger row for P1 intake, P5–P7 and P8, each ingested with `emitted > 0`
  or a reason code;
- health has no red reason except the coverage and backlog rules, which the backlog is
  still working down. Coverage stays red for about a week after the first paid night,
  so a plain "health is green" test would put cutover off for no reason.

That day the founder disables the four tasks (his keystroke; step 1.10). Until then
two writers can reach production. This ADR contains the laptop writer by construction,
not by trust:

1. **Nothing the laptop writes can reach a page.**
   - **The laptop's writes.** It writes library columns, `research_runs`,
     `evidence_citations`, `source_registry` and `restaurant_directory`, never
     observations.
   - **What pages read.** Pages read only `wine_profile_v1` (§7), which reads
     observations. Laptop values in library columns rank as `legacy_unattributed`, and
     the view never shows a legacy profile field.
2. **Its approvals are not approvals.** `wine-audit-weekly` runs `UPDATE … SET
   review_status='approved'` (`~/Documents/Claude/Scheduled/wine-audit-weekly/SKILL.md:26`).
   No gate, view or gold set reads `review_status`, so this changes nothing a page or
   G6 sees.
3. **It cannot move a row under the pipeline.** The publish RPC's hash check (§4 P9)
   sends a cell to `review` when the laptop has edited the row's identity since the
   cell was staged.
4. **Its rows are named.** Writer identity (step 0.2) marks every pipeline row. A row
   with no declared runner is the laptop's, and it is reported as
   `laptop_writer_armed` (§6).
5. **Its runs are never closed under it.** The `research_runs` reaper stays disarmed
   until 7 days after cutover with 0 foreign rows (step 0.15).
6. **Each list is read once.** A list the laptop already fetched enters only through
   P1's laptop-copy admission rule. The pipeline never fetches a list whose content
   hash is already a source document.
7. **Its spend is separate.** The laptop's model work runs inside Claude Desktop
   (Context, fact 1), not through the pipeline's API workspace. No Python file in the
   gitignored `datasets/annotation_inbox/` names an Anthropic key or client (verifier,
   `grep`). So it never draws on the workspace's spend limit. Health's spend rules
   count only pipeline-runner rows. [Verifier, 2026-09-18: the draft said the laptop
   "runs under another org". Fact 1 does not show that; its path names org
   `1138b209`, which may be the org the workspace is created in.]

**What this does not contain.** The laptop can still write wrong values into library
columns that old readers use directly, such as `mapWine` before step 0.7. So step 0.7
is not deferred.

## How each adversarial change was handled

Pass A (legality and honesty, 6 kills) and pass B (operations and correctness, 9
kills). "Applied" means the Decision above carries it.

| # | Required change | Outcome |
|---|---|---|
| A1 | Identity group displayed only as cells; legacy labelled "not verified" or withheld; G1/G3 at read time; S8 never treats legacy as stated | Applied (§3, §4 P8) |
| A2 | Generic-name test; source-tagged specificity; buckets out of the denominator; raised as an ADR 0130 amendment | Applied (§2; Q9), measured cost ≤13 rows |
| A3 | Price never a view cell; ADR 0117 classes at read time; "no index" wording; terms-page-only shops (Hi-Time); correct and unarm Tanners, BBR, Slurp; no Slurp product links | Applied (§9); Tanners and BBR re-fetched, Slurp not. The critic read Hi-Time's terms: they are silent, not permissive, and its registry entry has the same robots-as-terms defect (§9, step 0.9) |
| A4 | Retire `price_reference` from the shared projection | Applied (§9) |
| A5 | One fetch module: never-list at fetch and redirect, strict robots, 4xx/5xx disallow, terms verdicts, working contact URL, platform-host terms | Applied (§8) |
| A6 | Snippet-only storage by default; `retention_until` mandatory | Applied (§3, §8); full copies stay a founder option (Q6). [Round 2: answered *"quotes only"*. The uploaded laptop menus are the one exception, and how long they are kept is Q18] |
| A7 | Licence and attribution travel with data; OSM from a planet extract only | Applied (§8) |
| A8 | `rule_inferred` renders as "permitted by rules" | Applied (§8) |
| A9 | View returns value plus provenance, source, issuer, date, cell id, licence; ADR 0145 mapping; inline labels | Applied (§1, §7) |
| A10 | Stories and the sentence bound by ADR 0145 R1 | Applied (§1) |
| A11 | Sourced ABV never writes `abv_percent`; stated needs a named person; house-extracted values scoped to the house | **Partly applied.** Applied to CELLS (§3, §9). Not applied to identity ROWS created from a house menu: they keep ADR 0124/0130's path, because re-scoping them would reopen those ADRs, which this one does not do |
| A12 | G6/G7 fail closed; 7-day withdrawal; `is_simulation` flag | Applied (§2, §5); G6/G7 move into Stage 1 as the pre-publication pilot |
| A13 | Health: buckets, per-field coverage, modelled spend red, disarmed red, dead-man as Stage 0 exit, empty register "no index" | Applied (§6) |
| A14 | Agreement score never shown as a confidence until calibrated | Applied (§1) |
| A15 | Record F5 as narrowing ADR 0020 for descriptive traits only | Applied (§1) |
| A16 | Checker licences and exact checkpoint | Applied (§4 P7). ANLI is CC BY-NC 4.0 (github.com/facebookresearch/anli, fetched); MiniCheck's MIT weights carry that lineage, so commercial use is in Q6 |
| A17 | Record what could not be verified | Applied (Not verified, below) |
| B1 | Disarm the Desktop tasks first; writer identity; foreign writer = red; reaper disarmed until 7 clean days; repair `running`+`completed_at` rows | Applied (§6, Build 0.1–0.3, 0.15). [Round 2: **the founder overrode "disarm first"**: *"Keep until the repo pipeline runs"*. Writer identity, foreign-writer reporting and the disarmed reaper still apply. §15 replaces "disarm first" with containment until cutover, and the disarming moves to step 1.10] |
| B2 | Enqueue trigger on `IS DISTINCT FROM`, never raising, mutation-tested | Applied (§4 P4, Build 0.13). The critic split it into an INSERT trigger and an UPDATE trigger, because the draft's combined `WHEN (OLD…)` cannot be created |
| B3 | Restate rule 1 as a founder fork; `conditioned_on`; legacy identity as low-trust input; T9 repairs before Stage 1; name the rule_inferred loader or drop it | Applied, except the T9 **column** repair: **rejected** because rewriting `grape_variety` re-keys the signature hash while G-F3 is open; the same effect comes from G1/G3 withholding those legacy cells from display and from P8's input (§4 P8) |
| B4 | Real leases with fencing; role-gated crons | Applied (§11) |
| B5 | Two-phase batch submit; spend reservation; fail closed for background; HALT cancels; verify tier and credit before Stage 3 | Applied (§11, Build 1.1) |
| B6 | Sweep backoff by `(model_id, prompt_hash)`; rejected rows separate; $53 becomes $53–180 | Applied (§4 P4, Cost); the range is now computed, $47–160 (Cost) |
| B7 | G4 quarantines rows; batch fingerprint ratio; refit on the enum pilot | Applied (§5) |
| B8 | No gate passes on empty reference data; G3 sources named; TTB AVA dropped; floors from a pre-publication pilot; NULL-cost rule scoped | Applied (§5, §6). The berry-colour source is Wikidata's CC0 items; VIVC states no reuse licence and is a link only |
| B9 | Exact match on normalised triple; G-F3 before Stage 3; `safe_to_merge`; candidate-pending excluded; dial capped by curation; producer required; no model-parsed `primary_type` | Applied (§2, §4 P2–P3); candidate-pending is read from `beverage_identity_candidates`, no new column |
| B10 | Embeddings table keyed by model; legacy vectors retired; index rebuilt | Applied (§4 P12) |
| B11 | Ingest idempotency; publish lease; one-current rule stated | Applied (§3): one current per `(wine, field, provenance)` |
| B12 | Route legacy writers; `is_simulation`; real-house first | Applied (§2, §3) |
| B13 | Laptop-copy admission rule | Applied (§4 P1) |

## Consequences

- **Easier:** every value on a page can answer "where did this come from?"; a bad
  batch is one rollback; the health check and the page read the same projection; the
  second writer is gone; growth adds identities without adding unreviewed facts.
- **Harder:** nothing new shows on a page until Stage 0 is built and each field's pilot
  audit clears its floor, so the "coming soon" line stays longer than an
  infer-and-show plan would allow. The founder becomes the audit and curation
  bottleneck until a second annotator exists. At the proposed floors some descriptive
  fields may only ever publish coarsened. The legacy 3,346 profiles disappear from
  every future surface. [Round 2]
  - **Reviewers.** Review happens in /studio. Three accounts hold roles and no
    sommelier has been invited, so reviewer hours cap growth until sommeliers are
    invited (§13).
  - **Waiting.** A new wine waits for its sourcing batch before any cell shows.
  - **Blank prices.** No wine has a restaurant list price at k = 5, and the estimate
    cannot pass its test until at least 16 wines do (§9). So the restaurant line starts
    blank for almost every wine, and is mostly the estimate after that.
  - **Before any pooling.** A notice, an opt-out and Terms of Service must ship before
    the first real house's menu counts.
  - **Two writers.** Until cutover, two writers run, and health carries a named
    `laptop_writer_armed` state.
- **Given up:** Serper, the scrapers and the rich file's estimates as sources; showing
  legacy profiles; a single "confidence" number per row. [Round 2] Also given up:
  Serper even for URL discovery; any single other house's price; a markup-divided
  "shop" or "wholesale" figure; and Hi-Time's prices as training data.
- **Revisit when:** a field's pilot Wilson bound cannot clear its floor after two
  prompt revisions (lower the floor or coarsen the field); curation backlog exceeds one
  week at the chosen dial (lower the dial or hire); measured cost per sourced wine is
  more than 2× the estimate (take the measured figure to the founder for the monthly
  limit; N stays equal to intake unless he lowers it [verifier, 2026-09-18: the draft
  said "re-scope N", which would let cost undo *"Every wine from day one"*]); the org
  usage tier cap is within 20% at
  month-end; a second tenant outside the US and EU arrives (sources change). [Round 2]
  Also revisit when:
  - six months after the first real house, most stocked wines still sit below k (check
    k and the pooling area);
  - the /studio queue stays past its set depth for a week (invite reviewers or lower
    the dial);
  - a house opts out and its own analytics change (the opt-out has leaked).

## Build order

Each step is small, has a check, and states whether it writes production.

**Stage 0 — no model spend.** Exit: health is red on today's data for the listed
reasons, and the outside alarm fires on a missed run. [Round 2] Also: the notice, the
opt-out and the Terms of Service are live (0.18) before any real house's menu counts
toward class M or training.

- 0.1 **[Round 2, answered 2026-09-18: *"Keep until the repo pipeline runs"*.]** The
  four Desktop tasks stay enabled until cutover (§15). Stage 0 builds the containment
  instead: writer identity (0.2), the view as the only page read (0.6–0.7), the
  publish RPC's hash check (1.7), and the `laptop_writer_armed` health state (0.11).
  *Check:* each of §15's rules 1–6 has a test. A fixture row with no runner is
  reported as `laptop_writer_armed` before cutover, and as red after it. The
  disabling itself moves to step 1.10. The draft's text for this step is kept as the
  record: *Founder disables the four Desktop wine tasks (his keystroke).*
  *Check:*
  `scheduled-tasks.json` shows `enabled: false` for all four, **and each task's
  `lastRunAt` does not advance past the moment it was disabled**. As a secondary
  check, `max(created_at)` of `research_runs`, `evidence_citations`, `source_registry`
  and `restaurant_directory` does not advance for 7 days. The table check alone proves
  nothing: the tasks are enabled and three of them ran on 2026-09-18, yet no row in
  those tables is newer than 2026-09-16 (critic SELECT). A quiet table is not evidence
  that they are off.
- 0.2 Migration: writer identity on `research_runs`, `evidence_citations`,
  `source_registry`. *Check:* local Postgres from migrations; a fixture row with no
  `runner` makes health red.
- 0.3 Migration: `restaurants.is_simulation`; the three Sim houses flagged by a logged
  update on the founder's word. *Check:* `count(*) where is_simulation` = 3. [Round 2:
  flag **eight** rows, not three. Production has four "Sim " rows, two of them named
  Sim Meyhouse (`a229f22b`, `aaecdb17`). Add the four May houses the founder ruled not
  real: YAREN, ALDEMIR, ADMIN 1 and ADMIN ROOM (Context, fact 9). *Check:* the count is
  8, and every house holding a stocked wine is flagged. The six unasked houses stay
  unflagged until he answers Q11.]
- 0.4 Migrations: `wine_field_observations`, `source_documents`, `job_leases`, and the
  extensions in §3. *Check:* `check_new_tables_are_locked_down.py` and the migration
  ledger guard pass; the fresh-database build passes.
- 0.5 Gates G0–G5 and G8 as SQL functions; empty reference → `unchecked`. *Check:* on
  a local database seeded from `quality-gate-testcases.sql` plus the three look-alike
  rows, each gate's expected result holds, and every rule's mutation turns a test red
  (a no-op mutation is a failed test).
- 0.6 `wine_profile_v1` plus the hand-written `WineProfile` type and its static pin.
  *Check:* renaming a view column fails the static test.
- 0.7 `mapWine`, `/wines` and `meta/*` read the view, with a live filter;
  `price_reference` leaves the shared projection. *Check:* claims
  `WINE-ML-WINES-READ-HAS-NO-LIVE-FILTER` and `WINE-ML-MAPWINE-SENDS-NO-PROFILE` flip;
  a static guard fails a new direct read of profile columns.
- 0.8 The fetch module (§8) replaces the three robots readers. *Check:* unit tests for
  a 202 empty WAF answer, 403, 429, 5xx, TLS error and a redirect onto the never-list,
  each disallowed.
- 0.9 Correct the Tanners, BBR and Slurp entries in `price-reference-shops.ts` and
  unarm them as `terms_forbid`. Correct Hi-Time's entry (`:318`) from "robots.txt only."
  to a `silent` verdict with the terms URL and fetch date, and leave it armed only on the
  founder's Q12 answer. *Check:* a registry test fails if an armed shop has terms
  `unread` or `forbids`, or has `silent` without a recorded founder answer. [Round 2:
  Q12 is answered (*"Use Hi-Time, ask the rest"*), so Hi-Time is armed with that
  answer recorded beside its entry. The letters to Tanners, BBR and Slurp are drafted
  for the founder to send. A static test fails if any class-D price reaches the
  estimate model's inputs.]
- 0.10 `source_registry` fixes: `ttbonline.gov` tier A, the eAmbrosia host, the
  vivino.com and wine-searcher.com rows removed (production write, founder's word).
  *Check:* SELECT.
- 0.11 `wine_pipeline_health()` (§6). *Check:* red on today's data with the expected
  reasons; each red rule mutation-tested.
- 0.12 Outside dead-man alarm: verify whether the gateway reports to Sentry; if not,
  a `pg_cron` witness on the founder's word. *Check:* a deliberately skipped tick
  alarms.
- 0.13 P4 triggers and the reconciling sweep, disarmed. *Check:* the migration applies
  on the fresh-database build; inserting an eligible fixture row enqueues exactly one row;
  updating `primary_type` or `menu_category` so that `beverage_kind` changes enqueues
  exactly one row; a rejected row is not re-enqueued before its backoff; each trigger's
  mutation (dropping it, or dropping one WHEN term) turns a test red.
- 0.14 Measure whether the menu section is recoverable for the 29 non-provisional
  unclassified stubs. *Check:* a count recorded in this ADR's review trail.
- 0.15 Reaper for `research_runs` (repairs `running` with `completed_at`; closes stale
  runs), disarmed until 7 days with 0 foreign rows; closing today's 4 rows is a
  production write on the founder's word. *Check:* foundations F-A `runs_running` = 0.
- 0.16 Static CLAIMS rows: no model literal in any loader; `fn_uncited_fields`
  references `proposed_value`; a `primary_type` CHECK exists; wine crons read
  `WINE_PIPELINE_ROLE`. *Check:* `check_decision_claims.sh` holds each as `open`
  before its fix and each was mutated once.
- 0.17 [Round 2] **Re-point /studio (§13).**
  - `/studio/queue` reads and writes observations.
  - Approve goes through the publish RPC, and the three direct library inserts are
    removed.
  - `override_events` is re-keyed to observations with a verdict.
  - Invites work for a person with no account.
  - `/api/v1/quality/*` gets a gateway proxy or is retired.
  - The two docs are corrected, and the defects are filed in `v3.0-TECH-DEBT.md`.

  *Checks:*
  - an approve on a fixture cell makes exactly one current observation, and a
    library insert is impossible from Studio (a static guard);
  - an invite redeems for a new email;
  - a verdict with no source checked is not counted as gold;
  - each rule's mutation turns a test red.
- 0.18 [Round 2] **The notice, the opt-out and the Terms of Service (§14).**
  - The `shared-library` settings section is added, backed by `house_data_sharing`
    and `notice_acknowledgements`.
  - `ServicesPermissions.tsx:88` and /privacy are amended.
  - A lawyer-drafted clickwrap is linked from `/register` (the founder, with a
    lawyer).

  *Checks:*
  - a non-owner cannot change the setting;
  - the setup assistant cannot propose it;
  - a house with no acknowledgement row contributes nothing;
  - the page copy test fails if the old analytics promise returns.
- 0.19 [Round 2] **Class M (§9).**
  - `menu_price_sightings`, and `menu_list_price()` enforcing k, the 25% cap, one
    price per group, currency, area, the 18-month window and the outlier trim.
  - Its read of `house_data_sharing` throws on failure.

  *Checks* (on a local database):
  - 4 groups return "fewer than 5";
  - 5 groups return a median and no contributor id;
  - removing an opted-out house's rows changes the result;
  - a failed opt-out read throws;
  - each mutation turns a test red.
- 0.20 [Round 2] **The extraction prompt and the PDFs.**
  - The P1 prompt gains format, volume, pour, currency, section and list date.
  - The 41 laptop menu PDFs, and the 26 corpus PDFs if Q18 says so, are uploaded to
    private storage with `retention_until` set.

  *Checks:*
  - a fixture half-bottle line yields `volume_ml = 375`;
  - each uploaded file's sha256 equals its `crawl_log.content_hash`, or the file is
    refused.

**Stage 1 — sourcing and inference, gated.** Exit: at least one descriptive field
published on real data with a measured Wilson bound above its floor. [Round 2] The exit
also needs two things: every new wine that night has a sourcing attempt, and cutover
(§15) has happened. The stage was named "inference, gated". Sourcing moved in, because
every wine is sourced from the first paid night (Q1).

- 1.1 Founder creates the workspace, key and spend limit; the org usage tier and
  credit balance are verified. *Check:* recorded here.
- 1.2 `ModelClient`: batch transport, Opus 5 price, batch discount, search fee,
  two-phase submit, reservation pre-flight, HALT. *Check:* unit tests; a fixture spend
  429 halts and cancels; boot reconciliation ingests an orphan by prefix.
- 1.3 Role-gated crons and fenced leases. *Check:* a local boot without the flag
  registers zero wine crons.
- 1.4 P2 on the unclassified stubs. *Check:* each is classified from a stated section
  or reported in the bucket.
- 1.5 P8 pilot on 200 stratified eligible wines. *Check:* measured cost per wine and
  fingerprint ratio replace the estimates below, in a dated amendment. [Round 2: the
  pilot runs P5–P7 and then P8 on the same 200 wines. It also measures the share of
  wines with a findable source.]
- 1.6 Pre-publication pilot audit by the founder: two-stage cluster sample, about 60
  cells per field (about 70 wines). *Check:* `field_calibration` rows per
  `(field, provenance, model_id, prompt_hash)`. [Round 2: the audit is done in /studio
  by the reviewer roles (§13), and the founder may be one of them. 1 verdict in 10 is
  double-reviewed. The floors are 0.95, 0.90 and 0.80 (§5).]
- 1.7 Publish RPC and rollback; G4 quarantine; real-house wines reviewed first.
  *Check:* a rolled-back batch leaves no current cell. [Round 2: the RPC also carries
  the identity-hash check (§4 P9). *Check:* a fixture row whose producer changes
  between staging and publication sends its cell to `review`.]
- 1.8 Re-infer the eligible rows, about 500 a night, under the cap. *Check:* health's
  per-field coverage rises; no spend alarm. [Round 2: these rows are sourced and then
  re-inferred, about 7 nights for 3,314.] [Verifier, 2026-09-18: 1.8 starts on the
  first paid night together with 1.5, not after 1.6. Its cells stay staged until 1.6
  clears each field. If the pilot changes a prompt, the cells that prompt produced are
  re-run, at most $47–160 for P8 and $268–582 for P5–P7 (Cost). That re-run is the
  price of sourcing from day one. It is stated here and is not a reason to wait.]
- 1.9 Growth from house paper the same day. Public-list intake only if Q7 is answered
  yes: 4 backlog lists a night from list URLs whose platform terms were read. *Check:*
  every crawled list yields sightings or a reason code. [Round 2: Q7 is answered yes.
  The 41 uploaded laptop menus go first, and each list opens a /studio session (§13).]
- 1.10 [Round 2] **Cutover** (§15). The founder disables the four Desktop tasks on the
  first night that meets §15's definition. *Check:* the draft's step 0.1 check,
  unchanged. Then the reaper (0.15) arms after 7 days with 0 foreign rows.
- 1.11 [Round 2] The `wine-worker` Railway cron (§11), moved from Stage 2. *Check:*
  its `cronSchedule` and its first ledger rows, never its code.

**Stage 2 — sourcing.** P5–P7 on real-house stocked wines first, then N a day; the
`wine-worker` cron; G6 canary and G7 7-day audit; F3 (§10); the Candiago loader and
G3 coverage; P11 and the 105 `file://` citations. *Check:* sourced cells carry
corroboration ≥2 domains or one tier-A source and a value-bound citation.

[Round 2: P5–P7, the `wine-worker` cron and the G6 and G7 audits moved to Stage 1 (Q1).
Stage 2 keeps the rest:

- F3 (§10);
- the Candiago loader and G3 coverage;
- P11 and the 105 `file://` citations;
- the estimated value price model (§9) and its held-out coverage test;
- the first sommeliers invited, once Q14 decides how they are paid.

*Check:* the sourced-cell check above, and the estimate's coverage bound ≥ 0.80.]

**Stage 3 — scale.** 10 lists a night once discovery (house markets, Wikidata P856,
OSM planet extract) exists, G-F3 (the moving hash) is resolved, and measured curation
throughput covers about 40–55 decisions a day; keys (LWIN file, Wikidata, TTB COLA);
F4 line 2 weekly; embeddings (P12); conformal thresholds, drift, PPI intervals. The dial
rises only after Stage 1 and 2 measurements have replaced every estimate. [Round 2:
"F4 line 2" is now §9's line 3, the Hi-Time listing. "Curation throughput" means
measured /studio reviewer throughput (§13).]

## Cost (estimates; no paid call was made)

[Recomputed by the critic, 2026-09-18. The draft stated the figures without any
arithmetic, and no file held one. The model is
`scratchpad/wine-pipeline/critic-cost-model.py`; its inputs are listed here so the
figures can be re-derived without it.]

**Prices** (platform.claude.com/docs/en/about-claude/pricing, re-fetched 2026-09-18),
batch per MTok in/out: Opus 5 $2.50/$12.50, Sonnet 5 $1/$5, Haiku 4.5 $0.50/$2.50
(standard is double); cache reads 0.1× input, stacking with batch; web search $10 per
1,000, not discounted; Fable 5.1 $5/$25 (P6 A/B only, not in the totals).

**Token assumptions (estimates, to be replaced by step 1.5's measurement):**

| Unit | Low | High | Cost each |
|---|---|---|---|
| P8 sample | 1,500 in (1,000 cached), 500 out | 3,000 in, 1,500 out | — |
| P8, non-stocked wine: 1 Opus 5 + 2 Sonnet 5 | | | $0.014–0.047 |
| P8, stocked wine: 5 samples, assumed 2 Opus 5 + 3 Sonnet 5 | | | $0.025–0.084 |
| P1 list, Opus 5: 11.7 pages × 3,000 in / 900 out (growth lane) | | | $0.22 (Haiku 4.5 $0.04) |
| P5–P7 sourced wine | 1 search, 8k result tokens; P6 7k/1.5k; normalise 2k/400; judge 4k/800 | 3 searches, 25k; P6 14k/3k; 4k/800; judge 7k/1.5k | $0.08–0.18 |

**Totals:**

- One-time re-inference of the 3,314 eligible rows (95 at 5 samples): **$47–160**.
- Sourcing the 95 eligible stocked wines once: $8–17. Sourcing all 3,314 once: $268–582.
- Stage 1 night (500 re-inferred, plus 4 lists of 100–125 new wines each): $13–48.
- Stage 3 growth plus inference (10 lists, 1,000–1,250 new wines a day): $16–61 a day.
- With sourcing: N = 100 costs $24–79 a day, $0.73k–2.36k a month. **N = 1,000, about
  equal to intake (the F1-faithful setting, Q1), costs $97–237 a day, $2.9k–7.1k a
  month.**

Not included: Railway compute for `wine-worker` and the self-hosted checkers
(unmeasured), the founder's audit hours, and the cost of wines for which no source is
found (P5 only, about $0.02–0.06 each).

**Round 2: "every wine from day one"** (`scratchpad/adr0163-r2/every-wine-cost.py`).
It uses the critic's unit costs unchanged; only the volumes change. One wine, sourced
and then inferred, costs $0.095–0.223.

- **Stage 1, steady.** 4 lists, 400–500 new wines a night, every one sourced:
  **$39–112 a day, $1.2k–3.4k a month**. This replaces the $13–48 night, which sourced
  nothing.
- **The backlog.** The 3,314 eligible rows sourced and re-inferred once cost $315–742.
  That is the two one-time lines above added together. At 500 a night it takes about 7
  nights, so Stage 1's first week costs **$86–224 a night**.
- **Stage 3.** 10 lists, 1,000–1,250 new wines a day, all sourced: **$97–281 a day,
  $2.9k–8.4k a month**. The critic's $97–237 held N at 1,000 while intake reached
  1,250.
- **Reading menus.** 67 menus read once (41 laptop, 26 corpus re-read) cost about $15.
  If the 41 laptop menus each add 100–125 new wines with no overlap (overlap is
  unmeasured), sourcing and inferring them costs up to $388–1,143, once.
- **No model spend.** Class M, the notice and /studio add none. Reviewers' time and any
  pay for sommeliers are not in these figures.
- **The spend limit.** The monthly limit is still the founder's keystroke (Q1). Below
  these figures, the cap decides which wines wait, in §2's priority order.

## Open founder questions

[Round 2, 2026-09-18: each question keeps its original text as the record. The bracket
at its head says whether it was answered and where the answer now lives in the
Decision. What is still open, including the new Q13–Q18, is listed at the end under
"Still open after round 2".]

- **Q1 Spend.** **[ANSWERED in part: *"Every wine from day one"*: N equals intake
  (§4 sourcing order; Cost, round 2). The monthly limit itself is still his keystroke.]** The fork: a monthly limit on a dedicated workspace (his keystroke),
  which sets two dials: lists read a night (4 from the backlog, then 10) and wines
  sourced a day (N). Cost: above. Under F1, spend should not be what caps quality. N =
  100 ($0.73k–2.36k a month) leaves 90% of new wines without a sourced cell for good. N
  about equal to intake (about 1,000; $2.9k–7.1k a month) gives every new wine a
  sourcing attempt. Recommendation [critic-revised]: N = 100 during the pilot, only to
  measure cost per wine and the share of wines that have a findable source. Then raise
  N to intake if the sourced floor (Q3) holds, unless he sets a lower monthly limit.
  Real-house stocked wines first. 4 lists a night until curation throughput is
  measured.
- **Q2 Publication.** **[NOT ANSWERED in the form asked. The answer given against the
  publish rule (quote P) is about sources and market price. It adds a developer's
  approval of each menu before its listing facts count (§13), but it does not choose (a)
  or (b) for inferred cells. (b) stays the proposal.]** Paths: (a) every inferred cell audited before it shows; (b) a
  field publishes only after its pre-publication pilot clears its floor, then
  publish-then-audit with automatic withdrawal at 7 days, real-house wines always
  reviewed first. (a) puts daily growth behind one reviewer. Recommendation: (b).
- **Q3 Floors.** **[ANSWERED: *"0.95 / 0.90 / 0.80"* (§5).]** Proposed Wilson lower bounds: sourced 0.95, recalled 0.90, inferred
  0.80. Frontier models reach about 0.63 on wine feature completion, so at 0.80
  several fields may publish only coarsened or not at all. Higher floors mean more
  blank sections. Recommendation: keep 0.80 and let coarsening do the work; review
  after the pilot.
- **Q4 Review capacity.** **[ANSWERED by design (quote R): developers approve each
  menu's extraction, and paid sommeliers approve and add, in /studio (§13). The premise
  "He is the only annotator" no longer holds in the design. In fact three accounts hold
  roles [verifier: the draft said two people] and no sommelier is invited, so capacity
  stays measured (§13). How sommeliers are paid is Q14.]** He is the only annotator. The pilot needs about 60 checked
  cells per field; candidates need a person each (about 40–55 a day at Stage 3). How
  many hours a week, and a second annotator? Without one, inter-annotator agreement
  cannot be measured. Intake pauses when the review queue passes a set depth.
- **Q5 Sourcing order.** **[ANSWERED by Q1's answer: every wine is sourced, then
  inferred (§4). The 'infer first' rule assumed N was below intake.]** The restated rule: real-house stocked wines source before
  inference; everything else infers first and re-infers when a source lands.
  Recommendation: accept. Under the alternative, each new wine stays blank until its
  sourcing pass runs, and with N below intake that is 900 or more wines a day.
- **Q6 Stored copies and checker licences.** **[ANSWERED in part: *"Crawl; quotes
  only; upload"*. Snippet-only storage (a); the 41 laptop PDFs are uploaded (§4 P1, §8).
  Still open: the MiniCheck licence, and how long the uploads are kept (Q18).]** (a) Snippet-only storage (the default
  here: less copyright and TDM exposure, but a changed page loses the audit trail) or
  (b) full private copies with a retention limit where a licence allows. May the 41
  laptop-only menu PDFs be uploaded to project storage? May MiniCheck (MIT weights,
  CC BY-NC ANLI training data) be used commercially, or is the multilingual MIT
  checker used for English too? Recommendation: (a); upload only after (a)/(b) is
  settled; use mDeBERTa for all languages until the MiniCheck lineage is cleared.
- **Q7 Discovery and data sources.** **[ANSWERED: crawl under §8 (*"Crawl; quotes
  only; upload"*), and no Serper even for URLs (*"No"*). Still open, and minor: Open
  Food Facts and OSM attributes as data (recommend skip), and buying the Wine-Searcher
  trade API or the LWIN API (after the pilot).]** F2 already directs daily growth from public wine
  lists "like the beginning". What remains his is the legal risk: does he accept that
  growth under §8's conditions (RFC-strict robots, identifying User-Agent, platform
  terms read, never OpenTable)? Recommendation: yes. Also: Serper even only to find
  URLs (recommend no); Open Food Facts records, and OSM attributes, stored as data in
  isolated tables (recommend skip). This does not cover the OSM planet extract used
  only to discover list URLs, which §8 and Stage 3 already plan. Buy the Wine-Searcher
  trade API or the LWIN integration API (decide after the pilot)?
- **Q8 Legacy profiles.** **[ANSWERED: *"Stop showing, redo them"* (§7, §10).]** Confirm that the 3,346 legacy profiles retire from display
  and are re-derived for $47–160 (Cost), rather than shown labelled "legacy". Nothing is
  deleted; nothing shown today is lost.
- **Q9 Two amendments to locked ADRs.** **[ANSWERED: *"Confirm that boundary"*.
  The relay says this amends ADR 0020 and ADR 0130 as proposed (§1, §2). Both take
  effect when this ADR locks. Neither ADR's file is edited here.]** (a) ADR 0020 narrowed for descriptive traits
  (§1); (b) ADR 0130's specificity formula gains a stated-producer and generic-name
  test for shared inference (§2; ≤13 rows today). Recommendation: accept both.
- **Q10 Canonical `primary_type`.** **[Still open.]** One enum (red, white, rosé, orange, sparkling,
  fortified, dessert) or three axes (colour × effervescence × sweetness)? G1's CHECK
  and the analytics slice key wait on it. Recommendation: three axes as cells, with the
  one-enum slice derived from them.
- **Q11 Production changes on his word.** **[ANSWERED in part: none of the four May
  houses is real (step 0.3 flags eight rows). Still open: the six unasked houses; closing
  the 4 stuck rows, which now waits for cutover (§15); the two registry rows; and
  `pg_cron`.]** Close the 4 stuck `research_runs` rows;
  remove the vivino.com and wine-searcher.com registry rows; flag the three Sim houses;
  optionally install `pg_cron` as the independent witness. **And say which of the four
  May houses are real** [critic, 2026-09-18]: YAREN (created 2026-05-09, 1 stocked
  wine), ALDEMIR (05-10, 1), ADMIN 1 (05-12, 2) and ADMIN ROOM (05-12, 10) (production
  SELECT). With `is_simulation` defaulting to false, all four count as real houses, so
  their wines would be sourced first and reviewed before publication (§2, G7).
- **Q12 Public listings.** **[ANSWERED: *"Use Hi-Time, ask the rest"* (§9, step
  0.9).]** Accept "Hi-Time only" for the public line today, although
  its terms are silent rather than permissive (§9), and ask Tanners, BBR and Slurp for
  written permission? Recommendation: yes to both. Asking Hi-Time for a written yes as
  well removes the silence. The line reads "no public listing yet" elsewhere.

### Still open after round 2

Each question gives the fork, the paths, what each costs, and a recommendation.

- **Q1 (remainder) (a) The monthly limit, and (b) the backlog pace.** Every wine sourced costs $1.2k–3.4k a month at
  Stage 1 and $2.9k–8.4k at Stage 3 (Cost, round 2). The backlog week costs $86–224 a
  night.
  - **If the limit is lower,** the cap decides which wines wait, in §2's order.
  - **Recommendation:** a limit at or above the stage's high figure, reviewed after
    the pilot measures the real cost per wine.
  - **(b) The backlog pace** [verifier, 2026-09-18]. His answer sets N for new wines.
    It does not set how fast the 3,314 already in the library are sourced.
    - **500 a night, about 7 nights.** This is the draft's re-inference pace, and the
      cap is its only stated reason. Each night costs $86–224, including the steady
      night.
    - **All 3,314 on the first paid night.** This costs $315–742 once, plus that
      night's $39–112, and the batch returns within 24 h.
    - **What binds besides money** is the /studio queue. Every source disagreement goes
      to `review` (§4 P7), and intake pauses at the queue's set depth (§13), so a
      one-night backlog can fill the queue at once.
    - **Recommendation:** submit the whole backlog on the first paid night, with its
      cells staged, and let the queue's depth, not a nightly count, pace what reaches
      reviewers. That is the reading closest to "from day one".
- **Q2 Publication path for inferred cells.** The paths are unchanged:
  - (a) every inferred cell is reviewed before it shows;
  - (b) a field's pilot clears its floor, then cells publish first and are audited
    within 7 days, with automatic withdrawal.

  **Recommendation:** (b). Every menu's listing facts are still approved by a developer
  first (§13). [Verifier, 2026-09-18: quote P's *"We're gonna check their values"* is
  read here as the menus' values. If "their values" means the library's values, it
  points to (a). He should be asked which he meant rather than have (b) assumed.]
- **Q6 (remainder) The checker licence.** MiniCheck's weights are MIT, but its ANLI
  training data is CC BY-NC.
  - **The choice:** use it commercially, or use the multilingual MIT checker for
    English too.
  - **Recommendation:** mDeBERTa for every language until the lineage is cleared.
- **Q10 Canonical `primary_type`.** The choice is one enum, or three axes.
  **Recommendation:** three axes as cells, with the one-enum slice derived from them.
- **Q11 (remainder) The rest of the houses.**
  - **The six unasked houses.** Are any of Gullit's Tavern, Yaren's Fine Dine,
    Meyhouse Palo Alto, YARDOM, Chez Community or The Old House Pub real? Unflagged,
    each counts as real the day it uploads a menu. Flagging a real house by mistake
    would skip its review.
  - **Recommendation:** answer house by house, and flag none that he does not name.
  - **Also still his:** closing the 4 stuck rows (after cutover), the vivino.com and
    wine-searcher.com registry rows, and `pg_cron`.
- **Q13 What a sommelier may add** (§1).
  - (a) Own-voice notes are `stated` and signed, and third-party facts need a citation
    and P6–P7.
  - (b) A new provenance class, "attested by a named expert", under which an uncited
    score or ABV may publish.

  (b) lets one person's memory publish an attributive fact, which the confirmed
  boundary forbids. **Recommendation:** (a).
- **Q14 Sommelier pay.** In quote R, "who will be paying" could mean sommeliers are
  paid, or that they pay. We read it as paid.
  - **The fork:** which way the money goes, and in what form: cash, discounts or
    points (the April idea).
  - **The cost of cash.** Any cash payout needs the Stripe `transfers`/`payouts` guard
    lifted and OD-23 (pricing) decided.
  - **Recommendation:** confirm the direction first. Then start with non-cash credit
    until OD-23 is decided.
- **Q15 Instant and automatic promotion.** Phase 13 lets developers promote instantly
  (D-13), and contributors auto-promote after 5 approvals (D-12).
  - **Keep them,** and one unchecked reviewer can publish.
  - **Drop them,** and every approval waits for a second person.
  - **Recommendation:** keep both, but only while the 1-in-10 double review measures
    the reviewer's agreement at or above the field's floor (§5). A reviewer below it
    loses instant or automatic promotion until they recover. Nothing they approve
    counts as gold unless it carries an explicit verdict, and auto-promoted
    contributors stay inside G7's sample (§5, §13). [Verifier, 2026-09-18: the draft
    recommended keeping both "for speed". Under F1 (*"highest quality"*), speed alone
    cannot justify one unchecked person publishing, so keeping them is now tied to a
    measured bar.]
- **Q16 The market price** (§9).
  - (a) **k:** 5 restaurant groups (0 wines qualify today) or 3 (9 wines). Lower k
    shows more numbers and gives weaker protection for each house.
  - (b) **The recency window:** 18 months.
  - (c) **Line order:** restaurants, then houses, then the shop. F4 put the house
    index first.
  - (d) **The estimated value price carve-out** from "prices are never inferred" (§1).
    His words ask for it.
  - (e) **Class M** as a new row in locked ADR 0117's table.
  - (f) **How the spread is shown** [verifier, 2026-09-18]. A min–max spread shows
    two houses' exact printed prices, and a median over an odd count is one house's
    price. A rounded or interquartile range names no one but can still equal a price.
  - (g) **The estimate's test** [verifier]. Hold out wines that have a restaurant list
    price, which needs at least 16 and today has 0 at k = 5 (§9). Or hold out single
    sightings, which allows an earlier but weaker test.

  **Recommendation:** accept (a) at 5, (b), (c), (d) and (e). For (f), a rounded
  range, with the notice saying a figure may equal one listed price (§14). For (g),
  wines with a list price, because a single sighting checks the estimate against one
  restaurant's pricing rather than against what restaurants charge; so the estimate
  waits.
- **Q17 The notice, in law** (§14). A lawyer must answer these before the first real
  house's prices pool:
  - (a) opt-out everywhere, or opt-in for EU houses until the Data Act Art. 13
    unfair-terms question is cleared;
  - (b) what opting out removes: the house's prices from the next recompute and from
    future training, with trained models not retrained;
  - (c) owner-only control;
  - (d) whether an opted-out house's new wines stay its own;
  - (e) a lawyer-drafted clickwrap Terms of Service at /register;
  - (f) Türkiye (KVKK notice and transfers abroad), and whether Law 4250 art. 6 reaches
    a signed-out price page (§9);
  - (g) whether prices already held from public menus of restaurants that are not
    customers (the 26 corpus menus, and the 41 laptop menus once uploaded) may be
    pooled and used for training on the strength of being public (§14) [verifier,
    2026-09-18].

  **Recommendation:** (a) opt-out for US and Turkish houses, opt-in for EU houses until
  cleared; (b), (c) and (d) as written; (e) before any pooling. [Verifier: (a)'s EU
  half departs from his answer, *"A notice with an opt-out"*, so it needs his word, not
  only the lawyer's. (g) should be answered before the first public-menu price counts
  toward class M.]
- **Q18 The uploaded menu PDFs.** "Quotes only" and "upload" pull in two directions.
  - (a) Keep the uploaded PDFs with a `retention_until` (for example, 90 days after
    /studio approves the menu), then keep only the quote, the hash and the date.
  - (b) Keep them for good.

  Also: may the 26 corpus PDFs be uploaded too? Their prices cannot be re-read for
  format without them. **Recommendation:** (a), and yes to the 26.

## Not verified (named per CLAUDE.md §0.5)

- The founder's quotes were relayed by the orchestrating workflow; F5 is a paraphrase.
- The citations-plus-structured-outputs incompatibility and the SommBench and
  OenoBench figures come from the lanes, not re-fetched here. [Model prices were
  re-fetched by the critic on 2026-09-18 and match the lanes' figures (Cost).]
- The token counts behind every cost are assumptions (Cost table). Lane-only figures
  that no retained file reproduces: the 157-profile and 421-row template counts (the
  critic's re-measure is in brackets in Context), `safe_to_merge` 19 of 54, the G4
  fingerprint ratios 0.749 and 0.096, the 21 orchestrator redeploys, and the 1,285,
  1,288 and 1,486 template-group counts.
- Slurp's terms, BinWise/BlueCart terms (a 404), Canva's policy (403) and the terms of
  the other ~20 crawl-log hosts were not read. UK CDPA s29A and EU DSM Art. 4 are from
  memory. The etalab attribution clause is from a search summary.
- [Resolved by the critic: the CREATE TRIGGER page, fetched 2026-09-18, states both
  the BEFORE-trigger rule and that an INSERT trigger cannot refer to OLD (§4 P4). The
  split triggers were not executed against a database.]
- Hi-Time's terms were read by the critic (silent, §9); the other hosts' were not.
- The accuracy of MiniCheck and mDeBERTa on wine claims, the accuracy of the legacy
  identity columns, and whether Wikidata grape items carry a usable berry-colour
  statement are unmeasured.
- Whether the gateway reports to Sentry, the org usage tier, and the credit balance
  are unknown. No `.env` was read.
- Every cost is an estimate. The adversarial passes were run by separate agents; the
  judge's own adversarial check was not.
- [Round 2]
  - **The founder's answers.** They were relayed, and the two long ones are
    speech-to-text. Every reading is ours. Two are the relay's own: the ADR 0130 half of
    Q9 comes from the relay's parenthesis, and the gloss "Solias [sommeliers]" is the
    relay's.
  - **Studio.** No authenticated call to Studio was made. The promote failures are
    inferred from the code and production's columns; only the lane's SELECT `42703`
    was reproduced. The `/api/v1/quality/*` 404 is the lane's.
  - **Menu coverage.** The counts match wines on an exact normalised key, and the
    restaurant group is the first word of a file name. Fuzzy matching would raise the
    multi-menu counts somewhat. How far the 41 laptop menus overlap the 26 is
    unmeasured, and most menus have no known date.
  - **Legal points.** The competition-law and privacy points (RealPage, the 2023
    withdrawals, Data Act Art. 13, KVKK, Law 4250) come from the lane, and some are from
    memory. None was re-fetched here, and none is legal advice.
  - **Markup evidence.** The Dearden et al. figures were read from the paper by the
    lane. The Wine Spectator and Provi markup figures came from a fetch summary and
    are not relied on above.
  - **Hi-Time's terms** were not fetched again in round 2.
  - **Not built or tested.** The §15 containment rules and the class-M function
    exist only as design. Nothing was built or run.
  - **Verifier pass.** It fetched no URL: Hi-Time's, Tanners' and BBR's terms, the
    markup paper and every legal point stand as the lanes and the critic left them.
    The Studio column mismatch was confirmed from `information_schema`, not by running
    the SELECT. The 16-wine minimum assumes z = 1.96, the z that §5's 38-of-60 example
    uses. Q1 (b)'s recommendation and Q15's measured bar are the verifier's own.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-18 | Research workflow: six lanes, three candidates, judge, two adversarial passes | Created as Proposed. Of the 30 required changes, 28 are applied in full; B3's column repair is rejected with its reason; A11's re-scoping of identity rows is left out, with its reason |
| 2026-09-18 | Completeness critic (workflow agent) | 14 fixes, each marked "critic" in the text. (1) P4's combined INSERT-or-UPDATE trigger could not be created, and is now two triggers. (2) Costs are recomputed with their inputs, the N = intake line is added, and Q1/Q5 no longer cap quality by spend (F1). (3) P1 extraction defaults to Opus 5 (F1). (4) Hi-Time's terms were read: silent, not permissive; step 0.9 now covers it. (5) Health gains all-eligible coverage, a zero-yield run rule and a trigger-miss rule (F2). (6) The view never shows legacy profile fields. (7) The laptop-copy admission rule now checks terms. (8) Step 0.1's check no longer relies on quiet tables. (9) "Writing every night" was corrected against production. (10) Line citations shifted by the foundations edits, `.gitignore:87`→`:92` and `0130:108`→`:109`, were fixed. (11) Q7 was reframed as the legal remainder of F2, and its OSM contradiction removed. (12) Q11 now asks which of the four May houses are real. (13) The P7 same-family judge is no longer counted as independent. (14) A11 is marked partial |
| 2026-09-18 | Round 2: the founder's answers (three AskUserQuestion batches) plus two research lanes (/studio; menu prices and the notice) | Still Proposed. Answers recorded as relayed, with readings marked. Q1, Q3, Q4, Q5, Q7, Q8, Q9 and Q12 are now decision text; Q6 and Q11 in part; Q2 was not answered in the form asked. §9 rewritten around menu prices (class M); §13 /studio review, §14 notice and opt-out, §15 two writers until cutover added; sourcing and `wine-worker` moved into Stage 1; costs recomputed for every wine sourced; step 0.3's count corrected from 3 to 8 (four "Sim " rows, not three); steps 0.17–0.20, 1.10 and 1.11 added; Q13–Q18 raised |
| 2026-09-18 | Round-2 verifier (workflow agent): the diff against 795e8073a; quotes compared by script; every /studio, loader, parser, settings, Stripe and registry citation re-read; production SELECTs on `restaurants`, `restaurant_inventory`, `user_roles`, `users`, `invite_tokens`, `override_events`, the submissions table, the price and menu tables, and `data_enrichment->'menus'`; both cost scripts re-run | Answers verbatim (P and R match the relay character for character) and readings marked. Fixed, each marked "verifier" in the text: (1) three role-holding accounts, not two people (fact 6, §13, Consequences, Q4); (2) live-row `review_status` added; (3) the 7-menu rows are not live; (4) "by file name" city claim; (5) fact 8's heading over-read a usage-telemetry line; (6) the notice promised that a house's prices never appear, which a median breaks (§9, §14, Q16 (f)); (7) "nothing already held needs consent" was a legal conclusion (§14, Q17 (g)); (8) "required by Law 4250" was a legal conclusion (§9, Q17 (f)); (9) the estimate cannot pass its held-out test until at least 16 wines have a list price, and today none has at k = 5 (§5, §9, Consequences, Q16 (g)); (10) the estimate's label now says restaurant listings, so it cannot read as a shop price; (11) "re-scope N" on a cost overrun would have let cost undo *"Every wine from day one"* (Consequences); (12) the backlog now starts on the first paid night, staged, instead of after the audit, and its pace is Q1 (b); (13) Q15's "for speed" recommendation is tied to a measured bar under F1; (14) Q2 names the reading of "check their values" that would point to (a); (15) §15 rule 7's "another org" was unbacked; (16) §13's promotion rule marked as open (Q15); (17) the ROADMAP citation for "sommeliers/producers" added. Costs re-derived: every round-2 figure reproduces from `every-wine-cost.py` and `critic-cost-model.py` |

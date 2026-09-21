# 0163 — The wine library is a ledger of cited or labelled statements

- **Status:** Proposed 2026-09-18. The founder locks it. Its index row in
  `README.md` follows separately (that file is gate-owned and was not edited here).
  **Amended the same day (round 2)** with his answers to this ADR's own questions
  (Context, "Round 2"). It is still Proposed: the answers shape the text, and he
  locks the whole. **Amended again the same evening (round 3)** with four more answers:
  model work runs as Claude Cowork scheduled tasks on his plan credits, every publish
  is sampled, estimates show after the automatic checks, and sommeliers are paid or
  rewarded (Context, "Round 3"; §11 rewritten). Still Proposed.
  **Amended 2026-09-19 (round 4)** with a research pass deepening ten still-open
  questions (Q6, Q10, Q11, Q14, Q15, Q16, Q17, Q18, Q20, and step 0.17's tech-debt
  wording; Review trail) — no founder answer in this round, options and
  recommendations only. **Amended again 2026-09-19 (round 5)** with his twelve
  answers to the remaining open questions (Context, "Round 5"), each question's
  block marked decided: he reversed the claim-checker pick to TypeSafe AI's Jev, a
  hosted API, in place of the self-hosted MiniCheck/mDeBERTa design (§4 P7 rewritten,
  history kept at `a99078485`); he took *"Ship now, fix later"* on the pre-pooling
  legal review, against this ADR's own recommendation, with the shown-and-accepted
  consequence that trained models are not retrained (§9, §14); and he confirmed
  market price k=5, the wine-type axes, the Wilson reviewer floor, menu-PDF
  retention, sommelier pay and additions, the EU opt-in, the six-house grouping and
  the Max 20x seat. Still Proposed: Jev's language coverage for Italian and Turkish
  is unmeasured (new open item, §4 P7; Q6); the reward's *rate* stays parked on
  OD-23 and its *structure* — points per verdict, a flat stipend or a per-hour
  rate — was never chosen (§13; Q14, DECIDED bracket); Q11's stuck
  `research_runs` rows, the two registry rows and `pg_cron` were not part of this
  round's question and are still his to close (§2; Q11 (remainder)); whether Jev
  belongs in the §14 notice, and whether a non-lawyer Terms of Service still gates
  pooling under *"Ship now, fix later,"* are each noted but not asked (§14); Q22
  has never been put to him at all (§11); and ADR 0165's tech-debt-register
  retirement is reserved but unwritten.
- **Date:** 2026-09-18
- **Decider:** Aldemir (founder). The design was drafted by a research workflow
  (six evidence lanes, three candidate designs, one judge, two adversarial passes;
  round 2 added two research lanes, on /studio and on menu prices and the notice;
  round 3 added one, on Cowork, routines, usage limits and the laptop tasks' run
  history; round 4 added a research pass re-testing ten open questions; round 5
  recorded his answers to all twelve, closing most of this ADR's open founder
  questions — several stay open regardless, some because his own answers opened
  them (Status, above, and Context, "What this settles", below, name them));
  none of it binds until he locks it.
- **Keywords:** wine library, master_wine_library, enrichment, provenance, cell,
  evidence, citation, inference, growth, crawl, robots.txt, terms, market price,
  batch, spend cap, lease, health, wine_profile_v1, WineProfile, LWIN, ADR 0130,
  studio, sommelier, reviewer, gold set, menu price, restaurant list price, class M,
  data notice, opt-out, two writers, cutover, Cowork, scheduled task, plan credits,
  usage limit, pipeline connector, claim, lease, pause order
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
   "writing every night" is not.] [Round 3, 2026-09-18: all three of today's runs were
   refused by the plan's weekly usage limit, which is why they left no row (fact 10).]
   The foundations doc called these runs "unattributed"
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

### Round 3: the host, the money, review and estimates (2026-09-18, evening)

He answered four more questions by AskUserQuestion the same day, and the orchestrating
workflow relayed them. His words are copied exactly as relayed. The glosses in
parentheses are the relay's own. **Every reading is marked**: "relay" for the relay's,
"ours" for this writer's.

| Question | His answer (verbatim as relayed) | Reading | Lands in |
|---|---|---|---|
| Q14: which way sommelier pay goes | *"we pay them, or rewards both, (we decide they don't see)"* | Relay: Mudavym pays sommeliers or rewards them, and which one is an internal decision the sommelier does not see. Ours: "or rewards both" means "or rewards, or both"; money never goes from a sommelier to Mudavym; /studio does not show a reviewer which form applies or how it is chosen [verifier, 2026-09-18: the draft read "no pay or reward terms" at all, which is wider than either reading; whether a sommelier sees what they themselves receive is Q14 (rest)] | §13; Q14 |
| Q15: instant publishing from /studio | *"No: every publish is sampled"* (relay gloss: 1 in 10 approvals re-checked by a second reviewer; a reviewer below the floor loses instant publish) | Ours: no approval publishes outside the sample. An approval still publishes at once, and 1 in 10 is re-checked afterwards by a second reviewer. A failed re-check withdraws the cell. A reviewer whose measured agreement is below the field's floor loses instant publish, and their approvals wait in the queue | §5 G6; §13; Q15 |
| Q2: when estimated values show | *"After automatic checks"* (relay gloss: labelled 'estimated' once they pass the automatic checks; a sample reviewed within 7 days; a field below its floor withdraws itself) | Ours: Q2 path (b). The automatic checks are G0–G6 and G8. G6 is one of them and fails when a field has too little gold, so a field's **first** publication still waits for its pilot audit. Real-house wines keep their review before publication (G7), which his answer does not mention and which only adds a check | §5; Q2 |
| Q1 (rest): the monthly spend limit | *"since we re going to use claude cowork, as long as credits allow."* | Relay: the pipeline's model work runs as Claude Cowork (Claude desktop agent) scheduled tasks on the founder's plan credits, not billed API calls; the limit is whatever the credits allow. Ours: there is no dollar cap, and usage credits stay off, so a run the plan refuses just stops (Q21). Credits set the pace, never the bar (§11) | §4; §11; Cost; Q19–Q21 |

Already decided the same evening and carried unchanged: the four laptop wine tasks keep
running until the repo pipeline runs (§15), and every wine is sourced from day one
(§4). Before this round, §11 recommended the gateway scheduler plus the Anthropic API
and Message Batches as the host. The Cowork answer replaces that for model work only.

**Four facts from the round-3 research** (a host research lane on 2026-09-18; this
writer re-counted the evidence table and re-read `harness.py:6-20` and the tasks'
permission modes; the rest is the lane's):

10. **The laptop tasks have barely run since 2026-09-04, because the plan refused
    them.**
    - **Runs.** 81 runs from 2026-08-16 to 09-18
      (`scratchpad/adr0163-r3/cowork-wine-runs.tsv`, read from the local session files
      under the `scheduled-tasks.json` folder). 36 ended on the weekly usage limit, 3 on
      the 5-hour session limit, and 1 on "Connection closed mid-response".
    - **Since 09-04, 37 of 41 runs failed.** The clean ones were three on 09-05 and
      `wine-verify-nightly` on 09-12.
    - **Missed and late nights.** No run at the scheduled hour on 09-06, 09-07 and
      09-17. Catch-ups ran on 09-08 at 16:37Z and 09-17 at 22:33Z. On 09-11 the runs
      were 15 minutes to 2.3 hours late [verifier, 2026-09-18: the draft said "1 to 2.5
      hours"; `wine-extract-nightly` started 07:20Z against its 07:0xZ slot, TSV]. On
      09-17 two ran at once and the third was skipped twice as `global_limit`, so there
      appears to be a cap of about 2 concurrent scheduled runs (the lane's inference;
      the number is not documented). [Verifier: the same store's non-wine task
      `overnight-job-search` also records `lastRunAt` 2026-09-17T22:33:16.664Z
      (`scheduled-tasks.json`), so the cap may be higher or counted differently.]
    - **The model changed with no repo change.** Haiku 4.5 (9 runs, to 08-23), Opus 5
      (24 runs, 08-24..09-02), Haiku 4.5 again (13 runs, 09-02 22:48Z..09-05), then
      Sonnet 5 (35 runs, 09-08 on): 22 Haiku runs in all, three changes [verifier,
      2026-09-18: the draft omitted the return to Haiku; TSV]. Only
      `wine-verify-nightly` has a model configured (`scheduled-tasks.json`, this writer).
    - **The stuck rows come from the host.** Of the 4 `research_runs` rows stuck at
      `running`, `323ff2a0` (started 09-16 06:06:17Z) matches a session the weekly limit
      ended after 1.5 minutes. The other three (`0330ca9c`, `d245485c`, `1b49f2c7`) come
      from runs that ended without the model closing them (lane, production SELECT).
    - **One pool, probably.** The limit message's reset time uses the same weekly anchor
      as this account's reset (2026-09-25T15:00Z), which fits one pool shared with the
      founder's Claude Code work. Not proven.
11. **How the laptop tasks write.**
    - **No database credential.** The laptop has none: `harness.py:6-20` (gitignored,
      `datasets/annotation_inbox/pdfs/wine-pipeline/tools/`) says the database is
      "reachable only through the Supabase MCP tool".
    - **The model carries the values.** The Python builds each INSERT's values, and the
      model re-sends them through the claude.ai Supabase connector's `execute_sql`
      (approved on the extract and verify tasks, lane). So "verbatim" rests on the model
      copying correctly, not on the code.
    - **Permissions.** All four tasks run with `permissionMode: bypassPermissions`
      (`scheduled-tasks.json`, this writer), and their sessions record
      `egressAllowedDomains: ["*"]` (lane).
    - **A missing tool is silent.** The 08-31 extract run aborted because the connector
      and bash tools did not appear. The only trace is a local file,
      `RUN_2026-08-31_extract-nightly_ABORTED.md`.
12. **What the hosts are** (official pages the lane fetched on 2026-09-18):
    - **Local scheduled tasks** fire only while the app is open and the computer awake.
      On wake, one catch-up runs for the latest missed time within 7 days, and older
      ones are dropped (code.claude.com/docs/en/desktop-scheduled-tasks). [Verifier,
      2026-09-18, re-fetched: that page documents Claude Code Desktop's local tasks
      (`~/.claude/scheduled-tasks/`). The laptop's wine tasks are Cowork tasks
      (`local-agent-mode-sessions/`, prompts under `~/Documents/Claude/Scheduled/`). Their
      measured catch-ups on 09-08 and 09-17 (fact 10) fit the same rule; no Cowork page
      read here states it.]
    - **Cowork scheduled tasks** now run remotely, even while the computer sleeps,
      unless they need local files or apps. Cloud Cowork cannot reach a home or company
      network (support.claude.com/en/articles/13854387, /13345190, /13364135).
      [Verifier, re-fetched 2026-09-18: running in the cloud is "in beta" (/13345190).
      Egress settings do not bind the web tools: *"Network egress permissions don't
      apply to the web fetch or web search tools or MCPs"* (/13364135). A scheduled task
      has *"the same capabilities as regular Cowork tasks, including connected tools,
      skills, and installed plugins"*, and its model is an optional setting
      (/13854387).]
    - **Claude Code cloud routines** clone the default branch on every run. Their
      minimum interval is 1 hour, they draw down subscription usage, and each account
      has a daily run cap (code.claude.com/docs/en/routines). [Verifier, re-fetched:
      a routine has *"no permission-mode picker"* and uses every tool of an included
      connector without asking; all connectors are included by default and can be
      removed per routine; network access comes from its cloud environment (default
      "Trusted", an allowlist); the model is set per routine. Routines are a research
      preview.]
    - **One limit.** Chat, Claude Code and Desktop count toward the same usage limit
      (support.claude.com/en/articles/11647753). Usage credits bill at standard API
      rates and can carry a monthly cap (/12429409).
    - **Connectors.** Custom remote MCP connectors are available to Cowork on Max
      (/11175166).
    - **This account** (lane, measured): Max plan; a 5-hour window; the weekly
      all-models window 36% used about 10 hours after its reset; extra usage disabled.
13. **The consumer terms** (anthropic.com/legal/consumer-terms, effective 2025-10-08,
    lane):
    - **Automated access** is barred except through an API key "or where we otherwise
      explicitly permit it". Scheduled tasks and routines are features Anthropic
      offers, so we read them as permitted. That is our reading, not settled.
    - **Training.** Inputs may be used for training unless the account opts out. Even
      after opting out, materials given as feedback or flagged for safety review may
      still be used (verifier, re-fetched 2026-09-18).
    - **Competing use.** The terms bar using the Services "to develop or train any
      artificial intelligence or machine learning algorithms or models" (in a clause on
      competing products). How that applies to Mudavym's own wine models is for the
      lawyer (Q17 (i)).

### Round 5: the founder's twelve answers to the remaining open questions (2026-09-19)

He answered the last twelve open items by `AskUserQuestion` on 2026-09-19 (~05:50Z),
after round 4's research pass. The record of these lives in session memory
(`founder-sketch-decisions-106-115.md`, "ADR 0163 wine-library answers", 12 of 12),
relayed to this writer, not read from the tool call itself. **Only two of the twelve
are recorded there in his own quoted words** (2 and 4, marked *verbatim* below); the
other ten are recorded as the option he picked, not a direct quote, and are stated
here as their substance — this table does not invent quotation marks the source
does not carry. Numbering follows the memory file's own 1–12, not this ADR's Q
numbers, so both are given.

| # | This ADR's question | His answer | Lands in |
|---|---|---|---|
| 1 | Q2 Publication path: which gates stay before an inferred cell shows | Keep both human gates — the per-field pilot audit (G6) before a field's first cell, and a person's look at a real house's wines (G7); the laxer readings are rejected | §5 G6/G7; Q2 |
| 2 | Q17 The lawyer gate before pooling | **Verbatim:** *"Ship now, fix later"* — against this ADR's own recommendation that the full (a)–(i) gate hold for Türkiye (the only jurisdiction with a real house) before any pooling | §9; §14; Q17 |
| 3 | Q16(a) Market price k | k = 5 (not 3), and guards (b)–(g) accepted exactly as drafted | §9; Q16 |
| 4 | Q6 The claim checker | **Verbatim:** *"we're gonna use JEV and it's already inside the repo"* — read as TypeSafe AI's Jev (`jev-1.13`, hosted API, DPA/MCA, no training on customer data), not the self-hosted MiniCheck/mDeBERTa design this ADR had drafted | §4 P7; Q6 |
| 5 | Q20's residual: which Max tier funds the dedicated seat | Max 20x, $200/mo | §11; Q20 |
| 6 | Q10 Canonical `primary_type` | Colour × style {still, sparkling, fortified}, sweetness kept in its own cell — the revised recommendation, confirmed | §2; Q10 |
| 7 | Q15 (rest) How a reviewer clears the floor for instant/automatic publish | The Wilson bound, option (a) | §5; §13; Q15 |
| 8 | Q18 Retention of the uploaded/crawled menu PDFs | Keep until superseded (not the fixed 90-day window, not forever) | §8; Q18 |
| 9 | Q14 (rest) Sommelier pay's structure and rate | Rewards for now (cash stays later, behind OD-23); the rate itself stays parked on OD-23 | §13; Q14 |
| 10 | Q17(a)'s EU half | Opt-in for EU houses — confirms the verifier's departure from his own round-2 literal words (*"a notice with an opt-out"*, no carve-out) | §14; Q17 |
| 11 | Q11 (rest) The six unasked houses | Confirms both evidence groups as drafted: Gullit's Tavern, Yaren's Fine Dine, Meyhouse Palo Alto and YARDOM are **not** real; Chez Community and The Old House Pub **are** real | §2; Q11 |
| 12 | Q13 What a sommelier may add | (a): own-voice notes are `stated` and signed; a third-party fact still needs a citation | §1; Q13 |

**What this settles and what it does not.** Eight of round 4's ten deepened
questions are now fully decided. The other two are decided only in part: Q11 only
for the six unasked houses, leaving its stuck `research_runs` rows, the two
registry rows and `pg_cron` open — they were never part of this round's question
to him (Q11 (remainder), DECIDED bracket below); and Q14 only for the reward's
*form* (rewards, not cash) and its *rate*'s parking on OD-23, leaving the reward
*structure* — points per verdict, a flat stipend or a per-hour rate — unchosen
(Q14, DECIDED bracket below). Two more items are open because this round's
answers created them, not because it left them undone: Q6's answer opens a
language-coverage gap (below), and, separately, whether Jev belongs in the §14
notice is noted but not asked (§14 fork, above). Item 2's *"Ship now, fix later"*
is the one answer taken against this ADR's own recommendation, and the
consequence was shown to him before he chose it: §14 already states that "models
already trained are not retrained" — a legal problem found after pooling starts
cannot be undone by switching a setting, only mitigated going forward (§9, §14;
Q17, DECIDED bracket below). That answer also reorders work that used to gate on
the lawyer review: whether a plain, non-lawyer Terms of Service still ships
before the first real house's menu pools is now its own open founder question
("Pre-pool ToS"), not decided here (§14, the Consequences line and step 0.18 each
carry a dated round-5 bracket saying so). And outside round 4's ten, untouched by
this round: Q22 — whether a house's first upload keeps its instant billed read or
waits for a task run — has never been put to him at all (below). Item 4 replaces
this ADR's
drafted self-hosted checker (§4 P7) with a paid hosted API from a vendor this repo
has not previously used in product code — the record researched for that pick
(`.planning/07-reference/TYPESAFE_AI_OVERVIEW.md`, crawled 2026-09-17, copied into
this branch with this round; `07-reference/INDEX.md` gains its row) **does not state
which languages Jev covers**, so Italian and Turkish — the two languages this
pipeline actually needs (Context, fact 4; Italy is the largest stocked country and
both real houses are Turkish) — are neither confirmed nor excluded the way mDeBERTa's
27-language card let this ADR exclude Greek. That gap is carried forward as its own
open item (§4 P7; Q6, DECIDED bracket) rather than assumed either way.

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

[Round 3, 2026-09-18: the founder chose Cowork for model work (*"since we re going to
use claude cowork, as long as credits allow."*). The Desktop row's reasons stop being
a rejection and become requirements in §11:

- the tasks stay thin, and the gateway opens and closes every run, so a killed session
  cannot leave a run `running`;
- health notices an absent host;
- a missing tool shows up as an expired lease;
- the model a task used is recorded and checked.

Whether the tasks run on the laptop is Q19. Message Batches is no longer the host for
pipeline model work (§11).]

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
source, and added the reviewers and the notice.] [Round 3, 2026-09-18: model work runs
as Claude Cowork scheduled tasks on the founder's plan credits, and the gateway stays
the only writer (§11). Credits set how fast wines are reached, never how they are
checked.]

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
binds, and for how soon a wine is reached. [Round 3: read "when credits bind". The
gateway serves claims in this order (§11).]

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
modelled)`. [Round 3: `research_runs` also gains `host` (`gateway`, `cowork-local`,
`cowork-cloud` or `routine`), `task_id`, `session_id`, `lease_id` and `model_basis`
(`host_config` for a Cowork task, whose model only the task reports). `cost_basis`
gains `plan`. For a Cowork run the lease plays the batch's part: ingest is unique on
`(lease_id, unit_id, field, sample_idx)`, `manifest_sha256` hashes the claim's unit
list, and `anthropic_batch_id` and `reserved_usd` stay null.] `restaurant_wine_roster` (sightings, 0 rows) gains `master_wine_id`,
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

[Round 3, 2026-09-18: where a stage below says "batch", read "a Cowork task run"
(§11). Only the model work moves: reading a menu (P1/P2), URL discovery (P5), cited
extraction (P6), the judge (P7(c)) and inference samples (P8). Intake, P3, P4, every
fetch, the deterministic checks, P9–P11 and P13 stay on the gateway, and P7(b) and
P12 on `wine-worker`. Each task claims its units from the gateway and submits through
the pipeline connector, which only stages.] [Round 5, 2026-09-19: P7(b) moves off
`wine-worker`. Q6's DECIDED answer (below) replaces the self-hosted checker with a
gateway call to TypeSafe's Jev, so P7(b) now runs on the gateway beside P7(a); only
P12 stays on `wine-worker` (§11's Gateway and `wine-worker` rows).]

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
  (Cost). [Round 3: the read runs in a Cowork task (§11), and credits cannot decide
  the model either.]
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
  verdict; it never decides robots itself. [Round 3: P5 is a Cowork task using the
  built-in web search, which takes no `blocked_domains` (lane; not in the docs this
  writer read). The never-list is therefore enforced by the gateway on every URL the
  task returns, and again at fetch time (§8 rule 1). Search snippets are never
  values.] [Verifier, 2026-09-18: Cowork's egress settings *"don't apply to the web
  fetch or web search tools or MCPs"* (support.claude.com/en/articles/13364135), so
  nothing on the host stops a task fetching a never-list page itself. The launcher
  forbids web fetch; whether it can be switched off for a task is unverified. A value
  from a page the gateway did not fetch still cannot pass P6's check, but the fetch
  itself would be the automated collection §8 exists to prevent.]
- **P6 Cited extraction** [batch]. Opus 5 reads the fetched pages as document blocks
  with citations. Fable 5.1 is A/B-tested in the pilot, and under F1 the more accurate
  model on gold wins, although Fable 5.1 costs twice as much ($5/$25 batch per MTok
  against Opus 5's $2.50/$12.50, pricing page fetched 2026-09-18). A separate Sonnet 5 pass normalises into
  the schema and keeps the citation ids, because citations and structured outputs
  cannot share a request (citations doc, via the SOTA lane). Deterministic checks: the
  cited text is an exact substring of the page whose hash was recorded, and
  `value_norm` equals the normalised claim. `fn_uncited_fields` is rewritten to bind
  citations to values. [Round 3: a Cowork task has no API citations feature. The
  gateway serves the fetched page text in the claim, and the task submits each value
  with its quote string through the connector, whose tool schema is the structured
  output. The gateway then runs the same deterministic checks, so the gateway, not the
  model, decides whether a quote is on the page. Whether normalisation stays a separate
  pass is measured in the pilot. The Fable 5.1 A/B needs a task configured with it.]
- **P7 Verify.** A value is auto-accepted as `sourced` only when (a) the deterministic
  check passes; **(b) [Q6, DECIDED 2026-09-19: *"we're gonna use JEV and it's already
  inside the repo"*] TypeSafe AI's Jev (`jev-1.13`), a hosted API, agrees** — the
  gateway sends the cited span as Jev's `state` and asks one `Noul` question ("does
  this exact quote support the claimed value?"), reading the returned probability
  against a threshold this ADR does not yet fix (calibrated on the pilot's gold set,
  the same way every other floor here is, §5); (c) an Opus 5 judge with an independent
  prompt agrees; and (d) one tier-A source (producer site or official register) or two
  independent tier-B domains support it. A menu PDF counts only for listing facts.
  Anything less goes to `review`; disagreeing sources stay as competing observations.
  (c) belongs to the same model family as P6, the objection this ADR raises against
  C2, so (c) is not counted as independent: independence rests on (a), (b) and (d),
  which C2 lacked — Jev is TypeSafe's own "System One" model family, distinct from
  Anthropic's, so (b) still satisfies that requirement.
  **Language coverage is unmeasured, not excluded.** The self-hosted design this
  replaces stated its own coverage on each model's card (mDeBERTa: 27 languages
  including Turkish, explicitly not Greek); the Jev research record consulted for
  this decision (`07-reference/TYPESAFE_AI_OVERVIEW.md`) states none. Until Jev's
  coverage of Italian and Turkish — the two languages this pipeline actually needs
  (Context, fact 4; Türkiye holds the only two real houses, Q11) — is measured
  against gold examples in the pilot, a claim in any language but English is treated
  as **uncovered by (b)** and routed to `review`, the conservative default the old
  design used only for Greek, now applied more broadly until proven otherwise (open
  item, Q6 below). Jev's vendor-stated terms (not independently verified beyond the
  research record): a Data Processing Agreement and Master Customer Agreement exist,
  and TypeSafe states it does not train on customer data; its published limits, most
  relevant to a verification call, are a literal reading of `instructions`/`criteria`
  with no implied conditions, and no adversarial robustness by default against text
  written to argue for its own classification (TYPESAFE_AI_OVERVIEW.md §8, points 1
  and 6) — the same general risk class §8 of this ADR already tracks for fetched
  pages. [Superseded design, self-hosted MiniCheck for English and mDeBERTa
  otherwise: kept in git at this line, commit `a99078485`, for history — not
  restated here per Q6's own shrunk comparison, below.]
- **P8 Infer, descriptive fields only** [batch]. Enum outputs (WSET SAT levels;
  sweetness bands per Reg. (EU) 2019/33 Annex III Part B). Samples: 1 Opus 5 + 2
  Sonnet 5, emit at ≥2 of 3, else coarsen or omit; stocked wines 5 samples, emit at ≥4
  of 5. Conditioned on stated and sourced cells, plus legacy identity cells **only as
  low-trust input and only when they pass G1 and G3**, never as stated. Every inferred
  cell records `conditioned_on`; when a sourced cell lands, a capped, paid
  re-inference is enqueued. `rule_inferred` inputs are not used until P8's loader for
  them exists (Stage 2). `recalled` displays as "estimated" until audits separate it
  from `inferred` (today their Wilson intervals overlap: known 23/24, inferred 54/65,
  quality lane). [Round 3: a Cowork task has one configured model, so the samples come
  from one Opus 5 task and one Sonnet 5 task, joined by the gateway. A cell is emitted
  only when all its samples are in. Samples from a run the plan cut short stay staged
  under their `(model_id, prompt_hash)` until a later run completes the set.]
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
- [Round 3, 2026-09-18, on *"as long as credits allow"*. **"Day one"** is now the first
  night the pipeline's Cowork tasks run, since no night is paid. **Every eligible wine
  is queued and attempted from that night, in §2's order, and none is left out for
  cost.** How many nights that takes is set by credits. The batch windows above no
  longer apply: a new wine waits for the next task run that claims it, and the page
  says "coming soon" until then. The 500 a night below becomes "as credits allow" (step
  1.8). Credits slow this; they never remove a step (§11).]
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
  - [Round 3, answered *"No: every publish is sampled"*: an instant publish is inside
    this sample too. A failed re-check withdraws the cell and counts against the first
    reviewer. A reviewer below the field's floor loses instant publish (§13; how that is
    measured is Q15).]
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
- [Round 3, answered 2026-09-18: *"After automatic checks"*. That is Q2's path (b).
  An inferred cell shows, labelled "estimated", once it passes G0–G6 and G8. A
  stratified sample is reviewed within 7 days (G7), and a field below its floor
  withdraws itself. **Our reading:** G6 is an automatic check that fails on too little
  gold, so the pilot audit above still comes before a field's first publication, and
  real-house wines keep their review before publication. Both only add checks; if he
  meant otherwise, it is asked, not assumed (Still open).]
- [Round 3] **Credits never move a floor.** When credits run short, cells wait. No
  floor, gate, sample count or judge is relaxed to save them (§11).

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
- [Round 3, 2026-09-18: rules for a plan-credit host (§11).]
  - **Where the rules above change.** The batch rules (in progress over 24 h; ended
    and not ingested) apply only if billed batches return (Q21). The spend rules (over
    the cap; any `cost_basis='modelled'`) apply only to billed API calls, which today
    means only the synchronous house path (Q22). [Verifier, 2026-09-18: the draft put
    the batch rules on the synchronous path, which sends no batch.]
    Cowork runs carry `cost_basis='plan'` and are exempt from the "tokens > 0 and
    `cost_usd` NULL" rule. "The backlog the cap allows" reads "the backlog credits
    allow", reported below.
  - **`model_host_absent`, red:** a declared task has made no claim or heartbeat for
    more than twice its cadence.
  - **`lease_expired_unsubmitted`, a named state with its count:** a lease ended with
    nothing submitted. The gateway cannot tell a refused run from a crash or a missing
    tool (fact 10, fact 11). The reason is only in the Cowork run history, which the
    gateway cannot read. [Verifier, 2026-09-18: so this state is never green. The
    rule above that reads "a lease expired" as red is not among the rules relaxed
    here and still applies: a missing tool (fact 11) must not read as a quiet night.]
  - **Self-reported identity.** The task id, session id and model reach the gateway
    only as what the caller says through the connector. The gateway cannot verify
    them, so the model-mismatch rule below catches drift, not a false report, and a
    "declared task" means a caller naming a registered task id (verifier).
  - **`paced_by_credits`, a named state, never green,** while eligible units wait. It
    reports the queue depth, the oldest unattempted unit's age, units completed per
    night, and the nights needed to drain the backlog at that rate. It is red when no
    unit completes for 48 hours.
  - **Model mismatch, red:** a task reports a model other than the one registered for
    it (fact 10: the laptop tasks' model changed three times).
  - **Writers.** Only the gateway writes pipeline rows. A Cowork task writes nothing;
    it appears only as the `host`, task id and session id the gateway records.

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
   `blocked_domains`; [round 3: a Cowork task's search takes no `blocked_domains`
   (lane), so this rule and the gateway's filter on P5's URLs are the only
   enforcement, §4 P5; they cover only the gateway's own fetches, not a task's web
   fetch, which Cowork's egress settings do not bind (verifier, /13364135)];
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

**[Q17, DECIDED 2026-09-19, founder: *"Ship now, fix later"*.** Against this ADR's own
recommendation (Round 4 research pass, below: the full (a)–(i) gate holds because
every real house is Turkish) that a lawyer clear Law 4250 and the Data Act question
before the first real house's prices pool. The founder chose otherwise, having been
shown the cost §14 already states: **models already trained are
not retrained** (:1743 below [recomputed 2026-09-21; was :1715]). Concretely, this means pooling and the aggregate guards above (k=5,
the 25% cap, no cost/invoice/POS data, no sign-in-free price page) still apply as
engineering guardrails — nothing here removes them — but this ADR no longer treats a
lawyer's sign-off on Türkiye's Law 4250 art. 6 and the notice's wording (Q17 (e)–(i))
as a precondition to shipping; the review, if it happens, happens after real houses'
menus are already pooling. If it later finds a problem, the pooled figures and any
model trained on them to that point cannot be un-pooled or un-trained — only stopped
going forward (§14's opt-out and "not retrained" already say this; nothing here is
new engineering, only a changed order of operations). Separately, **Q17(a)'s EU half
is also DECIDED 2026-09-19: opt-in for EU houses**, confirming the verifier's
departure from his literal round-2 words (*"a notice with an opt-out"*, no EU
carve-out) rather than defaulting to it — costs nothing today, since no EU-country
restaurant row exists (Round 4 research pass, below).]**

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

### 11. Hosts and credits

[Round 3, 2026-09-18: rewritten on the founder's answer *"since we re going to use
claude cowork, as long as credits allow."* (Context, round 3). The earlier text put
model work on the gateway's `ModelClientService`, using Anthropic Message Batches in a
dedicated workspace under a monthly spend limit, with two-phase submission, spend
reservations and a 429 HALT. It is kept in git: `git show 056de928e:` this file,
lines 1048–1080. It stays the design if billed API use is ever turned on (Q21).]

**The rule: the agent reasons, the gateway writes.** Model work runs as Claude Cowork
scheduled tasks on the founder's plan credits. Everything that must always be on, and
everything that writes, stays on the gateway, which spends no model credits.

| Where | What runs there |
|---|---|
| Postgres | state; the gates as SQL; the view; what health reads |
| Gateway (Railway, always on) | P1 receiving menus; the P4 enqueue triggers and sweep; every fetch, through the fetch module (§8); P3 identity SQL; the deterministic P6 and P7(a) checks (exact substring on the hashed page, `value_norm`); P7(b) the claim check, a hosted API call to TypeSafe's Jev [Round 5, 2026-09-19: moved here from `wine-worker`, Q6's DECIDED answer, below]; P9 gates and the publish RPC; P10; P11 re-fetch and hash compare; P13 health (the outside dead-man alarm that watches it is Sentry Crons or a `pg_cron` witness, never the gateway itself, §6; verifier, 2026-09-18: the draft listed the alarm in this row); leases, fencing tokens, and opening and closing every run; the pipeline connector (below) |
| `wine-worker` (Railway cron, Python, from Stage 1) | JavaScript rendering for allowed URLs; P12 embeddings. Its deployment is proven by the Railway `cronSchedule` and its ledger rows, never by code. [Round 2: moved from Stage 2, because P7 needs the checker from the first night.] [Round 5, 2026-09-19: P7(b)'s self-hosted MIT checkers (MiniCheck, mDeBERTa) are struck — Q6's DECIDED answer moves that check to a hosted API call (Jev) the gateway makes directly, so `wine-worker` no longer hosts a checker model at all.] |
| Cowork scheduled tasks (plan credits) | Model work only: P1/P2 reading a menu into lines; P5 URL discovery (URLs only); P6 cited extraction, as quote strings the gateway checks; P7(c) the judge, as its own task with its own prompt; P8 samples, one task per model, because a task has one configured model |

**Repo code, thin tasks.** A task holds no code and no database access.

- **Prompts live in the repo.** A task's own instruction is a short launcher: claim,
  do the work, submit. The prompt, the output schema and the units come back from
  `claim`, read from the repo at the gateway's deployed `git_sha`, so the gateway
  computes `prompt_hash` itself. Nothing lives in the gitignored
  `datasets/annotation_inbox/`.
- **Deterministic code runs on the gateway**, deployed from `main`, never on the
  laptop. Peer sessions switch branches in the shared checkout, so a local task pointed
  at it would run whatever branch was checked out. If Q19 picks a routine, which clones
  `main` on each run, repo code may also run inside the task, and the connector does
  not change.
- **The pipeline connector.** A custom remote MCP connector on the gateway, signed in
  by OAuth, with three tools:
  - `claim(stage)` returns a leased set of units with its fencing token;
  - `submit(lease, unit, outputs)` stages observations. It is idempotent on
    `(lease_id, unit_id)` and refused on a stale fencing token;
  - `heartbeat(lease)` renews the lease.

  It can only stage. It never publishes, never writes a library column and never runs
  SQL a caller supplies; its own writes are the staging rows `submit` records. Its
  reach stops at staging because the server exposes only these three tools, not
  because of where its OAuth token is held. [Verifier, 2026-09-18: the draft gave the
  token's location as the reason. A connector added to an account can be turned on in
  any conversation on that account (support.claude.com/en/articles/11175166), so the
  tools, not the token, are the boundary; where the token is stored is from memory.]
- **No database reach from a task.** No pipeline task gets a service-role key, the
  Supabase connector or `execute_sql`, unlike the laptop tasks (fact 11). Whether
  Cowork can limit one task's connectors is unverified. A dedicated seat without the
  Supabase connector settles it by construction (Q20). [Verifier, 2026-09-18: this is
  what the one-writer rule rests on. P5, P6 and P8 tasks read untrusted page text, and
  a scheduled task carries the account's *"connected tools, skills, and installed
  plugins"* (/13854387). On a seat whose account holds the Supabase connector, text
  planted in a wine page could ask a task to write production directly, around the
  gateway. So the rule holds on a shared seat only if per-task connector limits exist.]
- **Permissions.** No pipeline task runs with `bypassPermissions` or open egress
  (fact 11). Its tools are the pipeline connector, plus web search for P5.
  [Verifier, 2026-09-18, two limits. Cowork's egress settings do not bind web fetch,
  web search or MCPs (/13364135), so "no open egress" does not stop a task's own web
  fetch (§4 P5). And a routine has no permission-mode picker (fact 12), so under
  Q19 (c) containment rests on its connector list and its environment's network
  access, not on a permission mode.]
- **Identity.** Each run row records `host` (`cowork-local`, `cowork-cloud` or
  `routine`), the task id, the session id and `model_basis='host_config'` (§3). Health
  is red when a task reports a model other than the one registered for it (§6). These
  are what the caller reports; the gateway cannot check them (§6, verifier).
- **The model (F1) does not change with the host.** Opus 5 is the default where §4
  says so. A cheaper model replaces it only if the pilot measures it as non-inferior on
  gold, never because credits are short. Opus 5 runs in Cowork: 24 of the laptop runs
  used it (fact 10). [Verifier, 2026-09-18: nor because of the host. If the model gold
  picks (P6's Fable 5.1 A/B) cannot be set on a Cowork task, that is taken to the
  founder with billed API use as the other path (Q21). It never falls back quietly to
  the runner-up.]

**Credits, not dollars** (our reading of *"as long as credits allow"*).

- **No dollar cap.** Usage credits are off today (lane) and stay off unless Q21 turns
  them on, so no pipeline run is billed. The
  budget is counted in units: wines or lists a run completes, times runs a night. The
  pilot measures how many units one point of the weekly usage window buys (step 1.5).
- **When the plan refuses a run,** that run stops. Its lease expires, and every unit
  it had not submitted goes back to the queue for the next run [verifier, 2026-09-18:
  the draft said "with nothing submitted"; a run cut off mid-way has submitted some].
  Nothing is
  half-published: a cell is emitted only when all its samples and checks are in (§4
  P8).
- **The order claims are served in.** The gateway serves claims in this order, so when
  credits run short the end of the list waits first:
  1. reading real houses' menus, and sourcing the wines on menus a developer has
     approved;
  2. sourcing new wines (P5–P7);
  3. inferring new wines (P8);
  4. sourcing the backlog, in §2's priority;
  5. re-inferring the backlog, in §2's priority;
  6. the model parts of the weekly re-verify (P11).

  [Verifier, 2026-09-18: P11 marks a cell stale when its page changes, and its
  re-extraction waits at step 6. Neither §4 nor §7 says what a stale cell shows
  meanwhile. If it keeps showing as sourced, short credits lower freshness, which the
  rule below forbids. What a stale cell shows is open, for the founder.]
- **What never pauses,** because it spends no credits: receiving menus, enqueueing,
  the gateway's checks, publishing, /studio, the 7-day audit and health.
- **Credits set the pace, never the bar.** Short credits never lower a floor, skip a
  gate, cut P8's samples (3, or 5 for stocked wines), drop the judge, skip sourcing
  before inference, swap in a cheaper model or thin the 1-in-10 sample. A wine that
  cannot get every step waits.
- **What "every wine from day one" becomes.** Every eligible wine is queued and
  attempted in order from the first night the tasks run, and none is left out for
  cost. How many nights that takes is set by credits. On a seat shared with
  development work, the measured record is 37 refused runs out of 41 (fact 10). That
  fork is Q20.
- **A house waiting at upload.** A scheduled task cannot answer a waiting person. The
  gateway's existing synchronous menu read calls the API through `ModelClientService`
  under its per-restaurant ceiling, which fails open on a ledger error by design
  (`model-client.service.ts:600-606`). Whether that path stays on billed API, or the
  house waits for the next run, is Q22. Either way it is counted apart from the
  pipeline.

**Gateway crons are gated by role.** `ScheduleModule.forRoot()` is unconditional
(`app.module.ts:84`), so every gateway process with production credentials would run
the crons. Wine crons register only when `WINE_PIPELINE_ROLE=primary` and
`RAILWAY_DEPLOYMENT_ID` is present, and the holder is recorded on each ledger row.
Locks are real leases with fencing tokens; `house-letters.service.ts:742-752` is a
status flip with no expiry and is not the pattern. [Round 3] Health is red when a lease
is held by anything other than the Railway primary or a declared Cowork task claiming
model work through the connector. A "declared" task is one whose caller names a
registered task id; any session on the account with the connector turned on could
name one (verifier, 2026-09-18). What such a caller could do is still only stage.

**Where the tasks run** (on the laptop, in Cowork's cloud, or as a Claude Code routine)
is Q19. Once the menu PDFs are uploaded (step 0.20), a task needs no local file, so it
can run in the cloud and keep running while the laptop is off.

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
is amended, not retired (§14). [Round 3] The four old tasks are replaced by thin
Cowork tasks that hold no code and no database access (§11). Their
`bypassPermissions` mode and their use of the Supabase connector's `execute_sql`
retire with them (fact 11).

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
  - [Round 3, answered 2026-09-18: *"No: every publish is sampled"*.] **No approval
    publishes outside the sample** (our reading, with the relay's gloss):
    - D-12 and D-13 survive only as publish-then-sample. An approval publishes at
      once, and 1 approval in 10 is re-checked by a second reviewer.
    - A failed re-check withdraws the cell and counts against the first reviewer.
    - A reviewer whose measured agreement is below the field's floor (§5) loses instant
      publish, and their approvals wait in the queue until they recover.
    - How agreement is measured for a reviewer with few re-checks is Q15 (rest).
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
- the three broken paths named below are corrected, each to its own table's
  actual columns — fixing one does not fix the other two.

**The three broken promotion paths, filed here as open items** — as three
`CLAIMS.jsonl` rows (`ADR-0163-STUDIO-PROMOTE-DIRECT-INSERT`,
`-OVERRIDE-AUTOPROMOTE-SELECT`, `-QUALITY-PATCH-SELECT`, each `status:
open`), not `v3.0-TECH-DEBT.md` entries. **Corrected, 2026-09-19:** the
premise for keeping them out of that file is now a real decision, not an
assumption — the founder ordered the register deleted, 2026-09-19, with
survivors split by kind (checkable defects to CLAIMS, his decisions to
OPEN-DECISIONS, paperwork to the owning ADR) — but its retirement, ADR 0165,
is *reserved*, not written: `docs/retire-tech-debt` carries 0 commits past
`main` (checked 2026-09-19, `git log main..docs/retire-tech-debt`), so no
ADR file exists yet at that number. The decision itself is recorded today
only in session memory
(`founder-sketch-decisions-106-115.md`, "Tech-debt register" bullet), not
yet in `OPEN-DECISIONS.md` or an ADR — CLAUDE.md §5's "a decision made and
not written down did not happen" applies to it until 0165 lands. Found in
round 2's research and re-verified against this checkout on 2026-09-18):

- **Path 1 — `promote_to_library`'s direct insert.** The insert payload at
  `services/agent-orchestrator/api/studio_routes.py:1031-1048` (function
  starts at `:926`) sets `price`, `price_glass`, `color`, `sweetness_level`,
  `tasting_notes` and `description`. `master_wine_library`'s schema
  (`supabase/migrations/20260805000000_baseline_from_production.sql`,
  unchanged by any later migration) has none of these — it has
  `price_reference`, `sensory_profile` (jsonb), `producer_story` and
  `historical_notes` instead. The `except` at `:1063-1073` retries by popping
  only the three audit columns (`promoted_by`, `promoted_at`,
  `submission_id`); the other six stay in the payload, so the retry fails the
  same way.
- **Path 2 — override auto-promotion.** `_maybe_promote_submission`
  (`services/agent-orchestrator/services/override_service.py:336`, called
  after 5 approvals under D-12) selects the 7 `JSONB_ENRICHMENT_KEYS`
  (`services/agent-orchestrator/services/field_confidence.py:62-70`:
  `grape_family`, `wine_structure`, `sensory_profile`, `practical_attributes`,
  `region_hierarchy`, `critic_scores`, `winemaking_details`) as top-level
  columns of `master_wine_library_submissions` at `:356`. That table has
  never carried these as top-level columns (checked against every migration
  that touches it): they exist as columns on `master_wine_library` itself, or
  nested inside the submission's own `payload`/`normalized_fields` jsonb. The
  SELECT raises `42703` before promotion can run — the lane reproduced this;
  confirmed here by schema inspection.
- **Path 3 — the quality PATCH.**
  `services/agent-orchestrator/api/quality_routes.py:205` builds the
  identical `jsonb_cols` SELECT against the same table for the same 7
  columns, in the PATCH handler meant to promote a submission once its review
  queue clears — the same `42703` failure.

  All three share one root cause: enrichment fields live as columns on
  `master_wine_library` and as `payload`/jsonb keys on
  `master_wine_library_submissions`, but two of the three paths query the
  submissions table as if it had `master_wine_library`'s columns, while the
  third writes columns to `master_wine_library` that were never added.
  Fixing one path does not fix the other two; each needs its own column list
  corrected to what its own table actually has.

**Payment is not designed.** "Paid sommeliers" is our reading; quote R's "paying" also
admits the reverse. Nothing pays anyone today, and any cash payout collides with the
Stripe guard and OD-23 (Context, fact 6). The question is Q14.

[Round 3, answered 2026-09-18: *"we pay them, or rewards both, (we decide they don't
see)"*.]

- **Direction.** Mudavym pays or rewards the sommelier, never the reverse.
- **Form.** Pay, rewards or both is decided inside Mudavym, and the sommelier does not
  see how (the relay's reading). So /studio does not show a reviewer which form
  applies or how it is chosen (ours). [Verifier, 2026-09-18: the draft said /studio
  shows "no pay or reward terms", which neither reading supports. Whether a sommelier
  sees what they themselves receive is part of Q14 (rest).]
- **A guard we propose.** Pay or reward never depends on which way a verdict goes, so
  approving is never worth more than rejecting. Without it, the reward would pay for
  the approvals the 1-in-10 re-check exists to catch.
- **What cash still needs.** The Stripe `transfers`/`payouts` guard lifted and OD-23
  decided. Rewards need neither.
- **Still internal:** which form, and the rate (Q14 rest).

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

[Round 5, 2026-09-19: Q17's DECIDED answer, *"Ship now, fix later"* (§9, above),
reorders the lawyer half of this ADR's plan — a lawyer's sign-off is no longer a
precondition to shipping (§9, DECIDED bracket). Whether "Terms of Service exist"
above still means a lawyer-drafted Terms of Service, or ships as a plain one
Mudavym writes now with a lawyer to revise later, is not decided here: it is its
own open founder question ("Pre-pool ToS"). The first two bullets above are
engineering work, not legal review, and are unaffected.]

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

[Round 3, 2026-09-18: the first condition now reads: the gateway runs as primary on
Railway, **and** the new Cowork tasks claim and submit through the pipeline connector
(§11). The second is met through the connector's ledger rows. The third also excludes
`paced_by_credits` (§6), which stays up while the backlog waits for credits. The old
four are disabled after that night, as before.]

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
   `1138b209`, which may be the org the workspace is created in.] [Round 3,
   2026-09-18: **this rule no longer holds.** Both the old four tasks and the new
   pipeline tasks draw on plan credits. In one seat they share one pool, and fact 10
   suggests the old four already share the founder's own. Until cutover, the old four
   can use up the credits the new tasks need for the first clean night that cutover
   waits for. His answer stands (keep them until the repo pipeline runs). A dedicated
   seat for the new tasks removes the competition (Q20). Health's unit rules count only
   declared pipeline tasks.]

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
| A16 | Checker licences and exact checkpoint | Applied (§4 P7) at proposal time: ANLI is CC BY-NC 4.0 (github.com/facebookresearch/anli, fetched); MiniCheck's MIT weights carry that lineage, so commercial use went to Q6. [Round 5, 2026-09-19: Q6 DECIDED for Jev instead, a paid hosted API — the open question is no longer an OSS training-data licence, it is whether TypeSafe's DPA/MCA (vendor-stated, not independently reviewed) covers this use, and whether Jev's unstated language coverage reaches Italian and Turkish (§4 P7, new open item)] |
| A17 | Record what could not be verified | Applied (Not verified, below) |
| B1 | Disarm the Desktop tasks first; writer identity; foreign writer = red; reaper disarmed until 7 clean days; repair `running`+`completed_at` rows | Applied (§6, Build 0.1–0.3, 0.15). [Round 2: **the founder overrode "disarm first"**: *"Keep until the repo pipeline runs"*. Writer identity, foreign-writer reporting and the disarmed reaper still apply. §15 replaces "disarm first" with containment until cutover, and the disarming moves to step 1.10] |
| B2 | Enqueue trigger on `IS DISTINCT FROM`, never raising, mutation-tested | Applied (§4 P4, Build 0.13). The critic split it into an INSERT trigger and an UPDATE trigger, because the draft's combined `WHEN (OLD…)` cannot be created |
| B3 | Restate rule 1 as a founder fork; `conditioned_on`; legacy identity as low-trust input; T9 repairs before Stage 1; name the rule_inferred loader or drop it | Applied, except the T9 **column** repair: **rejected** because rewriting `grape_variety` re-keys the signature hash while G-F3 is open; the same effect comes from G1/G3 withholding those legacy cells from display and from P8's input (§4 P8) |
| B4 | Real leases with fencing; role-gated crons | Applied (§11) |
| B5 | Two-phase batch submit; spend reservation; fail closed for background; HALT cancels; verify tier and credit before Stage 3 | Applied (§11, Build 1.1). [Round 3: set aside for pipeline model work, which now runs on plan credits (§11). The design is kept at `056de928e` for billed API use (Q21). Its intent carries over as leases, fenced idempotent submits, and the expired-lease return of units] |
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
    the first real house's menu counts. [Round 5, 2026-09-19: Q17's *"Ship now, fix
    later"* (§9) reorders the lawyer half of this; whether a non-lawyer Terms of
    Service still gates pooling is open, not decided here (§14; founder question
    "Pre-pool ToS").]
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
- [Round 3, 2026-09-18: model work on plan credits (§11).]
  - **Easier:** pipeline model work sends no bill, and the workspace, batch and
    spend-reservation machinery is not built.
  - **Harder:**
    - **Pace.** The pace is whatever credits allow, and it is unmeasured until the
      pilot.
    - **Sharing.** On a seat shared with development work, the pipeline competes for
      one pool: 37 of the laptop tasks' 41 runs since 09-04 were refused (fact 10).
    - **The laptop.** A task on the laptop skips the nights it sleeps and gets one
      catch-up on wake.
    - **Blind spots.** The gateway cannot see why a run failed, only that its lease
      expired.
  - **Revisit when:**
    - the nights needed to drain the backlog stay above 30 at the measured rate (the
      30 is our proposal): take the seat, usage credits or billed API to the founder
      (Q20, Q21);
    - the plan's terms or limits for scheduled use change.

  The "measured cost per sourced wine" and "org usage tier" triggers above apply only
  to billed API use.

## Build order

Each step is small, has a check, and states whether it writes production.

**Stage 0 — no model spend.** Exit: health is red on today's data for the listed
reasons, and the outside alarm fires on a missed run. [Round 2] Also: the notice, the
opt-out and the Terms of Service are live (0.18) before any real house's menu counts
toward class M or training. [Round 3] Also: the pipeline connector (0.21) and the
plan-credit health rules (0.22) pass their checks. Stage 0 still spends no credits.

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
  unflagged until he answers Q11.] [Round 5, 2026-09-19: Q11 DECIDED — flag
  **twelve** rows, not eight. Gullit's Tavern, Yaren's Fine Dine, Meyhouse Palo Alto
  and YARDOM are confirmed not real and join the eight already flagged (Q11
  (remainder), DECIDED bracket, below). *Check:* the count is 12, and Chez
  Community and The Old House Pub stay unflagged as real houses.]
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
  - The two docs are corrected; the three broken paths are named in §13 and
    filed as CLAIMS.jsonl rows, not in `v3.0-TECH-DEBT.md` (the founder
    ordered that register deleted 2026-09-19, survivors split by kind; its
    retirement is ADR 0165, reserved on `docs/retire-tech-debt` but not yet
    written — §13 above).

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

  [Round 5, 2026-09-19: Q17's DECIDED answer, *"Ship now, fix later"* (§9), no
  longer requires a lawyer's sign-off before shipping, so whether this step's last
  bullet still ships as a lawyer-drafted clickwrap, or as a plain Terms of Service
  Mudavym writes now with a lawyer to revise later, is open — not decided here
  (§14; founder question "Pre-pool ToS"). The first two bullets are engineering
  work and are unaffected.]

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
- 0.21 [Round 3] **The pipeline connector (§11).**
  - A remote MCP server on the gateway with `claim`, `submit` and `heartbeat`, signed
    in by OAuth.
  - Prompts and output schemas are served from the repo, and the gateway computes
    `prompt_hash`.
  - Submits are fenced and idempotent on `(lease_id, unit_id)`.
  - The prompts and task launchers live in the repo; nothing is read from
    `datasets/annotation_inbox/`.

  *Checks:*
  - a stale fencing token is refused;
  - a second submit of the same unit changes nothing;
  - a static guard fails any connector path that publishes, writes a library column or
    runs SQL a caller supplies (the staging insert is the one write allowed; verifier,
    2026-09-18: as drafted, "runs SQL" would fail `submit` itself);
  - an expired lease returns its units to the queue;
  - each mutation turns a test red.
- 0.22 [Round 3] **Health for a plan-credit host (§6):** `model_host_absent`,
  `lease_expired_unsubmitted`, `paced_by_credits` and the model-mismatch rule.
  *Checks:* a fixture task with no claim for twice its cadence reads red; a fixture
  task reporting an unregistered model reads red; a fixture queue with no unit completed
  in 48 hours reads red; each rule's mutation turns a test red.

**Stage 1 — sourcing and inference, gated.** Exit: at least one descriptive field
published on real data with a measured Wilson bound above its floor. [Round 2] The exit
also needs two things: every new wine that night has a sourcing attempt, and cutover
(§15) has happened. The stage was named "inference, gated". Sourcing moved in, because
every wine is sourced from the first paid night (Q1). [Round 3: read "paid night" as
"the first night the Cowork tasks run" throughout this stage (§4).]

- 1.1 Founder creates the workspace, key and spend limit; the org usage tier and
  credit balance are verified. *Check:* recorded here. [Round 3: **replaced.** The
  founder creates the Cowork tasks (his keystrokes) in the seat Q20 picks and where
  Q19 says. He adds the pipeline connector and records whether usage credits are on
  (Q21). Pipeline work needs no workspace or API key. *Check:* each task's id and
  configured model are registered with the gateway, and its first claim appears in the
  ledger.]
- 1.2 `ModelClient`: batch transport, Opus 5 price, batch discount, search fee,
  two-phase submit, reservation pre-flight, HALT. *Check:* unit tests; a fixture spend
  429 halts and cancels; boot reconciliation ingests an orphan by prefix. [Round 3:
  **not built for pipeline work.** It is built only if Q21 turns billed API use on.
  The synchronous house path keeps its current ceiling (Q22).]
- 1.3 Role-gated crons and fenced leases. *Check:* a local boot without the flag
  registers zero wine crons.
- 1.4 P2 on the unclassified stubs. *Check:* each is classified from a stated section
  or reported in the bucket.
- 1.5 P8 pilot on 200 stratified eligible wines. *Check:* measured cost per wine and
  fingerprint ratio replace the estimates below, in a dated amendment. [Round 2: the
  pilot runs P5–P7 and then P8 on the same 200 wines. It also measures the share of
  wines with a findable source.] [Round 3: it also reads the weekly usage window
  before and after one Stage 1 night's units, and records the units one point of the
  window buys. No pace is promised before that number exists. *Check:* the number and
  the seat it was measured on are recorded here.]
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
  [Round 3: "about 500 a night, under the cap" becomes this. The whole backlog is
  enqueued on the first night the tasks run, and claims serve it in §11's order as
  credits allow. The /studio queue's depth paces what reaches reviewers. A prompt
  change after the pilot re-runs its cells on credits, not dollars. *Check:*
  `paced_by_credits` reports the backlog and its nights to drain.]
- 1.9 Growth from house paper the same day. Public-list intake only if Q7 is answered
  yes: 4 backlog lists a night from list URLs whose platform terms were read. *Check:*
  every crawled list yields sightings or a reason code. [Round 2: Q7 is answered yes.
  The 41 uploaded laptop menus go first, and each list opens a /studio session (§13).]
- 1.10 [Round 2] **Cutover** (§15). The founder disables the four Desktop tasks on the
  first night that meets §15's definition. *Check:* the draft's step 0.1 check,
  unchanged. Then the reaper (0.15) arms after 7 days with 0 foreign rows. [Round 3:
  that night also needs the new Cowork tasks claiming through the connector (§15).]
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
measured /studio reviewer throughput (§13).] [Round 3: 10 lists a night is a pace that
credits must allow. It is measured by step 1.5's number, not promised.]

## Cost (estimates; no paid call was made)

[Round 3, 2026-09-18: pipeline model work now runs on plan credits (§11), so **no
figure below is a bill**. The figures stay as the API-equivalent size of the work,
what it would cost if billed. They have two uses:

- **If usage credits are turned on (Q21).** Usage credits bill at standard API rates
  (support.claude.com/en/articles/12429409, lane), not batch rates. So the figures
  below roughly double, except the search fee, which batch never discounted.
- **The scale credits must cover.** Every wine sourced at Stage 1 is $39–112 a day at
  batch prices. Whether a Max plan covers any share of that is unmeasured; step 1.5
  measures it. The Max plan's price was not checked here (the lane's figure is from
  memory).

The "spend limit" bullet at the end of this section is answered: there is no dollar
limit, only credits.]

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

Not included: Railway compute for `wine-worker` (unmeasured), the founder's audit
hours, and the cost of wines for which no source is found (P5 only, about $0.02–0.06
each). [Round 5, 2026-09-19: the self-hosted checkers this line priced as Railway
compute are gone (Q6) — P7(b) now calls Jev at $0.042 per million input tokens,
output free (TYPESAFE_AI_OVERVIEW.md §7), which is a small, real per-call cost this
table does not yet carry, not an unmeasured fixed compute cost.]

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
  these figures, the cap decides which wines wait, in §2's priority order. [Round 3:
  answered, *"as long as credits allow"*. Credits decide which wines wait, in §11's
  order.]

## Open founder questions

[Round 2, 2026-09-18: each question keeps its original text as the record. The bracket
at its head says whether it was answered and where the answer now lives in the
Decision. What is still open, including the new Q13–Q18, is listed at the end under
"Still open after round 2".]

- **Q1 Spend.** **[ANSWERED in part: *"Every wine from day one"*: N equals intake
  (§4 sourcing order; Cost, round 2). The monthly limit itself is still his keystroke.]**
  **[Round 3: the rest ANSWERED, *"since we re going to use claude cowork, as long as
  credits allow."*: plan credits, no dollar limit (§11). The host's own forks are Q19–Q21.]** The fork: a monthly limit on a dedicated workspace (his keystroke),
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
  or (b) for inferred cells. (b) stays the proposal.]** **[Round 3: ANSWERED, (b):
  *"After automatic checks"* (§5).]** **[Round 5, DECIDED 2026-09-19: both readings
  confirmed** — the pilot gate (G6) and real-house pre-review (G7) both stay; see the
  DECIDED bracket under "Q2 Publication path for inferred cells", below.]** Paths: (a) every inferred cell audited before it shows; (b) a
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
  Still open: the MiniCheck licence, and how long the uploads are kept (Q18).]**
  **[Round 5, DECIDED 2026-09-19: the checker is no longer MiniCheck/mDeBERTa** —
  *"we're gonna use JEV"* replaces it with TypeSafe AI's Jev (§4 P7), which retires
  the licence question and opens a language-coverage one instead; Q18's retention is
  also DECIDED, keep until superseded. See both DECIDED brackets below.]** (a) Snippet-only storage (the default
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
- **Q10 Canonical `primary_type`.** **[Still open.]** **[Round 5, DECIDED
  2026-09-19: colour × style {still, sparkling, fortified}, sweetness kept
  separate** — see the DECIDED bracket under "Q10 Canonical `primary_type`" in the
  deep-dive section, below.]** One enum (red, white, rosé, orange, sparkling,
  fortified, dessert) or three axes (colour × effervescence × sweetness)? G1's CHECK
  and the analytics slice key wait on it. Recommendation: three axes as cells, with the
  one-enum slice derived from them.
- **Q11 Production changes on his word.** **[ANSWERED in part: none of the four May
  houses is real (step 0.3 flags eight rows). Still open: the six unasked houses; closing
  the 4 stuck rows, which now waits for cutover (§15); the two registry rows; and
  `pg_cron`.]** **[Round 5, DECIDED 2026-09-19: the six unasked houses are also
  resolved** — he confirmed both evidence groups as drafted (Gullit's Tavern,
  Yaren's Fine Dine, Meyhouse Palo Alto and YARDOM not real; Chez Community and The
  Old House Pub real). See the DECIDED bracket under "Q11 (remainder)", below.
  Closing the 4 stuck rows, the two registry rows and `pg_cron` remain open,
  unchanged by this round.]** Close the 4 stuck `research_runs` rows;
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

[Round 3, 2026-09-18. **Answered:** Q1 in full, Q2 as (b), Q14's direction and Q15's
rule. **Still open:** Q2's reading (to confirm), Q6 (rest), Q10, Q11 (rest), Q13,
Q14 (rest, internal), Q15 (rest), Q16, Q17 with the new (h) and (i), Q18, and the new
Q19–Q23. Q19–Q21 decide whether "every wine from day one" is reached in days or in
months.]

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
  - **[Round 3: ANSWERED, both parts.** (a) *"as long as credits allow"*: no dollar
    limit (§11). (b) follows from it: the whole backlog is enqueued on the first night
    the tasks run, and credits and the queue's depth set the pace (step 1.8). What is
    left of the money question is Q19–Q21.]
  - **[Research pass, 2026-09-18: Q1's remainder is SETTLED, not a live fork.**
    The apparent tension against Q21 ("off until the pilot") is already
    reconciled in §11, not a contradiction: the round-3 answer *"since we're
    going to use claude cowork, as long as credits allow"* is recorded here
    (:2402-2405 [recomputed 2026-09-21; was :2352-2355, was
    :2235-2238, was :2177-2180, stale by this ADR's own earlier edits]), and
    the round-3 diff log states *"Answered: Q1 in full
    (plan credits, no dollar limit)"* (Review trail, :3290 [recomputed
    2026-09-21; was :3235, was :3012, was
    :2981, was :2489]); Q1
    does not appear in this section's own intro list (:2377-2381 [recomputed
    2026-09-21; was :2327-2331, was :2210-2214, was
    :2152-2156]). With Q21 off, "credits allow" now means
    exactly the Max seat's included weekly/session usage — a refused run stops
    and waits for the reset, which is what §11 (:1474-1477, :1500-1504
    [recomputed 2026-09-21; was :1446-1449, :1472-1476, was :1346-1349, :1372-1376])
    already says. Re-measured 2026-09-18 (Supabase, SELECT-only):
    `master_wine_library` is still 3,589 live / 3,314 eligible, unchanged from
    the ADR's own count; `research_runs` still has 4 rows stuck `running`
    (latest 2026-09-16 06:06:17Z, matching fact 10) and still lacks the
    `host`/`task_id`/`model_basis` columns §11 calls for — the pipeline has
    not started running under this design, so nothing has overtaken the
    settled reading.
    **Residual, not a re-fork of Q1:** which Max tier funds Q20's dedicated
    seat. Max 5x is $100/mo, Max 20x is $200/mo for 4x the weekly window
    (support.claude.com/en/articles/11049741, fetched 2026-09-18). Since Q21
    is off, that tier choice is now the practical monthly ceiling. A one-time
    discounted usage bundle (support.claude.com/en/articles/14246112, 10–30%
    off, up to $2,000/mo on Max) is a lower-risk top-up than revisiting Q21 if
    the pilot shows the weekly window binds first — but a bundle itself needs
    usage credits switched on, so it stays unavailable unless Q21 is
    revisited.]**
- **Q2 Publication path for inferred cells.** The paths are unchanged:
  - (a) every inferred cell is reviewed before it shows;
  - (b) a field's pilot clears its floor, then cells publish first and are audited
    within 7 days, with automatic withdrawal.

  **Recommendation:** (b). Every menu's listing facts are still approved by a developer
  first (§13). [Verifier, 2026-09-18: quote P's *"We're gonna check their values"* is
  read here as the menus' values. If "their values" means the library's values, it
  points to (a). He should be asked which he meant rather than have (b) assumed.]

  **[Round 3: ANSWERED, (b): *"After automatic checks"*.** One reading to confirm. We
  read "automatic checks" as including G6, which needs pilot gold before a field's
  first publication. We also read it as keeping real-house wines' review before
  publication. If he meant estimates show before any gold exists, that lowers the first
  publication's bar, which F1 and §11's "credits set the pace, never the bar" argue
  against. **Recommendation:** confirm both readings.]
  - **[Research pass, 2026-09-18: Q2's reading is still open — the top-level
    answer does not settle it.** The founder's *"After automatic checks"*
    (:1041, :2288-2289 [recomputed 2026-09-21; was :1013, :2238-2239, was :932,
    :2191]) picks
    publish-then-audit over audit-before-publish, but says
    nothing about whether "automatic checks" still includes (i) a field's
    pre-publication gold pilot (G6) before its first cell ever shows, and (ii)
    real-house pre-review (G7). The register itself still lists "Q2's reading
    (to confirm)" as open (:2377-2381 [recomputed 2026-09-21; was :2327-2331,
    was :2148-2156, was :2191-2196]), and it has never been put
    back to him. **Since answered below (DECIDED 2026-09-19): both gates
    stay.**
    - *Confirm both gates* (recommended) — keep G6 and G7 as designed.
      Slowest first-publish per field; every real-house wine's inferred cells
      wait on a human indefinitely.
    - *Drop real-house review* — G7 folds into the same 7-day post-hoc audit
      as everyone else. A real restaurant's live menu can then show an
      unaudited fact for up to 7 days, against §13/§14's own more careful
      treatment of house relationships.
    - *Drop the pilot gate* — a field publishes once basic checks pass; gold
      accumulates from post-hoc audits instead. The 0.80 floor is then
      asserted, not demonstrated, for a field's first days live, against F1
      ("spend never lowers the bar").
    **Recommendation: confirm both gates, don't assume a laxer reading.**
    Nothing is built yet — `field_calibration` has 0 rows and no
    `wine_profile_v1` or publication-gate table exists (Supabase, checked
    2026-09-18) — so asking now is free and rebuilding withdrawal/audit logic
    after cells are live is not; the ADR's own design text already states the
    stricter reading (G7 at :1017, G6 at :1005 [recomputed 2026-09-21; was
    :989, :977, was :918, :897]); and 2026 guidance on AI-assisted publishing
    (Logora's AI-moderation guide; Glean's AI review-workflow guide, both
    fetched 2026-09-18) treats staged human review before publish as the norm
    for exactly the segment this touches most — paying, real restaurant
    customers.]**
  - **[DECIDED 2026-09-19, founder (`AskUserQuestion`, item 1 of 12): keep both
    human gates** — the per-field pilot audit (G6) before a field's first cell ever
    shows, and a human's look at a real house's wines before publication (G7). This
    is the research pass's own recommendation immediately above, confirmed rather
    than relaxed: neither "drop real-house review" nor "drop the pilot gate" is
    adopted. Nothing changes in the built design because nothing is built yet
    (`field_calibration`, `wine_profile_v1` and the publication-gate table remain
    unbuilt, per the research pass above); this closes the fork for whenever they
    are.]**
- **Q6 (remainder) The checker licence.** MiniCheck's weights are MIT, but its ANLI
  training data is CC BY-NC.
  - **The choice:** use it commercially, or use the multilingual MIT checker for
    English too.
  - **Recommendation:** mDeBERTa for every language until the lineage is cleared.
  - **[Research pass, 2026-09-18/19, superseded 2026-09-19 by the founder's own pick
    below — shrunk to a pointer.** The pass had compared four self-hosted options in
    detail (use MiniCheck anyway; fall back to mDeBERTa; switch to an Apache/MIT
    checker such as `vectara/hallucination_evaluation_model`; buy Bespoke's
    commercial licence) and cleared none of the three CC BY-NC/ANLI-lineage
    candidates cleanly, with HHEM ruled out as English-only. That analysis is no
    longer this pipeline's design — the founder picked a different checker family
    entirely (below), which this licence question does not reach the same way — and
    is kept for history in this file's git log (`git show a99078485:` this file,
    this section) rather than restated here. **This shrink is the retire-to-write
    for adding `07-reference/TYPESAFE_AI_OVERVIEW.md` to the reference corpus**
    (CLAUDE.md §4).]**
  - **[DECIDED 2026-09-19, founder (`AskUserQuestion`, item 4 of 12), his own words:
    *"we're gonna use JEV and it's already inside the repo"*.** Read as TypeSafe
    AI's Jev (`jev-1.13`), researched in the untracked
    `.planning/07-reference/TYPESAFE_AI_OVERVIEW.md` (crawled 2026-09-17, copied
    into this branch with this ADR; `07-reference/INDEX.md` gains its row, same text
    as the main checkout's uncommitted row). **What changes:** §4 P7(b) drops the
    self-hosted MiniCheck/mDeBERTa design (kept at commit `a99078485` for history)
    and calls Jev's hosted API instead — a `Noul` question against the cited span,
    returning a probability rather than a class label, thresholded once the pilot's
    gold set exists (§5, same as every other floor here). This also retires the
    licence question the research pass above was chasing: Jev is not a self-hosted
    model fine-tuned on CC BY-NC data, it is a paid per-token API (**$0.042 per
    million input tokens, output free**, TYPESAFE_AI_OVERVIEW.md §7), so the open
    question shifts from "can we use this model's weights commercially" to a
    vendor-risk one: TypeSafe states a **Data Processing Agreement and a Master
    Customer Agreement exist, and that it does not train on customer data**
    (TYPESAFE_AI_OVERVIEW.md §7) — **vendor-stated, not independently verified**
    beyond that crawled record, the same evidentiary bar this ADR holds every other
    vendor's terms to (§9's shop terms, §11's consumer terms). Its published
    "jaggedness" limits (TYPESAFE_AI_OVERVIEW.md §8) most relevant to a
    verification call: (1) a literal reading with no implied conditions, so P7(b)'s
    `instructions` need every edge case spelled out explicitly; (6) it is not
    adversarially robust by default — text written to argue for its own
    classification can move the answer, the same general risk class §8 of this ADR
    already tracks for fetched pages; and a 64k-token combined context ceiling (32k
    for `state` plus the longest question) that a long producer page or menu PDF
    could exceed, with no such vendor-stated ceiling under MiniCheck/mDeBERTa.
    **Open item, not decided here: language coverage.** The record researched for
    this pick does not state which languages Jev covers — not "not including
    Italian" the way HHEM's card did, not a language list the way mDeBERTa's did:
    silence, not exclusion. This pipeline needs **Italian** (Context, fact 4: Italy
    is the largest stocked country) and **Turkish** (both real houses, Q11, are
    Turkish) specifically. Until measured against gold examples in the pilot (§5),
    §4 P7 treats every non-English claim as uncovered by (b) and routes it to
    `review` — the conservative default the retired design used only for Greek, now
    applied to every language pending proof otherwise. Left open deliberately, per
    CLAUDE.md §0.1: measured, not guessed.
    **Noted but not asked, for a later fork:** whether Jev's hosted processing of
    claim text needs its own line in §14's notice, alongside the Claude Cowork
    mention Q17(h) already covers. Not decided here — flagged only so it is not
    silently assumed either way.]**
- **Q10 Canonical `primary_type`.** The choice is one enum, or three axes.
  **Recommendation:** three axes as cells, with the one-enum slice derived from them.
  - **[Research pass, 2026-09-18: the three-axis recommendation above does
    not collide with the ADR's own sweetness rule. Corrected, 2026-09-19:
    the rule at :812 [recomputed 2026-09-21; was :784, was :723] forbids a model-parsed
    `primary_type` only because that
    field feeds the `beverage_kind` classifier; it does not bind a separate
    sweetness cell, so there was no rule to revise away from.**
    - *One enum, canonicalized* — clean the 12 spellings in production to ~7
      canonical values, no new columns. Cheapest, zero reader changes across
      the ~15 call sites that read `primary_type` as flat text, but a wine
      still can't be both sparkling and rosé.
    - *Three axes (the ADR's current text, above)* — colour × effervescence ×
      sweetness as separate cells. This does not conflict with the ADR's own
      boundary rule (:572-577 [recomputed 2026-09-21; was :547-552, was
      :486-491]) that
      sweetness is descriptive and inferable,
      shown "estimated" (P8, :903 [recomputed 2026-09-21; was :875, was :794]):
      the never-inferred rule at
      :812 [recomputed 2026-09-21; was :784, was :723] binds
      `primary_type` itself, because that is the field `beverage_kind` reads
      — a sweetness cell that is not `primary_type` is not bound by it, so
      the two rules do not force a choice. Backfill is still lossy:
      "fortified"/"dessert" conflate production method with sweetness (a
      fortified wine can be bone-dry).
    - *Two axes, sweetness separate* — split only colour and effervescence,
      leave sweetness where P8 already puts it. **Revised, 2026-09-19: this
      leaves `fortified` (25 rows) and `dessert` (18 rows) with no home, and
      the conflation this option rests on was asserted, not measured.**
      - **Measured, 2026-09-19** (Supabase, SELECT-only; name-matched on a
        word-boundary regex so "Prosecco"/"Rosso" cannot false-positive):
        **53 of the 369 `sparkling` rows are named "Rosé"/"Rose"**
        (Billecart-Salmon Brut Rose Champagne, Crémant d'Alsace Rosé,
        Prosecco Rosé ×2, Impérial Rosé, ... — full list pulled, not
        sampled) — real sparkling rosés holding only "sparkling," their
        colour lost to the field. **1 of the 115 `rose`/`rosé` rows**
        ("Brut Rosé," Tenuta Col Sandago) is a sparkling wine holding only
        "rose," its effervescence lost the other way. The conflation is
        real, not hypothetical, and larger (53 rows) than either category
        alone suggests.
      - **`fortified` and `dessert` re-confirmed at 25 and 18** (Supabase,
        2026-09-19, unchanged). A fortified wine has its own colour (Port
        red, Sherry white) and is not reliably still-vs-sparkling either —
        colour × effervescence has no cell for "fortified" without
        inventing one. "Dessert" is not a colour or an effervescence at
        all: only 4 of its 18 rows name an actual dessert style (ice wine,
        Sauternes, Tokaji, ...); the rest do not. It is a sweetness fact
        wearing a type label.
    - *Colour × style {still, sparkling, fortified}, sweetness separate
      (revised recommendation)* — the same split already drafted for the
      founder's confirmation (`Q10-wine-type` in this ADR's ask list, below):
      colour (red, white, rosé, orange) stays one cell; the second cell
      gains a third value instead of two. Fortified gets an explicit slot —
      fortified wines have a colour and are practically never also
      sparkling, so the three values do not collide with each other or with
      sweetness. "Dessert" retires as a type value entirely: its 18 rows get
      a real colour on backfill (a build task, not a design gap — most are
      white by name, a few are not) and their sweetness moves to the
      already-planned P8 cell, exactly where "estimated" sweetness was
      always going to live. This still derives one flat display enum for
      the 30 analytics insight types, and still touches only the ~15
      `primary_type` call sites `wine-signature.ts:172-187` already excludes
      from the identity key.
    **Recommendation: colour × style (still/sparkling/fortified), sweetness
    separate, `dessert` retired as a type value** — Q10 as already drafted
    for the founder, now with the conflation measured instead of asserted,
    and a named home for every one of the 12 production spellings.
    Production (Supabase, 2026-09-19, re-measured not copied forward):
    exactly 12 distinct `primary_type` spellings (red 1809, white 1089,
    unknown 749, sparkling 369, rose 82, orange 38, rosé 33, "red (still)"
    28, fortified 25, dessert 18, "red (still, dry)" 12, "red " 1) —
    matches the ADR's own count; no `sweetness`/`style`/`colour` column
    exists yet, so every option is pre-build. `primary_type` is excluded
    from the identity key (`wine-signature.ts:172-187`), so this carries no
    identity-key risk either way, and `wine-intelligence-foundations.md:422`
    wants one flat dimension for consumption, which the derived-enum
    approach still delivers. **Reconciled, 2026-09-19: this is the ADR's
    original "three axes as cells," not a departure from it.** Colour is one
    axis; style (still/sparkling/fortified) is the second, standing in for
    effervescence and now also covering fortification; sweetness is the
    third, kept in its own cell per P8 rather than folded into either. The
    axis count never changed — only the second axis's cell boundaries did,
    to give fortified wines a home colour × effervescence had no slot for.]**
  - **[DECIDED 2026-09-19, founder (`AskUserQuestion`, item 6 of 12): colour ×
    style {still, sparkling, fortified}, sweetness separate.** This adopts the
    revised recommendation directly above, unchanged: two cells (colour; style)
    plus sweetness kept in its own P8 cell, `dessert` retired as a type value with
    its 18 rows getting a real colour on backfill. **What changes:** none of this
    is built yet (no `sweetness`/`style`/`colour` column exists in production, per
    the research pass above), so the decision fixes the target schema before any
    migration is written, rather than settling a fork after the fact.]**
- **Q11 (remainder) The rest of the houses.**
  - **The six unasked houses.** Are any of Gullit's Tavern, Yaren's Fine Dine,
    Meyhouse Palo Alto, YARDOM, Chez Community or The Old House Pub real? Unflagged,
    each counts as real the day it uploads a menu. Flagging a real house by mistake
    would skip its review.
  - **Recommendation:** answer house by house, and flag none that he does not name.
  - **Also still his:** closing the 4 stuck rows (after cutover), the vivino.com and
    wine-searcher.com registry rows, and `pg_cron`.
  - **[Research pass, 2026-09-18: a clean evidence split among the six, but
    nothing is flagged without his word.**
    - *Presumed test-pattern (ask him to confirm, don't pre-flag):* Gullit's
      Tavern, Yaren's Fine Dine, Meyhouse Palo Alto, YARDOM. Each matches the
      pattern that already ruled out YAREN/ALDEMIR/ADMIN 1/ADMIN ROOM: created
      2026-05-08..11 in the same cluster (or, for Meyhouse Palo Alto, built by
      the founder's own research process — memory `lens-phase-state.md`
      confirms he modeled the Sim house "on a REAL venue researched from
      public sources"), no claimed `public.users` login for **any of the
      four** [corrected 2026-09-19: re-checked by direct SELECT joining
      `restaurants` to `users` on `restaurant_id` — all four show 0 rows,
      not three; not carried forward from the prior count], and an
      address/email lifted from an already-confirmed-fake or Sim
      row: Gullit's Tavern shares ALDEMIR/ADMIN ROOM's exact address (126
      East Pointe Lane); Yaren's Fine Dine shares YAREN's owner email;
      Meyhouse Palo Alto uses the founder's own email and the later "Sim
      Meyhouse" row's exact address/phone; YARDOM shares the same cluster,
      with no user and no public listing found.
    - *Presumed real (independent evidence):* Chez Community and The Old
      House Pub each have an independent owner signup (`public.users`,
      created 2026-07-18 and 2026-09-02) and a confirmed, currently-operating
      business at their exact address (Tripadvisor/Instagram for Chez
      Community in Fethiye; multiple booking sites for Old House Pub Hotels in
      Antalya Kaleiçi — one door from where the founder placed "Sim Vanilla
      Kaleiçi", worth naming to him as a coincidence even though this house
      has its own login).
    - All six still have 0 rows in `restaurant_wine_roster` (matches the
      ADR's "stock nothing" claim, :277-279 [recomputed 2026-09-21; was
      :268-270, was :251-253]).
    **Recommendation: put the two evidence groups to him as one grouped
    confirmation**, not six separate asks — faster, and every claim is
    sourced so a wrong flag is easy to catch before cutover; still flags
    nothing he does not confirm, per CLAUDE.md §0.1 and the ADR's own rule
    (above).]**
  - **[DECIDED 2026-09-19, founder (`AskUserQuestion`, item 11 of 12): confirms
    both evidence groups exactly as put to him.** Gullit's Tavern, Yaren's Fine
    Dine, Meyhouse Palo Alto and YARDOM are **not** real; Chez Community and The
    Old House Pub **are** real. **What changes:** all six leave "unflagged"
    status. The four non-real houses join the earlier eight (the four "Sim " rows
    plus YAREN, ALDEMIR, ADMIN 1, ADMIN ROOM) as `is_simulation` (step 0.3, now
    **twelve** of the 14 `restaurants` rows flagged in total, not eight — Context,
    fact 9); Chez Community and The Old House Pub instead count as real houses
    from this ADR's first night — their wines are sourced first and reviewed
    before publication (§2, G7), same as any other real house. Still open,
    unchanged by this answer: closing the 4 stuck `research_runs` rows, the two
    registry rows, and `pg_cron` (recap bracket, above).]**
- **Q13 What a sommelier may add** (§1).
  - (a) Own-voice notes are `stated` and signed, and third-party facts need a citation
    and P6–P7.
  - (b) A new provenance class, "attested by a named expert", under which an uncited
    score or ABV may publish.

  (b) lets one person's memory publish an attributive fact, which the confirmed
  boundary forbids. **Recommendation:** (a).
  - **[Research pass, 2026-09-18: confirms (a), and shows why a corroboration
    path isn't buildable yet.** A third option is worth naming: *two experts
    must agree* — an uncited score/ABV sits in `review` until a second
    independent `certified_contributor` submits the same value, then
    publishes as corroborated, not `sourced`. Not deliverable today:
    production has exactly 1 active `certified_contributor` and 0 invited
    sommeliers (`SELECT role, count(*) FROM user_roles WHERE revoked_at IS
    NULL GROUP BY role`, 2026-09-18), and `wine_field_observations` — the
    table this flow would read — does not exist (`42P01`, relation does not
    exist).
    **Recommendation stands at (a), cite or don't publish.** It is already
    what §1 (:602-611 [recomputed 2026-09-21; was :577-586, was :516-525]) and §13
    (:1568-1572 [recomputed 2026-09-21; was :1540-1544, was :1440-1444]) implement, so it needs no new
    schema; option (b) would let one uncorroborated claim publish with no way
    to check it later, exactly what ADR 0020 rejected, and credentialing
    alone isn't a correctness guarantee (the Court of Master Sommeliers' 2018
    exam-cheating scandal,
    en.wikipedia.org/wiki/2018_Master_Sommelier_exam_cheating_scandal). No
    crowd-sourced wine platform researched (Vivino's Trust & Safety Policy,
    dated 2026-05-04) publishes an uncited expert claim as fact without
    corroboration or flagging.]**
  - **[DECIDED 2026-09-19, founder (`AskUserQuestion`, item 12 of 12): option (a)
    — own-voice notes only, facts need a citation.** A sommelier's own-voice notes
    publish as `stated` and signed; any third-party fact they add still needs a
    citation and P6–P7, same as anything sourced from a page. **What changes:**
    nothing in the built design — this confirms the recommendation directly above
    and closes the fork; the "attested by a named expert" provenance class (b) is
    rejected, not built.]**
- **Q14 Sommelier pay.** In quote R, "who will be paying" could mean sommeliers are
  paid, or that they pay. We read it as paid.
  - **The fork:** which way the money goes, and in what form: cash, discounts or
    points (the April idea).
  - **The cost of cash.** Any cash payout needs the Stripe `transfers`/`payouts` guard
    lifted and OD-23 (pricing) decided.
  - **Recommendation:** confirm the direction first. Then start with non-cash credit
    until OD-23 is decided.
  - **[Round 3: direction ANSWERED,** *"we pay them, or rewards both, (we decide they
    don't see)"*: Mudavym pays or rewards, never the reverse (§13).] **Still open, and
    internal** (decided inside Mudavym, not shown to sommeliers): pay, rewards or both,
    and the rate. **Recommendation:** rewards until OD-23 is decided, and accept the
    guard that no reward depends on which way a verdict goes (§13).
  - **[Research pass, 2026-09-19: form, structure and rate, split apart —
    only the rate stays uncovered.**
    - **Form** (pay vs rewards vs both): three options, none built. *Cash*
      needs the Stripe `transfers`/`payouts` guard lifted (§13, above) and
      OD-23 decided first. *Non-cash rewards* needs no payout system and
      nothing blocked. *Both* is decided per-sommelier inside Mudavym, never
      shown to them. **Recommendation stands: rewards, cash later** — this
      part needs nothing new.
    - **Structure** (how a reward is earned, not its size): three shapes,
      none built, each with a rough relative cost, not a number — the
      number itself is the rate, and stays parked below.
      - *Points per verdict recorded* — cost scales with review volume, the
        unit already tracked on `override_events.verdict` (§3, above); a
        point is earned for recording a verdict, not for which way it goes,
        so this does not conflict with the guard that no reward depends on
        a verdict's direction (§13, above).
      - *A flat monthly stipend* — cost is fixed per sommelier per month
        regardless of volume; cheapest per verdict at high throughput, most
        expensive per verdict if a sommelier reviews little, and weakens the
        tie between a sommelier's activity and Mudavym's outlay.
      - *A per-hour rate* — cost scales with logged time, not verdicts;
        needs a time-tracking mechanism nothing else in this ADR requires,
        and rewards time spent over verdicts recorded.
      **Recommendation: points per verdict recorded** — the only shape that
      reuses a unit this ADR already tracks, with no new instrumentation and
      no conflict with the direction-blind guard. The point value is the
      rate, and stays parked on OD-23 below, same as it would under either
      other shape.
    - **Rate: fully open, not merely unrecommended.** There is no candidate
      number to weigh options against — OD-23 (pricing) is still unstruck
      (`OPEN-DECISIONS.md`, re-checked 2026-09-19: "THE ROW IS STILL NOT
      STRUCK, and that is deliberate"), and OD-23 is the revenue-model
      decision a reward rate would be sized against. Naming a rate before
      OD-23 resolves would be picking a number with nothing under it — this
      is not a recommendation deferred, it is one that cannot be formed
      yet. **Recommendation: park the rate explicitly on OD-23**, and
      revisit only once OD-23 resolves, rather than leave it reading as an
      ordinary "still open" that looks answerable today.]**
  - **[DECIDED 2026-09-19, founder (`AskUserQuestion`, item 9 of 12): rewards now,
    rate parked on OD-23.** This confirms the **form** question directly: cash is
    deferred (it needs the Stripe `transfers`/`payouts` guard lifted and OD-23
    decided first, above), non-cash rewards go ahead now. It also confirms parking
    the **rate** on OD-23, exactly as recommended. **What his answer does not
    cover:** the **structure** question (points per verdict recorded, vs. a flat
    stipend, vs. a per-hour rate) — his recorded answer is "rewards now, rate
    parked on OD-23," which does not choose among the three shapes above, so that
    sub-fork stays open at the research pass's own recommendation (points per
    verdict recorded) rather than being read as decided. **What changes:** nothing
    built yet needs to change (no reward mechanism exists in production); this
    fixes the direction (rewards, not cash) for whenever one is built.]**
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
  - **[Round 3: the rule is ANSWERED,** *"No: every publish is sampled"* (§5 G6,
    §13).] **Still open: how "below the floor" is measured for one reviewer.** At 1 in
    10, re-checks pile up slowly. For a reviewer with no disagreements, the Wilson lower
    bound is n/(n + 3.84), so clearing 0.95 takes 73 agreeing re-checks (730 approvals
    at 1 in 10), 0.90 takes 35 and 0.80 takes 16. D-12's "5 in a row" gives 0.57.
    - (a) **The Wilson bound,** as every other floor here is read. A new reviewer's
      approvals are all re-checked until their bound clears, then 1 in 10. This is
      slower to start, and it costs reviewer hours, not credits.
    - (b) **The plain agreement rate.** Faster, but one lucky run grants instant
      publish.

    **Recommendation:** (a). It replaces D-12's "5 in a row", which no floor here
    supports. [Checked 2026-09-19, named as a coverage gap elsewhere: this
    question already carries options, the Wilson-bound math and a
    recommendation — nothing here needed a fresh research pass. Named for
    completeness as a third baseline option, not previously listed
    separately: *(c) keep D-12's "5 in a row"* — today's rule, proven to
    reach only about 0.57 agreement, below every floor in this ADR.]
  - **[DECIDED 2026-09-19, founder (`AskUserQuestion`, item 7 of 12): the Wilson
    lower bound, option (a).** A new reviewer's approvals are all re-checked until
    their Wilson bound clears the field's floor, then 1 in 10 — not the plain
    agreement rate (b), and not D-12's existing "5 in a row" (c), which the
    research pass measured at about 0.57 agreement, below every floor this ADR
    sets. **What changes:** D-12's "5 in a row" auto-promotion rule is replaced by
    this Wilson-bound gate wherever it is built (§5 G6, §13); nothing runs this
    check in production today, so the change lands whenever that code is written,
    not retroactively.]**
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
  - **[Research pass, 2026-09-18: confirms the ADR's own k=5 plan.**
    **Corrected, 2026-09-19: k=3 and k=5 are not identical today — the
    2026-09-18 pass measured the wrong table.** `restaurant_inventory.
    menu_price_current` is 0 of 14 restaurants either way (re-confirmed
    2026-09-19, Supabase, SELECT-only), but that table is the live tenant
    channel no real house uses yet; it has no bearing on class M. The
    ADR's own class-M source is Context fact 7 (the 26-corpus-PDF load,
    cited above and in Q16(a) itself): **0 wines qualify at k=5, 9 at
    k=3.** Loosening the threshold does surface numbers today, from those
    same 26 public menus — which is exactly the stricter number's job, not
    a free loosening.
    Since the ADR's own citations, the regulatory direction has tightened
    further: DOJ's proposed RealPage settlement (filed 2025-11-24) bars live
    non-public competitor data and requires ≥12-month aging; California's AB
    325 (in force since 2026-01-01) is named by multiple law-firm analyses
    — not the statute's own text, which names no sector — as reaching
    hospitality's shared-pricing algorithms specifically. Both are coarser
    and slower than what k=5, the 18-month window and the rounded-range
    display already do.
    **Recommendation: accept the ADR's own (a)-(g) exactly as written** —
    now for the right reason: not because loosening is free (it is not: 9
    wines would show at k=3 today, 0 at k=5), but because the regulatory
    direction has only tightened since the ADR's own analysis, so k=5 is
    the more defensible number by a widening margin. Deferring the whole
    line is a real alternative but only delays work §3-4 already route
    through the same class-M sighting rows, for a saving that is 9 wines'
    worth of exposure, not zero.
    Evidence: DOJ OPA release and Wilson Sonsini/Baker McKenzie/Hogan
    Lovells summaries on the RealPage settlement; Alston & Bird and Jones
    Walker analyses of AB 325 naming hospitality as high-risk; Connecticut
    HB8002 and New York's parallel statute scoped to residential rentals
    only, per Baker McKenzie's Jan 2026 note, so likely inapplicable here
    (all fetched 2026-09-18).]**
  - **[DECIDED 2026-09-19, founder (`AskUserQuestion`, item 3 of 12): k = 5, and
    guards (b)–(g) accepted exactly as drafted.** This confirms the ADR's own plan
    and the research pass's recommendation, not the looser k=3 (which would show 9
    wines today against 0 at k=5). **What changes:** nothing in the built design —
    §9's restaurant-list-price line already specifies k=5; this closes the fork so
    a future session cannot reopen it as unanswered.]**
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
    2026-09-18];
  - (h) [round 3] whether the notice must say that house menus are processed by
    Claude Cowork tasks under a consumer plan, whose inputs may train Anthropic's
    models unless the account opts out (fact 13; Q23);
  - (i) [round 3] how the consumer terms' bar on using the Services "to develop or
    train any artificial intelligence or machine learning algorithms or models" applies
    to Mudavym training its own wine models on the tasks' outputs, and whether scheduled
    pipeline use counts as use Anthropic "explicitly permit[s]" (fact 13).

  **Recommendation:** (a) opt-out for US and Turkish houses, opt-in for EU houses until
  cleared; (b), (c) and (d) as written; (e) before any pooling. [Verifier: (a)'s EU
  half departs from his answer, *"A notice with an opt-out"*, so it needs his word, not
  only the lawyer's. (g) should be answered before the first public-menu price counts
  toward class M.]
  - **[Research pass, 2026-09-18: the "ask a lawyer" gate should split by
    jurisdiction, not block as one item.** **Corrected, 2026-09-19: it does
    not split into anything to ship today, and two items it silently set
    aside are not droppable.** The ADR treats Q17(a)-(i) as one monolithic
    pre-pooling gate. The US and Turkish risk profiles differ in kind: the
    US risk (RealPage/AB 325/Connecticut HB8002) is well-documented, and the
    ADR's own aggregation guards (k=5, the 25% cap, no real-time/cost data,
    §9) already partially anticipate it. The Turkish risk (Law 4250 art. 6's
    advertising-and-promotion ban, extended to internet and digital
    platforms by a 2013 amendment, with a 2026 tightening bill pending) is
    old, broadly worded, and untested against a signed-out aggregate price
    page — the ADR's own price-sources research already flagged it
    "unverified at primary source" (`07-reference/price-sources.md:264-274`,
    mevzuat.gov.tr unreachable).
    **But no real US house exists to ship for.** Production (Supabase,
    2026-09-19, re-checked by direct SELECT, not carried forward): every
    non-Sim restaurant outside Türkiye is either 0 `users` rows or was
    already ruled not real in round 2 — Gullit's Tavern, Yaren's Fine Dine,
    Meyhouse Palo Alto and YARDOM (Q11, above, 0 users each, all US); YAREN
    and ALDEMIR (US, 2 and 0 users — YAREN's 2 do not change round 2's
    verdict); ADMIN ROOM (US, 1 user); and ADMIN 1, which round 2 grouped
    with these three test accounts despite its `country` field reading
    United Kingdom, not the US. Every restaurant row in production has
    `country` in {Türkiye, United States, United Kingdom} — no EU row exists
    either (checked for Q17(a), below). The only two houses with an
    independent signup and a confirmed operating business (Q11, above) —
    Chez Community and The Old House Pub — are **both in Türkiye.** A split
    that ships the US side unblocks nothing today, because there is no real
    US house on the other side of that gate.
    - *Full review before any pooling* (the ADR's literal reading, (a)-(i)
      in full) — 2-6 weeks plus fees, but today this is also, in practice, a
      review of one jurisdiction's law: Türkiye's, because every real house
      is there.
    - *Split by country, kept for later* — worth keeping as a design for
      when a real US house appears (so the US side need not wait on a
      Turkish lawyer once one does), but not something that unblocks
      anything now, and not a reason to treat (e) or (g) as optional.
    - *Ship now, fix later* — highest risk; AB 325 is named by multiple
      law-firm analyses (Q16, above) as reaching hospitality specifically —
      the statute's own text names no sector — and "models already trained
      are not retrained" (§14) makes this hard to undo regardless.
    - *Delay pooling everywhere, ship notice-only* — lowest engineering
      cost, and costs nothing extra today, since no real house's prices are
      pooling either way.
    **Recommendation: the full gate, (a)-(i), stays in force — for Türkiye,
    because that is the only jurisdiction with a real house today.** (e) a
    lawyer-drafted clickwrap Terms of Service at /register and (g) whether
    the 26 corpus and 41 laptop menus' already-held public prices may be
    pooled are not extra items a US/Türkiye split lets this ADR set aside —
    they are squarely in scope, because the houses that would trigger them
    are Turkish. Neither Turkish house (Chez Community, The Old House Pub)
    has an uploaded menu yet (`restaurant_inventory` shows 0 rows for both,
    checked 2026-09-18), so nothing pools before the lawyer answers
    regardless — gating costs nothing today, and the split-by-country design
    is worth keeping on paper for whenever a real US house appears, just not
    as today's unblock.
    **Q17(a)'s EU half, separately: still his to confirm, not the lawyer's.**
    His literal answer was *"A notice with an opt-out,"* with no EU
    carve-out (Q17 intro, above); the opt-in-for-EU half of this ADR's
    recommendation is the verifier's addition, already flagged there as
    departing from his words. No EU house exists today — every restaurant
    row's `country` is Türkiye, United States or United Kingdom (Supabase,
    2026-09-19) — so neither choice costs anything yet.
    - *Opt-in for EU (as currently recommended)* — matches the EU Data Act
      Art. 13 unfair-terms caution; departs from his literal words, for a
      jurisdiction with no house in it.
    - *Opt-out everywhere, as he said* — matches his answer exactly; leaves
      the Art. 13 question open until a lawyer looks, same as today.
    **Recommendation: ask, don't assume the departure.** The cost of asking
    is zero (no EU house exists yet), and CLAUDE.md §0.1 already governs
    this case directly: a drafted departure from his literal words is
    exactly the fork that gets asked, not defaulted.]**
  - **[DECIDED 2026-09-19, founder (`AskUserQuestion`, items 2 and 10 of 12).**
    **Item 2, his own words:** *"Ship now, fix later"* — against this section's own
    recommendation that the full (a)–(i) gate hold for Türkiye before pooling.
    **Item 10:** opt-in for EU houses, confirming the departure from his literal
    round-2 words that this section flagged rather than assumed. **What changes,
    and the full discussion of the consequence he was shown** (trained models are
    not retrained): recorded once, at §9's "Guards on pooling menu prices," not
    repeated here — this bracket is the pointer, not a second copy.]**
- **Q18 The uploaded menu PDFs.** "Quotes only" and "upload" pull in two directions.
  - (a) Keep the uploaded PDFs with a `retention_until` (for example, 90 days after
    /studio approves the menu), then keep only the quote, the hash and the date.
  - (b) Keep them for good.

  Also: may the 26 corpus PDFs be uploaded too? Their prices cannot be re-read for
  format without them. **Recommendation:** (a), and yes to the 26.
  - **[Research pass, 2026-09-18: the ADR's own "90 days" option contradicts a
    rule this repo already shipped.** `retention-rules.ts` (ADR 0118,
    `procurement_conversations`/`conversation_attachments`, deployed
    2026-09-05) states retention "must be tied to a stated purpose, never to
    a round number chosen for convenience," and calls a bare `RETENTION_DAYS
    = 90` constant "this repo's own named cardinal fault." The ADR's option
    (a) above is exactly that bare constant.
    - *Fixed 90-day window (the ADR's current (a))* — cheapest to build, but
      fails this repo's own retention test on its face.
    - *Keep forever (the ADR's (b))* — storage is trivial (Supabase:
      $0.0213/GB-month; the whole `vendor-attachments` bucket is 375kB
      today), but is unbounded retention of full copies with no stated
      purpose, including the 26 corpus PDFs from non-customer restaurants
      that §14's notice never reaches.
    - *Delete once re-extracted* — reuse the machinery already built for
      ADR 0118 (a derived, stated window; a scheduled sweep; a tombstone row
      keeping quote/hash/date while zeroing bytes). **Corrected, 2026-09-19:
      this defeats its own stated purpose, and mislabels who the PDFs
      belong to.** The purpose given above is "their prices cannot be
      re-read for format without them" — deleting the bytes right after the
      first re-extraction means the next prompt improvement cannot re-read
      the same menu without crawling it again, the exact failure the
      purpose clause exists to prevent. It also called the 41 laptop PDFs
      "customer PDFs" and would delete them "on §14 opt-out or churn" — but
      Q17(g), above, is explicit that the 41 laptop menus and the 26 corpus
      menus are *all* public menus of restaurants that are not customers,
      so §14's notice (which only a customer house acknowledges) reaches
      none of them, and neither trigger can ever fire. [Checked 2026-09-19:
      this retention recommendation relies on no case law. A prior draft of
      this note cited *Bartz v. Anthropic*; that citation is not carried
      forward here, and nothing in the recommendation above depends on it.]
    - *Keep until superseded (revised recommendation)* — keep each PDF's
      bytes while it may still need re-reading, and delete only when a
      newer crawl of that same restaurant replaces it, or — for the small
      set that ever becomes a customer's own menu — that restaurant objects
      under §14. This is the same ADR 0118 machinery; only the trigger moves
      from a one-shot re-extraction to "superseded or objected to," which
      `crawl_log` already carries the restaurant and fetch date to derive,
      rather than inventing a new signal.
    **Recommendation: keep until superseded**, not delete-once-re-extracted.
    No menu-PDF storage bucket exists yet (only `vendor-attachments`, 13
    objects/375kB, checked 2026-09-18), so nothing built needs to change to
    adopt this now.]**
  - **[DECIDED 2026-09-19, founder (`AskUserQuestion`, item 8 of 12): keep until
    superseded.** Not the fixed 90-day window (this repo's own named "cardinal
    fault," per `retention-rules.ts`/ADR 0118) and not forever. **What changes:**
    when a menu-PDF storage bucket is built, its retention job deletes a PDF's
    bytes only once a newer crawl of the same restaurant replaces it, or — for a
    house that becomes a customer — that house objects under §14; `crawl_log`
    already carries what that job needs. No bucket exists yet, so this fixes the
    design before the fact rather than changing running code.]**
- **Q19 Where the tasks run** [round 3, §11]. The connector design is the same under
  all three.
  - (a) **Local Cowork tasks on the laptop.** They need the app open and the computer
    awake. A missed night gets one catch-up on wake, and the measured record already
    has missed nights (09-06, 09-07, 09-17; fact 10).
  - (b) **Cloud Cowork tasks that use only the connector.** They run with the laptop
    off. They have no repo clone, which the design does not need, because the gateway
    serves the prompts and runs the code. This needs the PDFs uploaded (step 0.20).
  - (c) **A Claude Code cloud routine.** It clones `main` on each run, so the commit
    is recorded. Its minimum interval is 1 hour, and each account has a daily run cap.

  **Recommendation:** (b), with (c) only where repo code must run inside a task.
  [Verifier, 2026-09-18, pages re-fetched (fact 12). (b)'s "only the connector" is
  documented nowhere for a Cowork task: a scheduled task carries the account's
  connectors (/13854387), so on the founder's seat it holds only through Q20's
  dedicated seat. Cloud Cowork is in beta. (c) is the only option whose per-run
  connector list is documented (connectors can be removed per routine), but it has no
  permission-mode picker and is a research preview. None of this changes the
  recommendation if Q20 picks a dedicated seat.]
  **[ANSWERED 2026-09-18, founder via `AskUserQuestion`: "Claude's cloud
  (Recommended)" - option (b), cloud Cowork tasks that use only the connector. The
  41 laptop PDFs are uploaded first (step 0.20, his earlier "upload").]**
- **Q20 A dedicated seat, or the founder's own pool** [round 3].
  - **Shared.** The pipeline competes with his development sessions. On that basis the
    laptop tasks had 37 of 41 runs refused since 09-04 (fact 10). The old four, which
    run until cutover, draw on the same pool (§15 rule 7).
  - **Dedicated.** A separate account whose credits serve only the pipeline. Its
    connectors can be limited to the pipeline connector, so no task can reach the
    Supabase connector (§11). Its price was not checked; any figure would be from
    memory.
  - [Verifier, 2026-09-18] **What the shared seat also costs.** The pipeline's tasks
    read untrusted page text. On the founder's seat they would carry every connector
    on that account, including the Supabase connector's `execute_sql`, so the
    one-writer rule would rest on an unverified per-task limit (§11). Anthropic's own
    guidance is not to schedule tasks that can send messages, make purchases or take
    other hard-to-undo actions (/13364135).

  **Recommendation:** a dedicated seat before the first night. "Every wine from day
  one" cannot hold on a pool that refused 9 runs in 10.
  **[ANSWERED 2026-09-18, founder via `AskUserQuestion`: "Yes, a separate seat
  (Recommended)" - a dedicated account whose credits and connectors serve only the
  pipeline; he creates it (his keystroke).]**
  - **[Research pass, 2026-09-19: which Max tier funds the seat — raised as
    a residual under Q1 above, still open, not yet asked.** Max 5x is
    $100/mo; Max 20x is $200/mo for 4x the weekly usage window
    (support.claude.com/en/articles/11049741, fetched 2026-09-18). The
    backlog is 3,314 eligible wines (`master_wine_library`, re-measured
    2026-09-19, unchanged) sourced in one batch on the first paid night
    (Q1 (b), above) — the one night most likely to bind a weekly window,
    because it is the largest.
    - *Max 5x, $100/mo* — cheaper; if the window binds on the backlog
      night, the pilot shows that directly and the tier can be raised
      afterward.
    - *Max 20x, $200/mo (recommended)* — $100/mo more, sized for the one
      night that most needs headroom, instead of discovering the window
      binds by having it bind on the largest batch.
    **Recommendation: Max 20x**, and treat this as its own confirmation
    rather than folding it silently into "yes, a separate seat" — the tier
    is a monthly cost he has not yet been asked to accept.]**
  - **[DECIDED 2026-09-19, founder (`AskUserQuestion`, item 5 of 12): Max 20x,
    $200/mo.** Confirms the recommendation directly above, as its own accepted
    monthly cost, not folded into the earlier "yes, a separate seat" answer.
    **What changes:** he creates the dedicated seat at this tier (his keystroke,
    same as the seat decision itself); nothing else in the design changes.]**
- **Q21 Usage credits** [round 3].
  - **Off** (our reading of his words): a refused run stops and waits for the reset.
  - **On, with a monthly cap:** runs go on past the plan's limit, billed at standard
    API rates (about double the batch figures in Cost), so the limit is dollars again.
    Billed API use would also bring back the batch design at `056de928e` (§11).

  **Recommendation:** off until step 1.5 has measured what the plan covers.
  **[ANSWERED 2026-09-18, founder via `AskUserQuestion`: "Off until the pilot
  (Recommended)".]**
- **Q22 A house waiting at upload** [round 3, §11]. A scheduled task cannot answer a
  waiting person.
  - **Keep the existing synchronous read** on the API, billed, under its per-restaurant
    ceiling. It is the one billed model use left.
  - **Or the house waits** for the next task run, and the page says so.

  **Recommendation:** keep the synchronous read and count it apart. No real house
  exists yet, so it costs nothing today.
  - **[Research pass, 2026-09-18: confirms keeping the synchronous read, with
    the spend ceiling and usage measured.** The spend a real house could
    generate here is capped by the existing per-restaurant ceiling — a $5
    lifetime credit on the core tier, $5-10/day on paid tiers
    (`model-client.service.ts:628`, `spend-tiers.ts`), which fails open
    rather than blocking an upload. Production (Supabase, 2026-09-18): every
    non-simulated restaurant has 0 rows in `menu_items`; only "Sim Bistro" (a
    simulation) has any (342) — this path has never billed a cent against a
    real house. Making a house wait for the nightly batch instead would turn
    a new restaurant's first product interaction into a multi-hour wait, for
    a dollar cost currently measured at zero.
    **Recommendation: keep the existing synchronous billed read, counted
    apart from the plan-credit pipeline**, exactly as the ADR's own draft has
    it (above, this Q22's own pre-research recommendation). [Citation
    corrected 2026-09-19: the prior draft pointed at :1911, which is
    §11 step 0.21 (the pipeline connector), now at :2078 after this ADR's
    own later edits (recomputed 2026-09-21; was :2028, was :1928,
    was :1911) — an unrelated section, not this passage.] A cheaper
    sync model and a faster async queue are both worth
    revisiting once a real house's cost/latency is measurable — neither is
    justified pre-emptively against zero volume.]**
- **Q23 The account's training setting** [round 3]. The consumer terms let inputs
  train Anthropic's models unless the account opts out (fact 13), and house menus
  would pass through the tasks. Is training switched off on the account the tasks run
  under? That is his keystroke to check. Whether the notice must say so is Q17 (h).
  (That API inputs are not used for training by default is from memory and was not
  re-checked.) **Recommendation:** switch it off before the first real house's menu is
  read.
  **[ANSWERED 2026-09-18, founder via `AskUserQuestion`, his own words: "do not opt
  out yet" - training stays ON for the pipeline's account for now. Consequences: house
  menus passing through the tasks may be used to train Anthropic's models, so the
  house notice (§14, Q17 (h)) must say so while this holds; the question returns before
  the first real house's menu is read. He did not choose the lawyer review of the
  consumer terms' "develop or train ... models" clause offered in the same question; it
  stays in Q17 (i).]**

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
- The accuracy of MiniCheck and mDeBERTa on wine claims was never measured before
  round 5 replaced them with Jev (Q6). **Jev's own accuracy on wine claims is also
  unmeasured** — TYPESAFE_AI_OVERVIEW.md's benefits (§6) are vendor cookbook results
  in other domains (legal re-ranking, guardrails, RAG filtering), not a wine-claim
  or NLI/entailment benchmark, and no independent (non-vendor) benchmark of Jev was
  found in that crawl. **Jev's language coverage is unmeasured and unstated**, not
  merely unmeasured like the others in this list — the record consulted for this
  decision does not say which languages Jev handles at all, so Italian and Turkish
  coverage (§4 P7; Q6) is a named open item, not an oversight. The accuracy of the
  legacy identity columns, and whether Wikidata grape items carry a usable
  berry-colour statement, are also unmeasured.
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
- [Round 3]
  - **The answers.** They were relayed. Two readings are the relay's own (Q14's "which
    one is internal", Q1's "Cowork on plan credits, not billed API"). "Or rewards both"
    read as "or rewards, or both" is ours.
  - **Checked by this writer:** the evidence table's counts (81 runs; 37 of 41 failed
    since 09-04; the models per run), `harness.py:6-20`, and the four tasks'
    `permissionMode` in `scheduled-tasks.json`. Everything else in facts 10–13 is the
    lane's. No Anthropic page was re-fetched here.
  - **From the lane, not re-checked:** that Cowork's search takes no
    `blocked_domains`; the concurrency cap of about 2; that the laptop tasks share this
    account's pool (inferred from the reset anchor); the account's usage figures; the
    stuck rows' mapping to sessions; `egressAllowedDomains: ["*"]`; and which connector
    tools a run can actually call (one session showed 9 remote servers configured and
    some with 0 tools enabled).
  - **Unofficial:** that custom connectors take only OAuth, not a bearer header
    (github.com/anthropics/claude-ai-mcp/issues/112, a community report).
  - **Unknown:** whether cloud Cowork tasks can run repo code; whether Cowork can limit
    one task's connectors and tools; whether a Cowork task can be configured with Fable
    5.1; the Max plan's price; how many units a point of the weekly window buys.
    [Verifier, 2026-09-18, added:] whether web fetch can be switched off for a Cowork
    task; whether a Cowork task can read a menu PDF or page image returned by an MCP
    tool (P1/P2 in Cowork depend on it); where a custom connector's OAuth token is
    stored.
  - **Re-checked by the round-3 verifier (2026-09-18):** the run counts, error classes
    and models by recount of `cowork-wine-runs.tsv` (two corrections in fact 10); the
    four tasks' `permissionMode`, `approvedPermissions` and the one configured model in
    `scheduled-tasks.json`; `harness.py:1-22`; and nine pages re-fetched:
    code.claude.com/docs/en/desktop-scheduled-tasks and /routines;
    support.claude.com/en/articles/13854387, 13345190, 13364135, 11647753, 12429409
    and 11175166; anthropic.com/legal/consumer-terms. Each fact-12 and fact-13 claim
    holds as written, with the additions marked "verifier" there. Not re-checked:
    everything under "From the lane" above.
  - **From memory:** how the Supabase connector's `execute_sql` authenticates (a
    Management API token, wider than a service-role key); that API inputs are not used
    for training by default.
  - **Could not read:** `list_task_runs`, because this session's scheduled-tasks tool
    sees the other org (`03017808`) and lists 0 tasks. The local session files were
    read instead.
  - **Not built, and no CLAIMS row.** Nothing was built or run, and no Cowork task was
    created or changed. No CLAIMS row was added: the round-3 facts live in laptop
    session files and Anthropic pages, which the claims job cannot read.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-18 | Research workflow: six lanes, three candidates, judge, two adversarial passes | Created as Proposed. Of the 30 required changes, 28 are applied in full; B3's column repair is rejected with its reason; A11's re-scoping of identity rows is left out, with its reason |
| 2026-09-18 | Completeness critic (workflow agent) | 14 fixes, each marked "critic" in the text. (1) P4's combined INSERT-or-UPDATE trigger could not be created, and is now two triggers. (2) Costs are recomputed with their inputs, the N = intake line is added, and Q1/Q5 no longer cap quality by spend (F1). (3) P1 extraction defaults to Opus 5 (F1). (4) Hi-Time's terms were read: silent, not permissive; step 0.9 now covers it. (5) Health gains all-eligible coverage, a zero-yield run rule and a trigger-miss rule (F2). (6) The view never shows legacy profile fields. (7) The laptop-copy admission rule now checks terms. (8) Step 0.1's check no longer relies on quiet tables. (9) "Writing every night" was corrected against production. (10) Line citations shifted by the foundations edits, `.gitignore:87`→`:92` and `0130:108`→`:109`, were fixed. (11) Q7 was reframed as the legal remainder of F2, and its OSM contradiction removed. (12) Q11 now asks which of the four May houses are real. (13) The P7 same-family judge is no longer counted as independent. (14) A11 is marked partial |
| 2026-09-18 | Round 2: the founder's answers (three AskUserQuestion batches) plus two research lanes (/studio; menu prices and the notice) | Still Proposed. Answers recorded as relayed, with readings marked. Q1, Q3, Q4, Q5, Q7, Q8, Q9 and Q12 are now decision text; Q6 and Q11 in part; Q2 was not answered in the form asked. §9 rewritten around menu prices (class M); §13 /studio review, §14 notice and opt-out, §15 two writers until cutover added; sourcing and `wine-worker` moved into Stage 1; costs recomputed for every wine sourced; step 0.3's count corrected from 3 to 8 (four "Sim " rows, not three); steps 0.17–0.20, 1.10 and 1.11 added; Q13–Q18 raised |
| 2026-09-18 | Round-2 verifier (workflow agent): the diff against 795e8073a; quotes compared by script; every /studio, loader, parser, settings, Stripe and registry citation re-read; production SELECTs on `restaurants`, `restaurant_inventory`, `user_roles`, `users`, `invite_tokens`, `override_events`, the submissions table, the price and menu tables, and `data_enrichment->'menus'`; both cost scripts re-run | Answers verbatim (P and R match the relay character for character) and readings marked. Fixed, each marked "verifier" in the text: (1) three role-holding accounts, not two people (fact 6, §13, Consequences, Q4); (2) live-row `review_status` added; (3) the 7-menu rows are not live; (4) "by file name" city claim; (5) fact 8's heading over-read a usage-telemetry line; (6) the notice promised that a house's prices never appear, which a median breaks (§9, §14, Q16 (f)); (7) "nothing already held needs consent" was a legal conclusion (§14, Q17 (g)); (8) "required by Law 4250" was a legal conclusion (§9, Q17 (f)); (9) the estimate cannot pass its held-out test until at least 16 wines have a list price, and today none has at k = 5 (§5, §9, Consequences, Q16 (g)); (10) the estimate's label now says restaurant listings, so it cannot read as a shop price; (11) "re-scope N" on a cost overrun would have let cost undo *"Every wine from day one"* (Consequences); (12) the backlog now starts on the first paid night, staged, instead of after the audit, and its pace is Q1 (b); (13) Q15's "for speed" recommendation is tied to a measured bar under F1; (14) Q2 names the reading of "check their values" that would point to (a); (15) §15 rule 7's "another org" was unbacked; (16) §13's promotion rule marked as open (Q15); (17) the ROADMAP citation for "sommeliers/producers" added. Costs re-derived: every round-2 figure reproduces from `every-wine-cost.py` and `critic-cost-model.py` |
| 2026-09-18 | Round 3: four founder answers (AskUserQuestion, relayed) plus one host research lane (Cowork, routines, usage limits, the terms, and the laptop tasks' 81 runs) | Still Proposed. The answers are recorded verbatim as relayed, with each reading marked as the relay's or ours. Answered: Q1 in full (plan credits, no dollar limit), Q2 as (b), Q14's direction and Q15's rule. §11 is rewritten as "Hosts and credits". Model work runs as Cowork tasks with repo-served prompts. The gateway stays the only writer and keeps health, enqueue and the publish gates, through a pipeline connector that can only stage. Credits set the pace, never the bar, and claims are served in a stated order. Amended: §3, §4, §5, §6, §8, §12, §13, §15, Consequences, Build order (0.21 and 0.22 added; 1.1 replaced; 1.2 set aside; 1.5, 1.8, 1.10 and Stage 3 amended) and Cost (now the API-equivalent size, not a bill). Facts 10–13 added. Q17 (h) and (i) and Q19–Q23 raised. The earlier §11 is kept at `056de928e` |
| 2026-09-18 | Round-3 verifier (workflow agent): the diff against 056de928e; the four answers compared with the relay; `cowork-wine-runs.tsv` recounted; `scheduled-tasks.json` and `harness.py` re-read; nine Anthropic pages re-fetched | Answers verbatim and readings marked; every fact-12 and fact-13 claim holds. Fixed, each marked "verifier": (1) fact 10's model history omitted the return to Haiku (9, 24, 13, 35 runs); (2) 09-11 lateness was 15 minutes to 2.3 hours, not 1 to 2.5; (3) the concurrency inference has a counter-sign (a non-wine task started at the same second); (4) the Desktop-tasks page documents Claude Code's local tasks, not Cowork's; (5) Cowork egress settings do not bind web fetch, web search or MCPs, so the never-list cannot be enforced inside a task (fact 12, §4 P5, §8, §11); (6) the connector's reach was attributed to where its token is held; the tools are the boundary; (7) "never runs SQL" would have failed `submit` and step 0.21's guard; (8) on a shared seat a task reading untrusted pages carries the Supabase connector, so the one-writer rule depends on per-task limits (§11, Q20); (9) a routine has no permission-mode picker (§11, Q19); (10) the outside dead-man alarm was listed on the gateway; (11) §6 put batch rules on the synchronous path; (12) `lease_expired_unsubmitted` is never green, and "a lease expired" stays red; (13) task identity and model are self-reported; (14) "with nothing submitted" ignored part-submitted runs; (15) a host that cannot run gold's model goes to the founder, never a quiet fallback; (16) /studio "shows no pay or reward terms" was wider than either reading; (17) usage credits are off today, not off by decision; (18) what a stale cell shows while P11 waits for credits is unspecified, flagged open. The brief's pause order read backwards and was fixed |
| 2026-09-19 | Round 4: research pass across Q6, Q10, Q11, Q14, Q15, Q16, Q17 (incl. (a)'s EU half), Q18 and Q20, plus §13/step 0.17's tech-debt wording, three new CLAIMS.jsonl rows and a citation sweep, corrected against an Opus adversarial pass | Still Proposed. Fixes, numbered: (1) Q6 — mDeBERTa's own model card names the same ANLI/CC BY-NC lineage as MiniCheck, so the ADR's fallback did not clear the licence risk; HHEM ruled out as English-only; mDeBERTa stands, with the licence question folded into Q17's lawyer gate. (2) Q10 — the sparkling/rosé conflation measured, not asserted (53 of 369 sparkling rows and 1 of 115 rosé rows cross colour and effervescence); revised to colour × style {still, sparkling, fortified} with sweetness kept separate, then corrected to state this is the ADR's original three axes, not two — the :812 rule (was :784, was :723; recomputed 2026-09-21) binds only `primary_type`, because that is what feeds `beverage_kind`, not a separate sweetness cell. (3) Q11 — the four presumed-test houses' zero-user count re-confirmed by direct SELECT (all four, not three, as the prior count had it); the two presumed-real houses' independent signups and operating businesses cited. (4) Q14 — form (rewards, cash later) and structure (points per verdict recorded, against a flat stipend and a per-hour rate) resolved; the rate itself stays parked on OD-23, re-confirmed still unstruck. (5) Q15 — named D-12's current "5 in a row" as a third baseline option, measured at about 0.57 agreement; the existing recommendation needed no fresh pass. (6) Q16 — confirmed k=5 over k=3 (0 vs 9 qualifying wines today) against a regulatory direction that has only tightened since the ADR's own citations (DOJ's RealPage settlement, AB 325, Connecticut HB8002). (7) Q17 — the lawyer gate does not split by jurisdiction today because every real house is Turkish, re-confirmed by a SELECT joining `restaurants` to `users` (corrected: YAREN 2 users and ALDEMIR 0, not the reverse); (a)'s EU opt-in half flagged as the verifier's own departure from his literal words, to be asked, not assumed. (8) Q18 — retention revised to keep-until-superseded, reusing ADR 0118's machinery; corrected to state plainly that this recommendation relies on no case law, and that a prior draft's citation to *Bartz v. Anthropic* is not carried forward. (9) Q20 — Max 20x named as its own confirmation, not folded into the separate-seat answer. (10) §13/step 0.17 — the tech-debt filing corrected: the register's deletion is a real founder decision (2026-09-19), reserved as ADR 0165 but not yet written, so the three broken /studio promotion paths are filed as three open `CLAIMS.jsonl` rows instead of a `v3.0-TECH-DEBT.md` entry (`ADR-0163-STUDIO-PROMOTE-DIRECT-INSERT`, `-OVERRIDE-AUTOPROMOTE-SELECT`, `-QUALITY-PATCH-SELECT`). (11) Citations repaired: :2235-2238 (was :2177-2180), :2210-2214 (was :2152-2156), Q1's cross-reference to the round-3 review-trail row (now :3012, was :2981, was :2489), and Q22's stale :1911 (now read against :1928, where step 0.21 sits today). [Round 5, 2026-09-19: every one of these shifted again by round 5's insertions and was recomputed a further time: :2352-2355 (was :2235-2238, was :2177-2180); :2327-2331 (was :2210-2214, was :2152-2156); the round-3 review-trail row at :3235 (was :3012, was :2981, was :2489); step 0.21 at :2028 (was :1928, was :1911). See each Q-block's own DECIDED bracket for the live number; this row keeps round 4's own account of what it repaired, unedited otherwise.] [Correction pass, 2026-09-21: shifted a further time by this pass's own insertions, made to close round 4's four-item must-fix list against round 5's draft: :2402-2405 (was :2352-2355); :2377-2381 (was :2327-2331); the round-3 review-trail row at :3290 (was :3235); step 0.21 at :2078 (was :2028). Again, see each Q-block's own DECIDED bracket for the live number; this row still keeps round 4's own account of what it repaired, unedited otherwise.] Re-checked: Supabase SELECTs on `master_wine_library` (`primary_type` spellings, sparkling/rosé name-matches, fortified/dessert counts), `restaurants` LEFT JOIN `users`, `restaurant_inventory`, `user_roles`; `OPEN-DECISIONS.md`'s OD-23 row; `studio_routes.py`, `override_service.py` and `quality_routes.py` against every migration touching `master_wine_library`/`master_wine_library_submissions`; `retention-rules.ts` (ADR 0118); `docs/retire-tech-debt`'s commit log; HuggingFace model cards for mDeBERTa, MiniCheck, Bespoke-MiniCheck and HHEM; support.claude.com's Max-tier pricing pages |
| 2026-09-19 | Round 5: the founder's twelve answers (`AskUserQuestion`, relayed via session memory `founder-sketch-decisions-106-115.md`) to every question round 4 deepened, a claim-checker reversal to TypeSafe AI's Jev, and a full self-citation re-sweep | Still Proposed. Each of the twelve is recorded as a DECIDED bracket at its own Q-block (Context, "Round 5" carries the summary table with the this-ADR-question ↔ memory-item-number mapping); item 2's *"Ship now, fix later"* is taken against this ADR's own recommendation, with the shown-and-accepted consequence recorded at §9 ("models already trained are not retrained"); item 4's *"we're gonna use JEV and it's already inside the repo"* replaces §4 P7(b)'s self-hosted MiniCheck/mDeBERTa design with TypeSafe AI's Jev, a hosted API (prior design kept at commit `a99078485` for history) — the MiniCheck/mDeBERTa/HHEM comparison in Q6's own research pass is shrunk to a pointer, which is this addition's retire-to-write for `07-reference/TYPESAFE_AI_OVERVIEW.md` (copied into this branch byte-identical to the main checkout's untracked source, `diff` confirmed; its `INDEX.md` row replicated byte-identical to the main checkout's uncommitted diff, `diff` confirmed; neither file in the main checkout was touched). Jev's language coverage for Italian and Turkish is not stated in that record, so it is carried forward as its own open item (§4 P7, "Not verified") rather than assumed either way, backed by a new CLAIMS.jsonl row (`ADR-0163-JEV-LANGUAGE-COVERAGE-UNSTATED`, status open, mutation-tested: flips to matching when the record is edited to state coverage, confirmed by temporarily adding such a line and restoring it byte-identical). Amended: the status block and Decider line; Context (Round 5 section added); §4 P7 (rewritten around Jev); §9 (legal-review/EU DECIDED bracket); the `wine-worker` build-order row; adversarial-table row A16; Cost's "not included" line; the four top-level recap brackets for Q2/Q6/Q10/Q11; all eleven deep-dive Q-blocks carrying an answer (Q2, Q6, Q10, Q11, Q13, Q14, Q15, Q16, Q17 ×2 (legal review and its EU sub-fork), Q18, Q20); "Not verified" (Jev's own accuracy and language coverage named); and this Review trail. Every pre-existing self-citation whose target moved because of this round's insertions was located by content match in the edited file (not carried forward by arithmetic alone) and recomputed, each keeping a "was :N" trail; round 4's own review-trail row above is left as its original text with a dated bracket appended naming the further shift, per the house rule that records are corrected in place with dated brackets, never silently rewritten. Guards re-run and green: `scripts/check_decision_claims.sh` (359 `CLAIMS.jsonl` rows, 358 checkable claims after the one `_comment` line, all 358 holding — this run also covers the bundled OD-id-collision and migration-version-collision checks, both clean) and, run separately for the same corpus, `scripts/check_adr_numbers_unique.py` (930 refs after this round's own edits added a few, no collision) and `scripts/check_od_ids_exist.py` (1,412 documents against 118 register rows, PASS). No OD row, ADR number or migration was added by this round. Not done: propagating the twelve answers into every Build-order step, Cost-table figure or CLAIMS row their design implies beyond the sections named above — each DECIDED bracket states what changes, but turning that into code (a `wine_type`/`sweetness` migration for Q10, a Jev API client for Q6, the six houses' `is_simulation`/real-house flags for Q11, and so on) is separate build work this docs-only round does not do |
| 2026-09-21 | Correction pass: round 4's own last-call must-fix list against round 5's draft (four items), run before this branch's commit | Still Proposed. Closes all four, none found already-fixed or aimed at the wrong target. (1) The Q11 DECIDED bracket's arithmetic was wrong: it said flagging the four confirmed-not-real houses made "eight rows... not four", but step 0.3 already flagged eight (the four "Sim " rows plus YAREN, ALDEMIR, ADMIN 1, ADMIN ROOM) before this answer. Corrected to twelve of the 14 `restaurants` rows (Context, fact 9); step 0.3 itself gains a dated round-5 bracket recording the same count. (2) The closure overclaim in the status block, the Decider line and the "What this settles" paragraph — each said round 5 closed every question but Jev's language coverage — is corrected in all three: the ADR's own text already left four more things open (Q14's reward *structure*, Q11's stuck `research_runs`/registry rows/`pg_cron`, Q22 never put to him, the Jev-in-§14-notice fork noted but not asked), so each is now named, and "What this settles" is expanded to explain all of them plus the new Pre-pool ToS fork below. (3) §4's round-3 stage-map bracket still read "P7(b) and P12 on `wine-worker`"; round 5 had already moved P7(b) to a gateway call to Jev in §11's `wine-worker` row, but neither the §4 intro bracket nor §11's own Gateway row said so — both gain a dated round-5 bracket, and the Gateway row now names the Jev call directly. (4) *"Ship now, fix later"* (Q17, §9) was never carried into three texts that still gated pooling on a lawyer: §14's "Before any pooling" list, the Consequences line and step 0.18's "lawyer-drafted clickwrap" bullet. Each gains a dated round-5 bracket stating that the order changed under Q17's answer and that whether a non-lawyer Terms of Service still gates pooling is its own open founder question ("Pre-pool ToS"), not decided here. Every self-citation whose target moved because of these insertions was re-located by content match against `git show HEAD` (not carried forward by arithmetic) and recomputed with a "was :N" hop appended to its existing trail; round 4's own review-trail row is again left as its original text, with a second dated bracket appended alongside round 5's, per the same house rule that records are corrected in place, never silently rewritten. Guards re-run and green: `scripts/check_decision_claims.sh` (358 checked, 358 holding, unchanged — no CLAIMS.jsonl row was touched this pass); `scripts/check_adr_numbers_unique.py` (1,045 refs checked, no collision, 0163 the only number this document introduces); `scripts/check_od_ids_exist.py` (1,412 documents against 118 register rows, PASS, the same 2 known absorbed-merge notices); `scripts/check_citation_pairing.py` (179 register citations against 119 rows, PASS — unaffected, since none of the citations touched this pass are `OPEN-DECISIONS.md` register citations); `scripts/check_no_conflict_markers.py` (1,450 planning documents, PASS). No OD row, ADR number, CLAIMS row or migration added or changed. None of the founder questions this pass surfaced or left open (Q14's reward structure and rate, Pre-pool ToS, Q22, Jev-in-notice) is answered here — each stays exactly as open as it was, for the founder to decide |

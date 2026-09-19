---
type: reference
title: Wine intelligence foundations — what the library holds, where it enters, and the schedule it needs
status: proposed
updated: 2026-09-18
links: ["[[0163-the-wine-library-is-a-ledger-of-cited-or-labelled-statements]]", "[[0048-domain-quant-under-research-math]]", "[[0020-no-fabricated-answers]]", "[[0124-a-bottle-has-one-identity-and-every-price-names-it]]", "[[0130-a-generic-name-stays-the-venues-own-wine]]", "[[0117-a-price-sighting-names-its-source-its-date-and-its-unit]]", "[[0145-mudavym-answers-out-of-a-reading]]", "[[0143-the-arrival-the-desk-the-sommelier-and-the-two-rooms]]", "[[BEVERAGE_CATALOGUE_ARCHITECTURE]]", "[[wines]]", "[[corpora-enrichment-schedule]]"]
---

# Wine intelligence foundations

**A structure plan. Nothing was built, and no job was created, enabled or run.**
It records what the wine library holds, whether the pipeline that fills it works,
what runs on a schedule, where library data should enter the product, and the
order of the owed work. It does **not** design the ML system: the founder asked
for foundations only, with detail left to later sessions.

[2026-09-18, after this document was written: the founder answered forks F1–F5 the
same day, and the pipeline design those answers call for is proposed in
[ADR 0163](../decisions/0163-the-wine-library-is-a-ledger-of-cited-or-labelled-statements.md)
(Proposed; the founder locks it). This document stays the measured foundations plan;
the design, its stages (P1–P13) and its build order live in the ADR. Each fork below
is marked where it is listed.]

[2026-09-18, round 2: the founder then answered most of the ADR's own questions,
and three new ones: a data notice, Serper, and shop prices. ADR 0163 records his
words as relayed, marks its readings, and lists what is still open. Four answers change
how this document reads:

- **Review.** It happens in /studio: developers approve each menu's extracted wines,
  and sommeliers approve and add. Studio's promote path cannot write today (§2 item 4).
- **Market price.** It comes from restaurant menu prices, and no real house has a menu
  price in production (§3 S6; ADR 0163 §9).
- **"Stocked".** No house that stocks a wine is real, so "stocked" in this document
  means held by simulation or test houses (the definition below; ADR 0163 §2).
- **The laptop tasks** run until the repo pipeline runs (§3; ADR 0163 §15).]

What the founder asked for on 2026-09-18, as relayed to this session: the library
"has already a lot of value" (taste notes, vintage, country), and where a value is
missing the page should say "analytics coming soon" or leave the section out; the
300-plus insight types "must already be integrated with the ML data"; the one-sentence
wine description should be composed from the profile or the library, and "if it's not
there and we have that wine available, that means our pipeline is broken somewhere".
He then added: "continue the wine pipeline check and ML foundations document +
scheduled works for wine extraction".

**How it was measured.** Every production figure is a read-only SELECT on
`exzueerziesmczwlhomd`, run 2026-09-18. The queries are in the appendix (F-A to F-E).
Code citations are to `origin/main` @ `09190ee50`. **live** means `deleted_at is null
and superseded_by is null`. **stocked** means a distinct `master_wine_id` on an
active, undeleted `restaurant_inventory` row: 173 wines on 175 lines. [Round 2,
2026-09-18: every one of the 175 lines belongs to one of seven houses, one line per
wine in each (verifier SELECT; the draft said eight houses). Eight rows are named
below, and one of them holds nothing.

- **Simulation rows (four):** Sim Bistro 81, Sim Meyhouse `a229f22b` 53 and Sim
  Vanilla Kaleiçi 27 hold stock. The fourth, a second Sim Meyhouse (`aaecdb17`),
  holds none.
- **The four May houses:** ADMIN ROOM 10, ADMIN 1 2, YAREN 1 and ALDEMIR 1. The
  founder ruled that none of them is real.

So no real house stocks a wine today (production SELECT on `restaurants` and
`restaurant_inventory`; ADR 0163 Context, fact 9).]

## Retire-to-write

- **Supersedes** [`BEVERAGE_CATALOGUE_ARCHITECTURE.md`](BEVERAGE_CATALOGUE_ARCHITECTURE.md)
  §9–§10 (its ML-readiness text). A dated banner there points here. That doc remains the
  identity contract. Rules from it that are still true are carried forward here by
  citation, not copied: one write model with disposable read models (§9.1),
  provenance on every ML feature (§9.3 item 1), stable `id` join keys (§9.3 item 3),
  one grain per question (§9.3 item 4), and the M1–M6 premortem (§10.6). Three of its
  statements are corrected below:
  - §10.4 said `embedding` was empty. It is on 3,430 live rows.
  - §10.3 said the typed sensory columns were empty. They are now generated columns
    (`20260818030000_sensory_columns_generated.sql`).
  - §9.3 item 2 said observation time was not captured. `enrichment_observed_at` now
    exists (`20260817010000_enrichment_observed_at.sql:29-57`). It is a *last-changed*
    stamp, overwritten in place, so it keeps no history of earlier observations.
- **Absorbs** the "Recurring work" table of
  [`corpora-enrichment-schedule.md`](../01-org/platform/data/teams/corpora-enrichment/corpora-enrichment-schedule.md).
  That file must stay because the unit's 9-artifact set is fixed (ADR 0034). Its table
  now points to §3 below.
- **Cites and does not replace:** `BEVERAGE_CATALOGUE_PLAN.md`, `PRODUCER_REPUTATION_PLAN.md`,
  `MENU_EXTRACTION_SCALE_PLAN.md`, `ANALYTICS_FEATURE_CATALOG.md`, `FOOD-REASONING-GRAPH.md`,
  and `DISH_IDENTITY_DESIGN.md`. Wine ML belongs inside ADR 0048's layer frame and not
  beside it. The library profile describes the product, which is L0, "Identity and
  units" (`FOOD-REASONING-GRAPH.md:60`). Demand and decision models (L4 and L5) read it,
  and L6 validates them.

---

## 1. What the library holds today, by feature family

Source: query F-B. The live base is 3,589 rows (3,511 wine and 78 `unknown`). The
stocked base is 173.

| Family | Production fields | Live (3,589) | Stocked (173) | How it got there |
|---|---|---|---|---|
| Identity | `name` · `producer` · `vintage` | 3,589 · 3,540 · 3,118 | 173 · 124 · 120 | Taken from menus and the seed. `canonical_name_verified` is true on 3 rows |
| Origin | `country` (not 'Unknown') · `region` · `sub_region` · `appellation` | 3,498 · 3,542 · 2,420 · 2,259 | 95 · 132 · 14 · 13 | Menu text plus model inference |
| Grape | `grape_variety` | 3,514, of which 867 are the string 'unknown' (F-C) | 107 | Menu text plus model inference |
| Structure | `wine_structure` (body, sweetness, acidity, tannins, texture, finish, alcohol_level, alcohol_pct) | 3,346 | **13**, of which **7 are a copied template** | Two sources (F-E). 3,146 rows come from the hand-run Haiku backfill of the menu corpus. 200 come from the February seed: `services/database/import_master_wine_library.py:93` loaded `library/wineops_basic_v1.jsonl` on 2026-02-01. **44 of those 200 carry one copied light-sparkling profile** (light, dry, high acid, no tannin, crisp, short), and 37 of the 44 are red wines, among them a 2009 Château Latour. The seed file has the same 44 rows. 39 of them are the Facchin-producer rows; their producer was repaired on 2026-08-18 (`producer-canonicalization-stage2`, `wine_repair_log`), but their structure was not. 11 of the 13 stocked profiles come from this seed, and 7 of them are the template |
| Aromas and flavour | `sensory_profile` (three aroma tiers, `flavor_profile`) | 3,346 non-empty (F-C) | **14** | Model inference |
| Palate prose | `sensory_profile.palate_description` | 136, of which 133 are `template_based` | **3** (template) | Template text from the 200-wine seed. **It is not a tasting note.** |
| Tasting notes | none: production has **no `tasting_notes` column** (F-D probe returned 0) | — | — | Absent from every source. The evidence gate requires a real taster to be quoted (`20260826175836_evidence_gate_v1.sql:97`) |
| Serving | `serving_temp_celsius` · `glass_type` · `decanting_recommended` | 3,266 each | **7** | Model inference. No `field_confidences` key covers it |
| Ageing | `aging_potential_years` · `aging_vessel` | 3,266 · 2,765 | 7 | Model inference. `aging_vessel` uses more than one spelling for the same value ('oak' and 'French oak') |
| Quality tier | `quality_classification` jsonb (`quality_level`, `producer_tier`, `vintage_quality`) | 3,346. `vintage_quality` is 'Unknown' on 3,271 | 13 | Model inference. The typed columns `quality_level` and `vintage_quality` are 0 |
| Producer narrative | `producer_story` · `producer_bio` · `historical_notes` · `producer_details` | **0** | **0** | Never loaded. `producers` has 0 rows (F-D). The research behind `PRODUCER_REPUTATION_PLAN.md` (614 producers) was never loaded. `library/restaurant_wine_dataset.jsonl` holds 104 producer stories, 65 of which are not the Facchin copy; the seed importer never read that file (F-E) |
| Critic scores and awards | `critic_scores` · `professional_ratings` · `rating_*` · `awards` | **0** | **0** | — |
| Market price | `retail_price_avg` · `market_value` · `market_data` | **0** | **0** | — |
| Menu price seen | `price_reference` > 0 | 3,345 | 14 | The price a menu printed. It is not a market price |
| Stated strength | `abv_percent` | 0 | 0 | 0 by design: only a person may state it (`20260906120000_a_strength_is_stated_by_a_person.sql`) |
| Vector | `embedding vector(384)` | 3,430 | **14** | `scripts/populate_embeddings.py` (MiniLM, 384 dimensions). **Nothing reads it** |
| ML slots | `ml_derived_features` · `ai_agent_features` | 0 | 0 | — |

**Provenance** (F-B). `data_enrichment.knowledge` is one flag per row, not per field.

| Provenance | Live | Stocked |
|---|---|---|
| `known`: the model recognised this bottling | 432 | **0** |
| `inferred`: a typical profile for the grape and region | 2,773 | 7 |
| `sourced`: cited through `evidence_citations` | 3 | 0 |
| `unknown` | 68 | 0 |
| No flag at all | 313 | **166** |
| `review_status = approved` | 3 | 0 |
| `field_confidences` present (8 keys: appellation, region, country, primary_type, wine_structure, grape_variety, quality_classification, sensory_profile) | 3,276 | 7 |

The library is rich where nobody stocks it. Of the 3,276 live rows that carry a
knowledge flag, 85% are `inferred` (2,773). On the wines houses actually hold, the
profile is almost entirely absent: 166 of the 173 carry no flag at all.

**Who holds the stocked wines** (F-E). 161 of the 173 are held only by the three
simulation houses, whose names begin "Sim " and which were created 2026-09-03..05. Of
those 161, 1 has a profile. The other 12 are held by four houses created 2026-05-09..12,
which have no POS checks. All 12 have a structure profile, but 7 of the 12 are the
copied template described above. So a page reading the profile today would show
nothing for the simulated houses. For the other four houses, it would show a
light-bodied, tannin-free Latour.

## 2. Pipeline check: the verdict

**Broken.** It is not one bug. **No running process enriches a library row after the
row is created.**

- Every live row created on or after 2026-08-17 has neither a profile nor an embedding.
  There are 159 such rows: 81 `sim` and 78 `menu_import`, and 0 of the 159 have either
  (F-A).
- **Those 159 are 159 of the 173 stocked wines (92%).** Of the 173 stocked wines, 13
  have a structure profile, 3 have palate text (template-based), 0 have producer text,
  and 0 are `known`. **7 of the 13 profiles are the copied template (§1)**, so only 6
  stocked wines have a structure that is plausible for the wine.
- All 159 unprofiled September rows are held only by the three simulation houses (§1).
  The 81 `sim` rows came from the sim seed. The 78 `menu_import` stubs came through the
  gateway's own create path, the one a real house's menu import takes
  (`wine-submissions.service.ts:505, :835`). So the fault is not specific to
  simulation.
- The last write to any live library row was 2026-09-05 17:50Z.
- **The founder's test, applied directly: a field present in the source but absent in
  production, for a stocked wine** (F-E). The stocked "2018 Fekete Bela Furmint" is
  `WINE_022` in `library/restaurant_wine_dataset.jsonl`. That record carries
  `producer_details.producer_story` and `practical_attributes.serving_temp_c`, but in
  production the row's `producer_story` and `serving_temp_celsius` are both null. The
  stocked "2019 Capture Napa Valley" (`WINE_103`) is the same: the source has a serving
  temperature and a glass, and production has neither. The source holds 104 producer
  stories, 65 of which are not the Facchin copy. Production holds 0. The importer that
  loaded these wines read the thinner `wineops_basic_v1.jsonl`, so the richer file was
  never loaded.

By the founder's own rule, the pipeline is broken. For 160 of the 173 wines houses hold,
the one-sentence description has only identity fields to draw on (producer, vintage,
region), because there is no profile: 159 September rows plus one `menu_corpus` row.
For 7 more, the profile it would draw on is wrong.

Where it breaks (each point cited, none fixed here):

1. **Creation hands nothing to enrichment.** The gateway creates identity-only stubs in
   `resolveOrCreateLibraryWine` (`wine-submissions.service.ts:424`, reached from
   `inventory.service.ts:1157`) and in `resolveLibraryWinesBatch` (`:722`, reached from
   `menus.service.ts:321`). `identity.service.ts:662` `createLibraryRow` creates rows
   too. None of the three enqueues anything. The only enqueue writer is
   `scan_routes.py:71` into `enrichment_queue`, and it inserts columns the production
   table does not have. The table has 0 rows (F-A), and nothing reads it.
2. **Every scheduled enrichment job is dead code** (§3). The orchestrator image runs
   uvicorn only (`services/agent-orchestrator/Dockerfile:33`), and no deploy file
   declares a Celery worker or beat.
3. **Research cannot reach the stubs, even when enabled.** `research_eligible_submissions()`
   selects from submissions joined to the library (`20260813170000_enrichment_demand_priority.sql:81-82`).
   All 78 `menu_import` stubs lack a submission (F-D), and the function returns 0 (F-A).
   Four `research_runs` rows are stuck at `running`, the oldest since 2026-09-02 (F-D).
   Two of the four have a `completed_at` and still read `running`, so the writer never
   closed them.
   Both `dispatch_batch` (`research_tasks.py:1675`) and `POST /research/trigger`
   (`research_routes.py:556-562`, which answers 429) refuse to start while any such row
   exists.
4. **The write paths that lead into the library would fail.** Four
   `master_wine_library` inserts write columns production lacks:
   - `override_service.py:443` and `quality_routes.py:401` write `tasting_notes` (at
     `:427` and `:384`);
   - `studio_routes.py:1060` writes `tasting_notes` (at `:1044`);
   - `wine_research_service.py:363` writes `critic_score` (at `:375`).

   The event chain has three more faults:
   - `ontology_tasks.py:190-191` passes a submission id where a library id is expected.
   - `dataset_ingestion_service.py:43` indexes `parents[3]`, which is too deep for the
     image's `/app` layout.
   - `haiku_tasks.py:111-123` updates `enrichment_source`, `ai_enriched` and other
     columns that `master_wine_library_submissions` does not have.

   None of these was executed: the column mismatch was read from `information_schema`,
   and the parents[3] fault was reproduced only on a path model.

   [Round 2, 2026-09-18: the Studio promote path is worse than one column.

   - **Promote.** It inserts six columns production lacks (`price`, `price_glass`,
     `color`, `sweetness_level`, `tasting_notes`, `description`;
     `studio_routes.py:1031-1048`), and its retry drops only the three audit columns
     (`:1064-1072`). So every promote fails. No library row has source
     `studio_promotion`.
   - **Override and quality.** Both paths select enrichment columns the submissions
     table lacks (`override_service.py:356-360`, `quality_routes.py:205-210`).
     Promotion also needs a `pending_review` status that no submission has (92
     `accepted`, 1 `pending`).
   - **The fix.** /studio is the review surface the founder named, so ADR 0163 §13 and
     step 0.17 retire these direct inserts in favour of its publish RPC.]
5. **The page could not show a profile even if one existed.** `mapWine`
   (`wines.service.ts:147-214`) is the only projection of the library to any page, and
   it sends no structure, aroma, serving, ageing or quality field. It reads
   `tastingNotes` from a column that does not exist (`:172`) and `description` from
   `producer_story`, which is 0 of 3,589 (`:171`). It does carry one row-level
   provenance block (`knowledge`, `fieldConfidences`, `observedAt`) when those columns
   are selected (`:195-212`). The contract in §4 can grow from that block. The inventory read embeds
   `master_wine_library(*)` and then deletes it (`inventory.service.ts:103`).
6. **Production cannot be rebuilt from the repo.** It holds 3,893 `menu_corpus` rows,
   but the commit that loaded them (`92608e42d`) had 2,400 enriched entries, and the
   uncommitted `/tmp` enrichment that filled the gap no longer exists.

**The fix, named and not built:**

- an on-create enrichment hand-off from the three create paths;
- a nightly sweep that profiles and embeds live rows missing either, stocked rows first;
- research eligibility keyed on library rows, plus a reaper for stale `running` rows;
- a single read contract that carries the profile to the page (§4);
- every enrichment output committed, or its provenance written back to the row;
- the 44 copied structures withdrawn or re-derived before any page shows a structure
  (the source for the repair is fork F3). [F3 ANSWERED 2026-09-18: *"Repair, then
  load"*. ADR 0163 §10 goes further: all 3,346 legacy profiles retire from display and
  are re-derived, because the 2026-08-16 load alone carries 1,443 live templated
  profiles (157 distinct across 1,717 rows per the ADR's lane; the critic measured 104
  distinct `wine_structure` and 175 distinct structure-plus-sensory pairs on the same
  rows, so the count depends on the definition).]

The host for the enrichment half is a founder fork (F1, §7). [F1 ANSWERED 2026-09-18:
*"most advanced pipeline to output highest results with high quality"*. ADR 0163 §11
proposes gateway `@Cron` plus the Anthropic Message Batches API, with a Railway
`wine-worker` cron from its Stage 2.] [Round 3, 2026-09-18: the founder chose Claude
Cowork scheduled tasks on his plan credits for the model work (*"since we re going to
use claude cowork, as long as credits allow."*). ADR 0163 §11 now runs only model work
in Cowork. Receiving menus, enqueue, the gates, publishing and health stay on the
gateway, and Message Batches is no longer the host.] **The profile gap on
stocked wines cannot close until one of the hosts runs**, because today no path reaches
them. The read-side fixes (§4, and owed items 3–5) do not depend on F1.

## 3. Scheduled extraction: every job found

Status key: **running** means production shows a recent write. **dead** means it is
scheduled in code but never deployed, and has never written. **disarmed** means it is
deployed with a flag that is off. **manual** means a person runs it. **missing** means
the infrastructure does not exist.

| Job | Where | Schedule | Writes | Status | Last measured write (F-D) |
|---|---|---|---|---|---|
| `score.rescore_stale_wines` | `celery_app.py:119` | 03:00 UTC | `critic_scores`, `retail_price_avg`, `scores_last_updated_at` | dead | never (0 of 4,253) |
| `calibration.calibrate_field_thresholds` | `:113` | 04:00 | `confidence_thresholds.last_calibrated_at` | dead | never (0 of 20) |
| `recrawl.scheduled` | `:126` | 04:30 | `crawl_schedule` | dead | never (0 rows) |
| `trend.compute_metrics` | `:132` | 05:00 | `trending_wines`, `wine_popularity` | dead | never (0 / 0) |
| `research.daily_budget_check` | `:139` | hourly :00 | a Redis pause flag when the budget is exceeded (`research_tasks.py:1731`) | dead | — (Redis contents not inspected) |
| `research.dispatch_batch` | `:153` | hourly :30 | `research_runs`, `evidence_citations`, submissions | dead, and a no-op unless `RESEARCH_DISPATCH_ENABLED` is true (`settings.py:90-91`) | see the out-of-repo row |
| `research.staleness_reverify` | `:160` | Sunday 02:00 | citations | dead | — |
| `drift.scan_sim_catalogs` | `:166` | hourly :15 | `drift_findings` | dead | never (0 rows) |
| `scraping.daily_crawl` / `discovery` / `research_unknowns` | `jobs/tasks.py:387, 537, 593` | beat entries commented out | — | never scheduled | — |
| Haiku → web_verify → ontology → score chain | `onboarding_routes.py:424` (`.delay`) | on each extract event | submissions | dead: no worker, plus the faults in §2.4 | — |
| Sommelier `_enrich_new_wine` | `sommelier_agent.py:333` | on event | library | dormant: the agent is ON_DEMAND, and `FEATURE_SOMMELIER_AI` defaults to off (`orchestrator.py:132`; the live env value was not read) | — |
| Vendor-site sweep / price-index fetch / outlier re-judge | gateway: `vendor-intel/vendor-site-sweep.service.ts:155`, `price-index/price-index-fetch.service.ts:76`, `vendor-intel/outlier-rejudge.ts:90` | 04:20 / 06:00 / 03:40 | price tables, but **not** `retail_price_avg` | disarmed: the sweep is off by default (`price-sources.md:47`), and the others have nothing to act on | never: `price_index_postings`, `vendor_price_observations` and `price_history` are all 0 |
| Insight scheduler (control) | `insight-scheduler.service.ts:46` | hourly sweep; a category with no preference row refreshes daily at 06:00 (`:21`) | `analytics_insights` | **running**, but never writes the library | 2026-09-18 06:00Z |
| Menu-corpus backfill: `extract_menu_corpus.py` → `enrich_wines.py` / `enrich_wines_insession.py` → `load_enriched_wines.py --apply` | `scripts/` | by hand | the whole profile | manual. API credit ran out part-way (`datasets/menu_corpus/README.md:26`, committed 2026-08-16) and was still exhausted on 2026-08-17 (`BEVERAGE_CATALOGUE_PLAN.md:494`) | 3,229 live rows created 2026-08-14..16; most last updated 2026-08-17, some 2026-08-26 |
| `populate_embeddings.py` | `scripts/` | by hand | `embedding` | manual | the 3,430 pre-September rows; none since |
| Seeds: `services/database/import_master_wine_library.py` (source literal at `:93`) ← `library/wineops_basic_v1.jsonl`; `scripts/synth/seed.py` | — | by hand | the importer wrote identity **plus `wine_structure` and `sensory_profile`** (200 of 200 carry a body; 44 carry the copied template, §1). The sim seed wrote identity only | manual | 200 rows on 2026-02-01; 81 sim rows on 2026-09-03. `services/agent-orchestrator/scripts/seed_master_wine_library.py` did **not** write them: it inserts seven columns production lacks (`grape_varieties`, `wine_type`, `tasting_notes` and others) |
| Library repair passes (`repair_seed.py`, `producer-canonicalization*`, `country-region-consistency`, `region-implies-country-repair`, `vintage-prefix-strip` and others) | hand-run SQL and scripts, recorded in `PRODUCER_REPUTATION_PLAN.md:488-491, :1060-1062` | by hand | identity fields only (producer, country, region, vintage, `beverage_kind`), each logged to `wine_repair_log` | manual | 1,086 logged repairs, 2026-08-13..08-23 (F-E). None touched `wine_structure` |
| Out-of-repo research runs | no code in any git ref. The in-repo writer (`research_tasks.py:1502`) records one record per run, but these rows record up to 9,592 eligible and 9,346 processed | irregular: about 23:06 UTC on six of the seven nights 08-26..09-01; then about 06:06, 07:06 and 08:11 on 09-03 and 09-05, 08:11 on 09-12, and 06:06 on 09-16 | `research_runs`, `evidence_citations` | **unattributed**. Checked and ruled out: this account's Claude routines (one, not wine), desktop scheduled tasks (none), and the local crontab and launch agents (none). [CORRECTED 2026-09-18: attributed, and **running**. Four Claude Desktop scheduled tasks in a second org's store are enabled and ran today: `wine-menu-discovery-enrichment` `0 2 * * *` (last run 2026-09-18T06:06Z), `wine-extract-nightly` `0 3 * * *` (07:05Z), `wine-verify-nightly` `0 4 * * *` (08:10Z), `wine-audit-weekly` `0 5 * * 0` (2026-09-13) (`~/Library/Application Support/Claude/local-agent-mode-sessions/0ca3256d-…/1138b209-…/scheduled-tasks.json`). The "none" above most likely read a different org's list: this app's scheduled-tasks tool lists none, and the four sit under org `1138b209` (inference, not measured). Their prompts are `~/Documents/Claude/Scheduled/wine-*/SKILL.md` and the code they drive is in the gitignored `datasets/annotation_inbox/` (`.gitignore:92` on `origin/main`); `~/Documents/Claude/Scheduled/wine-audit-weekly/SKILL.md:26` sets `review_status='approved'` on library rows. Enabled and running is measured; today's runs left no production row, and the newest rows they could have written are `research_runs` 2026-09-16 06:06Z and a library `updated_at` of 2026-09-12 14:50Z (critic SELECT, 2026-09-18). ADR 0163 build step 0.1 disarms them before any new writer starts.] [Round 3, 2026-09-18: since round 2, step 0.1 no longer disarms them first; they run until cutover (ADR 0163 §15). Their run history shows why production saw so little: since 2026-09-04, 37 of their 41 runs were refused by the plan's usage limit (ADR 0163, Context fact 10).] | last run started 2026-09-16 (still `running`); last citation 2026-09-12 08:28Z |
| Database-side scheduling | — | — | — | **missing**: `pg_cron`, `pg_net` and `pgmq` are not installed (F-D; the installed extensions are ltree, pg_stat_statements, pg_trgm, pgcrypto, plpgsql, postgis, supabase_vault, uuid-ossp and vector). The project has no edge functions | — |
| GitHub Actions, Vercel cron, Claude routines | `.github/workflows/*` | — | — | none touches wine. The five scheduled workflows are codeql, agent-cards-weekly, e2e-prod, loop-watcher and schema-parity | — |

**The schedule the library needs.** This is owed work. Its host is fork F1, and every
cadence below is a proposal, not a decision.

[2026-09-18: F1, F2 and F4 are answered (§7 item 1), and this schedule is superseded by
ADR 0163 §4, which names the host, cadence and gate of each stage. Mapping: S1 → P4
(enqueue trigger) + P8 (infer); S2 → P4 (reconciling sweep) + P8; S3 → P12 (deferred
until a reader exists, new table keyed by model); S4 → P5–P7 (discover, cited
extraction, verify); S5 → P11; S6 → P10 (market price at read time, never a library
column); S7 → G1 plus a canonical-type choice (ADR 0163 Q10); S8 → P13. The rows below
are kept as the foundations reading and are not the plan.]

[Round 2, 2026-09-18:

- **S6's source is now restaurant menu prices.** The market price is a class-M
  aggregate over approved menu sightings, shown only when at least 5 restaurant groups
  list the wine (the 5 is proposed; ADR 0163 Q16), or an estimate labelled with its
  count. It sits beside the house index and the Hi-Time public listing, never merged
  with them (ADR 0163 §9). No wine has 5 listings today, and the estimate cannot pass
  its held-out test until at least 16 wines do, so the line starts blank.
- **S4 runs on every wine from the first paid night**, before S1/S2's inference (ADR
  0163 §4).
- **The out-of-repo row below.** The founder keeps those four tasks until the repo
  pipeline runs, and ADR 0163 §15 contains them until then.]

[Round 3, 2026-09-18: the host that ADR 0163 §4 and §11 name is now Claude Cowork
scheduled tasks for model work, with the gateway for everything else. "The first paid
night" reads "the first night the tasks run", and credits set the pace.]

| # | What runs | How often | Reads | Writes | Gate |
|---|---|---|---|---|---|
| S1 | Enrich on create | on each new library row from the three create paths | the new row | structure, aromas, serving, ageing, quality, `data_enrichment` (knowledge, model), `field_confidences` | the row is live and a wine. **All 78 `menu_import` stubs are `beverage_kind = 'unknown'` and `unclassified` (F-E), so classification must run before S1 can take them.** A generic provisional identity (ADR 0130; 49 of the 78) is fork F2; spend cap |
| S2 | Profile sweep | nightly | live rows where `wine_structure` is null, stocked rows first | same as S1, filling NULL fields only (the `load_enriched_wines.py` rule) | F1; spend cap. At the manifest's roughly $0.0018 per wine, today's 159 rows cost about $0.29 |
| S3 | Embedding sweep | nightly, after S2 | rows where `embedding` is null | `embedding` | the same model and dimension as the existing 3,430 rows |
| S4 | Research and verification | daily dispatch | eligibility keyed on **library rows** | `evidence_citations`; `knowledge = 'sourced'` | `RESEARCH_DISPATCH_ENABLED`; budget check; a reaper for `running` rows older than one run window |
| S5 | Staleness re-verify | weekly | sourced rows past their age limit | citations | as S4 |
| S6 | Market price | nightly | stocked rows | `retail_price_avg` or its successor | fork F4 (which source) |
| S7 | Vocabulary repair | weekly | `primary_type`, `aging_vessel` | normalised values, logged to `wine_repair_log` | none beyond review |
| S8 | **Pipeline health** | daily | stocked rows without a profile; age of the last enrichment write | one figure and one alarm | must *prove presence*: it fails when the count is above 0 **or** when it cannot run, and never reports "0 missing" off an empty read |

## 4. The one seam: a single read contract

Today library data reaches the product through two unrelated projections:

- `mapWine`, for pages (`wines.service.ts:147-214`);
- the `master_wine_library(primary_type)` embed in the analytics loaders. It appears in
  five selects across four files: `insight-generator.service.ts:442`,
  `analytics.service.ts:121`, `advanced-analytics.service.ts:60` and `:404`, and
  `dashboard.service.ts:918`.

The foundation is **one contract, defined once and read by both**. Its physical home,
a gateway type or a database view, is fork F6. [F6 was not put to the founder. ADR 0163
§7 recommends a database view, `wine_profile_v1`, returning value, provenance, source,
issuer, date, cell id and licence per field, with a hand-written `WineProfile` type
pinned to it by a static CI test.]

**Contract: `WineProfile`, one per library row.** Each field travels with a provenance
flag. Field groups:

| Group | Fields | Provenance flag carried |
|---|---|---|
| Identity | name, displayName, producer, vintage | `knowledge`; `canonical_name_verified` |
| Origin | country, region, subRegion, appellation | `field_confidences.country/region/appellation`; the evidence-policy tier |
| Grape | grapeVariety | `field_confidences.grape_variety` |
| Structure | body, sweetness, acidity, tannins, texture, finish, alcoholLevel | `field_confidences.wine_structure` plus row `knowledge` |
| Aromas | primary, secondary, tertiary, flavourProfile | `field_confidences.sensory_profile` |
| Serving and ageing | servingTempC, glass, decant, ageingYears, ageingVessel | row `knowledge` only (no per-field key exists) |
| Quality tier | qualityLevel, producerTier | `field_confidences.quality_classification` |
| Narrative | tastingNote, producerStory | only `sourced` or `stated`, per the evidence gate (`evidence_gate_v1.sql:97-100`) |
| Market | retailPrice, criticScores, awards | only `sourced`, per the evidence gate (`:90-95`) |
| House analytics | a Wine-360 block (demand, cover, margin, rank) | computed from the house's own sales and stock, never from the library |
| Status | `profileStatus` (complete, partial or missing) and `observedAt` (`enrichment_observed_at`) | — |

**The missing-value rule.** These are foundations; the wording on the page belongs to
the drawing.

1. **A value that is absent stays absent.** The contract omits it. It never sends a
   default or a sentinel dressed up as a value. `bottle_size_ml` defaults to 750 on every
   row, `price` defaults to 0 (`wines.service.ts:148, :161`), and 'Unknown' appears as a
   string in country, region, grape and vintage_quality. Each of these reads as absent
   (ADR 0020). The same applies to the 44 seed rows that carry the copied structure
   template (§1): until they are repaired, their structure reads as absent, not as a
   value.
2. **An empty section is either left out or given one line.** When a whole group is
   missing, the page shows one "coming soon" line for that section, or leaves the
   section out; the founder allowed either. It never shows per-field dashes or a
   placeholder that looks like data. House analytics with no sales yet follow the same
   rule.
3. **An inferred value is never presented as fact.** Whether inferred values may be
   shown at all, and how they are marked, is fork F5. [F5 ANSWERED 2026-09-18 (relayed
   as a paraphrase): inferred values are shown, labelled honestly with their
   provenance. ADR 0163 §1 limits inference to descriptive traits and labels them
   inline.]
4. **The one-sentence description is composed only from fields the contract carries.**
   It carries the lowest provenance among its inputs, and it is never generated from a
   field the row lacks (ADR 0145: a sentence is bound to the reading that produced it).
   If a stocked wine yields no sentence, `profileStatus = missing` is recorded, and S8
   counts it as a pipeline defect rather than hiding it.
5. **Tasting notes and producer stories appear only when sourced.** Template palate
   text (133 rows) is not a tasting note and does not appear under that name.

## 5. Every endpoint and surface that should consume it

| Surface | Endpoint | Reads today | What the contract unlocks | Status |
|---|---|---|---|---|
| Cellar wine detail (web) | today the cellar reads `GET /wines?limit=500` and `GET /inventory/:rid` (`useCellarNextData.ts:5-6`). `GET /wines/:wineId` (`wines.controller.ts:90`) exists, and its only web caller is `VendorPriceCompare.tsx` | identity, origin and grape through `mapWine`, but no profile | the profile, sentence and provenance; the "coming soon" analytics slot | owed. The drawing comes first: ADR 0160 item 110.4, on `origin/feat/mudavym-finish` and not yet on main (`0160-…md:204`) |
| Cellar list / wine library | `GET /wines` (`:41`) and `meta/categories`, `regions`, `countries` (`:62-72`) | `select *` on the **whole shared library**, with no live filter. Of the first 500 rows by name, 118 are not wine. The three defects overlap: 76 of the 118 are deleted or superseded spirits, cocktails and beers, and the other 42 are live `unknown` rows, 23 of which are provisional to one house (appendix Q11); the client uses the service role, so RLS does not filter | style and region facets from normalised values | defect. It is in neither `OPEN-DECISIONS.md` nor `v3.0-TECH-DEBT.md` (grep); it is pinned by the claim `WINE-ML-WINES-READ-HAS-NO-LIVE-FILTER`. The question of scope is **OD-102 (OPEN-DECISIONS.md:63)** |
| Similar wines | `GET /wines/:wineId/similar` (`:82`) | same type and region, price within ±30% | nearest neighbours by `embedding`: 3,430 rows carry one, but only 14 stocked wines do | owed after S3 |
| Suggestions | `GET /wines/suggestions` (`:77`) | ilike on name and producer | — | not a consumer |
| Mobile cellar tab | `GET /inventory/:rid` (`inventory.controller.ts:36`) | embeds library `*` and then deletes it (`inventory.service.ts:103`) | a profile summary per bottle | owed |
| Wine-360 | `GET /analytics/wine/:rid/:masterWineId` (`analytics.controller.ts:838`) | demand, cover, margin and rank, with no library field; **no web or mobile caller** | the house-analytics block of the detail page | exists, but nothing uses it |
| Insights | `GET /analytics/insights/:rid` (`:300`), MCP `insights.list` (`tool-catalog.ts:182`) | `primary_type` is selected and never read (`insight-generator.service.ts:442`) | the library-sliced families (§6) | the seam is `loadBundle`, `:406-542` |
| Menu engineering / seasonality | `:798`, `:818` | `primary_type` as the type | normalised style | depends on S7 |
| Inventory breakdown | `GET /dashboard/inventory-breakdown/:rid` (`dashboard.controller.ts:286`) | `primary_type` | style, region and price-tier splits | depends on S7 |
| Recommendations | `GET /analytics/recommendations/:rid` (`:915`) | no library field | pairing and attribute reasons, once the insight families run | later |
| Ask / sommelier | ask-ai (`ask-ai/`), with no library reference found by grep; sommelier routed to the assistant (ADR 0143 §3) | none | answers read from the contract, under ADR 0145 | later |
| Menu import | `POST /menus/import` (`menus.controller.ts:36`) | creates stubs | the S1 hand-off | owed (§2.1) |
| Vendor prices | MCP `prices.compare` (`tool-catalog.ts:165`); `VendorPriceCompare.tsx` via `/wines` | `masterWineId` only; `retail_price_avg` is 0 | a market reference beside the vendor price | fork F4 (ADR 0117/0126) [ANSWERED 2026-09-18, *"Both, labelled"*; ADR 0163 §9. Round 2: the market price is read from restaurant menu prices (class M), and never placed beside a vendor quote as comparable] |
| Orchestrator analytics (admin key) | `/api/v1/analytics/wine/{id}/scores`, `/trends`, `/wine/{id}/timeline` (`analytics_routes.py:77, 218, 389`) | tables that are empty in production | — | dead. Retire or rebuild, later |

## 6. How the insight types connect

The count comes from the source, not from the docs. `INSIGHT_CANDIDATES`
(`insight-catalog.ts:570`) holds **573** types, and 24 of them are implemented
(`insight-implementations.ts:52`). The "347" in `INDEX.md` and `06-pages/reports.md` is
stale. The count was reproduced by compiling the real catalogue on 2026-09-18.

| Family | Fed by | Types | Implemented | Library role |
|---|---|---|---|---|
| A. Sliced by wine style (`wine_type` dimension) | sales and consumption **and** library | 30 | 0 | the slice key. It needs a normalised style: `primary_type` has 12 distinct values, and 'red', 'red (still)' and 'red (still, dry)' are separate values (F-C) |
| B. Per wine (`wine` dimension) | consumption and stock **and** library | 48 | 4 | the entity key. `attribute_correlation` is pruned for `wine` (`insight-catalog.ts:543-544`), so "which attributes drive sales" has no type yet |
| C. Wine share of checks (attach rate, per cover, per seat) | POS | 79 | 0 | optional. It joins through `pos_checks.items[].master_wine_id`, which is on 56 of the 304 items flagged `is_wine` (F-E) |
| D. Wine volume and stock on non-wine slices | inventory and consumption | 57 | 5 | optional region and price-tier slicing |
| E. Purchasing | orders | 33 | 5 | optional |
| F. Sales, tables, staff, venue | sales only | 326 | 10 | none |

**The founder's premise is not true today.** No insight type reads a library feature.
`DataRequirement` (`insight-catalog.ts:32-39`) lists seven sources, and none of them is
the library. **No type is library-only:** the library is always a slice or a qualifier
on a sales, stock or purchasing measure. So "integrated with the ML data" means adding a
library source at `loadBundle` that serves families A, B and optionally C and D, and
moving the four sibling `primary_type` selects with it.

## 7. Owed work, in order

Each item is small and has a check.

[2026-09-18: this list is now sequenced by the build order in ADR 0163 (Stages 0–3,
each step with its check). Item 1 is answered below. Item 2 → ADR 0163 steps 0.1 and
0.15 (the Desktop tasks that write `research_runs` are disarmed first, or a reaper would
close a live run). Items 3–5 → steps 0.6–0.7. Item 7 → partly retired: `wine_research_service.py` and the Celery tasks
(`haiku_tasks.py`, `ontology_tasks.py`) belong to lanes ADR 0163 §12 retires;
`override_service.py`, `quality_routes.py`, `studio_routes.py` and
`dataset_ingestion_service.py` are not addressed by ADR 0163 and keep this item's check. [Round 2: ADR 0163
§13 and step 0.17 now address `override_service.py`, `quality_routes.py` and
`studio_routes.py`. Their direct library inserts retire in favour of the publish RPC.
Only `dataset_ingestion_service.py` keeps this item's check.] Item 8 → Stage 1. Item 9 → step 0.11. Item 10 → Stage 2 [round 2: Stage 1] (P5–P7, keyed on
library rows). Item 11 → per-cell `model_id`, `prompt_hash`, `run_id` and `batch_id`
(ADR 0163 §3). Item 12 → G1 and ADR 0163 Q10. Items 13–15 are unchanged and outside
ADR 0163.]

1. **Put the forks to the founder.** None of these is decided here:
   - **F1**: which host runs enrichment. The options are a Railway Celery worker and
     beat; gateway `@Cron`, which is live, calling the orchestrator; or sessions run by
     hand. [ANSWERED 2026-09-18: *"most advanced pipeline to output highest results
     with high quality"*. ADR 0163 §11: gateway `@Cron` plus Message Batches; Celery
     rejected.] [Round 3, 2026-09-18: model work moves to Claude Cowork scheduled tasks
     on plan credits (*"… as long as credits allow."*). The gateway keeps health,
     enqueue and the publish gates. ADR 0163 §11.]
   - **F2**: whether generic provisional rows (ADR 0130) are ever enriched. 49 of the
     78 stocked `menu_import` stubs are provisional to a house. [ANSWERED 2026-09-18:
     *"everything beyond stocked and more, every day more extractions, more wines, just
     like the beginning of this project"*. ADR 0163 §2 reads it with ADR 0130:
     everything with a specific identity is enriched and the library grows nightly;
     generic and provisional rows show only what the house states; a proposed ADR 0130
     amendment requires a producer stated on the source.]
   - **F3**: whether to load the producer research and the rich
     `library/restaurant_wine_dataset.jsonl` blocks after repair. 39 of its 200 rows
     still name the Facchin producer and carry the Facchin story; 187 of the 200
     ratings are marked `estimated`, and 1 is verified. The same corruption is
     **already in production**: the 44 copied structures came in through the thinner
     seed file (§1). Neither seed file can repair them, because both carry the same 44
     template rows (F-E). A repair needs a fresh model run or a sourced value.
     [ANSWERED 2026-09-18: *"Repair, then load"*: skip the 39 wrong producer stories,
     drop the 'estimated' ratings, re-profile the 44 copied rows, stories only when
     sourced. ADR 0163 §10.]
   - **F4**: which source supplies the market price (Serper snippets, or the ADR
     0117/0126 index). [ANSWERED 2026-09-18: *"Both, labelled"*: the house index
     first, a public retail figure beside it marked as a public listing. ADR 0163 §9
     computes both per house at read time, rejects Serper as an issuer, and limits the
     public line to shops whose terms permit it (Hi-Time only today).] [Round 2,
     2026-09-18: the market price itself is now read from restaurant menu prices. Hi-Time
     is used (*"Use Hi-Time, ask the rest"*), the other three shops are asked, and Serper
     is not used even to find URLs (*"No"*). ADR 0163 §9.]
   - **F5**: whether inferred values may be shown on a page, and how they are marked.
     [ANSWERED 2026-09-18 (relayed as a paraphrase): shown, labelled honestly with
     their provenance. ADR 0163 §1.]
   - **F6**: whether the contract lives in a gateway type or a database view. [Not
     asked; ADR 0163 §7 recommends a database view with a hand-written type.]

   *Check:* each fork has a register row or an answer. [Met for F1–F5; F6 and the
   questions ADR 0163 raises are listed in that ADR for the founder.] [Round 2,
   2026-09-18: most of those questions are answered, and the ADR records each answer
   verbatim as relayed. The market price now comes from menu prices; review happens in
   /studio; every wine is sourced; the legacy profiles stop showing. What is still open
   is listed under ADR 0163's "Still open after round 2".]
2. **Clear the four stale `running` rows in `research_runs`, and add a reaper.** This is
   a production write and needs the founder's word. *Check:* F-A `runs_running = 0`.
   [Round 2: the laptop tasks that open these rows run until cutover, so the reaper
   stays disarmed until 7 days after it (ADR 0163 §15, step 0.15).]
3. **Stop `mapWine` reading the column that does not exist.** *Check:* the claim
   `WINE-ML-MAPWINE-READS-ABSENT-TASTING-NOTES` flips.
4. **Give `/wines` and `meta/*` a live filter.** *Check:* appendix Q11 returns 0 non-live
   rows. Which house's rows belong in the list stays with OD-102.
5. **Define `WineProfile` (§4), with a provenance flag on every field.** `mapWine`
   emits it. *Check:* `WINE-ML-MAPWINE-SENDS-NO-PROFILE` flips.
6. **Draw the wine detail (ADR 0160 item 110.4), then build it on the contract.** Apply
   the missing-value rule and the Wine-360 slot. *Check:* no field is rendered from a
   default.
7. **Fix the write paths in §2.4** so they write only columns production has. *Check:*
   run each insert once against a local database built from migrations.
8. **Stand up S1 to S3 on the F1 host.** *Check:* F-A `after_0817_profiled_or_embedded`
   equals `live_after_0817`, and `stocked_body` equals `stocked_distinct` minus the
   F2-excluded rows. [2026-09-18: host is ADR 0163 §11; the F2-excluded rows are
   ADR 0163 §2's buckets, reported by P13 and never counted as covered or missing.]
   [Round 3, 2026-09-18: that host is now split: Cowork tasks for model work, the
   gateway for the rest (ADR 0163 §11).]
9. **Stand up S8 (pipeline health).** *Check:* it fails on today's data (160 stocked
   wines without a profile) and passes only after item 8.
10. **Key research eligibility on library rows** (or mint submissions for stubs), then
    run S4 and S5. *Check:* `research_eligible_submissions` is greater than 0 while
    unprofiled stocked stubs exist.
11. **Commit the enrichment outputs**, or write their provenance to the row, so that
    production can be replayed from the repo. *Check:* a replay reproduces the counts
    from F-B.
12. **S7 vocabulary repair.** *Check:* F-C `primary_type_values` falls to the canonical
    set.
13. **Add a library source at `loadBundle`,** and move the four sibling selects.
    *Check:* `WINE-ML-INSIGHTS-READ-ONLY-PRIMARY-TYPE` flips.
14. **Implement family A, then unprune the wine drivers in family B.** *Check:* each new
    type is listed in `IMPLEMENTED_INSIGHT_TYPES`.
15. **Update the stale pointers.**
    - `foundation/teams/technology.md:571` says the pipeline is "actively running".
    - `06-pages/wines.md` §9 cites 442 rows and the legacy mapper.
    - `08-softwares/wine-library-sommelier.md` §4.
    - `foundation/EXTERNAL_CONNECTIONS.md` §3: re-verify it; do not merge it.
    - "347" in `07-reference/INDEX.md` and `06-pages/reports.md`.
    - [Round 2] `08-softwares/wine-studio.md:42` and `06-pages/studio.md:40` list
      promotion into the master library as working. It cannot succeed (§2 item 4; ADR
      0163 step 0.17).

## 8. Claims

These rows are in `CLAIMS.jsonl`. All are `open`: each describes a defect that exists
today, and its verify command states the fixed state.

- `WINE-ML-MAPWINE-SENDS-NO-PROFILE`
- `WINE-ML-MAPWINE-READS-ABSENT-TASTING-NOTES`
- `WINE-ML-INSIGHTS-READ-ONLY-PRIMARY-TYPE`
- `WINE-ML-NO-CELERY-IN-DEPLOY-CONFIG`
- `WINE-ML-WINES-READ-HAS-NO-LIVE-FILTER`

Each was mutation-tested. On a copy of the tree with the fix applied, the verify command
passes, so the checker would call the row stale. With the thing it pins renamed or
deleted, it either passes or cannot run, and both are loud. An adversarial re-run
through the real `check_decision_claims.sh`, on a tree holding only these five rows,
found one no-op mutation: a Celery worker added to `docker-compose.override.yml` left
`WINE-ML-NO-CELERY-IN-DEPLOY-CONFIG` holding. That file is now in its verify. A worker
declared in a new file would still be missed, and the row says so.

Kept as prose because no static check can hold them: every production count in this
document (re-run the appendix); that the out-of-repo research runs have stopped [CORRECTED 2026-09-18: they have not;
the four Desktop tasks are enabled and three ran today, §3, although the newest
production row they could have written is from 2026-09-16] [round 3, 2026-09-18:
each of those three runs was refused by the plan's weekly usage limit, which is why
they left no row (ADR 0163, Context fact 10)]; that no
Railway service was configured by hand outside the IaC; that research eligibility is 0;
and the 573/24 insight count, which needs the TypeScript compiled and so cannot run in
the claims job.

---

## Appendix: re-measure queries (production, SELECT only)

```sql
-- F-A headline
with live as (select * from master_wine_library where deleted_at is null and superseded_by is null),
stocked as (select distinct master_wine_id id from restaurant_inventory where deleted_at is null and is_active and master_wine_id is not null)
select (select count(*) from live) live_rows,                                                   -- 3,589
 (select count(*) from live where wine_structure ? 'body') live_body,                           -- 3,346
 (select count(*) from live where embedding is not null) live_embedded,                         -- 3,430
 (select count(*) from live where created_at >= '2026-08-17') live_after_0817,                  -- 159
 (select count(*) from live where created_at >= '2026-08-17'
    and (wine_structure ? 'body' or embedding is not null)) after_0817_profiled_or_embedded,    -- 0
 (select max(greatest(created_at, updated_at)) from live) last_live_write,                      -- 2026-09-05 17:50Z
 (select count(*) from stocked) stocked_distinct,                                               -- 173
 (select count(*) from stocked s join master_wine_library m on m.id = s.id
    where m.wine_structure ? 'body') stocked_body,                                              -- 13
 (select count(*) from stocked s join master_wine_library m on m.id = s.id
    where m.created_at >= '2026-08-17') stocked_after_0817,                                     -- 159
 (select count(*) from research_runs where status = 'running') runs_running,                    -- 4
 (select count(*) from research_eligible_submissions(5000, 7)) eligible,                        -- 0
 (select count(*) from enrichment_queue) enrichment_queue_rows;                                 -- 0

-- F-B coverage by family, live vs stocked (the §1 tables)
with live as (select * from master_wine_library where deleted_at is null and superseded_by is null),
st as (select m.* from master_wine_library m where m.id in (select distinct master_wine_id
       from restaurant_inventory where deleted_at is null and is_active and master_wine_id is not null)),
f as (select 'live' g, * from live union all select 'stocked', * from st)
select g, count(*) n,
 count(*) filter (where producer is not null) producer, count(*) filter (where vintage is not null) vintage,
 count(*) filter (where country is not null and country <> 'Unknown') country,
 count(*) filter (where region is not null) region, count(*) filter (where sub_region is not null) sub_region,
 count(*) filter (where appellation is not null) appellation, count(*) filter (where grape_variety is not null) grape,
 count(*) filter (where wine_structure ? 'body') structure, count(*) filter (where sensory_profile ? 'primary_aromas') aromas_key,
 count(*) filter (where sensory_profile ? 'palate_description') palate_text,
 count(*) filter (where sensory_profile->>'profile_source' = 'template_based') template_palate,
 count(*) filter (where serving_temp_celsius is not null) serving, count(*) filter (where aging_potential_years is not null) ageing,
 count(*) filter (where quality_classification ? 'quality_level') quality_tier,
 count(*) filter (where coalesce(producer_story, producer_bio, historical_notes) is not null) producer_text,
 count(*) filter (where awards is not null or professional_ratings is not null or rating_ws is not null
                  or (critic_scores is not null and critic_scores <> '{}'::jsonb)) critic_awards,
 count(*) filter (where retail_price_avg is not null) retail_price, count(*) filter (where price_reference > 0) menu_price_ref,
 count(*) filter (where embedding is not null) embedding,
 count(*) filter (where field_confidences is not null and field_confidences <> '{}'::jsonb) field_conf,
 count(*) filter (where data_enrichment->>'knowledge' = 'known') known,
 count(*) filter (where data_enrichment->>'knowledge' = 'inferred') inferred,
 count(*) filter (where data_enrichment->>'knowledge' = 'sourced') sourced,
 count(*) filter (where data_enrichment->>'knowledge' = 'unknown') unknown_k,
 count(*) filter (where data_enrichment->>'knowledge' is null) no_knowledge,
 count(*) filter (where review_status = 'approved') approved,
 count(*) filter (where ml_derived_features is not null or ai_agent_features is not null) ml_feat
from f group by g order by g;
-- live:    3589 | 3540 3118 3498 3542 2420 2259 3514 | 3346 3428 136 133 | 3266 3266 3346 | 0 0 0 3345 3430 3276 | 432 2773 3 68 313 | 3 | 0
-- stocked:  173 |  124  120   95  132   14   13  107 |   13   14   3   3 |    7    7   13 | 0 0 0   14   14    7 |   0    7 0  0 166 | 0 | 0

-- F-C value quality (live)
select count(*) filter (where lower(trim(grape_variety)) = 'unknown') grape_unknown,           -- 867
 count(*) filter (where jsonb_typeof(sensory_profile->'primary_aromas') = 'array'
                  and jsonb_array_length(sensory_profile->'primary_aromas') > 0) aromas_nonempty, -- 3,346
 count(*) filter (where data_enrichment->>'model' = 'claude-haiku-4-5') haiku_model,            -- 3,276
 count(*) filter (where quality_classification->>'vintage_quality' = 'Unknown') vq_unknown,     -- 3,271
 count(*) filter (where canonical_name_verified) canon_verified,                                -- 3
 count(distinct primary_type) primary_type_values                                               -- 12
from master_wine_library where deleted_at is null and superseded_by is null;

-- F-D job outputs
select (select count(*) from confidence_thresholds where last_calibrated_at is not null),       -- 0 of 20
 (select count(*) from master_wine_library where scores_last_updated_at is not null),           -- 0
 (select count(*) from crawl_schedule), (select count(*) from trending_wines),                  -- 0, 0
 (select count(*) from wine_popularity), (select count(*) from drift_findings),                 -- 0, 0
 (select min(started_at) from research_runs where status = 'running'),                         -- 2026-09-02 22:53Z
 (select max(created_at) from evidence_citations),                                              -- 2026-09-12 08:28Z
 (select max(computed_at) from analytics_insights),                                             -- 2026-09-18 06:00Z
 (select count(*) from price_index_postings), (select count(*) from producers),                -- 0, 0
 (select string_agg(extname, ',') from pg_extension
    where extname in ('pg_cron', 'pg_net', 'pgmq')),                                            -- null (none of the three)
 (select count(*) from information_schema.columns where table_schema = 'public'
    and table_name = 'master_wine_library' and column_name = 'tasting_notes'),                  -- 0
 (select count(*) from master_wine_library m where m.source = 'menu_import' and m.deleted_at is null
    and not exists (select 1 from master_wine_library_submissions s
                    where s.matched_master_id = m.id));                                         -- 78

-- Q11 what GET /wines?limit=500 returns (order by name, no live filter)
with first500 as (select * from master_wine_library order by name limit 500)
select count(*) filter (where deleted_at is not null or superseded_by is not null) not_live,    -- 76
 count(*) filter (where beverage_kind <> 'wine') not_wine,                                      -- 118
 count(*) filter (where provisional_for_restaurant_id is not null) provisional                  -- 23
from first500;
-- overlap: all 76 non-live rows and all 23 provisional rows are among the 118 non-wine rows

-- F-E adversarial re-measure (2026-09-18): template, holders, witnesses, repair lane
with live as (select * from master_wine_library where deleted_at is null and superseded_by is null)
select source, count(*) from live
where wine_structure->>'body' = 'light' and wine_structure->>'tannins' = 'none'
  and wine_structure->>'texture' = 'crisp' and wine_structure->>'finish' = 'short'
  and wine_structure->>'sweetness' = 'dry' and wine_structure->>'acidity' = 'high'
group by 1;                                                  -- wineops_basic_v1 44 (37 red), menu_corpus 3
with st as (select ri.master_wine_id id, bool_or(r.name ~ '^Sim ') in_sim, bool_or(not (r.name ~ '^Sim ')) in_other
  from restaurant_inventory ri join restaurants r on r.id = ri.restaurant_id
  where ri.deleted_at is null and ri.is_active and ri.master_wine_id is not null group by 1)
select in_sim, in_other, count(*), count(*) filter (where m.wine_structure ? 'body') profiled
from st join master_wine_library m on m.id = st.id group by 1, 2;
                                                             -- sim-only 161 (1 profiled); other houses 12 (12, 7 template)
select source, beverage_kind, classification_status, count(*) from master_wine_library
where source = 'menu_import' and deleted_at is null group by 1, 2, 3;   -- menu_import unknown unclassified 78
select count(*) filter (where producer_story is not null) story,
       count(*) filter (where serving_temp_celsius is not null) serving
from master_wine_library where source = 'wineops_basic_v1'
  and name in ('2018 Fekete Bela Furmint Somlo''I HUNGARY', '2019 Capture Napa Valley');  -- 0, 0
select repaired_by, count(*) from wine_repair_log group by 1;           -- 1,086 rows, 2026-08-13..08-23
select (it->>'is_wine') is_wine, count(*), count(*) filter (where nullif(it->>'master_wine_id', '') is not null)
from pos_checks c, jsonb_array_elements(c.items) it group by 1;          -- true 304 / 56
```

File-side (F-E): `library/restaurant_wine_dataset.jsonl` has 200 rows. 104 carry
`producer_details.producer_story`, 39 of them the Facchin copy. `WINE_022` (Fekete) and
`WINE_103` (Capture) carry `practical_attributes.serving_temp_c`. 44 rows in each of the
two seed files have the template structure. The insight counts (573 total, 24
implemented, family split 30/48/79/57/33/326) were reproduced by loading
`insight-catalog.ts` and `insight-implementations.ts` under
`node --experimental-strip-types`.

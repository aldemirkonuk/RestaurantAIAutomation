---
type: agenda-full
division: platform
department: engineering
status: active
metrics: [identity.false_merge_count, inventory.projection_divergence_rows, procurement.order_to_delivery_reconciliation_rate, messaging.duplicate_delivery_rate, surfaces.reachable_route_ratio, platform.endpoints_protected_by_default_pct, integration.verified_signature_coverage, schema.days_since_hand_applied_ddl]
updated: 2026-08-28
links: ["[[engineering-charter]]", "[[engineering-premortem]]", "[[engineering-agenda-board]]", "[[engineering-directive]]", "[[engineering-loops]]", "[[engineering-schedule]]", "[[engineering-agent-stack]]", "[[engineering-questions]]", "[[0039-activation-plan-of-record]]", "[[0038-cards-run-as-declared-scripts]]", "[[0029-p3-plan-of-record]]", "[[catalogue-identity-charter]]", "[[inventory-ledger-charter]]", "[[procurement-vendor-network-charter]]", "[[messaging-delivery-charter]]", "[[client-surfaces-charter]]", "[[platform-api-charter]]", "[[integration-engineering-charter]]", "[[schema-migrations-charter]]", "[[security-charter]]", "[[knowledge-documentation-charter]]", "[[decision-office-charter]]", "[[technology]]", "[[ENDPOINTS]]", "[[PAGE_MAP]]"]
---

# Engineering — Full Agenda

> **Agenda of record, 2026-08-28** ([ADR 0039](../../../decisions/0039-activation-plan-of-record.md)
> Track B). Written by this department's own agent against its charter, directive,
> schedule, card, loops and premortem. Every task below names a **doneability**, a
> **close_time**, and the **evidence** that makes it real; anything that could not be
> carried by a card or a loop is in §5 as a finding instead of §3 as a task.
> Goes stale **2026-10-27** under the 60-day rule (`scripts/watch_loops.py:34`).

---

## 0. Before anything: four of this department's headline numbers were stale

The charter's evidence section is dated 2026-08-24. Measured again at HEAD on
**2026-08-28**, four load-bearing figures have moved, three of them *in the good
direction*, and one of the four moved so far that the department's founding
premortem (M2) no longer describes the codebase it was written about.

| Claim, as written | Where | Measured 2026-08-28 | How |
|---|---|---|---|
| 448 routes / 44 controllers | charter §Evidence | **463 routes / 48 controllers** | decorator census over `apps/api-gateway/src/**/*.controller.ts`, resolving class-level `@UseGuards` and method-level `@Public()` |
| **137 unguarded** endpoints | charter §Evidence, premortem M2 | **6** — `auth` `login`, `register`, `oauth/google`, `oauth/microsoft`, `refresh`, `verify-email`, all of which cannot carry a JWT by definition | same census: 432 guarded, 25 `@Public()`, 6 unguarded-by-omission |
| `recurring-orders` — 6 unguarded routes that place real orders | charter §Evidence, [[procurement-vendor-network-charter]] | **guarded** — `recurring-orders.controller.ts:35` now carries `@UseGuards(JwtAuthGuard)`, with a source comment recording that it previously did not | direct read |
| 62 migrations | charter §Evidence | **79** | `supabase/migrations/*.sql` |

**What did *not* move, and is the actual open exposure:** `app.module.ts:127-133`
registers exactly two global guards — `RateLimitGuard` and `TenantGuard`. There is
still **no global `JwtAuthGuard`**, so `platform.endpoints_protected_by_default_pct`
is still **0%**. Meanwhile **457 of 463 routes (98.7%) are either guarded or explicitly
`@Public()`** — intent is now stated almost everywhere, one controller at a time, while
the *default* stayed at zero. That is premortem M2's own warning arriving from the
opposite direction than expected: the second number went to 100% and the first never
moved, and nobody would have noticed because the department reads neither on a
schedule. Both numbers go on the board side by side, permanently (**PA-1**, **PA-3**).

Charters are wave-1 artifacts and are not edited here ([`GENERATION_BRIEF`](../../../foundation/GENERATION_BRIEF.md) §8.4).
The corrections above are the record; **D-2** publishes them, and **F-7** files the
charter-edit request.

---

## 1. The spine — three programs, one repair

Engineering's eight teams are eight incommensurable ways the product can be wrong
([[engineering-charter]] §Boundaries). An agenda organised by team would be eight
backlogs, which is premortem M1 written as a plan. So it is organised by **what kind
of wrongness the work removes**, and the team column says who does it.

**Program A — Stop guessing. Every one of the eight numbers gets a producer or the
word `unreadable`.** Five of eight have no producer today ([[engineering-agent-stack]]
§5). The department's own directive says a change to a metric that has never been read
is a guess, not a change. Program A is the measurement half, and it is deliberately
first even though it ships no feature.

**Program B — Per-page UI compatibility and dead ends.** 49 route notes carry a §10
maturity verdict; today they read **8 complete · 25 partial · 9 hollow · 5 broken**,
and **45 of 47** emit no signal at all. Nine pages *look finished and lie*. That is a
worse defect class than a broken page and it is invisible to every guard the
department owns, because every guard it owns is a grep over source (premortem M4).

**Program C — Shrink-only debt.** Three debts that may only get smaller, each with a
checked-in count that CI fails on if it rises: schema drift (**SM-1**), unwired guards
(**D-3**), and untyped database access (**SM-3**). "Shrink-only" is borrowed
deliberately from the P3.0 exemption list, which is the one debt list in this repo
that has actually stayed honest (`scripts/check_task_types_are_graded.py`).

**The repair, running under all three:** Engineering declared 9 agents and **none of
them is `routing_class: mechanical`**, so **zero** of them execute. `run_card.py`
reports 8 running of 36 mechanical cards declared; not one is Engineering's. Four of
this department's numbers are pure disk-and-grep work — exactly the runner's boundary.
**D-4** fixes that, and it is the single highest-leverage item on this page.

### Track A obligations ([ADR 0039](../../../decisions/0039-activation-plan-of-record.md))

Engineering owns **A2** outright and the executor half of **A3**. They are the spine's
first claim on the department, not a competitor to it — see **SM-4** and **PV-3**.

---

## 2. How this agenda closes

Each task carries a **close_time** as a date. The date is not a wish: it is the date
by which the task must have *moved*, and the loop or card that will notice if it has
not is named in the carrier column. A task whose carrier is `—` is a finding, and
those live in §5, not here.

Sequencing rule, unchanged from the directive: **measure → guard → move.** A fix with
no number cannot be shown to have worked. Where a task's carrier does not exist yet,
the task's *first* deliverable is the carrier.

---

## 3. Tasks

### 3.1 Department

| # | Task | Doneability | close_time | Carrier | Evidence |
|---|---|---|---|---|---|
| **D-1** | Publish the eight-wrongness board for the first time | All eight rows carry a measured value **or** the literal word `unreadable`. A row may not be omitted — an omitted metric reads as green | **2026-09-01**, then weekly | L-ENG-1 / `eng-board-keeper` | [[engineering-loops]] L-ENG-1; the honest first output is five `unreadable` rows ([[engineering-agent-stack]] §5) |
| **D-2** | Publish the §0 correction sheet on the board and date it | The four corrected figures appear on [[engineering-agenda-board]] with the measurement method beside each, so the next reader can re-run it | **2026-09-01** | L-ENG-1 | §0 above, measured at HEAD 2026-08-28 |
| **D-3** | Guard/outcome reconciliation, first run — **including the three guards that are on disk and wired to nothing** | Every grep-shaped guard in the repo is listed with its outcome-side twin or named as having none; `check_display_name_parity.py`, `check_beverage_kind_regression.py` and `check_log_sanitizer_usage.py` are each **wired or deleted** — a schedule that lists an unwired guard is a claim, not a control | **2026-09-25**, then monthly | L-ENG-3 / `guard-outcome-reconciliation` skill | swept `.github/` for every `scripts/check_*`: three have no invocation anywhere; [[engineering-schedule]] lists one of them as a per-PR job; [[engineering-agent-stack]] §6 filed one, this sweep found two more |
| **D-4** | Make Engineering's census-shaped numbers **mechanical cards** so the department has an agent that actually runs | The route-guard census, route-reachability census, unwired-guard census and schema-debt counts each exist as a script, are declared `routing_class: mechanical` on their unit's card, and appear in `run_card.py`'s implemented list. Card edits land as a post-wave PR — the card must precede the script, since an undeclared agent is refused | **2026-10-09** | `run_card.py` | `python3 scripts/agents/run_card.py` → "8 agent(s) ran · 36 mechanical cards declared · 32 mechanical not yet implemented"; none of the 8 belongs to Engineering ([`cards.json`](../../../00-index/cards.json): eng cards are 1 extraction + 8 judgment); [[0038-cards-run-as-declared-scripts]] |
| **D-5** | First seam arbitration close — starting with the two seams this agenda found | Each open seam is assigned to the left-of-seam team (`technology.md:857-865`) or filed with an OD id, with an age in days. The two live ones: **MD-2/IE-2** (a send path and a wire path own one broken callback) and **CI-2/SM-2** (an identity invariant enforced by a database trigger) | **2026-09-01**, then weekly | L-ENG-2 / `seam-arbitration-check` skill | [[engineering-loops]] L-ENG-2; premortem M1 |

### 3.2 platform-api — *the unauthenticated request*

| # | Task | Doneability | close_time | Carrier | Evidence |
|---|---|---|---|---|---|
| **PA-1** | `check_route_guard_census` — one reproducible script, four numbers | A rerun on the same commit yields the same four counts (total / guarded / `@Public()` / unguarded-by-omission), and the per-PR job fails on any **increase** in the fourth. Reproducibility is the quality bar because there is no verdict basis for a census | **2026-09-11** | L-PA-1 per-PR / `route-guard-census` card | Three counts exist today from three methods and no script: [[ENDPOINTS]] says 450/411/30/**9**; OD-19 says 459/17/419/**40**; this agenda measured 463/432/25/**6**. All three are defensible and none is reproducible. That is the whole argument |
| **PA-2** | Regenerate [[ENDPOINTS]] from PA-1's output and clear its 🔴 open finding | The atlas is generated, not hand-edited (its own header says so), and the "9 genuinely unguarded tenant data" finding is closed with the line that closed it: `toast/toast.controller.ts:63` carries `@UseGuards(JwtAuthGuard)`, `:80` marks only the webhook `@Public()` | **2026-09-11** | L-PA-4 monthly | verified at HEAD; OD-19's own row already records that the atlas is stale on exactly this point *and that it did not get corrected there* |
| **PA-3** | Protection-**by-default**: the mechanism design and the case for it | A written design for a global `JwtAuthGuard` + a CI-diffed public-route allowlist, costed against the 25 routes that legitimately need the hatch, with the two numbers modelled side by side (coverage vs default). **A design and a decision request — not a build.** The founder answers before a line is written | **2026-10-02** | L-PA-2 weekly; escalates via [[engineering-questions]] → [[decision-office-charter]] | `app.module.ts:127-133` (only `RateLimitGuard` + `TenantGuard` global); `common/tenant/tenant.guard.ts:47-50` fails open by design and says so in source; premortem M2 |
| **PA-4** | Publish the seven `communications` test/E2E routes that mutate real data with no environment gate | Each of the seven is gated by environment, deleted, or accepted in writing with a named owner. `POST /communications/test/e2e/step2-approve-reorder` approves a real procurement order and `step3-send-vendor-email` sends a real vendor email | **2026-09-18** | L-PA-2 weekly | [[ENDPOINTS]] §Also worth a decision, citing `communications.controller.ts:675,755`; they carry explicit `@Public()`, so PA-1's census will *not* catch them — this is the census's known blind spot, stated |

### 3.3 client-surfaces — *the unusable screen*

| # | Task | Doneability | close_time | Carrier | Evidence |
|---|---|---|---|---|---|
| **CS-1** | **The per-page UI-compatibility & dead-end audit** across all 51 routes | Every page note's §10 maturity verdict is re-verified against the running app at a named commit; every §0 Surface dead-end declaration is confirmed against the live router; the audit output is a diff against the previous run, not a fresh opinion. Today's distribution — 8 complete / 25 partial / 9 hollow / 5 broken over 49 notes — becomes a tracked series | **2026-10-16**, then monthly | L-CS-4 weekly + monthly PAGE_MAP refresh / `surface-reachability-auditor` card | frontmatter census over `.planning/06-pages/*.md`, 2026-08-28; [[PAGE_MAP]] (48 routes, 51 at the 2026-08-25 re-verification, 12 route components unresolved); `06-pages/PAGE-CONTRACT.md` §0, §10 |
| **CS-2** | The five **broken** pages, first | `receiving`, `recommendations`, `recommendations-catalog`, `studio`, `studio-queue` each reach `partial` or better, or are retired with a tombstone. Broken outranks hollow because a broken primary path is the only class a restaurant reports on its own | **2026-10-02** | L-CS-3 weekly | the five `maturity: broken` frontmatter values, listed above by name |
| **CS-3** | **No page presents an action that does not persist** — the hollow-page rule | Each of the nine `hollow` pages either persists what it claims to, or renders the absence honestly (empty state, disabled control, stated reason). `communications`, `dashboard`, `documents-reports`, `no-access`, `reports`, `settings`, `sommelier`, `vendor-prices`, `wines` | **2026-10-30** | L-CS-3 weekly | nine `maturity: hollow` values; `PAGE-CONTRACT.md` §10 — "a page that looks finished and lies is worse than one that is obviously unfinished, and this repo has shipped several" |
| **CS-4** | Turn `surfaces.reachable_route_ratio` into a job | The orphan-route count comes from a script run per PR, not from a one-time analysis. The current baseline (24 orphans, 13 untraceable components) has never been re-derived; **7 page notes declare themselves dead-ends** (`admin`, `admin-health`, `calendar`, `dev-sandbox`, `documents-reports`, `logs`, `receipts`) and that is a second, independent number | **2026-09-18** | L-CS-1 per-PR / feeds **D-4** | [[README]] §0 baseline; `grep -l "no outbound navigation — dead-end page" 06-pages/*.md` → 7; premortem M5 (burn-down replacing judgement) |
| **CS-5** | Mobile parity as a published number, monthly (**P3.A support**) | `apps/mobile` presents **11%** of the web feature set the page notes describe (11 `yes` + 27 `part` + 181 `no`). The number is republished monthly with the next slice named. This lane is gated on nothing | **monthly, first 2026-09-30** | L-CS-5 monthly | `04-specs/P3A-MOBILE-PARITY-GAP.md` §0, measured 2026-08-27 at `190432aa`; [[0029-p3-plan-of-record]] §2 |

### 3.4 schema-migrations — *the drifted database*

| # | Task | Doneability | close_time | Carrier | Evidence |
|---|---|---|---|---|---|
| **SM-1** | **Shrink-only schema-debt ratchet** | The four drift counts live in a checked-in file and CI fails if any **rises**. First deliverable is a **re-measure**, not a burn-down: the recorded 27 ghost tables / 13 ghost functions / 23 dead tables / 403 ghost columns are the *pre-baseline* inventory and cannot be burned down until they are re-taken against today's 79 migrations | **2026-09-18** | L-SM-1 per-PR / feeds **D-4** | `07-reference/SCHEMA_DRIFT_INVENTORY.txt:4,33,48,73`; `scripts/check_schema_parity.sh:6-11` records the incident verbatim |
| **SM-2** | Get schema-parity's **production** arm green | Every migration in `supabase/migrations/` is applied to production and the daily parity run is green two consecutive times. Three migrations are dated after the last recorded apply — `20260827100000_photo_count_suggestions`, `20260827140000_ai_proposed_actions`, `20260827170000_ai_proposed_actions_edits`. **I could not verify production state from this worktree**; the count of unapplied migrations is from STATE plus file dates, not from a query | **2026-09-04** | `.github/workflows/schema-parity.yml` (cron `0 6 * * *`) / L-SM-1 | [[STATE]] §"Not done until applied"; `ls supabase/migrations/` |
| **SM-3** | OD-110 prerequisite: regenerate `Database` for all 117 queried tables and **re-measure** | The generated type covers every table the gateway queries, and the `any`-share census is re-run and published. **The decision to parameterise `DatabaseService.supabase` stays OD-110's** — this task delivers the measurement and a costed proposal, and resolves nothing | **2026-10-16** | L-SM-4 monthly; escalates to [[decision-office-charter]] | verified 2026-08-28: `apps/api-gateway/src/database/database.service.ts:8` is `public supabase: SupabaseClient` with no generic; `packages/database/src/types/database.types.ts` covers **8** tables; OD-110 measured 12.3% of 28,661 member accesses on `any` |
| **SM-4** | **Track A2** — `api_spend` gains `task_type`, plus a parity guard | The joined cost-per-task view returns one number end to end, and a guard fails if the two ledgers' grains diverge again. Engineering authors the migration; the producer half is [[model-routing-inference-economics-charter]]'s | **2026-09-11** | L-SM-1 per-PR | [ADR 0039](../../../decisions/0039-activation-plan-of-record.md) Track A2; OD-29's resolution line records the grain divergence and that the fix was left unscheduled |

### 3.5 catalogue-identity — *the wrong product identity*

| # | Task | Doneability | close_time | Carrier | Evidence |
|---|---|---|---|---|---|
| **CI-1** | Build the labelled identity set, so `identity.false_merge_count` is a **reading** rather than a policy | A ground-truth set exists, is versioned, and the CI gate scores against it. The gate machinery is already wired — it is the set that is missing | **2026-09-18** | `.github/workflows/ci.yml:552-555` (`build_merge_eval_set.py` → `eval_merge_policies.py`) / `identity-adjudicator` card | charter §Evidence states the gap plainly; `scripts/eval_merge_policies.py:5-13` — false merges and false splits "must never be summed into one score" |
| **CI-2** | Measure the **duplicate residue** from the signature-hash drift window | A count of duplicate identity pairs created while the UNIQUE index was silently inert, each with a merge/split/leave decision graded against CI-1's set. **1,431 of 4,094 rows (35%)** carried a `signature_hash` that did not match their own columns, which disabled the index that prevents duplicate wines. The trigger now stops it recurring; nobody has counted what got through | **2026-09-25** | monthly near-key duplicate sweep / `identity-adjudicator` card | `supabase/migrations/20260826180321_signature_drift_protection.sql:1-4` — the migration states the measurement in its own header |
| **CI-3** | Wire or delete `check_display_name_parity.py` and `check_beverage_kind_regression.py` | Each is invoked by a workflow, or removed with a line saying why. Both exist on disk and neither is referenced anywhere under `.github/` | **2026-09-04** | per-PR CI / rolls into **D-3** | repo sweep 2026-08-28; [[engineering-schedule]] lists `check_display_name_parity.py` as a running per-PR guard, which it is not |

### 3.6 inventory-ledger — *the wrong stock number*

| # | Task | Doneability | close_time | Carrier | Evidence |
|---|---|---|---|---|---|
| **IL-1** | Stand up the daily projection-divergence sample | Rows where `stock_live` ≠ sum of lots, sampled daily, target zero, published even when zero. The metric is specified as "sampled daily" and no sampler is cited anywhere | **2026-09-11** | L-IL-1 daily / `ledger-divergence-sentinel` card | [[inventory-ledger-charter]] §Evidence — "What is *not* in evidence: a daily divergence sampling job" |
| **IL-2** | Assert the **alarm state**: green guard ∧ divergent data | A check that fires specifically on the combination — CI green while the sample is non-zero — rather than on either alone. This is the exact shape of the receiving-service bug: the guard type-checked while the code wrote nonexistent columns | **2026-09-25** | L-IL-2 weekly, feeding L-ENG-3 | `scripts/check_no_direct_stock_writes.sh:10-13` documents its own blind spot; premortem M4 |

### 3.7 messaging-delivery — *the undelivered or duplicated message*

| # | Task | Doneability | close_time | Carrier | Evidence |
|---|---|---|---|---|---|
| **MD-1** | The `notification_id`-keyed delivery ledger | Duplicate and drop rates are computed per `notification_id`, never from user reports — a restaurant reports forty duplicates and never reports the alert that never arrived. Until the ledger exists, both metrics publish as `unreadable`, not as zero | **2026-10-02** | L-MD-1 daily / `delivery-ledger-auditor` card | [[messaging-delivery-charter]] §Evidence — no such ledger exists; `agents/buffer_manager.py` holds batching state in memory |
| **MD-2** | **Every SMS we send declares a delivery-status callback to a domain we do not own** | Either a real callback host with a receiving route, or the parameter is removed and SMS/voice delivery status is declared unmeasurable **in writing** on the board. Silence is not an option: today the send succeeds, the callback goes nowhere, and `messaging.drop_rate` for SMS is structurally unmeasurable while looking merely unmeasured | **2026-09-11** | L-MD-1 daily; **seam with IE-2**, arbitrated by D-5 | verified 2026-08-28: `services/agent-orchestrator/services/plivo_client.py:196` passes `url="https://your-domain.com/webhooks/plivo/status"` on every message; same placeholder at `plivo_voice_client.py:55` and `agents/procurement_agent.py:70` |

### 3.8 integration-engineering — *the broken third-party contract*

| # | Task | Doneability | close_time | Carrier | Evidence |
|---|---|---|---|---|---|
| **IE-1** | Measure `integration.verified_signature_coverage` for the first time | Per public route, a test proving an unsigned request is **rejected**. Coverage is the share of the 25 `@Public()` routes carrying such a test. The Toast webhook is the one proven case (HMAC-SHA256 over `toast-signature`) and is the template | **2026-10-02** | L-IE-2 weekly / `wire-sentinel` card | `toast/toast.controller.ts:97-117`; charter §Evidence grades this team PARTIAL precisely because the signature half is unmeasured |
| **IE-2** | Placeholder-host sweep across every wire path | No placeholder domain appears in a runtime path. Three do today; a fourth (`abc123.ngrok.io`) appears only in a dev script's docstring and is **not** a defect — say so rather than counting it, since inflating the number is how this class of sweep loses credibility | **2026-09-11** | L-IE-3 per-PR; **seam with MD-2** | `plivo_client.py:196`, `plivo_voice_client.py:55`, `procurement_agent.py:70`; `scripts/ngrok_live_test.py:11,13,263` is the benign one; [[EXTERNAL_CONNECTIONS]]:151 |
| **IE-3** | Arrival-timestamp baseline per integration, so silence detection can exist | Each integration has a recorded normal arrival cadence. The hourly silence watch has **no input** today — arrival timestamps have no publisher — so the loop is a diagram until this lands | **2026-10-16** | L-IE-1 hourly / `wire-sentinel` card §5 gap row | [[integration-engineering-agent-stack]] §5: "arrival timestamps per integration — publisher: NONE" |

### 3.9 procurement-vendor-network — *the wrong money*

| # | Task | Doneability | close_time | Carrier | Evidence |
|---|---|---|---|---|---|
| **PV-1** | Order-to-delivery reconciliation, with the "without human repair" clause enforced | A line that reconciled because a person fixed it by hand counts **against** the rate. Any implementation that cannot distinguish the two is rejected rather than shipped with a caveat | **2026-10-02** | L-PV-1 weekly / `spend-path-auditor` card | [[procurement-vendor-network-charter]] §Metrics and §Evidence — "What is *not* in evidence: any reconciliation measurement" |
| **PV-2** | Re-verify and republish the money-path exposure line | The charter's named exposure — 6 unguarded routes on the one module that places orders automatically — is **closed**; the daily watch continues so the closure is a measured state rather than a memory | **2026-09-04** | L-PV-2 daily | `procurement/recurring-orders.controller.ts:24-35` — the source comment records that the controller had no guard and now carries `@UseGuards(JwtAuthGuard)` |
| **PV-3** | **Track A3, executor half** — bring `recurring_order_agent` inside `BaseAgent` and the action centre | The one module that spends money on its own scheduler runs through the same typed propose→confirm→execute path as every other mutation. Today it is the fleet's single orphan on both counts | **2026-10-30** | `run_card.py` fleet census (daily-capable); gate is [[action-safety-the-human-gate-charter]]'s | `python3 scripts/agents/run_card.py` 2026-08-28 → `fleet.orphan_modules = 1`, "unregistered modules: recurring_order_agent"; `harness.agents_without_harness_guarantees = 1`, "modules with a class outside BaseAgent: recurring_order_agent"; [ADR 0039](../../../decisions/0039-activation-plan-of-record.md) Track A3 |

---

## 4. Locks this agenda respects

- **Pricing model — deferred.** Nothing here prices, meters, or gates a surface by
  plan. `03-scenarios/TIER-MAP.md` tier cuts stay recorded per page and unenforced.
- **Brand and landing visuals — held.** The **72** user-visible `WineOps` strings
  counted across the page notes stay **counted, not changed**. CS-1 reports the number
  as a per-page field; it does not schedule the swap. The rebrand is a visual change
  and the visuals are held (founder re-confirmed 2026-08-28).
- **NF-B guests — held.** No task touches `guests`, `guest_identifiers` or
  `guest_check_links`. `check_no_guest_name_matching.sh` and `check_no_raw_guest_channels.sh`
  keep running; they are guards over a held slice, which is exactly right.
- **Open forks stay open.** TECH-F1, TECH-F2, TECH-F5, OD-19, OD-110 and OD-29's
  remaining surface are referenced and not resolved. SM-3 and PA-3 deliver
  *measurements and proposals*, and say so in their doneability.

---

## 5. Findings — things no card or loop can carry

Recorded rather than listed as tasks, per §8.2.2–3. Each names where it goes.

| # | Finding | Why it is not a task here | Goes to |
|---|---|---|---|
| **F-1** | [[ENDPOINTS]]'s 🔴 open finding is stale — `toast/toast.controller.ts:63` is guarded — and OD-19's row *already says the atlas needs the same correction and did not get it*. The fact is platform-api's; the file is a foundation atlas | Engineering does not own `.planning/foundation/`. PA-2 delivers the corrected census; the atlas edit needs its owner | [[knowledge-documentation-questions]] |
| **F-2** | OD-19's Security assignment is materially smaller than recorded: the 40 routes on the five controllers without class-level guards resolve to **6** residual unguarded-by-omission routes, all `auth` credential routes that cannot carry a JWT | OD-19 is Security's assignment and an open register row. Engineering supplies the measurement; it may not close another department's OD | [[security-questions]] |
| **F-3** | **Zero of Engineering's 9 declared agents is `mechanical`**, so the largest department in the org has no agent that executes. Its four census-shaped numbers are exactly the runner's scope | D-4 is the response, but the card reclassification is an edit to the nine `*-agent-stack.md` files, which this wave may not touch | Post-wave PR; [[engineering-questions]] |
| **F-4** | `seam.question_opened` has no publisher — `questions.md` entries are hand-authored and nothing emits on a new one, so L-ENG-2 is blind for up to 7 days at a time | The bound is the loop's close_time, which is acceptable. Naming the blindness is the honest alternative to pretending the trigger works | [[engineering-agent-stack]] §5, already filed |
| **F-5** | `eng_board_rollup` NF-A events have no declared consumer — an emit with no consumer, which is the shape that left a subscribed topic dead for months at `core/orchestrator.py:198-206` | No division-level rollup agent is chartered; Engineering cannot charter one | [[platform-charter]] |
| **F-6** | The charter's §Evidence is stale in four places (§0). Charters are wave-1 artifacts | This wave edits agendas only | [[engineering-questions]] → next charter revision |
| **F-7** | All 198 agenda files were dated within one wave, so they hit the 60-day staleness rule **together**, on 2026-10-27. `watch_loops.py:10` predicted this exact failure at 2026-10-23 before the wave ran | A department cannot stagger an org-wide date | [[decision-office-charter]] |

---

## 6. Questions for the founder

1. **Protection-by-default (PA-3) — is the global guard worth it now that 457 of 463
   routes state their intent?** The measured exposure that motivated premortem M2 is gone: 6 unguarded
   routes remain and all six are auth credential routes. What remains is a
   *mechanism* question — opt-in coverage can regress silently, a global default
   cannot. The build is cheap; the escape hatch is the risk M2 named. **Recommendation:
   yes, but as a ratcheted census first (PA-1) and the global guard second**, so the
   decision is made against a number that cannot drift.
2. **TECH-F2 — 8 teams or 6?** Carried from the founding agenda, still open. This
   agenda gives [[schema-migrations-charter]] four tasks and [[messaging-delivery-charter]]
   two, both with independent evidence and independent carriers, which is weak
   evidence *for* keeping them distinct. Weak, not decisive.
3. **Does `identity.false_merge_count` block?** `eval_merge_policies.py:5-13` says the
   two error types must never be summed. If a change improves splits and costs one
   merge, the charter says reject. CI-1 makes this real rather than rhetorical —
   confirm before the set exists, not after the first rejection.
4. **The 72 `WineOps` strings.** They are counted per page and held under the visuals
   lock. Is the *string* migration part of the visuals hold, or separable from it? This
   agenda assumed **part of it** and scheduled nothing.
5. **SM-2's blind spot.** I could not verify production migration state from this
   worktree — the unapplied count comes from STATE plus file dates. If the parity job's
   production arm has gone green since 2026-08-27, SM-2 closes on inspection.

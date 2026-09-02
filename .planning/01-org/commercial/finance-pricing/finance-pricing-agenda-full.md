---
type: agenda-full
division: commercial
department: finance-pricing
sublayer_of: growth
status: active
metrics: [nf_a.cost_per_completed_task, fin.spend_reconciliation_variance_pct, fin.spend_attribution_coverage_pct, fin.metered_invocation_coverage_pct, fin.hours_since_last_spend_row, fin.monthly_provider_spend_vs_cap_pct, fin.cost_to_serve_per_restaurant_month, fin.external_price_quotes_logged, fin.non_design_partner_restaurant_count]
updated: 2026-08-28
links: ["[[finance-pricing-charter]]", "[[finance-pricing-premortem]]", "[[finance-pricing-directive]]", "[[finance-pricing-loops]]", "[[finance-pricing-schedule]]", "[[finance-pricing-agent-stack]]", "[[finance-pricing-agenda-board]]", "[[finance-pricing-questions]]", "[[inference-cost-charter]]", "[[inference-cost-agent-stack]]", "[[unit-economics-pricing-charter]]", "[[unit-economics-pricing-directive]]", "[[unit-economics-pricing-agent-stack]]", "[[growth-charter]]", "[[model-routing-inference-economics-charter]]", "[[neural-footprint-instrumentation-charter]]", "[[agent-evaluation-gates-charter]]", "[[schema-migrations-charter]]", "[[knowledge-documentation-charter]]", "[[strategy-fundraising-charter]]", "[[decision-office-charter]]", "[[red-team-charter]]", "[[0039-activation-plan-of-record]]", "[[0036-cost-routing-two-plans-in-harmony]]", "[[0038-cards-run-as-declared-scripts]]", "[[0017-doneability-verdicts-are-sidecar-claims]]", "[[0016-ledgers-must-express-unknown]]", "[[OPEN-DECISIONS]]"]
---

# Finance & Pricing — Full Agenda

> **Active — 2026-08-28.** Rewritten from `PROVISIONAL` under
> [[0039-activation-plan-of-record]] Track B. Every task names a **doneability**, a
> **close_time**, and the **evidence** that makes it real. Tasks no card and no loop can
> carry are in §6 as findings, not listed here as work.
>
> **Two locks hold, re-confirmed by the founder 2026-08-28.** The **pricing model is
> deferred** — this agenda contains no price, tier, rate or recommendation of one, and
> §5 builds the guard that makes that testable rather than remembered. Brand/landing
> **visuals are held** — nothing here touches them. Payment-rails *research* and the
> *unlock case* are explicitly permitted (`GENERATION_BRIEF.md` §8.2.4) and are §5's
> subject; acting on either is not scheduled.

---

## 1. Six dated corrections — the 2026-08-24 forecast is stale in six places

Measured in this worktree on **2026-08-28**, each with the command that produced it. The
old agenda's opening position — *"six of nine metrics have never been read"* — is no
longer the honest one, and starting from the stale version would schedule work that is
already done.

| # | The 2026-08-24 claim | What is true on 2026-08-28 | How it was measured |
|---|---|---|---|
| 1 | *"`fin.metered_invocation_coverage_pct` — unknown; no callsite census exists"* | A **running guard** measures it. Gateway: 1 file references a provider, **0 unrouted**. Python: **18 call sites, 18 log spend, 0 known unlogged debt.** The census is no longer a document to write | `bash scripts/check_model_calls_logged.sh` → PASS |
| 2 | *"`SpendLogger.log()` has no `agent` parameter"* | It takes `agent`, `agent_fallback` **and** `task_type` (`spend_logger.py:269-271`) — but they reach only `neural_footprint_event` (`:406-418`). The `api_spend` insert is still the original seven fields (`:367-377`) | read + `grep -n task_type supabase/migrations/*.sql` |
| 3 | *"nothing grades completion yet"* (the reason L-FIN-3 is gated) | **39 task types emit, 27 carry a verdict, 12 are knowingly exempt, 0 ungraded.** The denominator the directive demands exists for 27 of 39 | `python3 scripts/check_task_types_are_graded.py` → PASS |
| 4 | *"cost per task is not derivable"* | Two verdict-joined views have existed since 2026-08-25 — `nf_a_cost_per_verified_task` and `nf_a_verdict_coverage` (`20260825180000_nf_verdict.sql:120,167`) — and **nothing reads either one** | `grep -rn nf_a_cost_per_verified_task scripts apps services` → 0 hits |
| 5 | *"OD-11 is open; any column F1 adds is a bridge"* | **OD-11 is resolved** — Path C, [[0008-nf-column-contract]], 2026-08-24, "P1 unblocked" (`OPEN-DECISIONS.md:123`). [[finance-pricing-charter]]:160 still calls it open; charters are not this wave's to edit (§8.4) | register read |
| 6 | *"the caps are `$40`/`$16`"* | Those still run hourly — **and a second, entirely separate cap system shipped**: per-restaurant, per-tier dollar ceilings in the gateway (`spend-tiers.ts`), enforced over a **different ledger**, failing open, reporting a breach only as a log line | read, see FIN-A3 |

**What did not change.** Reconciliation against a provider invoice has **still never been
run**. No price-quote register exists. No payment processor exists. The two numbers this
sub-layer publishes are still one LEDGER-ONLY and one UNMEASURED
([[finance-pricing-directive]]).

---

## 2. The shape of the year, in one sentence per lane

1. **Make the money view of the spine readable** — F1 ([[inference-cost-charter]]). The
   spine exists and is instrumented; what is missing is a *reader that tells the truth
   about the denominator*. This is the lane with the most already-built substrate and the
   least published output.
2. **Research the rails, register the anchors, build the lock's teeth** — F2
   ([[unit-economics-pricing-charter]]), dormant and staying dormant. Research and
   guardrails only; no model, no number.
3. **Make both team cards run** — [[0038-cards-run-as-declared-scripts]]. Both are
   declared `mechanical` and **neither is implemented**; the runner says so out loud.

**Sequence is forced, not chosen.** A published cost number that has never been checked
against an invoice is [[finance-pricing-premortem]] D2, so FIN-A5 (reconcile once) gates
how loudly FIN-A2's number may be spoken — not whether it is produced.

---

## 3. Lane A — F1 · the money view of the spine ([[inference-cost-charter]])

| ID | Task | Doneability — how you know it moved | close_time | Evidence it is real |
|---|---|---|---|---|
| **FIN-A1** | **Give the verdict-joined views a reader.** Extend `scripts/nf_readout.py` with a `--verified` mode over `nf_a_cost_per_verified_task` + `nf_a_verdict_coverage` | A reviewer runs `python3 scripts/nf_readout.py --verified` on the same commit and gets cost per **verified** task by `basis`/agent/task_type **with `graded_pct` in the same table**; the mode refuses to print a cost figure without its coverage fraction; exit 2 when the views are missing | **2026-09-11** | Views exist and have **zero readers**: `20260825180000_nf_verdict.sql:120-146,167`; `nf_readout.py:219` executes only `nf_a_cost_per_completed_task`. Directive §"The denominator rule". Loop `fin-cost-efficiency-review` (gated) |
| **FIN-A2** | **Publish the first cost-per-verified-task readout, graded.** One dated figure on [[finance-pricing-agenda-board]] | The board carries: cost per verified success **per basis** (never averaged across bases), `nf_a_verdict_coverage.graded_pct`, and the directive grade (`LEDGER-ONLY` until FIN-A5) — **or** the words `INSUFFICIENT VOLUME`. Never a blank, never a `0` (ADR 0016) | **2026-09-30** | 27 of 39 task types carry a verdict (`check_task_types_are_graded.py`, 2026-08-28). ADR 0017 §"basis is grouped, never filtered". OD-04 is blocked on exactly this number (`OPEN-DECISIONS.md:27`) |
| **FIN-A3** | **Reconcile the two cap systems.** Produce one cap map: for each ceiling — its ledger, its window, its failure direction, whether a breach is countable | A written map exists and `fin.cap_breach_count` is either defined over **both** systems or explicitly declared uncountable for one, with the reason. No cap raise is proposed without a cost-to-serve figure (L-FIN-5's rule) | **2026-09-30** | System 1: hourly, `api_spend`, `$40`/`$16` (`jobs/spend_tasks.py:23-27,136`; `celery_app.py:106-110`). System 2: per-restaurant per-tier, over `neural_footprint_event`, suppresses **only transport retries**, **fails open** and logs a `warn` (`model-client.service.ts:500-549`, esp. `:530,538-544,546`; `spend-tiers.ts:41-48`). Charter: caps and breach handling are F1's |
| **FIN-A4** | **Extend `check_model_calls_logged.sh` to `scripts/`.** The guard's blind spot is the one surface with dated, deliberate off-ledger spend | The guard scans `scripts/`, the new debt list is **non-empty at first commit and shrink-only**, it **exits 2** when it cannot check (dir missing, pattern rotted), a planted violation is shown to fail, and CI runs it | **2026-09-18** | **11 provider-referencing files under `scripts/` write nothing to the ledger** (`grep -rIl` for provider clients, 2026-08-28). `scripts/enrich_wines.py:349` and `scripts/extract_menu_corpus.py:307` compute `cost_usd` into a local manifest. Commit `8bbcde6` ran a backfill *"in-session instead of on API credits"*. The guard's own NEVER VACUOUS section is the exit-2 pattern |
| **FIN-A5** | **Run the first ledger ↔ invoice reconciliation, by hand.** One month, two consoles, one variance number | `fin.spend_reconciliation_variance_pct` exists for one calendar month, recorded **especially if it is bad**, with the retrieval dates named — **or** an explicit `BLOCKED` line naming who lacks console access. Manual by design until two consecutive months agree | **2026-09-30** | Never run, ever (charter §Metrics). Console access is *"assumed, **not verified**"* ([[inference-cost-schedule]] §Dependencies). Premortem D2. Loop `fin-ledger-invoice-reconciliation`, monthly |
| **FIN-A6** | **Stand up the absence alarm, and give the drop counter a reader.** The alarm that fires on an *empty* table | A check fails when the newest `api_spend` row is older than **N** hours while the beat schedule is green, with N derived from observed cadence and written down; and `get_drop_counts()` is read somewhere other than a test | **2026-09-18** | The cap check sums and is structurally incapable of firing on zero (`spend_tasks.py:35-60,136`). Inserts never raise; failures are a warning plus a **process-local** counter (`spend_logger.py:378-385`) whose only consumers today are `tests/test_spend_logger.py:232-272` (`services/neural_footprint.py:47`). Premortem D2. Loop `fin-meter-liveness`, daily |
| **FIN-A7** | **Implement `spend-ledger-auditor` as a declared mechanical card** | `python3 scripts/agents/run_card.py` prints the card's metrics under its own heading, the card moves into `IMPLEMENTED` (`run_card.py:333-342`), and the runner's *"not implemented"* count drops from 32 to 31 | **2026-10-15** | Runner output 2026-08-28: *"36 mechanical cards declared · 32 mechanical not yet implemented"*, list includes `spend-ledger-auditor`. Card declared in `00-index/cards.json` (`routing_class: mechanical`). `spend-sentinel` is the working precedent in the same file |
| **FIN-A8** | **Consume Track A2 the day it lands — fetch, never recompute.** Standing weekly watch until then | *Weekly*: the board reads either `A2 not landed — api_spend still 8 columns (checked <date>)` or the landed date. *On landing*: within one weekly close, one joined cost-per-task figure with its **named producer**, plus a parity line against the NF-side figure — and `grep` shows **no second computation of cost-per-task inside this sub-layer** | **weekly from 2026-09-04**; the landing task closes **one weekly close after A2 merges** | [[0039-activation-plan-of-record]] Track A2. [[0036-cost-routing-two-plans-in-harmony]]: RM-1 owns the methodology, `aio-model-routing` the operation, **this division fetches** ([[finance-pricing-agent-stack]] §5). The grain divergence is live today: `api_spend` is still 8 columns (`baseline:2229-2238`), the NF row carries `subject_id` + `task_type` (`spend_logger.py:406-418`) |

**The coordination rule still binds.** None of the above authors a schema change. FIN-A1
and FIN-A2 are read-only over views [[neural-footprint-instrumentation-charter]] owns;
FIN-A8's column is [[schema-migrations-charter]]'s migration under Track A2. F1 owns the
**money view**, never the spine ([[finance-pricing-directive]] §"The coordination rule").

---

## 4. Lane B — F2 · rails, anchors, and the lock's teeth ([[unit-economics-pricing-charter]])

> **This team stays dormant.** Its entry trigger — *the first restaurant that is not the
> design partner, or the founder un-deferring pricing* — has **not fired**. Everything
> below is research, registration, or a guard. Nothing below proposes a price, a tier, a
> rate, or a model, and FIN-B5 exists to make that a machine-checkable claim.

| ID | Task | Doneability — how you know it moved | close_time | Evidence it is real |
|---|---|---|---|---|
| **FIN-B1** | **Payment-rails research → dated library entries.** Three branches: Stripe-class rails (card + ACH + hosted invoicing), invoicing-only options, and **marketplace/platform** models for restaurant B2B | One `05-library/` entry per option, each with `verified: <date>`, the source URL, `status: candidate`, `decision: null`, and an index row in `05-library/README.md`. Where a capability could not be fetched the entry says **UNVERIFIED** rather than describing it. Each entry states in one line that a **vendor's own published fee schedule is a fetched fact about that vendor, not a Mudavym price** | **2026-10-02** | Charter non-goal: *"Billing, invoicing, payment collection — **Nobody**"*. No payment processor among the runtime hosts ([[EXTERNAL_CONNECTIONS]]); `grep -i stripe` over `apps services packages scripts` returns **17 hits, all CSS `striped`** (2026-08-28). Library rules and shape: `05-library/README.md`, `05-library/answerthepublic.md` |
| **FIN-B2** | **The comparison artifact.** One document across the three branches | Per option it states: **who holds the funds**, what registration/regulatory posture it implies **for us**, the integration surface **in this repo**, what it forecloses, and **what it does not tell us**. The `winner` field stays `null` — the library does not decide (rule 3). Contains no Mudavym price and passes FIN-B5's guard | **2026-10-09** | `GENERATION_BRIEF.md` §8.2.4 (research permitted, acting past the lock is not). Premortem D3. Library rule 2: *nothing here is adopted* |
| **FIN-B3** | **Map the restaurant-B2B money flow the product already writes.** Decides whether FIN-B1's marketplace branch is real or decorative | A one-page map of every money-shaped field already in production, each marked **our money** or **the restaurant's money** — and a stated verdict on whether the platform-payments branch has a product surface to attach to | **2026-09-25** | `providers.payment_terms` defaults to `'Net 30'` (`baseline:4899`). `procurement_orders.payment_due_date` drives a live daily cron, per tenant, gated on the orders category (`scheduled-tasks.service.ts:520-549`). The credits/recovery surface is [[design-partner-operations-charter]]'s, not ours |
| **FIN-B4** | **Open the anchor register — and populate it with the anchors that already exist.** It is not empty on day one | A register file exists carrying **at minimum the five dollar figures already shipped in code**, each with its date, author, and framing verbatim, plus every externally-quoted number thereafter. `fin.external_price_quotes_logged` stops reading *"no register exists"*. **Registering an existing internal placeholder is not proposing a price** — the register records anchors so they can be argued with | **2026-09-11** | `apps/api-gateway/src/common/model-client/spend-tiers.ts:1-22,35-48` — `core` **$5 one-time credit**, `plus` **$5/day**, `pro` **$10/day**, founder-set 2026-08-24, header states *"PLACEHOLDER NUMBERS, deliberately… must not be cited as one"*. Premortem D3: *the anchor arrives before the model*. Loop `uep-price-quote-register`, weekly |
| **FIN-B5** | **Build `no-price-proposed-guard`.** The directive calls the pricing rule *"absolute and testable"*; today it is neither — no guard exists | A grep guard fails on a currency-shaped figure under `teams/unit-economics-pricing/` outside the register; **exits 2** when it cannot check (directory gone, pattern rotted, register missing); is proven by planting a violation against the pre-fix tree; runs in CI | **2026-09-18** | `ls scripts/check_*` on 2026-08-28: **no price or pricing guard exists**. Directive §"The pricing rule is absolute and testable" names the precedents: `check_no_direct_stock_writes.sh`, `check_no_guest_name_matching.sh`. Exit-2 discipline: `check_model_calls_logged.sh` §NEVER VACUOUS |
| **FIN-B6** | **Tier-vocabulary census.** Three "tier" vocabularies exist, none is a price, and they are converging on the same three words | One table naming each vocabulary, its source of truth, its consumer, and the sentence that says it is not a price; cross-linked from the FIN-B4 register | **2026-09-25** | (a) `restaurants.subscription_tier`, default `'pilot'` (`baseline:3582`), read at `model-client.service.ts:551-563`. (b) `spend-tiers.ts` allowances keyed `core/plus/pro`. (c) **OD-48 locked "Tiers = Core / Plus / Pro"** as *scenario* tiers, with *"Price points remain open (OD-23)"* (`OPEN-DECISIONS.md:32`). Premortem D3 |
| **FIN-B7** | **Define the entry-trigger query — or declare it undefinable, in writing** | Either a committed count with a **named design-partner discriminator**, or a written statement that no discriminator exists and what would create one. Either way the weekly watch records the number — **or the word `undefined`** — every week. A counted zero and a missing count are different (ADR 0016) | **2026-09-11**, then **weekly** | [[unit-economics-pricing-agent-stack]] §2: *"the exact query is **NOT verified**"*. The `restaurants` table has **no design-partner column** (`baseline:3566-3599`); `subscription_tier` is a default, not a marker. Trigger text: `commercial.md:313-316`. Loop `uep-entry-trigger-watch`, weekly |
| **FIN-B8** | **Implement `pricing-trigger-warden` as a declared mechanical card.** Depends on FIN-B7 and FIN-B4 | It runs under `run_card.py`, emitting the trigger count (or `undefined`), the register size, and any unregistered-quote incident; the runner's unimplemented count drops again | **2026-10-23** | Runner output 2026-08-28 lists `pricing-trigger-warden` among the 32 declared-not-implemented. Card in `00-index/cards.json` (`routing_class: mechanical`). ADR 0038 |

---

## 5. Lane C — the sub-layer itself

| ID | Task | Doneability — how you know it moved | close_time | Evidence it is real |
|---|---|---|---|---|
| **FIN-C1** | **Prepare the unlock case. Do not act on it.** Explicitly permitted by §8.2.4 | One readiness document stating (a) what F2 would need on day one, (b) which of those exist today, cited, (c) the two founder questions that gate it, and (d) **no price, no tier, no model** — verified by FIN-B5's guard, not by assertion. It is a readiness pack; no work downstream of the unlock is scheduled | **2026-10-09** | `GENERATION_BRIEF.md` §8.2.4; ADR 0039 Track B quality bar; charter §Boundaries *"the pricing decision, when it un-defers — **ownership only**"* |
| **FIN-C2** | **Ship `two-number-separation-check` as a real skill** | `.claude/skills/two-number-separation-check/SKILL.md` exists, has **fired at least once** against a real artifact with the firing recorded, and the registry index is refreshed by `registry-clerk` | **2026-10-15** | [[finance-pricing-agent-stack]] §3 carries the row **and its required past instance** (the 2026-08-24 PARTIAL grading found by hand). `.claude/skills/` holds 4 skills today. Registry ownership is [[skills-charter]]'s, authorship is ours |
| **FIN-C3** | **Compute the CM-F4 placement report — do not assert it** | The quarterly report derives the `outputs_to` distribution from `00-index/loops.json`, not by hand, and states either a recommendation to [[decision-office-charter]] **with the loop table attached** or an explicit *"no change"* | **2026-11-28** (first quarterly) | The number currently in [[finance-pricing-loops]]:183 is **wrong when recomputed**: see §6 F-1. Premortem D4's signal is *"three consecutive close-times in which **every** loop's `outputs_to` names a unit outside Commercial"* — a fact about frontmatter, checkable by query |
| **FIN-C4** | **Apply the anti-sprawl rule to this unit first, publicly** | The board carries a run-count per scheduled job, and the first job to reach **three no-action runs** is downgraded in writing rather than exempted | **2026-11-28**, then quarterly | [[finance-pricing-schedule]] §Anti-sprawl carries the rule inline for exactly this reason. Premortem D5. `foundation README §6` |
| **FIN-C5** | **File the four cross-unit asks** in the receiving units' `questions` files (§8.4: a cross-unit need is an agenda task, addressed to that unit) | Four rows exist, each with a `next action` and an age-out: → [[neural-footprint-instrumentation-questions]] (should `nf_readout.py` carry the verified views, or do they get their own reader?); → [[model-routing-inference-economics-questions]] (the A2 landing signal and the fetch contract under ADR 0036); → [[knowledge-documentation-questions]] (retire-to-write accounting for FIN-B1's library additions); → [[agent-evaluation-gates-questions]] (what the 12 exempt task types mean for a cost-per-**completed**-task denominator) | **2026-09-11** | `GENERATION_BRIEF.md` §8.4; [[finance-pricing-questions]] §"How this file works"; CLAUDE.md §4 retire-to-write (the 693-doc generation is exempt, FIN-B1's additions are not) |

---

## 6. Findings — things no card and no loop can carry

Recorded per §8.1: *a task no card or loop can carry is a finding, not a task.* None of
these is scheduled above, and three of them are corrections to this unit's own documents,
which this wave may not edit (§8.4).

- **F-1 — the CM-F4 count in our own loops file is wrong.** [[finance-pricing-loops]]:183
  states **"`outputs_to` outside Commercial: 4 of 5"**. Recomputed from
  `00-index/loops.json` on 2026-08-28: only **`fin-meter-liveness` and
  `fin-cost-efficiency-review`** have *zero* Commercial consumers — **2 of 5**. The other
  three name `growth` and/or `sales`. Premortem D4's signal is therefore **not** currently
  firing, and the CM-F4 case is materially weaker than the file asserts. FIN-C3 makes the
  number computed rather than written down; the file itself needs a correction this wave
  cannot make.
- **F-2 — this sub-layer's own agent cannot run, and that is structural.**
  `fin-orchestrator` is `routing_class: extraction`, not `mechanical`, so it is absent
  from the runner's 36 declared mechanical cards by design. Its two teams' cards can run
  (FIN-A7, FIN-B8); the orchestrating card waits on the harness question, **OD-03 / Track
  A1**. No agenda task can close that, and pretending otherwise would schedule work
  against an open fork.
- **F-3 — a per-tier cap breach is unobservable by any card.** It fails open on error and
  reports only through `this.logger.warn` (`model-client.service.ts:538-546`). Nothing
  consumes gateway log lines, so `fin.cap_breach_count` is **structurally partial** until
  FIN-A3 defines it over both systems. The counter that would catch the other half,
  `get_drop_counts()`, is process-local and read only by tests.
- **F-4 — a view is named for a thing it does not compute.**
  `nf_a_cost_per_completed_task` has **no outcome predicate** — `tasks` is a bare
  `count(*)` (`20260824153600_nf_a_readout.sql:98-110`), so it reports cost per *call*.
  The register already records this (OD-59's row). The name is the hazard and renaming it
  is [[neural-footprint-instrumentation-charter]]'s call, not ours; FIN-A1 routes around
  it, FIN-C5 asks.
- **F-5 — stale citations in our own charter.** [[finance-pricing-charter]]:160 lists
  OD-11 as open (resolved 2026-08-24, ADR 0008) and cites `spend_logger.py:41-49` for
  `log()`, which now begins at `:260`. [[finance-pricing-agent-stack]] §6 already flagged
  the second. Charters are not this wave's to edit.
- **F-6 — the price already in production code is not in any register.** Five dollar
  figures ship in `spend-tiers.ts`, correctly labelled as placeholders by the founder.
  They are not a pricing decision — and they are exactly the anchor premortem D3
  describes. FIN-B4 registers them; nothing else in the org would have noticed them.

---

## 7. Ambition, graded honestly

The founder asked for reach. Reach, and then the grade — per §8.2.6.

| Task | Grade |
|---|---|
| FIN-A1, A4, A6, B4, B5, B7, C5 | **Buildable now.** Every dependency exists in this repo today; nothing waits on a decision |
| FIN-A2, A3, A5, A7, B3, B6, B8, C2, C3, C4 | **Buildable now, gated on volume, access or a prior task.** FIN-A5 may return `BLOCKED` on console access and that is an honest close; FIN-A2 may return `INSUFFICIENT VOLUME` and that is also an honest close |
| FIN-A8 | **Aspiration pending Track A2.** Not schedulable as a landing date by this unit; only the weekly watch is ours. If A2 slips, the watch keeps saying so |
| FIN-B1, FIN-B2 | **Aspiration pending a decision — and deliberately so.** Research is permitted; the decision it would inform is deferred. If OD-23's premise question (§8, Q1) resolves toward "the range is a draft", the comparison becomes an input; if not, it stays a library entry. **We are not scheduling any consequence of it** |
| FIN-C1 | **Preparation only.** The unlock case is written to be *ready*, never to argue for the unlock |

**The reach item we did not schedule.** A cost-to-serve figure per restaurant is
computable today and would be a **systematic undercount** — nullable `restaurant_id` by
design (`spend_logger.py` docstring), infrastructure cost absent from the ledger entirely
(`~$10-20/mo`, `PROJECT.md`). Publishing it before FIN-A4 raises coverage would put a
number into Strategy's hands whose error bar nobody has measured, which is
[[finance-pricing-premortem]] D1 with extra steps. It waits on FIN-A4 and FIN-A5.

---

## 8. Questions for the founder

1. **OD-23's premise, still first.** Is `$20–50/mo` a decision or a draft? The register
   now records three corrections to its own entry — no ADR, source document absent from
   the repo, and `PROJECT.md` saying *"No revenue pressure: Build right, not fast"*
   (OD-23, `OPEN-DECISIONS.md:32`). **Not resolved here.** Nothing in this agenda depends on the
   answer; FIN-B1/B2's *usefulness* does.
2. **The five figures in `spend-tiers.ts`.** They are labelled placeholders and this
   agenda treats them as anchors to register, not prices. Is registering them in
   FIN-B4 the treatment you want, or would you rather they were removed from code and
   replaced by an env-only ceiling until pricing un-defers?
3. **Cap ownership across two systems.** The hourly provider cap is F1's by charter. Is
   the per-restaurant per-tier ceiling in the gateway also F1's to own — or is it
   `aio-model-routing`'s operational policy under ADR 0036, with F1 owning only the money
   view of it? FIN-A3 produces the map either way; the ownership line is yours.
4. **`fin.cap_breach_count` when a cap fails open.** The tier ceiling suppresses retries
   and never blocks a call, and on any error it allows the call. Should a breach be a
   counted event on the ledger, or is a log line the right weight for a ceiling that is
   advisory by construction?
5. **CM-F4, with the corrected number.** The evidence is 2 of 5, not 4 of 5 (§6 F-1).
   Should FIN-C3 still run quarterly, or is the placement question closed until the
   corrected figure moves?

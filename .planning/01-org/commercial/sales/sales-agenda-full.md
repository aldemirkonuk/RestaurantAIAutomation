---
type: agenda-full
division: commercial
department: sales
status: active
metrics: [sales.verified_dollars_recovered, sales.unprompted_sessions_7d, sales.time_to_first_connection, sales.design_partner_touch_streak, sales.blocker_age_max, sales.sending_identity_isolated, sales.qualified_conversation_rate, nf_b.source_count]
updated: 2026-08-28
links: ["[[sales-charter]]", "[[sales-premortem]]", "[[sales-directive]]", "[[sales-loops]]", "[[sales-schedule]]", "[[sales-agent-stack]]", "[[sales-questions]]", "[[sales-agenda-board]]", "[[design-partner-operations-charter]]", "[[design-partner-operations-agenda-full]]", "[[outbound-engine-charter]]", "[[outbound-engine-agenda-full]]", "[[analytics-bi-charter]]", "[[media-brand-charter]]", "[[compliance-privacy-charter]]", "[[customer-relationship-research-charter]]", "[[finance-pricing-charter]]", "[[pos-bridge-charter]]", "[[supplier-distributor-network-charter]]", "[[product-vision-charter]]", "[[guest-experience-charter]]", "[[strategy-fundraising-charter]]", "[[reliability-sre-charter]]", "[[decision-office-charter]]", "[[growth-charter]]", "[[0039-activation-plan-of-record]]", "[[commercial]]", "[[YC_WEDGE_PLAN]]", "[[PROJECT]]", "[[STATE]]"]
---

# Sales — Full Agenda

**Dated 2026-08-28.** First real agenda; supersedes the placeholder forecast written
2026-08-24. Authored under [[0039-activation-plan-of-record]] Track B, `GENERATION_BRIEF`
§8.

> **The three constraints this agenda is ambitious *inside*, not around.**
> **One customer.** **Zero sends.** **The target list is founder-deferred** — and nothing
> below generates one, assumes one, or produces a method for producing one. The ambition
> is spent on the two things that are actually available: being the best-served design
> partner any startup has ever had, and having a machine so ready that the unlock costs
> one decision instead of one quarter.

Fourteen tasks. Each names a **doneability**, a **close_time**, and the **evidence** that
makes it real. Three are graded *aspiration pending a decision* and say so in place.

---

## §0 — The correction this agenda opens with

**`DEP-06`'s citation is dead, and its live row does not say what every document in this
department says it says.**

Every artifact here — charter, directive, loops, premortem, schedule, agent-stack, both
team directories — is built on `DEP-06: Toast API credentials configured for friend's
restaurant` being **unchecked at `.planning/PROJECT.md:101`**. Verified 2026-08-28:

- `.planning/PROJECT.md` is now **115 lines** and contains **no `DEP-06` at all**. The
  account survives, reworded, at `:60` (*"First user: a Turkish restaurant in SF,
  connecting through the Toast adapter"*). The vault restructure (ADR 0032) moved the
  requirement out from under 96 citations without moving them.
- The live row is `.planning/07-reference/REQUIREMENTS.md:333` and it reads
  **`- [x] DEP-06`** — *"Toast API credentials configured — friend's restaurant Toast
  webhook URL pointed to production endpoint."*
- That `[x]` sits inside a ledger whose own header calls itself historical
  (`REQUIREMENTS.md:7-9`, corrected 2026-08-25 under ADR 0018). Two rows below it,
  `TEST-PROD-04` — a signed Toast webhook flowing end to end — is still `[ ]`, and
  `E2E-v2-05`, *"real Toast API data from friend's restaurant"*, is `[ ]` at `:316`.
- `grep -rn "DEP-06" .planning` → **97 lines across 46 live files** (archive excluded, and
  excluding this agenda and its board), every one of them written against "unchecked".

So the department's single top item is either **already closed** or **has never been
open in the place we were looking**. Both readings are defensible from the repo alone,
and Sales is not entitled to pick the flattering one. SAL-01 settles it. Nothing in §B
that depends on a live connection may start before it does.

*(This is the department's own `claim-provenance-check` firing on the department. The
[[sales-agent-stack]] §3 row predicted exactly this class of rot; it under-predicted the
scale.)*

---

## §A — Ground truth, and gates that cannot rot

### SAL-01 — Re-establish `DEP-06`'s true state and re-anchor 97 citations in 46 files

- **Evidence.** §0 above, all four bullets re-verified 2026-08-28. Also
  `.planning/STATE.md:33`: *"POS bridge: built and proven POS-agnostic (Toast first
  adapter)"* — which is a statement about the bridge, not about this restaurant, and the
  two have been read as one.
- **Doneability.** One of two outcomes, written into [[sales-questions]] as `SAL-Q1` with
  the founder's answer attached. **(a) Connected** — the restaurant's credentials are live
  and one `getSalesData` call returns that restaurant's rows: then
  `sales.time_to_first_connection` closes with a date, [[sales-loops]] L1 closes for the
  first and last time, and the charter/directive/premortem/schedule spine is rewritten
  around the *next* constraint rather than this one. **(b) Not connected** — the `[x]` is a
  deploy-phase artifact: then the row is corrected in place and every citation re-anchors
  to `REQUIREMENTS.md:333`, never to `PROJECT.md:101` again.
- **close_time:** 7 days — **2026-09-04**. This is the department's only genuinely urgent
  item, because 13 of the 14 tasks below are downstream of knowing which world we are in.
- **Carried by.** `sales-board-keeper` (`00-index/cards.json`) — whose *first* declared
  `consumes` line is `.planning/PROJECT.md:101 (DEP-06) and :127 (the account)`. **The card
  cannot run today: its primary input does not exist.** Closing SAL-01 is what makes the
  card executable, which is the precondition for anything else in this department being
  machine-checked rather than remembered.

### SAL-02 — Turn the three standing gates into executable claims

The gates in [[sales-directive]] are prose. Prose rots — this repo has measured it twice.

- **Evidence.** `scripts/check_decision_claims.sh` runs **112** claim lines from
  `.planning/decisions/CLAIMS.jsonl` in CI; its header records the 2026-08-25 lesson (five
  register entries acted on, five wrong in ways that changed the priority) and states the
  mechanism plainly: *"a claim written as a sentence is checked exactly once — the day it
  is written."* This department's own citations are already drifting: [[sales-agent-stack]]
  §6 measured `EMAIL_BACKEND` 165→172, `SENDGRID_API_KEY` 167→174, `settings.py` 202→223 —
  re-verified 2026-08-28, `env.example` is now **194** lines with those keys at `:172` and
  `:174`. The `gmail.service.ts` fallback the charters cite at `:76-78` is at **`:79`**.
- **Doneability.** Three rows exist in `CLAIMS.jsonl` and the guard passes with them:
  1. **Identity gate** — `status: open`, `verify` greps that no module under a
     sales/outbound path reaches `GmailService`. Filed *open* deliberately: the day it
     starts holding, the guard strikes the "blocked" half of the entry off and
     `sales.sending_identity_isolated` flips on evidence rather than on assertion.
  2. **Evidence gate** — `status: open`, `verify` finds no dollar figure under
     `.planning/01-org/commercial/` that is not annotated *"requested, not landed"*.
  3. **Attention gate** — the `DEP-06` grep SAL-01 settles, pinned to whichever row wins.
  Each fails **closed**: unable to check exits non-zero, per the repo's guard convention
  and the standing rule that a guard which cannot check must not pass.
- **close_time:** 21 days — **2026-09-18**.
- **Carried by.** `sales-board-keeper`, whose declared `quality_bar` names this exact hole:
  *"NONE (gap) — ADR 0017 has no grader for board claims."* This closes the gap with a
  grep instead of a model, which is the cheaper and more durable half of the answer.

---

## §B — Design-partner operations: the best-served design partner in software

Owner: [[design-partner-operations-charter]] (S1). The premise: there is exactly one
counterparty, one person's attention on our side, and a friendship that is the company's
only real commercial asset. An organisation that treats one account this well learns
things a hundred accounts would hide.

### SAL-03 — The contact ledger, and a streak that cannot be gamed

- **Evidence.** `sales.design_partner_touch_streak == 0`. Loops `sales-design-partner-cadence`
  and `dpo-touch-and-blockers` both exist in `00-index/loops.json` as `status: proposed`,
  weekly, and neither has ever produced a row. [[sales-loops]] L2 already names the trap:
  *"a 'checking in!' message is not a touch."*
- **Doneability.** A contact log under
  `01-org/commercial/sales/teams/design-partner-operations/` — one row per interaction:
  date, what was asked, **what was observed**, the blocker it produced, that blocker's age.
  The streak increments **only** on a row carrying an observed usage moment or a named
  blocker. Four consecutive weekly rows flips both loops from `proposed` to `running` in
  `loops.json` — the first Sales loop ever to run.
- **close_time:** weekly; first row by **2026-09-04**, loop status flips **2026-09-25**.

### SAL-04 — Blocker ageing with an escalation clock that fires on the calendar

- **Evidence.** `dpo-touch-and-blockers` measures `sales.blocker_age_max` and outputs to
  `product-vision`, `pos-bridge`, `sales` (`00-index/loops.json`); the metric is
  **undefined** today ([[design-partner-operations-charter]] §Metrics). [[sales-loops]] L2:
  *"an open blocker older than two weeks escalates — the restaurant is not going to chase
  us."*
- **Doneability.** Every blocker row carries an owner **outside Sales** and an age in days.
  At **14 days** it appears in the owning unit's `questions.md` under the `SAL-Q` prefix. At
  **28 days** it goes to [[decision-office-charter]]. Done when a blocker has actually aged
  through one full escalation and the transition happened **on its calendar day, not on the
  day someone noticed** — an ageing rule proven by a clock is a mechanism; one proven by
  attention is a hope.
- **close_time:** weekly close; the rule is proven by **2026-10-09** (first full 28-day
  cycle).

### SAL-05 — File the one analytics event, and get an answer or a refusal

The department's highest-value ask of any other unit, and it is one field.

- **Evidence.** [[sales-premortem]] M1 is the highest-probability failure in the division
  and *"the only one that requires instrumentation that does not exist yet."* Re-verified
  2026-08-28: `env.example` (194 lines) contains no analytics key, and `apps/web/src`
  contains no PostHog / Amplitude / Mixpanel / Segment reference at all. Loop
  `sales-politeness-detector` is `status: blocked` in `00-index/loops.json` with
  `inputs_from: [analytics-bi]` — the dependency is already declared machine-readably.
- **Doneability.** A row in [[analytics-bi-charter]]'s `questions.md` (`SAL-Q` prefix)
  specifying exactly one event — session start carrying
  `seconds_since_last_founder_contact` — and it resolves to a **binary**: shipped with a
  date, or declined in writing with a named owner. Sales cannot build this and will not
  pretend to; what Sales can close is the *ask*, and an ask that ages out unanswered is a
  finding about the org, not about Sales.
- **close_time:** filed within 7 days (**2026-09-04**); ages out at 42 days
  (**2026-10-09**) per [[sales-questions]]'s escalation rule.

### SAL-06 — The sixty-second demo, built entirely from mechanism

- **Evidence.** The mechanism story is true today with zero dollars.
  `apps/api-gateway/src/procurement/invoice-match.ts` is a real, pure, unit-tested
  three-way match — and it is **420 lines** as of 2026-08-28 (`.planning/YC_WEDGE_PLAN.md:129`
  says 256; the charters say 406; this is the **third** count in four days, and it is
  precisely the drift `claim-provenance-check` exists for). `overbilled_vs_ship` outranks
  every verdict but a missing invoice (`YC_WEDGE_PLAN.md:342`, verified). Sketch **052** has
  already rendered the match document three ways by role and is marked IMPLEMENTED
  (`scripts/docgen/templates/wineops_document.html`, `sketches/MANIFEST.md`) — the demo has
  a visual artifact and does not need one built.
- **Doneability.** A script in which **every claim is a mechanism claim**, each traced to a
  `path:line`, containing **no dollar figure whatsoever**. It passes SAL-02's evidence-gate
  claim trivially, because there is nothing in it to trace. Re-graded at each quarterly
  claim audit ([[sales-schedule]]).
- **close_time:** 30 days — **2026-09-27**.

### SAL-07 — Case-study groundwork behind the consent gate: assembled, unwritten, unpublished

- **Evidence.** [[sales-charter]] §Boundaries — Sales supplies verified facts and a real
  quote; [[media-brand-charter]] writes the prose, and *"a team that writes its own case
  study writes a better story than happened."* The consent gate is
  [[compliance-privacy-charter]]'s and does not exist yet (it is that department's own
  wave-3 seed, `GENERATION_BRIEF` §8.3). ADR 0039 keeps brand/landing visuals **held**.
- **Doneability.** A facts-only dossier: every figure with the invoice its credit landed on
  **or** the annotation *"requested, not landed"*; one candidate quote recorded verbatim
  with the date it was said and whether permission was asked; reference permission as a
  boolean, not a vibe. **Zero prose. Zero publication.** Done when [[media-brand-charter]]
  could begin without asking Sales a single follow-up question.
- **close_time:** 45 days — **2026-10-12**, and it does not open until SAL-01 resolves to
  (a).
- ⚠️ **Graded: aspiration pending a decision.** The consent-gate spec does not exist. If it
  has not landed by 2026-10-12 this closes at *"facts assembled, consent field empty"* — an
  honourable close, per [[sales-questions]]'s "accepting is an honourable close" rule. It
  does **not** close by proceeding without the gate.

### SAL-08 — The patience budget, published: one account, one asking queue, org-wide

The most ambitious item in §B, and the one with the least code in it.

- **Evidence.** Loop `dpo-patience-budget` already declares inputs from **four** units —
  `customer-relationship-research`, `guest-experience`, `media-brand`, `product-vision` —
  and changes `org.access_to_account` (`00-index/loops.json`, weekly, proposed).
  [[design-partner-operations-charter]] §The seam with CRR states the rule and its reason:
  *"M4 books through this team… the relationship is the scarce resource, not the research
  slot."* Production has one real tenant; there is no second account to absorb a mistake.
- **Doneability.** One published asks queue with a stated **weekly ceiling**. All four
  units enter through it. A week in which any unit contacted the account outside the queue
  is recorded as a breach **with the unit named**. Done when a **declined** ask is on the
  record — *a budget that has never said no is not a budget, it is a calendar.*
- **close_time:** weekly close; first recorded decline by **2026-10-09** or the ceiling is
  set wrong and gets re-set.
- **Why this is the ambition.** Most startups' one design partner is asked for things by
  everyone and served by no one. This makes the restaurant's experience of a 100-unit org
  indistinguishable from being served by one attentive person — which is the only version
  of "best-served" that a solo founder can actually deliver.

### SAL-09 — One landed credit, by hand

- **Evidence.** [[sales-loops]] L4 names the manual path explicitly and calls it available
  this quarter. The automatic path is blocked: the invoice half is typed by hand per line
  item — `apps/web/src/pages/inventory/command/ReceivingWorkspace.tsx:400`
  (`aria-label="Quantity invoiced"`) and `:438` (`aria-label="Invoice unit price"`), both
  re-verified at those exact lines 2026-08-28. `.planning/YC_WEDGE_PLAN.md:31-33`: until an
  812 lands on a later invoice, *"dollars recovered"* means *"we asked."*
- **Doneability.** `sales.verified_dollars_recovered > 0`, stated **only** alongside the
  invoice number it landed on and the date it landed. Requested and landed print as two
  numbers, never one — the `sales-board-keeper` card's first declared `emits` line.
- **close_time:** monthly, on the **distributor's** billing cycle, not ours; first landing
  targeted by **2026-11-24**, the department's own review date.
- **What it unlocks, all at once.** The evidence gate ([[sales-directive]]), S2's entry
  trigger ([[outbound-engine-charter]]), [[media-brand-charter]]'s case study, and
  [[strategy-fundraising-charter]]'s traction input — `sales-recovery-verification`'s four
  declared `outputs_to` in `00-index/loops.json`. **One credit memo is the highest-fanout
  artifact this company can produce this quarter.**

---

## §C — Outbound readiness that drafts nothing, to nobody

Owner: [[outbound-engine-charter]] (S2), dormant by construction. **Zero sends and zero
spend remain the correct output.** Nothing in this section names a restaurant, a domain, or
a criterion for finding one.

### SAL-10 — Ship `sending-identity-guard`: the one thing worth building before a customer

- **Evidence.** **Nine** `scripts/check_*.sh` guards exist today (verified 2026-08-28:
  `check_db_reachable`, `check_decision_claims`, `check_gateway_boots`,
  `check_model_calls_logged`, `check_no_direct_stock_writes`,
  `check_no_direct_type_attributes_access`, `check_no_guest_name_matching`,
  `check_no_raw_guest_channels`, `check_schema_parity`) — the import ban is one more of the
  same shape, not new machinery. Loop `oe-identity-isolation-guard` closes **per-pr**, the
  only Sales loop with a close_time under a week (`00-index/loops.json`). The shared
  identity is live at `apps/api-gateway/src/communications/gmail.service.ts:79`
  (charters cite `:76-78`; re-anchored here).
- **Doneability.** The guard is in CI; it **fails closed** (exits non-zero when it cannot
  prove the negative); and it is **proven against a pre-fix tree** — a deliberate
  `GmailService` import from an outbound path turns it red before the guard is trusted.
  `sales.sending_identity_isolated` stops being an opinion and becomes a build status.
- **close_time:** 14 days — **2026-09-11**; then per-PR forever.
- **The correction it forces.** The guard is buildable *while* the boolean is `false`. It
  **measures** isolation; it does not require it. That distinction is why this is a
  this-month task and not a post-unlock one.

### SAL-11 — The unlock readiness pack: five states, zero prospects

- **Evidence.** [[outbound-engine-charter]] §Entry trigger (two conditions, both unmet);
  ADR 0039's deferral lock, founder re-confirmed 2026-08-28; and
  `.planning/decisions/OPEN-DECISIONS.md:51` (OD-77), which says in the founder's own
  deferral: *"Sequence it before any customer onboarding — migrating a live mail domain
  under real vendor traffic is materially harder than doing it now."*
- **Doneability.** One document, five rows, each a **state** and not a plan: sending
  identity **decided** (not purchased — purchase is spend); suppression design written
  (per-domain, 24-hour honour, wired to a stop path); qualification rubric **frozen** with
  at least one hard disqualifier; claim allowlist created **empty**; legal basis filed with
  [[compliance-privacy-charter]] and **answered**. Every row verifiable by someone who does
  not work here.
  **Acceptance test, and it is the point of the task:** a reviewer who reads the whole pack
  must be **unable to derive a single prospect from it** — no names, no domains, no
  enrichment criteria, no method for producing any. A readiness pack that leaks a list is
  the deferral broken quietly, which is how deferrals actually break.
- **close_time:** 60 days — **2026-10-27**; re-checked monthly by the entry-trigger check
  already declared on the `outbound-sentinel` card, *"so 'deferred' never quietly becomes
  'abandoned'."*

### SAL-12 — Carry OD-77 to its owner with the sales consequence attached

- **Evidence.** OD-77 (`OPEN-DECISIONS.md:51`) is founder-deferred, blocks OD-78, and its
  runbook is committed with **no step taken**; `GMAIL_SENDER_EMAIL` is still a personal
  gmail.com address. The **sales** consequence is written nowhere in OD-77: the design
  partner's mail from the product arrives from a personal account, and every outbound plan
  inherits an identity that has to move anyway — twice, if it moves after send #1.
- **Doneability.** A `SAL-Q` row in the owning unit's `questions.md` stating the sales-side
  cost and the sequencing ask, and OD-77's *"before any customer onboarding"* line either
  **dated** or explicitly **accepted as undated** by the founder. Sales files; Sales does
  not resolve.
- **close_time:** 14 days — **2026-09-11**; ages out at 42 days per [[sales-questions]].

---

## §D — The fork this department owes the corpus

### SAL-13 — File CM-F3

- **Evidence.** `.planning/02-advisory/decision-office/FORK-REGISTRY.md:560` — CM-F3 has
  **61 citations in 24 files**; `:653` calls it *"the most-cited unfiled fork in the corpus,
  and unowned by either side today."* `:654` is the reason it is dated: PROD-F2 carries a
  **day-90 consequence (≈2026-11-22)** where CM-F3 and PROD-F2 both open with
  `pi.live_counterparties == 0` triggers a team-dissolution proposal — and *"a dated trigger
  against an unregistered fork will fire against nothing."*
- **Doneability.** CM-F3 is a row in `OPEN-DECISIONS.md` **with an executable claim** in
  `CLAIMS.jsonl` (the register-rot lesson applies to new rows too), and Sales' proposed line
  ([[sales-charter]] §Distributor connectivity) has been **diffed** against
  [[supplier-distributor-network-charter]]'s mirror text with the differences enumerated
  rather than assumed identical. Sales files and diffs; [[decision-office-charter]] rules.
- **close_time:** 21 days — **2026-09-18**. Filed *before* the 2026-11-22 trigger, not on it.
- ⚠️ **Register-row caution (ADR 0025, locked).** Adding one `OPEN-DECISIONS` row
  re-anchors every citation below it. ~~27 across 24 files, measured.~~ **Figure
  corrected 2026-09-01 — it was never ADR 0025's, and it understated the cost ~6×.**
  That phrasing appears nowhere in ADR 0025; the "24 files" half was borrowed from an
  unrelated population (CM-F3's *61 citations in 24 files*, [[FORK-REGISTRY]]). Measured
  at `14503ced`: the register is **newest-first**, so a genuinely new fork lands at the
  top of the Open table and breaks **173 citations across 89 files — every register
  citation in the corpus**. *(First measured as 165/86 and flagged as a floor; the guard
  was blind to `.html`; fixed the same day. Re-measure rather than quote — the figure rises with every citation added.)* (Inserting at the *end* of Open breaks only 45; that is the
  number usually quoted, and it describes a position no new fork occupies.) **Budget the
  full repoint and automate it** — `check_citation_pairing.py` prints the exact
  replacement for every break. See ADR 0025's *Correction — 2026-09-01*. **Both**
  register guards run, not only the claims one.

---

## §E — The department judges itself, on a mechanism it did not write

### SAL-14 — Wire the 2026-11-24 review to the watcher that already watches it

- **Evidence.** `scripts/watch_loops.py` exists and its own docstring names both dated
  rules it was built for: **2026-10-23**, when all 198 agenda files hit the 60-day staleness
  rule simultaneously because they share `updated: 2026-08-24` (*"a rule that condemns
  everything condemns nothing"*), and **2026-11-24**, when *"seven units are scheduled to
  judge whether they should still exist"* — the docstring names **Sales** among them,
  second of the four departments listed. The script reports and never edits the corpus.
- **Doneability.** Two halves. (i) `python3 scripts/watch_loops.py --asof 2026-11-24` prints
  the Sales row against its **two live inputs** — DEP-06's post-SAL-01 state and
  `sales.verified_dollars_recovered` — rather than against a hardcoded assumption.
  (ii) `--asof 2026-10-23` no longer fires for this department, because this document's
  `updated: 2026-08-28` lifts it out of the synchronized-staleness cohort. **The second half
  is this file's own doneability**, and it is already satisfied on save.
- **close_time:** verified at the **2026-10-23** tick; decided **2026-11-24**.

---

## Board summary

| ID | Owner | Task | close_time | Grade |
|---|---|---|---|---|
| SAL-01 | sales | `DEP-06` true state + re-anchor 97 citations / 46 files | 2026-09-04 | grounded |
| SAL-02 | sales | Three gates → executable claims | 2026-09-18 | grounded |
| SAL-03 | S1 | Contact ledger, ungameable streak | weekly / 2026-09-25 | grounded |
| SAL-04 | S1 | Blocker ageing + escalation clock | weekly / 2026-10-09 | grounded |
| SAL-05 | S1 | File the one analytics event | 2026-09-04, ages 2026-10-09 | grounded (ask) |
| SAL-06 | S1 | Sixty-second mechanism demo | 2026-09-27 | grounded |
| SAL-07 | S1 | Case-study dossier behind consent | 2026-10-12 | **aspiration** |
| SAL-08 | S1 | Patience budget, published | weekly / 2026-10-09 | grounded |
| SAL-09 | S1 | One landed credit, by hand | monthly / 2026-11-24 | **aspiration** |
| SAL-10 | S2 | `sending-identity-guard` in CI | 2026-09-11 | grounded |
| SAL-11 | S2 | Unlock readiness pack, zero prospects | 2026-10-27 | grounded |
| SAL-12 | S2 | Carry OD-77 with the sales consequence | 2026-09-11 | grounded |
| SAL-13 | sales | File CM-F3 | 2026-09-18 | grounded |
| SAL-14 | sales | Wire the 2026-11-24 review to `watch_loops.py` | 2026-11-24 | grounded |

**Three graded honestly.** SAL-07 is aspiration because the consent gate it depends on does
not exist. SAL-09 is aspiration because a credit landing is the counterparty's act, not
ours — we can guarantee the request and the reconciliation, never the landing. SAL-05 is
grounded only as an *ask*: Sales closes the filing, not the event.

---

## Rejected — seeds considered and not scheduled

1. **Any target-list work in any disguise** — "ICP research", "criteria without names", "a
   rubric applied to a sample corpus". **Rejected:** founder-deferred, re-confirmed
   2026-08-28 (ADR 0039). SAL-11's acceptance test exists specifically to catch this
   arriving dressed as readiness.
2. **A CRM / pipeline schema.** **Rejected:** one customer. There is no lead, deal, or
   opportunity schema across the migration set and adding one is [[sales-premortem]] M5
   verbatim — a dormant team acquiring activity to justify itself.
3. **A second design partner as M1's control.** **Rejected, not on principle but on
   arithmetic:** sourcing one requires the deferred list. The premortem's weaker form (one
   stranger conversation a month) stays on [[sales-schedule]] where it already lives, and
   is already pre-marked there as a likely anti-sprawl casualty. Promoting it to an agenda
   task would not make it happen; **finding recorded** rather than task listed.
4. **Building the analytics event ourselves.** **Rejected:** not ours, and Sales writing a
   tracking call is the boundary failure the charter's non-goals table exists to prevent.
   It survives as SAL-05 — the *ask*, which we can close.
5. **A pricing conversation with the design partner** ("does the first account ever pay?").
   **Rejected as a task, kept as a question** — pricing is locked-deferred *and*
   [[finance-pricing-charter]]'s. See §Questions 4.
6. **Warming a sending domain now, so it is ready later.** **Rejected:** warming is spend
   and spend is gated by S2's entry trigger. SAL-10 gets the same risk reduction — the
   guard — for zero dollars and zero sends.

---

## Findings — things no card or loop can carry

Per `GENERATION_BRIEF` §8.1: *a task no card or loop can carry is a finding, not a task.*

- **F1 — `sales-board-keeper` is unrunnable as declared.** Its first `consumes` line points
  at `.planning/PROJECT.md:101`, which no longer exists. Until SAL-01 lands, the department's
  only card would read a file path that resolves to nothing. Cards are not this wave's to
  edit; filed here and in [[sales-questions]].
- **F2 — `.claude/skills/` now exists and holds four skills** (`fleet-census`,
  `harness-contract-audit`, `model-pin-census`, `registry-index-refresh`) plus a README —
  and none of them is Sales'. [[sales-schedule]] still asserts *"That directory does not
  exist yet."* Half of CORP-F7 closed by side effect (`FORK-REGISTRY.md`); ~99 documents
  still carry the old assertion. Not corrected here (out of scope); named so it is not
  rediscovered.
- **F3 — NF-B is held on decisions, not on us.** `.planning/STATE.md` P3 table: NF-B guests
  is **held — blocked on OD-05/OD-07, not on work.** The charter's claim that a Sales
  checkbox blocks the entire guest track is *necessary-but-not-binding* today. Stating it
  correctly costs Sales its most dramatic dependency claim, which is the reason to state it.
- **F4 — the `sales-connection-countdown` loop may have already closed** without anyone
  closing it, depending on SAL-01's outcome. A loop that closes unobserved is the same
  failure as one that never closes.

---

## Questions for the founder

1. **`DEP-06` — which world are we in?** `REQUIREMENTS.md:333` says `[x]`; twenty documents
   in this department say unchecked; `PROJECT.md:101` no longer exists. This is a
   thirty-second answer that re-shapes fourteen tasks, and it is the only question here that
   is genuinely blocking.
2. **Do you accept S2's entry trigger as written?** Zero sends, zero spend, until
   `verified_dollars_recovered > 0` **and** the list un-defers. SAL-11 is built assuming yes.
3. **Recovery or NF-B first for the design partner's attention?** They pull opposite ways
   and the account's patience is finite (SAL-08 makes that budget explicit for the first
   time). This department's view is unchanged: **recovery first**, because it produces the
   number four other units are waiting on. The call is yours.
4. **Does the design partner ever pay?** Pricing is locked-deferred and not ours — but
   *whether the first account is free forever* is a relationship fact Sales must know before
   it is asked across a table. A friend who has never been asked to pay is not evidence that
   a stranger will.
5. **CM-F3 — do you accept the proposed distributor line?** Partnerships owns the
   distributor; Sales owns the moment a restaurant *we are selling to* must ask its own
   distributor on our behalf. 61 citations, 24 files, unowned, with a dated trigger 86 days
   out. SAL-13 files it either way; your answer decides whether it closes with it.

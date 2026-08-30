---
type: agenda-full
division: product
department: guest-experience
parent_department: product-vision
status: active
metrics: [nf_b.subject_coverage, nf_b.event_completeness, nf_b.false_merge_count, nf_b.k_anonymity_pass_rate, nf_b.ops_conversion]
updated: 2026-08-28
links: ["[[guest-experience-charter]]", "[[guest-experience-premortem]]", "[[guest-experience-agenda-board]]", "[[guest-experience-directive]]", "[[guest-experience-loops]]", "[[guest-experience-schedule]]", "[[guest-experience-agent-stack]]", "[[guest-experience-questions]]", "[[guest-identity-consent-charter]]", "[[taste-fingerprint-charter]]", "[[consumer-app-points-economy-charter]]", "[[guest-value-monetization-charter]]", "[[product-vision-charter]]", "[[compliance-privacy-charter]]", "[[privacy-engineering-charter]]", "[[decision-office-charter]]", "[[reliability-sre-charter]]", "[[engineering-charter]]", "[[design-charter]]", "[[research-math-charter]]", "[[0006-neural-footprint-architecture]]", "[[0029-p3-plan-of-record]]", "[[0037-nfb-erasure-is-crypto-shredding]]", "[[0039-activation-plan-of-record]]", "[[OPEN-DECISIONS]]", "[[FUTURES]]", "[[DISH_IDENTITY_DESIGN]]"]
---

# Guest Experience — Full Agenda

> **ACTIVE — 2026-08-28.** Nineteen tasks, every one of them documentation.
> **Nothing on this agenda writes a guest row, gives NF-B a caller, or closes an
> open decision.** That is not a hedge — it is the whole design. NF-B is **HELD**
> ([[0029-p3-plan-of-record]] §3), OD-05 and OD-07 are the founder's, and
> [[0037-nfb-erasure-is-crypto-shredding]] locked *how* erasure works while
> leaving *whether* untouched. So this agenda builds the one thing a hold can be
> used for: **the dossier that makes activation execution instead of design.**

## The frame

**What changed on 2026-08-28.** ADR 0037 locked crypto-shredding: per-guest keys,
erasure = key destruction, aggregates computed before erasure survive. It named
its own costs going in — key-management infrastructure, and a decrypt on every
training and analysis path — and assigned the loop and the eventual key design to
privacy-engineering. [[0039-activation-plan-of-record]] Track B produced this
agenda.

**What did not change.** NF-B stays held on a founder call recorded 2026-08-26
(ADR 0029 §3: application call sites measured **zero**; re-verified 2026-08-28 by
the same grep over `apps/api-gateway/src`, `apps/web/src`, `apps/mobile/src` —
still zero, the only reference remaining a comment in
`apps/api-gateway/src/settings/feature-flag-registry.ts:145-149`). The pricing
model stays **deferred**; brand and landing **visuals stay held**; OD-05 and
OD-07 stay the founder's, and this sub-layer still disqualifies itself from
recommending on OD-07 ([[guest-experience-directive]]).

**The sentence that governs every row below.** *A task that would give NF-B a
caller is not on this agenda. A task that makes the first caller cheap, correct,
and provably reversible is.* Where the two are hard to tell apart — a fixture, a
"minimal" internal writer, a staging table — the row is in
[§What this agenda deliberately does not do](#what-this-agenda-deliberately-does-not-do)
rather than in the tables.

**How to read a row.** Every task carries a **doneability** (how you know it
moved), a **close_time** (a date, or a cadence with its first date), and
**evidence** (a `path:line`, a card, a loop, or an ADR clause). Every task is
graded **Ready** — all inputs exist today — or **Reach**, with the thing it waits
on named. Ambition without that grade is forecast wearing a schedule's clothes
([[0039-activation-plan-of-record]] §8.2.6).

---

## §A — Sub-layer: the dossier and the discipline around it

| # | Task | Doneability | Close | Evidence | Grade |
|---|---|---|---|---|---|
| **GX-1** | **Assemble the NF-B activation-readiness dossier** — one document holding every prerequisite that must exist the day OD-05/OD-07 resolve. It absorbs §B–§E's outputs; it does not restate them. | A reader who has never seen NF-B can list, in order, everything required before the first guest row is written, with each item's owning unit and whether it blocks; and the dossier contains **no step that can be taken before the decision**. Retire-to-write pairing named in the doc itself (candidate: `00-index/PLAN.md`'s Push 4, already superseded by ADR 0029 §3 and never tombstoned); if the founder rejects the pairing, the dossier stays a §-set inside this agenda and no new file is created. | 2026-10-30 | ADR 0037 §Decision — *"nothing is built while NF-B is HELD"*, with the key-management design owed **at activation time**; ADR 0029 §3; `CLAUDE.md` §4 retire-to-write | Ready |
| **GX-2** | **Weekly denominator read** — the `nf_b.*` set rolled up without an average, per the orchestrator card's bar. | Every `nf_b.*` row prints its denominator and reads *measured* / `0 (structurally — no writer)` / `undefined (no denominator)`; `nf_b.subject_coverage` never appears without `nf_b.refusal_count` beside it; **a number derived from a zero denominator is a failed run, not a low score**. | weekly · first **2026-09-04** | `00-index/cards.json` → `guest-experience-orchestrator.quality_bar`; [[guest-experience-agent-stack]] §3 `nf-b-denominator-read` | Ready — manual until the runner cron lands (ADR 0039 Track A4) |
| **GX-3** | **Monthly evidence recheck, and move the founder questions into the file built for them.** [[guest-experience-questions]] holds **zero rows** while this agenda escalates five. | Every `path:line` in the sub-layer's nine artifacts re-read against the working tree; each stale claim restated **in the owning unit's questions file** with its current citation rather than propagated; the founder questions carry `GUE-Q<n>` ids and the 42-day age-out that file's own rules require. | monthly · first **2026-09-30** | [[guest-experience-agent-stack]] §3 `guest-evidence-recheck` — three claims already found stale on 2026-08-27; `guest-experience-questions.md:19-21`; and one found today: the charter and premortem cite `FUTURES.md:281` for the social-network non-goal, which now sits at **`FUTURES.md:280`** | Ready |

---

## §B — guest-identity-consent: key custody, and the proof that erasure happened

The only team with shipped code, and the only one whose work ADR 0037 changed.
Its charter says it activates *to defend and connect, not to extend*
(`guest-identity-consent-charter.md:190-194`); a readiness dossier is defence.

| # | Task | Doneability | Close | Evidence | Grade |
|---|---|---|---|---|---|
| **GX-4** | **The key-custody question set**, written *to* privacy-engineering, who owns the design under ADR 0037. Five questions, each carrying the guest-side requirement it must satisfy: **(a) derived keys cannot be shredded.** `guest_pepper()` derives a per-restaurant key by HMAC from one vault master; a per-guest key derived the same way is not destroyed by deleting it, only recomputed — crypto-shredding therefore requires a **stored** random per-guest key, which is a different infrastructure than the one the repo already has. **(b)** Custody store — Supabase vault vs external KMS, and who can call destroy. **(c)** One key per guest, or per guest **per restaurant**? A single cross-restaurant key silently undoes the non-linkage that is arithmetic today. **(d)** Restore semantics — PITR resurrects a destroyed key row unless the key store is excluded from restore or re-shredded after it. **(e)** The decrypt-cost measurement that makes ADR 0037's own revisit clause executable rather than rhetorical. | Privacy-engineering can begin the design with **no further question to this sub-layer**, and every question states what a wrong answer costs a *guest*, not what it costs us. | 2026-09-18 | ADR 0037 §Decision + §Consequences (*"Revisit if activation-time measurement shows the decrypt cost dominating a named training path"*); `supabase/migrations/20260819000000_guest_identity_minimal_slice.sql:338-367` (derivation), `:195-201` (cross-restaurant non-linkage as arithmetic) | Ready |
| **GX-5** | **The erasure-receipt spec.** `guests.erasure_receipt_id` (`:82`) references nothing — grepped across `supabase/migrations/`, `apps/`, `services/`, `scripts/` on 2026-08-28: **one hit, the column declaration itself.** Under crypto-shredding this stops being cosmetic: the rows survive as noise, so the receipt is the *only* observable proof erasure occurred. | A written spec for what a receipt records (subject, destroyed key id, timestamp, actor, and the verification query that must return *undecryptable*), which unit stores it, its retention, and how a guest or a regulator is shown one. Buildable without a further decision. | 2026-10-09 | The dangling column above; ADR 0037 option 1 — *"erasure destroys the key … rows become noise in place"* | Ready |
| **GX-6** | **Withdrawal ≠ erasure, written as consequences.** `consent_withdrawn_at` (`:64`) and `erased_at` (`:81`) are separate columns with no stated difference in effect. Under crypto-shredding they must differ mechanically: withdrawal stops new events and new decrypts; erasure destroys the key. | A two-column consequence table (withdraw / erase) covering identity rows, NF-B events, aggregates already computed, the points ledger, and photos — every cell says what happens and what survives, and every *survives* names the obligation and the unit that owns it. Reviewed by [[compliance-privacy-charter]], per [[guest-experience-directive]] §Decision rights. | 2026-10-16 | Migration `:54-64`, `:70-82`; ADR 0037 (aggregates computed before erasure survive untouched) | Ready |
| **GX-7** | **The held-means-held guard, specified.** ADR 0029 §6.4 names *"NF-B gets wired minimally by someone being helpful"* as a way this fails, and today the hold is enforced by a document. Specify the guard; **do not build it** — the build is addressed to [[engineering-charter]]. | A spec naming the exact symbols (`guest_check_links`, `guest_link_identifier`, `guest_identifiers`, `from("guests")`, and any write with `subject_type = 'guest'`), the paths swept, the single known-allowed exception (`feature-flag-registry.ts:145-149`, comment-only), **exit 2 when it cannot check** rather than a green pass, and a demonstration that it fails against a synthetic tree containing one caller. | 2026-09-25 | ADR 0029 §3 (call sites zero, 2026-08-26; re-verified 2026-08-28), §6.4; `.github/workflows/schema-parity.yml:185-212` is the working shape to copy | Ready |
| **GX-8** | **The activation-day erasure rehearsal, written now and run never.** A drill executable the week NF-B activates: synthetic guest in a scratch environment → shred → prove undecryptable → prove pre-erasure aggregates survive → prove a point-in-time restore does not resurrect them. | A named operator executes every step without asking a question, and each step names the query that proves it. **Writing the drill is not running it**; the drill is versioned with GX-1's dossier. | 2026-11-13 | ADR 0037 §Consequences; the restore half depends on SRE — `days_since_verified_restore` has no value at all ([[0039-activation-plan-of-record]] §8.3, reliability-sre row), filed to their questions file as a dependency, not assumed | **Reach** — the restore half waits on SRE's first verified restore drill |

---

## §C — taste-fingerprint: the event contract, the shred boundary, the pre-registered plan

| # | Task | Doneability | Close | Evidence | Grade |
|---|---|---|---|---|---|
| **GX-9** | **The wine-only NF-B event contract, written against the shipped table** — column by column for `neural_footprint_event`: what fills `stimulus`, `context`, `internal_state`, `choice`, `outcome` for a bottle, and the enumerated list of shapes that are **not** events. | A reviewer takes any candidate wine interaction and decides in one pass; every rejected shape is listed with its reason; `outcome` NULL means **unknown, never success**, as the table's own comment requires. | 2026-10-23 | `supabase/migrations/20260824141116_neural_footprint_event.sql:17-42`, guest partial index `nfe_guest_choice` at `:51-54` with no writer. **Finding to file:** this team's charter names *"enters when OD-11's column contract closes"* as its entry trigger (`taste-fingerprint-charter.md:205-208`) — OD-11 **closed** on 2026-08-24 (Path C, ADR 0008; `OPEN-DECISIONS.md:116`). The stated trigger has fired; what actually holds the team is NF-B's hold, which is a different constraint and should be written as one | Ready |
| **GX-10** | **The field-level shred boundary** — the hardest question in the dossier, and the one that will be improvised at 2 a.m. on activation day if it is not answered now. Crypto-shredding encrypts per guest, and aggregates computed *before* erasure survive. So each NF-B column is either **encrypted** (dies with the key) or **plaintext-aggregable** (survives) — and a `choice` left plaintext was never erased, while a `choice` encrypted cannot be grouped after erasure. | Every column of `neural_footprint_event` carries a label, a justification, and the named analysis that breaks if the label is wrong. Where erasure and aggregation cannot both be satisfied for a column, the row **says so** instead of choosing quietly. Reviewed by [[compliance-privacy-charter]] and [[research-math-charter]]. | 2026-11-06 | ADR 0037 options 1 and 3 and the fallback clause (option 3 *"applied only to that path's inputs, never to the store itself"*); migration `:17-42` | **Reach** — depends on GX-4(c), key granularity |
| **GX-11** | **The pre-registered wine research plan, gated on activation.** Hypotheses, the dose-response prior shape, the tourist-delta baseline, and the falsification test written **before** a single event exists, with a power analysis: the minimum events-per-guest at which `nf_b.divergence_within_cohort` is measurable rather than noise. | The plan names, per claim, the *n* below which it will not be stated; it is executable the week activation lands with no further design; and it carries a written refusal — **no model is fit on the food corpus**, whatever its size. | 2026-12-04 | Loop L4 `nf-b-cohort-divergence` ([[guest-experience-loops]]); charter §Metrics — divergence is *"the metric that catches regional averaging wearing a personalization label"*; `master_wine_library`'s deterministic key, 0 false merges over 732,874 pairs (`20260819000000_guest_identity_minimal_slice.sql:246-252`); food corpus measured at 47 checks / 82 lines / **37 distinct strings** (`07-reference/DISH_IDENTITY_DESIGN.md` §1.1) | **Reach** — the plan is Ready; every claim in it is gated on activation |
| **GX-12** | **Quarterly corpus restatement — re-measured, not re-quoted.** | The quarter's numbers are produced by running the count, and any drift from 47 / 82 / 37 is stated with its date. **A run that reproduces last quarter's numbers without touching the corpus is a failed run even when the numbers are right.** | quarterly · first **2026-09-30** | `00-index/cards.json` → `taste-corpus-steward.quality_bar`, verbatim | Ready |

---

## §D — consumer-app-points-economy: make the founder's decision cheaper without making it

| # | Task | Doneability | Close | Evidence | Grade |
|---|---|---|---|---|---|
| **GX-13** | **The OD-05 / OD-07 branch brief — equal effort, zero recommendation.** This sub-layer disqualified itself from *recommending* on OD-07; that does not disqualify it from making the call cheaper to make. The material only this sub-layer can supply is new as of ADR 0037: under a partnership branch, **key custody crosses a company boundary** — who holds the per-guest key, who can execute a destroy, whose erasure promise binds the guest, and which of the two controllers a regulator asks. That question does not exist in the independent branch, and it did not exist before 2026-08-28. | Both branches at equal length with their key-custody, consent-controller and erasure-proof consequences; [[decision-office-charter]] confirms as a named reviewer that the brief contains **no recommendation sentence**; the founder can answer it without asking a follow-up. | 2026-09-25 | `OPEN-DECISIONS.md:28` (OD-05), `:30` (OD-07); ADR 0037; [[guest-experience-directive]] §"cannot decide — founder only" item 4; `FUTURES.md:199` (§7.5 already supplies the MVP scope the call was said to wait on) | Ready |
| **GX-14** | **The shred-class matrix.** Every data class the guest side will hold — identity rows, NF-B events, derived aggregates, the points ledger, photos, support correspondence — labelled **shred** / **retain-under-obligation** / **aggregate-only**. The sharp case is already visible: a points ledger carrying a retention obligation cannot live under a shreddable key, so points and taste cannot share one key by default. | No class is unlabelled; every *retain* names the obligation and the unit that owns it; every conflict between erasure and retention is written **as a conflict** rather than resolved by this sub-layer. | 2026-10-16 | `FUTURES.md:174-181` (§7.3 integrity rules, non-negotiable); ADR 0037; migration `:70-82` | Ready |
| **GX-15** | **Give `od-07-watch` a real trigger.** The job reads a document, nothing publishes, and a fork that closes quietly is invisible to this stack until the next weekly run. | A written watch contract handed to [[decision-office-charter]] — the register row's content hash, what a change emits, where it lands — after which this sub-layer can state, on any day, the **age** of the two decisions it is held by. | 2026-09-11 | [[guest-experience-agent-stack]] §5 gap rows; `cards.json` → `points-ledger-sentinel.declared_gaps` (`decision.od_07_closed` — publisher NONE) | Ready |

---

## §E — guest-value-monetization: the threshold, the boundary, and what erasure cannot reach

| # | Task | Doneability | Close | Evidence | Grade |
|---|---|---|---|---|---|
| **GX-16** | **Name the founding k.** The directive makes lowering k *below its founding value* a founder-only decision — and **no founding value is written anywhere in this vault.** A constant no document names cannot be guarded, and cannot be lowered "below" anything. | A proposed value with its derivation (segment sizes the one real tenant can actually produce, against re-identification risk), reviewed by [[compliance-privacy-charter]] — **never by us**, per [[ORG_STRUCTURE]] §3 — and locked by the founder as a register row; plus a guard spec in the proven shape of `scripts/check_no_guest_name_matching.sh`. | 2026-10-02 | [[guest-experience-directive]] §founder-only item 3; premortem M4 (*configurability is the mechanism; the lowering is only its first use*); [[guest-experience-agenda-board]] — *threshold not yet a code constant*; production tenant shape — 10 restaurants, **1 real tenant** (project memory, verified) | Ready |
| **GX-17** | **The advertising boundary statement — and the finding ADR 0037 does not cover: crypto-shredding does not shred a trained model.** Destroying a key makes rows noise; it does not remove what a model already learned from them. A personalization or ad model trained on NF-B is a *derived artifact* that outlives the erasure the guest was promised, and ADR 0037's revisit clause addresses decrypt **cost**, not model residue. | Two outputs. **(a)** A written boundary statement reconciling the shipped promise with a chartered advertising revenue model — per-surface or company-wide — reviewed by the founder and [[compliance-privacy-charter]]. **(b)** A finding filed to [[decision-office-charter]] naming the model-residue gap and *proposing* — never deciding — the treatment ADR 0037 already implies for it: its option-3 fallback (aggregate-only inputs) applied to the named training path, plus a retrain cadence tied to erasure volume. Until (a) exists the standing verdict on any advertising design stays **BLOCKED**. | 2026-10-09 | `apps/web/src/components/settings/ServicesPermissions.tsx:41` (*"Any advertising or cross-site tracking"* under exclusions) and `:249`; ADR 0037 options 1 and 3 + §Consequences; `cards.json` → `guest-value-gatekeeper.quality_bar` (*"the honest default while the statement is unwritten is BLOCKED, not pass"*) | Ready |
| **GX-18** | **Quarterly ops-conversion review, with its clock question settled.** | The quarterly row reads `0 (structurally — NF-B HELD, ADR 0029 §3)` and **never a bare 0**. Separately, the founder confirms whether the two-consecutive-quarters-at-zero scope trigger **starts at activation**: as written it fires against a hold the founder himself set, and would return this charter to [[product-vision-charter]] for a scope decision as a consequence of *his* decision rather than of this sub-layer's work. | quarterly · first **2026-09-30**; the clock question by **2026-09-18** | Loop L6 `nf-b-ops-conversion` — note `sub_layer_scope` under `changes` ([[guest-experience-loops]]); premortem M1 counter-pressure; ADR 0029 §3 | Ready |
| **GX-19** | **Design the sub-k empty state while it still costs nothing.** Eleven restaurant-facing paths are specified and none built. *"Not enough data yet"* is what removes the incentive to lower k later; designing it after the first empty segment card exists is designing it under pressure. **Docs only** — the visual language is [[design-charter]]'s and brand visuals are HELD, so this task produces no visual. | Each of the eleven paths names its sub-k rendering, and the spec states *every guest-derived claim renders its n, or it does not render* as a hard requirement rather than a guideline. | 2026-11-20 | `07-reference/UX_PATHS_CATALOG.md:1489-1491`, `:1494-1495`, `:1801-1806` (the eleven paths, per `cards.json` → `guest-value-gatekeeper.consumes`); premortem M3 and M4; charter §non-goals (Design owns what it looks like) | Ready |

---

## Findings this agenda records rather than fixes

Wave-3 rule: *a cross-unit need is a task addressed to that unit's questions file,
not an edit to their documents* ([[0039-activation-plan-of-record]] §8.4). These
are filed by GX-3, not by editing anything.

| # | Finding | Filed to |
|---|---|---|
| F1 | `guests.erasure_receipt_id` (`…minimal_slice.sql:82`) has no table, no FK, and no writer — and crypto-shredding makes the receipt the only proof of erasure a guest can be shown | guest-identity-consent · GX-5 |
| F2 | taste-fingerprint's written entry trigger (OD-11's closure) has **fired**; the real hold is NF-B's, which the charter does not say | taste-fingerprint |
| F3 | Crypto-shredding does not reach a trained model's parameters — an erasure-survivability gap ADR 0037's revisit clause does not cover | decision-office · GX-17(b) |
| F4 | The two-quarter `nf_b.ops_conversion` scope trigger currently runs against a founder-set hold | product-vision + founder · GX-18 |
| F5 | The k-threshold's **founding value** exists in no document, while lowering it below that value is a founder-only decision | compliance-privacy · GX-16 |
| F6 | Five of this sub-layer's six card triggers have **publisher NONE** — `nf_b.event_emitted`, `guest.link_refused`, `points.credit_held`, `surface.advertising_proposed`, `guest_data.render_requested`. The weekly schedule is the only live trigger, and the publishers arrive with activation, not before it | recorded here; no action while HELD |
| F7 | The `recommendation_actions` subject-type question the 2026-08-24 agenda escalated is **answered in schema and unanswered in code**: `subject_type` shipped with `'operator'` (`20260824141116_neural_footprint_event.sql:21-24`) and has zero emitters. It leaves the founder list and becomes a finding | people-agent-ops / analytics-bi |

---

## Questions for the founder

1. **OD-05 / OD-07 — unchanged as questions, changed as decisions.** ADR 0037 added
   a dimension that did not exist when they were filed: under a Beli collaboration,
   **who holds and who can destroy a guest's key**, and whose erasure promise binds.
   GX-13 puts both branches in front of you at equal length. This sub-layer still
   takes **no position** and still says why: an independent build maximises its own
   scope.
2. **Does the readiness dossier get its own file?** GX-1 wants
   `04-specs/NFB-ACTIVATION-READINESS.md` and names its retire-to-write pair
   (`00-index/PLAN.md` Push 4, already superseded by ADR 0029 §3). If you would
   rather not pay a document for it, the dossier stays a §-set in this agenda.
3. **Does the `nf_b.ops_conversion` stop-clock start at activation?** (GX-18.) As
   written, the sub-layer's own scope-review trigger fires because of your hold.
   Confirming this while it is hypothetical is the whole point of having written it.
4. **PROD-F3 — monetization here or in Commercial?** Unchanged and still open. Note
   only: GX-14's shred-class matrix and GX-17's boundary statement are guest-data
   obligations wherever the revenue lands, so neither waits on this answer.
5. **The advertising boundary** (GX-17a) — per-surface (operator app never, guest
   app with consent) or is `ServicesPermissions.tsx:41,249` the company's position?
   Cheap to answer now; expensive after someone finds both strings.

---

## What this agenda deliberately does not do

Named, so a later reader can see these were declined rather than missed.

- **No caller, no fixture, no "minimal wiring".** Including the tempting one: a
  synthetic NF-B corpus so the research plan could be dry-run. Rejected — synthetic
  rows in the production store make every `nf_b.*` denominator lie, and "it is only
  a fixture" is precisely the mechanism ADR 0029 §6.4 predicts.
- **No key-management design.** ADR 0037 gives it to privacy-engineering. GX-4
  supplies questions and guest-side requirements and stops there.
- **No recommendation on OD-05/OD-07**, and no work that assumes either outcome.
- **No pricing of anything**, including advertising — founder-deferred. GX-17 draws
  a boundary; it does not price what is inside it.
- **No brand or landing visuals** — HELD. GX-19 writes an empty-state *spec* and
  hands the visual to Design.
- **No food taste model**, at any corpus size, until A15 reverses **and** a dish
  identity referent exists.
- **No guard built here.** GX-7 and GX-16 produce specs; the builds are addressed
  to Engineering, and a spec is not a shipped guard.

## Stop conditions

- Any task on this agenda that starts producing the sentence *"just for the pilot"*
  → immediate escalation under [[guest-experience-directive]] §Escalation trigger.
  The vocabulary is the signal, not the outcome.
- **If OD-05/OD-07 close, this agenda is rewritten within one week, not extended.**
  Readiness work whose gate has opened is either execution or nothing.
- A task whose `close_time` passes **twice** without movement is deleted rather
  than rolled — [[README]] §6 anti-sprawl, applied to tasks the way [[guest-experience-premortem]]
  M5 applies it to units.

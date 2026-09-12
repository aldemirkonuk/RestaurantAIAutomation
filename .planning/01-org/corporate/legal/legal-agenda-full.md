---
type: agenda-full
division: corporate
department: legal
status: active
metrics: [legal.instrument_chain_integrity, legal.clause_library_hit_rate, legal.counsel_gate_compliance, legal.annex_satisfiability_signoff, nf_a.doneability_verdict]
updated: 2026-08-28
links: ["[[legal-charter]]", "[[legal-premortem]]", "[[legal-agenda-board]]", "[[legal-directive]]", "[[legal-loops]]", "[[legal-schedule]]", "[[legal-agent-stack]]", "[[legal-questions]]", "[[instruments-equity-charter]]", "[[commercial-workforce-agreements-charter]]", "[[corporate]]", "[[ORG_STRUCTURE]]", "[[0039-activation-plan-of-record]]", "[[0013-one-commitment-guardrail]]", "[[0037-nfb-erasure-is-crypto-shredding]]", "[[0001-mudavym-single-entity]]", "[[compliance-privacy-charter]]", "[[regulatory-posture-charter]]", "[[privacy-engineering-charter]]", "[[engineering-charter]]", "[[action-safety-the-human-gate-charter]]", "[[knowledge-documentation-charter]]", "[[decision-office-charter]]", "[[positioning-fundraise-readiness-charter]]"]
---

# Legal — Agenda · 2026-08-28

> First real agenda. Replaces the 2026-08-24 forecast under [[0039-activation-plan-of-record]]
> Track B.

> **Not legal advice, and nothing below is drafted legal text** ([[legal-directive]] R7).
> This agenda plans a *function* that commissions paper from a qualified lawyer.
> **No agent in this department signs, files, sends, or executes anything**
> ([[legal-agent-stack]] header). Every deliverable here is a fact sheet, a register
> row, a specification, or a hold — addressed to the founder and then to counsel.

## The frame

The 2026-08-24 charter said Legal had **zero artifacts**. That is still true of the
paper. It is no longer true of the *machinery*: this department owns exactly one
running thing, and it turned out to be the most load-bearing legal fact in the repo.

[[0013-one-commitment-guardrail]] asked **which surfaces can bind Mudavym to another
party**, counted them instead of trusting two "ported verbatim" comments, and found
19 / 8 / 3 patterns across three runtimes — with the runtime that could actually place
an order running the weakest list. That question is Legal's whole job, expressed as
code someone else maintains. This agenda's spine is turning that one-off count into a
**standing census that covers every channel**, not only the email one that got audited.

The second spine is the instrument nobody can schedule: a counterparty's DPA arrives
without a warning window. The gate either exists before that email or it does not
([[legal-premortem]] M4). So the DPA work here is groundwork — a subprocessor register,
a commitment→test map, an intake routine — deliberately *not* template text.

**What changed since 2026-08-24, verified today:**

| Claim in the vault | State on 2026-08-28 |
|---|---|
| `.claude/skills/` does not exist | **Stale.** It exists with **4 committed skills**, each wrapping `scripts/agents/run_card.py` (`.claude/skills/README.md:6-9`). The §3.3 admission gate now has worked examples — which is what makes `binding-surface-census` schedulable |
| No erasure design exists | [[0037-nfb-erasure-is-crypto-shredding]] is **Locked** (2026-08-28). NF-B stays HELD, zero callers — so the design exists and the behaviour does not. That distinction is exactly what an Annex signature turns on |
| Nothing measures whether an agent can bind us | Track A3 in [[0039-activation-plan-of-record]] builds **one typed propose→confirm→execute schema behind every mutation entry point**, measured as `safety.schema_coverage`. Legal has a claim to make on its denominator — see LEG-4 |
| CORP-F2 is staged for `OPEN-DECISIONS.md` | **Not there.** Grepped 2026-08-28: no `CORP-F2` row exists. Carried as LEG-8 |

---

## Program 1 — Productize the binding-surface census

The department's one skill ([[legal-agent-stack]] §3), moved from *a thing that
happened once* to *a thing that fires*. The seam holds: the guardrail's canon,
generator and CI job are **engineering's** (ADR 0013). Legal owns only the question —
which surfaces can bind us — and the answer's shape.

### LEG-1 · Census v1 — every outbound path, graded, by channel

- **Owner:** department · card `legal-intake-registrar` · skill `binding-surface-census`
- **close_time:** **2026-09-11**, then **quarterly** (alongside the [[legal-schedule]]
  quarterly sweeps) and **per-event** on any new outbound path
- **Doneability:** one table, every row read off disk with `path:line`, with columns:
  runtime · channel (email / SMS / voice / webhook / in-app) · recipient class (own
  staff vs counterparty) · auto-send behaviour · guard reached (yes / no / transitively)
  · the call path that proves it. A row whose recipient class cannot be settled from
  code **says "undetermined"** rather than guessing. Done when the table exists and
  every row cites a line.
- **Baseline measured 2026-08-28 (the number to beat):** **14 non-test files carry an
  outbound send call** — 9 in `apps/api-gateway/src` (`sendEmail(`/`sendSms(`), 5 in
  `services/agent-orchestrator` (`send_email(`/`send_sms(`) — while only **3 runtime
  files reference the commitment guardrail**: `inbound-responder.service.ts`,
  `provider_conversation_agent.py`, `constraint_engine.py`.
- **Evidence:** [[legal-agent-stack]] §3 (skill row + its past instance);
  [[0013-one-commitment-guardrail]]; [[legal-charter]] §Boundaries (Legal owns the
  question, not the code).

### LEG-2 · The method rule: trace call paths, never import lists

- **Owner:** department · feeds LEG-1's doneability bar
- **close_time:** **2026-09-11** (it is LEG-1's acceptance criterion, not a separate run)
- **Doneability:** the census specification states, in one line, that a surface counts as
  guarded only when a *call path* reaches the guard — and carries the worked example
  below as the reason.
- **Evidence — this was measured today and it corrects the obvious method:**
  `provider_communication_agent.py` does **not** import `COMMITMENT_PATTERNS`, so an
  import-grep marks it unguarded. It is guarded: line 578 calls
  `ce.check_hard_constraints(draft_body)`, and `constraint_engine.py:46-48` composes
  C-02 as a **union** of the shared 19 plus 3 heuristics (ADR 0013's resolution). A
  census built on imports would have filed a false finding on the company's busiest
  vendor-facing drafting path.

### LEG-3 · The voice channel — the census's first real row

- **Owner:** department (files the fact) → engineering (owns any fix)
- **close_time:** **2026-09-11** with LEG-1; the engineering ask ages out at **42 days**
  ([[legal-questions]] escalation rule)
- **Doneability:** a census row and a single question in `engineering-questions.md`,
  stating the channel and its guard state and **asking nothing about the law**. Closed
  when the row exists and the question is filed with a date.
- **Evidence, measured 2026-08-28:** `services/agent-orchestrator/services/plivo_voice_client.py:514-545`
  composes a spoken message naming a quantity and a target price and gathers
  *"press 1 if you can accommodate this order"*; its caller-side path
  `agents/procurement_agent.py:732-800` is the only `make_call(` site. **Neither file,
  nor `plivo_client.py` (the SMS transport), references the constraint engine or the
  commitment guardrail** (grep: zero matches). The path has **no in-repo caller** today
  and the client constructs only when `PLIVO_AUTH_ID`/`PLIVO_AUTH_TOKEN` are set
  (`procurement_agent.py:85-100`) — so it is dormant, wired, and one call site from live.
- **The line this task does not cross:** whether a DTMF "press 1" forms anything is a
  question for counsel. Legal records the surface and its guard state. That is the census.

### LEG-4 · Claim the outbound-send class inside Track A3's coverage denominator

- **Owner:** department → [[action-safety-the-human-gate-charter]] (the gate) and
  engineering (the executors)
- **close_time:** a dated row in action-safety's questions file by **2026-09-04** —
  *before* A3's schema is written, since a denominator is cheap to widen at design time
  and expensive afterwards
- **Doneability:** A3's coverage definition either **names** "an outbound message to a
  counterparty" as a mutation entry point, or records a reasoned refusal in the A3 ADR.
  Either outcome closes this; silence does not.
- **Why it is Legal's to ask:** A3 counts mutations of stock, money and outbound
  ([[0039-activation-plan-of-record]] Track A3). Sending a vendor a message that names a
  price and a quantity mutates the company's contractual position, and that class is the
  one Legal exists for. If it is inside `safety.schema_coverage`, "which surfaces can
  bind us" stops being a document and becomes a number the org already watches.
- **Evidence:** ADR 0039 A3 row; [[legal-charter]] §Metrics tie (`nf_a.doneability_verdict`
  is strictest here); ADR 0013's finding that the binding-capable runtime ran the weakest guard.

### LEG-5 · **Reach** — the retro-census: have we already said something binding?

- **Owner:** department · read-only · requires production access held by the founder / SRE
- **close_time:** **2026-09-25**, or a dated **BLOCKED** row naming who holds the access
- **Doneability:** a counts-only table — outbound rows in `procurement_conversations`
  where `sent_at IS NOT NULL`, grouped by `outbound_email_type` × `ai_generated`, with
  the count matching ≥1 canon pattern and the count with `disclaimer_appended = false`.
  **No message text is copied into this vault** (counts only; the text is a customer's
  and a vendor's). Done when the counts exist with a run date, or the blocker is named.
- **Evidence:** the production baseline defines the table with `direction`, `channel`,
  `message_text`, `ai_generated`, `sent_at`, `disclaimer_appended`, and a CHECK
  constraint enumerating `DEMAND_OFFER`, `COUNTER_OFFER`, `ACCEPTANCE_CONFIRM_REQUEST`,
  `ORDER_CONFIRMATION` (`supabase/migrations/20260805000000_baseline_from_production.sql:4294-4331`).
  The system already sorts its own vendor mail into offer-and-acceptance categories.
  Every guardrail in this repo runs at **draft** time; nothing has ever read the
  **sent** corpus. This is the one question the census cannot answer from source.
- **Honest grade:** aspiration until the access question is answered. It is listed
  because a blocked task with a named blocker is a finding, and an unlisted one is not.

---

## Program 2 — DPA / BAA groundwork, with Compliance & Privacy

Groundwork, precisely bounded: **no template text is produced here**, by R7 and because
drafting is counsel's. What can exist before a counterparty appears is the *factual
substrate* an Annex is assembled from, and the routine that stops M4.

### LEG-6 · Subprocessor register v1 — the Annex's factual input

- **Owner:** [[commercial-workforce-agreements-charter]] (instrument side) ·
  [[regulatory-posture-charter]] co-reads (obligation side)
- **close_time:** **2026-09-18**, then **quarterly** with the Annex re-validation row in
  [[legal-schedule]]
- **Doneability:** one row per third party that can receive restaurant or guest data:
  vendor · what reaches it · the manifest or config `path:line` that proves it is wired ·
  whether a data agreement with that vendor exists (today the honest answer is *unknown*
  for all of them). Done when every row cites a line and no row is inferred.
- **Evidence, read 2026-08-28:** six processors are named in dependency manifests —
  `@supabase/supabase-js` (`apps/api-gateway/package.json:40`), `googleapis` (`:52`),
  `plivo` (`:60`), `@sentry/node` (`:39`), `openai` (`services/agent-orchestrator/requirements.txt:45`),
  `anthropic` (`:46`) — plus the hosting topology ADR 0013 documents. **`GDPR` and
  `CCPA` appear zero times across `apps/`, `services/` and `packages/`** (grep, 2026-08-28),
  which is the same finding [[legal-premortem]] M4 predicted, still true.
- **Seam, stated so it is not fought over later:** Legal owns *the list an Annex would
  have to name*; Compliance owns *whether the code honours what the Annex promises*.

### LEG-7 · The commitment→test map, dry-run before any DPA exists

- **Owner:** department + [[regulatory-posture-charter]]; [[privacy-engineering-charter]]
  names each test
- **close_time:** **2026-10-02** for the dry run; **per-event** thereafter (L-LEG-2)
- **Doneability:** for each standard Annex commitment class — deletion, retention,
  subprocessor notice, breach notice, access/portability, security measures — either a
  named implemented **and tested** behaviour, or `NONE` with the reason. The output is a
  **dry-run finding, not a signature**. Done when every class has a verdict and at least
  one reads `NONE` honestly.
- **Expected first result, stated in advance so a pass is not mistaken for progress:**
  the deletion row reads *designed, not implemented* — [[0037-nfb-erasure-is-crypto-shredding]]
  is Locked but NF-B is HELD with zero callers, and the erasure path is graded untested
  end-to-end (`corporate.md:31`, `:471`). **The first firing of L-LEG-2 is supposed to
  fail** ([[legal-loops]] L-LEG-2). A green first run means the map was written too kindly.
- **Evidence:** [[legal-directive]] R4; [[legal-loops]] L-LEG-2; [[legal-premortem]] M4;
  ADR 0037.

### LEG-8 · DPA intake routine — the 24 hours after the email lands

- **Owner:** department · card `legal-intake-registrar` (lane assignment is its one
  genuinely departmental job)
- **close_time:** **2026-09-11** — the whole value is that it predates the first counterparty
- **Doneability:** one page: lane = data instrument; the hold at `in counsel review`;
  who co-signs; what the register records; what the requester is told and when. Done
  when a person who has never read this vault could route the email correctly from it.
- **Evidence:** [[legal-directive]] decision graph (the DPA/BAA branch);
  [[legal-agent-stack]] §2 card triggers; [[legal-premortem]] M4 ("there is no
  preparation window").

### LEG-9 · Stage CORP-F2 into `OPEN-DECISIONS.md` via [[decision-office-charter]]

- **Owner:** department → Decision Office
- **close_time:** **2026-09-04**
- **Doneability:** a row exists stating the fork (two signatures on DPA/BAA, or one team
  holding both) with both costs — two signatures is slower and catches M4; one team is
  faster and cannot. **Not resolved here**; staged.
- **Cost to name when doing it:** adding a register row re-anchors citations below it
  (ADR 0025, Locked). Both register guards run, not only the claims one.
- **Evidence:** [[legal-charter]] §Open forks (`corporate.md:495`); verified 2026-08-28
  that no `CORP-F2` row exists in `OPEN-DECISIONS.md`.

---

## Program 3 — The founding four, split across both teams

Register → gates → counsel → library. The 2026-08-24 sequencing argument holds and is
not re-litigated; what changes is that each step now carries a close-time.

### LEG-10 · Give the instrument register a home

- **Owner:** department (the directive gives it the register's state machine)
- **close_time:** **2026-09-11**
- **Doneability:** a file exists with the six states (requested · drafted · in counsel
  review · out for signature · executed · superseded), the owning-team column, the gates
  column and the retention-location column — and **zero rows**. Done when
  `legal-intake-registrar`'s `consumes` gap row can be struck.
- **Blocked on a question, not on work:** retire-to-write (CLAUDE.md §4) says a new
  document names one to retire. An *operational register* may not be a document in that
  sense. Filed to [[knowledge-documentation-charter]] as LEG-X2 rather than assumed.
- **Evidence:** [[legal-agent-stack]] §5 gap table ("The instrument register has no
  home" — every `consumes` row depends on it); [[legal-loops]] L-LEG-1.

### LEG-11 · The counsel engagement brief — written by us, sent by the founder

- **Owner:** department; **the founder sends it. No agent sends anything**
- **close_time:** **2026-09-18**
- **Doneability:** a brief the founder can forward without editing: the entity fact
  ([[0001-mudavym-single-entity]]:38 — one brand, one legal surface), the six one-way-door
  classes, which classes need counsel before signature, and the first three questions.
  Done when it exists and names a candidate class list, not a firm — choosing the firm is
  the founder's.
- **The sequencing observation it carries, unchanged from 2026-08-24:** there is a full
  codebase and no instrument assigning its IP to the entity. That is an observation about
  an empty register, not a legal opinion. Founder agreement and IP assignment go in front
  of counsel first, ahead of any SAFE or commercial paper, because their absence is
  discovered by somebody else, at diligence, when it is least fixable.
- **Evidence:** [[legal-directive]] R1; [[legal-charter]] §Evidence today.

### LEG-12 · **Reach** — the provenance fact pack for the IP question

- **Owner:** department, prepared for counsel · facts only
- **close_time:** **2026-09-18**, alongside LEG-11
- **Doneability:** a fact sheet with four counts and no characterization: distinct commit
  authors; commits by anyone other than the founder; commits carrying an AI co-author
  trailer; and the dated repo-wide sweep showing no instrument of assignment exists
  anywhere in the tree. Done when every number has the command that produced it.
- **Why this is the ambitious one:** the fifteen document types presume counterparties
  that mostly do not exist yet, so most of them are readiness work. **This one is about
  paper that is already missing under work already done.** CLAUDE.md §7 requires every
  commit to carry `Co-Authored-By: Claude Opus 5`, so the repo's own history states how
  it was built — that is a fact a diligence process will read whether or not we read it
  first. Reading it first costs a morning.
- **The line:** the pack states counts. What they mean is counsel's, and this department
  will not preview an answer.
- **Evidence:** CLAUDE.md §7 (the mandated trailer); [[legal-charter]] §Evidence today
  (repo-wide sweep found no contract, template, or cap table); ADR 0001:38.

### LEG-13 · Name the waiting period — it has never had a number

- **Owner:** founder decides; department records
- **close_time:** **2026-09-04**
- **Doneability:** a number is written into [[legal-directive]] R2 and
  `instruments-equity-directive` IE-1. Done when the register can enforce it instead of
  a person remembering it.
- **Evidence:** R2 and IE-1 both say *"a named waiting period"* and **neither names one**
  (read 2026-08-28). A floor with no value is a norm, and [[legal-premortem]] M2 is
  precisely a norm failing under time pressure.

### LEG-14 · Clause-library skeleton — sections named, every position blank

- **Owner:** [[commercial-workforce-agreements-charter]]
- **close_time:** **2026-10-02**
- **Doneability:** per repeatable instrument type, the section list; plus the
  fallback-ladder shape (preferred / acceptable / walk-away) with **every rung empty**
  and marked *founder + counsel decide once*. Done when `legal.clause_library_hit_rate`
  has a defined denominator — it currently has none, which is why 0% is uninformative.
- **Explicitly not done here:** writing any clause text. R7, and M3's counter-pressure is
  a *decided* ladder, not a drafted one.
- **Evidence:** [[legal-charter]] §Metrics (library does not exist, `corporate.md:104-106`);
  [[legal-premortem]] M3; loop `cw-library-health` (monthly).

### LEG-15 · Instruments & Equity: checker specs only — no drafting skill, by design

- **Owner:** [[instruments-equity-charter]]
- **close_time:** **2026-10-16** for the specs; the skills themselves stay **per-event**,
  gated on the first instrument
- **Doneability:** `instrument-chain-check`, `cap-table-tie-out` and
  `consent-record-completeness` each get a written spec — input, the exact assertion, the
  refusal it emits, and the reproducibility bar the card already states: *rerun against
  the same register state yields the same verdict and names the same missing leg*. Done
  when a spec is precise enough to implement and **none of them is committed as a skill**.
- **Why they stay specs:** foundation §3.3 rule 3 deletes a skill with no real past
  instance, and with zero instruments there is none. The four skills admitted on
  2026-08-28 each carried one. Committing these now would be the same overreach in a
  friendlier costume.
- **Evidence:** [[legal-schedule]] §Skills owned (the checker table, "nothing in this
  table exists"); `ie-chain-warden` card quality bar; `.claude/skills/README.md:6-9`.

### LEG-16 · Record the merge condition as two dates, not a sentence

- **Owner:** department → [[decision-office-charter]]
- **close_time:** **2026-09-04** to record; the reviews are **quarterly**
  (first **2026-11-27**, second **2027-02-26**)
- **Doneability:** both dates and the numeric condition are written where a calendar can
  see them: at the second review, if Instruments & Equity has issued **zero** instruments
  and Commercial & Workforce has executed **fewer than five** agreements, Legal runs as
  one team and the charter is rewritten to say so. Done when the reversal is on a date,
  not in a paragraph.
- **Evidence:** [[legal-loops]] L-LEG-5; [[legal-premortem]] M1 ("the trim was right and
  nobody noticed"); this department is the org's only named **merge** trigger.

---

## Findings — things no card and no loop can carry

Per [[0039-activation-plan-of-record]]: a task no card or loop can carry is recorded
here, not listed as work.

**F1 — `legal.agenda_content_diff_days` has no producer, and the watcher cannot supply
it.** L-LEG-5 and [[legal-premortem]] M1 both turn on detecting a *date-only* agenda
bump. `scripts/watch_loops.py:74` reads `frontmatter(p).get("updated")` and nothing else
— by construction it cannot distinguish a content change from a date bump, which is
exactly M1's disguise. ADR 0039 makes this watcher the live anti-rot check after wave 3.
Filed as LEG-X3.

**F2 — the census has no mechanical home.** `run_card.py` executes cards whose
`routing_class` is `mechanical` (`scripts/agents/run_card.py:375`); `legal-intake-registrar`
is `extraction`. So `binding-surface-census` cannot run as a card today without a
card-shape change, and wave 3 does not edit agent stacks. Recorded for the next
agent-stack revision; LEG-1 stands as a specified, human-run census in the meantime.

**F3 — three of the department's four `consumes` gaps are the same gap.** The register,
the request path, and the `legal.paper_requested` publisher are one missing object seen
from three sides ([[legal-agent-stack]] §5). LEG-10 closes one third of it; the other two
thirds need a requester who is not the founder, and there is not one yet. Not scheduled.

**F4 — CORP-F1 / OD-17 got sharper, not answered.** This department now holds **9**
artifacts per unit across 3 units. Nothing in this agenda resolves that fork, and
Program 3's honest reading is that most of the cost is in paper that has no counterparty.

---

## Cross-unit asks — each lands in that unit's `questions` file, none blocks

| ID | To | Ask | close_time |
|---|---|---|---|
| LEG-X1 | engineering | The voice and SMS vendor-facing paths reach no commitment guard (LEG-3). Is that intended while dormant, and what should happen at the first caller? | 42-day age-out |
| LEG-X2 | knowledge-documentation | Does an **operational** register count as a document under retire-to-write, or only prose? LEG-10 is waiting on the answer, not on the work | 42-day age-out |
| LEG-X3 | whoever owns `watch_loops.py` post-ADR-0039 | A content hash beside `updated:`, so a date-only bump is visible (F1) | 42-day age-out |
| LEG-X4 | applied-ai/action-safety | Name the outbound-to-counterparty class inside A3's coverage denominator (LEG-4) | 2026-09-04 |
| LEG-X5 | compliance-privacy | Co-read LEG-6 and co-run LEG-7's dry run; the deletion row will read `NONE` and that is the useful outcome | 2026-10-02 |

---

## Close-time summary

| close_time | Tasks |
|---|---|
| 2026-09-04 | LEG-4 (ask filed) · LEG-9 · LEG-13 · LEG-16 (record) |
| 2026-09-11 | LEG-1 · LEG-2 · LEG-3 · LEG-8 · LEG-10 |
| 2026-09-18 | LEG-6 · LEG-11 · LEG-12 |
| 2026-09-25 | LEG-5 *(reach — may close as BLOCKED with a named holder)* |
| 2026-10-02 | LEG-7 · LEG-14 |
| 2026-10-16 | LEG-15 (specs only) |
| Recurring | LEG-1 quarterly + per-event · LEG-6 quarterly · LEG-7 per-event (L-LEG-2) · LEG-15 per-event · LEG-16 quarterly (2026-11-27, 2027-02-26) |

Nothing here is weekly. The open-request standup in [[legal-schedule]] stays weekly and
stays silent while the queue is empty; inventing a second weekly cadence over an empty
register is [[legal-premortem]] M1, and the schedule already refuses it.

## What this agenda deliberately does not do

- **No template drafting.** Not a DPA, not an NDA, not an MSA. R7 forbids clause language
  in this vault and drafting is counsel's. Program 2 builds the substrate instead.
- **No skills committed without a past instance.** Six of the seven checkers in
  [[legal-schedule]] stay specs (LEG-15).
- **No fork resolved.** CORP-F2 is staged (LEG-9); the trim is dated (LEG-16); CORP-F1
  is recorded as sharper (F4).
- **No opinion on what any surface means.** The census records channels and guard states.
  Whether any of them binds anything is counsel's, permanently.

## Questions for the founder

1. **What is the waiting period?** R2 and IE-1 both promise "a named waiting period" and
   neither names one. Any number is enforceable; no number is a norm (LEG-13).
2. **Who runs LEG-5's read-only query?** It touches production, it returns counts only,
   and it answers the one legal question source code cannot: whether anything already
   sent to a vendor carries commitment language. If nobody can run it, it closes as
   BLOCKED and we should say so rather than leave it open.
3. **Is the scope a readiness list or a build list?** Nine of the fifteen document types
   presuppose parties that do not exist — no employees, no contractors, no enterprise
   customers, no investors. This agenda assumes **readiness**, and puts real build effort
   only where a counterparty or an artifact already exists.
4. **CORP-F2 — two signatures on DPA/BAA, or one team with both halves?** Staged, not
   answered (LEG-9).
5. **Does the counsel gate hold absolutely?** The first exception request will be
   reasonable and will arrive under time pressure. Confirming now costs nothing.
6. **May an agent draft legal paper at all?** This vault's answer is unchanged: retrieval
   assembly in the repeatable class only, `[GAP]` markers mandatory, no generative
   drafting in the one-way-door class, a named human reviewer on everything. It is a real
   constraint on the AI-native premise, and it is yours to overrule.

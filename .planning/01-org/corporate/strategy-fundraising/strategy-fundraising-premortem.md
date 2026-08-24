---
type: premortem
division: corporate
department: strategy-fundraising
status: provisional
metrics: [strategy.claim_to_evidence_coverage, strategy.citation_drift_rate, strategy.claim_overstatement_count, strategy.wedge_metric_instrumentation, strategy.diligence_pack_completeness]
updated: 2026-08-24
links: ["[[strategy-fundraising-charter]]", "[[strategy-fundraising-directive]]", "[[strategy-fundraising-loops]]", "[[strategy-fundraising-schedule]]", "[[strategy-fundraising-agenda-full]]", "[[positioning-fundraise-readiness-premortem]]", "[[metric-contract-truth-assurance-charter]]", "[[design-partner-operations-charter]]", "[[narrative-collateral-charter]]", "[[standards-verification-charter]]", "[[instruments-equity-charter]]", "[[decision-office-charter]]", "[[red-team-charter]]", "[[OPEN-DECISIONS]]", "[[README|foundation-README]]"]
---

# Strategy & Fundraising — Premortem

> Written at founding, before success is assumed.

Five mechanisms. The first is inherited from `corporate.md:453-456` and expanded; the
other four are derived from evidence verified for [[strategy-fundraising-charter]]. They
are ordered by likelihood, and the ordering is itself a claim: **M1 and M2 are the ones
that will actually happen**, because both are already visible in the single artifact this
department starts with.

---

## M1 — The deck outruns the build

**It is 12 months from now.** *"$X recovered across N restaurants"* went on a slide because
the sentence was good and the number was almost true. A partner asked for the number. The
answer was a **count of `creditDue` verdicts**, not money that moved — because
`YC_WEDGE_PLAN.md:31-33` had already established that *"dollars recovered"* means *"we
asked"* until an X12 812 credit memo lands on a later invoice, and nobody carried that
sentence into the deck. The meeting is lost, and worse: **every other number on the page is
now discounted**, including the ones that were correct.

The mechanism is not dishonesty. It is that the strong verb is the natural one, the weak
verb is the deliberate one, and there was no moment in the process where the deliberate
choice had to be made out loud.

**Earliest observable signal.** The phrase *"dollars recovered"* — or *"recovered",
"saved", "returned"* — appears in any outward artifact while
`strategy.wedge_metric_instrumentation` still reads **slide, not query**. That is checkable
today, on a document that does not yet exist, which is why the check belongs in the gate
rather than in a review.

A second, earlier signal: **a claim enters the register with a plan as its evidence**
("this will be queryable after B5") rather than a query id. A future citation is the
grammatical form of this failure.

**What would have prevented it.** [[strategy-fundraising-directive]] R1: *a published claim
uses the weakest verb its evidence supports*, enforced as a **send gate**, not a review
step. Concretely, three things that are cheap now and impossible later:

1. The claim register requires **a query id, a `path:line`, or a recorded demo** — never a
   roadmap item. A claim whose evidence is a plan is rejected, not deferred.
2. The recovery claim specifically is bound to [[design-partner-operations-charter]]'s
   **verified** number — credits watched landing — and to
   [[metric-contract-truth-assurance-charter]]'s definition. Strategy publishes the weaker
   of the two.
3. `YC_WEDGE_PLAN.md:369-373`'s own recommendation is taken seriously as the fallback:
   **lead with cost drift caught**, which is verifiable monthly and structurally larger,
   and keep recovery as the second line.

---

## M2 — Stale citations survive into investor material

**It is 12 months from now.** A diligence reader opened the data room, picked one
`path:line` at random to test whether the technical claims were real, and it did not
resolve. Everything after that was read as marketing. The finding they checked was **true**
— the line number had simply moved three commits after it was written.

This is not hypothetical. It is already the state of the department's founding artifact,
verified for [[strategy-fundraising-charter]]:

| Instance | In the doc | On disk today |
|---|---|---|
| Hand-typed invoice inputs | `YC_WEDGE_PLAN.md:401` cites `ReceivingWorkspace.tsx:233,265` | Finding holds; lines are now `:401,440` |
| `invoiceQty` default | same line cites `:92` defaulting to `stockedQty` | Now `null` at `:168`, by deliberate design change |
| ux-optimizer guards | `YC_WEDGE_PLAN.md:404` — *"0 `@UseGuards`, all re-confirmed 2026-07-27"* | `ux-optimizer.controller.ts:55` carries `@UseGuards(JwtAuthGuard)`. The **same document** marks it ✅ secured at `:339` |
| Document status | `YC_WEDGE_PLAN.md:5` — *"REVISION 2 — in progress"* | §*"REVISION 3"* opens at `:9` of the same file |

**Three drifted or inverted citations in a seven-source section, in thirteen months.**
Investor material has a *longer* half-life than a build plan and a *less forgiving* reader.

**Earliest observable signal.** `strategy.citation_drift_rate` above 0% on any sample — and
the very first sample will show it, because the baseline is already ≈29%. The signal is
available before a single outward document exists, which is unusual and should be used.

The subtler signal: a citation carrying a **verification date older than the artifact's
send date**. `:404`'s *"re-confirmed 2026-07-27"* is the exact shape — the confirmation was
real when made, and the sentence outlived it.

**What would have prevented it.** Re-verification as a **precondition of sending**
([[strategy-fundraising-loops]] L-STR-1), never as a monthly sweep. A monthly sweep is what
produced `:404`: the claim was verified, the note said so, and then the world moved. Also:

- Every citation in outward material carries its **own** re-verification date, not the
  document's.
- Prefer **behavioural** citations (a demo that runs, a query that returns) over positional
  ones (`file:line`). A demo cannot silently drift; a line number always can.
- Where a `path:line` is unavoidable, cite the **symbol** alongside it
  (`ReceivingWorkspace.tsx` → `invoiceQty` input) so drift degrades into a search rather
  than into a falsehood.

---

## M3 — The department becomes a fundraising department with no raise

**It is 12 months from now.** No raise happened, and the department spent the year getting
ready for one: a data room nobody opened, a cap-table template with no cap table under it,
a diligence checklist maintained against no counterparty. Meanwhile the claim register was
never built, the wedge metric is still a slide, and Growth and Sales published four claims
nobody checked because the unit that was supposed to check them was busy being a bank.

This is the failure the **one-team decision** was made to avoid
(`corporate.md:405-415`), which is exactly why it can still happen: **the deferred second
team can grow inside the first one.** Nothing structural stops the readiness half from
consuming the cadence; the split was declined, not the work.

**Earliest observable signal.** In any month, agenda items about **instruments and
readiness** outnumber items about **claims and evidence** — while
`strategy.diligence_pack_completeness` rises and `strategy.claim_to_evidence_coverage` does
not. Two metrics moving in opposite directions is the readable form of it.

Second signal: the department produces a diligence artifact **before** a term-sheet
conversation exists. There is exactly one that is defensible in advance (a one-page index
of where things would live); a second one is the symptom.

**What would have prevented it.** A hard ordering rule in
[[strategy-fundraising-directive]] R4: **beyond a one-page data-room index, no diligence
artifact is built before the split trigger fires.** Readiness work is *triggered*, claim
work is *continuous* — and [[strategy-fundraising-loops]] L-STR-5 reads the ratio quarterly
rather than trusting the intent. The split trigger being named
(`corporate.md:457-458`) is what makes the ordering enforceable instead of aspirational.

---

## M4 — The surface-area problem returns as an org problem

**It is 12 months from now.** `YC_WEDGE_PLAN.md:323-324` warned that the company's biggest
risk is **surface area** — 573 insight types, an 860-path UX catalogue, a sommelier AI, a
calendar, promotions — and that *"a YC partner reads that as no wedge."* The warning was
taken seriously about the product. It was not taken seriously about the **company**. There
are now 99 chartered units and 693 documents, and the answer to *"what do you do?"* is
structurally longer than it was when the warning was written.

The irony is load-bearing: this org built an elaborate structure whose founding document
identifies elaborate structure as the thing that loses the room.

**Earliest observable signal.** The wedge sentence (`YC_WEDGE_PLAN.md:312`) appears in
**fewer** outward artifacts than the org chart does. Equivalently: any outward artifact
that describes the company by its departments rather than by its sentence. Both are
countable, and the second is a single grep.

A quieter signal: the department starts *defending* the surface area — explaining why the
sommelier AI and the calendar are coherent — instead of subordinating it. `:324`'s
prescription is *"none of it needs deleting — but one thing has to be the headline, and the
rest becomes 'and it also does X'."* Explaining is the failure mode; subordinating is the
job.

**What would have prevented it.** The wedge sentence held as a **department-owned
constant** with a single named owner, and a standing rule that every outward artifact
reduces to it in its first paragraph ([[strategy-fundraising-directive]] R5). Enforced with
[[narrative-collateral-charter]] M2, whose own primary metric — *one headline claim* — is
the execution half of the same rule. Strategy owns what the sentence says; M2 owns that
every artifact leads with it. Neither works alone.

---

## M5 — OD-23 is resolved by drift rather than by decision

**It is 12 months from now.** The *$20k MRR in 30 days* target ([[OPEN-DECISIONS]]:27) was
never hit and never formally revised. It simply stopped being mentioned. Commercial spent
two quarters planning against a number nobody believed, Finance & Pricing held a
$20–50/mo lock that implies 400–1,000 paying restaurants in 30 days with no self-serve
funnel built, and no ADR records that anything changed. When an investor asks *"what was
your target and did you hit it?"*, there is no answer that is both true and coherent.

This is a **decision-hygiene** failure, and it is precisely the failure
[[ORG_STRUCTURE]] §3 created the [[decision-office-charter]] to prevent: *"decisions
actually close rather than drifting."* Strategy is the department that pays for it, so
Strategy is the department that must not let silence read as resolution.

The upward-enforcement variant is the sharper one: **this department polices Growth's blog
post and not the founder's verbal pitch.** Written claims get a register; spoken ones do
not; the strongest claims are always spoken first. A department that only audits artifacts
audits the least dangerous surface.

**Earliest observable signal.** The target is absent from **two consecutive** Commercial
agendas with no ADR superseding it. Also: any Commercial or Product plan that quotes a
revenue figure **without** citing OD-23's open status. A number quoted without its open
decision attached is the drift, mid-flight.

**What would have prevented it.** Three things, all cheap:

1. **OD-23's unresolved status is reported monthly**, by name, in
   [[strategy-fundraising-agenda-board]] — including when nothing has changed. *"Still
   open, still unresolved, day N"* is a real reading and the only one that prevents silence.
2. Every Strategy artifact quoting a revenue target carries the fork id inline.
3. The claim register covers **spoken** claims too: after any external conversation where a
   number was given, the number is entered with its evidence. A pitch is a publication with
   no artifact, and treating it otherwise is how M1 and M5 meet.

---

## Signal summary

| # | Mechanism | Earliest signal | Counter-pressure |
|---|---|---|---|
| M1 | Deck outruns the build | Strong verb published while the metric is still a slide; a claim whose evidence is a plan | R1 verb-strength send gate; register requires a query id |
| M2 | Stale citations in investor material | `strategy.citation_drift_rate` > 0 — already ≈29% at baseline | L-STR-1 re-verify **on send**; per-citation dates; prefer demos to line numbers |
| M3 | Fundraising department with no raise | Readiness items outrank claim items; completeness rises while coverage does not | R4 — no diligence artifact before the split trigger, beyond a one-page index |
| M4 | Surface area, as an org | Wedge sentence appears in fewer artifacts than the org chart | R5 — one sentence, department-owned; M2 enforces the lead |
| M5 | OD-23 drifts instead of closing | Target absent from two consecutive Commercial agendas, no ADR | Monthly named reporting of unresolved status; register covers spoken claims |

Team-level mechanisms — the operational ones that sit *inside* these — are in
[[positioning-fundraise-readiness-premortem]]. [[red-team-charter]] is the natural external
reader for this file: advisory is findings-only ([[ORG_STRUCTURE]] §3), and a premortem
whose author is also its only auditor is a premortem grading its own homework.

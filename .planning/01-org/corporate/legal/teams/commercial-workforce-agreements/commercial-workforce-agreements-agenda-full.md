---
type: agenda-full
division: corporate
department: legal
team: commercial-workforce-agreements
status: provisional
metrics: [legal.clause_library_hit_rate, legal.request_to_executable_draft_days, legal.annex_satisfiability_signoff]
updated: 2026-08-24
links: ["[[commercial-workforce-agreements-charter]]", "[[commercial-workforce-agreements-premortem]]", "[[commercial-workforce-agreements-agenda-board]]", "[[commercial-workforce-agreements-directive]]", "[[commercial-workforce-agreements-loops]]", "[[commercial-workforce-agreements-schedule]]", "[[legal-charter]]", "[[legal-agenda-full]]", "[[regulatory-posture-charter]]", "[[privacy-engineering-charter]]", "[[decision-office-charter]]"]
---

# Commercial & Workforce Agreements — Full Agenda

> **PROVISIONAL — no work done yet.** This is forecast, not fact.

> Not legal advice, and nothing below is drafted legal text. This plans a function that
> will commission and assemble paper reviewed by a qualified lawyer.

## What

Build the **template system before the first agreement**, not after the twentieth. Four
deliverables, none of which is a contract:

| Deliverable | Why this shape |
|---|---|
| **The clause-library skeleton** — sections named, provenance rule stated, positions blank | A skeleton makes the second agreement cheaper than the first without pretending to knowledge nobody has yet. A *populated* library at v0 is [[commercial-workforce-agreements-premortem]] M5 built on purpose |
| **The fallback-ladder structure** — which sections are contentious, what a rung is, who sets one | The rungs themselves are the founder's, once, with counsel. The *structure* is ours and it costs nothing today |
| **The two-signature gate**, wired with [[regulatory-posture-charter]] | A DPA arrives on somebody else's timeline. The gate exists before that email or it does not exist |
| **Metric definitions, fixed before the first reading** — especially "executable" | A definition settled after the first reading is settled favourably ([[commercial-workforce-agreements-premortem]] M2) |

## How

**Sequence: definitions → gate → skeleton → grow from executions.**

1. **Definitions first**, because they are the cheapest thing to get right and the most
   expensive to fix. "Executable" means *a named human reviewed it and no `[GAP]` remains*
   — not "sent". Fixing that now costs a sentence; fixing it after three months of
   reporting costs the credibility of the number.
2. **The gate second**, because it has an external trigger nobody controls. Erasure is
   graded untested end-to-end (`corporate.md:31`, `:471`), so the first firing of L-CW-2
   **will fail** — and knowing that now is worth far more than discovering it while an
   enterprise counterparty waits.
3. **Skeleton third.** Sections named, ladder structured, positions blank. Explicitly *not*
   a populated library: a clause becomes "reviewed" once counsel has seen it in a real
   agreement (CW-7), and an invented clause is one nobody will defend at 6pm against a
   counterparty's counsel.
4. **Then grow one agreement at a time.** Every executed agreement contributes its
   counsel-seen clauses in the quarterly promotion pass. This is slower than writing nine
   templates in a week, and it is the only version that produces a library people actually
   use.

### On `legal-doc-draft`, and why it is deliberately built late and small

This is the most demo-able skill in the org and the most dangerous one, for the same
reason: **fluent output is what a language model produces most reliably, and legal paper is
where fluent-but-wrong costs the most.** It is not on the critical path for this quarter.
It comes *after* the library has content, because a retrieval skill with nothing to
retrieve from can only generate — which is the failure, not the feature
([[commercial-workforce-agreements-premortem]] M4).

When it is built it is retrieval-shaped, it emits `[GAP]` rather than composing over holes,
and a run with zero `[GAP]` markers is treated as a defect. That is a worse demo and a
better tool, and it is written down here because the pressure to improve the demo will be
recurring and reasonable-sounding every time.

## Why now

- **Because the first twenty agreements are what these loops protect**, and loops built
  after agreement five have already missed what they exist to catch.
- **Because a DPA arrives without warning.** There is no preparation window. This team's
  most consequential gate is triggered entirely by somebody else's sales cycle.
- **Because the company is already operating on unwritten terms.**
  `apps/api-gateway/src/common/orchestrator/commercial-terms.ts:21-38` already parses
  supplier currency, MOQ, discount tiers and `payment_terms` (line 33) out of email with
  per-field provenance. The operating terms of supplier relationships are machine-read;
  none of them has ever been agreed in writing. That is not urgent and it will not announce
  itself when it becomes urgent.
- **Because metric definitions harden.** Every week without a fixed definition of
  "executable" is a week closer to inheriting one.

## Next steps

- [ ] Fix the definition of **"executable"** — CW-3 — and write it into
      [[commercial-workforce-agreements-charter]] before any measurement exists
- [ ] Wire the two-signature gate with [[regulatory-posture-charter]] and
      [[privacy-engineering-charter]] — L-CW-2. Run it once against the current system and
      **record the failure** as the baseline
- [ ] Name the clause-library sections; state the provenance rule (counsel-seen in a real
      agreement); leave the text blank
- [ ] Define the fallback-ladder structure and identify which sections are contentious
- [ ] Define what the redline log records, per agreement — L-CW-3
- [ ] Stand up the register states for these nine types with the department
- [ ] Stage **OD-C2** into `OPEN-DECISIONS.md` via [[decision-office-charter]] —
      deliberately not written directly; sibling division sessions are appending to that
      table concurrently (`corporate.md:486-490`)
- [ ] Route the stale brand in `apps/web/src/pages/Privacy.tsx:23` to Compliance §3.2 —
      **not ours to fix**, ours to notice and hand over
- [ ] Do **not** build `legal-doc-draft` this cycle. Record that as a decision with its
      reason, so it reads as a choice rather than an omission

## Questions for the founder

1. **Who sets the ladder rungs, and when?** [[commercial-workforce-agreements-directive]]
   CW-2 says founder + counsel, once per section. That is a real time commitment before any
   deal exists. The alternative — deciding each rung during the first negotiation that
   needs it — is how [[commercial-workforce-agreements-premortem]] M1 starts.
2. **OD-C2 — two signatures on DPA/BAA, or one team holding both?** Two is slower and
   catches M3. One is faster and cannot. The relevant fact for deciding: erasure is
   currently untested end-to-end, so the gate will fail on its first firing either way —
   the question is whether it fails in front of us or in front of a customer.
3. **Is "no `legal-doc-draft` this cycle" acceptable?** It is the most visible AI-native
   capability this department could ship, and this agenda deliberately defers it until the
   library has content. That is a real cost to the AI-native story and it is yours to
   overrule.
4. **What counts as a walk-away?** A ladder needs a bottom rung to be a ladder. If there is
   no deal the company would decline over a term, then CW-2 is a two-rung ladder and should
   say so honestly rather than carry a third rung nobody would ever stand on.
5. **Are the nine a readiness list or a build list?** Six of the nine presuppose parties
   that do not exist — no employees, no contractors, no enterprise customers. Preparing all
   nine now is a quarter of work against hypothetical counterparties. Preparing three (NDA,
   MSA, DPA) is a week. Which?
6. **Does this team survive the trim?** `corporate.md:116-121` names Legal the trim
   candidate. This team has the stronger claim of the two — its mandate is a system that
   gets exercised repeatedly — but it has produced nothing, and [[legal-loops]] L-LEG-5
   will ask in two quarters regardless.

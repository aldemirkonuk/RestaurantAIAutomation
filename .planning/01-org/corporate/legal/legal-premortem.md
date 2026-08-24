---
type: premortem
division: corporate
department: legal
status: provisional
metrics: [legal.instrument_chain_integrity, legal.clause_library_hit_rate, legal.counsel_gate_compliance, legal.annex_satisfiability_signoff, nf_a.doneability_verdict]
updated: 2026-08-24
links: ["[[legal-charter]]", "[[legal-loops]]", "[[legal-directive]]", "[[legal-schedule]]", "[[instruments-equity-premortem]]", "[[commercial-workforce-agreements-premortem]]", "[[regulatory-posture-charter]]", "[[positioning-fundraise-readiness-charter]]", "[[performance-doneability-charter]]", "[[red-team-charter]]", "[[decision-office-charter]]"]
---

# Legal — Premortem

> Written at founding, before success is assumed.

Legal is the only department in Corporate whose failures are mostly **invisible until
somebody else needs them to be true** — a diligence request, a redline, a breach notice.
That is why this premortem is longer than the department's evidence base. There is nothing
to inspect, so the only available discipline is naming the failure in advance.

## It is 2027-08. Legal has failed. What happened?

### M1 — The trim was right, and nobody noticed for a year

`corporate.md:116-121` said plainly that Legal was the trim candidate and that keeping two
teams was a **structural** argument, not an evidential one. We kept two. Then nothing
arrived: no raise, no employee, no enterprise counterparty demanding an MSA. Both team
agendas said the same thing — "waiting for the first instrument" — for four quarters. The
60-day staleness rule ([[ORG_STRUCTURE]] §4, foundation §3.3) should have marked them
fiction; instead they were quietly refreshed with new dates. Fourteen documents describing
a function that produced one PDF.

**Earliest observable signal.** [[instruments-equity-agenda-full]] and
[[commercial-workforce-agreements-agenda-full]] both untouched at the same 60-day sweep,
**or** touched only by a date bump with no content diff. The second is the more dangerous
signal because it looks like activity. A `git log --stat` on this directory showing
date-only changes is the tell.

**What would have prevented it.** A **merge trigger**, not only a split trigger. The org
is careful to name split triggers everywhere (`corporate.md:126`, `:398`, `:457`) and
never names a merge one — so structures only ever ratchet up. [[legal-loops]] L-LEG-5
fixes the reverse condition in advance: *if, at the second quarterly review, 1.1 has
issued zero instruments and 1.2 has fewer than five executed agreements, Legal runs as one
team and this charter is rewritten to say so.* Deciding the reversal now, while nobody is
invested in it, is the only time it can be decided cheaply.

---

### M2 — The first SAFE was treated as a form to fill in

There was no other legal work competing with it, so it did not feel like a decision — it
felt like paperwork on the raise checklist. It was signed under timeline pressure with no
dilution model, no comparison of the valuation-cap and discount interaction, and no view
of what a second instrument on top of it does. The term surfaced in the round that
followed, by which time it was a fact rather than a negotiation
(`corporate.md:84-87`).

**Earliest observable signal.** The first request into [[instruments-equity-charter]] that
arrives with a **counterparty-supplied document already attached** and a date on it. Not
the signature — the attachment. Second signal: any instrument request whose requested
turnaround is measured in hours.

**What would have prevented it.** Two hard rules in [[legal-directive]], set before the
first request rather than during it: **(a) no instrument in the 1.1 class is ever executed
the same day it is requested** — the floor is a named waiting period, and the floor exists
precisely for the day it is inconvenient; **(b) an executed 1.1 instrument requires a
dilution/consequence model in the file alongside it, so the chain is incomplete without
one.** `legal.instrument_chain_integrity` counts it as a chain break, which makes it a
number rather than a norm.

---

### M3 — Twenty agreements, no two alike, and nobody can answer "what do we owe our customers?"

Every counterparty's redline got accepted as a one-off, because there was no library to
defend and no pre-decided fallback position to defend it with. After twenty agreements,
liability, IP ownership and data terms said twenty different things. The question "what
have we actually promised?" became a twenty-PDF reading exercise, and the honest answer to
a customer's security questionnaire became unknowable (`corporate.md:111-114`).

**Earliest observable signal.** `legal.clause_library_hit_rate` falling — it is the
*leading* indicator, and it moves a quarter before turnaround does
(`corporate.md:107-110`). Concretely: the second agreement whose liability section was
written fresh rather than assembled. Two fresh writes of the same section is a pattern,
not a coincidence.

**What would have prevented it.** A written **fallback ladder** — preferred / acceptable /
walk-away positions per contentious section — decided once by the founder with counsel and
then *applied* rather than re-litigated. Plus a redline log that records, per agreement,
which clause moved and why. The counter-pressure is not "hold the line"; it is that
conceding is allowed, and **conceding without recording it is not**.

---

### M4 — We signed a DPA whose Annex the code could not satisfy

An enterprise counterparty sent their DPA. It was reviewed as a contract — clauses,
liability, indemnity — and executed. Nobody checked the Annex against the system: what we
actually delete, on what timeline, from which store, with what proof. The erasure path is
graded as untested end-to-end (`corporate.md:31`, `:471`), and GDPR/CCPA appear **zero
times** in source. The gap surfaced as a customer commitment we were already in breach of.

**Earliest observable signal.** The first DPA or BAA that reaches "out for signature"
**without** a Compliance signature on the Annex. There is no gradual version of this
signal — it is binary and it is visible in the instrument register.

**What would have prevented it.** The two-signature rule as a **gate in the register, not
a convention**: a DPA/BAA cannot advance past `in counsel review` until
[[regulatory-posture-charter]] has signed that each Annex commitment maps to an
implemented, tested behaviour — with [[privacy-engineering-charter]] naming the test.
Measured as `legal.annex_satisfiability_signoff`. This is a two-signature failure, not a
one-team failure (`corporate.md:99-103`), and a gate owned by one team would not have
caught it.

---

### M5 — The AI drafted it, it read like a contract, and nobody was named as having read it

[[foundation-README]] §3.2 names a `legal-doc-draft` skill. It got built. It produced
documents that *looked* correct — correct headings, confident recitals, familiar cadence —
because looking correct is exactly what a language model is good at. Turnaround collapsed,
`legal.request_to_executable_draft_days` looked excellent, and a document went out with no
named human reviewer. The first time it mattered, a clause meant something other than what
we thought it meant.

**Earliest observable signal.** The first instrument whose file has a model output in its
provenance and **no named reviewer field filled in**. Also: any week where turnaround
improves while `legal.clause_library_hit_rate` does *not* — that combination can only mean
text is being generated rather than assembled.

**What would have prevented it.** Three structural constraints, all in
[[legal-directive]]:

1. **[[instruments-equity-charter]] owns no generative drafting skill at all.** The
   one-way-door class is drafted by counsel, full stop. The team's skills are *checkers*.
2. **`legal-doc-draft` is retrieval-shaped, not generation-shaped** — it assembles reviewed
   clauses from the library and marks every gap it could not fill as an explicit `[GAP]`
   for a human, rather than writing prose over it. A skill that never emits `[GAP]` is
   broken, not excellent.
3. **`nf_a.doneability_verdict` on a legal draft is defined as "a named human reviewed it",
   never as "the agent completed".** Legal is the strictest doneability case in the
   company; [[performance-doneability-charter]] gets it as the hard test case rather than
   inventing an easier one.

And the constraint this vault applies to itself: **no document in
`01-org/corporate/legal/` contains template contract language.** These files charter a
function that will commission paper from a qualified lawyer. Prose that drifts toward
clause text is the earliest, cheapest version of exactly this failure — and it would be
visible right here, in this directory, before it ever reached a counterparty.

---

## Signal summary

| # | Mechanism | Earliest signal | Counter-pressure lives in |
|---|---|---|---|
| M1 | Two teams, no work, quiet staleness | Both agendas date-bumped with no content diff at the 60-day sweep | [[legal-loops]] L-LEG-5 — a **merge** trigger |
| M2 | First SAFE signed as a form | A request arriving with a counterparty document attached | [[legal-directive]] — no same-day execution; model-in-file required |
| M3 | Redline drift across twenty agreements | `legal.clause_library_hit_rate` falling; a section written fresh twice | [[commercial-workforce-agreements-loops]] — fallback ladder + redline log |
| M4 | DPA Annex the code cannot satisfy | A DPA at "out for signature" with no Compliance signature | Two-signature gate; `legal.annex_satisfiability_signoff` |
| M5 | Plausible AI draft, no named reviewer | Turnaround improving while hit-rate does not | [[legal-directive]] — retrieval-shaped skill, `[GAP]` markers, no drafting skill on 1.1 |

[[red-team-charter]] is invited to attack M1 first: it is the mechanism this department is
least motivated to find, because finding it costs the department half of itself.

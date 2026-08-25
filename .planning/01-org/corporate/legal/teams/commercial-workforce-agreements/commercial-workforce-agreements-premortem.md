---
type: premortem
division: corporate
department: legal
team: commercial-workforce-agreements
status: provisional
metrics: [legal.clause_library_hit_rate, legal.request_to_executable_draft_days, legal.annex_satisfiability_signoff, legal.named_reviewer_coverage, nf_a.doneability_verdict]
updated: 2026-08-24
links: ["[[commercial-workforce-agreements-charter]]", "[[commercial-workforce-agreements-loops]]", "[[commercial-workforce-agreements-directive]]", "[[legal-premortem]]", "[[legal-directive]]", "[[regulatory-posture-charter]]", "[[privacy-engineering-charter]]", "[[performance-doneability-charter]]", "[[red-team-charter]]"]
---

# Commercial & Workforce Agreements — Premortem

> Written at founding, before success is assumed.

Every failure here is a **drift** failure. None of them is a bad decision; each is the
accumulation of twenty locally reasonable ones. That is what makes them hard to see from
inside the team, and it is why four of the five signals below are metric shapes rather than
events.

## It is 2027-08. This team has failed. What happened?

### M1 — Twenty agreements, no two alike

The department's founding premortem line, expanded (`corporate.md:111-114`). Every
counterparty's redline was accepted as a one-off, because there was no library to defend
and no pre-decided position to defend it with. Each concession was small and each was
defensible on its own day. After twenty agreements, liability, IP ownership and data terms
said twenty different things, and the question *"what do we actually owe our customers?"*
became a twenty-PDF reading exercise. The first security questionnaire that asked it got an
answer nobody could stand behind.

**Earliest observable signal.** `legal.clause_library_hit_rate` falling — it is the leading
indicator and it moves roughly a quarter before turnaround does (`corporate.md:107-110`).
Concretely and earlier: **the second time the same section is written fresh.** Twice is a
pattern at this volume; waiting for a third is waiting a quarter.

**What would have prevented it.** The **fallback ladder** — preferred / acceptable /
walk-away per contentious section, decided once with the founder and counsel, then applied.
The counter-pressure is not "hold the line", because holding the line loses deals and
should. It is that **conceding is allowed and conceding without recording it is not**: the
redline log records which clause moved, to which rung, and why. A concession inside the
ladder is routine; a concession outside it escalates. That distinction is the whole
mechanism, and it cannot exist until the ladder does.

---

### M2 — Turnaround improved and the number was measured at the wrong point

`legal.request_to_executable_draft_days` looked excellent. It had been quietly defined as
*request → draft sent*, because that is the moment the team controls and the easiest one to
timestamp. Meanwhile drafts went out with unresolved gaps, counterparties came back with
questions the draft should have answered, and the real request-to-signature time got worse
while the reported metric got better. The team optimised the number and degraded the job.

**Earliest observable signal.** Any divergence between the reported median and the count of
**round trips per agreement**. One is falling, the other is rising. Sharper: the first
agreement that goes out with an unresolved `[GAP]` still in it and is counted as delivered.

**What would have prevented it.** Defining **"executable"** in the charter before the first
measurement, and defining it against a condition the team does *not* control:
*a named human reviewed it and no `[GAP]` remains.* A metric whose definition is settled
after the first reading is a metric that will be settled favourably.

---

### M3 — The DPA Annex the code could not satisfy

An enterprise counterparty sent their DPA. It was reviewed as a contract — clauses,
liability, indemnity — and executed. Nobody checked the **Annex** against the system: what
is actually deleted, on what timeline, from which store, with what proof. Erasure is graded
untested end-to-end (`corporate.md:31`, `:471`) and GDPR/CCPA appear zero times in source.
The gap surfaced as a customer commitment we were already in breach of on the day we made
it.

**Earliest observable signal.** The first DPA or BAA that reaches `out for signature`
**without** a Compliance signature on the Annex. Binary, and visible in the register — this
mechanism has no gradual version, which is the one merciful thing about it.

**What would have prevented it.** The two-signature rule as a **register gate rather than a
convention**: a DPA/BAA cannot advance past `in counsel review` until
[[regulatory-posture-charter]] has signed that each Annex commitment maps to implemented,
tested behaviour, with [[privacy-engineering-charter]] naming the test
(`corporate.md:99-103`). Wired **before** the first DPA arrives, because there is no
preparation window — the first one arrives as an email attachment on somebody else's
timeline.

---

### M4 — The skill wrote over the gaps, and it read beautifully

`legal-doc-draft` got built and it was good. It produced documents with correct headings,
confident structure, and familiar cadence — because producing exactly that is what a
language model is for. Where the clause library had nothing, it wrote something plausible
instead of stopping. Turnaround collapsed. Hit rate did not move, because there was no
library behind most of the output. A document went out whose reviewer field said "AI", and
the first time a clause mattered it meant something other than what we thought.

**Earliest observable signal.** The metric pair: **turnaround improving while
`legal.clause_library_hit_rate` does not**. That combination has no innocent explanation —
if drafts are faster and not more library-sourced, they are more generated. Second signal,
and the operational one: a `legal-doc-draft` run that emits **zero `[GAP]` markers**. A
library that happens to cover every section of a novel counterparty's paper is far less
likely than a model quietly filling the holes.

**What would have prevented it.** Three constraints in
[[commercial-workforce-agreements-directive]], all shape rather than caution:

1. **The skill is retrieval-shaped.** It assembles reviewed clauses and emits `[GAP]` where
   the library is empty. It is not permitted to compose prose over a gap. A run with zero
   `[GAP]` markers is treated as a defect until proven otherwise.
2. **`nf_a.doneability_verdict` on a legal draft means "a named human reviewed it"**, never
   "the agent completed". Legal is the strictest doneability case in the company, and
   [[performance-doneability-charter]] should get it as the hard test rather than an easier
   one.
3. **`legal.named_reviewer_coverage` targets 100% permanently.** No executed agreement has
   an empty reviewer field, and "AI" is not a name.

---

### M5 — The library became a museum

The library got built, early and enthusiastically — eleven sections, carefully organised,
before there was a single executed agreement to derive them from. Then reality diverged
from it. Counterparties wanted things the library had not anticipated; the clauses had
never been tested in a negotiation, so nobody trusted them under pressure; and the drafters
went around it. Hit rate stayed low, and the honest reason was not that the library was
missing — it was that the library was *invented*, and an invented clause is one nobody will
defend at 6pm against a counterparty's counsel.

**Earliest observable signal.** Library sections that have **never been cited** in any
draft, six months after being written. Also: the library growing faster than the count of
executed agreements — a healthy library grows *from* executed paper, so growth outpacing
executions means it is growing from imagination.

**What would have prevented it.** Growing the library **from executed agreements, one at a
time**, rather than inventing it up front. A clause becomes "reviewed" once counsel has seen
it in a real agreement. The v0 artifact is a **skeleton** — sections named, ladder
structured, positions blank — which is enough to make the second agreement cheaper than the
first without pretending to knowledge nobody has yet. And the 30-day unfired-skill rule
applied to clauses too: a section never cited in six months is reviewed for deletion, the
same anti-sprawl logic the org applies everywhere else.

---

## Signal summary

| # | Mechanism | Earliest signal | Counter-pressure |
|---|---|---|---|
| M1 | Twenty agreements, no two alike | Hit rate falling; same section written fresh twice | Fallback ladder + redline log. Conceding is allowed; conceding unrecorded is not |
| M2 | Turnaround measured at the wrong point | Reported median falling while round-trips rise | "Executable" defined **before** the first reading, against a condition the team does not control |
| M3 | Unsatisfiable DPA Annex | A DPA at `out for signature` with no Compliance signature | Two-signature **register gate**, wired before the first DPA arrives |
| M4 | The skill wrote over the gaps | Turnaround improving while hit rate does not; a run with zero `[GAP]` markers | Retrieval-shaped skill; doneability = named human reviewer; 100% reviewer coverage |
| M5 | The library became a museum | Sections never cited at six months; library outgrowing executions | Grow from executed paper; skeleton at v0; delete uncited sections |

**What [[red-team-charter]] should attack first:** M4, and specifically the metric pair. It
is the only mechanism here that makes the team's headline number look *better* while the
work gets worse, which means the team has no internal incentive to find it.

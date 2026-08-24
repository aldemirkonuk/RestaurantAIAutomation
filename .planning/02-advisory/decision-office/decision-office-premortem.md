---
type: premortem
division: advisory
department: decision-office
status: new
metrics: [decisions.open_count, decisions.median_age_days, decisions.close_rate_per_week, decisions.unowned_count, decisions.decided_here_count, triggers.dated_unwatched_count, triggers.fired_but_unactioned_count]
updated: 2026-08-24
links: ["[[decision-office-charter]]", "[[decision-office-directive]]", "[[decision-office-loops]]", "[[decision-office-schedule]]", "[[decision-office-agenda-full]]", "[[ORG_STRUCTURE]]", "[[OPEN-DECISIONS]]", "[[0002-documentation-first-operating-mode]]", "[[red-team-charter]]", "[[architecture-review-charter]]", "[[standards-verification-charter]]", "[[knowledge-documentation-charter]]", "[[skills-charter]]", "[[sales-charter]]", "[[legal-charter]]"]
---

# Decision Office — Premortem

> Written at founding, before success is assumed. Artifact #2 by design
> ([[ORG_STRUCTURE]] §4).

The three failures this office is most likely to suffer are **mutually exclusive in
appearance and identical in outcome**: M1 makes decisions slower, M2 makes them
invisible, M3 makes them illegitimate — and each ends with decisions not closing,
which is the one thing this function was created to prevent. Overcorrecting from
any one of them lands directly in another. That tension is the real subject of this
document.

---

## It is 2027-08-24 and the Decision Office has failed. What happened?

### M1 — It became a tollbooth *(most likely)*

Nothing dramatic. The office got good at its job. Intake acquired a required
format, then a required severity, then a required impact note, then a required
"which unit have you already asked." Each addition was individually justified by a
real bad intake. Within two quarters, filing a fork cost more than the fork was
worth, so units stopped filing — and started deciding quietly in their own agendas
instead.

The register stayed clean. It stayed clean because it stopped receiving the
messy, half-formed, genuinely undecided things, which are exactly the items ADR
0002's non-negotiable #1 was written to capture. The office optimised the
instrument and lost the signal.

This is the likeliest failure because it is the failure that **feels like
competence the entire time it is happening**, and because the corpus already
rewards ceremony: [[0002-documentation-first-operating-mode]] §Consequences
accepted *"slightly more ceremony per decision"* as the price. There is no written
ceiling on how much more.

**Earliest observable signal.** Not queue length — queue length *falls* in this
failure, which is why it reads as a win. The signal is
**`decisions.intake_rate` dropping while the corpus keeps growing**: new unit
documents landing that contain the phrase *"we propose"* or *"open seam"* without a
matching register row. Concretely, the first month where `01-org/` gains documents
and `OPEN-DECISIONS.md` gains **zero** rows. A second, cheaper signal: any intake
returned to a unit for reformatting rather than accepted and triaged by us.

**Counter-pressure.** **Intake is never rejected.** Written into
[[decision-office-directive]] as a hard rule with no exception branch: a fork
arrives in whatever shape it arrives, including one sentence in a Slack-grade
fragment, and **the office does the normalising**. If a fork lacks context, the
office adds the context — it never bounces the item. Enforced by two things:
`decisions.intake_returned_count` is a tracked metric whose target is **0**, not
"low"; and [[decision-office-loops]] L1 reports `intake_rate` beside
`open_count`, so a falling queue can never be read as success on its own. The
asymmetry is deliberate and mirrors the one in [[skills-charter]]'s directive: a
badly-filed fork costs us ten minutes of tidying; an unfiled fork costs a silent
decision, permanently.

---

### M2 — It became a list nobody reads *(second most likely, and already in progress)*

The register grew. It reached 40 rows, then 60. Each row was individually correct.
No row had an owner, so no row was anyone's Monday morning. No row had an age, so
no row was ever *late* — only "still open," which is a state with no gradient and
therefore no pressure. The weekly triage happened, produced a digest, and the
digest was skimmed. Rows resolved at whatever rate the founder happened to touch
them, which was fine for the top three and zero for everything below.

Eventually the register described the org's indecision rather than reducing it, and
became one more document in a 693-document corpus that
[[knowledge-documentation-charter]] was separately trying to shrink.

**Earliest observable signal.** This one does not need waiting for — it is
**already true today** and that is the finding, not a forecast:

- `decisions.unowned_count` = **23 of 23**.
- `decisions.median_age_days` = **undefined**, because no row carries a filed date.
- The 12 resolved rows are all dated 2026-08-24 — a single burst, not a rate.
- ADR 0002 named the tripwire (*"grows faster than it drains for a sustained
  period"*) and it has **never been computed**.

The forward-looking signal is the first weekly triage that closes **zero** rows
while opening more than two — and specifically, the second consecutive one. One is
noise; two is a drain rate below the fill rate, which is ADR 0002's own revisit
condition arriving.

**Counter-pressure.** Three structural changes, none of which require permission
because none of them decides anything:

1. **Every row gets an owner and a filed date, retroactively, in the first triage.**
   Owner means "the unit that must produce what unblocks it" — not the decider,
   who is always the founder. An owner-less row is a row nobody is embarrassed by.
2. **Age is reported, not just stored.** [[decision-office-loops]] L1 has a
   `close_time: weekly` and reports `median_age_days` and `oldest_age_days`
   *every* week including weeks where nothing changed. A number that only appears
   when it moves cannot embarrass anyone.
3. **Digest ranks by age × severity, and names the single oldest item first**,
   every week, until it closes. Repetition is the mechanism. A register that
   re-states its oldest item weekly is harder to ignore than one that lists 23
   items in filing order.

---

### M3 — It quietly accrued decision authority it was explicitly not given

The office was handed a real backlog on day one — a fork-numbering collision that
is genuinely *mechanical*, and whose fix nobody would object to. OD-30 in the
register even says so: *"Decision Office's first assignment; mechanical to fix."*
So the office renumbered. Then it resolved a contradiction where one side was
obviously right (the Seating Density widget demonstrably exists, so `:49` is simply
wrong). Then it assigned an owner to OD-25 because two documents named different
owners and *someone* had to break the tie. Then, when a unit asked whether its
2026-11-24 trigger had fired, it said yes.

Every step was defensible. Cumulatively, the office that exists to enforce
*"nothing is decided until it is decided together"* had decided perhaps a dozen
things, none of them recorded as an ADR — because they did not feel like decisions.
Non-negotiable #1 was hollowed out from inside by the office built to defend it.

The pressure is not ego. It is **helpfulness under a backlog**, and the corpus is
already applying it: 222 documents reference this function, 329 wikilinks point at
it, 168 loop blocks route their escalations here, and several units have written
sentences like *"[[decision-office-charter]] owns whether OD-C5 closes or drifts"*
(`people-agent-ops-directive.md:120`, `performance-doneability-premortem.md:185`).
Owning *whether it closes* is one preposition away from owning *how it closes*.
[[standards-verification-charter]]'s OD-C6 proposal — that it be reparented under
this office — is the same pressure wearing a reasonable argument.

**Earliest observable signal.** The literal one: **`decisions.decided_here_count`
> 0**. It is tracked from day one with a target of exactly zero, and it counts any
outcome that changed what a document means without a founder call or an existing
locked rule to point at.

Before that, a softer and earlier signal: **the office writing the word "should" in
a finding**. A finding says *"A and B disagree; X owns the answer; this has been
open N days."* The moment it says *"B should win"*, authority has moved. That is
greppable and it is checked in the quarterly self-audit.

Earliest of all: **the office accepting an execution team, a headcount, or a
deliverable that is not a finding.** OD-C6 is the live instance and
[[decision-office-charter]] declines it in writing *before* the pressure is real,
on purpose.

**Counter-pressure.** One bright line, stated in
[[decision-office-directive]] §Decision rights and testable by anyone:

> **The office may assign an unused identifier to an unregistered fork. It may
> never reassign an identifier already cited elsewhere in the corpus.**

Minting `OD-32` for an unfiled fork changes nothing about what any document means —
that is bookkeeping. Re-pointing `OD-23` changes what **83 existing citations
mean** — that is a decision about other units' documents, made without them. The
line is not a matter of degree; it is a yes/no test on "does any existing document
cite this ID," and it is why the fork reconciliation ships as a **proposal to the
founder**, not as an edit.

Second counter-pressure: **[[red-team-charter]] audits this office quarterly.**
[[ORG_STRUCTURE]] §3 scopes Red Team to *"decisions, everywhere"* — a decision made
by the Decision Office is squarely in scope, and an office that audits its own
authority creep is the arrangement [[ORG_STRUCTURE]] §3 exists to reject. This is
[[decision-office-loops]] L6, and its findings go to the founder, not back here.

---

### M4 — Reconciliation theatre: the numbering became the work

The fork registry got reconciled. Then a naming convention was written, then a
style guide for fork descriptions, then a migration plan for the 64 `DEP-06`
references, then a linter. Twelve months of genuine, well-executed metadata work.

Meanwhile `decisions.close_rate_per_week` never moved, because **numbering was
never the reason decisions were not closing**. OD-03 (orchestration base) is
referenced 146 times and blocked on a bake-off nobody scheduled. OD-11 is
referenced 142 times and blocked on a schema session nobody booked. Neither is
waiting on an identifier. The office picked the tractable problem over the real
one, and the tractable problem happened to be infinitely divisible.

**Earliest observable signal.** The ratio: **weeks spent on registry mechanics vs.
rows closed**. Specifically, the first month in which the office ships a metadata
improvement and closes zero rows. And the sharper version — **OD-03 and OD-11
ageing past 90 days while the fork registry is described as "in progress."** Both
are already the most-cited open items in the corpus (146 and 142 references) and
both are blocked on a *session being scheduled*, which is the cheapest possible
unblock.

**Counter-pressure.** The reconciliation is **time-boxed to one pass and shipped as
a single proposal**, not run as a programme; it appears in
[[decision-office-schedule]] as a **one-off**, never as a cadence. And the weekly
digest leads with the **oldest item**, not the most tractable — so OD-03's and
OD-11's age is the first number the founder sees every week, and metadata work can
never occupy the top line. If the reconciliation is not in front of the founder
within two close-times, it is abandoned rather than extended: an unreconciled
namespace with a documented collision table is strictly better than a reconciled
namespace that consumed the function.

---

### M5 — It confused escalating with closing

The dated triggers fired. On 2026-11-24 the office correctly reported that
[[skills-charter]] held fewer than 5 committed firing skills, that
[[sales-charter]]'s `DEP-06` was still unchecked with `$0` recovered, and that
[[legal-charter]]'s merge condition had come due. Four escalations, all accurate,
all on time, all filed.

Nothing happened. The founder was mid-sprint. The escalations sat, and because they
had been *escalated*, the office recorded them as handled — its own metric was
`triggers.dated_unwatched_count`, which the reports drove to zero. Skills kept its
28 documents. Sales kept its 21. The ratchet the triggers existed to reverse
ratcheted anyway, and OD-26 stayed open forever with the office able to demonstrate
it had done its job.

This is the subtlest failure because the office's stated verbs — *track, surface,
escalate* — genuinely stop at escalation. Findings-only authority makes "I reported
it" a complete defence. It is a complete defence for the **authority** question and
not for the **purpose** question, and conflating the two is how a function stays
technically correct while its reason for existing quietly fails.

**Earliest observable signal.** **`triggers.fired_but_unactioned_count` > 0 for two
consecutive close-times.** The metric must exist *separately* from
`triggers.dated_unwatched_count` — one counts triggers with no watcher, the other
counts watched triggers whose firing produced no outcome. Collapsing them into one
number is the mechanism of this failure, so they are two rows in
[[decision-office-loops]] L2 and always reported together.

Same shape one level down: a finding delivered to a unit that produces no change in
that unit's documents within two of **that unit's own** close-times.

**Counter-pressure.** **Escalation has a close-time too.** [[decision-office-loops]]
L2 does not close when the escalation is sent; it closes when the escalated item
reaches a terminal state — actioned, explicitly deferred with a new date, or
withdrawn. "Deferred" is an acceptable outcome and a **recorded** one; silence is
not an outcome. An escalation with no response after two close-times is re-raised
with its age attached and, on the third, is raised to [[red-team-charter]] as well
as the founder — the same double-reporting rule [[skills-charter]]'s directive uses
for its own core failure mode, and for the same reason: a function reporting only
to the person who is not responding is not reporting.

---

## Summary

| # | Mechanism | Earliest signal | Counter-pressure | Live today? |
|---|---|---|---|---|
| M1 | Tollbooth | `intake_rate` falls while corpus grows; any intake returned for reformatting | Intake never rejected; `intake_returned_count` target **0**; report intake beside queue length | No — risk begins at first triage |
| M2 | Passive list | `unowned_count` = 23/23; `median_age_days` undefined; two consecutive zero-close triages | Owner + filed date on every row; age reported weekly regardless of movement; digest leads with oldest | **Yes — already true** |
| M3 | Authority creep | `decided_here_count` > 0; the word *"should"* in a finding; accepting a team (OD-C6) | May mint unused IDs, may never reassign a cited one; OD-C6 declined in writing; quarterly Red Team audit | **Yes — OD-C6 and OD-30 are live pressure** |
| M4 | Reconciliation theatre | A month with metadata shipped and zero rows closed; OD-03/OD-11 past 90 days | Reconciliation is a one-off, time-boxed to two close-times; digest leads with oldest, never with mechanics | Latent — begins with assignment #1 |
| M5 | Escalating ≠ closing | `fired_but_unactioned_count` > 0 for two close-times | Escalation carries its own close-time; terminal state required; third re-raise goes to Red Team too | Latent — first test 2026-11-24 |

**The one that would end the function:** M3. M1, M2, and M4 make it ineffective and
are recoverable by changing a cadence. M3 makes it **illegitimate** — an office
that has decided things cannot credibly tell any unit that nothing is decided until
it is decided together, and the corpus has 329 links pointing at it when it says so.

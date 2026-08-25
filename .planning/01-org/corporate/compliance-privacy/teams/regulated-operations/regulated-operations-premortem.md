---
type: premortem
division: corporate
department: compliance-privacy
team: regulated-operations
status: new
metrics: [regops.trigger_check_freshness, regops.jurisdiction_count, regops.deadline_miss_count, regops.excise_reconciliation_variance]
updated: 2026-08-24
links: ["[[regulated-operations-charter]]", "[[regulated-operations-loops]]", "[[regulated-operations-directive]]", "[[compliance-privacy-premortem]]", "[[compliance-privacy-schedule]]", "[[regulatory-posture-charter]]", "[[inventory-ledger-charter]]", "[[agent-fleet-charter]]", "[[commercial-workforce-agreements-charter]]", "[[decision-office-charter]]", "[[red-team-charter]]"]
---

# Regulated Operations — Premortem

> Written at founding, before success is assumed — and for a team that does not yet
> exist, which changes what "failure" means. **M1 is failure of the gate.** M2–M5 are
> failures after activation, written now because a team activated under deadline
> pressure will not have time to write them.

## It is 2027-08-24 and this team has failed. What happened?

---

### M1 — The trigger fired and nobody noticed, because a dormant team has no cadence

The founding premortem, and by a wide margin the most likely. In March a sales
conversation with a small group in a licensed jurisdiction closed; in May an MSA was
signed containing a routine-looking clause about supporting the customer's excise
reporting. Neither event produced a moment where anyone asked *"has the Regulated
Operations trigger fired?"* — because asking that question was not on anyone's
calendar, and a charter with a trigger and no cadence is a note, not a gate. Eight
months later the customer's accountant asked for the movement records the MSA
obliged us to produce. That was the first time the team's scope was discussed by
anyone, and it was discussed as an incident.

**The mechanism is structural, not human.** Every other team in this org is
discovered by its work; a dormant team can only be discovered by a scheduled question.
Remove the question and the gate has no sensor.

**Earliest observable signal.** `regops.trigger_check_freshness` exceeds one quarter.
It is **currently unbounded — the trigger has never been checked** — so the signal is
already at its worst possible value on the day this charter is written. That is not
rhetorical: a dormant team's first failure state is its default state.

**What would have prevented it.** Three counter-pressures, and the first is
sufficient on its own:

1. **One quarterly five-minute check, with a named owner, on
   [[compliance-privacy-schedule]].** *Has a customer in a licensed jurisdiction
   signed? Does any signed MSA mention excise?* Two questions, answerable from the
   deal pipeline. This single job is the entire counter-pressure and is the reason a
   team with no staff still gets a `schedule.md`.
2. **The trigger is checked at the *other* team's cadence too.**
   [[regulatory-posture-charter]]'s per-instrument sign-off (L4) already reads every
   MSA clause by clause before execution. Adding *"does this mention excise,
   licensing, or alcohol movement?"* to that checklist costs one line and puts the
   sensor where the event actually happens, rather than in a quarterly review that
   sees it months late.
3. **Both trigger conditions are events with a date and a document**, never
   judgement calls. A trigger requiring interpretation is a trigger that never fires,
   because interpretation under deal pressure always resolves toward "not yet."

---

### M2 — It was activated under deadline, and became a filing function with no design

The trigger fired the way triggers do: a signed contract with a date. The team was
stood up in a week to answer a question that was already late. It built the fastest
possible thing — a spreadsheet of deadlines, a manual monthly export, a person
remembering. It worked, so it was never replaced, and eighteen months later the
company's excise position depended on one recurring calendar invite and an
undocumented query. The team never got a design phase because it was born inside an
emergency, and emergencies do not end, they just get renewed.

**Earliest observable signal.** The **first filing produced by a manual step that is
not in a runbook.** Visible in the first filing itself, which is the only cheap moment
to see it — after two, the manual step is the process.

**What would have prevented it.** **This charter set, written now, while nobody is
under pressure.** That is the actual argument for writing seven artifacts for an
unstaffed team, and it should be stated plainly rather than assumed: the deliverable
of a dormant team is *a design that exists before the emergency*. Concretely, the
team activates with its loops, its directive, and its non-goals already decided —
especially the [[inventory-ledger-charter]] boundary in M3, which is exactly the
decision an emergency would get wrong.

Second counter-pressure: **an activation checklist with a 30-day design gate.** The
first month after activation produces a runbook and a data source decision, not a
filing. If a filing is genuinely due inside 30 days, that is an escalation to the
founder about a commitment that was made without this team, not a reason to skip the
gate.

---

### M3 — We computed our own movement numbers, and the tax authority had two answers to choose from

Excise reporting needs volumes moved, by product, by period, by jurisdiction. The
inventory ledger has that data, in the ledger's own shape, with the ledger's own
definitions of a movement, a correction, and a reversal. Reconciling to it was
fiddly — the periods did not line up, a reversal was represented differently, the
ledger's notion of "received" included a state excise does not recognise. So the team
wrote its own query. It was defensible, it was documented, and it produced numbers
that differed from the ledger's by a small percentage which grew. When the two were
finally compared, there was no way to say which was wrong, and a regulator does not
accept "our two systems disagree" as an answer.

**Earliest observable signal.** The **first excise figure computed from anything
other than the ledger's own published aggregate.** Visible in the query's source on
day one. Quantitative backstop: `regops.excise_reconciliation_variance` exists as a
metric precisely so that a non-zero value is a finding rather than a rounding note —
and its target is **exactly zero**, not "small".

**What would have prevented it.** **A hard non-goal, already written into this
charter: inventory truth belongs to [[inventory-ledger-charter]].** Excise reporting
*consumes* the ledger; it never recomputes it. If the ledger's shape does not serve
excise, the fix is a published aggregate *in the ledger*, owned by that team, not a
second source of truth in this one. This is the same argument
[[corporate]] §8 makes about NF-A — *"Same data, opposite direction. If both own the
metric definition it will be defined twice."*

---

### M4 — The three-tier control drifted, because it had been running unowned for two years

`constraint_engine.py:38-41` blocks phrases like *"direct-from-winery"* in outbound
drafts under C-19. It has been running since before this team existed and nobody owns
it. Over two years the outbound drafting moved to a different model, the phrasing it
produced changed, and the pattern list — never updated, never reviewed, matched
against a vocabulary that no longer occurred — silently stopped catching anything. It
still passed. It caught zero violations for eighteen months and that was read as
compliance rather than as a dead control.

This is the same failure shape the codebase already names elsewhere: an event-consuming
no-op *"reads identically to a working one from every dashboard and health check"*
(`compliance_agent.py:11-15`). A pattern-matching control with nothing left to match
has exactly that property.

**Earliest observable signal.** **C-19 trigger count over a quarter equal to zero
while outbound draft volume is non-zero.** That is a query against the constraint
engine's own results, and the ratio is meaningful long before anyone reads the
patterns. A control with a zero hit rate is either perfect or dead, and the two look
identical.

**What would have prevented it.** **Give the control an owner before the team
activates.** Until activation it belongs in [[regulatory-posture-charter]]'s register
as *"an operating control with no owner"* — an entry which is uncomfortable and
correct, and which makes the drift someone's problem in the interim. On activation it
moves here, with a live-fire test: a fixture of phrasings the control must catch,
asserted in CI, in the shape of the PII specimen corpus
[[privacy-engineering-charter]] needs for the same reason.

---

### M5 — The gate held forever, and a stub agent sat in the fleet for three years

The opposite failure, and worth writing because a premortem that only imagines
over-reach is half a premortem. The trigger never fired: no licensed jurisdiction, no
excise clause, the product went a different direction. `compliance_agent.py` stayed in
`agents/`, correctly declared `IS_STUB = True`, correctly refused at boot, and
correctly did nothing — for three years. Seven charter documents described a function
nobody staffed. Every new engineer read the stub, asked what compliance events were,
and got a five-minute answer. The cost was never large enough to act on in any single
quarter, which is exactly why it accumulated.

**Earliest observable signal.** **2027-08-24** — one year from founding: the trigger
has not fired, `regops.jurisdiction_count` is still 0, and this directory still holds
7 documents. That is a date and a count, not a judgement.

**What would have prevented it.** **A sunset trigger, written at founding, in the
same shape as the entry trigger.** If neither entry condition has fired by
2027-08-24, the correct action is to *retire the track*: delete these seven documents,
delete `compliance_agent.py`, and record in `OPEN-DECISIONS.md` that the scope
returns to [[regulatory-posture-charter]] as a note. Written here, in advance, so
retiring it is a pre-agreed outcome rather than an admission — and so
[[red-team-charter]] has a date and a number to hold the department to rather than a
judgement call.

**Note the asymmetry with the entry trigger**, which is deliberate: entry is an
*event* (a signature), exit is a *date*. An exit condition phrased as an event
("when we are sure it will never be needed") never occurs.

---

## Signal summary

| # | Mechanism | Earliest signal | Where it is visible | State today |
|---|---|---|---|---|
| M1 | Trigger fires unnoticed | `trigger_check_freshness` > 1 quarter | [[compliance-privacy-schedule]] | 🔴 **unbounded — never checked** |
| M2 | Activated under deadline, no design | First filing with an off-runbook manual step | The filing itself | n/a — dormant |
| M3 | Two sources of movement truth | First excise figure not from the ledger's aggregate | The query source | n/a — dormant |
| M4 | Three-tier control drifted | C-19 trigger count == 0 with non-zero draft volume | Constraint-engine results | ⚠️ **running, unowned, unmeasured** |
| M5 | Gate held forever, inventory accumulated | 2027-08-24: trigger unfired, 7 docs, 1 stub | Directory census + trigger log | Countable from today |

**Two of the five are live right now for a team that does not exist.** M1 is at its
worst possible value on day one, and M4 describes a control that is executing on
production traffic today with no owner. Those two are the argument for this charter
existing at all; the rest is a design waiting for a date.

---
type: premortem
division: corporate
department: legal
team: instruments-equity
status: provisional
metrics: [legal.instrument_chain_integrity, legal.counsel_gate_compliance, legal.consent_record_completeness, legal.cap_table_tie_out_divergence]
updated: 2026-08-24
links: ["[[instruments-equity-charter]]", "[[instruments-equity-loops]]", "[[instruments-equity-directive]]", "[[legal-premortem]]", "[[legal-directive]]", "[[commercial-workforce-agreements-charter]]", "[[positioning-fundraise-readiness-charter]]", "[[red-team-charter]]"]
---

# Instruments & Equity — Premortem

> Written at founding, before success is assumed.

Every failure below shares one property: **it is discovered by somebody else, later, and
cannot be fixed when it is found.** That is the definition of the class this team owns, and
it is why the premortem matters more here than the charter does.

## It is 2027-08. This team has failed. What happened?

### M1 — The first SAFE was a form, not a decision

The department's founding premortem line, expanded (`corporate.md:84-87`). There was no
other legal work competing with it, so the SAFE felt like an item on a raise checklist
rather than a permanent alteration of who owns the company. It arrived from the investor
as a "standard" document. It was signed under timeline pressure. Nobody modelled what the
valuation cap and the discount do together, what a second instrument stacked on top does,
or what the conversion looks like at three different priced-round sizes. The term surfaced
in the round that followed — by which point it was a fact, not a negotiation.

**Earliest observable signal.** The first request that arrives with a **counterparty
document already attached and a date on it**. Not the signature — the attachment. The
second signal is a requested turnaround measured in hours; this team has no legitimate
hour-scale work, so an hour-scale request is always a sign that the decision has already
been made somewhere else.

**What would have prevented it.** Two rules already written into
[[instruments-equity-directive]] and adopted *while the register is empty*: **no same-day
execution**, and **no execution without a consequence model in the file**. The second is
the load-bearing one — `legal.instrument_chain_integrity` counts a missing model as a
broken chain, which converts "we should model this" from a good intention into a failed
check. A rule adopted before the pressure exists is the only kind that survives it.

---

### M2 — The IP assignment never happened, because there was only ever one author

The code was written by the founder, and there was never a moment where it felt like the
company did not own it — it was the same person either way. [ADR 0001](../../../../decisions/0001-mudavym-single-entity.md):38
fixed one legal surface; nothing ever recorded that the surface owned what had been built.
The gap was invisible for two years because nobody outside the company had reason to look,
and then a diligence checklist looked.

**Earliest observable signal.** There is no gradual signal — that is the whole danger. The
only observable is a **register with no IP-assignment row**, which is exactly the state
today. This mechanism is unique in this premortem in that its earliest signal is already
visible, right now, and has been the entire time.

**What would have prevented it.** Putting founder agreement and IP assignment in front of
counsel **first**, ahead of any fundraising instrument
([[instruments-equity-agenda-full]]). Not because they are urgent — they are not — but
because they are the only two instruments whose absence produces no symptom at all until
an outsider audits. Every other failure in this document announces itself eventually.

---

### M3 — The cap table lived in a spreadsheet, and the spreadsheet won

An instrument was executed. The spreadsheet was updated from memory a week later, or from
the term sheet rather than the executed document, or not at all. Six instruments in, the
spreadsheet and the paper disagreed about something small — a date, a share count, a
vesting start. The spreadsheet was the thing everybody looked at, so the spreadsheet became
the truth, and the paper became a set of files nobody re-read until diligence re-read them.

**Earliest observable signal.** The first quarterly tie-out that finds any divergence at
all — `legal.cap_table_tie_out_divergence > 0`. One divergent row is the signal; the org
does not get to wait for a pattern, because at this volume the pattern *is* one row.
Sharper still: the first time the cap table is updated from a term sheet, an email, or a
conversation rather than from the executed original.

**What would have prevented it.** Making the chain check a **state transition, not a
review** ([[instruments-equity-loops]] L-IE-1): an instrument cannot be marked `executed`
until its cap-table entry exists and matches. That ordering means the spreadsheet is always
derived from the paper and never the reverse. Plus the quarterly re-read of every executed
instrument against its downstream record — every instrument, not a sample, because at this
volume a sample is a rounding error and at higher volume the un-sampled one is the one
that is wrong.

---

### M4 — Advisors were promised equity in conversation, and the paper chased the promise

"We'll sort the paperwork" happened three times before any advisor agreement existed. By
the time the first one was drafted there were three people with different recollections of
what they had been offered, no board consent authorising any of it, and a founder who could
not issue what had been promised without a term that had never been discussed. The
cheapest-feeling instrument in the six produced the most expensive conversation.

**Earliest observable signal.** The first advisor engaged with **no instrument request
opened on the same day**. Not "no instrument signed" — no *request*. The gap between
handshake and request is where this failure lives, and it is measurable from day one.

**What would have prevented it.** A rule with no exceptions and no cost:
**every advisor engagement opens an instrument request immediately, before any promise is
made.** The request may sit in `requested` for weeks — that is fine, and the register is
designed to hold it. What is not fine is the promise existing outside the register, because
the register is the only thing that can tell the founder what has already been committed.

---

### M5 — Board consents were written afterwards to paper over decisions already taken

Decisions got made — an issuance, an option grant, a change of terms — and the consent was
drafted later to match. Each individual instance was reasonable and administrative. The
aggregate is a governance record that describes a company that decided things in an order
it did not decide them in. Read at diligence, the consent record is not a record; it is a
reconstruction.

**Earliest observable signal.** The first consent whose date is **later than the action it
authorises**. This is why `legal.consent_record_completeness` is defined on the *ordering*
property rather than the presence one — a consent record that is 100% present and 60%
retroactive scores 100% under the naive definition, and that naive definition is how this
failure stays invisible.

**What would have prevented it.** Defining the metric on ordering from the start, and
making the register refuse a consent dated after its action rather than accepting it with a
note. Also the department rule that consent precedes action rather than documenting it
([[instruments-equity-directive]]).

---

## Signal summary

| # | Mechanism | Earliest signal | Counter-pressure |
|---|---|---|---|
| M1 | First SAFE signed as a form | Request arrives with counterparty doc attached; hour-scale turnaround asked | No same-day execution; consequence model required in the chain |
| M2 | IP assignment never happens | **Already visible: no IP-assignment row in the register** | Founder agreement + IP assignment to counsel first, ahead of any raise instrument |
| M3 | Spreadsheet beats the paper | First divergent tie-out row; cap table updated from a term sheet | Chain check as a state transition; quarterly re-read of *every* instrument |
| M4 | Advisor promises outrun the paper | An advisor engaged with no request opened that day | Engagement opens a request immediately; the request may wait, the promise may not |
| M5 | Retroactive consents | A consent dated after its action | Metric defined on **ordering**; register refuses back-dated consents |

**What [[red-team-charter]] should attack first:** M2. It is the only mechanism whose
earliest signal is already present today, and the only one this team is structurally
unlikely to raise on its own — because the person who would have to assign the IP is the
person who would have to ask for it.

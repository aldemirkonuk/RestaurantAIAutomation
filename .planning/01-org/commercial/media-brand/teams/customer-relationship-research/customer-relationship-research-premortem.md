---
type: premortem
division: commercial
department: media-brand
team: customer-relationship-research
status: provisional
metrics: []
updated: 2026-08-24
links:
  - "[[customer-relationship-research-charter]]"
  - "[[media-brand-premortem]]"
  - "[[compliance-privacy-charter|compliance-charter]]"
---

# Customer Relationship Research (M4) — Premortem

> Written at founding, before success is assumed.
>
> This team's failure is not a weak quarter. It is a privacy incident, at a company with one
> customer, in a product that handles identified guests. Every mechanism below ends
> somewhere it cannot be undone.

## It is 12 months from now and this unit has failed. What happened?

Five mechanisms, most likely first.

---

### 1. The approval register never existed, and "explicitly approved" was remembered instead of recorded

The founder said a customer had agreed. The research happened. Nobody could later say what
the customer had been told, on what date, or whether the approval covered this particular
review — because the approval lived in a conversation rather than a record.

This is the most likely failure by a wide margin, because it requires nobody to do anything
wrong. It only requires the register to stay unbuilt while the research feels obviously
fine.

**Earliest observable signal.** The first finding that cannot name where its subject's
approval is recorded. Today that signal fires immediately: **no register exists.** The
shipped consent columns at
`supabase/migrations/20260819000000_guest_identity_minimal_slice.sql:58-64` are for guests
and for `service_personalisation`.

**What would have prevented it.** The gate in [[customer-relationship-research-charter]] is
stated as a terminal answer, not a warning: no register means no research. And the schema
this repo already wrote for guests contains the argument in its own comment at `:55-57` —
*"A boolean cannot answer 'what was this person told, on what date, and can we prove it'."*
The customer register needs the same three fields for the same reason.

---

### 2. Purpose drift — guest consent captured for personalisation was reused for research

`consent_purpose` defaults to `service_personalisation`
(`…guest_identity_minimal_slice.sql:58`). A guest consented to the restaurant using their
history to serve them better. Twelve months later that same record fed a research finding,
then a marketing example, because the data was there and the consent field said "true" if
you did not read which purpose it recorded.

The schema records a purpose **precisely so this cannot happen by accident** — which means
doing it anyway would be deliberate, and permanently documented in the migration history of
this repo.

**Earliest observable signal.** A finding resting on guest records whose `consent_purpose` is
the default. Or, in the query rather than the output: a research query that filters on
`consent_captured_at is not null` without also filtering on purpose.

**What would have prevented it.** Every finding states the `consent_purpose` it relied on,
as a field, not a footnote. A finding that cannot state one is not published.

---

### 3. "It's public, so it's fine"

The customer research is a review of a **public** web presence — a website, a menu, a
listing. Somebody made the obvious argument: this is information anyone can see, so a
consent gate is theatre. It is a genuinely reasonable-sounding argument, it is made quickly,
and it is usually made by someone under time pressure who is not trying to do anything
wrong.

The instruction was never about the data's availability. It was about not studying a
customer who has not agreed to be studied.

**Earliest observable signal.** The argument being made out loud. That is the signal — there
is no earlier one, and it will sound sensible.

**What would have prevented it.** The founder's instruction is quoted in the charter in its
own blocked section rather than paraphrased into a policy, because a paraphrase is where the
strength leaks out. And the gate is defined as *the register*, explicitly not as *the
publicness of the data*, so the argument has nothing to attach to.

---

### 4. Withdrawal was captured but never enforced downstream

A guest set `consent_withdrawn_at`. The database honoured it perfectly — the schema is
careful, the erasure tombstone at `:79-81` and `:112-117` is genuinely well designed. But a
finding written three months earlier still cited that person's behaviour, still sat in a
document, and still circulated. The consent system worked and the research practice did not
listen to it.

**Earliest observable signal.** Any live finding that does not list the subject ids it rests
on. Without that list, withdrawal is unenforceable by construction — you cannot retract what
you cannot locate.

**What would have prevented it.** Findings carry their subject ids, and the weekly
reconciliation loop sweeps withdrawals into a retraction queue. Weekly rather than monthly,
because withdrawal is a right with a clock on it.

---

### 5. The team became a lookup service for Sales

A request arrived: *"can you research this restaurant before I email them?"* It was a
reasonable-sounding request from a colleague, about a business rather than a person, and
saying no felt obstructive. M4 did it once. After that it was a service, the gate applied to
some requests and not others, and the distinction between a consented customer and a
prospect stopped being visible from inside the team.

**Earliest observable signal.** The first request phrased as "before I reach out". Prospects
are not consenting customers, and the giveaway is in the tense.

**What would have prevented it.** The refusal is written into
[[customer-relationship-research-directive]] as a routing rule rather than left to
judgement in the moment: prospect research routes to [[outbound-engine-charter|Sales S2]]
and is answered under their rules. A gate that is applied by the person being asked to make
an exception is not a gate.

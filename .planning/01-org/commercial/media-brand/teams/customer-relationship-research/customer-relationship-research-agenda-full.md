---
type: agenda-full
division: commercial
department: media-brand
team: customer-relationship-research
status: provisional
metrics: []
updated: 2026-08-24
links:
  - "[[customer-relationship-research-charter]]"
  - "[[customer-relationship-research-premortem]]"
  - "[[customer-relationship-research-agenda-board]]"
  - "[[compliance-privacy-charter|compliance-charter]]"
---

# Customer Relationship Research (M4) — Full Agenda

> **PROVISIONAL — no work done yet.** This is forecast, not fact.
>
> ⛔ **No research runs until the approval register exists and Compliance & Privacy has
> reviewed the mechanism.** Everything below is about building the gate, not about passing
> through it.

## What

**One deliverable before any research happens: the approval register**, proposed by this
team and reviewed by [[compliance-privacy-charter|Compliance & Privacy]].

Then, and only then: a findings format, a cohort definition, and the first question.

## How

### The register, proposed in the shape the repo already argued for

This project has already solved this problem once, for guests, and wrote down why. The
migration comment at
`supabase/migrations/20260819000000_guest_identity_minimal_slice.sql:55-57` says it directly:
*a boolean cannot answer "what was this person told, on what date, and can we prove it".*
The customer register needs the same three answers, for the same reason.

```
customer approval record
  customer_id            which restaurant
  approval_purpose       'public_web_presence_review'  ← NOT service_personalisation
  notice_version         what they were shown, versioned
  captured_via           how — CHECK-constrained, like the guest column
  captured_at            when
  withdrawn_at           nullable; non-null means stop, everywhere, including findings
```

**It is proposed here and it is not built here.** The legal basis, the notice text, and
whether this belongs in the same database at all are Compliance & Privacy's calls. M4's job
is to say what the practice needs; theirs is to say what the law and the DPAs allow.

**It must not reuse the guest consent columns.** Different subject, different purpose. That
reuse is premortem mechanism 2, and it would be permanent in migration history.

### The findings format, designed around retraction

Every finding carries, as structured fields rather than prose:

- the subject ids it rests on;
- the `consent_purpose` / `approval_purpose` that permitted it;
- the notice version in force at the time.

**The subject ids are what make withdrawal enforceable.** A finding without them cannot be
retracted, because it cannot be located. That is premortem mechanism 4, and the fix is a
field, not a policy.

### The first question, when there is one

Small, answerable, and about something the product could act on. Not a survey. The value of
this team is that it asks few questions of consenting people rather than many questions of
everyone.

## Why now

Not to do research. To build the gate **before** there is pressure to skip it.

Every mechanism in [[customer-relationship-research-premortem]] happens at a moment when the
research feels obviously fine and the gate feels like friction. A gate designed under that
pressure is a gate with an exception in it. Designing it now — when there is nothing to
research, no deadline, and one customer — costs nothing and is the only time it can be done
honestly.

There is a second reason: NF-B is a priority track
([README §4.2](../../../../../foundation/README.md)) and it emits nothing today. When it
does start emitting, the consent discipline around it should already exist rather than be
retrofitted onto live data.

## Next steps

1. **Draft the register proposal** in the shape above. Do not implement.
2. **Send it to Compliance & Privacy.** Ask specifically: same database or separate, what
   notice text, what legal basis, and what a withdrawal obliges us to do to existing
   findings.
3. **Draft the findings format**, with subject ids and purpose as required fields.
4. **Write the refusal rule** for prospect requests, before the first one arrives.
5. **Raise the Ethics & Responsible AI discrepancy** — [[commercial]] §4 assigns review to a
   function [ORG_STRUCTURE §3](../../../../../foundation/ORG_STRUCTURE.md) records as not
   adopted. The review currently has no owner.
6. Nothing else. No question is asked of any customer or guest until 1–3 are done.

## Questions for the founder

1. **Where should customer approval live, and who captures it?** In the product, in a
   document, in the contract? This determines whether it is an engineering task or a paper
   one.
2. **What exactly is the customer approving?** "Reviewing your public web presence" can mean
   reading a menu or building a profile. The notice text has to say which, and the narrower
   version is easier to honour.
3. **Can approval be withdrawn, and what does withdrawal oblige us to do** to findings
   already written? The guest schema has a clear answer for data
   (`consent_withdrawn_at`, and erasure as a tombstone at `:79-81`); findings need their own
   answer.
4. **Is the design partner in or out?** They are a friend and the only customer, which makes
   an informal yes both very likely and exactly the kind of approval that should be recorded
   rather than remembered.
5. **Guest research: which purposes are in scope?** Consent captured under
   `service_personalisation` (the schema default at `:58`) does not cover research, and this
   team will not treat it as if it does.

---
type: directive
division: commercial
department: media-brand
status: provisional
metrics: []
updated: 2026-08-24
links:
  - "[[media-brand-charter]]"
  - "[[media-brand-loops]]"
  - "[[brand-identity-directive]]"
  - "[[customer-relationship-research-directive]]"
---

# Media & Brand — Directive

How *this* department decides. The shape is a **routing gate followed by two hard stops**,
because the department's two worst outcomes — publishing a false claim, and touching a
person who did not consent — are both irreversible, and both are cheap to prevent at the
point of routing.

## The graph

```mermaid
graph TD
  A[Outward request arrives] --> B{What kind?}
  B -->|What are we called| M1[Brand Identity]
  B -->|What do we claim| M2[Narrative & Collateral]
  B -->|Where do we say it| M3[Social & Community]
  B -->|What may we learn| M4[Customer Relationship Research]

  M1 --> C{Rendered to a human or sent to a third party?}
  C -->|yes| C1[Tier 1 — rename now, CI-guarded]
  C -->|internal only| C2[Tier 2 — bulk, low risk]
  C -->|it is an identifier| C3[NOT OURS — CM-F5 to Engineering]

  M2 --> D{Does the artifact state a number?}
  D -->|yes| D1[HARD STOP — G3 fact-check, source line required]
  D -->|no| D2[One-sentence test, then ship]
  D1 --> D2

  M3 --> E{Has an article cleared G3?}
  E -->|no| E1[Stay dormant. Log the watch, do not post]
  E -->|yes| D2

  M4 --> F{Is this subject on the approval register?}
  F -->|no register exists| F1[HARD STOP — no research]
  F -->|not on it| F1
  F -->|on it, consent live| F2{consent_withdrawn_at set?}
  F2 -->|yes| F1
  F2 -->|no| F3[Research, and record the consent basis in the finding]

  C3 --> Z[OPEN-DECISIONS]
  F1 --> Z
```

## Decision rights

| Decision | Decided by | Not decided by |
|---|---|---|
| The name, the marks, the wordmark | M1, founder confirms | Anyone editing a string in passing |
| Whether a string is tier 1, 2, or 3 | M1, using the rendered/transmitted/identifier test | The person who wants it renamed |
| The one sentence | M2, once. Changing it is a founder decision | Per-artifact authors |
| Whether an artifact may state a number | G3, not M2 | M2 |
| Whether a research subject may be touched | The approval register, mechanically | Anyone's recollection of an approval |
| The legal shape of the consent mechanism | Compliance & Privacy | M4 |
| Adopting a tool or a visual reference | M1, only after identity verification and a named need | Enthusiasm |

## The two hard stops, stated plainly

**A number without a source line does not leave this department.**
[YC_WEDGE_PLAN.md:31-33](../../YC_WEDGE_PLAN.md) establishes that "dollars recovered"
currently means *we asked*, not *we received*. That distinction is load-bearing and it is
the kind of thing a reader checks.

**A person without a recorded approval is not researched.** Public availability of the data
is not an argument. The gate is the register.

## Escalation trigger

Escalate to [OPEN-DECISIONS.md](../../../decisions/OPEN-DECISIONS.md) when:

- a change crosses the Design boundary in either direction (see [[media-brand-charter]]);
- a rename candidate is an identifier rather than a display string (CM-F5);
- the one sentence would need to change;
- M4 is asked to research a subject who is not on the register — including a Sales prospect;
- an advisory function files a finding against this department. Advisory output is
  findings-only ([ORG_STRUCTURE §3](../../../foundation/ORG_STRUCTURE.md)); it does not
  block, and it does not get quietly absorbed either.

## One inherited inconsistency, flagged not resolved

[[commercial]] §4 assigns review of M4's work to **Ethics & Responsible AI (advisory)**.
[ORG_STRUCTURE §3](../../../foundation/ORG_STRUCTURE.md) records that function as
**considered and not adopted**, with agent-autonomy limits and guest-data use falling to
Compliance & Privacy in the line. So the review the division document assigns has no owner.
This directive routes it to Compliance & Privacy and raises the discrepancy rather than
silently rewriting either document.

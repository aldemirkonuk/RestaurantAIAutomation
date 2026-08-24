---
type: schedule
division: commercial
department: media-brand
team: customer-relationship-research
status: provisional
metrics: []
updated: 2026-08-24
links:
  - "[[customer-relationship-research-charter]]"
  - "[[customer-relationship-research-loops]]"
  - "[[media-brand-schedule]]"
  - "[[compliance-charter]]"
---

# Customer Relationship Research (M4) — Schedule & Skills

## Recurring work

| Cadence | Job | Emits |
|---|---|---|
| Per request | Eligibility check before any touch. Returns eligible / not eligible / **no register**. Log the refusal either way | `research-consent-reconciliation` |
| Weekly | Reconciliation — subjects touched vs approved; must be equal | `research-consent-reconciliation` |
| Weekly | Withdrawal sweep — new `consent_withdrawn_at` values into the retraction queue | `research-withdrawal-propagation` |
| Monthly | Purpose-drift audit — every finding's `consent_purpose`, and any finding missing one | `research-purpose-drift` |
| Monthly | Register-build status — does it exist, where is the Compliance & Privacy review | `research-register-build` |

**Four of the five have nothing to run on, and all five are scheduled anyway.** There is no
register, no research, and no findings. An empty run is the correct result and a listed job
is the difference between "not started" and "nobody created it".

**The anti-sprawl rule is modified here, on purpose.** Three consecutive no-action runs
normally downgrade or delete a job ([README §6](../../../../../foundation/README.md)). For
the register-build status job, three unchanged runs is an **escalation** instead: the thing
not moving is the gate, and deleting the job that watches a blocked gate is how the blockage
becomes invisible and then becomes an exception.

## Skills owned

Skills live in `.claude/skills/`. **None exist.** One is worth building before any research
happens; the rest are deliberately deferred.

---

### `consent-register-check` — T2 department. **A gate, not a tool**

- **Trigger.** Before any research touch, and as the weekly sweep.
- **Doneability.** Returns exactly one of: `eligible`, `not eligible`, `no register`.
  `no register` is **terminal** — not a warning, not a soft pass, not accompanied by a
  suggested alternative. The skill also writes the refusal to a log, because a gate whose
  refusals are invisible cannot be shown to have held.
- **Real past instance.** None yet, and that is precisely the finding this schedule records:
  the practice is being chartered before its gate exists, which is the ordering
  [[customer-relationship-research-premortem]] names as its most likely failure.
  **The past instance the rule asks for is this document.**
- **Owner.** M4. The mechanism it reads is reviewed by
  [[compliance-charter|Compliance & Privacy]].
- **Note.** It must check `approval_purpose` / `consent_purpose`, not merely presence.
  Checking `consent_captured_at is not null` and stopping there is purpose drift implemented
  as a skill.

### `finding-format-lint` — T2 department, **deferred**

- **Trigger.** Before a finding is published internally.
- **Doneability.** Rejects any finding lacking subject ids, purpose, or notice version.
- **Real past instance.** None — there are no findings. **Not built until there is one.**
  It matters that this comes second: a lint over a format that does not exist yet would
  encode a guess.
- **Owner.** M4.

### Skills this team will not build

| Not built | Why |
|---|---|
| Any bulk lookup, scraping, or enrichment skill over customers | This is not open-ended lookup. A tool that makes unconsented research easy is the wrong artifact regardless of how carefully it is used |
| Prospect research tooling | Not this team's subject. Routes to Sales S2 |
| Anything reading guest records without a purpose filter | Purpose drift, implemented |

---

## Explicitly not owned here

| Work | Owner | Why |
|---|---|---|
| Legal basis, DPAs, notice text sign-off | Compliance & Privacy | We propose the operational shape only |
| Capturing consent in-product | Product → Guest Experience | We read the record |
| Shipping a feature from a finding | Product | Findings are inputs, not decisions |
| Prospect research | Sales S2 | Under their rules, not by borrowing our gate |
| Reviewing this team's use of data | **Currently unowned** | [[commercial]] §4 assigns it to Ethics & Responsible AI; [ORG_STRUCTURE §3](../../../../../foundation/ORG_STRUCTURE.md) records that function as not adopted. Escalated |

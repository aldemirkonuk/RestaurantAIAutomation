---
type: charter
division: corporate
department: legal
team: instruments-equity
status: new
metrics: [legal.instrument_chain_integrity, legal.counsel_gate_compliance, legal.consent_record_completeness, legal.cap_table_tie_out_divergence]
updated: 2026-08-24
links: ["[[legal-charter]]", "[[instruments-equity-premortem]]", "[[instruments-equity-agenda-full]]", "[[instruments-equity-agenda-board]]", "[[instruments-equity-directive]]", "[[instruments-equity-loops]]", "[[instruments-equity-schedule]]", "[[commercial-workforce-agreements-charter]]", "[[positioning-fundraise-readiness-charter]]", "[[corporate]]", "[[ORG_STRUCTURE]]"]
---

# Instruments & Equity — Charter

Division **Corporate** → Department [[legal-charter]] → Team `instruments-equity`
(§1.1 of `.planning/foundation/teams/corporate.md:65-87`).

> Not legal advice, and not drafted legal text. This charters a function that will
> commission these instruments from a qualified lawyer.

## Mandate

Own the **six instruments that move ownership, governance, or title** — founder agreement,
SAFE, board consent, stock purchase agreement, advisor agreement, IP assignment — together
with the executed-original chain, the board and consent record, and the tie-out to the cap
table. Drafts on request from [[positioning-fundraise-readiness-charter]]; **does not
decide terms — the founder does** (`corporate.md:67-70`, `:505-506`).

The unifying property is not subject matter. It is that **a mistake here cannot be
renegotiated.** A liability cap can be fixed at renewal. A dilution term, a vesting
schedule, or an assignment that never happened cannot.

## Boundaries

Owns outright:

- **The six instruments** and their lifecycle from request to executed original.
- **The chain** — signed instrument + the authority that permitted it (consent, founder's
  written terms) + the downstream record it ties out to.
- **The cap table** — one entity, therefore exactly one cap table
  ([ADR 0001](../../../../decisions/0001-mudavym-single-entity.md):38).
- **The board and consent record** — including the ordering property that a consent must
  precede the action it authorises.
- **The consequence model filed with each instrument** — dilution, control, or title
  effect, in the file, at execution.

Explicitly **not** owned:

| Not ours | Whose | The line |
|---|---|---|
| Terms — cap, discount, grant size, vesting, cliff | **Founder** | We prepare the choice and its consequences; we never infer a term |
| Whether and when to raise; the diligence narrative | [[positioning-fundraise-readiness-charter]] | Strategy sequences and requests, Legal drafts (`corporate.md:421-422`) |
| What the law requires | Outside counsel | Absolute gate on all six (`legal-directive` R1) |
| Every repeatable agreement — NDA, MSA, SOW, PSA, LOI, employment, contractor, DPA, BAA | [[commercial-workforce-agreements-charter]] | Reversibility, not counterparty |
| Employee equity *administration* once a plan exists | Deferred — no plan, no employees | Would trigger with the first W-2 hire (`corporate.md:126`) |

## Distinct from its sibling because

**Blast radius and gate, not subject matter** (`corporate.md:71-74`). Every instrument here
is outside-counsel-gated and permanent; nothing here should ever be turned around in an
hour. [[commercial-workforce-agreements-charter]]'s *entire optimisation is turning things
around in an hour*. One team cannot hold both norms — whichever norm has more weekly volume
wins, and the volume will always be on the repeatable side.

A second, less obvious difference: this team's six documents will each be **drafted once
and never templated**. Optimising for reuse — the whole job next door — is meaningless
here. There is no second founder agreement.

## Metrics it moves

| Metric | Definition | Baseline |
|---|---|---|
| `legal.instrument_chain_integrity` | % of executed instruments holding a complete chain: signed original + authorising consent or written terms + cap-table entry | **0 of 0.** Only 100% is a passing value (`corporate.md:80-83`) |
| `legal.counsel_gate_compliance` | % of instruments reviewed by outside counsel *before* signature | **0 of 0.** Target 100%, permanently |
| `legal.consent_record_completeness` | % of board actions with a consent dated **before** the action | **0 of 0** — the ordering property, not just the presence one |
| `legal.cap_table_tie_out_divergence` | Rows where the cap table and the executed paper disagree | **No cap table exists** |

Anything less than 100% on the first metric is a **diligence blocker discovered at the
worst moment** — which is the whole reason it is stated as a pass/fail rather than a
percentage to improve.

## Evidence today

**NEW — nothing exists.** Stated without softening: there is no cap table, no equity
instrument, and no board record anywhere in the repo (`corporate.md:75-79`). Verified
independently: a repo-wide filename sweep for `safe|cap.table|board.consent|term.sheet|
stock|equity` returns no legal document. **Baseline is 0 of 0, and 0 of 0 is not a good
score — it is an unread one.**

The single adjacent fact on the record is
[ADR 0001](../../../../decisions/0001-mudavym-single-entity.md):38 — *"One brand, one legal
surface, one doc graph."* That fixes that there is exactly one entity to issue against,
and therefore exactly one cap table this team owns. It is a useful constraint and it is
also the only one.

**One observation, offered as sequencing rather than as advice:** the repo contains a
substantial codebase and no IP assignment. That is an *empty-register* observation, not a
legal opinion, and this team is not qualified to give the latter. Its consequence for the
agenda is only this — founder agreement and IP assignment go in front of counsel before
any fundraising instrument, because they are the two whose absence gets discovered by
somebody else, at diligence, when it is least fixable
([[instruments-equity-agenda-full]]).

## Entry conditions — what actually starts this team

This team is **NEW with no work queued**, and the honest description is that it is
*armed rather than running*. It activates on any one of:

- The founder decides to formalise founder equity or IP assignment.
- [[positioning-fundraise-readiness-charter]] opens a real term-sheet conversation
  (`corporate.md:457`).
- The first advisor is engaged on any promise, written or verbal, involving equity.

Until then its only live obligation is the one in [[instruments-equity-directive]]: the
gates exist **before** the first request, because a gate proposed during a raise is a
negotiation about the gate.

## The trim flag applies to this team specifically

`corporate.md:116-121` names Legal the trim candidate and this split as **structural, not
evidential**. This team is one half of that split and it has zero artifacts. If the merge
condition in [[legal-loops]] L-LEG-5 fires, this charter folds into
[[legal-charter]] and the six instruments become a *class* inside one team rather than a
team. That outcome is written down now, while nobody is invested in defending it.

---
type: schedule
division: corporate
department: legal
team: instruments-equity
status: provisional
metrics: [legal.instrument_chain_integrity, legal.cap_table_tie_out_divergence, legal.consent_record_completeness]
updated: 2026-08-24
links: ["[[instruments-equity-charter]]", "[[instruments-equity-loops]]", "[[instruments-equity-agenda-board]]", "[[instruments-equity-directive]]", "[[legal-schedule]]", "[[skills-charter]]", "[[positioning-fundraise-readiness-charter]]"]
---

# Instruments & Equity — Schedule & Skills

## Recurring work

| Cadence | Job | Emits |
|---|---|---|
| Per request | Intake — record requester, stated terms (or their absence), counterparty, and the requested date | Register entry; a **HOLD** if terms are missing ([[instruments-equity-directive]] IE-1/IE-3) |
| Per instrument | Chain completion check — L-IE-1 | Hold or release of the `executed` transition |
| Per board action | Consent-ordering check — L-IE-3 | `legal.consent_record_completeness`; refusal of any back-dated consent |
| Monthly | Verbal-commitment reconciliation — L-IE-4 | A list of names with no open request. Empty is the good answer |
| Monthly | Ageing sweep — anything at `signed` but not `executed`, anything at `requested` past one close-time | Escalations under [[instruments-equity-directive]] |
| Quarterly | Cap-table tie-out — L-IE-2. **Every** executed instrument, never a sample | `legal.cap_table_tie_out_divergence` |
| Quarterly | Retention check — every executed original still retrievable, from its recorded location, by someone who is not the founder | Gaps list |
| Quarterly | Activation check — L-IE-5 | Instruments issued + agenda content-diff age; feeds the merge condition |

**No weekly cadence exists, deliberately.** This team's whole class of work may produce
nothing for a quarter. A weekly meeting over an empty register is the theatre
[[legal-premortem]] M1 describes, and the org's own anti-sprawl rule would delete a
scheduled job that produces no action for three runs (GENERATION_BRIEF §3.8). The event-
closed loops in [[instruments-equity-loops]] cover everything that is genuinely urgent, and
they are urgent only when something is actually happening.

The quarterly **retention check** deserves its one-line justification: an executed original
that only one person can find is not retained, it is remembered. The test is deliberately
"someone who is not the founder", because the failure this catches is single-point
retention, not disorganisation.

## Skills owned

Skills live in `.claude/skills/`. A skill that has not fired in 30 days is reviewed for
deletion.

**`.claude/skills/` does not exist in this repo.** Everything below is proposed.

**This team owns no generative drafting skill, and that is the structural point rather
than a caution** ([[instruments-equity-directive]] IE-6). Drafting in the one-way-door
class is counsel's work. Every skill here is a **checker** — something that reads state and
refuses a transition. The distinction is load-bearing: a checker that is wrong produces a
false hold, which is annoying; a drafter that is wrong produces a plausible instrument,
which is unrecoverable ([[legal-premortem]] M5).

| Proposed skill | Shape | Fires on | Refuses |
|---|---|---|---|
| `instrument-chain-check` | Checker | Any instrument entering `executed` | The transition, when any of the four legs is missing |
| `cap-table-tie-out` | Checker | Quarterly; any new equity instrument | Nothing — it reports divergence; correction is always applied to the cap table, never to the paper |
| `consent-record-completeness` | Checker | Any board action; quarterly | A consent dated after its action |
| `commitment-gap-scan` | Checker | Monthly | Nothing — it emits a list of names with no open request |

The 30-day deletion rule interacts awkwardly with this team and it should be said rather
than discovered: **these skills may legitimately not fire for a quarter.** They are
event-driven on events that are rare by design. The anti-sprawl rule is right in general
and wrong here, so the exemption is written down now, with its own boundary — a checker
that has not fired is reviewed at the **quarterly** activation check (L-IE-5) rather than
at 30 days, and if the team itself is merged the skills go with it. An exemption without an
expiry is how anti-sprawl rules die.

Registry ownership sits with [[skills-charter]] (Applied AI), not here.

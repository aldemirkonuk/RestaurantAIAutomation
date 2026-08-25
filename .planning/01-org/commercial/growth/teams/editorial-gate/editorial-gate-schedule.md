---
type: schedule
division: commercial
department: growth
team: editorial-gate
status: provisional
metrics: []
updated: 2026-08-24
links: ["[[editorial-gate-charter]]", "[[editorial-gate-loops]]", "[[editorial-gate-agenda-board]]", "[[growth-schedule]]", "[[content-production-schedule]]", "[[brand-identity-charter]]", "[[design-partner-operations-charter]]", "[[skills-charter]]", "[[skill-lifecycle-anti-sprawl-charter]]"]
---

# Editorial Gate — Schedule & Skills

## Recurring work

| Cadence | Job | Emits |
|---|---|---|
| **Per unit, mandatory** | The human pass — five checks in order, claims first. **Never sampled, never expedited, no exemption by category** | A committed verdict artifact, one field per check |
| Per unit | Provenance completeness — is there a source for every factual sentence? A missing record returns the unit **unread** | Return-unread record |
| Per unit | Social-proof check — named consenting counterparty and a dated artifact, or reject | Pass, or an escalation |
| Weekly | Verdict health — L-G3-1. Rejection rate, verdict distribution across checks, bypass count | Rule change, or a change upstream to brief or template |
| Weekly | Bypass diff — published pages with no committed verdict artifact | `editorial.gate_bypass_count`, reported to [[growth-agenda-board]] |
| Monthly | Rule amendment — L-G3-2. Cases with no citable clause become entries or amendments | Banned-list entry, or a voice-guide amendment request to [[brand-identity-charter]] |
| Monthly | Banned-list hygiene — an entry unfired for two quarters is reviewed for removal | List diff |
| Quarterly | Published-claim re-audit — L-G3-3. **Complete, not sampled**, while the corpus allows it | Corrections on-page; stale-claim list |
| Quarterly | Recovery-claim verification with [[design-partner-operations-charter]] — has an 812 credit memo actually landed? | The one fact that governs the company's headline number |
| Quarterly | Charter staleness sweep ([[README]] §3.3, §6) | Archive or revision |

**Two of these run today, before a single page exists.** The quarterly recovery-claim
verification can start now, because the claim is already being made verbally and in planning
documents. And the "no guide" counter starts the moment the gate is asked to check voice
against a document [[brand-identity-charter]] has not yet written.

**Anti-sprawl.** A job with no action for three consecutive runs is downgraded or deleted
([[README]] §6). **The per-unit human pass is explicitly exempt from that rule** and this is
the one place in Growth where an exemption is correct: a gate that produced no rejections for
three cycles is not a useless job, it is either a well-trained writer or a gate that stopped
reading — and L-G3-1 exists to tell those apart. Retiring the gate for inactivity would be
[[editorial-gate-premortem]] M1 arriving through the anti-sprawl rule instead of through a
deadline.

## Skills owned

Skills live in `.claude/skills/`. A skill unfired for 30 days is reviewed for deletion.

**None exist.** The repo has one project skill, `.agents/skills/railway-config/SKILL.md`
([[README]] §3.1). Each proposal below is bound to a job above, per the creation protocol
([[README]] §3.3).

| Proposed skill | Tier | Trigger | Doneability criteria | Real past instance |
|---|---|---|---|---|
| `claim-provenance-audit` | T2 | Per unit at submission, and quarterly over the corpus | Every factual sentence mapped to a source, or a list of unmapped sentences. **It produces a list, never a verdict** | The recovery-claim distinction at [[YC_WEDGE_PLAN]]:31-33 is precisely the class of error this exists to surface before a human reads the draft |
| `banned-construction-check` | T2 | Every draft, before the human sees it | A flag list: em dashes, buzzword hits, register heuristics. **No verdict field exists in its output, by design** | Founder-specified: no em dashes, no buzzwords ("streamlined" named), no press-release register |
| `verdict-artifact-write` | T3 | Completion of any human pass | A committed file with one field per check and a reason per non-pass; a pass with an empty reason field for a failed check is invalid | None. It exists so that a bypass is an absent object in version control rather than a forgotten conversation |
| `published-claim-sweep` | T3 | Quarterly L-G3-3 | Every published claim re-checked against its source; output is a stale-claim list | None yet — deferred until the corpus is large enough that a complete manual re-audit stops being feasible |

**The load-bearing property of the first two skills is what they do not have.** Neither
`claim-provenance-audit` nor `banned-construction-check` emits a verdict. They produce lists
that a human reads. If either one ever gains a pass/fail output that something downstream
consumes, the mandatory human pass has been automated and
[[editorial-gate-premortem]] M1 has happened without anyone deciding to do it. That
constraint is part of each skill's definition, not a usage note, and it is the single most
important line in this document.

**Registry ownership** sits with [[skills-charter]]; the 30-day review with
[[skill-lifecycle-anti-sprawl-charter]]. G3 authors, it does not govern — and it asks that
the 30-day deletion review never be applied to a skill whose absence would make the gate
faster.

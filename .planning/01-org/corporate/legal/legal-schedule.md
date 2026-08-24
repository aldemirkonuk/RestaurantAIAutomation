---
type: schedule
division: corporate
department: legal
status: provisional
metrics: [legal.instrument_chain_integrity, legal.clause_library_hit_rate, legal.counsel_gate_compliance]
updated: 2026-08-24
links: ["[[legal-charter]]", "[[legal-loops]]", "[[legal-agenda-board]]", "[[legal-directive]]", "[[instruments-equity-schedule]]", "[[commercial-workforce-agreements-schedule]]", "[[skills-charter]]", "[[foundation-README]]", "[[standards-verification-charter]]", "[[regulatory-posture-charter]]"]
---

# Legal — Schedule & Skills

## Recurring work

| Cadence | Job | Emits |
|---|---|---|
| Per request | Lane assignment — one-way door vs repeatable vs data-instrument ([[legal-directive]]) | Register entry with owning team and applicable gates |
| Per instrument | Chain integrity check — L-LEG-1 | Hold or release of the `executed` transition; `legal.instrument_chain_integrity` |
| Per data instrument | Annex satisfiability co-signature with [[regulatory-posture-charter]] — L-LEG-2 | `legal.annex_satisfiability_signoff`; a named test per commitment |
| Weekly | Open-request standup — what is waiting, on whom, since when | Ageing list; escalations under [[legal-directive]] §Escalation |
| Monthly | Clause-library health — L-LEG-3 | Hit rate, fresh-write list, library candidates |
| Monthly | Assisted-draft doneability — L-LEG-4 *(dormant until the skill exists)* | `[GAP]`-marker rate, named-reviewer coverage |
| Quarterly | **Register reconciliation** — every executed instrument re-read against its downstream record (cap table, roster, vendor file) | Divergence list to [[instruments-equity-charter]] |
| Quarterly | **Annex re-validation** — executed DPAs/BAAs re-checked against the system as it is *now*, not as it was at signature | Reopened L-LEG-2 findings |
| Quarterly | Team-shape / merge review — L-LEG-5 | Keep-two or merge recommendation to [[decision-office-charter]] |
| Quarterly | **Clause-language sweep of this vault** — [[legal-directive]] R7: no file under `01-org/corporate/legal/` may contain drafted contract language | Rewrite list |
| Quarterly | Staleness sweep — anything untouched 60+ days is finished or fiction ([[ORG_STRUCTURE]] §4, foundation §3.3). **Date-only diffs count as untouched** | Archive, rewrite, or merge trigger |

Two cadences are deliberately absent. There is **no weekly instrument review** — the
register is empty and a weekly reading of zero is the theatre [[legal-premortem]] M1
describes. And there is **no daily anything**: nothing in this department has a daily
failure mode, and inventing one would produce a job that "produces no action for 3 runs"
and gets deleted by the org's own anti-sprawl rule (GENERATION_BRIEF §3.8).

## Skills owned

Skills live in `.claude/skills/`. A skill that has not fired in 30 days is reviewed for
deletion — the anti-sprawl rule applies here exactly as it does to agendas.

**Two honest statements before the table.**

1. **`.claude/skills/` does not exist in this repo.** [[foundation-README]] §3.2 names
   `legal-doc-draft` as a T2 department-level skill (line 145), and that name is currently
   the department's entire skill surface. It is a name, not an asset.
2. **The one-way-door team owns no generative drafting skill, by design.** Every skill
   assigned to [[instruments-equity-charter]] below is a **checker**. That is the standing
   counter-pressure to [[legal-premortem]] M5, and it is a structural choice rather than a
   caution — the class of document where a plausible-looking draft does the most damage is
   exactly the class where no draft should be generated.

| Proposed skill | Shape | Fires on | Owning team |
|---|---|---|---|
| `legal-doc-draft` | **Retrieval** — assembles reviewed clauses, emits `[GAP]` where the library is empty, never writes over a gap | A request in the repeatable class | [[commercial-workforce-agreements-charter]] |
| `clause-library-diff` | Checker | Any redline, any fresh-written section | [[commercial-workforce-agreements-charter]] |
| `redline-log` | Recorder | Every counterparty markup | [[commercial-workforce-agreements-charter]] |
| `annex-obligation-map` | Checker — maps each Annex commitment to a named, existing test | Any DPA or BAA entering counsel review | [[commercial-workforce-agreements-charter]] + [[regulatory-posture-charter]] |
| `instrument-chain-check` | Checker | Any instrument entering `executed` | [[instruments-equity-charter]] |
| `cap-table-tie-out` | Checker | Quarterly reconciliation; any new equity instrument | [[instruments-equity-charter]] |
| `consent-record-completeness` | Checker | Quarterly; any board action | [[instruments-equity-charter]] |

**Nothing in this table exists.** It is listed so a skill is built against a scheduled job
with a close-time, rather than a skill being built and a job invented to justify it.
Ownership of the skill registry itself sits with [[skills-charter]] (Applied AI), not
here — Legal authors and commissions skills, it does not govern the registry.

**The one skill rule specific to this department:** a `legal-doc-draft` run that emits
zero `[GAP]` markers is treated as a defect until proven otherwise. A library that happens
to cover every section of a novel counterparty's paper is far less likely than a model
quietly writing over the holes.

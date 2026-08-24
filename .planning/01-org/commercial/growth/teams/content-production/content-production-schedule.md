---
type: schedule
division: commercial
department: growth
team: content-production
status: provisional
metrics: []
updated: 2026-08-24
links: ["[[content-production-charter]]", "[[content-production-loops]]", "[[content-production-agenda-board]]", "[[growth-schedule]]", "[[editorial-gate-schedule]]", "[[search-demand-research-schedule]]", "[[skills-charter]]", "[[skill-lifecycle-anti-sprawl-charter]]"]
---

# Content Production — Schedule & Skills

## Recurring work

| Cadence | Job | Emits |
|---|---|---|
| Per commissioned unit | Brief completeness and originality check — does it carry something this company knows and the internet does not? | Accept, or return to [[search-demand-research-schedule]] |
| Per draft | Banned-construction pre-filter — em dashes, buzzword list, press-release register. **A convenience for the writer, never the gate** | Flag list attached to the draft |
| Per draft | Provenance record assembled and submitted with the draft, not after | Source-per-claim file |
| Per publication | Link-graph check — back-links live and direct, no duplicate-intent pairs | `content.faq_orphan_pages` |
| Per revision or retirement | Re-parent or retire the answer-page cluster. Never orphan it | Link-graph diff |
| Weekly | Draft-to-verdict read — L-G2-1. Returns classified as *prose* or *brief* | `content.first_pass_clear_rate`, commission-rate change |
| Weekly | Draft queue depth, in weeks of **gate** throughput | `content.draft_queue_weeks` |
| Monthly | Link-graph sweep over the whole corpus — L-G2-2, catching decay rather than birth defects | Defect list |
| Monthly | Originality and citation feedback — L-G2-3 | Commissioning-criteria change |
| Quarterly | Template review — both page shapes against what actually got extracted and cited | Template revision |
| Quarterly | Charter staleness sweep ([[README]] §3.3, §6) | Archive or revision |

**Nothing on this table runs today.** There is no brief, no gate, no publishing target, and
no page. The table exists so that when unit one is commissioned, the jobs already have names
and cadences rather than being invented under deadline.

**Anti-sprawl.** A job producing no action for three consecutive runs is downgraded or
deleted ([[README]] §6). The monthly link-graph sweep is the likely candidate once the
per-publication check is reliable — but not before, because the sweep catches decay and the
per-publication check cannot.

## Skills owned

Skills live in `.claude/skills/`. A skill unfired for 30 days is reviewed for deletion.

**None exist.** The repo has one project skill, `.agents/skills/railway-config/SKILL.md`
([[README]] §3.1). Each row below is bound to a job above, per the creation protocol
([[README]] §3.3): trigger, doneability criteria, a real past instance, and an owner.

| Proposed skill | Tier | Trigger | Doneability criteria | Real past instance |
|---|---|---|---|---|
| `seo-article-pipeline` | T2 | A commissioned brief with a wedge tag and a publishing target | A draft plus a provenance record with a source per claim; a draft submitted without provenance is a failure, not a partial | Named as the canonical T2 department skill at [[README]] §3.2. The shipped precedent for Claude drafting outward-facing prose under a human gate is the vendor-reply path, which drafts and never auto-sends |
| `answer-page-set` | T2 | An article confirmed indexed, plus its distinct question set | One ~120-word page per distinct question, each with a live direct back-link; a set that ships a duplicate-intent pair fails | None yet. **Not built until the first FAQ layer has shipped manually**, because its failure mode is generating exactly the ten thin pages [[content-production-premortem]] M1 describes |
| `link-graph-check` | T3 | Every publication, revision, and retirement | Zero orphans, zero redirect-resolved back-links, zero duplicate-intent pairs — or a defect list | None. The failure it guards is the one Growth cannot see from any other metric |
| `banned-construction-check` | T2 | Every draft, before submission | A flag list. **It never returns a verdict** — the mandatory human pass is [[editorial-gate-schedule]]'s and cannot be delegated to a linter | Founder-specified constraints: no em dashes, no buzzwords ("streamlined" named), no press-release register |

**One warning attached to the last row and repeated deliberately.** If
`banned-construction-check` ever becomes the thing that decides whether a unit publishes,
[[growth-premortem]] M2 has happened quietly and nobody will have noticed the moment it did.
It is a pre-filter. It has no verdict. That property is part of the skill's definition, not
a usage note.

**Registry ownership** sits with [[skills-charter]]; the 30-day review with
[[skill-lifecycle-anti-sprawl-charter]]. G2 authors, it does not govern.

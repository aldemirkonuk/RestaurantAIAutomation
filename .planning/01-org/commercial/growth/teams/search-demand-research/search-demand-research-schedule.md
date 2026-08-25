---
type: schedule
division: commercial
department: growth
team: search-demand-research
status: provisional
metrics: []
updated: 2026-08-24
links: ["[[search-demand-research-charter]]", "[[search-demand-research-loops]]", "[[search-demand-research-agenda-board]]", "[[growth-schedule]]", "[[content-production-schedule]]", "[[skills-charter]]", "[[skill-lifecycle-anti-sprawl-charter]]"]
---

# Search Demand Research — Schedule & Skills

## Recurring work

| Cadence | Job | Emits |
|---|---|---|
| Per research session | Harvest capture — record the exact queries the session ran, before its context is discarded | Raw search set attached to a topic |
| Weekly | Harvest to brief — L-G1-1. Every captured set becomes briefs or rejections inside the week | Queue diff, `demand.queue_rejection_reasons` |
| Weekly | Queue depth read, measured in **weeks of gate throughput** rather than rows | `demand.queue_depth_weeks` |
| Monthly | Search Console gap requeue — L-G1-2. **Currently returns *blocked***: precondition `seo.soft_404_rate = 0` is unmet | `demand.uncovered_keyword_count`, or a recorded blocked verdict |
| Monthly | Wedge drift — L-G1-3. Share read against corpus size | `demand.wedge_share_of_corpus` |
| Monthly | AnswerThePublic pass on the next queued topic — ten most distinct questions, distinctness decided before drafting | Question set attached to a brief |
| Quarterly | Corpus review — terms queued but never commissioned for two quarters are re-decided or dropped | Queue pruning record |
| Quarterly | Charter staleness sweep ([[README]] §3.3, §6) | Archive or revision |

**One job runs today and it is not on this table**, because it is a task rather than a
cadence: the **intake finding** ([[search-demand-research-agenda-full]]). Until it is
written, every row above is either blocked or running on an unverified assumption about what
the three sources will give us.

**Anti-sprawl.** A scheduled job producing no action for three consecutive runs is
downgraded or deleted ([[README]] §6). L-G1-2 is the obvious candidate — but a *blocked*
verdict is an action for these purposes, because it holds a dependency visible. If it
reports blocked three times, the escalation fires rather than the job being retired.

## Skills owned

Skills live in `.claude/skills/`. A skill that has not fired in 30 days is reviewed for
deletion.

**None exist.** The repo has one project skill, `.agents/skills/railway-config/SKILL.md`
([[README]] §3.1). The rows below are proposals bound to a job above, per the creation
protocol ([[README]] §3.3).

| Proposed skill | Tier | Trigger | Doneability criteria | Real past instance |
|---|---|---|---|---|
| `search-harvest-capture` | T2 | End of any research session on a queued topic | The session's search set is written to the corpus with topic, timestamp, and wedge tag; a session that ran searches and produced no capture fails | `services/agent-orchestrator/api/research_routes.py` runs external research at scale for wine enrichment and retains **the facts, not the queries**. Every query it has ever run is lost, which is precisely the loss this skill exists to prevent |
| `gsc-gap-report` | T3 | Monthly L-G1-2, only when the precondition is met | Produces the ≥10-impression, no-page list, or an explicit blocked verdict naming the failed precondition | None — no Search Console property exists. **Not built until L-G1-2 has run manually twice** |
| `brief-completeness-check` | T3 | Any queue entry submitted | All six brief fields present; a missing "who is asking and what they are trying to do" fails the entry | None. Deferred until the brief format has been used on real topics |

**Two of three are deliberately unbuilt.** Nine proposed skills across Growth for a
department with zero published pages is itself the sprawl the protocol warns about, so the
rule here is stricter than the department's: **no G1 skill is built before its job has run
manually at least twice.** `search-harvest-capture` is the exception worth arguing for — its
loss is irreversible per session, which is the one case where waiting costs more than
building.

**Registry ownership** sits with [[skills-charter]]; the 30-day review with
[[skill-lifecycle-anti-sprawl-charter]]. G1 authors, it does not govern.

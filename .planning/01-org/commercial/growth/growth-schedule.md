---
type: schedule
division: commercial
department: growth
status: provisional
metrics: []
updated: 2026-08-24
links: ["[[growth-charter]]", "[[growth-loops]]", "[[growth-agenda-board]]", "[[growth-directive]]", "[[search-demand-research-schedule]]", "[[content-production-schedule]]", "[[editorial-gate-schedule]]", "[[technical-seo-ai-answer-surface-schedule]]", "[[conversion-funnel-schedule]]", "[[skills-charter]]", "[[skill-lifecycle-anti-sprawl-charter]]", "[[brand-identity-charter]]", "[[compliance-privacy-charter]]"]
---

# Growth — Schedule & Skills

## Recurring work

| Cadence | Job | Emits |
|---|---|---|
| Per publication | Editorial gate pass — provenance check, banned-construction check, voice conformance. **Mandatory, never sampled** ([[editorial-gate-schedule]]) | Verdict artifact: pass / return / reject, with reasons |
| Per publication | Pre-publish machine check — status code, canonical, title present in source HTML, schema validity, sitemap entry | Publish-blocking pass/fail |
| Per publication | Post-publish link-graph check — every FAQ page links back to its article, no duplicate-intent pair | `content.faq_orphan_pages` |
| Weekly | Gate health read — L-GRO-2. Rejection rate and bypass count read together | Commission-rate change or `OPEN-DECISIONS` entry |
| Weekly | Corpus intake — harvest the exact searches run during research, tag each against the wedge | `demand.wedge_share_of_corpus` |
| Monthly | Search Console refeed — L-GRO-1. Sort by impressions; every ≥10-impression query with no page is queued or rejected with a reason | Topic queue diff |
| Monthly | Publish → index → cite — L-GRO-3. Sampled assistant-citation check against the corpus's own questions | `seo.indexed_pages`, `answer_surface.assistant_citations` |
| Monthly | Funnel read — L-GRO-4. Rate **and** `funnel.measurable_steps` reported together | `funnel.visit_to_activated_rate` |
| Monthly | Checklist versus outcome — L-GRO-6. Every green item asserted against its bound outcome metric | List of items to re-open or mark unreadable |
| Monthly | Soft-404 probe — request three nonexistent URLs, record status codes | `seo.soft_404_rate` |
| Quarterly | Claim provenance re-audit — L-GRO-5. Complete, not sampled, while the corpus is small | Corrections on-page; stale-claim list |
| Quarterly | Charter staleness sweep — untouched 60+ days is finished or fiction ([[README]] §3.3, §6) | Archive or revision |
| Quarterly | Team-shape review against **CM-F1** and **CM-F2** | Recommendation to [[decision-office-charter]] |

**Two jobs run today.** The soft-404 probe and L-GRO-6 both work against the current
deployment and both will report red. Everything else is blocked on a publishing target and
records *blocked* rather than being skipped ([[growth-loops]]).

**The anti-sprawl rule applies to this table.** A scheduled job that produces no action for
three consecutive runs is downgraded or deleted ([[README]] §6). The monthly
assistant-citation check is the most likely candidate: if three months produce no citation
and no page-shape change, the job becomes quarterly rather than continuing to generate a
zero.

## Skills owned

Skills live in `.claude/skills/`. A skill that has not fired in 30 days is reviewed for
deletion.

**Nothing below exists.** The repo has exactly one project skill,
`.agents/skills/railway-config/SKILL.md` ([[README]] §3.1), and no `.claude/skills/`
directory. Every row is a **proposal tied to a scheduled job above**, per the skill-creation
protocol ([[README]] §3.3): a skill is created against a job with a close-time, never a job
invented to justify a skill. `seo-article-pipeline` is named in the taxonomy at
[[README]] §3.2 as the canonical T2 department skill, which is the closest thing to prior
art Growth has.

| Proposed skill | Tier | Fires on | Owning team | Real past instance it would have helped |
|---|---|---|---|---|
| `search-harvest-capture` | T2 | Any research session — captures the exact queries run and writes them to the corpus | [[search-demand-research-charter]] | The wine-enrichment research path already harvests external sources at scale (`services/agent-orchestrator/api/research_routes.py`); the queries it ran were never retained |
| `question-set-distinctness` | T2 | Before drafting the FAQ layer — scores the ten candidate questions for pairwise distinctness | [[content-production-charter]] | None yet. **Deferred until the first FAQ layer exists** rather than written speculatively |
| `seo-article-pipeline` | T2 | Commissioned article — brief in, draft out, provenance record attached | [[content-production-charter]] | Named at [[README]] §3.2. The vendor-reply draft path is the shipped precedent for Claude drafting outward-facing prose under a human gate |
| `banned-construction-check` | T2 | Every draft, before the human pass | [[editorial-gate-charter]] | None. **It is a pre-filter, never the gate** — the human pass is mandatory and this skill cannot satisfy it |
| `claim-provenance-audit` | T2 | Per publication and quarterly | [[editorial-gate-charter]] | The recovery-number distinction at [[YC_WEDGE_PLAN]]:31-33 is exactly the claim this exists to catch |
| `answer-surface-audit` | T2 | Monthly L-GRO-3 | [[technical-seo-ai-answer-surface-charter]] | `apps/api-gateway/src/vendor-portal/vendor-portal.service.ts:123-141` already emits JSON-LD nobody has ever validated against a consumer |
| `crawl-surface-census` | T3 | Weekly, and per deploy | [[technical-seo-ai-answer-surface-charter]] | The soft 404 at `vercel.json:11-13` + `apps/web/src/App.tsx:302` has been live and unreported |
| `funnel-step-census` | T3 | Monthly L-GRO-4 | [[conversion-funnel-charter]] | `funnel.measurable_steps` = 0 was recorded in this vault before anyone measured it |
| `privacy-coupling-check` | T3 | CI, on any diff touching tracking config or `index.html` | [[conversion-funnel-charter]] + [[compliance-privacy-charter]] | `apps/web/src/pages/Privacy.tsx:8-11` states the coupling contract in a code comment, where CI cannot read it |

**Two of these are honest non-skills and are marked as such.**
`banned-construction-check` is a linter that must never be mistaken for the mandatory human
pass — if it ever becomes the gate, [[growth-premortem]] M2 has happened quietly.
`question-set-distinctness` is deferred outright: there is no past instance, and the
protocol forbids speculative skills.

**Registry ownership.** [[skills-charter]] (Applied AI) governs the registry and
[[skill-lifecycle-anti-sprawl-charter]] runs the 30-day review. Growth authors skills; it
does not govern them. Nine proposed skills for a department with zero published pages is
itself a sprawl risk, and the mitigation is the dependency in the third column: no skill is
built before the job it fires on has run manually at least twice.

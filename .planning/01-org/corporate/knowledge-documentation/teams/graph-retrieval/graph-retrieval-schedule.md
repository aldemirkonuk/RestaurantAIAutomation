---
type: schedule
division: corporate
department: knowledge-documentation
team: graph-retrieval
status: provisional
metrics: []
updated: 2026-08-24
links: ["[[graph-retrieval-charter]]", "[[graph-retrieval-loops]]", "[[graph-retrieval-agenda-board]]", "[[knowledge-documentation-schedule]]", "[[corpus-archive-schedule]]", "[[skills-charter]]"]
---

# Graph & Retrieval — Schedule & Skills

## Recurring work

| Cadence | Job | Emits |
|---|---|---|
| Per PR | **Frontmatter lint** on `.planning/**` in scope — required keys per [[graph-retrieval-directive]] §Scope | Pass/fail; `graph.frontmatter_coverage_pct` |
| Per PR | **Link lint** — resolve every `[[link]]`; **ambiguous = error**, unresolved = warning | `graph.link_resolution_rate`, `graph.ambiguous_links_in_use` |
| Per PR | **`close_time` check** on any `loops.md` — a loop without one fails ([[ORG_STRUCTURE]] §5) | `graph.loops_missing_close_time` |
| Daily | **Graph metrics** — `scripts/graph_metrics.py`; coverage, resolution, ambiguity, linked-file ratio split new/legacy | All `graph.*` |
| Daily | **Query materialisation** — render the board Dataview queries to plain text inside the board files | `graph.materialised_query_age_hours` |
| Weekly | **Frontmatter coverage** — L-GR-1 | Non-compliant docs, by owning unit |
| Weekly | **Link ambiguity** — L-GR-2 | Exposure + incidence; rename requests to [[corpus-archive-charter]] |
| Monthly | **Retrieval usefulness** — L-GR-3 | MOC health; plugin review |
| Monthly | **`00-index/` MOC refresh** — `HOME`, `ORG-MAP`, `LOOP-MAP`, `DECISION-INDEX` verified as queries, not lists | Any MOC that has drifted into a hand-maintained list |

**The materialisation job is not optional infrastructure — it is the fallback that makes
this team's numbers survive its own tooling risk.** If Obsidian is never installed
([[graph-retrieval-premortem]] M1), `scripts/graph_metrics.py` plus materialisation still
produce every number on [[graph-retrieval-agenda-board]]. The metric must not depend on a
human opening a desktop application.

## Skills owned

Skills live in `.claude/skills/`. A skill that has not fired in 30 days is reviewed for
deletion.

⚠️ **`.claude/skills/` does not exist** — the repo's only project skill is
`.agents/skills/railway-config/SKILL.md` ([[README|foundation-README]] §3.1). Staged as **OD-C7**.

| Proposed skill | Trigger | Doneability criterion | Real past instance |
|---|---|---|---|
| `frontmatter-lint` | Any PR touching an in-scope `.md` | Exits non-zero listing each missing key by file; zero false positives on the 4 compliant spine docs | `ORG_STRUCTURE.md` mandates frontmatter at §5 and carries none — a rule with no gate |
| `link-lint` | Any PR adding or editing a `[[link]]` | Ambiguous links fail with all candidate paths printed; unresolved links warn and are listed as docs worth writing | `engineering-charter.md:106` writes `[[README]]` with 45 candidates in the vault root |
| `vault-bootstrap` | Once, and on any plugin change | `.obsidian/` committed with Dataview + Templater; workspace state gitignored; one board query verified rendering | [[OBSIDIAN_VAULT]]:20 promises a committed `.obsidian/`; there is none, so 99 board agendas are dead |
| `moc-rebuild` | Monthly, and after any unit is added | Every `00-index/` file is a query; a hand-written list in one fails the check | `md/DOCUMENTATION_INDEX.md` is the worked example of a hand-maintained index going 7 months stale |
| `graph-metrics` | Daily | Emits all `graph.*` from the CLI, no Obsidian required | Every number on the board is currently hand-entered from a one-off pass |

Each names a trigger, a doneability criterion, and a real past instance — the protocol at
[[README|foundation-README]] §3.3. **None is built.** Note that `moc-rebuild`'s past instance is a
document this department already owns: the failure it prevents has already happened once
here.

Registry governance belongs to [[skills-charter]] (Applied AI); this team authors, it does
not govern.

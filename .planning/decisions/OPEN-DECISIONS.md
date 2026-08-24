# Open Decisions — the founder queue

> Undecided forks. Sessions **add** items here when they hit one; only a founder
> call resolves an item (→ move it to the Resolved table, link the evidence).
> Nothing in this file may be treated as decided.
>
> Format: ID · question · why it matters · what unblocks it.

## Open

| ID | Question | Why it matters now | What unblocks it |
|---|---|---|---|
| OD-01 | **`.planning/` restructure** — 28 top-level docs (~1.2MB) + legacy `md/` (120 files) + partially-duplicated `md_files/` (47 files). Merge/archive/re-index how? | Every session pays a navigation tax; the "elevate every document" mandate starts here. | Founder picks a target shape (separate session/PR). |
| OD-03 | **Orchestration base** — `NousResearch/hermes-agent` vs `deepseek-ai/deepseek-harness` vs extending in-house `BaseAgent`. | Names cost nothing; the real axis is cheapest-capable-model routing + harness overhead (vision §12E). | A scoped bake-off on this repo's actual workloads. No pick from repute. |
| OD-04 | **External model roster** — which non-Anthropic models (Kimi/Moonshot, DeepSeek, etc.) for which task tiers, if any. | Cost-efficiency mandate; depends on OD-03's harness choice. | OD-03 result + a cost/quality eval per task type. |
| OD-05 | **Personal voice agent** — guest-facing, staff-facing, or owner/admin? (Vellum-style, vision §14A.7.) | Cannot be scoped before the audience is chosen. | One founder sentence choosing the audience. |
| OD-06 | **AnyDoc adoption** for digital-document parsing vs current Claude Vision path (vision §12D). | Invoice/receipt understanding is on the critical path to data credibility (vision §7). | Bake-off on real vendor PDFs/spreadsheets from the corpus. |
| OD-07 | **Beli strategy** — build the guest consumer experience independently vs explore collaboration (vision §10). | Determines whether guest-app work is product or partnership groundwork. | Founder call after guest MVP scope exists (FUTURES.md §7.5). |
| OD-08 | **Obsidian vault mechanics** — vault root (`.planning/` as-is vs dedicated vault dir), Graphify plugin, sync strategy. Adoption is locked ([0004](0004-obsidian-as-backlink-layer.md)); mechanics are not. | Wrong vault root now = mass link rewrites later; interacts with OD-01. | Decide together with OD-01. |
| OD-11 | **Neural-footprint production schema detail** — exact columns, partial-index strategy per `subject_type`, retention/rollup policy for the research log. | The split is locked (see Resolved); the column-level contract is not, and it gates any NF implementation. | Dedicated schema session with Postgres best-practices loaded. |
| OD-14 | **Root `SKILLS.md`** — retire, or rewrite? It is a prose reasoning protocol (not a skill) and still says "WineOps AI". | Stale brand + misleading filename; agents and contributors will mistake it for the skill registry. | Founder call; low stakes, next docs pass. |
| OD-18 | **Division count** — 5, or split Technology into Platform + Applied AI? | Five departments under Technology is the widest span in the org. | **Deferred by founder pending team-layer evidence** from the division analysis agents. |
| OD-19 | **Security classification** — of the **94** endpoints unguarded by omission (137 total − 32 webhook-module − 11 explicit `@Public()`), which are real gaps? | Unguarded + `TenantGuard` passthrough = internet-reachable ([ENDPOINTS.md](../foundation/ENDPOINTS.md)). | Security department's first assignment. |
| OD-20 | 🔴 **Analytics consultant endpoints are unauthenticated and cost money** — anonymous callers can self-enable and drive `claude-opus-4-8`. Fix now on a hotfix branch, or fold into OD-19's sweep? | Live unauthorized spend on the founder's API key. Severity is not a documentation question. | **Founder call — urgent.** |

## Resolved

| ID | Resolved as | Date |
|---|---|---|
| OD-02 | **Department structure decided** — 5 divisions, 20 departments, 2 sub-layers ([ORG_STRUCTURE §2](../foundation/ORG_STRUCTURE.md)) | 2026-08-24 |
| OD-09 | **Department set expanded, not trimmed** — founder overruled the "merge Sales into Growth" recommendation; ambition over solo-founder capacity | 2026-08-24 |
| OD-10 | **NF-C = gated research track** — reserved via `subject_type`, entry trigger required ([foundation §4.3](../foundation/README.md)) | 2026-08-24 |
| OD-11a | **NF storage split** — narrow polymorphic production table + wide append-only research log; production and research workloads separated | 2026-08-24 |
| OD-12 | **Loop graph = documentation now, executable later** — machine-readable frontmatter so loops can drive routing without a rewrite ([ORG_STRUCTURE §5](../foundation/ORG_STRUCTURE.md)) | 2026-08-24 |
| OD-13 | **Wave 0 first** (lock contracts), then wide parallel Wave 1 | 2026-08-24 |
| — | **Skills live in `.claude/skills/`** — auto-discovered, committed, PR-reviewable | 2026-08-24 |
| OD-15 | **3 advisory functions adopted** — Architecture Review, Red Team (scoped to decisions + premortems), Decision Office. Ethics & Responsible AI considered and not adopted ([0007](0007-org-structure.md)) | 2026-08-24 |
| OD-16 | **Advisory authority = findings-only**, escalating to the founder | 2026-08-24 |
| OD-17 | **7-artifact unit anatomy**, agendas banner-marked provisional until real work exists | 2026-08-24 |
| — | **One entity reaffirmed** — two-company (research lab + app) proposal argued and declined; separation lives in the data model ([0001](0001-mudavym-single-entity.md) review trail, [0006](0006-neural-footprint-architecture.md)) | 2026-08-24 |

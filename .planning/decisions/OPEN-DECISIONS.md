# Open Decisions — the founder queue

> Undecided forks. Sessions **add** items here when they hit one; only a founder
> call resolves an item (→ new ADR, link it, strike the row). Nothing in this file
> may be treated as decided.
>
> Format: ID · question · why it matters · what unblocks it.

| ID | Question | Why it matters now | What unblocks it |
|---|---|---|---|
| OD-01 | **`.planning/` restructure** — 28 top-level docs (~1.2MB) + legacy `md/` (120 files) + partially-duplicated `md_files/` (47 files). Merge/archive/re-index how? | Every session pays a navigation tax; the "elevate every document" mandate starts here. | Founder picks a target shape (proposal to be drafted as a separate session/PR). |
| OD-02 | **Department structure** — which departments exist at v0 (Research/Math, Media, Legal, Security, Sales, Social named so far), and each one's two-agenda + directive doc set (vision capture §12F/§12G). | "Company, not solo checklist" is the operating model; departments are its unit. | A structure-phase session producing the department map for founder sign-off. |
| OD-03 | **Orchestration base** — `NousResearch/hermes-agent` vs `deepseek-ai/deepseek-harness` vs extending in-house `BaseAgent`. | Names cost nothing; the real axis is cheapest-capable-model routing + harness overhead (vision capture §12E). | A scoped bake-off on this repo's actual workloads. No pick from repute. |
| OD-04 | **External model roster** — which non-Anthropic models (Kimi/Moonshot, DeepSeek, etc.) for which task tiers, if any. | Cost-efficiency mandate from §4/§12E; depends on OD-03's harness choice. | OD-03 result + a small cost/quality eval per task type. |
| OD-05 | **Personal voice agent** — guest-facing, staff-facing, or owner/admin? (Vellum-style, vision capture §14A.7.) | Cannot be scoped before the audience is chosen. | One founder sentence choosing the audience. |
| OD-06 | **AnyDoc adoption** for digital-document parsing vs current Claude Vision path (vision capture §12D). | Invoice/receipt understanding quality is on the critical path to data credibility (§7 of the vision). | Bake-off on real vendor PDFs/spreadsheets from the corpus. |
| OD-07 | **Beli strategy** — build the guest consumer experience independently vs explore collaboration (vision capture §10). | Determines whether guest-app work is product or partnership groundwork. | Founder call after guest MVP scope exists (FUTURES.md §7.5). |
| OD-08 | **Obsidian vault mechanics** — vault root (`.planning/` as-is vs dedicated vault dir), Graphify plugin, sync strategy. Adoption itself is locked ([0004](0004-obsidian-as-backlink-layer.md)); the mechanics are not. | Wrong vault root now = mass link rewrites later; interacts with OD-01. | Decide together with OD-01 (same session). |
| OD-09 | **Department set** — the 9 proposed in [foundation §2.2](../foundation/README.md), or fewer (e.g. merge Sales into Growth at v0)? | Each department costs 5 docs + upkeep; over-scoping the org is the cheapest mistake to make and the most expensive to unwind. | Founder call on the list. |
| OD-10 | **NF-C (neuro-decoding)** — gated research track with an explicit entry trigger, or a v0 schema participant? Claude argues for gated ([foundation §4.3](../foundation/README.md)). | Designing v0 around a source that emits nothing taxes the two tracks that carry the product. | Founder call; Claude's recommendation is on record. |
| OD-11 | **Neural-footprint storage** — one polymorphic table with `subject_type`, or table-per-track? | Real query-performance and migration consequences at scale. | Dedicated schema session with Postgres best-practices loaded. |
| OD-12 | **Graph of loops** — documentation artifact (Obsidian + Graphify) or executable routing structure (agents dispatch along it)? | Changes L3 (agent harness) substantially; interacts with OD-03. | Founder call after harness bake-off (OD-03). |
| OD-13 | **Wave 0 vs immediate wide parallelism** — lock the department/skill/metric contract first (~1 round), or fan out now? | Parallelism without a fixed interface produces incompatible structures that get rebuilt. Claude argues Wave 0 ([foundation §8](../foundation/README.md)). | Founder call. |
| OD-14 | **Root `SKILLS.md`** — retire, or rewrite? It is a prose reasoning protocol (not a skill) and still says "WineOps AI". | Stale brand + misleading filename; new contributors and agents will mistake it for the skill registry. | Founder call; low stakes, do it with the next docs pass. |

## Resolved (moved to ADRs)

| ID | Resolved as | Date |
|---|---|---|
| — | *(none yet)* | — |

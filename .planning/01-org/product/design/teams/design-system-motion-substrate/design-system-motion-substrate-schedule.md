---
type: schedule
division: product
department: design
team: design-system-motion-substrate
status: provisional
metrics: []
updated: 2026-08-24
links: ["[[design-system-motion-substrate-charter]]", "[[design-system-motion-substrate-loops]]", "[[design-system-motion-substrate-agenda-board]]", "[[design-schedule]]", "[[skills-charter]]", "[[ux-path-burn-down-charter]]", "[[client-surfaces-charter]]", "[[UX_PATHS_CATALOG]]"]
---

# Design System & Motion Substrate — Schedule & Skills

## Recurring work

| Cadence | Job | Emits |
|---|---|---|
| Per PR | **Design lint** — any new component under `apps/web/src/components/` or `packages/ui/src/` must carry a token reference and a story, or an explicit waiver comment | `design.bespoke_components_added` |
| Per PR | **Accessibility gate** — §X `NEW-667…676` (`UX_PATHS_CATALOG.md:1493`) as axe + ESLint: skip links, focus rings, Escape behaviour, SR announcements, reduced-motion, RTL, grid roles | `design.a11y_violations_per_pr` |
| Per PR | Framework-assumption check — reject `next/*` imports and file-system-routing assumptions; `apps/web` is a Vite SPA (`apps/web/package.json:8,55,94`) | Pass/fail |
| Weekly | A11y enforcement progress (`L-DSS-3`) — which of the 10 §X rules are live | `design.a11y_rules_enforced` (**0 of 10** today) |
| Biweekly | Motion convergence (`L-DSS-4`) — winners on 043–046, untraceable shipped animations | `design.motion_specs_with_winner` (**0 of 4**) |
| Monthly | **Token divergence diff** — every value in `apps/web`'s layer not in `apps/mobile/src/design/tokens.ts`, and vice versa, **by name** | `design.token_divergence_values` |
| Monthly | Substrate census (`L-DSS-1`) — composition %, primitives documented, bespoke added | `design.system_composition_pct`, `design.primitive_documented_ratio` |
| Monthly | Primitive-request SLA report to [[ux-path-burn-down-charter]] | `design.primitive_request_response_days` |
| Quarterly | Brand-string sweep — `"WineOps AI"` in token names, Storybook titles, component comments | Occurrence list to [[media-brand-charter]] |
| Quarterly | Staleness sweep — this team's artifacts, 60 days ([[README]] §3.3, §6) | Archive or revision |

**The per-PR jobs are the team's actual product.** Everything else measures whether they
are working. [[design-system-motion-substrate-premortem]] M1 is a sequencing failure, so
the schedule is written sequencing-first: the three per-PR gates exist before the monthly
census has anything worth reporting.

## Skills owned

Skills live in `.claude/skills/`. A skill that has not fired in 30 days is reviewed for
deletion.

**Honest state: `.claude/skills/` does not exist in this repository.** The only project
skill on disk is `.agents/skills/railway-config/SKILL.md` ([[README]] §3.1). This team owns
**zero skills today**. The table is a proposal built to [[README]] §3.3 — trigger,
doneability criteria, and a **real past instance**.

| Proposed skill | Trigger | Doneability criteria | Real past instance |
|---|---|---|---|
| `design-token-census` | Monthly, and on any token edit | Both sources enumerated; divergent values listed by name; count published | **`apps/mobile/src/design/tokens.ts` became a second token source** with no recorded decision |
| `a11y-path-audit` | Per PR + quarterly full sweep | Each §X rule is either enforced in CI or listed as unenforced with an owner | **§X `NEW-667…676`** written in July, enforced nowhere since |
| `primitive-story-scaffold` | A primitive lands with no story | Story exists and renders every documented state | **`packages/ui` — 0 stories** in the package whose consumers are other teams |
| `motion-spec-trace` | Any animation added to `apps/mobile` or `apps/web` | Animation maps to a named motion in 043–046, or is flagged | The 9 specified motions with anti-gimmick clauses and **0 named winners** |
| `bespoke-component-detect` | Per PR | New component flagged if it has no token reference and no story | Nothing counts this today, which is why premortem M4 is currently invisible |

**Nothing in this table exists yet.** Each is tied to a job above so a skill is created
against a close-time rather than a job invented to justify a skill. Registry governance sits
with [[skills-charter]] (Applied AI), not here.

### The one job this team should be judged on first

`a11y-path-audit`. The department declined to create an accessibility team on the argument
that a standard enforced in CI beats a team overruled by every deadline
([[design-charter]], non-goals). That argument is only true if this skill ships. If it does
not, the department has neither a team nor a standard — and it will have talked itself out
of both, which is worse than never having made the argument.

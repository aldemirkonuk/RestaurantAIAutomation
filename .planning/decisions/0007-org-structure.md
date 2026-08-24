# 0007 — Organization: divisions, departments, and an advisory layer

- **Status:** Locked (divisions, departments, advisory composition, unit anatomy)
- **Date:** 2026-08-24
- **Decider:** Aldemir (founder)
- **Keywords:** org, divisions, departments, teams, advisory, red-team, premortem, matrix
- **Links:** [ORG_STRUCTURE.md](../foundation/ORG_STRUCTURE.md), [[0001-mudavym-single-entity]], [[0002-documentation-first-operating-mode]]

## Context

The operating model is "work like a staffed company, not a solo checklist." That
requires an actual org, not a list of concerns. The founder's explicit direction:
optimize for **quality and ambition, not for one person's capacity** — and
"understand structures of companies, their directories and every foundation."

## Options considered

1. **Flat department list** — simplest; twenty peers with no grouping produce a
   dense loop mesh where every unit is one hop from every other.
2. **Divisions over departments** — mirrors how real companies scale spans of
   control, and gives the loop graph readable clusters.
3. **Divisions + departments + a cross-cutting advisory layer** — adds independent
   review functions that sit *outside* the line they review.

## Decision

**Option 3.**

**7 divisions · 19 departments · 2 sub-layers · 75 teams:**

| Division | Departments |
|---|---|
| Platform | Engineering · Data · Reliability/SRE |
| Applied AI | AI Orchestration · Skills |
| Research & Math | *(division of one — insulation, not span)* |
| Intelligence | Security · Analytics & BI |
| Product | Product & Vision *(⊃ Guest Experience)* · Design · Partnerships & Integrations |
| Commercial | Growth *(⊃ Finance & Pricing)* · Sales · Media & Brand |
| Corporate | Legal · Knowledge & Documentation · Compliance & Privacy · People & Agent Ops · Strategy & Fundraising |

**3 advisory functions** (Ethics & Responsible AI was considered and **not** adopted):

| Advisory | Scope |
|---|---|
| **Architecture Review** | Owns the L0–L6 layer-dependency rule. A layer violation is invisible to the department committing it. |
| **Red Team** | **Scoped narrowly by founder direction:** detects and attacks *decisions*, and does premortem thinking. Not a general security-testing function — Security builds defenses in the line. Output must make "what's next" easy to navigate. |
| **Decision Office** | Owns the ADR log, the open-decision queue, and loop close-times. Ensures decisions close rather than drift. |

**Advisory authority: findings-only.** Advisory writes findings into the unit's
`questions.md` and, where a decision is implied, into `OPEN-DECISIONS.md`. Nothing
blocks; the founder arbitrates. This preserves velocity and keeps decision authority
with the founder, consistent with [[0002-documentation-first-operating-mode]]'s
"nothing is decided until decided together."

**Unit anatomy: 7 artifacts** — `charter`, `premortem`, `agenda-full`, `agenda-board`,
`directive`, `loops`, `schedule`. Premortem is artifact #2 deliberately: a unit that
cannot articulate its own failure mode before starting has not been thought through.
**Agendas carry an explicit "provisional — no work done yet" banner** so forecast is
never mistaken for fact.

**Division count resolved 2026-08-24:** Technology returned **25 teams** under 5
departments — by far the widest span — so it was split into **Platform** and
**Applied AI**, taking the org to 6 divisions. Decided on the evidence, as intended.

**Count correction:** earlier drafts of this ADR said "20 departments". The roster
was always 19 (5+3+3+3+5); only the arithmetic was wrong.

## Consequences

- **99 units × 7 artifacts = 693 documents.** Founder confirmed full depth for teams
  after being shown the volume. Real upkeep; the anti-sprawl rules
  (foundation §3.3, §6) apply — an agenda unchanged in 60 days is finished or fiction.
- Advisory independence is structural: an advisor reporting inside the line it
  reviews is not independent, which is why these sit outside the divisions.
- Findings-only carries a known risk: under deadline, findings can be acknowledged
  and deferred indefinitely. The Decision Office's close-time tracking is the
  counter-pressure. Revisit if findings routinely age out unresolved.
- Loops are documented now, executable later, via machine-readable frontmatter
  (ORG_STRUCTURE §5) so they can drive routing without a rewrite.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-08-24 | Claude | Proposed 9 departments; argued for merging Sales into Growth |
| 2026-08-24 | Aldemir | **Overruled** the merge — "do not think about being a solo founder, only focus on the goal… QUALITY and AMBITION" |
| 2026-08-24 | Claude | Proposed division layer + 4 new departments + 4 advisory functions |
| 2026-08-24 | Aldemir | Accepted divisions, all 4 new departments, 3 of 4 advisory (dropped Ethics); scoped Red Team to decisions + premortems |
| 2026-08-24 | Aldemir | Locked findings-only authority and 7-artifact anatomy with provisional agenda banners |
| 2026-08-24 | R&M generator | **Caught a contradiction:** ADR 0001 promised Research & Math "holds its own division" as the compensation for declining the two-company split, while this ADR filed it under Intelligence — the term the argument was won on. |
| 2026-08-24 | Aldemir | **Promoted Research & Math to its own division** (6 → 7). A division of one department, deliberately: the purpose is insulation from shipping priorities, not span of control. |

---
type: moc
title: Software Map
updated: 2026-09-01
links: ["[[SOFTWARE-CONTRACT]]", "[[PAGES-MAP]]", "[[ORG-MAP]]", "[[HOME]]", "[[0052-software-catalog-layer]]", "[[0049-ecosystem-division-layer]]"]
---

# Software Map — the small softwares inside the one entity

> **Mudavym is one entity holding many small softwares** ([ADR 0001](../decisions/0001-mudavym-single-entity.md)).
> This is the catalog of those softwares: what a restaurant actually gets, one note each,
> smallest capability first. It is the **product** layer — distinct from *who builds it*
> ([[ORG-MAP]], 100 teams), *what renders it* ([[PAGES-MAP]], 47 screens), and *how the
> ecosystem is divided* ([ECOSYSTEM-PLAN §3a](../04-specs/ECOSYSTEM-PLAN.md), 8 divisions).

```
division (8, ADR 0049)  →  software (this layer)  →  page (47, PAGES-MAP)  →  component
                                    ↓
                           owner_unit (team, ORG-MAP)
```

Contract: [[SOFTWARE-CONTRACT]] · Decision: [ADR 0052](../decisions/0052-software-catalog-layer.md)

<!-- ROSTER:BEGIN — generated from note frontmatter; regenerate rather than hand-edit -->
<!-- ROSTER:END -->

## Live index (Dataview)

```dataview
TABLE WITHOUT ID
  file.link AS Software,
  division AS Division,
  status AS Status,
  tier AS Tier,
  length(pages) AS Screens,
  owner_unit AS Owner
FROM "08-softwares"
WHERE type = "software"
SORT division ASC, file.name ASC
```

## Gaps

Softwares with no resolvable owning team, and pages whose ownership is contested, are
listed here rather than silently assigned. A row here is a finding, not a formatting
failure — the same convention the agent-stack layer uses.

<!-- GAPS:BEGIN — generated -->
<!-- GAPS:END -->

## How to read a maturity verdict

Rolled up from the page notes' §10 and sharpened at the software level:

- **live** — does what it claims, end to end
- **partial** — works, but a named capability is absent
- **hollow** — renders, but the data or action behind it is fake, mocked, or never persists
- **broken** — a primary path fails today
- **backend-only** — no user surface by design; the note names its consumer
- **planned** — documented, not built

`hollow` is the load-bearing one: a software that looks finished and lies is worse than
one that is obviously unfinished, and this repo has shipped several.

## Rules of this layer

1. **Every page is assigned.** All 47 route notes carry a `softwares:` list; nothing falls
   into an "Unassigned" bucket.
2. **N:M with pages.** `providers` hosts two softwares behind its `?tab=`.
3. **Owners are resolved, never guessed.** Ambiguity becomes a gap row above.
4. **It nests under the divisions**, it does not compete with them.
5. **Links into this layer are path-qualified** — six software slugs share a basename with
   a page note, so write `[[08-softwares/orders|Orders]]` from outside the folder.

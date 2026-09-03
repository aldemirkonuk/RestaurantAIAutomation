---
type: contract
title: Software Contract
status: proposed
updated: 2026-09-01
links: ["[[SOFTWARE-MAP]]", "[[PAGE-CONTRACT]]", "[[ORG-MAP]]", "[[ECOSYSTEM-PLAN]]"]
---

# Software Contract — one document per small software

> Mudavym is one entity holding many small softwares ([ADR 0001](../decisions/0001-mudavym-single-entity.md)).
> The vault already dissects the company three ways — **teams** (`01-org/`, 100 units),
> **screens** (`06-pages/`, 47 route notes), and **divisions** (`04-specs/ECOSYSTEM-PLAN.md` §3a,
> eight, [ADR 0049](../decisions/0049-ecosystem-division-layer.md)). None of them is the
> *product* layer: the thing a user buys, a new hire learns, and an investor is shown.
> This contract fixes that shape.

## What counts as a small software

A small software is a **capability a restaurant would recognise as a product**: "the
order pad", "vendor search", "the analytics screen". Tests, all four must hold:

1. **Nameable by a user** without reference to our code or our org chart.
2. **Has a surface** — one or more screens, or an explicit `backend-only` marker.
3. **Has a spine** — at least one gateway module, agent, or scheduled job behind it.
4. **Could be described to a customer as a thing they get**, on its own.

It is *not* a page (a page can host two softwares behind a `?tab=`), *not* a module
(one software may span five), and *not* a team (a team may run three).

## Where it sits

```
division (8, ADR 0049)  →  software (this layer)  →  page (06-pages)  →  component
                                   ↓
                          owner_unit (01-org team)
```

The division layer is the **parent**; every note names its division so the two layers
are one structure, never two competing taxonomies (CLAUDE.md §4).

## Anatomy — 9 sections

| § | Section | Holds |
|---|---|---|
| 0 | **What it is** | 2–3 sentences a restaurant owner would understand. No jargon, no file paths. This is the section the founder reads |
| 1 | **Features today** | One bullet per capability, **smallest first, building up** — the "from small steps into big" ladder. Rolled up from the page notes' §1a. Broken or dark features are marked `— broken` / `— dark`, never omitted |
| 2 | **Screens** | Its `06-pages` notes as wikilinks, one line each on the role that page plays. A software with no screen writes `backend-only — no user surface` and says who consumes it |
| 3 | **Backend** | Gateway module(s) with `path` and endpoint counts, `file:line` for the controller. Name the seam if the module is shared |
| 4 | **Automation** | Agents, `@Cron` sweeps, agent cards that act for this software — or `none (every action is human-initiated)` |
| 5 | **Data** | Tables it owns, verified against `supabase/`. Never guessed — an unverified table is omitted with a note |
| 6 | **Owner** | Wikilink to the owning `01-org` team charter + its department. If no team owns it, write `unowned — gap` and add the row to [[SOFTWARE-MAP]]'s gap table |
| 7 | **Maturity & seams** | The honest verdict, inherited from the page notes' §10 (`complete`/`partial`/`hollow`/`broken`) rolled up to the software, plus the known structural dirt (god-files, split modules, duplicated logic) |
| 8 | **Where it's going** | 3–5 lines, pointing at agendas, ADRs, ODs, ecosystem phases. Never restate a roadmap that lives elsewhere |

## Frontmatter

```yaml
type: software
slug: global-vendor-search
name: Global Vendor Search
division: vendor          # one of the 8, ADR 0049 — restaurant | customer | vendor | pos |
                          # sommelier | intelligence-analytics | platform-admin | agent-fleet-runtime
status: live | partial | hollow | broken | backend-only | planned
tier: core | plus | pro | public | internal
routes: ["/distributors"]
pages: [distributors]           # 06-pages slugs; [] for backend-only
api_modules: [distributor-discovery]
agents: []
owner_unit: supply-discovery    # 01-org team slug, or "" with an explicit gap row
updated: 2026-09-01
links: []
```

## Rules

- **Evidence or absence.** Every behavioral claim carries `path:line` or is not made.
  "Should work" is not a claim; `status: hollow` is an honest one.
- **N:M with pages is normal.** `providers` hosts two softwares behind `?tab=`; page
  notes therefore carry a `softwares:` **list**, primary first.
- **Nothing falls unassigned.** Every one of the 47 page notes maps to at least one
  software. A page with no natural home gets an explicit thin software, not silence —
  the failure mode this layer exists to avoid.
- **Owners are resolved, never guessed.** Resolve from `01-org` charters; if the
  evidence is ambiguous, write `unowned — gap` and let [[SOFTWARE-MAP]] carry it.
- **No restating.** Link the page note, the charter, the ADR. Detail rots in copies.

Files: `.planning/08-softwares/<slug>.md`. Index: [[SOFTWARE-MAP]] (Dataview over `type: software`).

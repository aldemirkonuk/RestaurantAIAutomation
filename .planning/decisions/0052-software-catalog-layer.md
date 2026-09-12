# 0052 — The product is catalogued as small softwares, one note each

- **Status:** Locked
- **Date:** 2026-09-01
- **Decider:** Aldemir (founder), 2026-09-01, in-session via AskUserQuestion (four forks answered), then "go, build it with the plan defaults"
- **Keywords:** small softwares, product layer, catalog, pages, units, PV-12, divisions, taxonomy, Obsidian, SOFTWARE-MAP
- **Links:** [SOFTWARE-CONTRACT](../08-softwares/SOFTWARE-CONTRACT.md), [[0001-mudavym-single-entity]], [[0049-ecosystem-division-layer]], [[0033-design-map-zoomable-atlas]], [[0032-vault-cleanup-cut-line]], [PAGE-CONTRACT](../06-pages/PAGE-CONTRACT.md)

## Context

The founder asked whether the vault dissects the codebase into "small softwares such as
an order, such as a global vendor search, or such as an order screen, or such as an
analytics screen." Three parallel surveys of `origin/main` established that it dissects
the company three ways, none of them that:

| Layer | What it is | Why it is not the product layer |
|---|---|---|
| `01-org/` — 100 units, 9 artifacts each, ~889 files, ~17,200 wikilinks | teams | an org chart, not a product |
| `06-pages/` — 47 route notes, 14-section contract | screens | a software spans several screens; one screen hosts two softwares |
| ADR 0033 atlas — 980 nodes / 1,151 edges + a curated 9-domain overlay | a generated map | JSON and HTML, not readable notes; carries no org edge; unmatched nodes fall to "Unassigned" |

The two most product-shaped layers were also **unlinked**: zero wikilinks from `06-pages/`
to any charter and zero back, and no `owner:` frontmatter on any page. The only live
commitment to close that was **PV-12** in product-vision's agenda (all 47 routes get an
owning module, due 2026-09-30).

Mid-build, ADR 0049 merged (`b70e62d9`), locking an **eight-division layer** over the
ecosystem. A peer session flagged the collision risk; the catalog was rebased onto it
rather than shipped beside it.

## Options considered

1. **Nine domain notes only** — promote each `atlas-overlay.json` domain to a note.
   Rejected by the founder: "order screen" and "global vendor search" stay buried inside
   "Procurement & Vendors", which is the granularity the question was asking past.
2. **No new layer; let the atlas serve.** Rejected: the atlas is generated JSON with no
   org edge and a silent "Unassigned" bucket — it cannot be read as a product catalog.
3. **Supersede `atlas-overlay.json`** and move its grouping role into the notes.
   Offered as the retire-to-write candidate and **declined by the founder**: the atlas is
   another lane's live work — "do not touch that Atlas overlay."
4. **Pages as softwares** (rename the layer). Rejected: `providers` alone disproves 1:1.
5. **A standalone `.planning/08-softwares/` catalog at ~20-note granularity.** ✅ Chosen.

## Decision

A **software layer** is added at `.planning/08-softwares/`: one note per small software,
against [SOFTWARE-CONTRACT](../08-softwares/SOFTWARE-CONTRACT.md) (9 sections — what it
is, features smallest-first, screens, backend, automation, data, owner, maturity and
seams, where it is going), indexed by `SOFTWARE-MAP`.

- **It nests, it does not compete.** Every note names its `division:` from ADR 0049 §3a,
  so the shape is `division (8) → software (this layer) → page (47) → component`, with
  `owner_unit` pointing sideways into `01-org`.
- **The pages↔units bridge is executed now**, satisfying PV-12 early: all 47 route notes
  gain a `softwares:` list and a `> **Part of** …` line. The line sits *under the H1 and
  outside §0*, because §0 is contracted to be buttons-only and is what the Obsidian graph
  renders as page→page edges.
- **N:M is the rule, not the exception** — `providers` carries
  `[vendor-directory, global-vendor-search]`, primary first.
- **Nothing falls unassigned.** All 47 pages map to a software; the residue
  (`help`, `privacy`, `credits`) gets an explicit thin `app-shell-support` note rather
  than silence — the atlas overlay's "Unassigned" bucket is the failure this avoids.
- **Owners are resolved from charters, never guessed**; an unresolvable one is written
  `unowned — gap` and carried in SOFTWARE-MAP's gap table.
- **`atlas-overlay.json` and `atlas-graph.json` are untouched** (founder-directed).

## Consequences

- **Retire-to-write is waived for this wave, by founder direction.** Offered three
  retirees; the founder chose a standalone additive folder instead. Recorded here so the
  exemption is on the record and not mistaken for an oversight — it stacks with the
  still-unanswered waves-2/3 ratification fork flagged in ADR 0034's corrections.
- Two curated grouping sources now exist (this layer and `atlas-overlay.json`'s nine
  domains). That duplication is **deliberate and bounded**: the overlay stays the atlas
  renderer's input, this layer is the readable product catalog. If they ever disagree
  about what a page belongs to, this ADR is the tie-break: the software note wins for
  *product* questions, the overlay for *atlas rendering*.
- Six software slugs share a basename with a page note (`orders`, `receiving`,
  `notifications`, `calendar`, `promotions`, `recommendations`). Links from pages into
  this layer are therefore **path-qualified** (`[[08-softwares/orders|Orders]]`);
  intra-folder sibling links resolve normally.
- `PAGE-CONTRACT.md` gains the `softwares:` field definition; `PAGES-MAP`, `HOME.md`, and
  `.obsidian/graph.json` gain one entry each. No `OPEN-DECISIONS.md` row is added, so no
  citation re-anchoring is triggered (ADR 0025).
- PV-12 can be closed by citation rather than repeated; product-vision still owns the
  judgement of whether the assignment is right.

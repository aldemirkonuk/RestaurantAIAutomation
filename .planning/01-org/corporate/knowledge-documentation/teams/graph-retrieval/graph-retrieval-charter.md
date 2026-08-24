---
type: charter
division: corporate
department: knowledge-documentation
team: graph-retrieval
status: partial
metrics: [graph.frontmatter_coverage_pct, graph.link_resolution_rate, graph.linked_file_ratio, graph.ambiguous_basename_count, graph.dataview_executable]
updated: 2026-08-24
links: ["[[graph-retrieval-premortem]]", "[[graph-retrieval-agenda-full]]", "[[graph-retrieval-agenda-board]]", "[[graph-retrieval-directive]]", "[[graph-retrieval-loops]]", "[[graph-retrieval-schedule]]", "[[knowledge-documentation-charter]]", "[[corpus-archive-charter]]", "[[standards-verification-charter]]", "[[OBSIDIAN_VAULT]]", "[[ORG_STRUCTURE]]"]
---

# Graph & Retrieval — Charter

Parent: [[knowledge-documentation-charter]] (Corporate). Siblings:
[[corpus-archive-charter]], [[standards-verification-charter]].

## Mandate

Graph & Retrieval is accountable for **whether a document can be found** — by a human
browsing, by Obsidian's graph, or by an agent grepping. It owns the Obsidian backlink
layer adopted in [ADR 0004](../../../../decisions/0004-obsidian-as-backlink-layer.md), the
vault mechanics settled in [[OBSIDIAN_VAULT]] (OD-21, superseding the narrower OD-08),
Dataview and Graphify, and the **machine-readable frontmatter contract** that
[[ORG_STRUCTURE]] §5 mandates on every unit document.

That contract is not cosmetic. OD-12 resolved the loop graph as *"documented now,
executable later"*, and the only thing making "later" possible without a rewrite is that
every loop carries `measures`, `changes`, `inputs_from`, `outputs_to`, and `close_time` as
parseable YAML today. This team owns whether that is true of 693 documents or of four.

## Why distinct from its siblings

[[corpus-archive-charter]]'s work is a **founder call about shape** (OD-01) followed by a
finite cleanup. This team's work is a **tooling call** plus a *continuous* enforcement duty
on every document written thereafter — different close-times, different done-states.

Against [[standards-verification-charter]]: a document can be perfectly linked, perfectly
tagged, instantly findable, and wrong. `md/DOCUMENTATION_INDEX.md` is findable. It is also
7 months stale with every category count incorrect. This team would rate it green.

## Boundaries

Owns outright:

- **The `.obsidian/` vault configuration** — plugins, Dataview, Templater, Graphify;
  committed so the vault is reproducible ([[OBSIDIAN_VAULT]] §1).
- **The frontmatter contract** — required keys, allowed values, and the lint that enforces
  them.
- **Link integrity** — `[[wikilink]]` resolution, and specifically **ambiguity**, which is
  the failure mode this vault is already exposed to.
- **Filename uniqueness as a link constraint** — [[OBSIDIAN_VAULT]] §3 calls it *"the
  single most important convention here."*
- **The `00-index/` Map-of-Content layer** — `HOME.md`, `ORG-MAP.md`, `LOOP-MAP.md`,
  `DECISION-INDEX.md` — built as Dataview queries, never as hand-maintained lists.
- **Retrieval for agents** — grep-ability, the practical form of findability in this repo,
  where an agent is a more frequent reader than a human.

## Explicit non-goals

| Not ours | Whose it is | The line |
|---|---|---|
| Which directory a document belongs in | [[corpus-archive-charter]] | They own the path; we own resolution regardless of path |
| Whether the document's content is true | [[standards-verification-charter]] | A resolvable link to a stale doc is our success and their failure |
| The content of the frontmatter *values* | The authoring unit | We enforce that `status` exists and parses; we do not judge whether `exists` was the honest grade |
| Graph *semantics* — what a loop means | [[decision-office-charter]] *(advisory)* | We make loops queryable; they own whether loops close |
| Vector search / RAG over the corpus | [[research-and-math-charter]] *(Intelligence)* | Retrieval here means links and queries, not embeddings. If that changes it is an ADR, not a scope creep |

## Metrics it moves

**`graph.dataview_executable`** — boolean. **Currently `false`.** It leads the list because
every other metric here is unmeasurable while it is false, and because it is the cheapest
fix in the department.

- **`graph.frontmatter_coverage_pct`** — **4 of 45** spine docs ≈ **8.9%**. The four are
  `STATE.md`, `v1.0-MILESTONE-AUDIT.md`, `v2.0-MILESTONE-AUDIT.md`, `v3.0-TECH-DEBT.md`.
- **`graph.link_resolution_rate`** — % of `[[links]]` resolving to exactly one file.
  Unmeasurable today.
- **`graph.linked_file_ratio`** — **40 of 1,118** ≈ 3.6%, up from 10 of 1,082 ≈ 0.9% at
  the founding count. **The entire increase is the org generation writing its own links;
  zero legacy documents gained one.** Reported this way on purpose — a rising numerator
  that comes only from new documents is not progress on the old corpus.
- **`graph.ambiguous_basename_count`** — **≥ 45**, from `README.md` alone.

## Evidence today

**PARTIAL — adopted and specified, not installed.**

**LOCKED / decided:** [ADR 0004](../../../../decisions/0004-obsidian-as-backlink-layer.md)
locks Obsidian adoption. [[OBSIDIAN_VAULT]] resolves vault root (`.planning/`), corpus
disposition, folder-per-team, and Dataview adoption; `scripts/build_vault_scaffold.py`
built 99 unit directories, 7 templates, and `00-index/UNIT-MANIFEST.json`.

**The three gaps, in order of consequence:**

1. **No `.obsidian/` directory exists anywhere in the repo.** [[OBSIDIAN_VAULT]]:20
   promises it is committed so the vault is reproducible. It is not there. **Consequence:
   Dataview — named at [[OBSIDIAN_VAULT]] §4 as *"the anti-sprawl mechanism in
   practice"* — executes nowhere, so all 99 `agenda-board.md` files in the org are dead
   queries.** This is the single highest-leverage unfixed item in the department, and it is
   probably an afternoon of work.

2. **The filename-uniqueness convention was violated before it was written.** [[OBSIDIAN_VAULT]]
   §3 calls unique filenames *"the single most important convention here."* The vault root
   contains **45 files named `README.md`**. A `[[README]]` link is therefore already
   ambiguous — and already written: `engineering-charter.md:106` uses `[[README]] §0`,
   intending [[foundation-README]], with 45 candidates in scope. The
   `md/09-communication/README.md` ↔ `md_files/01-getting-started/README.md` pair
   [[corpus-archive-charter]] found is the same defect surfacing in the legacy trees.

3. **The frontmatter mandate is not honoured by the documents that issue it.**
   `ORG_STRUCTURE.md` mandates `type`, `division`, `links` on every unit doc at §5 — and
   carries no frontmatter. `OBSIDIAN_VAULT.md` *defines the frontmatter schema* at §3 —
   and carries none either. Denominator note: the founding count was 4 of 41; it is now
   4 of 45. The numerator has not moved while the corpus grew.

⚠️ **A register contradiction inside this team's own scope.** [[OBSIDIAN_VAULT]]:3 states
*"**LOCKED** 2026-08-24 (OD-21)"*, while `OPEN-DECISIONS.md` still lists **OD-21 and OD-08
in the Open table**. Per [`CLAUDE.md`](../../../../../CLAUDE.md) §0.1 — *nothing is decided
until it is written in `.planning/decisions/`* — the register wins and [[OBSIDIAN_VAULT]]
is overclaiming. This team proceeds on the vault layout because it is the only specification
available, and records that it is doing so against an open decision rather than a closed
one. Raised to [[decision-office-charter]].

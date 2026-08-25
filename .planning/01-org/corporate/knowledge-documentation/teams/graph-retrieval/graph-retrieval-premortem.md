---
type: premortem
division: corporate
department: knowledge-documentation
team: graph-retrieval
status: provisional
metrics: [graph.dataview_executable, graph.frontmatter_coverage_pct, graph.link_resolution_rate, graph.ambiguous_basename_count]
updated: 2026-08-24
links: ["[[graph-retrieval-charter]]", "[[graph-retrieval-loops]]", "[[graph-retrieval-directive]]", "[[knowledge-documentation-premortem]]", "[[corpus-archive-charter]]", "[[OBSIDIAN_VAULT]]"]
---

# Graph & Retrieval — Premortem

> Written at founding, before success is assumed.

It is **2027-08-24**. Obsidian is a decision nobody uses, and people find documents by
`grep` — which is what they did before any of this. Here is how, most likely first.

---

## M1 — The tool was never installed, so no work here was ever observable

**What happened.** `.obsidian/` was never committed. Frontmatter got backfilled across a
few dozen documents and then stopped, because backfilling produced no visible change: the
board agendas that were supposed to consume it rendered as fenced code blocks. Dataview —
[[OBSIDIAN_VAULT]] §4's *"anti-sprawl mechanism in practice"* — never executed. Staleness
was therefore never detected by machine, only by someone noticing, which is the mechanism
that was already failing. `md/DOCUMENTATION_INDEX.md` passed **19 months** wrong.

**Earliest observable signal.** Already lit, today: `ls -d .obsidian` fails, and every
`agenda-board.md` in `01-org/` contains dataview fences that nothing runs. The risk is not
that the signal appears — it is that a red light present from day one gets read as
background.

**What would have prevented it.** Making `.obsidian/` + Dataview this team's **first**
deliverable, ahead of any backfill. And the fallback in [[graph-retrieval-schedule]]: a
plain Python script computing the same numbers and writing them into the board files, so
the metric survives independently of whether anyone opens Obsidian. A metric that only
exists inside one desktop application is a metric with a single point of failure, and that
point is a human's habit.

---

## M2 — Links were backfilled onto a corpus that then moved

**What happened.** This team ran a link campaign before [[corpus-archive-charter]] executed
OD-01. Thousands of `[[links]]` and relative paths were written against the old tree. The
restructure moved everything. Wikilinks mostly survived — Obsidian resolves by name — but
the corpus is **~96% relative-path links**, and those all broke at once. The graph filled
with unresolved references, the convention was quietly abandoned, and Obsidian became a
decision nobody used, exactly as `corporate.md:187-190` predicted.

**Earliest observable signal.** `graph.linked_file_ratio` rising quickly while OD-01
remains open in `OPEN-DECISIONS.md`. Speed is the tell: a fast-rising link count before the
tree is settled means links are being written against paths with a known expiry.

**What would have prevented it.** The ordering rule in [[graph-retrieval-directive]]: while
OD-01 is open, **new documents link freely** (they are being written anyway and wikilinks
survive moves), but **no bulk backfill of the legacy corpus** happens. The 1,082 legacy
documents wait for their tree to stop moving. This is why `graph.linked_file_ratio` is
reported split — new-corpus vs legacy-corpus — rather than as one number that would reward
exactly the wrong activity.

---

## M3 — The graph resolved, to the wrong documents

**What happened.** Frontmatter hit 100%, links resolved, the graph view looked
magnificent. But 45 files were named `README.md`, dozens named `index.md`, and Obsidian
resolves ambiguous names by picking one. `[[README]]` in a charter pointed at
`.planning/sketches/031-inventory-cellar-integration/README.md`. Because a mis-resolved
link and a correct one are visually identical in rendered prose, nobody noticed for a year.
Trust in the graph fell below trust in `grep`, and the graph was abandoned — not because it
was empty, but because it was wrong in a way that took a year to see.

**Earliest observable signal.** It exists **now**: `engineering-charter.md:106` writes
`[[README]] §0` with 45 candidate targets in the vault root. Ambiguity is measurable before
any backfill, and `graph.ambiguous_basename_count` is on the board for that reason.

**What would have prevented it.** **Ambiguity check before backfill.** A link-lint that
treats *unresolved* as a warning (expected and fine — [ADR 0004](../../../../decisions/0004-obsidian-as-backlink-layer.md)
says an unresolved link marks a doc worth writing) and *ambiguous* as an **error**. That
asymmetry is the whole design: this vault's convention explicitly tolerates dangling links
and explicitly cannot tolerate ambiguous ones, and a lint that treats them alike would be
tuned to the wrong risk.

---

## M4 — The frontmatter contract became a tax nobody paid

**What happened.** The lint shipped and immediately failed on ~95% of the corpus. Rather
than backfill 1,000 documents, someone scoped the lint to "new files only." New files
complied; the spine never did. `ORG_STRUCTURE.md` — the document that mandates frontmatter —
still carried none in 2027, because it was not new. Every Dataview query over the corpus
returned the subset written after August 2026, which looked like a healthy corpus and was
in fact a 3% sample presented without a denominator.

**Earliest observable signal.** A lint configuration containing a path exclusion or a
date cutoff. That is a code review artifact, visible the day it is proposed.

**What would have prevented it.** Scoping by **importance, not by date**: the contract is
mandatory on the **45 spine documents** and on all `01-org/` + `02-advisory/` units, and
optional on archive and sketches. That is a defensible line that shrinks with effort. "New
files only" is a line that never shrinks, and it exempts precisely the documents that
matter most — the ones that already exist and are already being read.

---

## M5 — Nobody used it, because agents don't open Obsidian

**What happened.** The vault became genuinely good. Backlinks worked, Graphify rendered
the loop graph, the MOCs were live. And the primary reader of this corpus is an **agent**
with `Grep` and `Read`, which sees `[[graph-retrieval-charter]]` as literal text and
`dataview` blocks as unparsed code. All the retrieval value accrued to the one human who
opens the desktop app, and none to the twenty sessions a week that actually consume the
corpus.

**Earliest observable signal.** Any retrieval improvement whose benefit cannot be stated in
terms of a `grep` result. If the answer to "how does this help a session at minute three?"
is "open Obsidian," the work is aimed at the smaller audience.

**What would have prevented it.** The **dual-audience rule** in
[[graph-retrieval-directive]]: every retrieval mechanism must have an agent-readable form.
Frontmatter is greppable YAML. Wikilinks are greppable text. Dataview queries are not — so
their outputs get materialised into the board files by a scheduled job, not left to render
in a GUI. This is also the reason unique filenames matter twice over: they make
`[[links]]` unambiguous for Obsidian *and* make `grep -rl "graph-retrieval-charter"` return
exactly one thing.

---

## Signal summary

| # | Mechanism | Earliest signal | Counter-pressure |
|---|---|---|---|
| M1 | Tool never installed | **already lit** — no `.obsidian/` | `.obsidian/` first; script fallback for the numbers |
| M2 | Links backfilled onto a moving corpus | link ratio rising while OD-01 open | No legacy backfill until OD-01 closes |
| M3 | Graph resolves to wrong docs | `[[README]]` at `engineering-charter.md:106` | Ambiguous = error, unresolved = warning |
| M4 | Contract scoped to new files only | a date cutoff in the lint config | Scope by importance: 45 spine docs + all units |
| M5 | Built for the smaller audience | benefit unstatable as a grep result | Dual-audience rule; materialise query output |

---
type: charter
division: corporate
department: knowledge-documentation
status: partial
metrics: [corpus.duplicate_basename_count, corpus.ambiguous_duplicate_count, graph.frontmatter_coverage_pct, graph.link_resolution_rate, standards.stale_claim_rate, kd.docs_added_vs_retired_ratio]
updated: 2026-08-24
links: ["[[knowledge-documentation-premortem]]", "[[knowledge-documentation-agenda-full]]", "[[knowledge-documentation-agenda-board]]", "[[knowledge-documentation-directive]]", "[[knowledge-documentation-loops]]", "[[knowledge-documentation-schedule]]", "[[corpus-archive-charter]]", "[[graph-retrieval-charter]]", "[[standards-verification-charter]]", "[[ORG_STRUCTURE]]", "[[OBSIDIAN_VAULT]]", "[[corporate]]", "[[decision-office-charter]]"]
---

# Knowledge & Documentation — Charter

Parent division: **Corporate** ([[ORG_STRUCTURE]] §2). Siblings in-division: Legal,
Compliance & Privacy, People & Agent Ops, Strategy & Fundraising.

## The unusual thing about this department, stated first

**This department's subject matter is this chapter.** Every artifact the org generation
produced — including the 28 files of this department — lands in the corpus this department
is chartered to keep small, findable, and true. There is no outside auditor for it.

That has two consequences the charter accepts rather than hides:

1. **It is its own first defect.** [[ORG_STRUCTURE]] §5 mandates that *"every unit doc
   carries `type`, `division`, and `links`"* — and `ORG_STRUCTURE.md` carries no
   frontmatter at all. Neither does `OBSIDIAN_VAULT.md`, which *defines the frontmatter
   schema* ([[OBSIDIAN_VAULT]] §3). Two standard-setting documents, zero compliance
   between them. That is [[standards-verification-charter]]'s founding example and it was
   not found in someone else's work.
2. **It adds to what it must shrink.** This department is +28 documents in a corpus of
   1,118 `.md` under `.planning/`, and 21 of those 28 are provisional agendas that
   [[ORG_STRUCTURE]] §4's own rule (*"an agenda that has not changed in 60 days is either
   finished or fiction"*) will mark as fiction on **2026-10-23** unless work happens
   against them. The department metric `kd.docs_added_vs_retired_ratio` exists to keep
   that visible rather than convenient.

## Mandate

Knowledge & Documentation is accountable for the corpus being **findable, placed, and
true** — the three properties that decide whether an agent reading `.planning/` acts
correctly. It owns where a document lives, whether the link graph resolves, and whether a
sentence in a spine document still matches the source it describes. It does not own the
truth of the underlying system — it owns the *fidelity of the record about it*, and the
mechanism that catches the record drifting.

This is load-bearing rather than administrative because of
[ADR 0002](../../decisions/0002-documentation-first-operating-mode.md): this repo operates
documentation-first. Agents read these files and act on them. A stale claim here is not
untidy — it is an instruction.

## Boundaries — three teams, three independent failures

The department is three teams because the corpus is failing in three ways at once and
fixing any one leaves the other two exactly where they were.

| Team | Question it answers | The failure it owns | v0 baseline |
|---|---|---|---|
| [[corpus-archive-charter]] | **Where does it live?** | Duplicated, unplaced, unreachable | 38 duplicated basenames, 3 diverged |
| [[graph-retrieval-charter]] | **Can it be found?** | Unlinked, un-tagged, un-queryable | 4/45 spine docs with frontmatter; no `.obsidian/` |
| [[standards-verification-charter]] | **Is it still true?** | Authoritative in tone, stale in fact | 3 mutually inconsistent insight counts |

The independence is demonstrable, not asserted. `md/DOCUMENTATION_INDEX.md` is **correctly
placed** (top of the tree it indexes) and **would be reachable** from any link graph — and
it is **wrong**: it claims `04-updates-builds` holds 6 files; that directory holds **48**.
Neither of the first two teams' metrics can see that. Conversely, the 45 files named
`README.md` inside the vault root break `[[README]]` resolution without any of them being
stale or misplaced.

Owns outright:

- **`.planning/`** — 1,118 `.md`, of which 28 are top-level (~1.2 MB), and the OD-01
  restructure of all of it.
- **`md/` (113 `.md`) and `md_files/` (42 `.md`)** — the legacy and partially-duplicated
  trees, including the untracked residue gitignored at `.gitignore:92`.
- **The Obsidian vault layer** — [ADR 0004](../../decisions/0004-obsidian-as-backlink-layer.md),
  [[OBSIDIAN_VAULT]], the frontmatter contract, and the Dataview queries every
  `agenda-board.md` in the org depends on.
- **The regeneration discipline** for companion docs [[README|foundation-README]] declares
  *"regenerated rather than hand-edited"* — `ENDPOINTS.md`, `PAGE_MAP.md`,
  `EXTERNAL_CONNECTIONS.md`.
- **OD-22's tooling & reference library** — the founder asked for a dedicated session; it
  is scoped in [[knowledge-documentation-schedule]] and placed by
  [[corpus-archive-charter]].
- **OD-14's root `SKILLS.md`** — retire or rewrite.

## Explicit non-goals

| Not ours | Whose it is | The line |
|---|---|---|
| Whether a decision is *right* | [[decision-office-charter]] *(advisory)* | Decision Office owns the ADR log and whether decisions close; we own whether the written record of them is accurate and findable |
| Fixing the code a stale doc describes | The owning department | We raise the discrepancy against a named unit; we do not patch their source to match our doc |
| Brand migration in code (`wineops.ai` × 10 in source) | [[media-brand-charter]] *(Commercial)* | We own stale brand in **documents**; they own it in **product surfaces** |
| The skill registry itself | [[skills-charter]] *(Applied AI)* | We index and audit documentation about skills; Applied AI governs what a skill is |
| Writing the docs | Every department | We set the bar, run the checks, and place the output — we are not the authors of the corpus |
| Agent-readable *runtime* memory | [[research-math-charter]] *(Intelligence)* | NF-A is a metric spine, not a document corpus |

**The independence question, raised honestly.** `corporate.md:512-515` notes that
[[standards-verification-charter]] reviews documents it does not write, which is the same
independence argument [[ORG_STRUCTURE]] §3 makes for the advisory layer — and asks whether
2.3 should sit under [[decision-office-charter]] instead. This charter does **not** resolve
that; it is raised as **CORP-F6** in [[knowledge-documentation-agenda-full]]. The argument
against moving it: standards work is 90% mechanical checks over a corpus this department
already owns, and splitting the mechanism from the corpus makes both weaker. The argument
for: a team inside the department cannot credibly grade its own department's 28 documents.
Both are real; the founder decides.

## Metrics it moves

Three team numbers, never summed — a duplicate and a stale claim are not commensurable —
plus one department number nobody else can own.

- `corpus.duplicate_basename_count` — **38**, of which `corpus.ambiguous_duplicate_count`
  = **3**. The only metric in this department with a real, reachable zero.
- `graph.frontmatter_coverage_pct` — **4 of 45** spine docs ≈ **8.9%**.
  `graph.link_resolution_rate` — unmeasurable today; no `.obsidian/` exists to resolve
  against.
- `standards.stale_claim_rate` — **unmeasured**. Building the measurement is the first
  deliverable, not an excuse for not having it.
- `kd.docs_added_vs_retired_ratio` — documents created ÷ documents archived or deleted per
  month. Currently **∞** (28 added, 0 retired). This is the department's honesty metric:
  if it never falls below 1, the department is producing the problem it was founded to
  solve.

Neural-footprint tie is deliberately weak. This department consumes `nf_a.*` only insofar
as agent sessions read the corpus; it emits nothing to the spine. Claiming otherwise would
be the exact defect [[standards-verification-charter]] exists to catch.

## Evidence today

**PARTIAL — the largest existing mass in the division, and the clearest live problem.**

**EXISTS.** 1,118 `.md` under `.planning/` (28 top-level, ~1.2 MB); `md/` at 113 `.md`;
`md_files/` at 42 `.md`; `md/DOCUMENTATION_INDEX.md` (an index, already written,
last modified **2026-01-29**). Dataview and the vault layout are **decided** —
[[OBSIDIAN_VAULT]] §5 resolves vault root, corpus disposition, folder-per-team, and
Dataview adoption; `scripts/build_vault_scaffold.py` built 99 unit directories.

**PARTIAL.** [ADR 0004](../../decisions/0004-obsidian-as-backlink-layer.md) locks Obsidian
adoption — but **no `.obsidian/` directory exists anywhere in the repo**, so the plugin
layer is a decision and not a tool. [[OBSIDIAN_VAULT]]:20 promises `.obsidian/` *is
committed so the vault is reproducible*; it is not there. **Consequence: every
`agenda-board.md` in the org — 99 of them, including this department's four — is a dead
query.** Dataview is named as *"the anti-sprawl mechanism in practice"* ([[OBSIDIAN_VAULT]]
§4) and it currently executes nowhere.

**NEW.** No frontmatter enforcement, no staleness detection, no archive policy, no
stale-claim measurement, no `.claude/skills/` directory (the only project skill lives at
`.agents/skills/railway-config/`, while 99 `schedule.md` files assert skills live in
`.claude/skills/`).

**Open forks touching this department:** OD-01 (`OPEN-DECISIONS.md:77`) — now the only one
still open. OD-08 (folded into OD-21), OD-14 (root `SKILLS.md`), OD-21 (vault workflow) and
OD-22 (tooling library) have all since been resolved.

⚠️ **A register contradiction this department found in its own foundation — since closed.**
[[OBSIDIAN_VAULT]]:3 states *"**LOCKED** 2026-08-24 (OD-21)"*, while
`OPEN-DECISIONS.md` at the time still listed **OD-21 and OD-08 in the Open table**. A
document claimed a decision was closed; the register that is canonical for decisions said
it was open. The register has since moved both into Resolved — OD-21 (`OPEN-DECISIONS.md:142`)
locked the Obsidian structure, and OD-08 (`OPEN-DECISIONS.md:141`) was folded into it — so
the document was right and the register was behind. Per
[`CLAUDE.md`](../../../CLAUDE.md) §0.1 the register is still what decides; it now agrees.
Raised to [[decision-office-charter]]; tracked as the first entry in
[[standards-verification-loops]] L-SV-1, and closable there.

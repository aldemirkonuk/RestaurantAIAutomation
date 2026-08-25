# Obsidian Vault Structure — PROPOSAL (OD-21)

- **Status:** **LOCKED** 2026-08-24 (OD-21). Vault root `.planning/`; existing corpus left in place
  for now with **clean-slate as the stated end goal** (OD-01 executes it); Dataview adopted;
  unique prefixed filenames. Scaffold built by `scripts/build_vault_scaffold.py`.
- **Keywords:** obsidian, vault, hierarchy, graphify, templates, moc, backlinks
- **Links:** [ORG_STRUCTURE](ORG_STRUCTURE.md), [decisions](../decisions/README.md), OD-01, OD-21, OD-22

---

## 1. Vault root

**Proposed: `.planning/` is the vault.** Open Obsidian directly on it.

Why not repo root: the vault would index `node_modules`, `apps/`, `datasets/` — tens
of thousands of files, an unusable graph. Why not a separate `vault/` directory: it
would fork the corpus in two, and the whole point of [ADR 0004](../decisions/0004-obsidian-as-backlink-layer.md)
is that the repo *is* the source of truth and Obsidian is a lens over it.

`.obsidian/` config is committed so the vault is reproducible; workspace-local state
(`workspace.json`, `cache`) is gitignored.

---

## 2. Directory layout

```
.planning/                       ← vault root
├─ _templates/                   ← Templater / core Templates plugin
│   department.md  team.md  advisory.md  loop.md  adr.md  premortem.md
├─ 00-index/
│   HOME.md                      ← vault entry point
│   ORG-MAP.md                   ← division → department → team Map of Content
│   LOOP-MAP.md                  ← every loop, its close-time, its owner
│   DECISION-INDEX.md            ← mirrors decisions/README.md
├─ 01-org/
│   platform/          _division.md + engineering/ data/ reliability/
│   applied-ai/        _division.md + ai-orchestration/ skills/
│   intelligence/      _division.md + research-and-math/ security/ analytics-bi/
│   product/           _division.md + product-and-vision/ design/ partnerships/
│   commercial/        _division.md + growth/ sales/ media-and-brand/
│   corporate/         _division.md + legal/ knowledge-and-docs/ compliance/ people-and-agent-ops/ strategy/
├─ 02-advisory/        architecture-review/ red-team/ decision-office/
├─ decisions/          ← unchanged, already correct
├─ foundation/         ← unchanged
└─ (existing corpus)   ← untouched; OD-01 handles it separately
```

Each **department** folder:

```
engineering/
  charter.md  premortem.md  agenda-full.md  agenda-board.md
  directive.md  loops.md  schedule.md
  teams/
    identity-correctness/   ← same 7 files
    stock-truth/            ← same 7 files
    ...
```

Depth is 5 levels at the deepest (`01-org/platform/engineering/teams/x/charter.md`).
That is the cost of 7-artifacts-per-team; Obsidian handles it, and the MOC notes in
`00-index/` are what people actually navigate by.

---

## 3. Folders vs tags

**Both, with different jobs.** Folders give a browsable tree and unambiguous paths.
Frontmatter gives the graph its clustering:

```yaml
---
type: team | department | division | advisory | loop | adr
division: platform
department: engineering
team: identity-correctness
status: exists | partial | new | provisional
metrics: [nf_a.task_success_rate]
links: ["[[engineering-charter]]"]
---
```

Graphify and Obsidian's graph view cluster on `type` + `division`, so the picture
reads as six clusters rather than 700 equal dots. Folder moves never break links —
Obsidian resolves `[[wikilinks]]` by name, not path.

**Filename rule:** unique across the vault (`engineering-charter.md`, not
`charter.md` × 98). Obsidian's default link resolution is name-based, and 98 files
called `charter.md` would make every `[[charter]]` ambiguous. This is the single
most important convention here.

---

## 4. Plugins

| Plugin | Why |
|---|---|
| **Templater** (or core Templates) | The 7-artifact set must be one command, not hand-copied |
| **Dataview** | `agenda-board.md` and the MOCs become *queries* over frontmatter rather than hand-maintained lists — this is what stops the board agendas going stale |
| **Graphify** | The decision/loop graph you asked for (vision §12G) |
| Git | Already covered by the repo |

Dataview is the anti-sprawl mechanism in practice: a board agenda that queries
`status` and `updated` cannot silently drift from reality the way a hand-written
bullet list does.

---

## 5. Resolved

| Fork | Decision |
|---|---|
| F1 Vault root | `.planning/` |
| F2 Existing corpus | Left in place **now**; clean slate is the end goal — OD-01 carries it out as its own session |
| F3 Team folders | Folder-per-team (required by 7 artifacts) |
| F4 Dataview | **Adopted** — board agendas become live queries, the real anti-sprawl enforcement |

## 6. Built

`scripts/build_vault_scaffold.py` created **99 unit directories** and 7 templates in
`_templates/`, plus `00-index/UNIT-MANIFEST.json` — the assignment list the generator
agents consume so every unit lands at a known path with known filenames.

**99 units × 7 artifacts = 693 documents.**

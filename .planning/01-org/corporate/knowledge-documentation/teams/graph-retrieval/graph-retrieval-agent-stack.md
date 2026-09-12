---
type: agent-stack
division: corporate
department: knowledge-documentation
team: graph-retrieval
status: designed
updated: 2026-08-27
metrics: [graph.frontmatter_coverage_pct, graph.link_resolution_rate, graph.linked_file_ratio, graph.ambiguous_basename_count, graph.dataview_executable]
links: ["[[graph-retrieval-charter]]", "[[graph-retrieval-schedule]]", "[[graph-retrieval-loops]]", "[[graph-retrieval-directive]]", "[[0034-agent-stack-artifact]]", "[[0004-obsidian-as-backlink-layer]]", "[[knowledge-documentation-agent-stack]]", "[[corpus-archive-charter]]"]
---

# Graph & Retrieval — Agent Stack

> **DESIGNED — nothing here is built unless its Evidence line says EXISTS.**
> This team's card has one non-negotiable shape constraint, taken from its own schedule:
> **every number must come out of the CLI with no Obsidian required.** A metric that
> depends on a human opening a desktop application is [[graph-retrieval-premortem]] M1
> with extra steps, so the agent reads the vault as files and treats the plugin layer as
> a rendering target, never as its data source.

## 1. Roster

| Agent | Job in one sentence | Evidence |
|---|---|---|
| `graph-warden` | Emit every `graph.*` value from the file tree daily, fail any ambiguous `[[link]]` with all candidates named, and keep `00-index/` a set of queries rather than a hand-maintained list | NEW |

## 2. Agent cards

```yaml
agent: graph-warden
unit: graph-retrieval
triggers:
  - schedule: "daily — graph metrics + query materialisation"   # mirrored in [[graph-retrieval-schedule]]
  - schedule: "weekly — frontmatter coverage, link ambiguity (L-GR-1, L-GR-2)"
  - schedule: "monthly — 00-index MOC refresh (L-GR-3)"
  - topic: vault.link_added                                     # publisher: NONE (gap — no per-PR link lint exists; the register guard at .github/workflows/ci.yml:170 checks id+line pairs, not wikilinks)
consumes:
  - "`.planning/**/*.md` frontmatter and `[[wikilink]]` bodies — the whole vault as files"
  - "`.planning/00-index/UNIT-MANIFEST.json` and `loops.json` — the unit and loop denominators"
  - "`.planning/.obsidian/plugins/` — committed plugin set, read to confirm `graph.dataview_executable`, never to obtain a number"
  - "placement and rename decisions from [[corpus-archive-charter]] (they own the path)"
emits:
  - "all `graph.*` to [[graph-retrieval-agenda-board]] and the department rollup ([[knowledge-documentation-agent-stack|kd-ledger]])"
  - "materialised query text inside the board files, so a headless reader sees values"
  - "rename requests → [[corpus-archive-charter]] (L-GR-2 outputs_to corpus-archive)"
  - "`00-index/` MOC refresh PRs — any MOC found to be a hand-written list is a finding"
routing_class: mechanical      # parse frontmatter, resolve links, count — the charter forbids judging whether a frontmatter value was honest
quality_bar: "zero false positives against the spine docs already compliant; an ambiguous link fails with every candidate path printed; every value reproducible from the CLI with no Obsidian running ([[graph-retrieval-schedule]]). NONE (gap) for a formal verdict basis — this department emits nothing to the NF-A spine"
autonomy:
  read: autonomous
  propose: autonomous          # lint findings, materialisations, and MOC refreshes land as PRs
  mutate_stock_money_outbound: confirm   # constant
memory: graph-retrieval
escalates_to: "[[knowledge-documentation-charter]]"   # graph *semantics* — whether a loop actually closes — go to [[decision-office-charter]], not here
```

**The card's own hard rule:** `graph-warden` may not rename a file to resolve an ambiguity,
and may not edit a frontmatter *value* to raise coverage. It enforces that `status` exists
and parses; whether `exists` was the honest grade belongs to the authoring unit
([[graph-retrieval-charter]] §Non-goals), and the path belongs to [[corpus-archive-charter]].
An agent that fixes its own denominator is measuring nothing.

## 3. Skills

| Skill (`.claude/skills/…`) | Tier | Trigger | Doneability | Past instance | Status |
|---|---|---|---|---|---|
| `frontmatter-lint` | T2 | Any PR touching an in-scope `.md` | Exits non-zero listing each missing key by file; zero false positives on the already-compliant spine docs | `ORG_STRUCTURE.md` mandates `type`, `division`, `links` on every unit doc at §5 and carries no frontmatter at all; `OBSIDIAN_VAULT.md` defines the schema at §3 and carries none either (`graph-retrieval-charter.md:111-114`) — a rule with no gate | NEW |
| `link-lint` | T2 | Any PR adding or editing a `[[link]]` | Ambiguous links fail with all candidate paths printed; unresolved links warn and are listed as docs worth writing (ADR 0004 expects them) | `engineering-charter.md:106` writes `[[README]] §0` intending the foundation README — measured 2026-08-27, the vault holds **46** files named `README.md` | NEW |
| `graph-metrics` | T2 | Daily | Emits every `graph.*` from the CLI with no Obsidian required; splits `linked_file_ratio` into new-vs-legacy so a rising numerator from new docs cannot read as progress on the old corpus | Every number on the board is hand-entered from a one-off pass (`graph-retrieval-schedule.md:48`), and the charter's own denominator has already moved — it reports 40 of 1,118; `.planning/` holds 1,090 `.md` today | NEW |
| `moc-rebuild` | T2 | Monthly, and after any unit is added | Every `00-index/` file is a query; a hand-written list in one fails the check | `md/DOCUMENTATION_INDEX.md` was the worked example of a hand-maintained index going 7 months stale, wrong in every category row (`graph-retrieval-charter.md:38-40`); it has since been deleted under ADR 0032, so the failure is now only recoverable from a tombstone — which is exactly why the rule must outlive the file | NEW |

`vault-bootstrap` was in [[graph-retrieval-schedule]] and is **deleted from this table**:
its one-shot instance closed between 2026-08-24 and 2026-08-27 — `.planning/.obsidian/` is
committed with `dataview` and `templater-obsidian`. Keeping the row would be the
aspirational-skill failure the §3.3 gate exists to prevent. Consumed, owned elsewhere:
paths and renames ([[corpus-archive-schedule]]), registry governance ([[skills-charter]]).

## 4. Memory

- **Procedural** — the §3 skills; candidates via [[skill-harvesting-charter]]'s queue,
  through the §3.3 gate now written at `.claude/skills/README.md:12-18`.
- **Episodic** — **no NF-A path today.** This department emits nothing to the spine
  (department charter §Metrics); a `graph_metrics` task type would immediately face
  `scripts/check_task_types_are_graded.py` (`.github/workflows/ci.yml:179`) demanding a
  verdict basis better than `call_level_v0` or a named exemption. Until then the episodic
  layer is the daily metric series and the lint failures it produced.
- **Semantic** — `memory/` beside this file, `graph-retrieval-MEMORY.md` as index. Its
  first facts are already known: the 46-way `README.md` ambiguity and the one link already
  written against it (source: measured 2026-08-27); the two standard-setting documents that
  carry no frontmatter (source: charter §Evidence, 2026-08-24); `graph.dataview_executable`
  flipping true without a skill (source: `.planning/.obsidian/`, 2026-08-27). Provenance
  frontmatter per ADR 0034; every write a PR.
- **Working** — this card, the MEMORY index, charter §Mandate, and the scope table in
  [[graph-retrieval-directive]]. The corpus is a grep target by `path:line`, never
  preloaded (`CLAUDE.md` §2) — the same retrieval discipline this team owns for everyone else.

**Consolidation** — monthly: diff this month's `graph.*` series against last month's facts;
**failures first** — an ambiguity that survived a month becomes a fact naming the mechanism
(*"basename reused across categories"*), not "resolution dipped"; a MOC that drifted back
into a hand-written list is a red finding; expire facts unverified for 90 days; propose
skill candidates. One PR; "no delta" stated when true.

## 5. Async contract

Cross-unit interaction is loops ([[graph-retrieval-loops]]), vault PRs, and rename requests.
Gap rows:

| Gap | Why it is a gap |
|---|---|
| `vault.link_added` has no publisher | No per-PR link lint exists. The nearest running precedent is deliberately *not* it: `scripts/check_citation_pairing.py` (`.github/workflows/ci.yml:170`) checks register id+line pairs, not `[[wikilink]]` resolution. The daily job bounds the blind spot at 24 hours |
| Rename requests have a named consumer but no transport | L-GR-2 lists `outputs_to: corpus-archive`; the actual delivery is a vault PR that nobody is notified of, so their weekly placement-drift job is the poll |
| Materialisation is the fallback for this team's own tooling risk | If nothing renders Dataview headlessly, every `agenda-board.md` in the org reads empty to an agent — 99 dead boards, invisible. The daily materialisation job is unbuilt, so today that risk is live |

## 6. Evidence today

- **EXISTS — the vault layer the charter recorded as missing.** `.planning/.obsidian/` is
  committed with `dataview`, `templater-obsidian`, `omnisearch`, `obsidian-git` and three
  more; `.planning/00-index/` holds HOME, ORG-MAP, LOOP-MAP, DECISION-INDEX,
  `UNIT-MANIFEST.json` and `loops.json`, and `00-index/HOME.md:36-41` is a `dataview`
  block rather than a list. `graph.dataview_executable` is no longer blocked on a missing
  plugin — which retires the charter's single highest-leverage item and is recorded here
  rather than left implied.
- **PARTIAL — the numbers.** `scripts/` holds `build_vault_scaffold.py` and no
  `graph_metrics.py`; every `graph.*` on the board is still hand-entered, and the ambiguity
  the charter measured has grown from 45 to **46** `README.md` files in the interval.
- **NEW — the agent and all four skills.** `.claude/skills/` exists
  (`.claude/skills/README.md`) and holds zero committed skills.

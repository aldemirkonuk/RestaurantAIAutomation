# The Vault, Graphify, and the Graph of Loops — how it works and what it says

- **Status:** Reference. Explains the built vault, the graph tooling, and an honest reading of the loop census.
- **Date:** 2026-08-24
- **Keywords:** obsidian, graphify, dataview, loops, graph-of-loops, activation, close-time
- **Links:** [OBSIDIAN_VAULT](OBSIDIAN_VAULT.md), [ORG_STRUCTURE](ORG_STRUCTURE.md), [LOOP-MAP](../00-index/LOOP-MAP.md), [HOME](../00-index/HOME.md)

---

## 1. Opening the vault

Open Obsidian directly on **`.planning/`**. Not the repo root — that would index
`node_modules` and `apps/`, tens of thousands of files, and the graph would be unusable.

You land in `00-index/`:

| File | What it is |
|---|---|
| **[[HOME]]** | Entry point. Reading order, and a live Dataview of charter status by division |
| **[[ORG-MAP]]** | Division → department → team, every unit linked. The org at a glance |
| **[[LOOP-MAP]]** | All 482 loops: status census, close-time distribution, per-division counts |
| `UNIT-MANIFEST.json` | Machine index of all 99 units and their 8 files |
| `loops.json` | Machine index of all 482 loops with owner, close-time, inputs, outputs |

### What is actually on disk

```
.planning/                      ← vault root
├─ 00-index/          HOME · ORG-MAP · LOOP-MAP · UNIT-MANIFEST.json · loops.json
├─ _templates/        the 8 artifact templates
├─ 01-org/            7 divisions → 21 department dirs → 75 team dirs
│   platform/  applied-ai/  research-math/  intelligence/
│   product/  commercial/  corporate/
├─ 02-advisory/       architecture-review · red-team · decision-office
├─ decisions/         ADRs 0001–0007 + OPEN-DECISIONS.md
├─ foundation/        the contracts (this file, ORG_STRUCTURE, OBSIDIAN_VAULT, atlas docs)
└─ (legacy corpus)    28 top-level docs — untouched; OD-01 handles the clean slate
```

**100 units × 9 artifacts = 900 documents** *(re-measured 2026-08-27; was 99 × 8 — one team and the `agent-stack` artifact, ADR 0034, were added since)*. Deepest path is
`01-org/platform/engineering/teams/schema-migrations/schema-migrations-charter.md`.

### The one convention that matters

**Every filename is prefixed with its unit slug.** `engineering-charter.md`, never
`charter.md`. Obsidian resolves `[[wikilinks]]` by *filename*, so 99 files called
`charter.md` would make every `[[charter]]` ambiguous.

We already broke this once: the vault contains **45 files named `README.md`** and
**171 documents write a bare `[[README]]`** that cannot resolve. That is OD-32, and it is
`standards-verification`'s founding case — a rule violated by the same corpus that declares it.

---

## 2. Plugins, and what each is actually for

| Plugin | Job | Status |
|---|---|---|
| **Dataview** | Turns frontmatter into live queries. Board agendas and both MOCs are queries, not hand-written lists | **Required.** The anti-sprawl mechanism |
| **Graphify** | Renders and navigates the loop/decision graph as a real graph | Recommended, not yet configured |
| **Templater** | One command emits the 8-artifact set | Optional — `scripts/build_vault_scaffold.py` already does this |

**Why Dataview is not optional.** A board agenda hand-written across 99 units goes stale
the week it is written. A board agenda that *queries* `status` and `updated` cannot lie —
it reports whatever the frontmatter actually says. That is the only reason the 60-day
staleness rule is enforceable rather than aspirational.

Every unit doc carries clustering frontmatter:

```yaml
type: charter | premortem | agenda-full | agenda-board | directive | loops | schedule | questions
division: platform
department: engineering
team: schema-migrations
status: exists | partial | new | provisional
```

Obsidian's graph view and Graphify cluster on `type` + `division`, so 900 documents read
as **seven clusters plus an advisory ring**, not 900 equal dots.

---

## 3. The graph of loops

A loop is not a diagram. It is a named feedback path with four required parts:
**what it measures → what it changes → who owns it → how fast it closes.**

Each loop is written in the body for humans and mirrored into frontmatter for machines:

```yaml
loop_count: 6
loop_ids: ["nf-a-emission-completeness", "cost-per-completed-task", ...]
loop_close_times: ["weekly", "monthly", ...]
loop_statuses: ["proposed", "proposed", ...]
```

Regenerate with `scripts/build_loop_index.py` after editing any loop. It is idempotent
and rebuilds `LOOP-MAP.md` and `loops.json`.

### Two shapes of loop

**Internal** — a unit measuring itself. Fast, cheap, closes weekly.
**Cross-boundary** — a contract with a unit you do not control. These are the edges that
make it a *graph* rather than 99 isolated cycles, and they are where organisations
actually fail. `research-math` alone carries three.

```
Work → Neural Footprint (NF-A) → Research & Math → harness / skill change
  ↑                                                          │
  └───────────────────── improved execution ─────────────────┘

Guest behaviour → NF-B → personalization → better recommendation
  ↑                                                │
  └──────────── more and better guest signal ──────┘
```

---

## 4. Why only 4 of 482 loops run

Census: **433 `proposed` · 29 `blocked` · 9 `dormant` · 2 `gated` · 2 `active` · 2 `running`.**

This is the single most honest number in the corpus, and it has four causes. None of them
is "the agents did it wrong."

### 4.1 A loop cannot be active if its measurement does not exist

A loop needs an input. Most inputs are not emitting:

- **NF-A emits nothing.** Zero hits for `api_spend` / `cost_usd` / `input_tokens` across
  `apps/api-gateway/src`, over 7 raw-HTTP model call sites. On the Python side
  `decision_log` has reasoning without cost, `api_spend` has cost without agent or
  `correlation_id` — so *"what did this agent's reasoning cost?"* is unanswerable by query.
- **NF-B has no callers.** The guest consent/identity slice is 564 lines of migration,
  three tables and two CI guards — with **zero application call sites**.

Any loop reading a neural-footprint metric is therefore `blocked` or `proposed` **by
construction**. That is most of them.

### 4.2 The generators were told to be honest, and were

The brief required grading `EXISTS / PARTIAL / NEW` with `path:line` citations and
forbade inventing evidence. A generator that marked a loop `active` while nothing emitted
its metric would have been lying. **433 `proposed` is the honesty rules working**, not the
work failing. The alternative — a corpus claiming 482 running loops — would be worse in
every way, and undetectable.

### 4.3 The structural cause: we built the org chart before the instruments

[foundation §1](README.md) states the layer rule plainly: **L4 (Neural Footprint) sits
under L5 (Departments)**, because *"if departments are defined before the metric spine,
each invents its own success criteria and nothing is comparable."*

We then generated L5 while L4 emits nothing.

That was the right order for **documentation** — you cannot instrument what you have not
scoped — but it means activation is now gated on **L4, not on more documents**. Writing
more charters cannot move this number. Landing `agent` and `task_type` on the spend
ledger can.

### 4.4 The four that do run were already there

They are pre-existing CI-shaped checks — `check_schema_parity.sh` and friends — that
existed before this session. Nothing generated on 2026-08-24 runs yet. **The org is
designed, not operating.**

> **Read the corpus as a plan, not as capability.** 900 documents describe what the
> company will measure. Four things measure anything today.

### 4.5 The 102 close-time values are a contract defect, mine

Every loop names a `close_time` — the rule held, 482 out of 482. But the contract never
said *from what set*, so 99 independent agents each invented phrasing: 102 distinct
values, 67 of them multi-word free text like `"6 weeks to a decision, then quarterly
re-run"`. One is literally `close_time: UNDEFINED` with `owner: UNASSIGNED`
(`privacy-engineering-loops.md:188`) — written deliberately, to make an unresolved
ownership question structurally visible rather than quietly plausible.

The fix is a closed vocabulary (`per-pr · hourly · daily · weekly · fortnightly ·
monthly · quarterly · per-event · one-shot`) with free text demoted to a `close_time_note`.
That is **OD-47**. Until then, cadence cannot be aggregated or scheduled against.

---

## 5. The activation path

To move `loops_running` off 4, in order:

1. **Instrument NF-A.** Add `agent` and `task_type` to `SpendLogger.log()` and the
   `api_spend` table; join it to `decision_log` on `correlation_id`. Unblocks the
   largest single group of loops.
2. **Emit from the gateway.** 7 raw-HTTP model call sites currently write nothing.
3. **Give NF-B a caller.** The consent/identity schema works and nothing invokes it.
4. **Normalise `close_time`** (OD-47) so schedules can be generated from the graph.
5. **Then** re-run `scripts/build_loop_index.py` and watch the census move.

`loops_running` is the org's real activation metric — not document count.

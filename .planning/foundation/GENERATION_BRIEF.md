# Unit Generation Brief — the contract every generator agent follows

> Read this **fully** before writing anything. It is the shared contract so that a unit
> written in one session is identical in shape to one written in another.

## 1. Read first (in this order)

| Doc | Why |
|---|---|
| [`ORG_STRUCTURE.md`](ORG_STRUCTURE.md) | The org contract — divisions, unit anatomy, loop frontmatter. Short, read fully. |
| [`OBSIDIAN_VAULT.md`](OBSIDIAN_VAULT.md) | Vault conventions — filenames, frontmatter, Dataview. Short, read fully. |
| `.planning/_templates/*.md` | The 8 artifact templates (`questions`, artifact #8 per OD-41, has none). Follow their section structure. |
| `teams/<your-division>.md` | **Your evidence source.** Already contains, per team: mandate, why-distinct, EXISTS/PARTIAL/NEW evidence with `path:line`, primary metric, premortem line. **Transcribe and expand it — do not re-derive.** |
| [`README.md`](README.md) | The 7-layer stack (L0–L6), skill taxonomy §3, neural footprint §4. |
| `../../CLAUDE.md` §2 | Output discipline — grep large docs, never read whole. |

## 2. What you write

**7 files for your department**, then **7 files for each of its teams**.
Team directories already exist under `<department-dir>/teams/<team-slug>/`.

Filenames are **prefixed with the unit slug** — `engineering-charter.md`,
`catalogue-identity-premortem.md`. Never bare `charter.md`: Obsidian resolves
`[[links]]` by filename, and 99 files called `charter.md` makes every link ambiguous.

The wave-1 artifacts: `charter` · `premortem` · `agenda-full` · `agenda-board` ·
`directive` · `loops` · `schedule`. *(Two were added later: `questions` — OD-41,
generated — and `agent-stack` — §7 below, ADR 0034 — making 9 per unit.)*

## 3. Hard requirements

1. **Frontmatter on every file:**
   ```yaml
   ---
   type: charter          # or premortem | agenda-full | agenda-board | directive | loops | schedule
   division: <slug>
   department: <slug>
   team: <slug>           # team files only
   status: exists         # exists|partial|new on charters (from your evidence grade); provisional on agendas
   metrics: []            # nf_a.* for agents, nf_b.* for guests, where relevant
   updated: 2026-08-24
   links: []              # real [[wikilinks]]
   ---
   ```
2. **Agendas** (`agenda-full`, `agenda-board`) open with
   `> **PROVISIONAL — no work done yet.**` — forecast must never read as fact.
3. **Charters carry real evidence** — `path:line` citations graded EXISTS / PARTIAL / NEW,
   taken from your division's team doc. **Never invent evidence or capabilities.** If a
   team is NEW, say NEW plainly rather than dressing it up.
4. **Premortems are substantive** — 3–5 concrete failure mechanisms, each with its
   earliest observable signal and a specific counter-pressure ("be careful" is not one).
   The team doc gives you one premortem line per team; expand it properly. Premortem is
   artifact #2 by deliberate design.
5. **`loops.md`** uses the machine-readable YAML block from ORG_STRUCTURE §5. **Every loop
   names a `close_time`.** A loop that cannot say how fast it closes is a diagram, not a loop.
6. **`agenda-board.md`** uses a **Dataview query**, not a hand-written bullet list — that is
   the anti-sprawl enforcement mechanism.
7. **Cross-link liberally** with `[[slug]]`. Unresolved links are expected and fine — they
   mark a doc worth writing.
8. **`schedule.md`** names recurring work and the skills the unit owns (skills live in
   `.claude/skills/`). Anti-sprawl: a skill unfired for 30 days is reviewed for deletion;
   a scheduled job that produces no action for 3 runs is downgraded or deleted.

## 4. Honesty rules

- Where the evidence is too thin to write a real charter, **say so in the charter** and
  flag it in your final summary. A thin charter honestly labelled beats a padded one.
- Where you think a department has **too many teams**, say so. The founder chose ambition
  deliberately, but a team that cannot state why it is distinct from its sibling is a
  finding, not a failure.
- Trigger-gated teams (marked ⏸ in the team docs) get `status: new` and an explicit
  entry trigger in the charter.

## 5. Do not

- Do **not** run `git add` or `git commit` — the orchestrating session handles commits.
- Do **not** switch branches. You are on `docs/foundation-memory-instructions-decisions`.
- Do **not** edit anything outside your assigned department directory.
- Do **not** read `UX_PATHS_CATALOG.md` (154KB), `claude_full_architectural.md` (181KB),
  or `ROADMAP.md` (70KB) in full — grep them.

## 6. Final summary

Under 12 lines: files written, any place the evidence was too thin, and any team you
believe should not exist.

---

## 7. Wave 2 — the agent-stack artifact (2026-08-27)

Wave 2 adds a **9th artifact per unit**: `<slug>-agent-stack.md`, the unit's AI
operating contract — its agents, skills, harness *requirements*, and memory.
Decision record: [`decisions/0034-agent-stack-artifact.md`](../decisions/0034-agent-stack-artifact.md).
Everything in §1–§5 above still applies (frontmatter, slug-prefixed filenames,
honesty rules, do-nots). Wave 2 additions:

### 7.1 Read first

1. `_templates/agent-stack.md` — the template. Follow its section structure exactly.
2. `decisions/0034-agent-stack-artifact.md` — why the shape is what it is.
3. The two reference implementations:
   `01-org/applied-ai/ai-orchestration/ai-orchestration-agent-stack.md` (department
   level) and `.../teams/harness-runtime/harness-runtime-agent-stack.md` (team level).
4. Your unit's own `charter` (mandate, boundaries, metrics, evidence) and `schedule`
   (recurring work) — **transcribe and compose, do not re-derive.**

### 7.2 Hard requirements

1. **`status: designed` on every file.** This is a docs-only wave: an agent-stack doc
   describes a design, and its §6 Evidence grades what already exists. Never let a
   card read as a running agent.
2. **Cards are requirements-only and harness-agnostic.** No model names
   (`routing_class` only — the pick is aio-model-routing's), no queue technology, no
   OD-03 candidate named. `mutate_stock_money_outbound: confirm` is a constant, not
   a choice.
3. **Every §3 skill row cites a real past instance** (README §3.3 rule 3) — a
   `path:line`, a PR, or a dated session. No instance → no row. An empty table with
   the sentence "no procedure this unit has actually repeated yet" is a *good* answer.
4. **Every `consumes` names a publisher and every `emits` names a consumer**, or the
   entry is written as a gap row. Do not silently assume the other side exists.
5. **Do not resolve open forks in a unit doc.** OD-03, TECH-F3, OD-25 and their kin
   stay open; reference them, never pick.
6. **Memory §4 keeps the template's four layers and the consolidation paragraph**,
   specialised with the unit's actual task types and cadence — not restated generically.

### 7.3 Do not (wave 2)

- Do **not** create the `memory/` directories — the artifact *designs* them; creating
  them is build.
- Do **not** write any file other than `<slug>-agent-stack.md` files inside your
  assigned unit directories, and do not edit the 8 existing artifacts.
- Do **not** invent agents a unit has no evidence or mandate for. Most units get
  exactly one roster row.

### 7.4 Wave-2 execution record (2026-08-27)

Executed same day: 10 Applied AI stacks hand-written as reference implementations,
90 generated by 20 parallel department-scoped agents. **100 of 100 units covered**,
verified one-per-unit against `UNIT-MANIFEST.json`; every file `type: agent-stack`,
`status: designed`; no card names a model, a queue technology, or an OD-03 candidate
(grep-verified). Roughly 45 speculative skill rows were **dropped** across the wave
for failing README §3.3 rule 3, each with its reason stated in-file; 7 skill tables
are honestly empty (POS telemetry, social-community, both Legal teams,
compliance-privacy dept, people-agent-ops dept, skill-harvesting — gated).

**Cross-unit seams the wave surfaced — recorded in the files named. All seven were
resolved by the founder the same day, [ADR 0035](../decisions/0035-wave2-seam-reconciliation.md);
the list below is kept as the finding record, and every named file now carries its
resolution line:**

1. `nf-a-coverage-report` claimed by both [`ai-orchestration-agent-stack`](../01-org/applied-ai/ai-orchestration/ai-orchestration-agent-stack.md) and the observability schedule (see [`observability-telemetry-plumbing-agent-stack`](../01-org/platform/reliability-sre/teams/observability-telemetry-plumbing/observability-telemetry-plumbing-agent-stack.md)).
2. The daily substrate report has two declared loop owners — department vs team (see [`data-agent-stack`](../01-org/platform/data/data-agent-stack.md) and its substrate team file).
3. `roster-registrar` and `fleet-census-agent` count the same fleet on different cadences (see [`roster-lifecycle-agent-stack`](../01-org/corporate/people-agent-ops/teams/roster-lifecycle/roster-lifecycle-agent-stack.md)).
4. Cost-per-task double ownership, OD-29-shaped: model-routing vs inference-cost (see [`inference-cost-agent-stack`](../01-org/commercial/finance-pricing/teams/inference-cost/inference-cost-agent-stack.md)) — plus a measured grain divergence between `api_spend` and the NF row, recorded there.
5. The NF-B research-store erasability loop is `owner: UNASSIGNED` with no register entry (see [`privacy-engineering-agent-stack`](../01-org/corporate/compliance-privacy/teams/privacy-engineering/privacy-engineering-agent-stack.md)).
6. `pos-bridge-schedule`'s weekly throughput metric would count the 66 `P3PROOF-*` rows — reads 66, means 0 (see [`pos-bridge-agent-stack`](../01-org/product/partnerships-integrations/teams/pos-bridge/pos-bridge-agent-stack.md)).
7. `ai-surface-security-charter` claims allowlist enforcement that action-safety owns (see [`ai-surface-security-agent-stack`](../01-org/intelligence/security/teams/ai-surface-security/ai-surface-security-agent-stack.md)).

Recurring stale-baseline corrections (2026-08-24 charters vs 2026-08-27 disk) were
recorded in each unit's §6 without editing the charters: `.claude/skills/` now exists
(README only, zero skills), the gateway model boundary is consolidated behind
`common/model-client` since P1, OD-14/OD-20/OD-33 are closed, and dozens of
`path:line` citations have shifted. Counts corrected the same day: the vault holds
**100 units / 76 teams** (ORG-MAP and VAULT_AND_LOOPS said 99 / 75).

---

## 8. Wave 3 — department agendas + canvases (2026-08-28, ADR 0039 Track B)

Wave 3 turns 198 `PROVISIONAL — no work done yet` agendas into **real,
department-specific, ambitious first agendas, authored by each department's own
agent**, plus **one HTML canvas per department**. Decision record:
[`decisions/0039-activation-plan-of-record.md`](../decisions/0039-activation-plan-of-record.md).
§1–§7 still apply. One generator agent per department-level unit (21 departments
and sub-layers + 3 advisory = 24 agents), each editing ONLY its own unit's
`agenda-full` / `agenda-board` and adding ONE sketch file.

### 8.1 Read first

1. Your unit's `charter`, `directive`, `schedule`, `agent-stack` (your card is
   your operating contract), `questions`, and `premortem` — the agenda must be
   *their* consequence, not a fresh invention.
2. `00-index/cards.json` + your unit's rows in `loops.json` — **a task no card
   or loop can carry is a finding to record, not a task to list.**
3. `sketches/MANIFEST.md` — the canvas joins it under the existing conventions.
4. ADR 0039 Track A — if your unit owns a Track-A item, it is your agenda's
   spine, not a competitor to it.

### 8.2 Hard requirements

1. **Replace the PROVISIONAL banner** with a dated agenda. `agenda-board` stays
   a Dataview query (§3.6); `agenda-full` carries the tasks.
2. **Every task names its doneability and a close_time.** A task that cannot say
   how you would know it is done, and by when it should have moved, is deleted.
3. **Evidence discipline is §3.3's:** each task cites the charter/card/loop line
   or repo evidence that makes it real. No speculative programs.
4. **Locks are locks** (founder re-confirmed 2026-08-28): the **pricing model is
   deferred** and **brand/landing visuals are held**. Agendas may research
   payment rails, do brand-voice groundwork, and *prepare the unlock case* —
   never act past a lock, never schedule work that assumes the unlock.
5. **One canvas per department**: an HTML sketch in `.planning/sketches/`,
   MANIFEST-numbered, self-contained, showing the department's agenda as one
   picture (its tasks, owners-by-team, close-times, and the seams it touches).
   Throwaway-grade per the sketch conventions — a thinking surface, not a product.
6. **Ambition with honesty:** the founder asked for creative, innovative,
   ambitious agendas. Reach — then grade each reach item with the same evidence
   discipline, and say plainly which tasks are aspiration pending a decision.

### 8.3 Seed themes per department (expand from these; do not stop at them)

| Unit | Seed |
|---|---|
| platform/engineering | Per-page UI-compatibility & dead-end audit across the 51-route PAGE_MAP (client-surfaces); shrink-only schema-debt burn-down; P3-lane support |
| platform/data | Move the three-number substrate report: demand-weighted corpus enrichment push; POS line-resolution baseline |
| platform/reliability-sre | First **verified restore drill** (`days_since_verified_restore` has no value); name the DLQ consumer; productionize the runner cron (Track A4) |
| applied-ai/ai-orchestration | **Track A1 — the OD-03 bake-off** is the agenda's spine; implement the remaining aio mechanical cards |
| applied-ai/skills | First harvest sweep over the 59-script reservoir through the §3.3 gate; carry the `nf_a.skill_id` ask (Track A4) |
| research-math | **Track A5 — judgment rubric #1** (vendor-reply family); backtests' first replay — its trigger is confirmed met |
| intelligence/security | Classify the ~40 remaining unguarded-by-omission endpoints (OD-19); ai-surface adversarial corpus v1 |
| intelligence/analytics-bi | Consultant grounding expansion; the 375-vs-573 narrative reconciliation; the metric-contract truth board |
| product/product-vision | The **Ask AI stage is unlocked** (P3.0 closed 2026-08-27) — schedule it; inbound-understanding Phase 1 |
| product/design | **Brand-voice foundation + a sketch program** (canvas-driven); the OD-106 co-design preparation pack — visuals stay held |
| product/guest-experience | NF-B activation-readiness dossier under ADR 0037's crypto-shredding design — docs only, NF-B stays HELD |
| product/partnerships-integrations | Second POS provider scaffold (Square/Clover paths exist in code); the vendor-network graph |
| commercial/growth | Settle OD-53 (fetch the two API facts, dated); the SEO/AI-answer-surface program on verified ground |
| commercial/finance-pricing | **Payment rails/options research** (no pricing model — locked); consume cost-per-task the day Track A2 lands |
| commercial/media-brand | The brand-voice guide — the prerequisite the visuals-hold names; customer research strictly behind the consent gate |
| commercial/sales | Design-partner operations for the one real tenant; readiness pack for the target-list unlock |
| corporate/legal | Productize the binding-surface census; DPA template groundwork with compliance-privacy |
| corporate/knowledge-documentation | Automate retire-to-write accounting (adds vs retires per quarter); the vault growth ratio board |
| corporate/compliance-privacy | Unify the 3 PII definitions across 4 guards; the consent-gate spec media's research depends on |
| corporate/people-agent-ops | Agent personnel files v1 — join cards.json + the census into per-agent records; the performance board off verdict coverage |
| corporate/strategy-fundraising | The YC readiness register with per-claim verification (every deck claim carries a citation that `claim-provenance-check` can grade) |
| 02-advisory/architecture-review | The adversarial pass on Track A1's bake-off design — before it runs, not after |
| 02-advisory/red-team | Premortem wave 3 itself: how does an ambitious-agenda wave fail? File it before the wave executes |
| 02-advisory/decision-office | The OD burn-down cadence; carry OD-25 and TECH-F3 to closure |

### 8.4 Do not (wave 3)

- Do **not** edit any file outside your unit's two agenda artifacts and your one
  sketch file (plus its MANIFEST line).
- Do **not** touch charters, cards, loops, or another unit's anything — a
  cross-unit need is an agenda task addressed to that unit's questions file.
- Do **not** schedule work past a lock, and do not resolve any open OD/fork.
- Do **not** run git commands; the orchestrating session commits.

### 8.5 Final summary

Under 12 lines: files written, the three most ambitious tasks you scheduled and
the evidence each stands on, and any seed you rejected with the reason.

---
type: agent-stack
division: corporate
department: people-agent-ops
team: roster-lifecycle
status: designed
updated: 2026-08-27
metrics: [roster.truth_pct, roster.unregistered_module_count, roster.silent_default_spec_count, roster.declared_stub_count, roster.maturity_level_evidenced_pct, roster.headcount_claim_variance]
links: ["[[roster-lifecycle-charter]]", "[[roster-lifecycle-schedule]]", "[[roster-lifecycle-loops]]", "[[roster-lifecycle-directive]]", "[[0034-agent-stack-artifact]]", "[[people-agent-ops-agent-stack]]", "[[agent-fleet-agent-stack]]", "[[harness-runtime-agent-stack]]"]
---

# Roster & Lifecycle — Agent Stack

> **DESIGNED — nothing here is built unless its Evidence line says EXISTS.**
> The team that keeps the record of the workforce gets an agent that is itself a record in
> that workforce, so its founding claim applies recursively: *a worker that no record names
> is worse than a worker that does not exist* ([[roster-lifecycle-charter]] §Mandate).
> Everything below is the census, the gate and the ladder — never the fix.

## 1. Roster

| Agent | Job in one sentence | Evidence |
|---|---|---|
| `roster-registrar` | Publish the census with a verdict per module per predicate, hold the onboarding gate on every PR that adds a module, and refuse to let a maturity Level exist as prose | NEW |

## 2. Agent cards

```yaml
agent: roster-registrar
unit: roster-lifecycle
triggers:
  - schedule: "daily census + stub audit; weekly silent-default and defect ageing; monthly headcount reconcile; quarterly lifecycle review"   # mirrored in [[roster-lifecycle-schedule]]
  - topic: ci.pipeline_run                 # publisher: EXISTS — .github/workflows/ci.yml runs per commit (the merge-policy gate at ci.yml:226-230 is the proven shape)
  - topic: agents.module_added             # publisher: NONE (gap — shared with harness-sentinel and fleet-census-agent; see §5)
consumes:
  - services/agent-orchestrator/agents/ (disk — 26 modules, 27 files)
  - core/orchestrator.py:174-211 (class map — 23) and the boot refusal at :245
  - core/agent_registry.py DEFAULT_AGENT_SPECS (19) and the silent `{}` fallback at :337
  - "the contract-membership column from `harness-contract-audit` ([[harness-runtime-agent-stack]]) — consumed, never recomputed"
  - "the §1 Roster of every `*-agent-stack.md` — the declared column ADR 0034 §Consequences promises the census; publisher: the vault (wave 2), no event"
emits:
  - "the 26-row census table, four verdicts per row — extends BaseAgent · registered · declared spec · stub flag accurate"
  - "roster.truth_pct, roster.unregistered_module_count, roster.silent_default_spec_count → [[people-agent-ops-agent-stack|pao-board-keeper]]"
  - onboarding-gate and spec-declaration verdicts → the PR check itself (pass/fail, never a warning)
  - defect rows into [[roster-lifecycle-agenda-full]] and [[people-agent-ops-questions]]
  - nf_a events (task_type: roster_census)
routing_class: mechanical      # a three-way diff is a script; the one judgment call — assigning a maturity Level — is excluded below, not routed
quality_bar: "the census reproduces on a rerun of the same commit, and a bare percentage is a failure ([[roster-lifecycle-schedule]], `agent-roster-census` doneability: 26 rows × 4 verdicts). NONE (gap) — ADR 0017 defines no verdict basis that grades a census run"
autonomy:
  read: autonomous
  propose: autonomous          # census tables and defect rows land as PRs; gate verdicts are CI checks
  mutate_stock_money_outbound: confirm    # constant; and this agent must not edit agent code at all — see below
memory: roster-lifecycle
escalates_to: "[[people-agent-ops-charter]]"
```

**Two hard rules on the card.** The registrar **never registers an agent itself** — it
fails the gate and names the missing line ("we open the defect; we do not implement the
agent", [[roster-lifecycle-charter]] §Non-goals); a registrar that fixed what it measures
is premortem M5. And it **never assigns a maturity Level** without a machine-checkable
predicate — a Level backed by prose is reported as *unevidenced*, which is premortem M4's
counter-pressure and why `roster.maturity_level_evidenced_pct` starts at 0%.

## 3. Skills

| Skill (`.claude/skills/…`) | Tier | Trigger | Doneability | Past instance | Status |
|---|---|---|---|---|---|
| `agent-roster-census` | T2 | Daily, and any PR touching `services/agent-orchestrator/agents/` | 26 rows × 4 verdicts, reproducible on the same commit; a bare percentage fails | The two Phase 24 agents fully implemented and registered nowhere — `core/orchestrator.py:200-205`, found reactively, no check built | NEW |
| `agent-onboarding-gate` | T2 | A new module appears in `agents/` | The module ends in exactly one declared state: registered, or excluded with a written reason | `book_scraper_agent.py:17`, `dataset_creator_agent.py:26` — `BaseAgent` subclasses with zero call sites in the repo | NEW |
| `spec-declaration-check` | T2 | Per PR, and weekly | Zero registered agents resolve their spec from `{}` | 4 today — `provider_conversation`, `email_intel`, `email_parsing`, `provider_communication` via `core/agent_registry.py:337` | NEW |
| `stub-flag-audit` | T2 | Daily | Every `IS_STUB` module still refused at boot; every non-stub still implements `process_message()` | `IS_STUB` exists because an enabled no-op *"looks healthy from every dashboard"* — `core/orchestrator.py:242-243` | NEW |
| `headcount-reconcile` | T2 | Monthly, and before any artifact quoting an agent count ships | One number, or a recorded disagreement naming both sides | Four live counts — 19 · 23 · 24 · 26 — reconciled by no artifact; `.planning/PROJECT.md:33,121` claims 24 | NEW |
| `agent-maturity-classify` | T2 | Quarterly lifecycle review | Every Level reproduced by a check; a Level needing prose fails the skill | `.planning/PROJECT.md:117` asserts "all Level 0-1" across 24 agents with no per-agent evidence anywhere | NEW |

**Deliberately absent: `agent-retirement-record`.** [[roster-lifecycle-schedule]] lists it
as a candidate with **no past instance** — `roster.retirement_count` is 0 — and §3.3's
own rule says a row that cannot cite one does not exist. It is left off this table so the
first retirement creates it, rather than the first retirement happening without a record.

Consumed, owned elsewhere: the skill envelope ([[skills-charter]]); `harness-contract-audit`
([[harness-runtime-agent-stack]]).

## 4. Memory

- **Procedural** — the §3 skills; candidates via [[skill-harvesting-charter]]'s queue.
- **Episodic** — nf_a `task_type: roster_census`. Needs `context.agent_module` as a jsonb
  key — **the same key `fleet-census-agent` asks for** ([[agent-fleet-agent-stack]] §4);
  one key with two consumers, not two keys.
- **Semantic** — `memory/` beside this file, index `roster-lifecycle-MEMORY.md`. Its
  first files are already verified: the 7 defects (3 unregistered + 4 silent-default
  specs), the 5 correctly-declared stubs recorded **as a pass** so the record shows what
  right looks like, the four headcounts, and the corrections to `corporate.md:474,348`.
  Provenance per ADR 0034; every write a PR.
- **Working** — this card, the MEMORY index, charter §Boundaries (the three-way diff) and
  the declared-exclusion register. Individual modules are `path:line` retrieval targets.

**Consolidation** — monthly: diff this month's census against last month's facts. Every
state transition (orphan adopted, module registered, stub gated on) becomes a fact citing
the commit that caused it; **failures first** — a module that fell out of the contract
gets a fact naming the mechanism, not "truth_pct dipped". Expire at 90 days unverified;
propose skill candidates. One PR; "no delta" stated when true.

## 5. Async contract

Board rows and memory PRs to the department, CI checks on PRs, NF-A events, and loops per
[[roster-lifecycle-loops]]. Gap rows:

| Gap | Why it is a gap |
|---|---|
| `agents.module_added` has no publisher | Nothing announces a new module; three cards now wait on the same absent event. The daily census bounds this team's blind spot at 24h — tighter than the weekly cards, which is an argument for one publisher, not three pollers |
| Census overlap with `fleet-census-agent` | [[agent-fleet-agent-stack]] §2 reads the same disk and the same class map. The charters split the verbs (they ask *should this agent exist*, we ask *does the record match reality*), but two cards now compute counts over one source at different cadences. Named here rather than discovered in a board disagreement; a seam this shape goes to [[decision-office-charter]] |
| The declared column has no reconciler | ADR 0034 promises the census a declared baseline; nothing yet compares card rosters to the registry, and whether a card agent belongs on `roster.headcount_claim_variance` at all is **left open** — merging the populations would manufacture a fifth wrong number |
| `recurring_order_agent` has no declared class | Its docstring (`:17-21`) declares the exclusion deliberately; the register that would record it does not exist yet, so the founding entry of the declared-exclusion register is still a sentence in a source file |

## 6. Evidence today

- **EXISTS — the material, and it is unusually thoughtful.** `core/agent_registry.py`
  (491 lines: `AgentTier` `:27`, `AgentSpec` `:36`, `LazyAgentProxy` `:162`,
  `AgentRegistry` `:299`, `get_startup_order` `:401`); the boot refusal at
  `core/orchestrator.py:245` with its reasoning in the code (`:239-244`).
- **PARTIAL — the numbers.** `roster.truth_pct` ≤ 73%, unregistered = 3, silent-default
  = 4, declared stubs = 5 — all computable today against the working tree with no NF-A at
  all. That is the number this team can publish this week.
- **NEW — `roster-registrar` and all six skills.** Every census in
  [[roster-lifecycle-charter]] §Evidence was hand-run in the 2026-08-24 session; nothing
  repeats them, which is the finding the card exists to close.
- **NEW, and 0% — the maturity ladder.** `AgentTier` is startup behaviour, not maturity;
  the repo has no ladder in code, so `roster.maturity_level_evidenced_pct` stays 0% until
  every Level is a predicate.

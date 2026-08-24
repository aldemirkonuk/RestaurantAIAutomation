---
type: plan
title: Plan
status: live
updated: 2026-08-24
links: ["[[AGENDA]]", "[[HOME]]", "[[ORG-MAP]]", "[[LOOP-MAP]]", "[[SCENARIO-MAP]]"]
---

# Plan — what gates what

> **The plan is a dependency map, not a wish list.** Every entry names what it
> unblocks. If something here cannot say what it unblocks, it does not belong.
> Companion: [[AGENDA]] — what is happening *right now*.
> Maintained per CLAUDE.md §7: no session ends without this and [[AGENDA]] reflecting reality.

## 0. Where we actually are

| Plane | State |
|---|---|
| **Structure** — divisions, departments, teams, advisory | ✅ Built. 7 divisions · 19 departments · 2 sub-layers · 3 advisory · 75 teams = 99 units × 8 artifacts = **792 docs** |
| **Operational** — scenario rituals | ✅ Built. 17 scenarios, all `status: proposed` |
| **Decisions** | 🟡 **49 open**, several 🔴. Fill-to-drain ratio measured at 7:1 |
| **Instrumentation (L4)** | 🟡 **Built and merged.** Table live, 25 call sites emit across both runtimes. Awaiting first traffic |
| **Loops** | 🟡 **6 of 482 running** (was 5). The watcher is the first loop this chapter produced |
| **Security** | 🟢 Five holes closed and merged (PRs #31, #32) |
| **CI** | 🔴 Schema parity has never compared anything (PR #33 / OD-49) |

**The honest one-liner:** we have a complete map of a company that is not yet running.
That is the correct order — you cannot instrument what you have not scoped — but it means
**writing more documents cannot move the next number.**

## 1. The critical path

Everything downstream is gated on one thing: **the system does not measure itself.**

```
        ┌─────────────────────────────────────────────┐
        │  L4 — Neural Footprint emits nothing        │  ← THE bottleneck
        └───────────────┬─────────────────────────────┘
                        │ unblocks
     ┌──────────────────┼──────────────────┬───────────────────┐
     ▼                  ▼                  ▼                   ▼
 loops go active   agent review     cost-per-task      scenario §11
 (6 → many)        possible         routing (OD-03/04)  feedback real
```

### P1 — Instrument NF-A *(unblocks the most)*
1. Add `agent` + `task_type` to `SpendLogger.log()` and the `api_spend` table
   (`services/agent-orchestrator/services/spend_logger.py:41-49`)
2. Join `api_spend` ↔ `decision_log` on `correlation_id` — today one has cost without
   an agent, the other reasoning without cost, and **no key joins them**
3. Emit from the 7 raw-HTTP gateway call sites (currently zero write to `api_spend`)

**Unblocks:** most of the 433 `proposed` loops · agent performance review (People & Agent
Ops cannot function without it) · OD-03/OD-04 harness and model-roster decisions, which
are *currently undecidable on evidence* because `harness_overhead_ms` has no instrument.

### P2 — Restore the drift guard
`SUPABASE_POOLER_CONNECTION_STRING` (OD-49). One dashboard action. The guard against
hand-applied DDL is currently **off**, and it is off for a check that exists because
production once carried 27 tables and 403 columns no migration created.

### P3 — Connect a POS
Only **25.1%** of the 573 insight types are satisfiable without POS data. The two largest
categories (`tables`, `efficiency`) are dark. **The subscription story is gated here** —
S15 shows the engine is real and the owner-facing depth is not.

### P4 — Give NF-B a caller
The guest consent/identity slice is 564 lines of working migration, three tables, two CI
guards — and **zero application call sites**. Every guest scenario is blocked on this.

## 2. What is explicitly NOT next

- **More org documents.** 792 is the ceiling until units do work. Retire-to-write now applies.
- **Floor Checker build.** Genuinely NEW, and `kitchen-ready` is *unmodelled* in
  `CanonicalCheck` — it needs a schema decision before code.
- **Pricing.** Founder-deferred (OD-23). Commercial stays provisional.
- **Blender / landing visuals.** Held until brand direction exists.

## 3. Sequencing rule

**Instrument → observe → decide → build.** In that order, every time. The corpus was
written the other way round on purpose — scoping first — and that debt is now paid.
From here, a change that cannot be observed should not ship.

## 4. Wave history

| Wave | What | Outcome |
|---|---|---|
| Wave 0 | Lock contracts (unit anatomy, skill anatomy, NF schema) | ✅ ADRs 0006, 0007 |
| Wave 1 | Generate the org in parallel | ✅ 792 docs; review agents caught 12+ errors in Claude's own work |
| Wave 1b | Scenario ritual layer | ✅ 17 scenarios |
| Wave 1c | Vault integration + watcher loop | ✅ Obsidian config on `.planning/`, graph clustered by division, `watch_loops.py` scheduled weekly — **6th running loop** |
| Wave 1d | Ecosystem docs: scenarios tiered, 50 pages, library, index layer, fork registry, advisory routing | ✅ **Documentation complete** — 931 files in the new structure, 0 broken links, all 99 units at 8/8 artifacts |
| Wave 2 | Instrumentation (P1, Path C) | ✅ **Merged to main** 2026-08-24 — table live, both runtimes emit, guard green, 832 py + 780 ts tests pass |
| **Wave 3** | **First traffic → first number** | ⬅ next. P1 is emission-complete, not done: the metric exists when nobody had to assemble it by hand |

---
type: plan
title: Plan
status: live
updated: 2026-08-26
links: ["[[AGENDA]]", "[[HOME]]", "[[ORG-MAP]]", "[[LOOP-MAP]]", "[[SCENARIO-MAP]]"]
---

# Plan — what gates what

> **The plan is a dependency map, not a wish list.** Every entry names what it
> unblocks. If something here cannot say what it unblocks, it does not belong.
> Companion: [[AGENDA]] — what is happening *right now*.
> Maintained per CLAUDE.md §7: no session ends without this and [[AGENDA]] reflecting reality.

## 0. Where we actually are

> **Milestone naming lives in the spine** — current milestone: **P3 — Grade, then
> scale** ([ADR 0029](../decisions/0029-p3-plan-of-record.md); stages in
> [STATE.md](../STATE.md)). P2 closed 2026-08-26. The P1/P2 labels below were this
> file's own push numbering, coined before ADR 0018 reserved P-names for milestones;
> they are kept as history under 'Push' names to avoid two things called P2.

| Plane | State |
|---|---|
| **Structure** — divisions, departments, teams, advisory | ✅ Built. 7 divisions · 19 departments · 2 sub-layers · 3 advisory · 75 teams = 99 units × 8 artifacts = **792 docs** |
| **Operational** — scenario rituals | ✅ Built. 17 scenarios, all `status: proposed` |
| **Decisions** | 🟡 **40 open** (7 🔴) · **64 resolved**, re-counted 2026-08-26. The fill-to-drain ratio has inverted since it was measured at 7:1 |
| **Instrumentation (L4)** | 🟢 **P1 closed 2026-08-24.** Table live, 25 call sites emit, `scripts/nf_readout.py` produces the number with no hand-written SQL. Both runtimes proved end-to-end against production |
| **Loops** | 🟡 5 running/active · **4 gated** · 29 blocked · 438 proposed. Two cost loops moved `blocked` → `gated` when P1 landed |
| **Security** | 🟢 Five holes closed (#31, #32). Plus: the NF table shipped RLS-off with anon grants and was closed the same day |
| **CI** | 🟢 **Push 2 (schema-parity guard) closed 2026-08-24.** Schema parity compares for the first time. Two more CI holes found and fixed alongside it — see below |

**The honest one-liner has changed.** It used to be *"a complete map of a company that is
not yet running."* The map is still ahead of the company, but the system now measures
itself, and the next number is no longer blocked on instrumentation. It is blocked on a
**definition**.

### What pushes 1 and 2 actually exposed

Three checks had been red long enough to stop being read, and because `build` needs
`[lint-typescript, lint-python]`, **the test suites had not run in CI for weeks** — they
showed `skipped`, not `failed`. Schema parity had never once connected to the database it
claims to verify. A gateway that could not boot walked through that board straight into
production and crash-looped for ~35 minutes.

The lesson is not "watch CI." It is that **a check nobody reads is worse than no check**,
because it occupies the slot where a real one would go. Everything on the board is green
as of 2026-08-24, and `scripts/check_gateway_boots.sh` now constructs the real `AppModule`
so this specific failure cannot recur silently.

## 1. The critical path

**The bottleneck moved on 2026-08-24.** It was *the system does not measure itself*. That
is fixed. What replaced it was not on this plan when the plan was written, which is the
point of re-reading it after each phase:

```
   BEFORE P1                             AFTER P1
   ┌────────────────────────┐            ┌──────────────────────────────┐
   │ NF-A emits nothing     │            │ Nothing GRADES a task        │  ← THE bottleneck
   │ (no cost per agent)    │  ── P1 ──▶ │ (outcome_basis: call_level_v0│
   └───────────┬────────────┘            │  means "HTTP returned 200")  │
               │                         └──────────────┬───────────────┘
               ▼                                        │ blocks
   cost per API CALL  ✅ readable today                 ▼
                                          cost per COMPLETED task ❌
                                          task_success_rate       ❌
                                          doneability_verdict     ❌
                                          + 4 more nf_a keys
```

**Measured, not asserted:** 7 of 15 `nf_a.*` keys need a doneability verdict, and **24
loops across 14 units** measure at least one of them. Nothing else in the corpus is one
decision away from unblocking that much.

**Why it is sharp rather than academic.** `cost_per_api_call` is readable today;
`cost_per_completed_task` is not — and the two move in *opposite* directions when a
cheaper model retries more. Routing a task to a cheaper model therefore looks like a win
on the number you can see and may be a loss on the number you cannot. That is why
[[inference-cost-loops]] carries a **both numbers or neither** rule, and why the two cost
loops read `gated` rather than `active`: the mechanism is built, but closing them on cost
per *attempted* task would produce confidently wrong routing decisions.

**It does not need a universal definition** — it needs one per task type, and
[[evaluation-doneability-charter]] already owns it with [[backtests-charter]] positioned to
re-grade `call_level_v0` against scenario truth. Recorded as **OD-59**; the analysis and a
proposed first task type live in [[evaluation-doneability-questions]].

### Push 1 (P1) — Instrument NF-A ✅ **CLOSED 2026-08-24**
1. Add `agent` + `task_type` to `SpendLogger.log()` and the `api_spend` table
   (`services/agent-orchestrator/services/spend_logger.py:41-49`)
2. Join `api_spend` ↔ `decision_log` on `correlation_id` — today one has cost without
   an agent, the other reasoning without cost, and **no key joins them**
3. Emit from the 7 raw-HTTP gateway call sites (currently zero write to `api_spend`)

**Delivered:** all three items, plus the readout that makes them mean something —
`python3 scripts/nf_readout.py`, no arguments, no caller SQL, labelling anything under
30 events `INSUFFICIENT VOLUME`. *(Corrected 2026-08-25: this said "refuses to print" —
it prints the table under the banner and exits 0; only `--require-volume` changes the
exit code. See the OD-58 register entry.)* Both
runtimes proved end-to-end against the live database. See [[P1-BUILD-LOG]] Part II.

**What it unblocked, honestly:** two loops moved `blocked` → `gated`; four stayed
`blocked` on things P1 never claimed to fix. OD-03/OD-04 went from *undecidable on
evidence* to **decidable but unanswered** — the query runs, the volume does not exist yet.

**What it did not unblock, and this is the finding:** the 7 keys that need a *verdict*.
See §1.

### Push 2 — Restore the drift guard ✅ **CLOSED 2026-08-24** *(named "P2" before ADR 0018)*
The secret was set (`SUPABASE_POOLER_URL`, first in the workflow's fallback chain) and
`Fresh database equals remote` connected for the first time. It immediately found real
drift — and the drift was **three hand-made backup tables** (`_bak_library_before_corpus`
88 cols, `_bak_seed_repair_20260813` 6, `_bak_wine_match_keys_20260812` 4 = exactly the 98
reported differences). Every other column matched. Snapshots are not schema, so `_bak_*`
is now excluded from the comparison **and printed on every run** — an exclusion you
cannot see is a blind spot.

### Push 3 — Connect a POS ✅ **overtaken by events (2026-08-25)**
Written when only **25.1%** of the 573 insight types were satisfiable without POS data.
The bridge has since been built and proven against live traffic — insight satisfiability
moved **1.4% → 67.4%** ([[POS-BRIDGE-AUDIT]]); sale-volume contract and referential
integrity are locked (ADRs 0011, 0015). Two Toast-side defects remain open in the
register (OD-64/66/67 cluster), tracked there rather than here.

### Push 4 — Give NF-B a caller ⛔ **HELD — superseded by [ADR 0029](../decisions/0029-p3-plan-of-record.md) §3**
Re-measured 2026-08-26 and the numbers hold: `20260819000000_guest_identity_minimal_slice.sql`
is **564 lines** creating `guests`, `guest_identifiers`, `guest_check_links`, with two CI
guards standing over it (`check_no_guest_name_matching.sh`, `check_no_raw_guest_channels.sh`)
and an eval — and **zero** application call sites, the only repository reference outside
migrations and scripts being a feature-flag registry entry.

**What changed is the diagnosis, not the measurement.** This push was written as an
ordering problem — *do it next*. It is not. It has no caller because **which guest surface
it serves is undecided** (OD-05 voice-agent audience, OD-07 Beli build-vs-partner), so
wiring one means an agent choosing the product. Founder call 2026-08-26: **held**, and
recorded as blocked-on-a-decision so nothing later mistakes the silence for backlog.

### Push 5 — Close the grading gap *(this is P3.0, and it is the milestone gate)*
§1's bottleneck now has a stage, a census and a gate. Measured 2026-08-26: the gateway
emits **7** task types and **1** carries a real verdict — the emitter hard-codes
`outcome_basis: "call_level_v0"` at `model-client.service.ts:387`, and the single
exception records its verdict as an ADR-0017 sidecar (`document-extractor.service.ts:169`).
Python is further along: OD-75 moved 12 sites to `parse_v1`.

Not open research — `.planning/04-specs/OD-59-VERDICT-CENSUS.md` §4 ranks 18 task types
cheapest-verdict-first with each existing check cited at `file:line`, and rows 2–9 are all
**synchronous** and **Trivial/Low** because the graders already run; only the result never
reaches the footprint.

**Unblocks:** OD-04 (Push 3's successor), P3.C Ask AI, and the 24 loops across 14 units
that measure at least one of the 7 ungraded `nf_a.*` keys.

## 2. What is explicitly NOT next

- **More org documents.** 792 is the ceiling until units do work. Retire-to-write now applies.
- **Floor Checker build.** Genuinely NEW, and `kitchen-ready` is *unmodelled* in
  `CanonicalCheck` — it needs a schema decision before code.
- **Pricing.** Founder-deferred (OD-23). Commercial stays provisional.
- **Blender / landing visuals.** Held until brand direction exists.
- **Scaffolding P3.C (Ask AI) or P3.D (model registry) "to get ahead."** They sit
  behind the P3.0 gate for a reason: the scaffolding is what accumulates the calls
  the instrument cannot yet grade ([ADR 0029](../decisions/0029-p3-plan-of-record.md) §6.3).
- **Wiring NF-B a "minimal" caller.** Offered and rejected — see Push 4.

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

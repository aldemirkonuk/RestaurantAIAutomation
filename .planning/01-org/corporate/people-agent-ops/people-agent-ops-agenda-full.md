---
type: agenda-full
division: corporate
department: people-agent-ops
status: active
metrics: [roster.truth_pct, roster.headcount_claim_variance, roster.ungraded_worker_pct, roster.card_execution_pct, roster.maturity_level_evidenced_pct, nf_a.doneability_verdict_coverage, nf_a.cost_per_task, nf_a.verified_task_success_rate]
updated: 2026-08-28
links: ["[[people-agent-ops-charter]]", "[[people-agent-ops-premortem]]", "[[people-agent-ops-agenda-board]]", "[[people-agent-ops-directive]]", "[[people-agent-ops-loops]]", "[[people-agent-ops-schedule]]", "[[people-agent-ops-agent-stack]]", "[[people-agent-ops-questions]]", "[[roster-lifecycle-charter]]", "[[roster-lifecycle-agent-stack]]", "[[performance-doneability-charter]]", "[[performance-doneability-agent-stack]]", "[[agent-fleet-agent-stack]]", "[[agent-evaluation-gates-agent-stack]]", "[[neural-footprint-instrumentation-charter]]", "[[evaluation-doneability-charter]]", "[[ai-orchestration-charter]]", "[[decision-office-charter]]", "[[red-team-charter]]", "[[0034-agent-stack-artifact]]", "[[0035-wave2-seam-reconciliation]]", "[[0038-cards-run-as-declared-scripts]]", "[[0039-activation-plan-of-record]]", "[[0017-doneability-verdicts-are-sidecar-claims]]", "[[0020-no-fabricated-answers]]", "[[corporate]]", "[[ORG_STRUCTURE]]"]
---

# People & Agent Ops — Full Agenda

**Dated 2026-08-28.** First real agenda; replaces the 2026-08-24 forecast.
Authored under [ADR 0039](../../../decisions/0039-activation-plan-of-record.md) Track B,
[`GENERATION_BRIEF.md`](../../../foundation/GENERATION_BRIEF.md) §8.

> **The founding condition changed while nobody in this department was looking.**
> The HR function of a company whose workforce is agents was written on 2026-08-24
> against a fleet it had counted by hand and a telemetry spine that could not name a
> worker. Four days later the workforce is **declared** (102 cards, ADR 0034/0038),
> **counted by a running job** (ADR 0035), and **attributable** (`SpendLogger.log()`
> has an `agent` parameter). This agenda's first act is to admit the department's own
> record was stale — and its main act is to build the record that cannot go stale
> silently again: **per-agent personnel files, joined from the index and the census**.

---

## 0. Re-grade — what four days did to the baselines

Every published counter in this department was a 2026-08-24 hand count. Verified against
the tree and against the running census on 2026-08-28:

| Counter | Published 2026-08-24 | Measured 2026-08-28 | Source |
|---|---|---|---|
| modules on disk | 26 | **24** | `memory/2026-08-28-fleet-census.md` (agent-fleet; ADR 0035 §3 sole computer) |
| registered in the class map | 23 | **23** | same |
| `DEFAULT_AGENT_SPECS` entries | 19 | **23** | `services/agent-orchestrator/core/agent_registry.py` |
| `roster.unregistered_module_count` | 3 | **1** — `recurring_order_agent` only | census; `book_scraper_agent` and `dataset_creator_agent` are **gone from `agents/`** — the first survives as `services/wine_book_scraper.py`, i.e. **reclassified, not retired**, and no register recorded either event |
| `roster.silent_default_spec_count` | 4 | **0** — every registered agent has a declared spec | `agent_registry.py`; the `{}` fallback at `:337` no longer fires for anyone |
| `roster.headcount_claim_variance` | **4** numbers (19·23·24·26) | **2** (23 registered/specced · 24 on disk); `PROJECT.md:58`'s "~24" now agrees with disk | |
| CORP-F5 — `SpendLogger.log(agent=…)` | **blocking, absent** | **LANDED** — `services/agent-orchestrator/services/spend_logger.py:269` `agent`, `:270` `agent_fallback`, `:271` `task_type`, `:274` `outcome`, `:276` `correlation_id` | |
| `nf_a.doneability_verdict_coverage` | 0%, one basis | **39 task types emit · 27 carry a verdict · 12 knowingly exempt · 0 ungraded** | `scripts/check_task_types_are_graded.py`, run by `gate-runner` (PASS, 2026-08-28) — consumed, never recomputed (TECH-F3) |
| `IS_STUB = True` modules | 5 | **5**, still refused at boot | `core/orchestrator.py:245` |

**The department was wrong in both directions, and the direction matters.** It over-stated
the roster defect count (7 → 1) and it *under*-stated its own unblocking: it carried
"per-agent cost is not derivable" as a standing line in every artifact for an unknown
number of days after the parameter that derives it had already shipped. Nothing told it.
`doneability-reviewer`'s card declares exactly that gap —
`topic: spend_logger.signature_changed # publisher: NONE` — and the gap collected its
first real cost here. **This is premortem M4 inverted: not a number we guessed, but a
blocker we kept after it closed.** It is the same disease — a record that does not
track reality — and it is why §2 is the agenda's spine rather than a nice-to-have.

**What did not change:** `roster.maturity_level_evidenced_pct` is still **0%** — the ladder
is still prose at `PROJECT.md:71`. `nf_a.verified_task_success_rate` still has no value.
`core/base_agent.py` still records liveness, not correctness. The hard half stayed hard.

---

## 1. What this agenda is

Two programs, one per team, deliberately not summed
([[people-agent-ops-charter]] §Metrics — roster truth and doneability coverage are not
commensurable).

| Program | Team | The question it closes |
|---|---|---|
| **§2 — Agent personnel files v1** | [[roster-lifecycle-charter]] | *Who is on the roster, in both populations, with what evidence per worker?* |
| **§3 — The performance board off verdict coverage** | [[performance-doneability-charter]] | *Did the work get done, what did it cost, and which number is allowed to say so?* |

Everything else on this page is a seam (§4), a finding no card can carry (§5), or a
question for the founder (§7).

**Locks respected.** No task here touches the pricing model (deferred) or brand/landing
visuals (held). This department's only cost surface is *attribution of spend to a worker* —
a measurement, not a price. It never becomes an input to what anything is sold for without
[[finance-pricing-charter]] and an unlock.

---

## 2. Program A — Agent personnel files v1

**The seed, stated plainly:** the AI-native HR function's workforce is agents, and its
records now have real data to hold. `00-index/cards.json` is a declared workforce
(102 cards / 100 units, machine-parseable, CI-gated by ADR 0038); the fleet census is a
computed workforce (24 modules, run daily by someone else). A personnel file is the
**join** — one record per worker, every column with a named producer, and the population
stamped on every row.

**Two populations, never merged into a fifth headcount** — the boundary
[[people-agent-ops-agent-stack]] §5 already drew, now load-bearing:

- **`card`** — 102 declared organisational agents across 8 divisions. Source: `cards.json`.
- **`module`** — 24 Python modules in `services/agent-orchestrator/agents/`. Source: the
  census, consumed. **This department does not count modules** (ADR 0035 §3: `fleet-census-agent`
  computes, `roster-registrar` consumes and publishes only the HR overlay).

### 2.1 The v1 schema — twelve columns, each with a producer

| # | Column | Producer | Value today |
|---|---|---|---|
| 1 | `worker` | cards.json / census | 102 + 24 |
| 2 | `population` | this department | `card` \| `module` |
| 3 | `unit` | cards.json `unit` | 100 units |
| 4 | `routing_class` | cards.json | 36 mechanical · 36 extraction · 30 judgment |
| 5 | `registered` | census (consumed) | 23 / 24 modules |
| 6 | `emits_trace` | grep — `log_decision` call sites | **7 / 24 modules** |
| 7 | `cost_attributable` | `base_agent.py:308` → `spend_logger.py:326` (ambient) | every `BaseAgent` subclass; **`recurring_order_agent` resolves to `"unknown"`** (`spend_logger.py:327`) |
| 8 | `grading_basis` | cards.json `quality_bar`; `nf_verdict.basis` | **58 / 102 cards read `NONE (gap)`** |
| 9 | `declared_gaps` | cards.json | **188 gaps across 92 / 102 cards** |
| 10 | `runs` | `scripts/agents/run_card.py` `IMPLEMENTED` | **8 / 102** |
| 11 | `memory_home` | disk — `<unit>/memory/` | **8 dirs exist; 102 cards declare one** |
| 12 | `maturity_level` | predicate ladder (§2.5) | **0% evidenced** |

Column 7 is the finding the whole department was built to produce and could not:
**attribution is ambient, not per-call-site.** `BaseAgent.__init__` stamps `agent_name`
into the log context (`core/base_agent.py:308`); `SpendLogger.log()` reads it
(`:326`) and resolves `subject_id = agent or ambient_agent or agent_fallback or "unknown"`
(`:327`). So every model call made from inside the harness is attributed *for free*, and
the single module outside the harness is the single module whose spend is anonymous.
**Roster truth is not merely correlated with cost attribution — it is mechanically the
floor under it,** and the personnel file is where that stops being a sentence and becomes
a column.

### 2.2 Tasks

| ID | Task | Doneability — how we know it moved | close_time | Evidence it stands on |
|---|---|---|---|---|
| **PAO-1** | Re-baseline every published counter in [[people-agent-ops-agenda-board]] against the 2026-08-28 census | Every counter carries a value, a producing source, and a `last_verified` date; **zero** counters cite a 2026-08-24 figure the census contradicts | **2026-09-01**, then weekly (L-PAO-3) | §0 table; `memory/2026-08-28-fleet-census.md`; `agent_registry.py` |
| **PAO-2** | Split the standing "cost is not derivable" line into the two claims it actually is | The directive's rule-1 sentence resolves to: *derivable from the NF ledger* (`spend_logger.py:269,326`) and *not derivable from `api_spend`* (`:365-374` inserts no agent, no task_type) — and no department artifact says "not derivable" unqualified again | **2026-09-04**, then monthly (L-PAO-4) | `spend_logger.py:260-278, 326-327, 365-374`; ADR 0035 §4 (the `api_spend` grain divergence, filed under OD-29) |
| **PAO-3** | Close **DO-3** with the honourable close — **and open the retirement question it hides** | Three of DO-3's four claims are extinct (verified: both named `BaseAgent` orphans absent from `agents/`; 0 registered agents lack a spec); the survivor — `recurring_order_agent` — becomes its own row with an owner and a date; **and the department records what happened to the two that left**, because *"the code can be restored, the reason cannot be reconstructed"* (directive, escalation trigger 4) and no register captured either departure | **2026-09-11** (age-out is 2026-10-05) | [[people-agent-ops-questions]] DO-3; disk listing; `services/wine_book_scraper.py`; `agent_registry.py` |
| **PAO-4** | Publish the v1 personnel-file schema (§2.1) | Twelve columns, each naming a producer; **no column computed here that ADR 0035 assigns elsewhere** — a reviewer can check that claim against the table in one pass | **2026-09-08** | `cards.json`; ADR 0035 §3; ADR 0034 §2 |
| **PAO-5** | Implement `roster-registrar` in `scripts/agents/run_card.py` — it is declared `mechanical` and sits in the 28 declared-not-implemented | `run_card.py --agent roster-registrar` exits 0, emits the personnel table + `roster.headcount_claim_variance`, **reproduces byte-identically on a rerun of the same commit** (the card's own `quality_bar`), and recomputes no census count | **2026-09-15** | `cards.json` (`roster-registrar`, routing_class `mechanical`); `run_card.py` `IMPLEMENTED` (8 of 36); ADR 0038 §2 |
| **PAO-6** | Publish `roster.ungraded_worker_pct` — **58 / 102 = 56.9%** of declared workers carry `quality_bar: NONE (gap)` | The number is on the board with the 58 names grouped by unit, and reaches each owning unit as **one** finding per unit, never 58 separate pings | **2026-09-08**, then monthly | `cards.json` (measured 2026-08-28); [[performance-doneability-agent-stack]] consumes line: *"a card reading `NONE (gap)` is an ungraded worker whose personnel file says so"* |
| **PAO-7** | Publish `roster.card_execution_pct` — **8 / 102 = 7.8%** of declared workers have ever executed | A number plus the 94-name list split by `routing_class`: 28 mechanical (buildable now), 30 judgment (**OD-03-blocked, and the row says so**), the rest extraction | **2026-09-15**, then monthly | `run_card.py` `IMPLEMENTED`; `cards.json` routing_class counts; ADR 0038 §Consequences ("28 mechanical cards await implementations") |
| **PAO-8** | The maturity ladder, **predicate-first**, over the 24 modules | Each level is a predicate a script evaluates — e.g. L1 `registered ∧ declared spec`; L2 `+ ¬IS_STUB ∧ implements process_message`; L3 `+ emits log_decision`; L4 `+ carries a verdict basis better than call_level_v0` — the ladder **stops at the number of levels the evidence supports**, and `roster.maturity_level_evidenced_pct` gets its first non-zero value | **2026-09-30** (quarterly, L-PAO-5 readiness) | premortem M5 counter-pressure; `PROJECT.md:71`; `log_decision` 7/24 measured; `nf_verdict.basis` (`20260825180000_nf_verdict.sql:26`) |

**PAO-8 is the ambitious one and the one most likely to shrink.** Level 4 as written
depends on a per-agent verdict basis, and 27 of 39 graded task types are graded at the
*task-type* level, not the *agent* level. If the join does not exist when the predicate is
written, the ladder ships with **three** levels and says why — three honest levels beat
five with two of ceremony, which is premortem M5's whole content.

---

## 3. Program B — The performance board off verdict coverage

**Consume, never recompute.** [[agent-evaluation-gates-agent-stack|gate-runner]] runs
`scripts/check_task_types_are_graded.py`; its 2026-08-28 reading is
**39 emit · 27 carry a verdict · 12 knowingly exempt · 0 ungraded → PASS**. This
department reads that table and fails reviews on it. It does not run a second census of
grading. TECH-F3 stays open and untouched.

### 3.1 The board's founding rule — two numbers, and they are not the same number

| Metric | Value 2026-08-28 | What it means | Where it comes from |
|---|---|---|---|
| `verdict.typed_coverage` | **27 / 39** task types (12 exempt, 0 ungraded) | *Coverage of kinds* — static analysis over emit sites | consumed from `gate-runner` |
| `nf_a.doneability_verdict_coverage` | **not emitted** | *Coverage of completions* — `nf_verdict ⟕ neural_footprint_event`, the charter's actual metric | **nobody has ever run this query** |

**Publishing the first as the second would be premortem M3 arriving one layer up.** M3 is
"`success_rate` became the metric because it already existed." The 2026 version is
"27/39 became the coverage number because the gate already prints it." A task type being
*gradeable* says nothing about what share of completions *were graded*. The board shows
both rows, permanently, with the second reading `not emitted` per
[ADR 0020](../../../decisions/0020-no-fabricated-answers.md) until a query returns a value —
and a review that cites the first as the second **fails the board's own check**.

### 3.2 Tasks

| ID | Task | Doneability — how we know it moved | close_time | Evidence it stands on |
|---|---|---|---|---|
| **PAO-9** | Stand up the two-number verdict board (§3.1) | Both rows render every week; the second reads `not emitted` with a reason; a citation of row 1 as row 2 is a **failing** board state, checkable by reading the labels | **2026-09-01**, then weekly (L-PAO-3) | `check_task_types_are_graded.py` output 2026-08-28; ADR 0020; premortem M3 |
| **PAO-10** | First **agent-attributed** cost readout | One query over `neural_footprint_event` grouped by `subject_id` returns per-worker cost for a named window, **and states the count of rows that resolved to `subject_id = "unknown"`** rather than dropping them. A dropped remainder is a failed readout | **2026-09-04**, then monthly (L-PAO-4) | `spend_logger.py:326-327`; `base_agent.py:308`; `20260824141116_neural_footprint_event.sql:25,36` (`subject_id`, `cost_usd`) |
| **PAO-11** | Audit the **12 knowingly-exempt** task types against the shrink-only rule | Each of the 12 is confirmed still exempt or struck off; a task type whose exemption reason has expired is filed to [[evaluation-doneability-charter]] — **we file, they decide** (directive rule 6) | **2026-10-01**, then quarterly | `check_task_types_are_graded.py` `EXEMPT` dict (per-entry reasons) and its dead/redundant-exemption checks |
| **PAO-12** | **Grade the graders** — this department's own three cards | `pao-board-keeper`, `roster-registrar` and `doneability-reviewer` each carry a verdict basis **or** a written statement of why none can exist, published on the same board as everyone else's, with no exemption this department would refuse another unit | **2026-09-30** | `cards.json`: both team cards' `quality_bar` contain `NONE (gap)`; [[performance-doneability-agent-stack]]: *"the team that owns doneability being ungraded is the finding, not the excuse"* |
| **PAO-13** | Publish a `people.blocked_days` **obituary**, not a counter | The department states **how long it was wrong about CORP-F5** — the interval between the commit that added `agent=` to `SpendLogger.log()` and 2026-08-28 — and files the missing-publisher gap that made the interval possible | **2026-09-01** | `doneability-reviewer` card's declared gap (`spend_logger.signature_changed` — publisher NONE); §0 |

**PAO-10 is a reach and is graded as one.** It needs a production read this department has
never exercised, and production has one real tenant, so a window may contain very few
agent rows — a thin result is not a broken query. If the read is unavailable, the honest
output is **the query, its plan, and the words "never run"** — not a sample, not an
estimate, not a proxy. Directive rule 1 does not relax because the field finally exists.

**PAO-13 is aspiration pending one fact this department cannot fetch:** the interval needs
a commit date, and this department does not run git. It is requested from the session that
commits, and until it arrives the obituary says *"unknown, ≥ 1 day"* rather than picking
a number.

---

## 4. Seams — filed to other units, owned by them

Findings, not assignments. Each is addressed to the named unit's `questions` file.

| ID | To | The finding | Doneability | close_time |
|---|---|---|---|---|
| **PAO-14** | [[agent-fleet-charter]] | The census fact reads *"23/24 can receive · stub-flagged 0"*, but **5 modules declare `IS_STUB = True`** and are refused at boot (`core/orchestrator.py:245`), so **18** can actually start. The census's stub test is a body heuristic (`run_card.py:101-114`) and does not read the flag | agent-fleet accepts or rejects in writing; either the census reads `IS_STUB`, or its fact line states its stub count is heuristic-only and **not** the boot-refusal count | **2026-09-08** |
| **PAO-15** | [[neural-footprint-instrumentation-charter]] | Carry the `nf_a.skill_id` ask (ADR 0039 **Track A4**) as a *personnel-file column with no source*, not a fresh request. `skill_id` appears nowhere in `supabase/migrations/`, `services/neural_footprint.py`, or `common/model-client` (grep, 2026-08-28) | The column exists on the board reading `not emitted` with the ask cited once; RM-3 has a consumer requirement rather than a wish | **2026-09-15** |
| **PAO-16** | [[roster-lifecycle-charter]] + [[decision-office-charter]] | `recurring_order_agent` is now **simultaneously** the last roster defect and the only cost-attribution hole — one module, two metrics, one decision | Resolved to *registered* **or** *declared out of scope with a named health surface*, recorded as a decision; either way the department publishes what its spend resolves to (`"unknown"`) | **2026-09-11** |
| **PAO-17** | [[decision-office-charter]] | **94 of 102 declared workers have a `memory:` home that does not exist on disk.** Memory dirs are created by execution (`run_card.py:345-348`), so the declared memory layer is 8/102 real. Whether that is a defect or the intended lazy behaviour is not this department's call | Decision Office rules it a defect or the design; the personnel file's column 11 stops being ambiguous | **2026-09-22** |

---

## 5. Findings no card or loop can carry

Per §8.1: *a task no card or loop can carry is a finding to record, not a task to list.*

1. **This department has no `memory/` directory**, and `pao-board-keeper` declares
   `memory: people-agent-ops`. The declared home for the department's own semantic memory
   does not exist. It cannot be created by any loop here — only by the department's card
   running, and `pao-board-keeper` is `extraction`, which ADR 0038 deliberately did not
   implement. **The board keeper cannot remember anything until OD-03 resolves or its
   scope is narrowed to something mechanical.** Recorded, not scheduled.
2. **`dependency.close_time_breached` has no publisher** (declared gap on this
   department's card). Every close-time in this agenda is therefore enforced by a weekly
   human sweep, which bounds the blind spot at 7 days and no better. §0 is what the blind
   spot costs.
3. **The two populations must never become a fifth headcount.** 102 cards and 24 modules
   count different things. `roster.headcount_claim_variance` compares *declared rosters in
   agent-stack docs against the computed census* (ADR 0035 §3) — it does not add them.
4. **Human Ops is still correctly empty.** Zero employees; no human-review rubric is
   scheduled here. The ordering consequence stands on the record: the agent-review rubric
   (PAO-8, §3) will exist before any human one. That is intended, not an oversight.

---

## 6. Why now

- **Because the record went stale in four days and nothing said so.** §0 is not a
  correction, it is a *measurement of the department's own latency*, and it is the
  strongest argument that exists for §2's personnel files.
- **Because the second job just became possible.** CORP-F5 landed. The department that
  spent its founding document explaining why it could not review a worker can now name one.
  A department that stays blocked after its blocker clears is worse than one that was
  blocked.
- **Because `cards.json` is a personnel database that nobody has read as one.** ADR 0034
  §Consequences promised the census *"a declared baseline to reconcile against"* and
  nothing has done the reconciliation. It is one join, it is available today, and it
  already yields three numbers the org does not have: 56.9% ungraded, 7.8% executing,
  92/102 carrying declared gaps.
- **Because 58 declared workers with no grading basis is the org's largest single
  measured quality gap** — larger than the roster defect it replaced — and it lives in
  this department's boundary by construction.

---

## 7. Questions for the founder

1. **`recurring_order_agent` — port it, or bless it?** Asked on 2026-08-24 and now sharper:
   it is the *only* remaining roster defect **and** the only worker whose spend books to
   `"unknown"`. One decision closes two metrics. Its own docstring (`:17-21`) argues for
   "bless it"; if so, it still needs a health surface, because today it has none.
2. **How many maturity levels?** `PROJECT.md:71` targets Level 4. The evidence available
   today supports three predicates cleanly and a fourth only if a per-agent verdict join
   exists. This department would rather ship three honest levels than five with two of
   ceremony — confirm, and PAO-8 ships three.
3. **Does this department get a production read?** PAO-10 is the first task in its history
   that requires querying the live NF store rather than the repo. Without it,
   `nf_a.doneability_verdict_coverage` stays `not emitted` forever — correctly, but
   permanently. With it, the department's second job starts.
4. **58 of 102 declared workers are ungraded. Is that a wave, or a ratchet?** Grading all
   58 is a program nobody has scoped. The alternative is a ratchet: no *new* card may enter
   `cards.json` with `quality_bar: NONE (gap)`, and the 58 burn down opportunistically.
   The ratchet is cheap and slow; the wave is expensive and complete.
5. **When the roster and the pitch disagree, which one changes?** Still open, and now
   nearly moot in the department's favour: `PROJECT.md:58`'s "~24 agents" **agrees** with
   the disk for the first time. The question survives because the next disagreement will
   be about the 102 declared card agents, a number no external artifact has ever quoted.

---
type: agenda-full
division: applied-ai
department: ai-orchestration
status: provisional
metrics: [nf_a.task_success_rate, nf_a.cost_per_task, nf_a.doneability_verdict_coverage, safety.unconfirmed_mutation_count, routing.routed_client_share, fleet.live_agent_ratio]
updated: 2026-08-24
links: ["[[ai-orchestration-charter]]", "[[ai-orchestration-premortem]]", "[[ai-orchestration-agenda-board]]", "[[ai-orchestration-directive]]", "[[ai-orchestration-loops]]", "[[ai-orchestration-schedule]]", "[[harness-runtime-charter]]", "[[agent-fleet-charter]]", "[[model-routing-inference-economics-charter]]", "[[agent-evaluation-gates-charter]]", "[[action-safety-the-human-gate-charter]]", "[[research-math-charter|research-and-math-charter]]", "[[decision-office-charter]]", "[[technology]]", "[[README]]"]
---

# AI Orchestration — Full Agenda

> **PROVISIONAL — no work done yet.** This is forecast, not fact.

## What

Five teams, one dependency, one open fork, and one number that does not exist yet.

The dependency is **L4**. [[README]] §1 records that the Neural Footprint *"emits
nothing yet — no cost/token instrumentation in `apps/api-gateway`."* This department
is the largest producer of NF-A and therefore the unit most blocked by that. Four of
the six metrics in [[ai-orchestration-charter]] are currently uncomputable — not bad,
**absent**. Almost everything below is downstream of fixing that.

## How

Sequenced, because these are not five parallel starts. The ordering claim is the same
one [[README]] §8 makes: parallelism pays once the interface is fixed.

### Step 0 — make anything measurable at all *(blocks 4 of 5 teams)*

Emit one NF-A event from one agent, end to end, and prove the schema
([[README]] §4.4) survives contact. Not the whole fleet — **one agent, one task
type, one event**. The candidate is `document-extractor`, because it is the task with
both a gold set (`services/active_learning_service.py:1-17` describes 200
gold-standard documents) and a real cost, so it exercises doneability and
`cost_per_task` in the same event.

Until this lands, [[model-routing-inference-economics-charter]],
[[agent-evaluation-gates-charter]] and half of [[harness-runtime-charter]] are writing
policy about numbers nobody can read.

### Step 1 — count the fleet honestly *(no dependencies, cheap, high leverage)*

Publish `fleet.live_agent_ratio` and make the split load-bearing. The work is small:
turn the warning already sitting in `core/orchestrator.py:214-217` into a check, and
decide what happens to the three orphan modules (`book_scraper_agent.py`,
`dataset_creator_agent.py`, `recurring_order_agent.py`) that are registered nowhere.
Owner: [[agent-fleet-charter]].

### Step 2 — one routed client *(depends on Step 0 for the metric, not for the work)*

Seven gateway files each declare their own `https://api.anthropic.com/v1/messages`
constant and none of the seven writes to `api_spend`. Route them through one client
with retry, timeout and token accounting in one place. `routing.routed_client_share`
goes from near-zero to a number that can be driven upward.
Owner: [[model-routing-inference-economics-charter]].

### Step 3 — the human gate becomes one schema, and gets instrumented before it gets traffic

Today the guarantee that AI never silently mutates stock, money, or outbound vendor
email is upheld by **four independent conventions**, not one mechanism
(`technology.md:441`). Unify them behind the `.planning/FUTURES.md` §8.1 action
schema. Critically, per [[ai-orchestration-premortem]] #3: **instrument
time-to-confirm before volume arrives.** Retrofitting that measurement after habits
form measures the habit, not the gate.
Owner: [[action-safety-the-human-gate-charter]].

### Step 4 — close OD-03 with evidence

Run the scoped bake-off `OD-03 (OPEN-DECISIONS.md:27)` asks for: hermes-agent vs
deepseek-harness vs extending in-house `base_agent.py`, on this repo's actual
workloads. **This agenda does not have a preferred answer and should not acquire one
before the bake-off.** Steps 0–3 all produce inputs to it — you cannot compare harness
overhead without cost instrumentation, and you cannot compare task outcomes without
doneability verdicts. That sequencing is the argument for running it *after* Step 0,
not first.
Owner: [[harness-runtime-charter]], with [[research-math-charter|research-and-math-charter]] on methodology.

### Step 5 — evals for the judgment tasks, not just the scoreable ones

Extraction is already gated (`.github/workflows/ci.yml:226-230`). Vendor-reply quality
is not, and it is the commercially load-bearing one. Build the rubric before building
the dashboard.
Owner: [[agent-evaluation-gates-charter]], methodology from
[[research-math-charter|research-and-math-charter]] — **contingent on the seam below**.

## Why now

Three reasons, in descending order of how much they hurt if ignored:

1. **The instrumentation gap compounds.** Every week without NF-A is a week of agent
   decisions that leave no durable trace. That trace is not recoverable later — it is
   the definition of the neural footprint ([[README]] §4.1), and unrecorded decisions
   are gone. This is the only item on this agenda with a **decaying** cost of delay.
2. **OD-03 is aging into a sunk cost.** `base_agent.py` is 1,053 lines of good work on
   the layer most likely to be replaced. Every month the fork stays open raises the
   write-off — [[ai-orchestration-premortem]] #1.
3. **The human gate is cheap to instrument now and expensive to instrument later**,
   for behavioral rather than technical reasons.

## Next steps

| # | Step | Owner | Blocked by |
|---|---|---|---|
| 0 | One NF-A event, end to end, from `document-extractor` | [[harness-runtime-charter]] + [[research-math-charter|research-and-math-charter]] | schema fork in [[README]] §4.4 (table-per-track vs polymorphic) |
| 1 | Publish `fleet.live_agent_ratio`; triage the 3 orphan modules | [[agent-fleet-charter]] | — |
| 2 | One routed model client; `api_spend` from the gateway | [[model-routing-inference-economics-charter]] | — |
| 3 | Unify the action schema; instrument time-to-confirm | [[action-safety-the-human-gate-charter]] | — |
| 4 | OD-03 bake-off | [[harness-runtime-charter]] | Step 0 |
| 5 | Vendor-reply rubric + weekly AI eval workflow (D-25) | [[agent-evaluation-gates-charter]] | Step 0; the TECH-F3 seam |

Step 1, 2 and 3 have **no blockers**. If this agenda produces nothing else in its
first month, it should produce those three.

## Questions for the founder

1. **The evaluation seam — the one that must not be answered by drift.** Does
   [[agent-evaluation-gates-charter]] exist as an operations team alongside Research &
   Math's methodology, or is it one team inside Intelligence? The department's
   position is *methodology vs. operations*, and its own stated fallback is: **if that
   line fails, merge rather than duplicate** (`technology.md:406`). We would rather
   have a merge now than a duplicate discovered in six months.
2. **✅ The fork numbered OD-21 in `technology.md:845` is now `TECH-F3`.** It collided
   with the real OD-21 (Obsidian structural workflow, `OPEN-DECISIONS.md:138`, already
   locked); the Decision Office renamespaced it ([[FORK-REGISTRY]]).
   → [[decision-office-charter]].
3. **OD-03: what closes it, and by when?** The decision log names the method (a scoped
   bake-off, no pick from repute). It does not name a date. A fork with a method and
   no date is the thing [[ai-orchestration-premortem]] #1 is about.
4. **NF-A schema shape.** [[README]] §4.4 leaves table-per-track vs one polymorphic
   table open, and calls it *"a real schema decision with query-performance
   consequences."* Step 0 cannot start without an answer, even a provisional one.
5. **The three orphan agent modules.** `book_scraper_agent.py`,
   `dataset_creator_agent.py`, `recurring_order_agent.py` are referenced by nothing but
   their own tests. Delete, or wire up? `recurring_order_agent` is the sharp one — it
   owns scheduled *purchasing* with no harness guarantees and no human gate.
6. **Does one of these five teams not need to exist?** Our honest answer is no — the
   five questions are genuinely different — but the count is the founder's to
   challenge, and TECH-F1 is open on exactly that.

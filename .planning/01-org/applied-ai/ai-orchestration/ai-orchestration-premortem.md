---
type: premortem
division: applied-ai
department: ai-orchestration
status: exists
metrics: [nf_a.task_success_rate, nf_a.cost_per_task, nf_a.doneability_verdict_coverage, safety.unconfirmed_mutation_count, fleet.live_agent_ratio]
updated: 2026-08-24
links: ["[[ai-orchestration-charter]]", "[[ai-orchestration-loops]]", "[[ai-orchestration-directive]]", "[[harness-runtime-premortem]]", "[[agent-fleet-premortem]]", "[[model-routing-inference-economics-premortem]]", "[[agent-evaluation-gates-premortem]]", "[[action-safety-the-human-gate-premortem]]", "[[research-math-charter|research-and-math-charter]]", "[[red-team-charter]]", "[[technology]]", "[[README]]"]
---

# AI Orchestration — Premortem

> Written at founding, before success is assumed.

It is **2027-08-24**. AI Orchestration has failed. Not loudly — the orchestrator is
up, the health endpoint is green, the retries are rare. It failed in the five ways
below, most likely first.

---

## 1. The department hardened a harness that a decision later threw away

**What happened.** OD-03 stayed open. Not by neglect — by the ordinary gravity of an
open fork with no owner and no deadline. Meanwhile [[harness-runtime-charter]] did
the only rational thing available to it: it kept making `base_agent.py` better. Sagas
got compensation ordering, the registry got a third tier, the message bus got a
smarter circuit breaker. In month nine somebody ran the bake-off the decision log
asked for, `hermes-agent` won on the workloads that matter, and roughly a year of
work on the layer **most likely to be replaced** was written off.

**Earliest observable signal.** `core/base_agent.py` grows past ~1,300 lines with no
bake-off scheduled. More precisely: the first commit that adds a *new capability*
(not a bug fix) to `core/` while `OPEN-DECISIONS.md:24` still reads OD-03 as open.

**Counter-pressure.** OD-03 gets a **close-time, not a resolution** — a dated
bake-off in [[ai-orchestration-schedule]], scoped to this repo's real workloads per
`OD-03 (OPEN-DECISIONS.md:24)`. Until it closes, [[harness-runtime-charter]] is on a
**stated diet**: bug fixes, instrumentation, and interface-narrowing only. Making
`BaseAgent`'s surface *smaller* is portable work under any of the three outcomes;
making it *richer* is a bet on one. That rule is written into
[[ai-orchestration-directive]] and it is the reason the directive has a harness-fork
branch at all.

---

## 2. "Registered" kept meaning "live", and a capability was sold that does not exist

**What happened.** This one has already started. The repo has 26 agent modules;
`core/orchestrator.py:174-211` registers 23; five of those are stubs whose
`process_message()` only logs; three modules are referenced by nothing but their own
tests. Somebody counted files, or counted registrations, and wrote "26 agents" in a
deck. A customer commitment landed on `compliance_agent`. The gap was discovered at
demo time, and the discovery was not a bug report — it was a credibility event.

**Earliest observable signal.** Any artifact outside `services/agent-orchestrator/`
stating an agent count. A number in a README, a pitch deck, a roadmap line, a status
page. The signal is the *number*, not its value: the moment fleet size is quoted
without the live/stub split, the trap is already set.

**Counter-pressure.** Three things, all cheap:
(a) `nf_a.task_success_rate` **never averages stubs into the fleet figure**
(`technology.md:348-350`) — a stub that logs and returns would post a perfect score;
(b) `fleet.live_agent_ratio` is a first-class metric on
[[ai-orchestration-agenda-board]], defined as *modules that can receive a message ÷
modules on disk*, currently ≈18/26;
(c) the repo's own warning at `core/orchestrator.py:214-217` gets promoted from a
code comment into a CI check that fails if a stub is counted as enabled.
[[agent-fleet-charter]] owns all three.

---

## 3. The gate became a reflex, and the audit trail lied about it

**What happened.** `ask → propose → confirm → execute` held architecturally. Every
mutation had an `executed_by` and an `executed_at`. And the founder clicked Confirm
fifty times a day, at speed, without reading, because the proposals were right 94% of
the time and reading them cost more than the 6% did. Then a proposal was wrong in a
way that mattered — a reorder against the wrong provider, a stock adjustment on the
wrong lot — and the audit trail said, truthfully and uselessly, that a human approved
it.

**Earliest observable signal.** **Time-to-confirm.** Median seconds between an action
appearing in `one-tap-actions` and `executed_at`. When that median falls under a few
seconds, or when the *distribution* collapses (no long tail of "thought about it"),
approval has become reflex. A second signal: confirmation rate approaching 100% — a
gate that never rejects anything is not gating.

**Counter-pressure.** [[action-safety-the-human-gate-charter]] instruments
time-to-confirm and rejection rate **from day one, before the volume arrives** —
retrofitting it after the habit forms measures the habit, not the gate. Then:
per-action-family autonomy tiers so low-stakes families stop competing for attention
with money and stock, and a **deliberate friction floor** on the families
`.planning/FUTURES.md` §8.2 gates hardest. The metric is not "was there a
confirmation" but "was there a *decision*".

---

## 4. Cost was optimized, quality was not measured, and the savings were repaid with interest

**What happened.** `nf_a.cost_per_task` finally started emitting, and it was the first
NF-A number anyone could see. Being visible, it got optimized. A cheaper model was
substituted for invoice extraction because the cost chart improved and nothing
objected — because nothing *could* object: `nf_a.doneability_verdict_coverage` was
near zero, so extraction quality had no number at all. Field-level errors leaked into
procurement for two months. The repair work cost more than the inference ever did.

**Earliest observable signal.** A model ID changes in a commit that cites cost and
does not cite an eval run. `scripts/benchmark_haiku_vs_sonnet.py` exists precisely to
prevent this and has been run once. The signal is its `git log`: a substitution
shipped while that script's last run predates it.

**Counter-pressure.** The routing decision is **gated on doneability, not price** —
routing picks the cheapest model that *passes*, and
[[agent-evaluation-gates-charter]] defines passing
(`technology.md:399-400`). Mechanically: no model substitution merges without a
benchmark run attached, which is a CI gate in the shape
`.github/workflows/ci.yml:226-230` already uses for merge policies. The two teams are
separate for exactly this reason — the team that saves the money must not be the team
that decides whether quality held.

---

## 5. Evals were built where scoring was easy, and the dashboard went green over an unmeasured product

**What happened.** Extraction against a gold set is scoreable, so it got scored. OCR
confidence got a report. Merge policies got a CI gate. And the question the business
actually turns on — *was this a good reply to a vendor?* — got a thumbs-up icon and no
rubric, because writing one is hard and nobody could agree on it. Twelve months of
green dashboards described the easy half of the product. The judgment half was
unmeasured the entire time, and the first real evidence about it came from a customer
leaving.

**Earliest observable signal.** The eval corpus composition. When
`nf_a.doneability_verdict_coverage` is computed *per task family* rather than in
aggregate, this shows up immediately: extraction at 80%, negotiation and vendor reply
at 0%. An aggregate number hides it; a per-family number cannot.

**Counter-pressure.** Coverage is reported **per task family, never as one number**,
and the families with no verdict are named on the board rather than omitted from it —
the same anti-averaging rule [[ai-orchestration-charter]] applies to the department
metric set. Judgment tasks get a **human-rated rubric with inter-rater agreement**
rather than nothing; a low-n rubric that exists beats a high-n metric of the wrong
thing. Methodology here is [[research-math-charter|research-and-math-charter]]'s (the seam in
[[ai-orchestration-charter]] §Non-goals); running it is
[[agent-evaluation-gates-charter]]'s.

---

## The shape all five share

Four of the five are the same failure wearing different clothes: **a green signal
produced by a system that is not measuring the thing that matters.** Registered ≠
live. Confirmed ≠ decided. Cheap ≠ correct. Scored ≠ scored on what counts. Only #1
is different in kind — it is a decision that failed to close, which is the failure
mode [[ORG_STRUCTURE]] §3 built the Decision Office to prevent.

That is why every loop in [[ai-orchestration-loops]] names a close-time, and why
[[ai-orchestration-agenda-board]] shows a **set** of numbers rather than a score.

**For [[red-team-charter]]:** the highest-value attack on this department is not a
prompt injection. It is to find the metric that is green because nothing is watching,
and #3 (time-to-confirm) is where we think you should start.

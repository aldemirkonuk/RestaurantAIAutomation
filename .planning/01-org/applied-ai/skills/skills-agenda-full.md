---
type: agenda-full
division: applied-ai
department: skills
status: active
metrics: [skills.registry_size, skills.protocol_compliance_rate, skills.firing_rate_30d, skills.deletions_per_quarter, skills.script_to_skill_ratio]
updated: 2026-08-28
links: ["[[skills-charter]]", "[[skills-premortem]]", "[[skills-directive]]", "[[skills-loops]]", "[[skills-schedule]]", "[[skills-agent-stack]]", "[[skills-agenda-board]]", "[[skill-registry-authoring-agenda-full]]", "[[skill-lifecycle-anti-sprawl-agenda-full]]", "[[skill-harvesting-agenda-full]]", "[[0039-activation-plan-of-record]]", "[[0038-cards-run-as-declared-scripts]]", "[[README]]", "[[technology]]", "[[decision-office-charter]]", "[[research-math-charter|research-and-math-charter]]"]
---

# Skills — Agenda, 2026-08-28

The registry moved **0 → 4** on 2026-08-28 (ADR 0038). This agenda starts from
that state, not from the charter's zero, and it starts with an uncomfortable
admission: **the department's own sequencing rule is already broken.**
[[skills-premortem]] M2 says *telemetry precedes skill #2*. There are four skills
and no telemetry. So the first agenda of a department built to stop sprawl opens
by conceding that sprawl got a four-file head start, and every task below is
either a brake being fitted while the vehicle moves, or a measurement that tells
us how fast it is going.

---

## 0. The state this agenda starts from — measured 2026-08-28

| Fact | Value | How to re-derive |
|---|---|---|
| Committed skills | **4**, all §3.3-compliant | `python3 scripts/agents/run_card.py --agent registry-clerk` |
| Firing telemetry | **absent** — `nf_a.skill_id` is not a column | `run_card.py:254` hard-codes `"unmeasurable — nf_a.skill_id does not exist"` |
| The `scripts/` reservoir | **84** top-level entries · **21** `check_*` guards (9 `.sh` + 12 `.py`) · **16** `scripts/check_` invocations in CI | `ls scripts/ \| wc -l`; `ls scripts/check_*`; `grep -c "scripts/check_" .github/workflows/ci.yml` |
| `skills.script_to_skill_ratio` | **84 : 4** (charter baseline: 59 : 0) | the two counts above |
| The proposed-skill supply line | **233 rows** across the 100 `*-agent-stack.md` §3 tables — 228 distinct names; T2 **188**, T3 **35**, T1 **9**, **T4 1** | parse `## 3. Skills` in every `*-agent-stack.md` |
| …of which cite a checkable artifact | **187 / 233 (80%)** — the other **46** are candidates, not admissions ([[skills-directive]] node C) | regex for `path:line` / PR / dated session in the Past-instance cell |
| …name collisions across units | **5** (`citation-reverify`, `metric-claim-census`, `insight-candidate-reach`, `endpoint-guard-census`, `webhook-signature-audit`) | duplicate names in the same parse |
| Unit docs : committed skills | **40 : 4** (premortem M5 counted 28 : 0) | `find .planning/01-org/applied-ai/skills -name '*.md' \| wc -l` |
| Docs that trip the 60-day rule on 2026-10-23 | **32 of 36** still read `updated: 2026-08-24` | `grep -h '^updated:' …/skills/*.md …/skills/teams/*/*.md \| sort \| uniq -c` |

**The number that reframes the department.** 233 proposed skills against a
registry of 4 is a 58× overhang, and **232 of the 233 are somebody else's to
write** — exactly one row in the entire corpus is T4. The department's job is
therefore not authoring. It is being the thing that stands between 233 proposals
and one landfill, at a moment when the only mechanism that could sort them
(firing telemetry) does not exist. That is the agenda.

---

## 1. The claim this agenda makes

The 2026-08-24 sequencing claim was **place → signal → brake → volume**. Place
happened; volume started anyway; signal and brake did not. Rather than restate a
sequence reality has overtaken, this agenda commits to a different one:

> **Rate-limit volume to what the brake can catch up to, and make every
> unmeasurable thing loudly countable in the meantime.**

Concretely: admissions capped and gated in CI (Movement 1), the telemetry
consumed the week it exists rather than negotiated then (Movement 2), and the
department's own retirement kept on a date the org's cron already knows
(Movement 3).

---

## 2. Movement 1 — the gate becomes machinery

Owner: **[[skill-registry-authoring-charter]]**. [[skill-harvesting-charter]]
stays **GATED** (its trigger is ≥15 skills; the registry holds 4), so every
harvesting task below runs *inside* registry-authoring, per that charter's own
§GATED clause. Nobody is staffed to harvesting by this agenda.

| # | Task | Doneability | Close | Evidence |
|---|---|---|---|---|
| **SK-1** | **Sweep the reservoir and publish the corrected census.** The first harvest sweep lands as dated memory facts via `run_card.py --write-memory` — not a new document. It supersedes three stale counts at once: the charter's *59 entries / 5 guards*, [[technology]] §4.3's *four `check_*.sh`*, and the 59:0 ratio. | A reader re-derives every number in §0's reservoir rows with one shell command each; the sweep names which of the 84 entries are *procedures with a trigger* and which are data/fixtures — the candidate set, sized. | **2026-09-04** | `ls scripts/` = 84 · `scripts/check_*` = 21 · `ci.yml` carries 16 `scripts/check_` refs · [[skills-charter]] §Evidence today ("59 entries", "5 CI guards") |
| **SK-2** | **Grade the 233-row supply line into an ordered intake queue.** Every row sorted into exactly one of: *admissible now* · *candidate (no citable instance)* · *merge (collision)* · *not-ours (owning dept ≠ proposer)*. The buckets must sum to 233. | The four bucket counts are published in [[skills-agenda-board]] and sum to 233; the 5 measured name collisions each resolve to one skill or one rejection before either is committed. | **2026-09-18** | `registry-clerk` card `consumes: the §3 tables of agent-stack docs (wave 2's proposed-skill supply line)` (`cards.json`) · 233/187/46/5 measured 2026-08-28 |
| **SK-3** | **Admit skills 5–8 at a rate the brake can survive: ≤2 per week.** Not a target — a ceiling, chosen because the brake is being built in parallel and M2 is already breached. | `registry_size` reaches 8 with `protocol_compliance_rate` reading 8/8 at every census; any week admitting >2 is logged on the board as a directive violation, not quietly absorbed. | **2026-09-30** | `run_card.py:230-248` is the measuring instrument · [[skills-premortem]] M2 (breached at 4) |
| **SK-4** | **`check_skill_protocol.sh` — the §3.3 gate as a blocking CI guard.** Today §3.3 is *reported* by `run_card.py::_skills_census` and never fails a build. The guard checks the four fields, enforces M4's rule (`owning_department` may never be `skills` outside T4), and flags trigger/description collisions against the committed set. Exit **2** when it cannot check. | The guard fails on a deliberately broken fixture, passes the current tree, and appears as a named job in `ci.yml` beside the 16 guards already wired. | **2026-09-11** | 21 guards on disk; `agent-card-contract` at `ci.yml:55-75` is the exact shape to copy · [[skills-premortem]] M4 ("CI-checkable on the day it lands") |
| **SK-5** | **Publish `skills.registry_changed` — close the card's own declared gap.** The SK-4 job emits the event both `skills-orchestrator` and `staleness-reaper` already name as a trigger. | Two cards' trigger lines stop being aspirational; `cards.json`'s `declared_gaps` entry for `skills-orchestrator` is removed by the next index rebuild, not by editing prose. | **2026-09-11** (rides SK-4) | `cards.json` → `skills-orchestrator.declared_gaps[0]` · [[skills-agent-stack]] §5 gap row 1 |

---

## 3. Movement 2 — consuming Track A4, the day it lands

Owner: **[[skill-lifecycle-anti-sprawl-charter]]**. ADR 0039 **Track A4** builds
`nf_a.skill_id` (RM-3 `neural-footprint-instrumentation` owns the column; SRE
owns the runner cron). Skills does **not** design it —
[[skills-directive]] §Not decided here is explicit that we are a consumer
requesting a field. What this agenda owns is everything on the read side, ready
before the write side arrives.

| # | Task | Doneability | Close | Evidence |
|---|---|---|---|---|
| **SK-6** | **Hand RM-3 a written consumption spec before the column ships.** What emits a `skill_id`, at what granularity, what happens when a skill fires inside another skill, and exactly what `firing_rate_30d` computes from — so the column lands usable on the first try instead of after a design round-trip. | The spec is a row in `neural-footprint-instrumentation`'s questions file; on the day the column lands, `firing_rate_30d` computes with no schema change requested back. | spec **2026-09-11**; consumption **≤7 days after A4 lands** | [[0039-activation-plan-of-record]] Track A4 · `run_card.py:254` · [[skills-loops]] L1 `status: blocked` |
| **SK-7** | **Turn the 30-day review on, with deletions as the success criterion.** The first staleness run that reads a real number must produce, per skill, either a deletion PR or a written keep-with-reason. Reviews without either are M1 arriving. | A run producing zero deletions **and** zero written keeps escalates to [[red-team-charter]] the same week — the department does not get to report on its own core failure mode alone. | **≤30 days after A4 lands**; hard backstop **2026-11-24** | [[skills-loops]] L2 · `run_card.py:251-267` already emits the table shape · [[skills-directive]] §Escalation trigger 1 |
| **SK-8** | **Build the paired-deletion guard now; arm it when N exists.** Above the registry ceiling **N**, a skill-adding PR must delete one or carry a written exemption. N is a founder call — *a department that sets its own brake has no brake*. Ship the guard in dry-run with `N` unset (exit 0 with a notice), so the founder's number is a one-line config change rather than a project. | Guard merged, tested against a fixture at `N=5`; flipping it to blocking is a one-line diff with no new code. | guard **2026-10-09**; arming on the founder call | [[skills-premortem]] M1 counter-pressure 3 · [[skills-directive]] gate nodes G→H |

> **Graded honestly:** SK-8's *effect* is aspiration pending a decision. Its
> *construction* is not — that part closes on 2026-10-09 regardless, and is
> deliberately scheduled so the answer to "what is N?" costs nothing to apply.

---

## 4. Movement 3 — the department audits itself

Owner: **`skills-orchestrator`** ([[skills-agent-stack]] §2), which already
carries the contested weekly job until OD-25 names an owner.

| # | Task | Doneability | Close | Evidence |
|---|---|---|---|---|
| **SK-9** | **Pre-register the 2026-11-24 self-judgment.** OD-24 is **Agreed** (Resolved 2026-08-24): the self-retirement trigger is adopted — fewer than 5 committed, *firing* skills on that date collapses Skills into [[ai-orchestration-charter]]. `loop-watcher.yml:19` already runs the date. This department writes the recommendation, not red-team. | On 2026-11-24 the run reports `registry_size` **and** firing count; below 5 firing, a written collapse recommendation from this department exists within 7 days. | **2026-11-24**, immovable | `OPEN-DECISIONS.md` Resolved OD-24 · `loop-watcher.yml:4-12,19` · [[skills-premortem]] M5 |
| **SK-10** | **Beat the 2026-10-23 staleness cliff on our own 40 files.** 32 of 36 dated docs here still read `updated: 2026-08-24` and trip the 60-day rule in one burst. Under retire-to-write, each either earns a new date through real work or is retired. | By 2026-10-23 no file under `01-org/applied-ai/skills/` is stale-by-default; the **docs : skills** ratio (40:4 today) is published on the board next to `registry_size`. | **2026-10-23** | `loop-watcher.yml:4-9` (names the date and the cause) · [[skills-premortem]] M5 signal |
| **SK-11** | **Carry OD-25 to the Decision Office as a decision-ready packet, not a question.** The fork is documentary: foundation README §6 assigns the weekly skill-health job to Research & Math, [[technology]] §4.2 assigns it here. The department's position is already written ([[skills-charter]] §Two seams). | The packet names the two documents and the exact edit each needs, so closing OD-25 is one commit. | packet **2026-09-04**; OD-25 out of the Open table **2026-09-30** *(dependent — not ours to force)* | `OPEN-DECISIONS.md` OD-25 (open; the Resolved OD-25 row records the principle only) |
| **SK-12** | **Answer TECH-F4 by census, not opinion.** The monthly L4 census publishes `registry_size` against 15 with a one-line verdict. If 15 is not reached by 2026-11-24, this department recommends folding [[skill-harvesting-charter]] into registry-authoring and retiring its 9 files — the retire-to-write accounting done by us, on ourselves. | A dated verdict line exists after every monthly census; the 2026-11-24 one is binary. | monthly; binary at **2026-11-24** | [[technology]] §4.3 gate + *"cut this one first"* · `FORK-REGISTRY.md:65,220` (16 citations in 12 files) · [[skills-loops]] L4 |

---

## 5. The two reaches

Ambition, graded with the same discipline as everything above.

| # | Reach | Doneability | Close | Grade |
|---|---|---|---|---|
| **SK-13** | **`skill-create` — make the compliant path faster than the bypass.** The department may own T4 and nothing else, and the corpus proposes exactly **one** T4 skill in 233 rows. So this is the whole legitimate authoring surface, and [[skills-premortem]] M3 says the protocol loses unless it is *cheaper* than writing a script. `skill-create` scaffolds a `SKILL.md` from the motivating commit, pre-filling trigger, past instance, and owning department; the human writes doneability, which is the only field a machine should not guess. | Median time-to-compliant-`SKILL.md` across admissions 5–8 beats the hand-authored baseline set by the four admitted 2026-08-28; the *marginal* `script_to_skill_ratio` (new scripts vs new skills per month) falls below the 84:4 standing rate. | **2026-10-09** | **Real** — past instance cited in [[skills-schedule]]; blocked on nothing |
| **SK-14** | **Invert the enforcement: make the bypass carry the cost.** A CI *notice* — never a block — on any PR adding a `scripts/check_*` procedure with neither a `SKILL.md` nor a one-line waiver in the PR body. The registry is not being routed around by malice; it is being routed around because `scripts/` asks for nothing. | A row in engineering's questions file plus a dated verdict from the founder or [[architecture-review-charter]]; if approved, notice-only for a full month before any escalation is even proposed. | ask filed **2026-09-11**; verdict **2026-10-09** *(dependent)* | **Aspiration pending a decision** — it touches another division's PR flow and is not ours to impose |

---

## 6. What this agenda refuses, and why

Five things that look like obvious work and are not.

1. **A department-local firing log while waiting for `nf_a.skill_id`.** Rejected.
   It manufactures a second ledger at a different grain — precisely the debt the
   org is currently paying down on spend (ADR 0039 **A2**: `api_spend` lacks
   `task_type` while the NF row carries it). Buying a signal now by creating the
   exact class of divergence Track A is unwinding is a bad trade at any price,
   and [[skills-directive]] forbids us designing the schema regardless.
2. **Harvesting all 84 `scripts/` entries into `SKILL.md` wrappers.** Rejected by
   [[skills-loops]] L5's named anti-pattern: *sprawl delivered by the mechanism
   meant to prevent it*. SK-1 produces a **sized candidate set**; SK-3 admits at
   ≤2/week.
3. **Staffing [[skill-harvesting-charter]] early to run SK-1.** Rejected.
   Overriding a written trigger is a decision, not a judgement
   ([[skills-directive]] §Not decided here). The sweep runs inside
   registry-authoring, which is what the gated charter says to do.
4. **Writing the bodies of the 188 T2 skills the corpus proposes.** Rejected —
   this is [[skills-premortem]] M4 with a spreadsheet. SK-4's guard makes the
   refusal machine-enforced rather than a matter of willpower.
5. **A new document to track the intake queue.** Rejected under retire-to-write
   (CLAUDE.md §4). The mechanism exists: memory facts written by
   `run_card.py --write-memory` plus the board. Doc #41 in a department whose own
   failure signal is *documents outnumbering artifacts* would be self-parody.

---

## 7. Seams this agenda touches

Each is an ask into another unit's questions file, never an edit there.

| Seam | Unit | The ask |
|---|---|---|
| `nf_a.skill_id` (Track A4) | RM-3 `neural-footprint-instrumentation` | SK-6's consumption spec, before the column is cut |
| The weekly runner cron (Track A4) | `reliability-sre` | the `loop-watcher.yml`-sibling that ticks `run_card.py`; without it SK-7 has no scheduler |
| **OD-25** owner · **TECH-F4** | [[decision-office-charter]] | SK-11's packet; SK-12's dated verdict |
| M1 escalation path | [[red-team-charter]] | SK-7's zero-deletion trip-wire fires to them, same week |
| The bypass notice | `platform/engineering` | SK-14, as a question — approval is not ours to grant |
| Collapse target | [[ai-orchestration-charter]] | SK-9's 2026-11-24 recommendation, if it comes |

---

## 8. Corrections this agenda carries

Findings, not tasks — recorded because [[skills-loops]] and [[skills-charter]]
are not this agenda's to edit.

- **OD-14 is closed** (Resolved 2026-08-24; root `SKILLS.md` is a tombstone at
  `SKILLS.md:1`). The 2026-08-24 agenda listed it as step 3 and the charter still
  lists it under owned scope.
- **OD-24 is Agreed**, so `questions.md` **RT-4** — which reports the
  self-retirement trigger as *unadopted* and asks for a founder yes/no, age-out
  2026-10-05 — is answered and should close. SK-9 supersedes it.
- **The charter's cron citation has drifted.** `schema-parity.yml:26-27` is cited
  three times in this directory as the daily-cron analogue; the cron is at
  `schema-parity.yml:35` today. The shape still holds; the line does not.
- **`skills.script_to_skill_ratio` moved the wrong way** — 59:0 → 84:4. Four
  skills is real progress against a denominator that grew by 25 in the same
  window. Both halves belong in the same sentence.
- **[[skills-loops]] L4 is closer to `closing` than `proposed`** — the monthly
  census ran once on 2026-08-28 and produced a dated fact
  (`teams/skill-registry-authoring/memory/2026-08-28-registry-index.md`).

---

## 9. Open with the founder

Three, and only three — everything else above is decided or measurable.

1. **What is the registry ceiling N?** SK-8 builds the brake either way; without
   a number it ships disarmed. A guess here is worse than a delay, because the
   number *is* the brake ([[skills-directive]] §Not decided here).
2. **OD-25 — who runs the weekly skill-health job?** Two documents, two owners,
   one job. SK-11 makes the close a single commit; the pick is not ours.
3. **TECH-F4 — three teams or two?** Not asked for an answer now: SK-12 proposes
   to answer it *by census on 2026-11-24* rather than by argument. The question
   for the founder is whether that deferral is acceptable, or whether the
   16 citations across 12 files make waiting three months too expensive.

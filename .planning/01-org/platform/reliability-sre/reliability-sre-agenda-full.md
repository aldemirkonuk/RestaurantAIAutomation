---
type: agenda-full
division: platform
department: reliability-sre
status: active
metrics: [nf_a.emission_coverage, sre.time_to_revert, sre.dlq_depth_and_oldest_age, sre.mttd_silent_corruption, sre.days_since_verified_restore]
updated: 2026-08-28
links: ["[[reliability-sre-charter]]", "[[reliability-sre-premortem]]", "[[reliability-sre-directive]]", "[[reliability-sre-agenda-board]]", "[[reliability-sre-loops]]", "[[reliability-sre-schedule]]", "[[reliability-sre-agent-stack]]", "[[reliability-sre-questions]]", "[[observability-telemetry-plumbing-agenda-full]]", "[[release-engineering-agenda-full]]", "[[runtime-resilience-agenda-full]]", "[[state-integrity-invariants-agenda-full]]", "[[0039-activation-plan-of-record]]", "[[harness-runtime-charter]]", "[[agent-fleet-charter]]", "[[decision-office-charter]]", "[[skills-charter]]", "[[neural-footprint-instrumentation-charter]]"]
---

# Reliability / SRE — Agenda, 2026-08-28

First real agenda. Written under [[0039-activation-plan-of-record]] Track B; it replaces
the 2026-08-24 forecast, and every row below is graded against the repo as it stands on
**2026-08-28**, not against the charter's four-day-old citations.

## 0. What changed under this department since the charter was written

Four things, all of them load-bearing for the tasks below.

| Change | Evidence, verified 2026-08-28 | What it does to this agenda |
|---|---|---|
| **The NF-A emission spine landed.** | `supabase/migrations/20260824141116_neural_footprint_event.sql`, `…20260824153600_nf_a_readout.sql` (two views + the RLS close), `services/agent-orchestrator/services/neural_footprint.py`, `apps/api-gateway/src/common/model-client/nf-verdict.service.ts`, `scripts/nf_readout.py` | `nf_a.emission_coverage` moves from *not computable* to *unmeasured* — a different, cheaper problem. R1 exists to close the gap between those two words. |
| **The card runner already runs in CI, report-only.** | `.github/workflows/ci.yml:68-69` — *"Smoke-run the mechanical card runner (report-only, no writes)"* → `python3 scripts/agents/run_card.py` | ADR 0039 A4's cron is not a greenfield build. It is the same script on a schedule, with writes. R19 is about **operating** it, not building it. |
| **`loop-watcher.yml` exists and is the template A4's cron should copy.** | `.github/workflows/loop-watcher.yml:19` weekly Monday 07:00 UTC; `:14-15` — *"It reports. It never edits the corpus"* | The department has a proven cron shape and a proven restraint rule. R19 inherits both. |
| **A liveness twin has been built exactly once, and nobody called it that.** | `20260824153600_nf_a_readout.sql` — view 2, `nf_a_readout_provenance`, is *"deliberately global and aggregate-only … so it returns exactly one row at any volume, including zero"* | M1's counter-pressure has a working reference implementation in this repo. R2 generalises it instead of inventing it. |

**The one number that frames everything else.** `00-index/METRICS.md`: *"325 distinct
metric keys. Zero are produced by a running instrument."* This department owns five of
those keys and owns the emission path the other 320 would ride on. The most valuable
thing Reliability/SRE can do in the next quarter is not improve a number — it is to be
the **first department in the org to produce any number on a cadence.** That is R20, and
every other row is chosen partly for whether it gets us there.

## 1. Position

Unchanged from the charter and still the right frame: **almost everything is built and
almost nothing is watched.** What the 2026-08-28 pass adds is that the *unwatched* set is
now countable rather than rhetorical — 6 workflows, 29 jobs, 21 `check_*` guard scripts,
4 scheduled crons, 1 dead-letter queue with no consumer, 1 findings table with no reader,
2 recovery paths never exercised, and 5 loops all at `status: proposed`.

Three seams this agenda deliberately drives at, in dependency order:

1. **A number that has never existed** (`sre.days_since_verified_restore`) — §2.
2. **A queue that nobody is obliged to read** (`queue.dead_letters`) — §3.
3. **A cadence that nothing yet runs on** (the A4 runner cron, and after it, one metric) — §4.

## 2. Spine A — the first verified restore drill

The department's named gap ([[reliability-sre-charter]] §Named gap), assigned to
[[release-engineering-charter]] because restore is the terminal rollback. Verified today,
verbatim: `scripts/backup_db.sh` is **19 lines** and still writes
`${BACKUP_DIR}/wineops_backup_${TIMESTAMP}.dump` (`:12` — the legacy brand, untouched);
`scripts/restore_db.sh` is **25 lines** ending in
`pg_restore --clean --if-exists --no-owner` (`:23`). A repo-wide grep for `backup_db` and
`restore_db` outside `.planning/` returns **exactly one hit: `restore_db.sh` itself.** No
workflow, no test, no schedule, and — worth stating separately — **no producer**: nothing
runs the backup either, so there is not currently a dump to restore.

| # | Task | Owner | Doneability — how you know it is done | close_time |
|---|---|---|---|---|
| **R5a** | **Pick the drill target on evidence and record it.** The local Supabase stack is `major_version = 17` (`supabase/config.toml:36`), matching the production engine (PostgreSQL **17.6**, verified against production and recorded in `20260824153600_nf_a_readout.sql`). `docker-compose.yml:6` is `postgres:15-alpine` and cannot accept a PG17 custom-format dump — it is **not** a valid target and this agenda strikes it. | [[release-engineering-charter]] | A one-paragraph target decision in the drill record naming engine version, cost, and what fidelity it does *not* give (roles, RLS ownership, extensions — see R5c). | `one-shot` · by **2026-09-12** |
| **R5b** | **Produce the first dump on purpose.** Run `backup_db.sh` against production once, by hand, timed; record size, duration, and the exact `pg_dump` version. | [[release-engineering-charter]] | A dated line in the drill record with all three values. A backup nobody has ever produced is not a backup. | `one-shot` · by **2026-09-19** |
| **R5c** | **Restore it and grade the result — the drill itself.** Restore into the R5a target; then a row-count table for the top 20 tables by production row count, plus an explicit check of the three things `--no-owner --clean` is suspected to drop: roles, RLS policy ownership, extensions. | [[release-engineering-charter]] | `sre.days_since_verified_restore` gets its **first value in the project's history** — the drill's actual deliverable. A restore that "seemed to work" with no row counts is **not** a close. | `quarterly` · first close by **2026-09-30** |
| **R5d** | **Finding, already established: the drill's stated doneability is not executable today.** `scripts/check_schema_parity.sh` rebuilds a *local* database from migrations and diffs it against the remote named by `SUPABASE_DIRECT_CONNECTION_STRING` (`:31-38`). It has **no way to be pointed at a restored database**, so [[reliability-sre-schedule]]'s quarterly row ("run `check_schema_parity.sh` *against the restored database*") describes a capability that does not exist. | [[release-engineering-charter]] proposes; [[state-integrity-invariants-charter]] owns the verdict semantics | Either a `--target <dsn>` path through the existing script, or a drill-specific comparator — plus the schedule row amended to match reality. Closed by a **commit**, not by re-wording the drill. | `one-shot` · by **2026-09-26** |
| **R6** | **Timed no-op revert.** `deploy.yml:253-267` — `rollback-guide` mode prints steps and defaults `rollback_target_sha` to the previous commit. An unexercised procedure has no measured value. | [[release-engineering-charter]] | `sre.time_to_revert` carries a number in seconds — decision → healthy production — with the SHA pair and the wall-clock window recorded. "The steps printed correctly" is not the metric. | `quarterly` · first close by **2026-10-15** |
| **R7** | **Decide whether we are the backup, or the vendor is.** R5b exposes the prior question: nothing schedules `backup_db.sh`, and Supabase PITR may already cover the categorical risk. This is a founder call (§8 Q1) and the task is to **frame it with numbers**, not to answer it. | [[release-engineering-charter]] | A two-option comparison with the vendor's actual retention window quoted from the project settings, and the recovery-point objective each option implies. | `one-shot` · by **2026-10-03** |
| **R8** | **Environment reconciliation across the ~6 surfaces.** 80 env vars ([[EXTERNAL_CONNECTIONS]]:39-80), including `DEV_AUTH_BYPASS`, `DEV_AUTH_BYPASS_EMAIL`, `DEV_AUTH_BYPASS_SECRET`. | [[release-engineering-charter]] | `release.env_drift_count` has a value, and `release.dev_auth_bypass_in_prod` is proven `0` **by a command whose output is pasted**, not by inspection. | `monthly` |
| **R9** | **Publish the skipped-test count.** OD-88: every test under `services/agent-orchestrator/tests/e2e/` is skipped without production secrets — measured `11 skipped`, all 11 collected. OD-88 is the founder's to resolve; **the number is ours to publish** and is not blocked by that fork. | [[release-engineering-charter]] | A `tests.collected_but_skipped` count on the board next to the green tick, every run. A suite that reports green while skipping its own subtree is M3 in test form. | `weekly` |

**Why the ordering is R5a → R5b → R5c and not "run the drill".** The charter's gap says
the restore has never been *tested*; the sharper 2026-08-28 reading is that the backup has
never been *taken*. Scheduling "prove the restore" without R5b schedules a drill with no
input, and a drill that cannot start is how M2 survives another quarter with a task row
that looks like progress.

## 3. Spine B — name the DLQ consumer

Verified 2026-08-28, unchanged from the charter: `core/message_bus.py:505-533` creates and
binds `queue.dead_letters`; `:771`, `:817`, `:824`, `:830` each increment
`metrics.messages_dead_lettered`; `:303` declares the counter and `:354` exposes it. A
grep for `dead_letter` across the file returns setup, binding and counters — **no
consumer, no drain, no alert.**

This is the department's clearest instance of M1: a well-engineered mechanism whose
correct operation is indistinguishable from silent data loss.

| # | Task | Owner | Doneability | close_time |
|---|---|---|---|---|
| **R10a** | **Name the owner of the consuming process — in writing.** The gap is genuinely shared: the queue is [[runtime-resilience-charter]]'s mechanism, the process that would host a consumer is [[harness-runtime-charter]]'s runtime, and the handlers whose messages die are [[agent-fleet-charter]]'s code. This agenda does not pick for them; it **files the question in their `questions.md` files** and refuses to let three units each assume the other two have it. | department (per [[reliability-sre-directive]]: anything touching two teams is decided by the department) | A named owner in [[runtime-resilience-charter]]'s agenda **or** a `REL-Q` row in [[reliability-sre-questions]] recording that all three declined, which is itself the escalation ([[reliability-sre-directive]] trigger 3). Silence is not a close. | `one-shot` · by **2026-09-12** |
| **R10b** | **First reading of `sre.dlq_depth_and_oldest_age` — both halves.** Age is the load-bearing half: depth 3 with a six-week-old message is worse than depth 200 draining hourly ([[runtime-resilience-charter]]). | [[runtime-resilience-charter]] | Two numbers, dated, on the board. **`0 / none` is a valid and welcome result; `unmeasured` is not.** The reading is the deliverable, not the drain. | `weekly` · first reading by **2026-09-19** |
| **R10c** | **Replay policy, scoped to what is decidable now.** `drift_agent.py:11-16` already establishes that money and stock never auto-apply. Whether an idempotent non-financial replay may be automatic is **open** (§8 Q2) and stays open. | [[runtime-resilience-charter]] | The policy document distinguishes the three dispositions — replay / discard-with-recorded-reason / escalate — and the money-and-stock class is marked `confirm` per the constant in every card. Nothing is auto-replayed before Q2 is answered. | `one-shot` · by **2026-10-10** |
| **R11** | **Exercise the kill switch.** `core/orchestrator.py:544` `pause_all_writes`, `:589` `emergency_flush_buffer` — both exist, neither has ever been used. *(Citation drift corrected: the charter and loops cite `:537`/`:582`; the functions are at `:544`/`:589` on 2026-08-28. The charters are not edited by this wave — the correction lives here.)* | [[runtime-resilience-charter]] | A dated exercise record: the window, what was paused, how it was resumed, and `sre.days_since_kill_switch_exercised` = 0 on that date. First use in anger is a finding **even when it works** ([[reliability-sre-directive]] trigger 5) — this task exists so that first use is not in anger. | `quarterly` · first close by **2026-10-31** |
| **R12** | **First readings for the two absorbed-failure numbers.** `resilience.circuit_open_duration` and `resilience.retry_amplification_factor` — an open breaker is a working mechanism producing a degraded product, and nobody looks at the duration. | [[runtime-resilience-charter]] | Each metric carries a number, **or** an explicit board row naming the exact instrument that would produce it and why it does not exist. A metric with neither is deleted from the board rather than left as decoration. | `monthly` |

## 4. Spine C — operate the runner cron, and produce one metric on a cadence

ADR 0039 **Track A4** splits into a column (RM-3, nf-instrumentation) and a cron (SRE).
**A Track-A4 agent is building the cron workflow in parallel with this wave.** This agenda
therefore schedules **no build of it** — it schedules everything that has to be true for
the cron to be worth having once it exists, which is the part no one else owns.

| # | Task | Owner | Doneability | close_time |
|---|---|---|---|---|
| **R19a** | **Give the cron a liveness twin before it ships.** A weekly workflow that silently stops running looks exactly like a weekly workflow with nothing to report — M1 in cron form, and `loop-watcher.yml` has the same exposure today. The ask is one line in the job summary: a heartbeat and a monotonic run counter, so a *missing* run is visible in the board's next read. | department → [[release-engineering-charter]] | The cron's job summary contains a value that is non-zero by construction on every run. Filed as a requirement to the A4 agent's workflow, **not** implemented twice. | `one-shot` · by **2026-09-12**, i.e. before the cron's first scheduled run |
| **R19b** | **Operate it: three consecutive runs with recorded outcomes.** `ci.yml:68-69` proves the runner executes; a schedule proves it keeps executing. | department | Three dated rows — run, outcome, action taken or "none" — in the board's operating record. Per [[reliability-sre-schedule]]'s anti-sprawl rule, **3 consecutive no-action runs downgrade the job**; this task is equally allowed to conclude "delete it". | `weekly` · from the cron's first run |
| **R19c** | **Carry the `nf_a.skill_id` ask without owning it.** The column is RM-3's ([[neural-footprint-instrumentation-charter]]); `skills.firing_rate_30d` is [[skills-charter]]'s consumer. SRE's stake is only that the cron's output is joinable. | department | Either `skills.firing_rate_30d` is computable from the cron's output, or a single gap row naming the missing column and who owns it. **This department does not design the column** and does not resolve OD-25's ownership fork. | `monthly` |
| **R20** | **Be the first department to produce a metric on a cadence.** `00-index/METRICS.md`: 325 keys, zero produced by a running instrument. Candidate, chosen because its inputs are already in the repo and need no new infrastructure: **`ci.gates_red_count`** over the measured denominator of 29 jobs. | department | **Two consecutive dated values produced by a job, not by a person**, visible on [[reliability-sre-agenda-board]]. One value is an audit; two on a cadence is an instrument. This is the department's most ambitious row and it is graded on that word *consecutive*. | `fortnightly` · first pair by **2026-10-10** |
| **R17** | **Red-signal audit, first run, against a real denominator.** Measured 2026-08-28: **6 workflows · 29 jobs · 21 `check_*` guard scripts · 4 scheduled crons** (`schema-parity.yml:34-35` daily 06:00, `e2e-prod.yml` nightly 02:00, `codeql.yml:8` Monday 06:00, `loop-watcher.yml:19` Monday 07:00). | department | `ci.gates_red_count` and `ci.gates_tolerated_count` carry values against 29, and every red gate has either a fixing commit or a deletion PR within one close-time. The count is published **even when it is embarrassing** ([[reliability-sre-loops]] L-SRE-1). | `weekly` |
| **R18** | **Close `ci.yml:8-9` one way or the other.** *"Do NOT treat TFND-05 as green CI — Black debt on `studio_routes.py` may keep main red"* plus *"STATUS: schedule-present / capability-unverified"*. Honest when written; it is now the seed of M3 sitting in the repo's most-read file. | department → [[release-engineering-charter]] | Either the Black debt is fixed and both lines are **deleted**, or the tolerance becomes a dated, expiring exception row that the R17 audit reads and that fails the audit on expiry. A third year of the comment is the failure. | `one-shot` · by **2026-09-12** |
| **R21** | **Move this department's five loops off `proposed`.** OD-46 (re-measured 2026-08-27): 3 `active` + 2 `running` of 485. ORG_STRUCTURE §5.1 requires an `evidence:` field naming a `file:line`, workflow or query before a loop may claim `active`, and `build_loop_index.py --check` blocks in CI (`ci.yml:31-46`) — so this cannot be closed by relabelling. | department | At least **3 of 5** SRE loops carry a real `evidence:` field and pass the contract gate as `active`. The other two say why not. Moves the org's real activation metric by construction. | `one-shot` · by **2026-10-24** |

## 5. Observability & telemetry plumbing — the four rows that make the rest legible

| # | Task | Doneability | close_time |
|---|---|---|---|
| **R1** | **Turn `nf_a.emission_coverage` from *not computable* into a number.** The spine landed (§0); `scripts/nf_readout.py --json` reads the two views and prints every figure with its sample size and window, labelling anything under 30 events `INSUFFICIENT VOLUME` (`:187-194`, `:232-233`). The migration recorded **0 rows in production** on 2026-08-24. | A dated coverage figure with its denominator stated as **agent tasks, never HTTP requests** ([[observability-telemetry-plumbing-charter]] §Denominator discipline). **`0 rows` is a legitimate close.** OD-58 (what sample size may be published) stays open and is quoted, not resolved. | `weekly` · first value by **2026-09-05** |
| **R2** | **Liveness-twin registry, generalised from the one that already exists.** `nf_a_readout_provenance` returns exactly one row at any volume including zero — that is a twin, built and unnamed. Every metric on this department's board gets one, or is not admitted ([[reliability-sre-loops]] L-SRE-2 admission rule). | `obs.metrics_with_liveness_twin_pct` carries a value, and each of the five department numbers names its twin **or** appears in an explicit untwinned list. An untwinned metric on the board with no list entry is the loop failing, not the metric. | `weekly` |
| **R3** | **`observability_degraded` on the health surface.** Verified 2026-08-28: `apps/api-gateway/src/common/orchestrator/health-proxy.controller.ts` contains **zero** references to `degraded`; `core/observability.py:50` still logs the `prometheus_client` fallback at **INFO**, and `:53` returns `NoopMetric`. So *no metrics* and *metrics are zero* still render identically — M1's root cause, unmoved. | The health payload carries the flag, the fallback logs at WARNING, and a test asserts both. Then: a deliberate dependency-removal run where the flag flips — the counter-pressure is only real once someone has seen it fire. | `one-shot` · by **2026-09-19**, then `per-pr` |
| **R4** | **Specify the absence channel; do not build it.** The team's card states plainly that absence alerts have **no consumer** — *"no paging channel exists; today the alert is a doc row"*. A one-founder org may genuinely not want paging, which makes this a decision, not a backlog item (§8 Q3). | A one-page comparison of the three honest options (a doc row read on a cadence · a GitHub issue opened by the job · a real notification channel), each with what it costs and what it wakes. Filed to §8; **not built** until answered. | `one-shot` · by **2026-10-03** |

## 6. State integrity & invariants — from detection to disposition

| # | Task | Doneability | close_time |
|---|---|---|---|
| **R13** | **Give `drift_findings` a reader.** Detection is built (`state_invariant_enforcer.py`, `drift_agent.py`, `inequality_detector.py`); disposition is not — no UI surface, no consumer outside the agents and their tests. | `integrity.open_findings_count` **and** `integrity.open_findings_oldest_age` carry values, and at least one finding reaches a terminal state — fixed / accepted-with-reason / invalidated. Age is the metric that matters; a count that only rises is M1 in queue form. | `weekly` · first reading by **2026-09-19** |
| **R14** | **Re-census the guards, then grade them by class.** The charter names six shell gates; `scripts/check_*` now holds **21** (12 `.py`, 9 `.sh`) — the surface grew ~3.5× while the charter's number stood still. Five of the original six are greps: a dynamically-built table name or a Postgres function passes all of them. | A 21-row table classing each guard **syntax-side (grep)** vs **data-side (queries the outcome)**, and `integrity.invariants_with_outcome_side_check_pct` published from it. Counting gates is explicitly *not* the metric ([[state-integrity-invariants-charter]]). | `one-shot` · by **2026-09-26**, then `quarterly` |
| **R15** | **Make the author ≠ auditor tripwire a job, not a hope.** M5's earliest signal is greppable: one commit touching both `supabase/migrations/` and `scripts/check_schema_parity.sh` (or its workflow). The repo already has the right idiom — *"NEVER VACUOUS"*, exit 2 when the guard cannot check what it claims (`check_model_calls_logged.sh:22-30`). | A CI job that fails on a synthetic commit touching both sides, **proven against a deliberately-constructed commit** — and that exits 2, not 0, when it cannot determine the changed set. A guard proven only against a clean tree is the vacuous pass the convention exists to end. | `one-shot` · by **2026-10-10**, then `per-pr` |
| **R16** | **Publish `integrity.stub_agents_counted_as_coverage`.** Today: **2** — `ghost_inventory_agent.py`, `shrinkage_detective_agent.py` only log. The mandate reads broader than the capability, and TECH-F6 (who owns guardian-agent code) stays open. | The number is on the board and each stub is labelled non-coverage in the census. Implementing them is [[agent-fleet-charter]]'s call under TECH-F6 — **this department does not resolve that fork**, it refuses to count a stub as coverage while it is open. | `monthly` |
| **R22** | **`sre.mttd_silent_corruption`, by class rather than in aggregate.** Schema drift is ≤24h by construction (`schema-parity.yml:34-35`); tenant leakage and stock divergence are unmeasured. One averaged number would hide exactly that. | Three separately-labelled values, two of which may honestly read `unmeasured` — and the aggregate is never computed. The good number covering the easiest surface is the thing to avoid publishing alone. | `weekly` |

## 7. Findings this agenda produced

Recorded because §8.2's rule is that a task no card or loop can carry is a **finding**, not
a task.

1. **The wave splits `watch_loops.py`'s dated staleness cliff.** `scripts/watch_loops.py:10-11`
   documents one cliff — 2026-10-23, *"all 198 agenda files … share `updated: 2026-08-24`"*.
   Wave 3 rewrites 48 of them (24 units × 2) to `updated: 2026-08-28`, so after this wave
   there are **two** cliffs: ~150 files on 2026-10-23 and 48 on 2026-10-27. The script reads
   `updated:` dynamically (`:74`) and so stays correct; **its docstring does not.** Owner:
   [[decision-office-charter]] (the loops and the watcher are theirs). SRE files it because
   SRE operates the cron that reports it. → a `DO-` row.
2. **`sre.days_since_kill_switch_exercised` is measured by no loop's `measures:` list in
   `loops.json` beyond L-SRE-3**, and no card emits it. It is real work with no producer;
   R11 supplies the first value by hand, and the second one needs an owner.
3. **Citation drift in this department's own artifacts**, found while verifying: `pause_all_writes`
   `:537` → **`:544`**, `emergency_flush_buffer` `:582` → **`:589`**, `schema-parity.yml`
   cron `:26-28` → **`:34-35`**. The charters are not edited by this wave; the corrections
   are logged here and belong in the next charter pass.
4. **The schedule promises a parity run the tooling cannot perform** — R5d. Filed as a
   finding as well as a task because a schedule row that names an impossible check is
   itself a vacuous gate.

## 8. Questions for the founder

Carried forward and re-scoped against 2026-08-28 evidence. Q4 and Q5 are unchanged and
still open; Q1–Q3 are sharper than they were.

1. **Are we the backup, or is the vendor?** (R7) Nothing schedules `backup_db.sh`, and
   Supabase PITR may already cover the categorical data-loss risk. If the vendor is the
   backup, the drill's subject changes — we would be proving *their* restore path, and
   `restore_db.sh` becomes a second-order tool. This is the cheapest question on the page
   and it re-shapes §2 entirely.
2. **DLQ replay autonomy.** (R10c) Money and stock are never auto-applied
   (`drift_agent.py:11-16`). Does an *idempotent, non-financial* replay get the same
   human gate, or may it be automatic? Unanswered, R10c ships with everything gated.
3. **What does an absence alert wake?** (R4) A one-founder org may correctly want no
   paging at all. But then the honest design is a doc row read on a cadence — and that
   cadence is the alert. Pick the channel, or confirm "doc row + weekly read" is the answer.
4. **Deleting a gate we will not fix.** M3's counter-pressure says a red gate is closed by
   a file within one close-time *or deleted*. Deleting a CI check reads badly in a diff.
   Confirm the department may actually delete, or R17 and R18 collapse into tolerance.
5. **TECH-F6 — guardian-agent ownership.** Two of the four are stubs
   (`ghost_inventory_agent.py`, `shrinkage_detective_agent.py`), which makes this decidable
   cheaply now and expensive later. R16 refuses to count them as coverage in the meantime.
6. **Incident Command's trigger.** [[reliability-sre-charter]] names "a second human
   carrying a pager". Q3's answer may make it volume-based instead — if the absence channel
   is a doc row, nobody is ever paged and the trigger can never fire by its own terms.

## 9. What this agenda deliberately does not schedule

- **Anything past a lock.** [[0039-activation-plan-of-record]] holds the pricing model and
  brand/landing visuals. Neither binds this department directly, and R7's vendor-retention
  comparison is a *platform vendor* question, not a pricing-model one — but it costs money,
  so it is written as a founder question rather than as a purchase.
- **A "Backup & DR" team.** Rejected twice on org-cosplay grounds; the gap is named and
  assigned instead ([[reliability-sre-charter]]).
- **Incident Response / On-Call and Infrastructure Cost.** Rejected on **scale**, not
  principle. L-SRE-5 watches the two triggers quarterly; nothing here resurrects them.
- **Building the A4 cron.** Owned by the Track-A4 agent running in parallel. This agenda
  operates it and supplies R19a as a requirement. Building it twice is the failure mode.
- **Resolving any open fork.** OD-03, OD-25, OD-46, OD-58, OD-88, TECH-F6 and TECH-F1 are
  referenced and left open, per §8.4.
- **A rolled-up department health number.** Forbidden by the charter and by the card's
  quality bar: five incommensurable numbers stay five numbers, and "unmeasured" and "never
  happened" render as themselves.

## 10. Grading the ambition honestly

| Row | Reach | Grade |
|---|---|---|
| R5a–R5c first verified restore | High — a number that has never existed | **Evidence-backed.** Every input verified 2026-08-28; the only unknown is R7's answer, which changes the subject but not the feasibility. |
| R20 first metric on a cadence | Highest — an org-first, not a department-first | **Aspiration with a real path.** Inputs exist (29 jobs, a proven cron shape); the risk is that "consecutive" is harder than "first", which is exactly why it is graded on that word. |
| R21 loops off `proposed` | High — moves OD-46's org activation metric | **Constrained by a blocking gate**, which is the good kind of constraint: `build_loop_index.py --check` makes relabelling impossible. |
| R15 author≠auditor tripwire | Medium-high — automating a structural guarantee | **Evidence-backed**; the greppable signal and the exit-2 idiom both already exist. |
| R10a name the DLQ consumer | Medium — one sentence, three units | **Honest about its own risk:** the likeliest outcome is that nobody claims it, and the agenda treats that outcome as a close, not a failure. |
| R4 absence channel | Low build, high leverage | **Aspiration pending a decision** (Q3). Deliberately specified and not built. |

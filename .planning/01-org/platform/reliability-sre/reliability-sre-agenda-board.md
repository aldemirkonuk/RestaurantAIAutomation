---
type: agenda-board
division: platform
department: reliability-sre
status: active
metrics: [nf_a.emission_coverage, sre.time_to_revert, sre.dlq_depth_and_oldest_age, sre.mttd_silent_corruption, sre.days_since_verified_restore]
updated: 2026-08-28
links: ["[[reliability-sre-charter]]", "[[reliability-sre-agenda-full]]", "[[reliability-sre-loops]]", "[[reliability-sre-premortem]]", "[[reliability-sre-agent-stack]]", "[[reliability-sre-questions]]", "[[0039-activation-plan-of-record]]"]
---

# Reliability / SRE — Board

Live as of **2026-08-28**. Tasks and their evidence live in
[[reliability-sre-agenda-full]]; this page is the glance.

**Board rule, from the card's quality bar:** every row carries a measured value, the word
`unmeasured`, or `never happened`. **No roll-up number, ever** — five incommensurable
questions do not average.

## Department units — live query, not a hand-written list

```dataview
TABLE type AS Artifact, status AS Status, updated AS Updated
FROM "01-org/platform/reliability-sre"
WHERE department = this.department
SORT team ASC, type ASC
```

## Teams and their one question

```dataview
TABLE team AS Team, status AS Grade, updated AS Updated
FROM "01-org/platform/reliability-sre"
WHERE type = "charter" AND team != null
SORT team ASC
```

## Anything in this department not touched in 60 days

```dataview
TABLE updated AS Updated, type AS Artifact
FROM "01-org/platform/reliability-sre"
WHERE department = this.department AND date(updated) < date(today) - dur(60 days)
SORT updated ASC
```

- Empty table = healthy. A populated table is either finished work or fiction
  (foundation §3.3, §6). The department artifacts rewritten on 2026-08-28 next fall due
  **2026-10-27**; the team artifacts still dated 2026-08-24 fall due **2026-10-23**.

## The five numbers

| Metric | Value today | Liveness twin | Moves via |
|---|---|---|---|
| `nf_a.emission_coverage` | **unmeasured** — spine landed (`neural_footprint_event` + two readout views); 0 rows recorded in production on 2026-08-24 | `nf_a_readout_provenance` — **the only real twin in the repo** | R1 |
| `sre.time_to_revert` | **unmeasured** — `deploy.yml:253` prints steps | none | R6 |
| `sre.dlq_depth_and_oldest_age` | **unmeasured** — queue bound, counted into, **no consumer** | none | R10a/R10b |
| `sre.mttd_silent_corruption` | schema drift **≤24h**; tenant leakage + stock divergence **unmeasured** | the daily cron's own run record | R22 |
| `sre.days_since_verified_restore` | **never happened** — not a bad value, no value | n/a until the first drill | R5a–R5c |

## Denominators measured 2026-08-28

- **6** workflows · **29** jobs · **21** `check_*` guard scripts · **4** scheduled crons
- **5** department loops, all `status: proposed` — org-wide, 5 of 485 run (OD-46)
- **1** dead-letter queue with no consumer · **1** findings table with no reader
- **2** recovery paths never exercised (restore, kill switch) · **1** never timed (revert)
- **2** stub agents counted as coverage · **11** collected-but-skipped e2e tests (OD-88)

## Open — this quarter

- [ ] **R5a-c** First verified restore drill — [[release-engineering-charter]] — `quarterly`, first close **2026-09-30**
- [ ] **R5d** Parity cannot be pointed at a restored DB — fix the tooling or the schedule — **2026-09-26**
- [ ] **R10a** Name the DLQ consumer's owner (resilience · harness-runtime · agent-fleet) — **2026-09-12**
- [ ] **R10b** First `sre.dlq_depth_and_oldest_age` reading, both halves — `weekly` from **2026-09-19**
- [ ] **R19a** Liveness twin for the A4 runner cron, filed *before* it ships — **2026-09-12**
- [ ] **R19b** Operate the cron: three dated runs, or downgrade it — `weekly`
- [ ] **R20** First metric produced on a cadence, org-wide — two consecutive values by **2026-10-10**
- [ ] **R17** Red-signal audit against 29 jobs — `weekly`
- [ ] **R18** Close `ci.yml:8-9` — fix the debt or make it a dated expiring exception — **2026-09-12**
- [ ] **R21** ≥3 of 5 SRE loops off `proposed` with real `evidence:` — **2026-10-24**
- [ ] **R1** `nf_a.emission_coverage` gets a dated number (0 rows is a valid close) — **2026-09-05**
- [ ] **R2** Liveness twin per board metric, or an explicit untwinned list — `weekly`
- [ ] **R3** `observability_degraded` on the health surface — **2026-09-19**
- [ ] **R6** Timed no-op revert — **2026-10-15**
- [ ] **R11** Kill-switch exercise — **2026-10-31**
- [ ] **R13** `drift_findings` gets a reader and an aging column — **2026-09-19**
- [ ] **R14** Re-census 21 guards, grep-side vs data-side — **2026-09-26**
- [ ] **R15** Author ≠ auditor tripwire as a CI job, proven against a synthetic commit — **2026-10-10**

## Awaiting a founder answer

- [ ] **Q1** Are we the backup, or is the vendor? (re-shapes the whole drill)
- [ ] **Q2** DLQ replay autonomy for idempotent non-financial messages
- [ ] **Q3** What does an absence alert wake? (a doc row is a valid answer)
- [ ] **Q4** May the department actually delete a gate it will not fix?
- [ ] **Q5** TECH-F6 — guardian-agent ownership, cheap now, expensive later
- [ ] **Q6** Incident Command's trigger — pager-based or volume-based

## Findings filed, not fixed here

- Wave 3 splits `watch_loops.py`'s dated cliff into two (`:10-11` docstring now wrong) → [[decision-office-charter]]
- `sre.days_since_kill_switch_exercised` has no producer beyond a hand-run drill
- Citation drift: `pause_all_writes` `:537`→`:544`, `emergency_flush_buffer` `:582`→`:589`, `schema-parity.yml` cron `:26-28`→`:34-35`

## Rejected, on purpose

- [x] ~~Incident Response / On-Call~~ — org cosplay at this scale; trigger in [[reliability-sre-charter]], watched quarterly by L-SRE-5
- [x] ~~Infrastructure Cost~~ — three vendors on flat plans; inference cost is [[model-routing-inference-economics-charter]]
- [x] ~~Backup & DR as a team~~ — a named gap with an owner, not a headcount
- [x] ~~Building the A4 runner cron here~~ — the Track-A4 agent owns the build; this department owns operating it

## Watch

- `ci.yml:8-9` self-documented red tolerance — the M3 seed, now dated
- `observability.py:50,53` `NoopMetric` at INFO — zero still indistinguishable from silence
- `queue.dead_letters` — bound, counted into, unread
- `drift_findings` at status `open` — a number that can only rise
- OD-46 activation · OD-58 NF-A sample size · OD-88 skipped e2e subtree · TECH-F6 · TECH-F5 · TECH-F1

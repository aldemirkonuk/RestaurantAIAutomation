---
type: schedule
division: intelligence
department: analytics-bi
team: analytics-engine
status: provisional
metrics: [analytics.satisfiable_candidate_share, analytics.false_discovery_estimate, analytics.engine_foreign_imports]
updated: 2026-08-24
links: ["[[analytics-engine-charter]]", "[[analytics-engine-loops]]", "[[analytics-engine-directive]]", "[[analytics-bi-schedule]]", "[[data-charter]]"]
---

# Analytics Engine — Schedule & Skills

## Recurring work

| Cadence | Job | Emits |
|---|---|---|
| Per PR touching `engine/` | **Purity guard** — assert no import outside `./`-relative siblings | `analytics.engine_foreign_imports` |
| Per PR touching `insight-catalog.ts` | **Admission check** — new candidate families must be satisfiable by ≥1 live restaurant; every `DataRequirement` claimed by ≥1 candidate | `analytics.unclaimed_data_requirements` |
| Weekly | **Reach reading** — `availableCandidates()` per live restaurant; publish share **and** the blocking-requirement table ranked by unlock size | `analytics.satisfiable_candidate_share` → a data request to [[data-charter]] |
| Weekly | **Headless count** — compute `INSIGHT_CANDIDATES.length` from a bare `ts-node` script with no Nest context. The outcome-side twin of the purity grep | `analytics.candidate_type_count`, `analytics.headless_count_script_status` |
| Monthly | **Permutation falsification** — run the generator over shuffled data; count surviving "significant" findings | `analytics.false_discovery_estimate` |
| Monthly | **Coverage reading** — engine cases vs untested service lines; which service file got its first spec this month | `analytics.engine_service_test_ratio` |

**Anti-sprawl.** A job with no action for 3 consecutive runs is downgraded or deleted
(foundation §6). The job most at risk is the weekly reach reading — if the share does not
move for three weeks, that is not a reason to delete the job, it is a reason to **escalate
the data dependency**, because a flat 25.1% is the finding. The rule is applied to the job,
not to the escalation.

## Skills owned

Skills live in `.claude/skills/`. **None exist yet.** Two proposed, per the §3.3 protocol
(trigger · doneability · real past instance · owning department). Deliberately two, not
six — the repo has exactly one project skill today (foundation §3.1) and a skill unfired
for 30 days is reviewed for deletion.

### `insight-candidate-reach` — T2 (department)

- **Trigger.** Weekly, and on any PR touching `insight-catalog.ts`.
- **Doneability.** Emits: total candidate types, satisfiable share per live restaurant,
  and the blocking-requirement table ranked by unlock size. Fails loudly if any
  `DataRequirement` union member is claimed by zero candidates.
- **Real past instance.** 2026-08-24: nobody in the corpus had computed the satisfiable
  share. Executing `availableCandidates()` produced 144 / 573 (25.1%) without a POS feed —
  a number that reframes the whole "573 insight types" claim — and simultaneously exposed
  that `goals` (`insight-catalog.ts:38`) is declared and claimed by nothing.
- **Scheduled.** Yes, weekly.

### `engine-arithmetic-guard` — T3 (operational)

- **Trigger.** Any diff under `apps/api-gateway/src/analytics/engine/` or to a threshold
  constant in `insight-generator.service.ts`.
- **Doneability.** Every touched exported function has a spec case with a **hand-computed**
  expected value; no new statistical gate merges without a test of its p-value path; no
  foreign import entered `engine/`.
- **Real past instance.** `pValue` and `chi2` appear in zero assertions across all 11 spec
  files, while `insight-generator.service.ts:872` uses `pValue < 0.1` to decide whether the
  product speaks. The gap survived 149 test cases because nothing was looking for it.
- **Scheduled.** No — event-triggered on diff.

## Deliberately not a skill

- **"Add a new insight type."** That is the activity this team's directive gates, not
  accelerates. A skill that makes catalogue growth cheaper is a skill that makes
  [[analytics-engine-premortem]] M1 more likely.
- **Chart or dashboard generation.** Not this department (`intelligence.md:506`).

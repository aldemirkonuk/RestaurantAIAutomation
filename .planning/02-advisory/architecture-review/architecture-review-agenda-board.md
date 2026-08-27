---
type: agenda-board
division: advisory
department: architecture-review
status: provisional
metrics: [arch.layer_violations_open, arch.finding_age_days_max, arch.findings_closed_by_decision_ratio, arch.duplicated_invariants, arch.diverged_invariant_count, arch.direct_provider_callsites, arch.layer_bypass_callsites]
updated: 2026-08-24
links: ["[[architecture-review-charter]]", "[[architecture-review-agenda-full]]", "[[architecture-review-premortem]]", "[[architecture-review-directive]]", "[[architecture-review-loops]]", "[[architecture-review-schedule]]", "[[decision-office-charter]]", "[[red-team-charter]]", "[[security-charter]]", "[[engineering-charter]]", "[[client-surfaces-charter]]", "[[platform-api-charter]]", "[[schema-migrations-charter]]", "[[messaging-delivery-charter]]", "[[research-math-charter]]", "[[neural-footprint-instrumentation-charter]]", "[[model-routing-inference-economics-charter]]", "[[product-vision-charter]]"]
---

# Architecture Review — Board

> **PROVISIONAL — no work done yet.**

## This unit — live query, not a hand-written list

```dataview
TABLE status, type, updated
FROM "02-advisory/architecture-review"
SORT type ASC
```

## The advisory layer — siblings on the same authority

```dataview
TABLE WITHOUT ID
  file.link AS Function,
  status AS Evidence,
  updated AS Updated
FROM "02-advisory"
WHERE type = "charter"
SORT file.name ASC
```

## The review surface — every unit this function is chartered to review

```dataview
TABLE WITHOUT ID
  file.link AS Unit,
  division AS Division,
  status AS Evidence
FROM "01-org/platform" OR "01-org/applied-ai" OR "01-org/product"
WHERE type = "charter"
SORT division ASC, file.name ASC
```

> The size of that table is half the scale problem
> ([[architecture-review-agenda-full]] §Questions #7): three divisions, nine units, ~40
> teams, one function with no build capacity. The rotation in
> [[architecture-review-schedule]] is the mitigation; narrowing the mandate is the
> alternative.
>
> ⚠️ **The other half is what the query deliberately does not select.**
> [[ORG_STRUCTURE]] §3's mandate wording predates the Technology split and the
> 2026-08-24 promotion of **Research & Math** to its own division. So **L4's owner is
> outside the reviewed set** — AR-4 is addressed to
> [[neural-footprint-instrumentation-charter]], which this query does not return. A
> layer stack reviewed everywhere except at its metric spine is not reviewed.

## Loops owned, by close-time

```dataview
TABLE close_time, status
FROM "02-advisory/architecture-review"
WHERE type = "loops"
```

## Metric set — no roll-up, by design

| Metric | Value today | Note |
|---|---|---|
| `arch.layer_violations_open` | **7 raised at founding** | No log exists to hold them |
| `arch.finding_age_days_max` | **0** | Not a good score. Nothing has been raised into a log yet |
| `arch.findings_closed_by_decision_ratio` | **undefined** | The number that decides whether this function survives |
| `arch.diverged_invariant_count` | **1, verified** | AR-2 — 19 patterns TS vs 8 Python |
| `arch.duplicated_invariants` | **≥3 known** | AR-2, AR-5, AR-6 |
| `arch.direct_provider_callsites` | **7** · retry 1/7 · timeout 4/7 | AR-3 |
| `arch.layer_bypass_callsites` | **2 files, 5 statements** | AR-1 |
| `arch.handmade_ddl_objects` | **0** — held by CI | Not ours. [[schema-migrations-charter]] |

- **`arch.finding_age_days_max` is the board's headline number**, not the violation count.
  A rising violation count with a low age means the function is working. A flat violation
  count with a rising age means [[architecture-review-premortem]] #1 is happening.
- No aggregate. A green convergence number must not be able to hide a diverged legal
  guardrail.

## Findings at founding — all seven, all unlanded

| ID | Sev | What | Reviewed unit | Age |
|---|---|---|---|---|
| **AR-0** | 1 | Findings have **no destination** — `questions.md` exists in 0 of 99 units | *this function* | — |
| **AR-1** | 1 | L6 → L0 direct: browser reads/writes Postgres; `generated_reports` has RLS on and **zero policies** | [[client-surfaces-charter]] · [[platform-api-charter]] | — |
| **AR-2** | 1 | One legal guardrail, two runtimes, **already diverged** (19 TS / 8 Py under a "verbatim" comment) | [[messaging-delivery-charter]] | — |
| **AR-3** | 2 | 7 hand-rolled provider callsites; 1 retries; 3 have no timeout | [[model-routing-inference-economics-charter]] | — |
| **AR-4** | 1 | ~~L4 emits nothing in NestJS; in Python `decision_log` and `api_spend` **cannot be joined**~~ — **closed 2026-08-25 by P1**; both halves fixed | [[neural-footprint-instrumentation-charter]] | — |
| **AR-5** | 1 | Tenant isolation is a per-controller convention (`tenant.guard.ts:38-46`); 94 endpoints unguarded by omission — *corrected 2026-08-25: the six named modules are now guarded at class level; the count is stale and not recounted* | [[security-charter]] · [[platform-api-charter]] | — |
| **AR-6** | 3 | Schema drift precedent — 27 tables / 403 cols / 13 functions once existed only by hand | [[schema-migrations-charter]] *(fixed)* | — |

Full citations in [[architecture-review-charter]] §Evidence. **Age is blank on every row
because AR-0 is unanswered** — the clock cannot start until a finding has somewhere to
land.

## Unblocked now — no founder dependency

- [ ] Directory → layer map, first draft ([[architecture-review-agenda-full]] Step 1)
- [ ] Count the baseline: 7 callsites, 2 bypass files, 1 diverged invariant
- [ ] Census #1 — *"every model call is metered"*
- [ ] Import-boundary check in CI, shaped like `check_schema_parity.sh`
- [ ] AR-4 fix — no longer blocked; the NF column contract is settled on Path C
      (OD-11, `OPEN-DECISIONS.md:114`)

## Blocked

- [ ] Sweep one *(blocked: AR-0 — where does a finding land?)*
- [ ] Finding-age clock *(blocked: AR-0, and the 42-day rule is unadopted)*

## Open forks on this board

- [ ] **AR-0** — `questions.md` as an 8th artifact, or bind findings to the reviewed unit's
      `agenda-full.md` §Questions? Anatomy is LOCKED at 7 (OD-17). **Preference: the latter**
- [ ] **The 42-day age escalation** — adopted as automatic, or not? Without it,
      findings-only has no failure mode anyone notices
- [ ] **The merge trigger** — 2026-11-24, half of findings closed by decision, or merge into
      [[decision-office-charter]]. Binding? Relates directly to **OD-26**
- [ ] **Who owns the layer map?** An interface owned by the reviewed party is not an interface
- [ ] **The evaluation seam** — **TECH-F3** ([[FORK-REGISTRY]]); originally numbered **OD-21**
      at `technology.md:845`, colliding with the real OD-21 (`OPEN-DECISIONS.md:135`, locked).
      ID now issued. Read here as an
      **L4 ownership question**; instruction on record stands: **merge, never duplicate**
- [ ] **Scope, both directions** — too wide (three divisions, ~40 teams, no build
      capacity: rotate or narrow?) **and too narrow** ([[ORG_STRUCTURE]] §3 still says
      *"Technology + Product"*, so **Research & Math — L4's owner — is outside the
      mandate**, and AR-4 has no chartered recipient)

## Watch signals — from [[architecture-review-premortem]]

- [ ] A finding acknowledged with no `OPEN-DECISIONS.md` line in the same sweep — **the
      earliest signal of theatre, available at day 14**
- [ ] `arch.finding_age_days_max` rising two sweeps running while `findings_closed` stays 0
- [ ] Three sweeps whose findings are all of a class a linter could have produced
- [ ] The same `path:line` cited by two advisory functions in one sweep
- [ ] Three findings against one seam, all argued down on **design** grounds — the rule is
      wrong, not the seam
- [ ] Product's share of the finding log below a quarter after four sweeps
- [ ] `arch.direct_provider_callsites` going from 7 to 8

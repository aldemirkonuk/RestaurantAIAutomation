---
type: agenda-board
division: advisory
department: architecture-review
status: active
metrics: [arch.layer_violations_open, arch.finding_age_days_max, arch.findings_closed_by_decision_ratio, arch.duplicated_invariants, arch.diverged_invariant_count, arch.direct_provider_callsites, arch.layer_bypass_callsites, arch.vacuous_pass_guards]
updated: 2026-08-28
links: ["[[architecture-review-charter]]", "[[architecture-review-agenda-full]]", "[[architecture-review-premortem]]", "[[architecture-review-directive]]", "[[architecture-review-loops]]", "[[architecture-review-schedule]]", "[[architecture-review-agent-stack]]", "[[architecture-review-questions]]", "[[decision-office-charter]]", "[[red-team-charter]]", "[[security-charter]]", "[[engineering-charter]]", "[[client-surfaces-charter]]", "[[platform-api-charter]]", "[[schema-migrations-charter]]", "[[messaging-delivery-charter]]", "[[research-math-charter]]", "[[harness-runtime-charter]]", "[[ai-orchestration-charter]]", "[[neural-footprint-instrumentation-charter]]", "[[model-routing-inference-economics-charter]]", "[[product-vision-charter]]", "[[0039-activation-plan-of-record]]", "[[0036-cost-routing-two-plans-in-harmony]]", "[[0035-wave2-seam-reconciliation]]"]
---

# Architecture Review — Board

**Dated 2026-08-28.** Live board for [[architecture-review-agenda-full]].
The headline number on this board is **not** the violation count. It is
`arch.findings_closed_by_decision_ratio`, and it currently reads **0 / 0**.

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

## The review surface — two queries, because two documents disagree

**Reading A — [[architecture-review-charter]] §Mandate:** *Platform, Applied AI, Product.*

```dataview
TABLE WITHOUT ID
  file.link AS Unit,
  division AS Division,
  status AS Evidence
FROM "01-org/platform" OR "01-org/applied-ai" OR "01-org/product"
WHERE type = "charter"
SORT division ASC, file.name ASC
```

**Reading B — [[ORG_STRUCTURE]] §3 as it reads today:** *All divisions.*

```dataview
TABLE WITHOUT ID
  file.link AS Unit,
  division AS Division,
  status AS Evidence
FROM "01-org"
WHERE type = "charter"
SORT division ASC, file.name ASC
```

> **The gap between those two tables is [[architecture-review-agenda-full]] §4.1**, filed
> to [[decision-office-charter]] on 2026-09-01 and unresolved here on purpose. Reading A
> leaves **L4's methodology owner outside the mandate**; Reading B is ~100 units and ~76
> teams reviewed fortnightly by a function with no build capacity. Both tables are on the
> board so the disagreement is a thing you can look at, not a paragraph. A review function
> that quietly re-scopes itself in its own agenda is doing what it exists to catch.

## Loops owned, by close-time

```dataview
TABLE close_time, status
FROM "02-advisory/architecture-review"
WHERE type = "loops"
```

## Metric set — no roll-up, by design

| Metric | 2026-08-24 | **2026-08-28** | Note |
|---|---|---|---|
| `arch.findings_closed_by_decision_ratio` | undefined | **0 / 0** | The number that decides whether this function survives. Six founding findings closed; **none by a finding** |
| `arch.finding_age_days_max` | 0 | **0** | Still the honest zero, not the flattering one — `architecture-review-questions.md:21` holds no open rows |
| `arch.layer_violations_open` | 7 raised at founding | **2 live** (AR-1, AR-5) | 4 closed, 1 moved. See [[architecture-review-agenda-full]] §0 |
| `arch.diverged_invariant_count` | 1, verified (AR-2) | **0** | Python imports a generated module; drift fails CI (`ci.yml:87-103`) |
| `arch.direct_provider_callsites` | 7 · retry 1/7 · timeout 4/7 | **1** — the boundary itself | `common/model-client/model-client.service.ts:7`; a new one fails `model-call-ledger` (`ci.yml:120`) |
| `arch.layer_bypass_callsites` | 2 files, 5 statements | **1 file, 3 statements** | `useSommelierQueries.ts:25-26, 42-43, 56` |
| `arch.duplicated_invariants` | ≥3 known | **≥1 known** + a new census subject | AR-5 remains; the guard layer is subject #1 |
| `arch.vacuous_pass_guards` | — | **unknown; 21 guards, 9 with an exit-2 path** | New metric. Baseline lands with the census, 2026-09-01 |
| `arch.handmade_ddl_objects` | 0 — held by CI | **0** | Not ours. [[schema-migrations-charter]] |

- **No aggregate.** A green convergence number must not be able to hide a diverged legal
  guardrail — the reason four green rows above are printed next to a 0/0.
- **Five of these rows improved without this function.** That is the board's most
  important fact and it is [[architecture-review-agenda-full]] §4.2's whole premise.

## Founding findings — re-measured, not re-published

| ID | Sev | State 2026-08-28 | Owner of the fix |
|---|---|---|---|
| **AR-0** | 1 | **CLOSED** — 100 of 100 `*-questions.md` exist (OD-41) | *this function* |
| **AR-1** | 1 | **OPEN, halved** — 1 file, 3 statements | [[client-surfaces-charter]] |
| **AR-2** | 1 | **CLOSED by fix + ratchet** — generated module, canon in TS, CI guard | [[messaging-delivery-charter]] |
| **AR-3** | 2 | **CLOSED by consolidation** — 7 → 1, guarded | [[model-routing-inference-economics-charter]] |
| **AR-4** | 1 | **CLOSED 2026-08-25 (P1)** | [[neural-footprint-instrumentation-charter]] |
| **AR-5** | 1 | **MOVED** — enforcement is at the auth stage; no endpoint count asserted | [[security-charter]] (OD-19) |
| **AR-6** | 3 | **Precedent, vindicated** — its template has been copied 20 more times | [[schema-migrations-charter]] |

## Scheduled — every item carries a close-time

| Item | Close-time | Blocked by |
|---|---|---|
| **AR-A1.0** — axes pre-registered before the protocol is readable | **2026-08-28** ✅ | — |
| **AR-A1.1–.5** — the five-axis adversarial pass on the bake-off protocol | **3 days** after `scripts/bakeoff/` lands; **hard stop before the first scored run** | the protocol landing on a readable branch |
| **AR-A1.6** — one revision round | 7 days after the revision | AR-A1.1–.5 |
| **AR-A1.7** — post-run read, **before** OD-03 is flipped to Resolved | 3 days after the scored run | the run |
| **AR-B1** — the guard census, 21 enforcement points, named list | **2026-09-01**; escalates 2026-10-13 | — |
| **AR-B2** — severity-ladder amendment *(REACH — needs a founder answer)* | raised 2026-09-01 | founder |
| **AR-B3** — the seam-line watch, ADR 0035's eight items | **2026-09-15** | — |
| **AR-B3** — ADR 0036's failure test, first read | **2026-11-28** | — |
| **AR-B4** — directory→layer map, first draft as a README §1 amendment | **2026-09-01** | ownership of the *answer* is §7 Q3 |
| **AR-B5** — AR-1 / AR-5 re-check (re-check, never re-publish) | every sweep from **2026-09-01** | — |
| **AR-C1** — scope contradiction filed to decision-office | **2026-09-01**; binary at 2026-10-13 | — |
| **AR-C2** — merge trigger, denominator ≥ 5 or file the merge | **2026-11-24**, fixed | — |

## Open forks on this board

- [ ] **Scope** — [[ORG_STRUCTURE]] §3 *"All divisions"* vs the charter's *"Platform,
      Applied AI, Product."* Two tables above; one answer needed
- [ ] **The 42-day escalation** — adopted as automatic, or not? Every close-time here
      assumes it
- [ ] **The merge trigger at its restated premise** — denominator ≥ 5 by 2026-11-24, or merge
- [ ] **Who owns the layer map's answer?** An interface owned by the reviewed party is not
      an interface
- [ ] **Is a check that can pass without checking Sev-1?** Severity-ladder amendment
- [ ] **The evaluation seam** — **TECH-F3** ([[FORK-REGISTRY]]). Unchanged; read here as an
      L4 ownership question. Instruction on record stands: **merge, never duplicate**

## Watch signals — from [[architecture-review-premortem]]

- [ ] A finding acknowledged with no `OPEN-DECISIONS.md` line in the same sweep — the
      earliest signal of theatre, available at day 14
- [ ] `arch.finding_age_days_max` rising two sweeps running while `findings_closed` stays 0
- [ ] Three sweeps whose findings are all of a class a linter could have produced
- [ ] The same `path:line` cited by two advisory functions in one sweep
- [ ] Three findings against one seam, all argued down on **design** grounds
- [ ] Product's share of the finding log below a quarter after four sweeps
- [ ] `arch.direct_provider_callsites` going from 1 to 2 — **the threshold moved**: it is
      now a ratchet held by a blocking guard, so a rise means the guard was bypassed
- [ ] **New:** a bake-off axis flagged as rigged in §2.2 that survives into the scored run
      and moves the result

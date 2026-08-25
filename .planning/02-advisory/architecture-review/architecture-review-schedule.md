---
type: schedule
division: advisory
department: architecture-review
status: new
metrics: [arch.layer_violations_open, arch.finding_age_days_max, arch.findings_closed_by_decision_ratio, arch.diverged_invariant_count, arch.direct_provider_callsites, arch.layer_bypass_callsites]
updated: 2026-08-24
links: ["[[architecture-review-charter]]", "[[architecture-review-loops]]", "[[architecture-review-directive]]", "[[architecture-review-premortem]]", "[[architecture-review-agenda-full]]", "[[architecture-review-agenda-board]]", "[[decision-office-charter]]", "[[red-team-charter]]", "[[security-charter]]", "[[skills-charter]]", "[[skill-lifecycle-anti-sprawl-charter]]", "[[engineering-charter]]", "[[schema-migrations-charter]]", "[[client-surfaces-charter]]", "[[platform-api-charter]]", "[[messaging-delivery-charter]]", "[[research-math-charter]]", "[[ai-orchestration-charter]]", "[[product-vision-charter]]", "[[README]]", "[[ORG_STRUCTURE]]"]
---

# Architecture Review — Schedule & Skills

## Recurring work

| Cadence | Job | Emits | State |
|---|---|---|---|
| **Fortnightly (1st, 15th)** | **Layer sweep** — one division on rotation, plus any cross-cutting finding | `arch.layer_violations_open` | **NEW — not built.** Blocked on AR-0 |
| **Fortnightly, same session** | **Invariant census** — one invariant, every enforcement point, compared | `arch.duplicated_invariants`, `arch.diverged_invariant_count` | **NEW.** Method proven once (AR-2) |
| **Fortnightly, same session** | **Finding-age report** — every open finding re-reported with its age; anything at 42 days converted to an `OPEN-DECISIONS.md` binary | `arch.finding_age_days_max`, `arch.findings_closed_by_decision_ratio` | **NEW.** The job that decides whether this function is real |
| Monthly | **Callsite count** — direct provider callsites, L6→L0 bypass statements | `arch.direct_provider_callsites` (7), `arch.layer_bypass_callsites` (2 files) | **NEW.** Countable today with one grep |
| Per commit | **Import-boundary check**, shaped like `check_schema_parity.sh` | pass/fail | **NEW — not built.** Needs the layer map first ([[architecture-review-agenda-full]] Step 1) |
| **Quarterly** | **Layer-stack review** — *"is [[README]] §1 still the right decomposition?"* | a confirmed or amended stack | **NEW.** On the calendar whether or not anything has gone wrong |
| One-shot, dated | **2026-11-24 — the merge-trigger check.** Fewer than half of findings closed by decision → merge into [[decision-office-charter]] | a closed decision about this function | **NEW.** Proposed as binding |

### The rotation, because "reviews everything" is how Product gets skipped

| Sweep | Division under review |
|---|---|
| 1, 4, 7 … | **Platform** — [[engineering-charter]], [[data-charter]], [[reliability-sre-charter]] |
| 2, 5, 8 … | **Applied AI** — [[ai-orchestration-charter]], [[skills-charter]] |
| 3, 6, 9 … | **Product** — [[product-vision-charter]], [[design-charter]], [[partnerships-integrations-charter]], [[guest-experience-charter]] |

Cross-cutting findings (AR-2, AR-4) are raised in whichever sweep finds them and are not
held for a division's turn. **A skipped rotation is reported on
[[architecture-review-agenda-board]] as a skipped rotation** — never quietly absorbed into
the next one. [[architecture-review-premortem]] #5 is Product falling off this list because
it is the hardest division to review by layer analysis and the easiest to postpone.

### Anti-sprawl, applied to this function without an exemption

[[README]] §6: *a scheduled job that produces no action for 3 consecutive runs is downgraded
or deleted.* [[ai-orchestration-schedule]] argues one of its jobs into an exemption on the
grounds that zero findings is its success condition. **That argument is available here and
is explicitly declined.**

Three sweeps that find nothing is real evidence about one of two things — either the layer
rule is being followed (in which case fortnightly is too often and the cadence should drop
to monthly), or this function has stopped looking properly
([[architecture-review-premortem]] #2). Both readings demand a change, and the sweep must
not be the one job in the org that gets to keep running on the strength of its own
self-description. A review function that exempts itself from the review rules is the joke
that writes itself.

**The finding-age report is the single exception, and for a different reason:** it does not
generate findings, it ages them. It runs whenever the log is non-empty and stops when the
log is empty, which is a terminal condition rather than a staleness one.

## Skills owned

Skills live in **`.claude/skills/`**. **The directory does not exist yet** —
[[README]] §3.1 records that `git ls-files` returns **no `SKILL.md` at all**. So every
entry below is a **candidate**, not a registry line.

[[README]] §3.3 rule 3 forbids speculative skills: a skill may not be committed without
citing **a real past instance where it would have helped**. Those instances are recorded
here now, while they are still fresh, precisely so the citation is not written after the
fact to satisfy a checklist.

| Candidate skill | Tier | Trigger | Real past instance it would have caught |
|---|---|---|---|
| `invariant-census` | T2 department | A sweep starts; or a comment claims code was "ported"/"mirrored"/"kept in sync" | **AR-2.** `inbound-responder.service.ts:44-48` says the commitment guardrail was *"Ported verbatim from …provider_conversation_agent.py."* It is 19 patterns in TS (`:49-70`) and 8 in Python (`:120-129`). The word "verbatim" in a comment is the highest-yield trigger this function has, because it is a claim about a second file that nothing verifies |
| `layer-boundary-check` | T3 operational | Any commit touching `apps/web`, `apps/api-gateway/src`, or `services/agent-orchestrator` | **AR-1.** `useSommelierQueries.ts:25-26,42-43,56` and `useReportQueries.ts:25-26,36-37` reach Postgres from the browser, skipping L1, L2 and the gateway — while `reports.service.ts:54,72,100` owns the same table at L2. Two access paths, two security models, and the browser one has **no RLS policy at all** on `generated_reports` |
| `finding-age-report` | T3 operational | Every sweep, whenever the finding log is non-empty | Nothing yet — the log does not exist. Cited honestly as the one candidate here with **no past instance**, which under [[README]] §3.3 means it may not be committed as a skill until the log exists. It is a scheduled job first |
| `layer-assignment` | T2 department | A new top-level directory, service, or app appears | The gateway is L1, L2 **and** L6 depending on the file, and nothing anywhere says so. `L4` currently has no directory at all — `api_spend` and `decision_log` are two tables with no join key (**AR-4**), which is what an unassigned layer looks like from the inside |
| `metering-census` | T3 operational | A commit adds a call to an external model provider | **AR-3.** Seven callsites each declare their own `api.anthropic.com/v1/messages`; one of seven retries; three of seven have no timeout; **zero of seven write to `api_spend`** — `grep -rn "api_spend|cost_usd|input_tokens" apps/api-gateway/src` returns 0 hits |

**Ownership seam.** This function owns these skills' **content**; [[skills-charter]] owns
the `SKILL.md` contract, the registry, and the 30-day staleness review that deletes them
([[skill-lifecycle-anti-sprawl-charter]]). A skill here that has not fired in 30 days is
reviewed for deletion like any other — including `layer-boundary-check`, which should
gradually stop firing as the boundary holds, and whose declining fire-rate is a *result*,
not a reason to keep it on life support.

**One skill this function will be tempted to write and should not:** an
`architecture-review` skill that produces a sweep document. That is the artifact of
theatre — a procedure that reliably emits a well-formatted review regardless of whether
anything was reviewed. [[architecture-review-premortem]] #1. The sweep is a job with a
human judgement in it; the skills above are the mechanical parts around that judgement.

## What this function owes other schedules

| To | When | What |
|---|---|---|
| [[decision-office-charter]] | Every sweep | Findings that imply a decision; every 42-day escalation. **We are one of their loudest inbound queues**, which is the mechanical reason our merge trigger points there |
| [[security-charter]] | On overlap | The invariant half of any finding whose exploitability is theirs — AR-5 today. One finding, cross-linked, never two |
| [[red-team-charter]] | Continuous | The finding log itself, as an attack surface: *what changed in the repo because this was written?* |
| [[research-math-charter]] · [[neural-footprint-instrumentation-charter]] | Monthly | AR-4's status — whether `decision_log` and `api_spend` can yet be joined |
| [[schema-migrations-charter]] | Read-only | We consume `check_schema_parity.sh`'s verdict. We do not run it and do not own it |
| The founder | Quarterly | Whether [[README]] §1's L0–L6 stack is still the right decomposition |

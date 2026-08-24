---
type: schedule
division: research-math
department: research-math
team: neural-footprint-instrumentation
status: provisional
metrics: [nf_a.event_completeness, nf.private_telemetry_tables, nf_b.identifier_coverage]
updated: 2026-08-24
links: ["[[neural-footprint-instrumentation-charter]]", "[[neural-footprint-instrumentation-loops]]", "[[neural-footprint-instrumentation-directive]]", "[[neural-footprint-instrumentation-agenda-board]]", "[[research-math-schedule]]", "[[data-charter]]", "[[security-charter]]", "[[harness-model-routing-charter]]", "[[evaluation-doneability-charter]]", "[[0006-neural-footprint-architecture]]"]
---

# Neural Footprint Instrumentation (RM-3) — Schedule & Skills

## Non-preemptible

One item from the department's protected lane ([[research-math-schedule]]) is this team's:
**bringing NF-A to one joinable event.** Half-instrumented telemetry is worse than none —
it looks measured and is not.

**A second item belongs here by argument rather than by inheritance: the research store.**
It is the only deliverable in this charter with **no urgent consumer**, which is exactly
what makes it the first thing a deadline eats. It is also the physical form of the
compensation the founder was granted when the separate research company was declined
([[0001-mudavym-single-entity]] review trail; [[0006-neural-footprint-architecture]]
Consequences). Unbuilt, that grant is rhetoric. It ships in the same change as the
production store even if month one it holds duplicate rows.

Preemption of either is a founder decision recorded in `OPEN-DECISIONS.md`.

## Recurring work

| Cadence | Job | Emits |
|---|---|---|
| **Weekly** | Publish `nf_a.event_completeness` — **starting at 0% for NestJS.** The zero is the deliverable, not an embarrassment to defer | NF-A |
| **Weekly** | **Private-telemetry-table scan** — any new table holding token counts, cost, or a verdict outside the NF contract. **1 today; 2 is a same-day escalation** | — |
| **Weekly** | Suppressed-emission counter review — telemetry fails soft (`spend_logger.py:83-86`), so silence must be counted through a different path | NF-A |
| **Weekly** | Callsite instrumentation ledger — **0 of 7** today | NF-A |
| **Fortnightly** | **OD-11 working session with [[data-charter]]** until it closes. Standing agenda: columns · partial indexes · retention · **F-3** · research-log shape · both owners named | — |
| **Monthly** | **Invoice reconciliation** — provider bill vs. summed NF event cost. Alarm at >5% delta. The only number in this charter this team cannot influence | NF-A |
| **Monthly** | NF-B contract review with Guest Experience and Compliance: identifier coverage, erasure requests honoured (`erased_at`, `:112`) | NF-B |
| **Monthly** | Contract-drift check — any `subject_type` value or telemetry field added outside the contract | — |
| **Quarterly** | **NF-C entry-trigger check** — funded study partner, or consumer biosignal device with an API? Otherwise **no work at all**, by design | — |
| **Quarterly** | Premortem review against what actually happened | — |

**Anti-sprawl.** A job with no action for **3 consecutive runs** is downgraded or deleted
([[README]] §6). Two are designed to retire: the private-table scan should become a CI
check once the contract exists (a script, not a meeting — and its going quiet is
*success*), and the OD-11 session terminates when OD-11 closes. The NF-C check is
deliberately the cheapest recurring item in the org: it exists so the gate is a decision
rather than an oversight, and it is expected to answer "no" for a long time.

## Skills owned

Skills live in `.claude/skills/`. Unfired for 30 days → reviewed for deletion. Each names a
**trigger**, **doneability criteria**, and **a real past instance** ([[README]] §3.3).

| Tier | Skill | State | Trigger · Doneability · Real past instance |
|---|---|---|---|
| **T3** | `nf-event-audit` | **Proposed — build first** | *Trigger:* any PR touching a model callsite or a telemetry writer. *Done:* reports every model invocation path and which of the eight NF-A fields it emits; fails on a new path emitting none. *Past instance:* seven NestJS callsites emit nothing and were found only by a hand-grep for this charter — **0 hits** for `api_spend`/`cost_usd`/`input_tokens` |
| **T3** | `telemetry-table-scan` | **Proposed** | *Trigger:* weekly, and on any migration. *Done:* lists tables holding cost/token/verdict data outside the contract, each with its dated fold-in line or a flag. *Past instance:* `decision_log` and `api_spend` already diverged into two unjoined halves with no owner noticing |
| **T3** | `spend-reconcile` | **Proposed** | *Trigger:* monthly. *Done:* provider invoice vs. summed NF cost, delta and per-callsite attribution. *Past instance:* `SpendLogger` returns early when Supabase is unconfigured (`:66-70`) and never re-raises (`:83-86`) — a whole environment can be silently unlogged |
| **T2** | `nf-contract-lint` | **Proposed, after OD-11** | *Trigger:* any migration touching an NF table. *Done:* rejects a new `subject_type` value or telemetry field added outside the contract. *Past instance:* fork F-3 exists because `subject_type` was drafted with three values and the product already collects a fourth kind of subject |

**Honest note.** None of these exist. `SpendLogger` is the closest thing to a telemetry
skill in the repo and it is a class, not a skill. Build `nf-event-audit` first: it is the
only one that stops the gap this charter documents from widening while the contract is
being negotiated — the eighth uninstrumented callsite is cheaper to prevent than to find.

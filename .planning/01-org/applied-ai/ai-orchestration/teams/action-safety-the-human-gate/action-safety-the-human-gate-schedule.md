---
type: schedule
division: applied-ai
department: ai-orchestration
team: action-safety-the-human-gate
status: partial
metrics: [safety.unconfirmed_mutation_count, safety.median_time_to_confirm, safety.rejection_rate]
updated: 2026-08-24
links: ["[[action-safety-the-human-gate-charter]]", "[[action-safety-the-human-gate-loops]]", "[[action-safety-the-human-gate-directive]]", "[[action-safety-the-human-gate-agenda-full]]", "[[ai-orchestration-schedule]]", "[[skills-charter]]", "[[skill-lifecycle-anti-sprawl-charter]]", "[[design-charter]]", "[[compliance-and-privacy-charter]]", "[[red-team-charter]]"]
---

# Action Safety & the Human Gate — Schedule & Skills

## Recurring work

| Cadence | Job | Emits | State |
|---|---|---|---|
| Per commit | **Confirmation-upstream check** — every mutation path has a confirmation record above it | `safety.schema_coverage` | proposed · needs the definition |
| **Daily** | **Unconfirmed-mutation scan** — agent writes to stock, money, or an outbound channel with no `executed_by` | `safety.unconfirmed_mutation_count` | proposed · **unblocked** |
| Weekly | Auto-execution path sweep — any execute path outside the one-tap action center | list of paths | proposed · **unblocked**; one open instance today |
| **Monthly** | **Gate integrity review** — `time_to_confirm` **distribution**, `rejection_rate` | behavioural trend | proposed · **unblocked** — a query against existing columns |
| Monthly | Attention budget — confirmations per user per day, by family | `safety.confirmations_by_family` | proposed |
| Quarterly | **Allowlist review** — additions vs removals; families unused for 90 days | `safety.allowlist_additions_vs_removals` | proposed |
| Quarterly | Audit reconstructability spot-check — pick 10 confirmations, try to reconstruct what the human was shown | `safety.confirmations_with_proposal_snapshot_pct` | proposed |

### Anti-sprawl, and the exemptions this team claims

[[README]] §6: a job producing no action for 3 consecutive runs is downgraded or
deleted. **Three jobs here are exempt, and the exemption is stated rather than assumed
because it will be challenged by anyone applying the rule mechanically:**

- **The daily unconfirmed-mutation scan.** Zero findings is its success condition. A
  safety scan deleted for finding nothing is [[action-safety-the-human-gate-premortem]]
  written as a process.
- **The per-commit confirmation-upstream check.** A recurrence guard. Silence is
  success.
- **The weekly auto-execution sweep.** Same shape.

The **monthly gate-integrity review is not exempt** — but note that it is exactly
inverted from the others: it is *supposed* to produce findings, because human behaviour
drifts. Three consecutive months with nothing to say about it means it is not being
run honestly, not that it should be deleted.

## Skills owned

Skills live in `.claude/skills/`, **which does not exist yet** ([[skills-charter]]).
Candidates, with their [[README]] §3.3 rule-3 citations recorded now while the
instances are fresh.

| Candidate skill | Tier | Trigger | Real past instance |
|---|---|---|---|
| `mutation-gate-review` | T2 department | A PR touches a path that writes stock, moves money, or sends to an outbound channel | The guarantee is upheld by **four independent conventions, not one mechanism** (`technology.md:441`) — `drift_agent.py:8-12`, `one-tap-actions/`, vendor-reply never-auto-send, `ux-optimizer/` never-auto-apply. Four correct implementations, and nothing that would object to a fifth path forgetting |
| `auto-execution-sweep` | T3 operational | Weekly | `agents/recurring_order_agent.py:14` — plain class, registered nowhere, feature list says *"Auto-execution with manager approval"*, sitting in the repo with passing tests and no gate |
| `gate-integrity-report` | T2 department | Monthly | `one-tap-actions.service.ts:245-246` already writes `executed_at`, and `@Post(":actionId/cancel")` (`one-tap-actions.controller.ts:246`) already provides the rejection signal. Both have existed and neither has ever been read |
| `allowlist-review` | T2 department | Quarterly | `FUTURES.md` §8.2 defines seven families and five hard-gated exclusions. Nothing tracks whether that list has grown, and every growth so far has been invisible |
| `confirmation-context-check` | T3 operational | A PR changes the confirmation record or the proposal renderer | `drift_agent.py:17` writes a `decision_log` row for every run and every finding. The one-tap confirmation record does not carry the equivalent, so a disputed action can prove *who clicked* and not *what they saw* |

**Lifecycle.** [[skill-lifecycle-anti-sprawl-charter]] owns the 30-day staleness
review. `auto-execution-sweep` and `mutation-gate-review` should carry their
exemption **in their own `SKILL.md` frontmatter** — a recurrence-guard skill whose
success looks like silence will otherwise be deleted by a lifecycle job doing exactly
its job.

## Handoffs on a cadence

| To | When | What |
|---|---|---|
| [[ai-orchestration-schedule]] | Daily | `safety.unconfirmed_mutation_count` for the department board |
| [[design-charter]] | Monthly | `time_to_confirm` distribution and confirmations-per-day — surface and friction floor are different decisions |
| [[compliance-and-privacy-charter]] | Quarterly | Allowlist state, guest-PII family status, audit reconstructability |
| [[red-team-charter]] | On request | Gate-integrity data. **The attack surface is the reflex, not the bypass** |
| [[decision-office-charter]] | On event | Any proposal to relax `FUTURES.md` §8.1 — a supersede-ADR, never a PR |

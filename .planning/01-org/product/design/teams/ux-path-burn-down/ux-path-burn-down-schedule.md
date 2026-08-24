---
type: schedule
division: product
department: design
team: ux-path-burn-down
status: provisional
metrics: []
updated: 2026-08-24
links: ["[[ux-path-burn-down-charter]]", "[[ux-path-burn-down-loops]]", "[[ux-path-burn-down-agenda-board]]", "[[design-schedule]]", "[[skills-charter]]", "[[engineering-charter]]", "[[decision-office-charter]]", "[[UX_PATHS_CATALOG]]"]
---

# UX Path Burn-Down — Schedule & Skills

## Recurring work

| Cadence | Job | Emits |
|---|---|---|
| Weekly | **Blocker reconciliation** (`L-UXB-1`) — every "Unblocked by" cell in `UX_PATHS_CATALOG.md:10-67` checked against the repo | still-blocked / now-unblocked / **uncheckable**; `design.ledger_drift_days` |
| Weekly | Banner-versus-log parity — the `:15` rule (*"Update both places"*) enforced by script, since it already failed as an instruction | Mismatch list between the log and the 24 section banners |
| Weekly | Path close report — rows closed, by tier, with the service-route split | `design.paths_closed_per_month`, `design.paths_closed_on_service_routes` |
| Weekly | Endpoint-blocked census — count, and how many carry a named Engineering counterpart | `design.blocked_on_endpoint_count` |
| Monthly | Close rate vs service surface (`L-UXB-2`) — the two-number trend | Reallocation, or an alarm at 3 flat close-times |
| Monthly | Escalation review (`L-UXB-3`) — rising count with zero escalations is the alarm | Report to [[decision-office-charter]] |
| Monthly | Inflow review (`L-UXB-4`) — at least one row originated outside the catalogue | `design.rows_originated_outside_catalogue`; `design.catalogue_total` (**910**) |
| Quarterly | Denominator audit — re-count unique `NEW-` IDs and correct the figure wherever it is quoted | Corrected count; today **910**, quoted elsewhere as 760 |
| Quarterly | Staleness sweep — this team's own artifacts, 60 days ([[README]] §3.3, §6) | Archive or revision |

**The weekly jobs are scripts, not meetings.** [[ux-path-burn-down-premortem]] M1's root
cause is that `:15` asked a human to remember something during a burn-down session. The
counter-pressure to a failed human instruction is never a firmer human instruction.

## Skills owned

Skills live in `.claude/skills/`. A skill that has not fired in 30 days is reviewed for
deletion.

**Honest state: `.claude/skills/` does not exist in this repository.** The only project
skill on disk is `.agents/skills/railway-config/SKILL.md` ([[README]] §3.1). This team owns
**zero skills today**. The table below is a proposal built to the protocol in
[[README]] §3.3 — trigger, doneability criteria, and a **real past instance**, never a
speculative one.

| Proposed skill | Trigger | Doneability criteria | Real past instance |
|---|---|---|---|
| `ux-ledger-reconcile` | Weekly, and before any section is prioritized | Every `:10-67` cell resolves to a repo artifact or is reported uncheckable; zero silent skips | **`:49` vs `:1013`** — §AA marked blocked on a widget that shipped 2026-07-27 |
| `ux-banner-parity` | Weekly, alongside reconcile | Log rows and the 24 section banners agree, or the diff is published | The `:15` instruction failing exactly once is enough; it is a class, not an incident |
| `ux-path-count` | Quarterly, and on any catalogue edit | Unique `NEW-` ID count published and propagated to every doc quoting it | **760 vs 910** — [[engineering-premortem]] M5 quotes a stale denominator |
| `ux-path-to-e2e` | On closing a row | A test exists whose name reads as the row's trigger→outcome sentence (`:70`) | The ~90–100 already-closed paths have no test-level record of what "closed" meant |
| `ux-service-route-split` | Weekly close report | Closed rows partitioned into service / non-service routes | Never done — which is why premortem M2 is currently undetectable |

**Nothing in this table exists yet.** Each is tied to a scheduled job above, so a skill is
created against a close-time rather than a job being invented to justify a skill.
Registry governance sits with [[skills-charter]] (Applied AI), not here.

### The one job this team should be judged on first

`ux-ledger-reconcile`. It produces no visible product change, it will be the easiest thing
to skip in week six, and it is the only job that can detect the failure this team was
created because of. If exactly one scheduled item survives the first quarter, it should be
this one.

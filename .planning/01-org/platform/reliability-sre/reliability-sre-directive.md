---
type: directive
division: platform
department: reliability-sre
status: provisional
metrics: [sre.mttd_silent_corruption, sre.time_to_revert]
updated: 2026-08-24
links: ["[[reliability-sre-charter]]", "[[reliability-sre-premortem]]", "[[reliability-sre-loops]]", "[[decision-office-charter]]", "[[red-team-charter]]", "[[engineering-charter]]"]
---

# Reliability / SRE — Directive

How *this* department decides. The shape is driven by one property that distinguishes it
from [[engineering-charter]]: **most decisions here are made under a signal that may
itself be wrong.** So the first branch is never "what do we do" — it is "do we believe
the number".

```mermaid
graph TD
  A[Signal arrives: alert, gate, finding, or report] --> B{Is the signal itself alive?}
  B -->|"Liveness twin absent or flat"| Z[Treat as observability incident<br/>NOT as 'all clear']
  Z --> OBS[[observability-telemetry-plumbing-charter|observability-telemetry-plumbing]]
  B -->|Signal trusted| C{Loud or quiet failure?}
  C -->|"Loud - breaks, throws, pages"| D{Reversible by revert?}
  C -->|"Quiet - wrong but running"| E[[state-integrity-invariants-charter|state-integrity-invariants]]
  D -->|Yes| REL[[release-engineering-charter|release-engineering]]
  D -->|"No - state already diverged"| E
  C -->|"Degraded but absorbed"| RES[[runtime-resilience-charter|runtime-resilience]]
  D --> F{Touches more than one team?}
  E --> F
  RES --> F
  F -->|No| G[Team decides within its close-time]
  F -->|Yes| H[Department decides. Never the team that noticed first]
  G --> I{Needs a rule change, not a fix?}
  H --> I
  I -->|No| J[Close in the owning loop]
  I -->|Yes| K[Raise to OPEN-DECISIONS + questions.md]
```

## Decision rights

| Decision | Who decides | Who may not |
|---|---|---|
| Whether a metric is trustworthy | [[observability-telemetry-plumbing-charter]] | The team whose metric it is |
| Whether to revert or roll forward | [[release-engineering-charter]] | Whoever wrote the change |
| Declaring a CI/parity gate red | [[state-integrity-invariants-charter]] | [[schema-migrations-charter]] — author ≠ auditor (`technology.md:860`) |
| Replaying or discarding a DLQ message | [[runtime-resilience-charter]] | Automatic policy, where money or stock is touched |
| Applying a `drift_findings` remediation | Human gate, always, for money and stock (`drift_agent.py:11-16`) | Any agent, unattended |
| Deleting a gate nobody will fix | Department | A team, unilaterally |
| Re-opening Incident Command or Infra Cost | Founder, at the recorded trigger only | Anyone, on vibes |
| Anything touching two teams | Department | The team that noticed first |

**The one non-negotiable:** a decision made because a dashboard was green is invalid
unless the dashboard's liveness twin was also green. This is the entire M1 counter-pressure
([[reliability-sre-premortem]]) expressed as a decision rule rather than a hope.

## Escalation trigger

Escalate to `OPEN-DECISIONS.md` — never resolve locally — when any of these hold:

1. **The fix requires changing a rule**, not applying one (e.g. relaxing an invariant,
   widening an idempotency window, granting an agent unattended write authority).
2. **A gate has been red for two consecutive runs** and the proposed close is a sentence
   rather than a commit. The escalation is the forced binary: fix it or delete it.
3. **Two teams both decline a finding**, or both claim it. A seam with two owners has none.
4. **A rejected team's entry trigger appears to have fired** — a second human on a pager,
   or a platform bill worth watching ([[reliability-sre-charter]]). The rejection was
   scale-dependent; the escalation re-argues it rather than quietly resurrecting it.
5. **A restore, revert, or kill-switch was used for the first time in anger** — regardless
   of outcome. First-use of an untested recovery path is a finding even when it works,
   because it worked *unverified*.

## How this department handles being wrong

Advisory functions are findings-only ([[ORG_STRUCTURE]] §3): [[red-team-charter]] and
[[decision-office-charter]] do not block here, they file. A finding against this
department lands in `questions.md` and is answered **within the close-time of the loop it
concerns** ([[reliability-sre-loops]]) — not "soon". A finding older than its own loop's
close-time is itself reportable to [[decision-office-charter]], which is the only
mechanism that makes findings-only advisory meaningfully binding.

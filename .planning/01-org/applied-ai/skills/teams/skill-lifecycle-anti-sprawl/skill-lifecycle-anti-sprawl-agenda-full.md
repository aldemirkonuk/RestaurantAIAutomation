---
type: agenda-full
division: applied-ai
department: skills
team: skill-lifecycle-anti-sprawl
status: provisional
metrics: [skills.deletions_per_quarter, skills.firing_rate_30d, skills.registry_size]
updated: 2026-08-24
links: ["[[skill-lifecycle-anti-sprawl-charter]]", "[[skill-lifecycle-anti-sprawl-premortem]]", "[[skill-lifecycle-anti-sprawl-directive]]", "[[skill-lifecycle-anti-sprawl-loops]]", "[[skill-lifecycle-anti-sprawl-schedule]]", "[[skill-lifecycle-anti-sprawl-agenda-board]]", "[[skills-agenda-full]]", "[[skill-registry-authoring-charter]]", "[[ai-orchestration-charter]]", "[[README]]"]
---

# Skill Lifecycle & Anti-Sprawl — Full Agenda

> **PROVISIONAL — no work done yet.** This is forecast, not fact. The team has zero
> artifacts, zero telemetry, and nothing to delete.

## What

Make deletion possible, then make it routine. Three deliverables, strictly ordered:

1. **A firing signal.** `skill_id` (and, in the same ask, the doneability verdict)
   on the NF-A event — or a crude filesystem/harness-log proxy if that negotiation
   stalls.
2. **The weekly skill-health job.** What fired, what went stale. Built in the shape
   of `.github/workflows/schema-parity.yml:26-27` (daily cron, fails loudly).
3. **A default-delete staleness review** with real removal authority and a
   removal-dated deprecation path.

Everything else this team could do is downstream of #1. There is no useful version
of this team that skips it.

## How

- **Negotiate the field early and once.** The ask into
  [[ai-orchestration-charter]] / `[[observability-telemetry-plumbing-charter|sre-observability]]` is two fields on one event:
  `skill_id` and the existing doneability verdict ([[README]] §4.2). Asking for both
  together costs one negotiation instead of two, and #4 in the premortem needs the
  second field.
- **Have a fallback ready before the negotiation starts.** An append-only invocation
  log written by the harness is cruder than an NF-A field and sufficient to make
  deletion defensible. Adopt it at the first sign of slippage rather than waiting.
  A crude signal that exists beats a clean one that is blocked.
- **Copy the cron, do not design one.** `schema-parity.yml` is a scheduled job that
  detects quiet accumulating divergence and fails loudly. Same problem shape.
- **Default-delete.** A skill unfired for 30 days is deleted unless someone writes
  down why and by when it must fire. Retention carries the burden of proof, because
  a deleted skill is one `git revert` away.
- **Deprecation means scheduled deletion.** Every deprecation carries a removal
  date, and the skill leaves `.claude/skills/` immediately — if the harness can
  still select it, nothing has been deprecated
  ([[skill-lifecycle-anti-sprawl-premortem]] M3).

## Why now

- **The registry is empty, which is the only moment telemetry is cheap.** Wiring a
  firing signal before skill #1 is a design choice; wiring it at skill #12 is a
  migration with a backfill problem and no historical data.
- **The mandate is already live.** Skills are being asked for constantly. The brake
  must be installed before the acceleration, not after — retrofitted brakes are a
  cleanup project, and cleanup projects do not get staffed.
- **Honest counter-argument:** with `registry_size == 0`, this team has nothing to
  delete and will look idle for a quarter. That is the correct shape. Its output
  this quarter is a *signal*, not a number, and it should be judged on whether
  `firing_rate_30d` becomes defined — not on deletions it cannot yet make.

## Next steps

| # | Step | Output | Blocked by |
|---|---|---|---|
| 1 | Write the telemetry ask: `skill_id` + doneability verdict on NF-A | one-page request | — |
| 2 | Agree the **"telemetry precedes skill #2"** rule with [[skill-registry-authoring-charter]] | enforced at their gate | — |
| 3 | Spec the fallback invocation log | design note | — |
| 4 | Land the field (or the fallback) | `firing_rate_30d` becomes defined | [[ai-orchestration-charter]], OD-11 |
| 5 | Build the weekly skill-health job | cron + loud failure | 4 |
| 6 | Write the default-delete review procedure + deprecation-with-removal-date rule | procedure | — |
| 7 | Enforce the paired-deletion rule at ceiling N | `check_*.sh` guard | founder sets N |

Steps 1–3 and 6 need nobody's permission and should start immediately. Step 4 is
the critical path and it runs through another department.

## Questions for the founder

1. **Who runs the weekly skill-health job?** [[README]] §6 assigns it to Research &
   Math; [[technology]] §4.2 assigns the staleness review here. Both cannot own it.
   Proposal: Research & Math owns T4 meta-skill methodology, this team runs the job
   and holds deletion authority. **Needs an `OPEN-DECISIONS.md` entry** — this
   session could not write outside the department directory.
2. **What is the registry ceiling N?** The paired-deletion rule needs a number, and
   a team scored on deletions must not set its own trigger.
3. **Does this team get deletion authority over founder-authored skills?** If not,
   say so now — [[skill-lifecycle-anti-sprawl-premortem]] M3 is the predictable
   result, and it is better designed around than discovered.
4. **Is a crude harness-side invocation log acceptable as the v0 signal**, or must
   this wait for the NF-A schema (OD-11, open)? The difference is roughly a quarter
   of this team being able to function at all.

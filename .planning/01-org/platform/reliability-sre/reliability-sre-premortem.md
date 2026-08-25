---
type: premortem
division: platform
department: reliability-sre
status: provisional
metrics: [nf_a.emission_coverage, sre.time_to_revert, sre.dlq_depth_and_oldest_age, sre.mttd_silent_corruption, sre.days_since_verified_restore]
updated: 2026-08-24
links: ["[[reliability-sre-charter]]", "[[reliability-sre-loops]]", "[[reliability-sre-directive]]", "[[observability-telemetry-plumbing-premortem]]", "[[release-engineering-premortem]]", "[[runtime-resilience-premortem]]", "[[state-integrity-invariants-premortem]]", "[[red-team-charter]]", "[[decision-office-charter]]"]
---

# Reliability / SRE — Premortem

> Written at founding, before success is assumed.

## It is 2027-08. Reliability/SRE has failed. What happened?

The department's distinguishing property is that **its machinery already exists**
(`technology.md:791,817`). So it did not fail by failing to build. It failed the way
built-and-unwatched systems fail: every mechanism worked exactly as designed, every
dashboard was green, and green stopped meaning anything.

---

### M1 — Green became the absence of a signal rather than the presence of health

This is the department's *characteristic* failure, and three of its four teams have their
own version of it: `NoopMetric` makes zero look like calm
(`observability.py:53`); a well-engineered DLQ makes lost work look like a working queue
(`message_bus.py:524-533`, nothing consumes `queue.dead_letters`); and `drift_findings`
rows sitting at status `open` make detection look like resolution
(`drift_agent.py:11-16`). Twelve months in, the board is green, the restaurants are
complaining, and every team can prove it was not them.

**Earliest observable signal.** A **metric that reads exactly zero for a full close-time
after being non-zero the week before** — not an alarm, an absence. Concretely: DLQ depth
`0` on a week where `messages_dead_lettered` (`message_bus.py:303`) incremented, or a
Prometheus panel flat at zero across a deploy boundary.

**Counter-pressure.** Every metric this department owns must have a **liveness twin** —
a value that is non-zero *by construction* when the pipeline is alive, so that "no data"
and "no problem" are different-looking. `observability_degraded` is exposed on
`health-proxy.controller.ts` rather than only logged; the no-op fallback logs at WARNING,
not INFO (`observability.py:50`). A metric with no liveness twin is not accepted onto
[[reliability-sre-agenda-board]].

---

### M2 — The restore was never tested, and the first restore was the real one

`scripts/backup_db.sh` and `scripts/restore_db.sh` are 19 and 25 lines and are referenced
by **no workflow, no test, and no schedule**. The team is busy — observability plumbing,
CI, DLQ — and a restore drill has no deadline, so it never has a week. Then Supabase has
a bad day, `restore_db.sh` is run for the first time in anger, and it is discovered that
`pg_restore --clean --if-exists --no-owner` against a Supabase database does not restore
roles, RLS ownership, or extensions the way anyone assumed.

**Earliest observable signal.** It is visible **today**: `sre.days_since_verified_restore`
has no value. Also: the backup filename template still says `wineops_backup_` — the legacy
brand ([[README]] §0 item 3) — meaning nobody has opened these files since the rename.

**Counter-pressure.** The drill is on the schedule with a date, not a priority
([[reliability-sre-schedule]]): quarterly restore into a scratch database, and the drill's
*output* is a row count plus a `check_schema_parity.sh` run against the **restored**
database, so the drill produces evidence rather than a claim. Until the first drill runs,
the charter says "never tested" in those words ([[reliability-sre-charter]]) — the honest
label is itself the counter-pressure.

---

### M3 — Red was normalized, and this department was the one that normalized it

`.github/workflows/ci.yml:8` already documents its own tolerance: *"Do NOT treat TFND-05
as green CI — Black debt on studio_routes.py may keep main red."* That sentence is honest
and correct today. Twelve months of it and red is the normal colour of `main`; the daily
`schema-parity.yml` cron joins it; the first genuinely broken build ships because nobody
reads a signal that has been failing for months. **Red CI that is tolerated is worse than
no CI**, and this department owns both gates.

**Earliest observable signal.** Any gate red for **two consecutive runs** where the
closing artifact is a chat message rather than a commit. Also: the first time someone
writes "known red" in a PR description.

**Counter-pressure.** A red gate is closed by a **file**, not a sentence, within one
close-time — or it is deleted. A gate nobody is willing to fix is a gate nobody believes,
and deleting it is more honest than leaving it red. The weekly `sre-red-signal-audit`
loop ([[reliability-sre-loops]]) exists solely to force that binary choice, and its output
is a count that is published even when it is embarrassing.

---

### M4 — Incident command was folded in, and it ate the team it was folded into

§6.0 rejected a dedicated Incident Response team as org cosplay
(`technology.md:712-714`) and folded incident command into
[[observability-telemetry-plumbing-charter]]. That was the right call at this scale and it
has a predictable cost: the team that answers everything instruments nothing. A year on,
NF-A emission coverage — the department's L4 prerequisite — has not moved, because the
team that owns it spent the year triaging.

**Earliest observable signal.** Three consecutive close-times where triage volume moves
and `nf_a.emission_coverage` does not. That exact pair is on the board for this reason.

**Counter-pressure.** Emission coverage is that team's **primary** metric and triage is
explicitly time-boxed; [[reliability-sre-directive]] routes any incident touching two
teams to the *department*, not to whichever team noticed. If the pair diverges for three
close-times, the department reallocates — and if it diverges for three more, the
Incident-Command entry trigger in [[reliability-sre-charter]] has arguably fired and the
rejection is re-argued rather than endured.

---

### M5 — The department audited its own siblings' work and lost the independence that justified it

Author ≠ auditor is the reason [[state-integrity-invariants-charter]] is split from
[[schema-migrations-charter]] (`technology.md:860`). At a one-founder scale, the author and
the auditor are frequently the *same session on the same afternoon*. The split becomes
notional: the migration is written and the parity gate is fixed in one commit, and the
audit function silently stops being an audit.

**Earliest observable signal.** A single commit that touches both `supabase/migrations/`
and `scripts/check_schema_parity.sh` (or the workflow that runs it). One commit, both
sides of the seam — that is the tell, and it is greppable.

**Counter-pressure.** The gate scripts and the migrations are **never modified in the same
change**; a commit that touches both is itself a finding raised into
`OPEN-DECISIONS.md`. Where a human cannot be independent, the *artifact* can be: the gate's
verdict is written by the job, not by the person, and the streak counter
(`schema.days_since_hand_applied_ddl`) resets publicly.

---

## Cross-cutting counter-pressure

- **Advisory is findings-only** ([[ORG_STRUCTURE]] §3). [[red-team-charter]] should attack
  M1 hardest — the whole department's premise is that its own green is trustworthy.
- **[[decision-office-charter]] owns close-times.** Every mechanism above names one; a
  premortem whose counter-pressures have no close-time is M1 at the org level.
- **The rejections are re-argued at their triggers, not defended.** Incident Command and
  Infra Cost were rejected on scale grounds ([[reliability-sre-charter]]). Defending a
  scale-dependent decision after the scale changed is its own failure mode.
- **Anti-sprawl applies here too.** If nothing in this document has been revisited in 60
  days, it is fiction (foundation §3.3, §6).

---
type: premortem
division: platform
department: reliability-sre
team: release-engineering
status: provisional
metrics: [sre.time_to_revert, sre.days_since_verified_restore, release.env_drift_count]
updated: 2026-08-24
links: ["[[release-engineering-charter]]", "[[release-engineering-loops]]", "[[reliability-sre-premortem]]", "[[state-integrity-invariants-charter]]", "[[platform-api-charter]]", "[[red-team-charter]]"]
---

# Release Engineering — Premortem

> Written at founding, before success is assumed.

## It is 2027-08. This team has failed. What happened?

---

### M1 — Red became the normal colour of `main`

The seed is already committed. `.github/workflows/ci.yml:8` says: *"Do NOT treat TFND-05 as
green CI — Black debt on studio_routes.py may keep main red."* Honest, correct, and
corrosive. Twelve months later the Black debt is still there, `schema-parity.yml` has joined
the red for its own known reason, and every engineer has learned that a red X on `main` is
weather. The first genuinely broken build ships because nobody reads a signal that has been
failing for months. **Red CI that is tolerated is worse than no CI**, and this workflow
already documents its own tolerance (`technology.md:774-777`).

**Earliest observable signal.** A gate red for **two consecutive runs** where the closing
artifact is a chat message rather than a commit. Also, greppable and earlier: the first PR
description containing "known red", "pre-existing failure", or "unrelated to this change".

**What would have prevented it.** A red gate is closed by a **file** within one close-time,
**or the gate is deleted**. The second branch has to be genuinely available or the rule
collapses into tolerance — a gate nobody will fix is a gate nobody believes, and deleting it
is the more honest of the two lies. The department's weekly `sre-red-signal-audit`
(L-SRE-1) exists to force that binary, and the specific first move is to fix or quarantine
the `studio_routes.py` Black debt so that `ci.yml:8` can be **deleted as a line of text** —
the note's removal is the deliverable.

---

### M2 — The first restore was the real one

`scripts/restore_db.sh` is 25 lines, referenced by no workflow, no test, and no schedule.
The team is busy with instrumentable, satisfying work — pipeline speed, deploy audit,
env hygiene — and a restore drill has no deadline, so it never gets a week. Then the
database has a bad day, `pg_restore --clean --if-exists --no-owner` runs for the first time
in anger against a managed Postgres, and it emerges that roles, RLS ownership, or extensions
do not come back the way anyone assumed. The backup was fine. The **restore** was the
untested half, and it always is.

**Earliest observable signal.** Visible **today**, without waiting: `sre.days_since_verified_restore`
has no value at all. A second, quieter tell: the backup filename template still reads
`wineops_backup_${TIMESTAMP}.dump` — the pre-rename brand ([[README]] §0 item 3) — so
nothing has opened these files in a long time.

**What would have prevented it.** The drill is **on the calendar with a date, not on a
backlog with a priority** ([[release-engineering-schedule]]): quarterly, restore into a
scratch database, and the drill's *output is evidence* — a row count for the top tables plus
a `scripts/check_schema_parity.sh` run **against the restored database**, so the drill
produces an artifact rather than a claim. Until the first drill runs, the charter says
"never tested" in exactly those words; the honest label is the interim counter-pressure.

---

### M3 — Time-to-revert stayed a printed procedure

`deploy.yml` has a `rollback-guide` mode and a `rollback_target_sha` input. It **prints
steps**. Printed steps have no measured value (`technology.md:771-772`). The number
`sre.time_to_revert` sits on the board as "unmeasured" for a year, everyone assumes it is
about ten minutes, and the first real revert takes forty — because the guide's step 3
assumed a Railway service name that changed in March.

**Earliest observable signal.** A `deploy-audit` or `rollback-guide` run whose output
nobody consumed — visible as a workflow run with no downstream commit, comment, or
follow-up within the same day.

**What would have prevented it.** One **deliberate, timed, no-op revert per quarter**:
revert to the previous SHA, measure to healthy production, roll forward. It costs a
maintenance window and converts an assumption into a number. The rule is that
`sre.time_to_revert` may only ever be populated by an **exercised** revert — never by an
estimate — which means the metric is either a fact or visibly absent.

---

### M4 — Eighty environment variables drifted, and `DEV_AUTH_BYPASS` reached production

There are 80 env vars across ~6 surfaces ([[EXTERNAL_CONNECTIONS]]:39-80), among them
`DEV_AUTH_BYPASS`, `DEV_AUTH_BYPASS_EMAIL`, `DEV_AUTH_BYPASS_SECRET`. Nobody holds the full
set in their head. A local-dev convenience is copied into a Railway variable group to
unblock a staging test at 1am, and it is still there in November. Combined with
`TenantGuard` returning `true` for unauthenticated requests
(`apps/api-gateway/src/common/tenant/tenant.guard.ts:38-46`), this is not a hygiene issue —
it is a live authentication bypass in production.

**Earliest observable signal.** The **first** env var present on one surface and absent on
another with no owner recorded. More specifically: any production boot log where a
`DEV_AUTH_BYPASS*` key is set. Not the tenth — the first.

**What would have prevented it.** An **env manifest file that CI diffs**, so adding a
variable is a reviewed change to one file rather than a console click nobody sees. Plus one
hard, non-negotiable CI assertion: `DEV_AUTH_BYPASS*` **absent** from production
configuration, failing the deploy rather than warning. The mechanism belongs to
[[platform-api-charter]]; the gate belongs here.

---

### M5 — The pipeline optimized for green rather than for evidence

The team's work is legible: build times drop, flake rates fall, the badge is green, and
`e2e-prod.yml` runs nightly. All genuinely good. But every one of those improvements makes
*shipping* faster while the two numbers that define the mandate — time-to-revert and
days-since-verified-restore — are untouched, because they are the only work that produces no
visible improvement when things are going well. The team optimized the forward path and
never built the backward one, which is the exact opposite of its charter.

**Earliest observable signal.** Three consecutive close-times where CI/deploy metrics
improve and **neither** `sre.time_to_revert` nor `sre.days_since_verified_restore` has
moved from "unmeasured".

**What would have prevented it.** The two recovery numbers are the team's **primary**
metrics on [[release-engineering-agenda-board]], and pipeline speed is explicitly listed
below them as secondary. Recovery-path proving is a department-level loop with a quarterly
close-time (L-SRE-3) precisely so it cannot be deprioritized by the team that finds it
least rewarding.

---

## Cross-cutting

- [[red-team-charter]] should attack **M2's assumption** that the backup is fine. The whole
  gap is framed around the restore; nobody has verified a `pg_dump` output is loadable
  either.
- Author ≠ auditor holds here too: this team runs `schema-parity.yml`, but
  [[state-integrity-invariants-charter]] declares its verdict (`technology.md:860`). If this
  team ever both runs and grades that gate, M1 gets a second engine.

---
type: charter
division: platform
department: reliability-sre
team: release-engineering
status: exists
metrics: [sre.time_to_revert, sre.days_since_verified_restore, release.env_drift_count, ci.gates_red_consecutive_runs]
updated: 2026-08-24
links: ["[[reliability-sre-charter]]", "[[release-engineering-premortem]]", "[[release-engineering-agenda-full]]", "[[release-engineering-agenda-board]]", "[[release-engineering-directive]]", "[[release-engineering-loops]]", "[[release-engineering-schedule]]", "[[state-integrity-invariants-charter]]", "[[schema-migrations-charter]]", "[[observability-telemetry-plumbing-charter]]"]
---

# Release Engineering — Charter

Team **6.2** of [[reliability-sre-charter]] (`.planning/foundation/teams/technology.md:755-777`).

## Mandate

Own the path from commit to production **and back**: the five CI/CD workflows, deploy
audit, rollback, environment and secret hygiene across 80 environment variables, and — per
the department's named gap — a **tested** database restore.

Every other SRE team asks whether the system is healthy. This team asks whether we can
**put it back**. That is the whole distinction, and it is why the untested restore lands
here rather than anywhere else: **restore is the terminal rollback**
(`technology.md:721`).

## Boundaries

Owns outright:

- **The five workflows** — `.github/workflows/ci.yml` (lint/type-check for TS and Python,
  three shell guards, unit + integration + local Playwright), `codeql.yml`, `deploy.yml`,
  `e2e-prod.yml` (nightly cloud E2E, `schedule: 0 2 * * *`), `schema-parity.yml`
  *(this team runs the workflow; [[state-integrity-invariants-charter]] owns its verdict)*.
- **Deploy and revert mechanics** — `deploy.yml:1-27`: gated on CI success,
  `deploy-audit` / `rollback-guide` modes, `rollback_target_sha` input, concurrency group
  with `cancel-in-progress: false`.
- **Runtime/deploy configuration** — `services/agent-orchestrator/railway.toml`,
  `vercel.json`, `apps/web/vercel.json`, `docker-compose.yml` + `.override.yml`.
- **Environment and secret hygiene** — 80 env vars across ~6 surfaces
  ([[EXTERNAL_CONNECTIONS]]:39-80), including `DEV_AUTH_BYPASS`,
  `DEV_AUTH_BYPASS_EMAIL`, `DEV_AUTH_BYPASS_SECRET`.
- **Backup and restore** — `scripts/backup_db.sh`, `scripts/restore_db.sh`, and the drill
  that proves the second one works.

## Explicit non-goals

| Not ours | Whose it is | The line |
|---|---|---|
| Authoring migrations and DDL | [[schema-migrations-charter]] | We ship them; we do not write them |
| Declaring the parity gate red | [[state-integrity-invariants-charter]] | We run the workflow; the auditor owns the verdict. Author ≠ auditor (`technology.md:860`) |
| Whether the code is correct | [[engineering-charter]] | A green pipeline is not a correct product |
| Whether metrics exist to judge a deploy | [[observability-telemetry-plumbing-charter]] | We ask for the signal; we do not build it |
| Behavior under partial failure once deployed | [[runtime-resilience-charter]] | Deploying is discrete; degrading is continuous |
| Classifying which endpoints must be guarded | [[access-control-tenant-isolation-charter]] *(Security)* | We can enforce a rule in CI; we do not decide the rule |
| Platform vendor spend | Nobody — **rejected as a team** (`technology.md:715-717`) | Three vendors on flat plans. Re-argued only at the trigger in [[reliability-sre-charter]] |

## The named gap — stated in full, because it is this team's first task

The department's charter flags it and assigns it here. Verbatim state as of 2026-08-24:

- `scripts/backup_db.sh` — **19 lines**. Requires `DATABASE_URL`, writes
  `${BACKUP_DIR}/wineops_backup_${TIMESTAMP}.dump` via `pg_dump --format=custom`.
- `scripts/restore_db.sh` — **25 lines**. Requires `DATABASE_URL` and a backup file, runs
  `pg_restore --clean --if-exists --no-owner --dbname "${DATABASE_URL}"`.
- **Neither script is referenced by any workflow, test, or scheduled job.** There is **no
  evidence of a tested restore** (`technology.md:719-722`).
- The output filename still carries the legacy brand, `wineops_backup_` — corroborating
  [[README]] §0 item 3 (brand migration incomplete below the doc layer) and indicating
  nothing has touched this path since the rename.
- `--no-owner` and `--clean` against a managed Postgres are exactly where an untested
  restore surprises you: roles, RLS ownership and extensions are not obviously covered.
  **This is a hypothesis, not a finding** — the drill exists to replace the hypothesis with
  a fact.

**First task of this team: prove a restore works.** Not improve it — prove it.

## Metrics it moves

- **`sre.time_to_revert` (primary)** — from *decision* to *healthy production*.
  **Baseline: unmeasured.** `deploy.yml`'s `rollback-guide` mode currently *prints steps*,
  and **an unexercised procedure has no measured value** (`technology.md:771-772`).
- `sre.days_since_verified_restore` — **has never had a value.** The first drill creates
  it; that is the drill's actual deliverable.
- `release.env_drift_count` — env vars present on one surface and absent on another with no
  owner; and a hard assertion that `DEV_AUTH_BYPASS*` is absent from production config.
- `ci.gates_red_consecutive_runs` — feeds the department's weekly red-signal audit
  (L-SRE-1). This team supplies the number; the department forces the fix-or-delete choice.

## Evidence today

**EXISTS** (`technology.md:764-769`). The pipeline is real and reasonably sophisticated for
a solo-founder repo: five workflows, a gated deploy with an explicit `rollback_target_sha`,
a concurrency group that deliberately does not cancel in progress, a nightly cloud E2E.

**And it documents its own weakness.** `.github/workflows/ci.yml:8` states plainly:

> *"Do NOT treat TFND-05 as green CI — Black debt on studio_routes.py may keep main red"*

with `:9` adding *"STATUS: schedule-present / capability-unverified until one wave XML
lands"*. Both lines are honest and were correct when written. They are also the seed of
[[release-engineering-premortem]] M1: a workflow that documents its own tolerance for red
has already begun normalizing it.

## Why this team is distinct from its siblings

It owns **reversibility**. Observability owns whether you can see the problem; resilience
owns whether the system absorbs it; state-integrity owns whether you would ever notice it.
This team owns the only question whose answer is binary and time-boxed: *can we get back to
the last good state, and how long does that take?* Nobody else in the org can answer it,
and today **nobody can answer it at all**, because neither the revert nor the restore has
been timed.

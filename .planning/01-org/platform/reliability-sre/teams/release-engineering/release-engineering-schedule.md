---
type: schedule
division: platform
department: reliability-sre
team: release-engineering
status: provisional
metrics: [sre.days_since_verified_restore, sre.time_to_revert, release.env_drift_count]
updated: 2026-08-24
links: ["[[release-engineering-charter]]", "[[release-engineering-loops]]", "[[reliability-sre-schedule]]", "[[skill-registry-authoring-charter]]"]
---

# Release Engineering — Schedule & Skills

## Recurring work

| Cadence | Job | Emits |
|---|---|---|
| On push / PR to `main`, `develop` | `ci.yml` — **already running**: TS + Python lint and type-check, three shell guards, unit + integration, local Playwright | Gate verdict |
| On push / PR | `codeql.yml` — **already running** | Security scan verdict |
| Nightly 02:00 | `e2e-prod.yml` cloud E2E — **already running** (`schedule: 0 2 * * *`) | Prod smoke verdict |
| Daily 06:00 | `schema-parity.yml` — **already running** (`:26-28`); we run it, [[state-integrity-invariants-charter]] grades it | Parity result |
| Weekly | **Red-gate resolution** (L-REL-3) — red counts, exception log, and whether `ci.yml:8` still exists | `ci.gates_red_consecutive_runs`, `ci.exceptions_past_expiry_count` |
| Monthly | **Env reconciliation** across 80 vars / ~6 surfaces; assert `DEV_AUTH_BYPASS*` absent from production | `release.env_drift_count`, `release.dev_auth_bypass_in_prod` |
| **Quarterly, dated** | **Restore drill** (L-REL-1) — restore into a scratch DB, then `check_schema_parity.sh` **against the restored database** | `sre.days_since_verified_restore` — first value ever |
| **Quarterly, dated** | **Timed no-op revert** (L-REL-2) — exercise `rollback_target_sha`, measure to healthy production | `sre.time_to_revert` |
| Within one week of any first use | **Recovery-path review** (L-REL-5) — restore, revert, or kill switch, including successful uses | `sre.recovery_paths_used_unverified_count` |

**"Dated, not prioritized" is the point of the two quarterly rows.** A drill with a
priority never gets a week; a drill with a date on the calendar either happens or is
visibly cancelled — and a visible cancellation is itself a finding.

**Anti-sprawl ([[README]] §6):** a job producing no action for 3 consecutive runs is
downgraded or deleted. The quarterly drills are exempt from that reading for the same
reason the heartbeat check is: their value is in the periods where they find nothing, and
`sre.days_since_verified_restore` climbing is itself the emitted output.

## Skills owned

Skills live in `.claude/skills/`. A skill unfired for 30 days is reviewed for deletion
([[README]] §3.3).

| Skill | Tier | Trigger — the exact situation | Doneability | Real past instance |
|---|---|---|---|---|
| **`railway-config`** — **EXISTS** (`.claude/skills/railway-config/SKILL.md`) | T3 operational | A Railway service or environment configuration change for `services/agent-orchestrator` | Config applies and the service boots healthy | **Yes** — it is the repo's only project skill, and `railway.toml` is this team's file |
| `release-verify` *(proposed)* | T3 operational | A deploy has completed and before it is called done | Health surfaces green **and** liveness twins non-zero — a green health check on a dead metrics pipeline is not a verified release ([[observability-telemetry-plumbing-charter]]) | **Yes** — `ci.yml:8-9` documents that green CI has already been non-authoritative once |
| `restore-drill` *(proposed)* | T3 operational | Quarterly drill; also any change to `restore_db.sh`, `backup_db.sh`, or the managed-Postgres provider | Restore completes **and** `check_schema_parity.sh` passes against the restored database, with row counts recorded | **No — and that is the argument for it.** The restore has never been run, so no past instance can be cited. [[README]] §3.3 rule 3 is deliberately violated here, once, with the reason stated |
| `env-manifest-diff` *(proposed)* | T3 operational | Any PR or console change touching an environment variable across the ~6 surfaces | Manifest and reality agree; every var has an owner; `DEV_AUTH_BYPASS*` absent from production | **Yes** — 80 vars across ~6 surfaces with no manifest ([[EXTERNAL_CONNECTIONS]]:39-80) |
| `rollback-rehearse` *(proposed)* | T3 operational | Quarterly, and after any change to `deploy.yml` or a service name | A timed revert to the previous SHA and back, with `sre.time_to_revert` written from the measurement | **Yes** — `rollback-guide` prints steps today and has never been exercised (`technology.md:771-772`) |

**One skill here knowingly breaks the rules.** `restore-drill` cannot cite a real past
instance because the procedure has never run — which is exactly the gap
[[reliability-sre-charter]] refuses to lose. It is chartered as the single documented
exception to [[README]] §3.3 rule 3, and the exception expires the day the first drill
produces evidence.

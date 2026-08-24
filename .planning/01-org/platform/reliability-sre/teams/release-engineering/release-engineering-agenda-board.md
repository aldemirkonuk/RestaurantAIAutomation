---
type: agenda-board
division: platform
department: reliability-sre
team: release-engineering
status: provisional
metrics: [sre.days_since_verified_restore, sre.time_to_revert, release.env_drift_count, ci.gates_red_consecutive_runs]
updated: 2026-08-24
links: ["[[release-engineering-charter]]", "[[release-engineering-agenda-full]]", "[[release-engineering-loops]]", "[[reliability-sre-agenda-board]]"]
---

# Release Engineering — Board

> **PROVISIONAL — no work done yet.**

## This team's artifacts

```dataview
TABLE type AS Artifact, status AS Status, updated AS Updated
FROM "01-org/platform/reliability-sre"
WHERE team = this.team
SORT type ASC
```

## Sibling teams

```dataview
TABLE team AS Team, status AS Grade, updated AS Updated
FROM "01-org/platform/reliability-sre"
WHERE type = "charter" AND team != null AND team != this.team
SORT team ASC
```

## Stale check

```dataview
TABLE updated AS Updated, type AS Artifact
FROM "01-org/platform/reliability-sre"
WHERE team = this.team AND date(updated) < date(today) - dur(60 days)
SORT updated ASC
```

## Primary — the two recovery numbers

- `sre.days_since_verified_restore` — **no value has ever existed.** First drill creates it
- `sre.time_to_revert` — **unmeasured.** May only be populated by an *exercised* revert, never an estimate

## Secondary — explicitly below the two above

- `release.env_drift_count` — 80 vars, ~6 surfaces, no manifest today
- `ci.gates_red_consecutive_runs` — feeds the department's weekly red-signal audit
- Build time, flake rate — improve only after the recovery numbers exist

## Open

- [ ] **First restore drill** — scratch DB + `check_schema_parity.sh` against the *restored* database
- [ ] **One timed no-op revert** via `deploy.yml` `rollback_target_sha`
- [ ] Fix/quarantine `studio_routes.py` Black debt → **delete `ci.yml:8`**
- [ ] Env manifest file + CI diff
- [ ] Hard CI assertion: `DEV_AUTH_BYPASS*` absent from production config
- [ ] Rename `wineops_backup_` in `backup_db.sh` (legacy brand, [[README]] §0 item 3)

## Watch

- `.github/workflows/ci.yml:8` — *"Do NOT treat TFND-05 as green CI"* — the M1 seed, in the repo
- `ci.yml:9` — *"schedule-present / capability-unverified"*
- `DEV_AUTH_BYPASS*` + `tenant.guard.ts:38-46` — compound authentication risk
- Any PR description saying "known red" / "pre-existing failure" — earliest M1 tell
- A `rollback-guide` run with no downstream action the same day — earliest M3 tell
- Pipeline metrics improving three close-times running while both recovery numbers stay "unmeasured" = M5

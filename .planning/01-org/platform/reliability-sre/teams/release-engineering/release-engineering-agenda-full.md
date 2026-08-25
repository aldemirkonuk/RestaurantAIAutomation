---
type: agenda-full
division: platform
department: reliability-sre
team: release-engineering
status: provisional
metrics: [sre.days_since_verified_restore, sre.time_to_revert, release.env_drift_count]
updated: 2026-08-24
links: ["[[release-engineering-charter]]", "[[release-engineering-premortem]]", "[[release-engineering-loops]]", "[[release-engineering-agenda-board]]", "[[reliability-sre-agenda-full]]", "[[platform-api-charter]]"]
---

# Release Engineering — Full Agenda

> **PROVISIONAL — no work done yet.** This is forecast, not fact.

## What

Two numbers that have never existed, and one line of text to delete.

1. **`sre.days_since_verified_restore`** — the named gap. Give it a first value.
2. **`sre.time_to_revert`** — currently a printed procedure. Make it a measurement.
3. **`.github/workflows/ci.yml:8`** — the self-documented red tolerance. The deliverable is
   the **removal of that line**, which requires fixing the Black debt on
   `studio_routes.py` that makes it true.

Everything else this team could improve — build times, flake rate, deploy ergonomics — is
secondary by explicit charter, because improving the forward path while the backward path is
unproven is [[release-engineering-premortem]] M5.

## How

**The restore drill, concretely.** Take a `backup_db.sh` output, restore it into a scratch
database with `restore_db.sh`, then run **`scripts/check_schema_parity.sh` against the
restored database**. The drill's deliverable is that parity output plus row counts for the
top tables — evidence, not a claim that it worked. Expect the first drill to *fail*:
`pg_restore --clean --if-exists --no-owner` against a managed Postgres has unexamined
behaviour around roles, RLS ownership and extensions. **A failed first drill is a success
for this agenda** — it converts a hypothesis into a defect with a location.

**The timed revert.** One deliberate no-op revert per quarter through
`deploy.yml`'s `rollback_target_sha` path: revert to the previous SHA, time to healthy
production, roll forward. `sre.time_to_revert` may **only** be populated by an exercised
revert. An estimate is not permitted to occupy that field — an empty field is information;
a guessed field is not.

**The red-tolerance note.** Fix or quarantine the `studio_routes.py` Black debt so `ci.yml:8`
becomes false, then delete it. If it cannot be fixed within one close-time, the department's
fix-or-delete rule applies to the *gate*, and that escalates rather than quietly persisting.

**Env manifest.** One file listing all 80 variables per surface with an owner; CI diffs it.
One hard assertion: `DEV_AUTH_BYPASS*` absent from production config, failing the deploy.
The bypass mechanism itself belongs to [[platform-api-charter]]; the gate is ours.

## Why now

- **The restore gap is the only item in this department that can lose the company data.**
  Everything else degrades quality; this one is categorical.
- **`ci.yml:8` decays with age.** The note is honest today and becomes an excuse by month
  six. Deleting it costs one afternoon now and one incident later.
- **`DEV_AUTH_BYPASS*` plus `tenant.guard.ts:38-46` is a live compound risk.** Each half is
  defensible; together they are an authentication bypass waiting for a 1am shortcut.
- **The pipeline is already good enough to lull.** Five workflows, a gated deploy, nightly
  cloud E2E — the forward path is in better shape than the backward path, which is exactly
  the asymmetry that makes M5 likely rather than hypothetical.

## Next steps

| # | Step | Output | When |
|---|---|---|---|
| 1 | First restore drill into a scratch DB + parity run against the restored database | `sre.days_since_verified_restore` gets its **first value ever** | This quarter — dated, not prioritized |
| 2 | One timed no-op revert | `sre.time_to_revert` becomes a fact | Same quarter |
| 3 | Fix/quarantine `studio_routes.py` Black debt; **delete `ci.yml:8`** | A green `main` that means something | One close-time |
| 4 | Env manifest file + CI diff | `release.env_drift_count` becomes computable | Monthly loop |
| 5 | Hard CI assertion: `DEV_AUTH_BYPASS*` absent in production | Deploy fails rather than warns | With step 4 |
| 6 | Rename `wineops_backup_` in `backup_db.sh` | Small, but it is the tell that someone is maintaining this path | With step 1 |
| 7 | Only then: pipeline speed and flake reduction | Secondary by charter | Ongoing |

## Questions for the founder

1. **What is the restore target?** A scratch Supabase project costs money; a
   `docker-compose` Postgres is not the production engine and would make the drill
   theatre. Which is acceptable — and if it is the cheap one, is the drill's verdict
   labelled "partial" on the board?
2. **May this team delete a CI gate?** The fix-or-delete rule needs the second branch to be
   genuinely available. If deleting is never acceptable, the rule is decoration and M1 is
   unaddressed.
3. **Revert maintenance window.** A timed no-op revert touches production. What window is
   acceptable, and who is told?
4. **`DEV_AUTH_BYPASS` in non-production environments** — is a hard CI failure the right
   severity for staging too, or production only?
5. **Is the backup itself verified?** [[release-engineering-premortem]] cross-cutting note:
   the gap is framed around restore, but nobody has confirmed a `pg_dump --format=custom`
   output is loadable at all. Should the drill start there?

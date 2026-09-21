# 0212 — A new migration sorts after every version its base already holds

- **Status:** Locked 2026-09-21. The founder picked *"Migration order check"*, yes, into
  `ci.yml` (round 6b, 2026-09-21; he gave his word for exactly two `ci.yml` additions, this
  one and the motion token check). The pick is recorded in the finish session's memory note
  `founder-answers-2026-09-21-round5.md`, round 6b, as: *"ci.yml: YES to BOTH the migration
  order check (a PR's new migrations must sort after main's newest) and the motion token
  check"*. This lane did not hear it directly. It came through the orchestrating session.
- **Date:** 2026-09-21
- **Decider:** Aldemir (founder)
- **Keywords:** migration order, migration version, ceiling, out of order, supabase db push,
  include-all, schema_migrations, merge base, strict branch protection, check_migration_order
- **Links:** [[0031-migration-ledger-reconciliation]] (the ledger check that measured #391),
  [[0092-parity-compares-against-what-was-merged]], [[0085-a-fixture-tests-the-guard-not-the-checkout]];
  `scripts/check_migration_order.py`; `scripts/check_migration_versions_unique.py`;
  `.github/workflows/ci.yml` job `migration-versions-unique`

## Context

`scripts/check_migration_versions_unique.py` proves that no two files in
`supabase/migrations/` share a version. It does not check whether a new file is the
newest one. If a file is dated behind a version the base already holds, the version is
still unique, so every check passes and the PR merges green. Three things can then happen:

1. **Production and fresh databases apply migrations in different orders.** Production
   has already applied the newer version, so it runs the late file after migrations that
   `supabase db reset` runs first. `supabase db reset` orders by filename and builds CI's
   comparison database, every local database and every preview database. If two such
   migrations touch the same object, the databases end up in different states, and CI
   trusts the one that serves no traffic. Such a pair is already on main, apparently
   harmless. #391's `20260917010400_a_security_definer_rpc_answers_only_to_the_server.sql`
   and main's `20260919120000_trust_counter_is_server_only.sql` both set the grants on
   `increment_trust_counter(uuid)`: revoke from PUBLIC, anon and authenticated, grant to
   service_role (`…010400`:67-68 and `…120000`:14-15; on a function, `REVOKE ALL` is
   `REVOKE EXECUTE`). They reach the same end state in either order, so whichever order
   production ran them in (the ledger check reports presence, not order), this pair converged. That was luck:
   the statements happen to be idempotent, and nothing checked the order.
2. **The hand path refuses the file.** The installed Supabase CLI's `db push` stops with
   *"Found local migration files to be inserted before the last migration on remote
   database."* unless it gets `--include-all`. The text was read from `supabase db push
   --help` and the CLI binary. The command was not run against a database.
3. **What the merge-time runner does is not pinned by this repo.** One measurement:
   #391 (`11c501d26`, merged 2026-09-21 16:16:52Z) added four files dated
   `20260913190100`..`20260917010400`. Main already held `20260919120000` from #396. About
   4.5 minutes later, the push run's ledger check found a production row for every file
   (`Migration ledger matches production`, schema-parity run 35624595661: "FILES - LEDGER
   (0)"). So that time the files were registered. **The brief's premise, and the memory
   note behind it, said such a file "never runs" or is "lost silently". That was not
   observed.** The measured hazards are divergent order and a runner-dependent outcome.

Measured 2026-09-21 against `origin/main` `9cfc4e96d`, whose newest version is
`20260919120000`. Each PR head was merged the way GitHub builds `refs/pull/N/merge`
(`git merge-tree` + `commit-tree` in a throwaway `--shared` clone), and the CI step was
run on the result:

| PR | adds | today | after #429 (`…113000`) merges |
|---|---|---|---|
| #414 | `20260913190500`..`20260919050000` | **fails, 4 files** | fails, 4 |
| #415 | `20260920100000`, `…100100` | passes | **fails, 2** |
| #422 | `20260921090000`..`…100000` | passes | **fails, 3** |
| #430 | `20260921111000`..`…115310` | passes | **fails, 3** |
| #434 | `20260921112000`..`…115100` | passes | **fails, 3** |
| #429 | `20260921110000`, `…113000` | passes | n/a |

The same day, one lane renamed its migration to one step past the ceiling. That was
checked by hand against every branch it could see, and it still lost the race twice.

## Options considered

1. **A CI guard at PR time, checked against the base tip, with a push-time backstop.**
   Every file a PR adds must sort strictly after the newest version on
   `origin/<base_ref>`. It is cheap (stdlib, about 1 s, no secret, no network) and it
   fails before the merge, while a rename is still just a rename. Cost: a PR carrying a
   migration has to rename it whenever a sibling with a newer version merges first.
2. **Keep the convention (hand sweep, reserved bands).** This is what failed twice on
   2026-09-21. A sweep is a snapshot, and the ceiling moves while you work.
3. **A bot that renames the file at merge.** It rewrites a reviewed diff after review,
   and a rename also moves every citation of the old name, which the bot cannot judge.
4. **A version-reservation register.** It is still a convention, so it still needs this
   guard. Also, a register row re-anchors citations (ADR 0025's lesson).
5. **Compare against production's ledger instead of main.** Production is the true
   ceiling, but that needs the database secret in a hermetic job. Main's tip is exactly
   what production reaches on merge. Out-of-band rows ahead of main are a different
   defect, which ADR 0031's ledger check already reports.
6. **Fold this into the uniqueness script.** That script needs `gh` and every open PR,
   while ordering needs only git, so each can fail for different reasons. One question
   per guard keeps each mutation table readable. The two share a job instead.
7. **Advisory only.** The founder's pick was "into ci.yml", and the job is in
   `CI Complete`'s `needs`, so it blocks.

## Decision

Option 1: `scripts/check_migration_order.py`, one new step in the
`migration-versions-unique` job, after the uniqueness step and in the same condition
style.

- **pull_request:** base = `origin/<base_ref>`, from the job's existing
  `fetch-depth: 0` checkout and its `+refs/heads/*:refs/remotes/origin/*` fetch. *Added*
  means `git diff --no-renames --diff-filter=A <merge-base> HEAD` (base...HEAD). A local
  run (no `--event`) also adds the index's additions (`--cached`), so a staged file counts
  too. HEAD's tree is always read. The first build read only the index, in CI as well; at
  last call, an emptied index (`git read-tree --empty`, as in a `--no-checkout` clone)
  made it pass a committed out-of-order file with exit 0. `actions/checkout` fills the
  index, so CI was not exposed, but that was a pass on absence. Fixed, with two self-test
  cases. The **ceiling** is the newest version on the base **tip**, not on the merge
  base: if main has moved on, its new tip is what production will already be past.
- **push:** the pushed range `github.event.before..HEAD` is checked against the tree at
  `before`. This makes a file that slipped past review loud on main.
- **workflow_dispatch** (the re-run `pr_audit_gate.py` triggers after a merge it performs
  itself, because a `GITHUB_TOKEN` push starts no run): HEAD is checked against its first
  parent.
- **What counts:** a rename is a delete plus an add, so the new name is checked. A
  *modified* file that already exists is not this guard's business, because the ledger
  and schema-parity checks own edits to applied SQL. A file whose exact name is already
  on the base tip is not new to it (a stacked child whose parent merged). `seed/` and
  subdirectories are not migrations. A top-level `.sql` without a 14-digit version fails
  as UNORDERABLE. The comparison is **strictly** greater.
- **Exit 1** names each file, the ceiling and the file that holds it, and the fix:
  *rename to a version after `<ceiling>`: `date -u +%Y%m%d%H%M%S`, and update every
  citation*.
- **Exit 2** (CANNOT CHECK) covers: the base does not resolve, there is no merge base
  (including a shallow clone without one), `before` is empty or all zeros, the event is
  unknown, or the base holds zero migrations. It never passes on absence.

**Why the PR-time check is enough.** Main's protection is `strict: true` (read
2026-09-21 from `gh api .../branches/main/protection/required_status_checks`). A PR merges
only when its head is up to date with main, and bringing it up to date re-runs this step
against the new tip. So no migration can land between this check passing and the merge
without making the PR stale and forcing a new run. The push arm backstops whatever reaches
main without that run, such as an admin merge or relaxed protection. It fires after the
fact.

## Consequences

- Easier: an out-of-order migration now fails its PR, and the failure names the fix.
  Nobody has to remember the sweep.
- Harder: when a PR carrying a migration is behind main, updating it may also mean
  renaming its migrations. After #429, that is 15 files across #414, #415, #422, #430
  and #434. The rename moves citations, and the uniqueness step re-checks the new name
  against every open PR.
- **Still not caught:**
  - History already on main. #391's four files are behind `20260919120000`, and the push
    arm only sees new pushes.
  - A production ledger ahead of main (a hand-applied row). ADR 0031's ledger check owns
    that.
  - A PR that renames an already-applied migration to a *newer* version. This guard
    passes it. ADR 0031's check should report the orphaned old row as LEDGER - FILES;
    that path was not exercised in this lane.
- **The Explain-a-failure notices** in that job still describe collisions only.
  Changing them was outside the founder's word, so this guard prints its own diagnosis.
- **CLAUDE.md §5b still covers only uniqueness** ("Never reuse a migration version
  either"). CLAUDE.md is gate-owned and outside the founder's word for this lane, so it
  was left unchanged. When he opens it, the proposed line is: *"…and never add one behind
  main's newest: `scripts/check_migration_order.py` fails a PR whose new migration does
  not sort after `origin/main`'s ceiling."*
- **Revisit if** main's protection stops being `strict`. The PR-time check is then no
  longer sufficient, and a merge queue or the push arm has to become the primary check.
  Also revisit if the merge-time runner's out-of-order behaviour is ever pinned and shown
  to be harmless for this repo.
- Proof: `--self-test` runs 24 fixture cases and 3 rule checks in a throwaway repo, with
  no global git config. In the build, 26 mutations were each killed by the self-test (then
  22 cases). They include `>`→`>=`, `>`→`<`, dropping `--no-renames`, `--diff-filter=A`,
  `-z` and `--cached`, taking the ceiling from the merge base instead of the tip, and
  reading `base_ref` as a local branch. After the last-call fix, a fresh set of 15 was
  killed by the 24-case self-test. It included the pre-fix index-only shape, dropping
  HEAD's half, dropping the index half, an empty base passing, and CANNOT CHECK
  returning 0. CLAIMS row `ADR-0212-a` re-runs the self-test and checks the step's
  wiring. The row itself was mutation-tested on scratch copies, and 7 of 7 mutations
  failed it: the step removed, the step gated `if: false`, `before` not passed, the
  self-test dropped from the step, the job dropped from `CI Complete`'s `needs`, the
  comparison turned into `>=`, and the guard deleted.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-21 | founder | "Migration order check", yes, into ci.yml (round 6b) |
| 2026-09-21 | migorder lane | Built. The premise was corrected by measurement (#391's files were registered, not lost) |
| 2026-09-21 | last call (Opus) | One fix. The PR arm now reads HEAD's tree (base...HEAD); before, an empty index passed a committed out-of-order file. Two cases added; 15 of 15 fresh mutations killed |

# 0212 — A new migration sorts after every version its base already holds

- **Status:** Locked 2026-09-21, amended 2026-09-22. The founder picked *"Migration order
  check"*, yes, into `ci.yml` (round 6b, 2026-09-21; he gave his word for exactly two
  `ci.yml` additions, this one and the motion token check). The pick is recorded in the
  finish session's memory note `founder-answers-2026-09-21-round5.md`, round 6b, as: *"ci.yml:
  YES to BOTH the migration order check (a PR's new migrations must sort after main's newest)
  and the motion token check"*. This lane did not hear it directly. It came through the
  orchestrating session. On 2026-09-22, given the fork below (§ Amendment 2026-09-22, "an
  exceptions list for the false positive"), the founder picked, verbatim: *"Exceptions list,
  your word (Recommended)"*. Also relayed through the orchestrating session, to the `fix439`
  audit-fix lane, not heard directly by either build lane.
- **Date:** 2026-09-21 (order check); 2026-09-22 (exceptions list)
- **Decider:** Aldemir (founder)
- **Keywords:** migration order, migration version, ceiling, out of order, supabase db push,
  include-all, schema_migrations, merge base, strict branch protection, check_migration_order,
  migration-order-exceptions
- **Links:** [[0031-migration-ledger-reconciliation]] (the ledger check that measured #391),
  [[0092-parity-compares-against-what-was-merged]], [[0085-a-fixture-tests-the-guard-not-the-checkout]];
  `scripts/check_migration_order.py`; `scripts/check_migration_versions_unique.py`;
  `.github/workflows/ci.yml` job `migration-versions-unique`; `supabase/migration-order-exceptions.txt`

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
| #434 | `20260922230000`..`…115100` | passes | **fails, 3** |
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

## Amendment 2026-09-22 — an exceptions list for the false positive

PR #439's own audit (ADR 0090) found that the guard, as decided above, has no override
for a shape that is not a new migration at all: a rename or restore whose version
production has *already* run.

- `7ea563e234eb`, "fix migration version skew and record the schema drift" (2026-07-27):
  renamed `20260208024921_new-migration` to `..._baseline_schema`, plus 3 more renames,
  each moving a file's name to the version production had actually recorded. A guard like
  this one, run against that PR, would have blocked every one of those renames: the
  renamed-to version is a delete-plus-add under `--no-renames`, and it is BEHIND or EQUAL
  TO whatever the base tip already held under other names.
- `426984b34bc7`, #63 (2026-08-25): `20260825150000_...` renamed back to
  `20260824071839_...`, again moving toward production's number.
- A revert PR that restores a deleted, already-applied migration fails the same way: the
  restored file is an add of a version the base may already be past.

None of these is a new migration in the sense the founder approved ("a PR's new
migrations must sort after main's newest"). Production has already run the file, under
some name; blocking the rename does not stop a bad order, it just makes a ledger
correction impossible to land, or a revert of a deleted migration impossible to restore.

**Fork put to the founder (2026-09-22):** should the guard have an override for this
shape?

- (a) No override. Such a PR has to edit the guard itself in the same diff, which is
  possible because `check_migration_order.py` is not gate-owned, but it ships unaudited.
- (b) A narrow, git-only exemption: exempt an added file whose version is on the base tip
  under a name this same change deletes. Covers the suffix-rename shape exactly, cheap,
  no new file — but does not cover a rename to the ledger's *older* recorded version
  (the `7ea563e23` shape), or a restore of a version the base tip never held under any
  name still present in the same diff.
- (c) A logged allowlist file, one line per version with a reason, gate-owned so a PR
  cannot exempt its own migration from the check it is failing without a human audit
  pass. Covers every shape, including the two above, at the cost of a manual step per
  exception.

**Decision:** (c), the founder's word verbatim: *"Exceptions list, your word
(Recommended)"*. `supabase/migration-order-exceptions.txt`, one
`<14-digit version> <reason>` line per exception, comments start with `#`. A version
listed there passes the order check regardless of the ceiling; an unlisted one fails
exactly as before. The file is read from HEAD's checkout, so the exception ships in the
same commit as the migration or rename it covers. It is gate-owned
(`scripts/pr_audit_gate.py::_GATE_OWNED_PATHS`, and
`.claude/skills/pr-audit-gate/SKILL.md` step 4's mirrored list) for the same reason every
other entry in that tuple is: without it, a PR could add a line exempting its own
out-of-order migration in the same diff that adds it, and no escalation would force a
human to look. A line that is not `<version> <reason>` is CANNOT CHECK (exit 2), never a
silent pass — an unreadable allowlist must not read as an empty, permissive one. No
entries are open as of this amendment; both historical SHAs above are already on main, so
neither needs a retroactive line.

## Consequences

- Easier: an out-of-order migration now fails its PR, and the failure names the fix.
  Nobody has to remember the sweep. A ledger-reconciliation rename or a revert that
  restores a deleted migration now has a path past the guard: a founder-approved line in
  `supabase/migration-order-exceptions.txt`, one per renamed-to or restored version.
  Measured against the tree before each historical case: `7ea563e23` sat under a ceiling
  of `20260727170000`, and all four of its renamed-to versions (`20260208024921`,
  `20260727144415`, `20260727150608`, `20260727151432`) are behind it, so it would have
  needed four lines. `426984b34` (#63) sat under `20260825160000`; its rename to
  `20260824071839` would have needed one, and its new `20260825180000_nf_verdict.sql`
  none. Without the list, both would fail this guard with no way through but editing it.
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
  - A far-future version (for example `20991231235959`) passes once, becomes the new
    ceiling, and every legitimate migration after it has to clear that same false floor.
    The guard enforces the approved rule exactly as decided; a clock bound on what counts
    as a valid version is a new rule, and so is the founder's call if this is ever hit in
    practice. Not built here.
  - Two merges landing before the `workflow_dispatch` re-run for the first one fires
    (`pr_audit_gate.py`'s post-merge dispatch, which only ever compares HEAD to its
    immediate parent). The first merge's out-of-order file is then never named by any
    arm. That needs two faults at once: the first PR's own run skipped (protection
    relaxed, or an admin override) AND that PR merged with `GITHUB_TOKEN`, since a
    `GITHUB_TOKEN` merge cannot itself skip the required pull_request check. A
    double-fault risk, not a live gap; see the corrected wording below.
  - A PR that edits `scripts/check_migration_order.py` itself, for example repointing
    `EXCEPTIONS_PATH` at a file it adds or hard-coding a skip. The self-test still passes
    on such a change, and only the exceptions file is gate-owned, not the script, so the
    PR gets the ordinary ADR 0090 audit and no forced human pass. Whether the guard script
    joins `_GATE_OWNED_PATHS` is the founder's call; it was not put to him in this lane.
- **The Explain-a-failure notices** in that job print COLLISION and `GH_TOKEN` guidance,
  which does not fit an ORDER failure or an order exit 2. A second, order-specific notice
  now runs only when the order step itself failed (`id: order-check`, `if: failure() &&
  steps.order-check.outcome == 'failure'`), so a collision and an order failure each get
  their own guidance instead of one misleading the other.
- **The "backstop" wording** (`ci.yml`, the step's leading comment) now says explicitly
  that the push arm fires only for a push made with a person's credentials (a web or CLI
  merge, a direct push); a `GITHUB_TOKEN` merge starts no push run at all, and only `workflow_dispatch` sees it —
  with the two-merges gap named above.
- **CLAUDE.md §5b still covers only uniqueness** ("Never reuse a migration version
  either"). CLAUDE.md is gate-owned and outside the founder's word for this lane, so it
  was left unchanged. When he opens it, the proposed line is: *"…and never add one behind
  main's newest: `scripts/check_migration_order.py` fails a PR whose new migration does
  not sort after `origin/main`'s ceiling — unless the version is listed, with a reason, in
  `supabase/migration-order-exceptions.txt`."*
- **Revisit if** main's protection stops being `strict`. The PR-time check is then no
  longer sufficient, and a merge queue or the push arm has to become the primary check.
  Also revisit if the merge-time runner's out-of-order behaviour is ever pinned and shown
  to be harmless for this repo. Also revisit if the two-merges `workflow_dispatch` gap
  above is ever observed for real, not just reproduced by hand in the audit.
- Proof: `--self-test` runs 33 fixture cases and 3 rule checks in a throwaway repo, with
  no global git config. In the build, 26 mutations were each killed by the self-test (then
  22 cases). They include `>`→`>=`, `>`→`<`, dropping `--no-renames`, `--diff-filter=A`,
  `-z` and `--cached`, taking the ceiling from the merge base instead of the tip, and
  reading `base_ref` as a local branch. After the last-call fix, a fresh set of 15 was
  killed by the 24-case self-test. It included the pre-fix index-only shape, dropping
  HEAD's half, dropping the index half, an empty base passing, and CANNOT CHECK
  returning 0. After PR #439's own audit (`fix439`, 2026-09-22), a fifth set of 7 fresh
  mutations was killed by the now-31-case self-test: `workflow_dispatch` swapped for
  `run_base("origin/main")`, `push` swapped for the same, `load_exceptions()` returning
  nothing, its malformed-line `CannotCheck` dropped in favour of a silent skip, its
  membership test inverted, its no-file check dropped (a listed version with no migration
  file behind it would otherwise sit as a standing pre-approval for whatever file later
  takes that version), and its reason made optional (`EXCEPTION_LINE_RE`'s second group
  loosened to match zero characters). The first two survived every case that existed
  before this amendment, because `origin/main` never moved past `before`/`HEAD^1` in any
  of them; the two new post-merge-topology cases (`origin/main` IS `HEAD`) are what kill
  them. The other five are killed by the five exceptions cases (`exception_listed`,
  `exception_unlisted`, `exception_malformed`, `exception_without_reason`,
  `exception_names_no_file`). At last call (2026-09-22) those cases were found to leave a
  committed exceptions line naming no file in the working tree, and the next three
  CANNOT CHECK cases ran on it: a run that got past its own arm there still exited 2, on
  that line. So 2 more mutants survived the 31-case self-test, both killed by the pre-amendment
  24-case one: an unknown event, and a base ref that does not resolve, each silently
  falling back to a pull_request run against `origin/main`. Those cases now run from the
  clean `stacked` tree and each must name its own reason. A third last-call mutant, the
  push and workflow_dispatch arms ignoring the exceptions list (so an approved exception
  would pass its PR and then turn main red), also survived the 31-case self-test: no case
  ran those arms on a listed version. `exception_listed` now runs both, raising the floor to
  33. All 3 are killed, and the 7 above still are. CLAIMS row
  `ADR-0212-a` re-runs the self-test and checks the step's wiring: the step has no key
  beyond name/id/env/run (so no `continue-on-error`, `if` or `shell`), its `run` lines,
  stripped, equal the two expected commands exactly, and its env passes exactly the event
  name, base ref and push `before`; the job has no `continue-on-error`, `if` or `defaults`,
  and the workflow no `defaults`; the push, pull_request and workflow_dispatch triggers are
  still there with no path filter. The row reads that step and its job's gating, not every
  other step: a separate earlier step that overwrote the script through a glob
  (`cp "$(command -v true)" scripts/check_migration_order.p?`) passes it, measured at last
  call. `ci.yml` is gate-owned, so such an edit is forced to a human; the row is the second
  line, not the only one. The row itself was mutation-tested on scratch
  copies of `ci.yml`, and 11 of 11 mutations failed it (20 of 20 in a wider, independently
  written re-check at verify time, which added shell overrides, job/workflow `defaults`,
  an `EVENT_NAME` hardcoded next to a relabelled env key, a `pull_request`-only job `if`,
  and the push/workflow_dispatch triggers narrowed or removed — all additional kills, not
  part of the cited 11): the step removed, gated `if: false`, `continue-on-error: true`
  added to the step, `continue-on-error: true` added to the job, `|| true` appended to the
  guard line, the event/base-ref hardcoded (dropping `--before`), `--before` dropped
  outright, the self-test line dropped from the step, the job dropped from `CI Complete`'s
  `needs`, the comparison turned into `>=` in the guard, and the guard deleted.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-21 | founder | "Migration order check", yes, into ci.yml (round 6b) |
| 2026-09-21 | migorder lane | Built. The premise was corrected by measurement (#391's files were registered, not lost) |
| 2026-09-21 | last call (Opus) | One fix. The PR arm now reads HEAD's tree (base...HEAD); before, an empty index passed a committed out-of-order file. Two cases added; 15 of 15 fresh mutations killed |
| 2026-09-22 | PR #439 audit (Opus, ADR 0090) | BLOCK. The CLAIMS row's verify passed under `continue-on-error`, `\|\| true` and a hardcoded event/base-ref; the self-test never proved the push/workflow_dispatch arms fire in the real post-merge topology (`origin/main` == `HEAD`); no override existed for a ledger-reconciliation rename or a restore, which had already happened twice on main; the PR body's "4/4" named no set |
| 2026-09-22 | founder | Fork: no override / a narrow git-only exemption / a logged allowlist. Picked, verbatim: "Exceptions list, your word (Recommended)" |
| 2026-09-22 | fix439 lane | All four BLOCKs fixed. CLAIMS verify now requires exact `run`-line equality and no `continue-on-error`, mutation-tested 11/11 (20/20 on independent re-check). Two post-merge-topology self-test cases added, killing the two mutants that survived before; case floor 24→29. `supabase/migration-order-exceptions.txt` added, gate-owned, with 5 self-test cases and 7/7 fresh mutations killed (including two found during this lane's own verify pass: a listed version naming no migration file, and a bare version with no reason); case floor 29→31. "4/4" dropped from the PR body. Explain-a-failure now has an order-specific notice; the backstop wording and the far-future gap are named in Consequences |
| 2026-09-22 | last call (Opus) | Two fixes to the self-test, both found by mutants that survived it. (1) The exceptions cases left a committed exceptions line naming no file in the working tree, so the next CANNOT CHECK cases exited 2 on it whatever their own arm did: an unknown event or an unresolvable base falling back to `origin/main` survived (both killed by the 24-case self-test before the amendment). They now run from the clean `stacked` tree and name their own reason. (2) No case ran the push or workflow_dispatch arm on a listed version, so those arms ignoring the list survived; `exception_listed` now runs both. 3 of 3 killed, the 7 still killed, floor 31→33. CLAIMS row 20 of 20 re-run at the final state, plus 3 of 3 more (step `timeout-minutes`, step `working-directory`, a pull_request `paths-ignore`); one named limit survives (a separate step stubbing the script by glob). The guard script not being gate-owned is named under Still not caught |

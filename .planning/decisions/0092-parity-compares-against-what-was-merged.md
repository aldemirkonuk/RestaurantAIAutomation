# 0092 — Schema parity compares production against what was MERGED, not against what a PR proposes

- **Status:** Proposed
- **Date:** 2026-09-02
- **Decider:** Aldemir (founder) — chose "unblock now, fix properly next" when the fork was put to them mid-session
- **Keywords:** schema parity, branch protection, required status checks, migrations, CI, absence-reported-as-health, ADR 0072, ADR 0085
- **Links:** [[0072-schema-parity-sees-what-it-claims]] (the check this repairs), [[0085-a-fixture-tests-the-guard-not-the-checkout]] (the same "a green here means nothing" family), [[0074-a-read-names-columns-that-exist]] (the sibling required check with the identical fault)

## Context

`Fresh database equals remote` builds a database from `supabase/migrations/` and
diffs it against production. ADR 0072 rewrote it so it could actually see drift,
and it was then made a **required status check** on `main` alongside three
siblings, with `strict: true`.

That combination created a deadlock nobody designed and nobody noticed:

**Migrations auto-apply on MERGE.** So a pull request that adds one is comparing
a local database that *has* the new objects against a production that correctly
does not. The new table lands under `IN LOCAL, NOT IN REMOTE — unpushed
migration`, the job exits 1, and because the job is a required context the PR
cannot merge. Ever. There is no state the author can reach that turns it green.

### Measured, 2026-09-02

| fact | value |
|---|---|
| required contexts on `main` | **5** (`strict: true`) |
| of those, living in `schema-parity.yml` | **4** |
| open PRs adding a migration, hence unmergeable | **3** — #243, #244, #256 |
| PRs merged earlier the same day with this check red | at least **1** — #242 |

The second required check, `Code queries only relations production has`, fails
the same way from the same cause: #243 calls `record_stock_count`, its own
migration creates it, production does not have it yet, and the guard reports
*"1 function(s) the code calls do not exist in PRODUCTION"* — true, and not a
defect, because the code is not in production either.

### The escape routes, and why they are worse

**Hand-apply the migration to production first, then the check goes green.**
This is the one an author reaches for, and it manufactures the exact fault that
cost two sessions an hour earlier the same day: the Supabase git integration
stamps `schema_migrations.version` from the repo filename, a manual apply stamps
its own wall clock, and afterwards the two disagree and the migration looks
ownerless. See [[schema-parity-drift-diagnosis]].

**Merge with the check red.** Requires admin bypass on every migration PR, which
is per-PR toil, racy with three or four concurrent sessions, and trains everyone
to read a red required check as noise.

## Decision

**For the comparison, and only the comparison, build the database from the
migrations as they stand on the PR's merge base.**

The check then asks the question it was written to ask — *has production drifted
from what has been merged?* — and is insensitive to what the PR proposes.

Concretely, in the `parity` job:

1. `supabase db reset --no-seed` over the **full** migration set, unchanged. This
   is what proves the PR's own migrations apply, and the `fk repoint`
   behavioural check that follows needs the schema they introduce.
2. `scripts/parity_migrations_added_by_pr.py --base origin/<base_ref>` lists the
   migration files this PR **adds**; the workflow moves them aside.
3. A second `supabase db reset --no-seed` builds the comparison database.
4. `check_schema_parity.sh` runs against that.

## What deliberately does NOT relax

This is the part that matters, because the failure mode of a change like this is
to quietly become vacuous — the fault ADR 0072 exists to close, reintroduced one
layer out.

- **A MODIFIED migration is not held back.** `--diff-filter=A` only. Editing a
  migration that has already been applied is a real defect and still shows as
  drift. This is the load-bearing property, and the self-test asserts it *and*
  asserts that assertion is non-vacuous (it checks that `--diff-filter=AM` would
  have listed the file, so the case cannot pass by matching nothing).
- **On `push` and `schedule` nothing is held back.** There is no base ref, the
  list is empty, and the behaviour on `main` is byte-for-byte what it was. The
  strictness that catches real hand-applied DDL is untouched.
- **A three-dot diff, not two-dot.** Two-dot compares against main's *tip*
  rather than the merge base, so a migration `main` has DELETED reads as one
  this branch added, and gets held back — hidden from a comparison it belongs
  in.

  **This is recorded as a correction, because the first version of this ADR
  claimed the self-test proved it and the self-test did not.** The fixture
  written for it — main gains a migration after the branch point — does *not*
  discriminate: under `--diff-filter=A` that file reads as a deletion from the
  two-dot diff's point of view too, so both forms already agree. Measured by
  mutation: swapping `...` for `..` left all eight cases green. The claim was
  written from reasoning about git rather than from running it.

  A genuinely discriminating case exists and is now the fixture: **main deletes
  a migration the branch never touched.** Two-dot lists it (absent from main's
  tip, present in the branch); three-dot does not (present in the merge base).
  Re-mutated after adding it — `..` now fails exactly that case, and the case
  carries its own non-vacuity assertion so it cannot pass by matching nothing.
- **A partial view is exit 2, never a quiet answer.** An unresolvable base does
  not silently mean "nothing added" (which would restore the block) and does not
  silently mean "hold everything back" (which would make the check vacuous). It
  refuses.

## Alternatives rejected

**Drop the two checks from the required list permanently.** This was the
immediate unblock, taken with the founder's approval so the six open PRs could
land, and it is not the resting state: it returns to the condition ADR 0072
itself flagged — *a red parity job has never blocked a merge*.

**Attribute each drifting object to the migration that created it, and exempt
only those.** More precise in principle, and rejected: attribution means parsing
DDL to decide which statement produced which catalog object, which is a second
implementation of Postgres's own bookkeeping. Building the base database *is*
the attribution, done by Postgres.

**Compare against a database built from `origin/main` at job time rather than the
merge base.** Rejected because it is wrong whenever main has moved: the PR would
be charged with drift for migrations merged by other people while it was open,
which is the same false-positive class in a new coat.

## Consequences

- A migration-bearing PR can go green without anyone touching production first,
  which removes the incentive that produced the version mismatch.
- The `parity` job's checkout needs `fetch-depth: 0`. This is load-bearing and is
  commented as such: actions/checkout defaults to shallow **and single-branch**,
  which leaves no `origin/<base_ref>` ref at all. Measured on a real shallow
  clone of `fix/lot-cost-truth`, the helper exits 2 both before and **after** a
  `git fetch origin main --depth 1`, because a single-branch clone's restricted
  refspec does not create the remote-tracking ref — so the fetch inside the step
  cannot substitute for the checkout setting.
- The job runs `supabase db reset` twice, roughly +40s.
- **Not fixed here, and named:** the sibling required check
  `Code queries only relations production has` has the identical fault and is
  not repaired by this change. It needs the same treatment — an object that
  production lacks but a migration *added by this PR* declares is expected, not
  a defect — and it is its own decision because the guard's debt-list semantics
  interact with it. Until then it stays off the required list.
- **Also not fixed, and named:** a PR that DELETES a migration already applied to
  production is not caught by either arm. The base build still contains it, so
  the comparison is clean, and the full build simply lacks it. Nothing in CI
  currently objects to deleting an applied migration.

## Verification

`scripts/parity_migrations_added_by_pr.py --self-test` — **10/10 pass**, against
real throwaway git repositories, not mocks:

- a branch adding one migration lists exactly it;
- **a MODIFIED migration is not held back**;
- a docs-only branch holds nothing back;
- a migration `main` gained after the branch point is not held back;
- **a migration `main` DELETED is not reported as added by this branch**;
- that case is discriminating — two-dot *would* wrongly list it;
- an unresolvable base raises rather than returning `[]`;
- a tree with too few migrations raises;
- a tree with no migrations directory raises;
- the modified-migration case is proven non-vacuous — `--diff-filter=AM` *does*
  list that file, so case 2 is discriminating rather than matching nothing.

**Mutation-tested, three ways, because a passing self-test is not evidence until
a broken guard fails it:**

| mutation | result |
|---|---|
| `--diff-filter=A` → `AM` | FAILS *"a MODIFIED migration is not held back"* |
| `...` → `..` (before the new fixture) | **passed all eight** — which is how the ADR's original claim was found to be wrong |
| `...` → `..` (after the new fixture) | FAILS *"a migration main DELETED is not reported as added by this branch"* |

And on the workflow's two claims, by editing the file and re-running
`check_decision_claims.sh`: removing `fetch-depth: 0` → **1 REGRESSED**;
renaming the `Fresh database equals remote` job → **2 REGRESSED**; restored →
PASS. Neither claim can be satisfied by a file that does not say what it says.

Against the three real branches this was blocking:

| branch | held back |
|---|---|
| `fix/lot-cost-truth` | `20260902150000_lot_cost_truth.sql` |
| `fix/team-gateway` | `20260902200000_team_access_role_is_a_known_role.sql` |
| `fix/team-page` | *(none — it adds no migration, and its parity was never red)* |

One correction to a figure stated earlier in the session: `fix/team-gateway` was
first reported as adding **3** migrations. That came from a two-dot
`git diff --name-only` with no `--diff-filter`, which counts a rename as a
delete plus an add. The accurate count of files **added** is **1**.

`python3 -c "import yaml; yaml.safe_load(...)"` on the edited workflow — OK, and
all four required job `name:` values still present and byte-identical, including
the em dash in *Beverage identity key — SQL matches Python*.

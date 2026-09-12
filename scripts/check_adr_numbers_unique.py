#!/usr/bin/env python3
"""
Guard: an ADR number introduced by this branch is not already taken elsewhere.

WHY THIS EXISTS
---------------
Three times now, two branches have independently claimed the same ADR number,
and each time it was caught by a human noticing, late:

  * 2026-08-28 -- the Sentry PII fix filed ADR 0035 while the unmerged
    agent-stack chain already reserved 0034-0039. Renumbered to 0040 after the
    fact, by hand.
  * 2026-09-01 -- ADR 0049 was claimed twice on the same afternoon:
    `0049-ecosystem-division-layer.md` (merged to main as b70e62d9) and
    `0049-rebuilt-pages-show-live-data-only.md` (pushed, no PR yet). Renumbered
    to 0051.

The second case is the instructive one, because the session that lost the race
*used the correct method*. It swept every remote branch, saw 0045/0047/0048
claimed, and took 0049 -- and the other 0049 merged in the window between that
sweep and the commit. A correct manual sweep still loses to a race, because the
number is claimed at COMMIT time and verified at SWEEP time, and those are
minutes apart.

So the fix is not a better convention. Two conventions were considered and
rejected:

  * "Claim the number in OPEN-DECISIONS_DIR.md the moment you start." This is
    actively worse. ADR 0025 is locked precisely because adding a register row
    re-anchors every citation below it -- 27 across 24 files, measured. That
    trades a rare renumber for a frequent citation break.
  * "Remember to re-sweep immediately before committing." This asks every future
    session to remember something under time pressure, which is the thing that
    already failed three times.

A guard does not have to remember. This one runs in CI, where the sweep and the
verdict are the same moment.

WHAT COUNTS AS A COLLISION
--------------------------
Same number, DIFFERENT slug, on two different refs.

The same ADR in flight on several refs is not a collision -- a branch, its PR
head, and a rebase of it all legitimately carry `0050-agent-dispatch-*.md`, and
failing on that would make the guard fire constantly on ordinary work. It is the
slug disagreeing that means two different decisions are wearing one number.

SCOPE: ONLY WHAT THIS REF INTRODUCES
------------------------------------
The guard checks the numbers the current ref introduces *relative to main*, not
every collision in the repository. This is deliberate. A stale abandoned branch
carrying a duplicate number is a real thing that happens, and it must not turn
every unrelated PR red -- a guard that cries about someone else's mess gets
disabled, and then it is not guarding anything. Use --audit for the full sweep.

NEVER VACUOUS
-------------
CI checkout is shallow and single-branch by default. A version of this guard that
ran there without fetching would see exactly one ref, find no collisions, and
certify every collision in the repository as clean. That is worse than no guard:
it converts an unknown into a false all-clear.

So: **exit 2 -- not 0 -- whenever the guard cannot see what it claims to check.**
Not a git repo, no origin remote, no origin/main, zero ADR files, or -- the
important one -- *any* branch on the remote that has no local tracking ref.

That last condition is stronger than "zero branches", and deliberately so. A
PARTIAL fetch is the dangerous case: seeing 3 of 30 branches finds no collision
and looks exactly like success. So the guard asks the remote what exists
(`git ls-remote --heads`) and refuses to render a verdict until it can see all
of it locally. Counting only what happens to be present is how a guard ends up
certifying a repository it never read.

ONE RE-FETCH BEFORE THAT VERDICT (founder, 2026-09-06 batch 67)
---------------------------------------------------------------
There is a benign way to be missing a ref, and it is common: somebody pushes a
branch in the seconds between CI's own fetch step and this guard's `ls-remote`.
The guard was right that it could not see everything, and wrong about what to do
about it -- CI run 34036195481 (2026-09-06) went red on a peer's push, which
teaches a reader that a red run means "someone else pushed" rather than "a
number is wearing two slugs". A guard whose red means two different things stops
being read.

So on seeing a branch with no local ref the guard now runs ONE
`git fetch origin '+refs/heads/*:refs/remotes/origin/*'` itself and asks again.
Three properties matter and each is a decision:

  * ONE. Not a loop and not a timer. A second push during the fetch would be
    caught by a third, and a guard that retries until the repository holds still
    can hang a CI job forever.
  * The re-check uses the FIRST `ls-remote` snapshot, not a fresh one. Asking
    the remote again after fetching re-opens the exact race being closed, and
    the completeness claim the guard makes is "everything that existed when I
    looked", which is what a snapshot is.
  * A FETCH THAT FAILS IS NOT A PASS. The fetch is best-effort -- no network,
    no credentials, a ref that cannot be written locally -- and its failure is
    swallowed only so the verdict comes from the ref check itself, with its own
    sentence. Still missing after the fetch is still exit 2, exactly as before.

This narrows when the guard exits 2; it does not narrow WHAT it checks. Every
condition that exited 2 and is still true after a fetch still exits 2.

Per ADR 0025's "a claim that cannot run is a FAILURE", a guard that certifies
itself on no evidence is the failure mode, not the fallback.

EXIT CODES
----------
  0  the numbers this ref introduces are unique
  1  collision -- two different decisions wearing one number
  2  CANNOT CHECK -- see above. Repoint the guard; do not treat as a skip.
"""

from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys
import tempfile
from collections import defaultdict

ADR_RE = re.compile(r"^\.planning/decisions/(\d{4})-([a-z0-9-]+)\.md$")
DECISIONS_DIR = ".planning/decisions"
MAIN_REF = "origin/main"


class CannotCheck(Exception):
    """The guard cannot see what it claims to check. Always exit 2."""


def git(*args: str) -> str:
    try:
        out = subprocess.run(
            ["git", *args],
            capture_output=True,
            text=True,
            check=False,
        )
    except FileNotFoundError as exc:  # pragma: no cover - no git binary
        raise CannotCheck("git is not on PATH") from exc
    if out.returncode != 0:
        raise CannotCheck(f"`git {' '.join(args)}` failed: {out.stderr.strip()}")
    return out.stdout


FETCH_HINT = (
    "actions/checkout with `fetch-depth: 0`, then "
    "`git fetch origin '+refs/heads/*:refs/remotes/origin/*'`"
)


def remote_heads() -> set[str]:
    """What the REMOTE says exists -- the yardstick for 'did we see everything'."""
    raw = git("ls-remote", "--heads", "origin")
    heads = {
        line.split()[1][len("refs/heads/"):]
        for line in raw.splitlines()
        if len(line.split()) == 2 and line.split()[1].startswith("refs/heads/")
    }
    if not heads:
        raise CannotCheck(
            "`git ls-remote --heads origin` returned no branches. Without the "
            "remote's own branch list there is nothing to check completeness "
            "against, so any verdict here would be a guess."
        )
    return heads


def local_refs() -> list[str]:
    """Every local and remote-tracking ref that could carry an ADR, as it stands."""
    raw = git(
        "for-each-ref",
        "--format=%(refname:short)",
        "refs/remotes/origin",
        "refs/heads",
    )
    refs = [r.strip() for r in raw.splitlines() if r.strip()]
    return [r for r in refs if not r.endswith("/HEAD")]


def fetch_all_heads() -> bool:
    """One fetch of every head on origin. True when git was happy.

    Best-effort ON PURPOSE. The verdict this guard renders is the ref-completeness
    check below, which has a sentence naming the branches it could not see; a
    fetch that dies on a missing credential or a ref it cannot write locally would
    otherwise replace that sentence with git's stderr and lose the reason. The
    failure is not hidden -- it is reported as part of the CANNOT CHECK, and a
    fetch that fails and leaves a branch missing is still exit 2.
    """
    try:
        git("fetch", "origin", "+refs/heads/*:refs/remotes/origin/*")
        return True
    except CannotCheck:
        return False


def all_refs() -> list[str]:
    """Every local and remote ref that could carry an ADR.

    Refuses to return a partial view. Seeing 3 of 30 branches finds no collision
    and looks exactly like success -- so completeness is checked against the
    remote, not against a floor like "at least two refs".

    A branch pushed by somebody else between CI's fetch and this call is missing
    for a benign reason, so the guard fetches ONCE and asks again before refusing
    (see the module docstring). The re-check is against the SAME `heads` snapshot
    -- re-asking the remote would re-open the race it is closing.
    """
    refs = local_refs()
    heads = remote_heads()
    missing = heads - {r[len("origin/"):] for r in refs if r.startswith("origin/")}

    refetched = False
    fetch_ok = True
    if missing:
        refetched = True
        fetch_ok = fetch_all_heads()
        refs = local_refs()
        missing = missing - {r[len("origin/"):] for r in refs if r.startswith("origin/")}

    if missing:
        shown = ", ".join(sorted(missing)[:5])
        more = f" (and {len(missing) - 5} more)" if len(missing) > 5 else ""
        after = (
            " This is AFTER the guard fetched every head itself and asked again"
            f"{'' if fetch_ok else ' (that fetch itself failed)'}, so it is not a"
            " concurrent push."
        )
        raise CannotCheck(
            f"{len(missing)} branch(es) on origin have no local ref: {shown}{more}."
            f"{after} "
            "A partial view cannot rule out a collision -- the branch holding the "
            f"duplicate may be one of the ones not fetched. Fetch them: {FETCH_HINT}"
        )

    if refetched:
        # Said out loud: a run that had to fetch was racing somebody, and a
        # reader comparing two runs' ref counts should know why they differ.
        print(
            "Re-fetched origin: a branch had no local ref on the first look "
            "(a concurrent push), and every one of them resolved.",
            file=sys.stderr,
        )

    if MAIN_REF not in refs:
        raise CannotCheck(f"{MAIN_REF} is not present. Fetch it: {FETCH_HINT}")
    return refs


def adrs_at(ref: str) -> dict[str, str]:
    """number -> slug, for one ref."""
    try:
        raw = git("ls-tree", "-r", "--name-only", ref, DECISIONS_DIR)
    except CannotCheck:
        return {}
    found: dict[str, str] = {}
    for line in raw.splitlines():
        m = ADR_RE.match(line.strip())
        if m:
            found[m.group(1)] = m.group(2)
    return found


def adrs_here() -> dict[str, str]:
    """number -> slug, for the working tree (what this ref actually has)."""
    raw = git("ls-files", DECISIONS_DIR)
    found: dict[str, str] = {}
    for line in raw.splitlines():
        m = ADR_RE.match(line.strip())
        if m:
            found[m.group(1)] = m.group(2)
    return found


def next_free(by_number: dict[str, set[str]]) -> str:
    """Lowest number above the highest claimed, swept across ALL refs.

    Everyone gets this wrong by sweeping one checkout, so the guard prints it.
    """
    if not by_number:
        return "0001"
    return f"{max(int(n) for n in by_number) + 1:04d}"


def collect(refs: list[str]) -> tuple[dict[str, set[str]], dict[tuple[str, str], list[str]]]:
    by_number: dict[str, set[str]] = defaultdict(set)
    where: dict[tuple[str, str], list[str]] = defaultdict(list)
    for ref in refs:
        for number, slug in adrs_at(ref).items():
            by_number[number].add(slug)
            where[(number, slug)].append(ref)
    if not by_number:
        raise CannotCheck(
            f"no ADR files matched {ADR_RE.pattern!r} on any ref. Either the "
            "decisions directory moved or the filename convention changed -- "
            "repoint this guard."
        )
    return by_number, where


def fmt_refs(refs: list[str], limit: int = 4) -> str:
    """Name a few refs, then count the rest.

    A number that has been in the tree a while is reachable from hundreds of
    branches, and printing all of them buries the one line the reader needs.
    Prefer origin/* refs in the sample -- those are the ones others can see.
    """
    ordered = sorted(refs, key=lambda r: (not r.startswith("origin/"), r))
    shown = ", ".join(ordered[:limit])
    rest = len(ordered) - limit
    return f"{shown} (+{rest} more)" if rest > 0 else shown


def report_collision(number: str, mine: str, theirs: set[str], where, by_number) -> None:
    print(f"COLLISION: ADR {number} names more than one decision.\n")
    print(f"  this ref:  {DECISIONS_DIR}/{number}-{mine}.md")
    for slug in sorted(theirs):
        print(f"  elsewhere: {DECISIONS_DIR}/{number}-{slug}.md")
        print(f"             on {fmt_refs(where[(number, slug)])}")
    print(f"\n  Next free number, swept across every ref: {next_free(by_number)}")
    print(
        "\n  Fix it on THIS branch, now, before a PR anchors reviewers on the "
        "old number: rename the file, its H1, its index row in "
        f"{DECISIONS_DIR}/README.md, and every internal citation."
    )


def run_default() -> int:
    refs = all_refs()
    by_number, where = collect(refs)
    mine = adrs_here()
    on_main = adrs_at(MAIN_REF)

    introduced = {n: s for n, s in mine.items() if on_main.get(n) != s}
    if not introduced:
        print("No ADR numbers introduced by this ref. Nothing to check.")
        print(f"Next free number, swept across {len(refs)} refs: {next_free(by_number)}")
        return 0

    failed = False
    for number, slug in sorted(introduced.items()):
        others = {s for s in by_number.get(number, set()) if s != slug}
        if others:
            report_collision(number, slug, others, where, by_number)
            failed = True

    if failed:
        return 1

    listed = ", ".join(f"{n} ({s})" for n, s in sorted(introduced.items()))
    print(f"OK -- introduced by this ref: {listed}")
    print(f"Checked against {len(refs)} refs. No number wears two slugs.")
    return 0


def run_audit() -> int:
    refs = all_refs()
    by_number, where = collect(refs)
    collisions = {n: s for n, s in by_number.items() if len(s) > 1}
    if not collisions:
        print(f"AUDIT: no ADR number collisions across {len(refs)} refs.")
        print(f"Next free number: {next_free(by_number)}")
        return 0
    print(f"AUDIT: {len(collisions)} colliding ADR number(s) across {len(refs)} refs.\n")
    for number, slugs in sorted(collisions.items()):
        print(f"  ADR {number}:")
        for slug in sorted(slugs):
            print(f"    {number}-{slug}.md")
            print(f"      on {fmt_refs(where[(number, slug)])}")
    print(f"\nNext free number: {next_free(by_number)}")
    return 1


def _ref_completeness_fixtures() -> str | None:
    """The two cases a full local clone can never prove, built from nothing.

    Every other test in this file runs in a complete checkout, where the guard
    trivially sees every branch. CI does not look like that: checkout is shallow
    and single-branch, which is exactly the condition under which a weaker
    version of this guard would enumerate one ref, find no collision, and exit 0
    on a live collision. So build that condition on purpose.

    TWO OUTCOMES, because as of 2026-09-06 the guard fetches once before it
    refuses (module docstring, "ONE RE-FETCH BEFORE THAT VERDICT"):

      A. THE RACE. A branch on origin has no local ref and a fetch resolves it --
         a peer pushed between CI's fetch step and this guard's `ls-remote`
         (CI run 34036195481). The guard must fetch, see it, and exit 0. Before
         the change this exact shape exited 2, which is what made a peer's push
         read as "a number wears two slugs".

      B. THE FETCH CANNOT RESOLVE IT. Same missing branch, but fetching does not
         produce it. The guard must still exit 2, and for the ref reason. This
         is the half the retry must not swallow: if a failed fetch let the guard
         proceed, the retry would have converted the guard's whole subject -- a
         partial view -- into a pass.

      Case B is built with a directory/file ref conflict, which is a real
      condition rather than a stub: origin carries `feature/x`, the clone holds a
      remote-tracking ref literally named `feature`, and git cannot create
      `refs/remotes/origin/feature/x` under a ref that already exists as a file.
      `ls-remote` still advertises the branch, so the guard genuinely cannot see
      it, and the fetch genuinely cannot fix it. (Measured 2026-09-06: fetch
      exits 1, `origin/feature/x` is absent afterwards.)

    HOW THIS USED TO BE WRONG, because the failure was expensive and silent.
    The fixture cloned the *enclosing checkout* and asserted the child exited 2.
    But the child's `origin` is then the parent, and `remote_heads()` asks
    `origin` what exists. On a `pull_request` checkout the parent carries many
    refs, the child is missing them, and the child exits 2 -- green. On a `push`
    checkout the parent is single-branch, so origin advertises ONE head, the
    child has that one head, nothing is missing, and the child correctly exits
    0 -- while this fixture demanded 2. git also warns `--depth is ignored in
    local clones`, so it was never shallow either.

    The result: **every PR was green and every push to main was red**, for 14
    consecutive merges on 2026-09-02. And because `Deploy to Production` is
    gated `workflow_run` on CI, a red CI made it `skipped` -- so the post-merge
    health audit, which exists precisely because CI cannot see Nest DI
    failures, did not run for any of them, and a `skipped` row reads as "not
    applicable" rather than "the check that catches production crashes did not
    run". A fixture that depends on the shape of the enclosing checkout is
    testing the environment, not the guard.

    So the condition is now built from nothing and owned entirely by this
    function: a scratch repo, a bare "remote", and a shallow single-branch clone
    of it over `file://` (a path-form local clone silently ignores `--depth`).
    Nothing is read from the enclosing checkout, so the result holds identically
    on `push`, on `pull_request` and on a developer's laptop.

    Both cases also assert WHY the child exited as it did. There are six
    distinct CANNOT-CHECK paths in this file, and an empty or malformed fixture
    would trip a different one -- passing while proving nothing about the ref
    completeness it claims to cover.

    Returns an error string, or None when the guard behaved correctly.
    """

    def run(*args: str, cwd: str | None = None) -> subprocess.CompletedProcess:
        return subprocess.run(
            ["git", *args], cwd=cwd, capture_output=True, text=True
        )

    # Two SYNTHETIC ADRs. Nothing here is read from the enclosing checkout --
    # not the repo root, not its decisions directory, not its files. A self-test
    # that can see the real repo can be made to pass by the real repo, and this
    # fixture's whole subject is a test that was answering about its environment
    # instead of its guard. They exist only so the child's single reachable
    # CANNOT-CHECK path is the ref one; two distinct numbers, so they can never
    # read as a collision. 9xxx is chosen to stay clear of any real number.
    SYNTHETIC_ADRS = {
        "9001-synthetic-fixture-alpha.md": "# 9001 - synthetic fixture ADR\n",
        "9002-synthetic-fixture-beta.md": "# 9002 - synthetic fixture ADR\n",
    }
    for name in SYNTHETIC_ADRS:
        if not ADR_RE.match(f"{DECISIONS_DIR}/{name}"):
            return (
                f"the fixture's own synthetic ADR name {name!r} no longer matches "
                f"{ADR_RE.pattern!r}. The filename convention changed; the fixture "
                "would seed a tree the guard cannot read and prove nothing."
            )

    guard = os.path.abspath(__file__)

    def build(td: str, branches: list[str]) -> tuple[str, str] | str:
        """A bare remote carrying `main` plus `branches`, and a shallow clone of main."""
        seed = os.path.join(td, "seed")
        bare = os.path.join(td, "origin.git")
        clone = os.path.join(td, "shallow")

        os.makedirs(os.path.join(seed, DECISIONS_DIR))
        for name, body in SYNTHETIC_ADRS.items():
            with open(os.path.join(seed, DECISIONS_DIR, name), "w", encoding="utf-8") as fh:
                fh.write(body)

        steps = [
            (["init", "--quiet", seed], None),
            (["config", "user.email", "guard@invalid"], seed),
            (["config", "user.name", "guard"], seed),
            (["add", "-A"], seed),
            (["commit", "--quiet", "-m", "seed"], seed),
            (["init", "--bare", "--quiet", bare], None),
            (["push", "--quiet", bare, "HEAD:refs/heads/main"], seed),
        ]
        for branch in branches:
            steps.append((["push", "--quiet", bare, f"HEAD:refs/heads/{branch}"], seed))
        steps.append(
            # file:// so --depth is honoured; a bare path is silently ignored.
            (
                [
                    "clone", "--quiet", "--depth", "1", "--single-branch",
                    "--branch", "main", f"file://{bare}", clone,
                ],
                None,
            ),
        )
        for args, cwd in steps:
            r = run(*args, cwd=cwd)
            if r.returncode != 0:
                return (
                    f"could not build the fixture at `git {' '.join(args)}`: "
                    f"{(r.stderr or r.stdout).strip()}"
                )
        return bare, clone

    # ---- A. the race: a branch the clone does not have, and a fetch fixes it ----
    with tempfile.TemporaryDirectory() as td:
        built = build(td, ["second-branch"])
        if isinstance(built, str):
            return built
        _, clone = built

        before = run("for-each-ref", "--format=%(refname:short)", "refs/remotes", cwd=clone)
        if "origin/second-branch" in before.stdout:
            return (
                "the race fixture is vacuous: the shallow clone already tracks "
                "origin/second-branch, so the guard never reaches the re-fetch."
            )

        proc = subprocess.run(
            [sys.executable, guard], cwd=clone, capture_output=True, text=True
        )
        if proc.returncode != 0:
            return (
                f"a branch pushed since the clone made the guard exit {proc.returncode}, "
                "want 0. A concurrent push must become one re-fetch, not a red run: "
                "a guard whose red means both 'two decisions wear one number' and "
                "'somebody else pushed' stops being read. Got: "
                f"{(proc.stdout + proc.stderr).strip()[:300]}"
            )
        if "Re-fetched origin" not in (proc.stdout + proc.stderr):
            return (
                "the guard exited 0 on the race fixture but never said it re-fetched, "
                "so it passed for some other reason and this case covers nothing."
            )
        after = run("for-each-ref", "--format=%(refname:short)", "refs/remotes", cwd=clone)
        if "origin/second-branch" not in after.stdout:
            return (
                "the guard exited 0 while origin/second-branch STILL has no local "
                "ref -- it certified a repository it never read, which is the exact "
                "failure this guard exists to prevent."
            )

    # ---- B. the fetch cannot resolve it: still exit 2, still for the ref reason ----
    with tempfile.TemporaryDirectory() as td:
        built = build(td, ["feature/x"])
        if isinstance(built, str):
            return built
        _, clone = built

        head = run("rev-parse", "HEAD", cwd=clone)
        if head.returncode != 0:
            return f"could not read the clone's HEAD: {head.stderr.strip()}"
        # `refs/remotes/origin/feature` as a FILE makes `refs/remotes/origin/feature/x`
        # impossible to create, so the fetch below cannot resolve the missing branch.
        blocker = run(
            "update-ref", "refs/remotes/origin/feature", head.stdout.strip(), cwd=clone
        )
        if blocker.returncode != 0:
            return f"could not plant the blocking ref: {blocker.stderr.strip()}"

        proc = subprocess.run(
            [sys.executable, guard], cwd=clone, capture_output=True, text=True
        )
        blob = proc.stdout + proc.stderr
        if proc.returncode != 2:
            return (
                f"a branch the fetch cannot resolve exited {proc.returncode}, want 2. "
                "The one re-fetch must narrow WHEN the guard cannot check, never "
                f"convert a partial view into a pass. Got: {blob.strip()[:300]}"
            )
        if "no local ref" not in blob:
            return (
                "the clone exited 2, but not for the missing-ref reason this "
                "fixture exists to prove -- so it would pass while covering "
                f"nothing. Got: {blob.strip()[:300]}"
            )
        if "AFTER the guard fetched" not in blob:
            return (
                "the clone exited 2 for the ref reason, but the refusal does not "
                "say a fetch was already attempted -- a reader would try the fetch "
                f"the message suggests and get the same red. Got: {blob.strip()[:300]}"
            )
        still = run("for-each-ref", "--format=%(refname:short)", "refs/remotes", cwd=clone)
        if "origin/feature/x" in still.stdout:
            return (
                "the fixture's blocking ref did not block: origin/feature/x was "
                "fetched after all, so case B proved nothing about a fetch that "
                "cannot resolve a branch."
            )
    return None


def run_self_test() -> int:
    """The guard must still fire on the shape it exists to catch."""
    where = {
        ("0049", "ecosystem-division-layer"): ["origin/main"],
        ("0049", "rebuilt-pages-show-live-data-only"): ["origin/docs/adr-0049-live"],
        ("0050", "agent-dispatch-hardness-threshold"): ["origin/docs/agent-dispatch"],
    }
    by_number = {
        "0049": {"ecosystem-division-layer", "rebuilt-pages-show-live-data-only"},
        "0050": {"agent-dispatch-hardness-threshold"},
    }
    failures = []

    others = {s for s in by_number["0049"] if s != "ecosystem-division-layer"}
    if not others:
        failures.append("a number carrying two different slugs was not seen as a collision")

    if {s for s in by_number["0050"] if s != "agent-dispatch-hardness-threshold"}:
        failures.append("a number carrying ONE slug was wrongly called a collision")

    if next_free(by_number) != "0051":
        failures.append(f"next_free swept wrong: got {next_free(by_number)}, want 0051")

    if ADR_RE.match(".planning/decisions/README.md"):
        failures.append("README.md was parsed as an ADR")
    if not ADR_RE.match(".planning/decisions/0049-ecosystem-division-layer.md"):
        failures.append("a real ADR filename did not parse")

    refs_case = _ref_completeness_fixtures()
    if refs_case:
        failures.append(refs_case)

    if failures:
        for f in failures:
            print(f"SELF-TEST FAILED: {f}")
        return 1
    print("SELF-TEST OK -- collision detected, non-collision not flagged, "
          "next-free swept across refs, README not parsed as an ADR, a "
          "concurrent push re-fetched and passed, a branch the fetch cannot "
          "resolve still exit 2.")
    _ = where
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[1])
    ap.add_argument("--audit", action="store_true",
                    help="report every collision on every ref, not just this ref's")
    ap.add_argument("--self-test", action="store_true",
                    help="prove the guard still fires on the shape it exists to catch")
    args = ap.parse_args()

    if args.self_test:
        return run_self_test()

    try:
        return run_audit() if args.audit else run_default()
    except CannotCheck as exc:
        print(f"CANNOT CHECK: {exc}", file=sys.stderr)
        print(
            "This is a FAILURE, not a skip. A guard that certifies itself on no "
            "evidence is worse than no guard.",
            file=sys.stderr,
        )
        return 2


if __name__ == "__main__":
    sys.exit(main())

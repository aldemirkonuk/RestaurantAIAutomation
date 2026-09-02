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


def all_refs() -> list[str]:
    """Every local and remote ref that could carry an ADR.

    Refuses to return a partial view. Seeing 3 of 30 branches finds no collision
    and looks exactly like success -- so completeness is checked against the
    remote, not against a floor like "at least two refs".
    """
    raw = git(
        "for-each-ref",
        "--format=%(refname:short)",
        "refs/remotes/origin",
        "refs/heads",
    )
    refs = [r.strip() for r in raw.splitlines() if r.strip()]
    refs = [r for r in refs if not r.endswith("/HEAD")]

    tracked = {r[len("origin/"):] for r in refs if r.startswith("origin/")}
    missing = remote_heads() - tracked
    if missing:
        shown = ", ".join(sorted(missing)[:5])
        more = f" (and {len(missing) - 5} more)" if len(missing) > 5 else ""
        raise CannotCheck(
            f"{len(missing)} branch(es) on origin have no local ref: {shown}{more}. "
            "A partial view cannot rule out a collision -- the branch holding the "
            f"duplicate may be one of the ones not fetched. Fetch them: {FETCH_HINT}"
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


def _shallow_clone_must_exit_2() -> str | None:
    """The one case a full local clone can never prove.

    Every other test in this file runs in a complete checkout, where the guard
    trivially sees every branch. CI does not look like that: checkout is shallow
    and single-branch, which is exactly the condition under which a weaker
    version of this guard would enumerate one ref, find no collision, and exit 0
    on a live collision. So build that condition on purpose and assert it fails.

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
    function: a scratch repo, a bare "remote" carrying TWO branches, and a
    shallow single-branch clone of it over `file://` (a path-form local clone
    silently ignores `--depth`). origin then advertises 2 while the child holds
    1, which is the real condition rather than a coincidence of the enclosing
    checkout, and it holds identically on `push`, on `pull_request` and on a
    developer's laptop.

    It also asserts WHY the child exited 2. There are six distinct CANNOT-CHECK
    paths in this file, and an empty or malformed fixture would trip a
    different one -- passing this test while proving nothing about the ref
    completeness it claims to cover.

    Returns an error string, or None when the guard behaved correctly.
    """

    def run(*args: str, cwd: str | None = None) -> subprocess.CompletedProcess:
        return subprocess.run(
            ["git", *args], cwd=cwd, capture_output=True, text=True
        )

    try:
        root = git("rev-parse", "--show-toplevel").strip()
    except CannotCheck as exc:
        return f"could not locate the repo root to build the fixture: {exc}"

    # Two real ADR files, so the only reachable CANNOT-CHECK is the ref one.
    src = os.path.join(root, DECISIONS_DIR)
    try:
        adrs = sorted(
            f for f in os.listdir(src)
            if ADR_RE.match(f"{DECISIONS_DIR}/{f}")
        )[:2]
    except OSError as exc:
        return f"could not read {DECISIONS_DIR} to seed the fixture: {exc}"
    if len(adrs) < 2:
        return (
            f"need 2 ADR files under {DECISIONS_DIR} to seed the fixture, found "
            f"{len(adrs)}. Without them the child would exit 2 for the wrong reason."
        )

    with tempfile.TemporaryDirectory() as td:
        seed = os.path.join(td, "seed")
        bare = os.path.join(td, "origin.git")
        clone = os.path.join(td, "shallow")

        os.makedirs(os.path.join(seed, DECISIONS_DIR))
        for name in adrs:
            with open(os.path.join(src, name), "rb") as fh:
                body = fh.read()
            with open(os.path.join(seed, DECISIONS_DIR, name), "wb") as fh:
                fh.write(body)

        steps = [
            (["init", "--quiet", seed], None),
            (["config", "user.email", "guard@invalid"], seed),
            (["config", "user.name", "guard"], seed),
            (["add", "-A"], seed),
            (["commit", "--quiet", "-m", "seed"], seed),
            (["init", "--bare", "--quiet", bare], None),
            # TWO branches on the remote; the clone will take one.
            (["push", "--quiet", bare, "HEAD:refs/heads/main"], seed),
            (["push", "--quiet", bare, "HEAD:refs/heads/second-branch"], seed),
            # file:// so --depth is honoured; a bare path is silently ignored.
            (
                [
                    "clone", "--quiet", "--depth", "1", "--single-branch",
                    "--branch", "main", f"file://{bare}", clone,
                ],
                None,
            ),
        ]
        for args, cwd in steps:
            r = run(*args, cwd=cwd)
            if r.returncode != 0:
                return (
                    f"could not build the fixture at `git {' '.join(args)}`: "
                    f"{(r.stderr or r.stdout).strip()}"
                )

        proc = subprocess.run(
            [sys.executable, os.path.abspath(__file__)],
            cwd=clone, capture_output=True, text=True,
        )
        if proc.returncode != 2:
            return (
                f"a shallow single-branch clone exited {proc.returncode}, want 2. "
                "In CI the guard would then certify a real collision as clean, "
                "which is the exact failure this guard exists to prevent."
            )
        blob = proc.stdout + proc.stderr
        if "no local ref" not in blob:
            return (
                "the shallow clone exited 2, but not for the missing-ref reason "
                "this fixture exists to prove -- so it would pass while covering "
                f"nothing. Got: {blob.strip()[:300]}"
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

    shallow = _shallow_clone_must_exit_2()
    if shallow:
        failures.append(shallow)

    if failures:
        for f in failures:
            print(f"SELF-TEST FAILED: {f}")
        return 1
    print("SELF-TEST OK -- collision detected, non-collision not flagged, "
          "next-free swept across refs, README not parsed as an ADR.")
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

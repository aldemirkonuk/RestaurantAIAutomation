#!/usr/bin/env python3
"""Which commit should THIS service actually be running?

WHY THIS EXISTS
---------------
Railway only rebuilds a service when a push touches paths inside that
service's own watchPatterns (Railway dashboard: Service -> Settings -> Build
-> Watch Paths; also readable via `railway deployment list --service <name>
--json` -> `.[0].meta.serviceManifest.build.watchPatterns`). A merge to main
that does not touch those paths makes Railway correctly SKIP a rebuild --
`meta.skippedReason: "No changes to watched files"` -- and the service keeps
serving whatever it already built. `check_deployed_sha.py` comparing the
running build against the RAW merged sha in that situation is comparing
against a sha the service was never going to build from, and reports
MISMATCH for a deploy that behaved exactly as designed.

Confirmed live twice in a row, 2026-09-03: PR #284 (docs only) and PR #261
(CI/tooling/.claude/.planning only, ADR 0090) both correctly skipped a
api-gateway rebuild and both then failed "The deployed build IS the merged
build" for it -- the same "a mismatch reported as a failure without checking
the real invariant" shape as this repo's own absence-reported-as-health
fault, one layer removed: here presence (a correct, intentional skip) is
what got reported as absence.

WHAT THIS DOES
--------------
Given the sha that was merged and a service's watch-path patterns, finds the
most recent commit AT OR BEFORE that sha, ON THE FIRST-PARENT LINE, which
touches at least one of those patterns -- the commit Railway's own watch-path
logic would actually have built from. That, not the raw merge sha, is what a
deploy-verification check should expect a path-scoped service to be running.

`--first-parent` matters and is not incidental: `git log <sha> -- <paths>`
without it applies git's default history simplification, which can silently
skip a real merge commit M and resolve to a side-branch commit that was never
`main`'s head and that Railway never built from -- see `resolve()`'s own
docstring for the live case this broke on and how the fix was verified.

KEEPING THIS IN SYNC WITH RAILWAY
----------------------------------
The `--paths` a caller passes are a manual mirror of a Railway service's own
watchPatterns. This script does not read Railway's config -- doing so needs a
Railway project token this repo does not currently provision in CI, and a
second network dependency in a script whose whole job is answering a git
question. If a service's watch paths change in the Railway dashboard, the
caller's `--paths` goes stale silently; there is no guard for that drift yet.
Re-check with the CLI command above if this starts reporting MISMATCH for a
deploy Railway itself considered a correct skip, or MATCH for a deploy that
actually should have rebuilt.

SELF-TEST
---------
Builds a real, throwaway git repository on disk and asserts against real
`git log` output -- not a mocked one -- including the two cases this file
exists for: a later commit that does NOT touch the watched paths must
resolve to the EARLIER commit that did, and a sha with no watched-path
commit anywhere in its history must fail closed rather than silently
returning nothing.

    python3 scripts/resolve_watched_commit.py --self-test

USAGE
-----
    python3 scripts/resolve_watched_commit.py \
        --sha "$MERGED_SHA" \
        --paths apps/api-gateway pnpm-lock.yaml pnpm-workspace.yaml package.json

Prints the resolved sha to stdout and exits 0. Exits 2 (cannot check, blocks
like a failure -- the repo-wide rule) if no commit at or before --sha touches
any of --paths, or if git itself cannot answer.
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys


def resolve(repo_dir: str, sha: str, paths: list[str]) -> str | None:
    """The most recent commit at-or-before `sha`, in `repo_dir`, touching any of `paths`.

    Pure wrapper around one `git log` call: `-1` for "most recent only",
    `sha` itself as the upper bound (not `HEAD` -- the caller may be auditing
    a commit that is no longer the tip), `--` to separate the revision from
    the pathspecs so a path that happens to look like a flag is never
    misread as one. Returns None, never raises, when git finds nothing --
    "no such commit" is a real, expected answer this function must be able
    to give, not an error condition.

    `--first-parent` is load-bearing, not cosmetic (CORRECTED -- found live,
    PR #291's own correctness audit, before this file's first merge). Without
    it, `git log <sha> -- <paths>` applies git's default history
    simplification: at a merge commit M that is TREESAME to one parent for
    these specific paths, git silently follows only that parent and never
    reports M itself. So a caller asking "what should THIS PUSHED HEAD be
    running" could get back a side-branch commit that was never main's head
    and that Railway never built from -- confirmed against 4 of this repo's
    own real merge commits, and reproduced end-to-end: the pre-fix function
    resolved a non-branch commit S, `check_deployed_sha.py --expect S`
    reported MISMATCH against a gateway that had correctly rebuilt at the
    real merge commit M, and the same input with `--first-parent` resolves
    to M. `--first-parent` makes this function answer the question a
    post-merge deploy audit actually needs: "the last commit ON THE PUSHED
    LINE, at or before `sha`, that touched these paths" -- squash merges
    (this repo's own convention, see rollback-guide) are single-parent and
    entirely unaffected; only a `git merge` --no-ff-style merge commit
    changes behavior, and it changes it from wrong to right.
    """
    if not paths:
        raise ValueError("paths must be non-empty — an empty pathspec matches every commit")
    result = subprocess.run(
        ["git", "-C", repo_dir, "log", "-1", "--first-parent", "--format=%H", sha, "--", *paths],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(f"git log failed (exit {result.returncode}): {result.stderr.strip()}")
    out = result.stdout.strip()
    return out or None


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--sha", default="", help="the sha that was merged")
    ap.add_argument(
        "--paths",
        nargs="+",
        default=[],
        help="pathspecs mirroring the service's Railway watchPatterns",
    )
    ap.add_argument("--repo-dir", default=".", help="git checkout to read (default: cwd)")
    ap.add_argument("--self-test", action="store_true")
    args = ap.parse_args(argv)

    if args.self_test:
        return _self_test()

    if not args.sha.strip():
        print("FAIL — --sha is empty, so there is nothing to resolve from. (exit 2)")
        return 2
    # Hardening, not a live exploit (found live, PR #291's own security audit):
    # `--sha` is placed before `--` in the underlying `git log` call, unlike
    # `--paths`, so a value shaped like a flag (e.g. `--all`) reaches git as
    # one. Every real caller passes a GitHub-generated 40-hex sha, and every
    # constructed alternative degrades fail-closed (a wider git rev-range can
    # only name a NEWER commit than production runs, never an
    # attacker-favorable match) -- but "cannot happen given today's callers"
    # is not the same claim as "cannot happen", so this is enforced rather
    # than left to that argument. A short abbreviation is accepted (git
    # itself treats 4+ as potentially ambiguous; MIN_PREFIX mirrors
    # check_deployed_sha.py's own choice of 7 as "where git stops calling a
    # prefix ambiguous" for the identically-shaped problem one script over).
    MIN_SHA_PREFIX = 7
    sha = args.sha.strip()
    if not re.fullmatch(r"[0-9a-fA-F]{%d,40}" % MIN_SHA_PREFIX, sha):
        print(
            f"FAIL — --sha ({sha!r}) is not a git sha (7-40 hex characters). "
            "Refusing rather than letting it reach `git log` as a flag or "
            "revision expression. (exit 2)"
        )
        return 2
    if not args.paths:
        print("FAIL — --paths is empty, so every commit would match. (exit 2)")
        return 2

    try:
        found = resolve(args.repo_dir, sha, args.paths)
    except (ValueError, RuntimeError) as exc:
        print(f"FAIL — could not resolve: {exc} (exit 2)")
        return 2

    if found is None:
        print(
            f"FAIL — no commit at or before {args.sha} touches any of {args.paths}. "
            "This service has never had a build to compare against. (exit 2)"
        )
        return 2

    print(found)
    return 0


# ── self-test ────────────────────────────────────────────────────────────────


def _self_test() -> int:
    import os
    import tempfile

    failures: list[str] = []
    git_env = {
        **os.environ,
        "GIT_AUTHOR_NAME": "t",
        "GIT_AUTHOR_EMAIL": "t@t",
        "GIT_COMMITTER_NAME": "t",
        "GIT_COMMITTER_EMAIL": "t@t",
    }

    def run(repo: str, *args: str) -> subprocess.CompletedProcess:
        return subprocess.run(
            ["git", "-C", repo, *args],
            capture_output=True,
            text=True,
            check=True,
            env=git_env,
        )

    def commit(repo: str, path: str, message: str) -> str:
        import os

        full = os.path.join(repo, path)
        os.makedirs(os.path.dirname(full) or repo, exist_ok=True)
        with open(full, "a") as f:
            f.write(message + "\n")
        run(repo, "add", path)
        run(repo, "commit", "-m", message)
        return run(repo, "rev-parse", "HEAD").stdout.strip()

    def case(name: str, got, want) -> None:
        ok = got == want
        print(f"  [{'ok' if ok else 'FAIL'}] {name}: got {got!r}, want {want!r}")
        if not ok:
            failures.append(f"{name}: got {got!r}, want {want!r}")

    print("== resolve_watched_commit self-test (a real git repo on disk)")
    with tempfile.TemporaryDirectory() as repo:
        run(repo, "init", "-q")
        run(repo, "checkout", "-q", "-b", "main")

        gw_sha = commit(repo, "apps/api-gateway/src/x.ts", "touch gateway")
        docs_sha = commit(repo, "README.md", "docs only")
        also_docs_sha = commit(repo, "CLAUDE.md", "more docs")

        case(
            "a docs-only tip resolves back to the last commit that touched the service",
            resolve(repo, also_docs_sha, ["apps/api-gateway"]),
            gw_sha,
        )
        case(
            "the tip itself touching the service resolves to itself",
            resolve(repo, gw_sha, ["apps/api-gateway"]),
            gw_sha,
        )
        case(
            "an intermediate docs commit still resolves to the earlier real change",
            resolve(repo, docs_sha, ["apps/api-gateway"]),
            gw_sha,
        )
        case(
            # THE case this file exists for on the failure side: nothing in
            # history touches the path asked about, and that must come back as
            # "cannot resolve", never an empty string a caller could mistake for
            # a match.
            "no commit anywhere touches an unrelated path -- fails closed, not empty-string-as-pass",
            resolve(repo, also_docs_sha, ["apps/mobile"]),
            None,
        )
        case(
            "any one of several patterns matching is enough",
            resolve(repo, also_docs_sha, ["apps/mobile", "apps/api-gateway", "pnpm-lock.yaml"]),
            gw_sha,
        )

        # THE case this file exists for on the merge-commit side (CORRECTED --
        # found live, PR #291's own correctness audit): a real `git merge
        # --no-ff` commit M whose tree, for the watched path, is TREESAME to
        # its side-branch parent. Without --first-parent, git's default
        # history simplification skips M entirely and resolves to the
        # side-branch commit S -- a commit that was never `main`'s pushed
        # head and that Railway never built from. Reproduced here with a real
        # merge, not asserted.
        run(repo, "checkout", "-q", "-b", "feature", also_docs_sha)
        side_sha = commit(repo, "apps/api-gateway/src/y.ts", "feature-branch gateway change")
        run(repo, "checkout", "-q", "main")
        run(
            repo, "-c", "user.name=t", "-c", "user.email=t@t",
            "merge", "--no-ff", "-m", "merge feature", "feature",
        )
        merge_sha = run(repo, "rev-parse", "HEAD").stdout.strip()
        case(
            "a real merge commit resolves to ITSELF, not the side-branch commit "
            "history simplification would silently substitute",
            resolve(repo, merge_sha, ["apps/api-gateway"]),
            merge_sha,
        )
        # And the failure this guards against, made concrete: prove side_sha is
        # what git's DEFAULT (non-first-parent) traversal would have returned,
        # so the assertion above is known to be testing something real.
        default_traversal = subprocess.run(
            ["git", "-C", repo, "log", "-1", "--format=%H", merge_sha, "--", "apps/api-gateway"],
            capture_output=True, text=True, check=True,
        ).stdout.strip()
        case(
            "sanity: git's default (non-first-parent) traversal really would "
            "have returned the side-branch commit, proving the fix is load-bearing",
            default_traversal,
            side_sha,
        )

        # The CLI path, not just the pure function -- proves argv wiring and exit
        # codes, the same distinction check_deployed_sha.py's own self-test draws.
        cli_ok = _run_cli(["--sha", also_docs_sha, "--paths", "apps/api-gateway", "--repo-dir", repo])
        case("CLI: resolves and prints the sha, exit 0", (cli_ok.returncode, cli_ok.stdout.strip()), (0, gw_sha))

        cli_no_paths = _run_cli(["--sha", also_docs_sha, "--repo-dir", repo])
        case("CLI: an empty --paths is CANNOT CHECK, exit 2, not a silent pass", cli_no_paths.returncode, 2)

        cli_no_match = _run_cli(["--sha", also_docs_sha, "--paths", "apps/mobile", "--repo-dir", repo])
        case("CLI: no matching commit is CANNOT CHECK, exit 2", cli_no_match.returncode, 2)

        # Hardening case (found live, PR #291's own security audit): --sha is
        # placed before -- in the underlying git log call, so an unvalidated
        # flag-shaped value would reach git as one.
        cli_flag_sha = _run_cli(["--sha", "--all", "--paths", "apps/api-gateway", "--repo-dir", repo])
        case("CLI: a flag-shaped --sha is refused, not passed through to git", cli_flag_sha.returncode, 2)

    if failures:
        print("\nFAIL — self-test found:")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("\nPASS — resolution, fail-closed-on-no-match, and the CLI all hold.")
    return 0


def _run_cli(args: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, __file__, *args], capture_output=True, text=True, check=False
    )


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

#!/usr/bin/env python3
"""Is mudavym.com serving the web build it should be? (ADR 0219)

WHY THIS EXISTS
---------------
On 2026-09-21 two production merges (#421, #424) were refused by Vercel's
`api-deployments-free-per-day` cap. mudavym.com kept serving #418's build for
hours, and nothing noticed: `.github/workflows/deploy.yml`'s Stage 3 was
written to check the web only for HTTP 200 (the previous build answers 200
perfectly), and with VERCEL_PRODUCTION_URL unset it was skipped outright; no
web code embedded a commit id anywhere a check could read. That is the exact
"a liveness 200 proves *a* process is up, never WHICH build" fault
`check_deployed_sha.py` already closed for the gateway (ADR 0097), one
service over, for a static site instead of a running process.

The web build now writes `<meta name="mudavym:commit" content="…">` into
every page it serves (apps/web/src/lib/build-provenance.ts). This script
reads that tag back with a plain GET and turns it into a verdict.

WHY A RANGE, NOT "running == the sha that was pushed"
------------------------------------------------------
The Vercel project that serves mudavym.com has no Ignored Build Step
(apps/web/vercel.json carries no `ignoreCommand`), so Vercel builds EVERY
push to main, docs-only pushes included. When one of those builds is refused
(the 2026-09-21 cap) or fails, production keeps the previous build. If the
refused push touched nothing the web build reads, the served page is what it
would have been anyway, and the criterion of the option the founder chose
still holds: the check "fails when it differs from the latest web change on
main" (ADR 0219; the asking session wrote that wording, he selected it). So
this script resolves FLOOR, the newest commit at-or-before `--sha` that
touches a path the web build reads (`resolve_watched_commit.resolve()`, the
resolver Stage 2 uses for the gateway), and requires
`FLOOR ⪯ running ⪯ tip(main)`. Stage 2 asserts `running == FLOOR` for the
gateway instead; that fits Railway, which rebuilds only on watched paths, and
would fail here on every docs-only merge that Vercel did build.

tip(main), AND A MAIN THAT MOVES DURING THE CHECK
-------------------------------------------------
`--tip` defaults to `--sha`. deploy.yml passes a freshly fetched origin/main
plus `--refresh-remote origin`. With a refresh remote set, a served commit
that is not an ancestor of tip (typically a merge that landed, and that
Vercel built, while this check waited) triggers one `git fetch` of main and a
re-classification against the new tip before it can be called DIVERGENT.
Without that, every merge landing during another merge's audit would turn the
earlier audit red. A commit that is still off main after the refresh stays
DIVERGENT.

WHAT EACH OUTCOME MEANS
------------------------
  MATCH           running IS tip(main).                                    exit 0
  UNCHANGED       running IS FLOOR, and FLOOR != tip(main): nothing
                  web-affecting has landed since this build, so nothing
                  was expected to change. Correct, not stale.              exit 0
  SUPERSEDED      FLOOR < running < tip(main): a LATER web-affecting
                  merge already redeployed since this check was asked
                  to run. Also correct.                                    exit 0
  STALE           running predates FLOOR: mudavym.com has NOT picked up
                  a web-affecting commit that should already be live.
                  This is the exact shape of the 2026-09-21 defect.        exit 1
  PAGE_MALFORMED  the page answered 200 but without a single, readable
                  mudavym:commit tag (missing, empty, or two tags that
                  disagree) — the route moved, or something else is
                  answering in its place. Retrying will not fix this,
                  so polling stops immediately.                            exit 2
  NETWORK_UNREACHABLE  the host never answered 200 at all (timeout,
                  connection refused, a non-200 status). Transient by
                  nature, so polling continues to the deadline.            exit 2
  UNKNOWN_MARKER  production reports the literal build-time marker
                  "unknown": a build ran, but no VERCEL_GIT_COMMIT_SHA /
                  RAILWAY_GIT_COMMIT_SHA / git checkout reached it.        exit 3
  DIVERGENT       running is a real commit this checkout knows about,
                  but it is NOT an ancestor of tip(main) — production is
                  serving something off the branch this check trusts (a
                  foreign alias, a stale preview promoted by hand, a
                  shallow clone that never fetched the real history).      exit 4
  CANNOT_RESOLVE  FLOOR or tip(main) could not be resolved at all before
                  any polling started — bad arguments, an unfetched
                  history, or an inconsistent FLOOR/--tip pair — or git
                  itself failed while classifying mid-poll. Exit 5
                  blocks exactly like a failure, same rule as every
                  other "cannot check" state in this repo (never a
                  silent pass — see absence-reported-as-health).           exit 5

Every non-zero exit blocks the caller exactly the same way — the distinct
numbers are for a human or a workflow log to tell the failure classes apart
at a glance, never a hint that some of them matter less.

USAGE
-----
    python3 scripts/check_web_deployed_sha.py \\
        --url https://mudavym.com/ \\
        --sha "$PUSHED_SHA" \\
        [--tip "$(git rev-parse origin/main)"] [--refresh-remote origin] \\
        [--paths ...] [--repo-dir .] [--timeout-seconds 600] [--poll-seconds 15]
    python3 scripts/check_web_deployed_sha.py --print-floor --sha "$PUSHED_SHA"
    python3 scripts/check_web_deployed_sha.py --check-paths

The default `--paths` (DEFAULT_PATHS below, the one list deploy.yml uses for
both FLOOR and the check) are what the web build reads: apps/web itself; its
one workspace dependency (`@wineops/ui`, packages/ui); the lockfile,
workspace manifest and root package.json the install resolves; turbo.json
(the buildCommand is `turbo run build --filter=@wineops/web`); and the two
gateway files the web bundle imports directly
(apps/web/src/pages/inventory/command/ReceivingWorkspace.tsx imports
apps/api-gateway/src/procurement/price-currency.ts, which imports
apps/api-gateway/src/common/iso-4217.ts; turbo.json lists the same two as
globalDependencies). A path missing from this list lets a stale build pass,
so `--check-paths` exits 1 when a non-test source file under apps/web or
packages/ui reaches, by relative import (followed transitively), a file this
list does not cover, or when a listed path no longer exists. A CLAIMS row
runs it on every pull request.

`--timeout-seconds` defaults to 600s (10 minutes): Vercel's measured median
web build was 72s (`vercel ls`, 2026-09-22: 19 READY builds, mean 69s, max 104s), and 600s
leaves generous room for queueing — the exact failure mode two Hobby-cap
refusals on 2026-09-21 showed can happen at all.

SELF-TEST
---------
Builds a real, throwaway git repository on disk (the same technique
`resolve_watched_commit.py --self-test` uses), a clone of it (to prove the
tip refresh against a real `git fetch`), a synthetic source tree (for
`--check-paths`) AND a real HTTP server on localhost, and drives every state
above through the real `poll()`/`classify_commit()` path — including STALE,
DIVERGENT and SUPERSEDED, the three cases that would otherwise never be
exercised until a deploy actually went wrong — and then through the CLI, so
the exit code deploy.yml acts on is asserted, not only the state behind it.

    python3 scripts/check_web_deployed_sha.py --self-test
"""

from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import resolve_watched_commit  # noqa: E402  (sys.path must be set first)

# The literal name build-provenance.ts writes. Kept as a constant so the
# self-test can assert it has not drifted from the TS source of truth rather
# than the two ever being allowed to silently disagree.
COMMIT_META_NAME = "mudavym:commit"

# Must equal apps/web/src/lib/build-provenance.ts's UNKNOWN_COMMIT. Same
# reason: the self-test cross-checks this against the TS file's own text.
UNKNOWN_COMMIT = "unknown"

# Every path the web build reads. See the USAGE section above for why each one
# is here; `--check-paths` fails when the web's own imports outgrow it.
DEFAULT_PATHS = [
    "apps/web",
    "packages/ui",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "package.json",
    "turbo.json",
    "apps/api-gateway/src/procurement/price-currency.ts",
    "apps/api-gateway/src/common/iso-4217.ts",
]

# Where a web-bundle import graph starts: every non-test source file here.
IMPORT_ROOTS = ["apps/web", "packages/ui"]

# A git sha as a page may report it: hex, 7 to 40 characters. Anything else is
# refused before it reaches a git argument list (an option-shaped value such
# as "--output=x" must never be handed to `git cat-file`).
_SHA_RE = re.compile(r"[0-9a-fA-F]{7,40}")

# Shortest prefix accepted as identifying a revision at all — mirrors
# check_deployed_sha.py's own MIN_PREFIX (its docstring: "where git itself
# stops calling a prefix ambiguous"). A shorter value is refused before it
# ever reaches git, rather than trusted to whatever git's own ambiguity
# threshold happens to be for a given repository size.
MIN_PREFIX = 7

MATCH = "MATCH"
UNCHANGED = "UNCHANGED"
SUPERSEDED = "SUPERSEDED"
STALE = "STALE"
PAGE_MALFORMED = "PAGE_MALFORMED"
NETWORK_UNREACHABLE = "NETWORK_UNREACHABLE"
UNKNOWN_MARKER = "UNKNOWN_MARKER"
DIVERGENT = "DIVERGENT"
CANNOT_RESOLVE = "CANNOT_RESOLVE"

EXIT_FOR = {
    MATCH: 0,
    UNCHANGED: 0,
    SUPERSEDED: 0,
    STALE: 1,
    PAGE_MALFORMED: 2,
    NETWORK_UNREACHABLE: 2,
    UNKNOWN_MARKER: 3,
    DIVERGENT: 4,
    CANNOT_RESOLVE: 5,
}

# States a poll loop must not keep retrying past: the answer will not change
# by asking again within the deadline, because the fault is structural
# (wrong route/response shape), not a deploy still in flight.
TERMINAL_STATES = {PAGE_MALFORMED}


# ── reading the page ────────────────────────────────────────────────────────

_META_TAG_RE = re.compile(r"<meta\b[^>]*>", re.IGNORECASE)
_NAME_ATTR_RE = re.compile(r"""\bname\s*=\s*(?:"([^"]*)"|'([^']*)')""", re.IGNORECASE)
_CONTENT_ATTR_RE = re.compile(r"""\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)')""", re.IGNORECASE)


def extract_meta_commit(html: str) -> tuple[str | None, str]:
    """Read the mudavym:commit tag out of a served HTML page.

    Attribute-order agnostic (build-provenance.ts always writes name before
    content, but nothing should depend on that): scans every <meta> tag,
    keeps the ones named mudavym:commit, and requires every one of them (if
    more than one) to agree — a page with two disagreeing tags is exactly as
    unreadable as a page with none, and silently picking one would be a
    coin-flip pass on a broken page.
    """
    values: set[str] = set()
    tag_with_empty_content = False
    for tag in _META_TAG_RE.findall(html):
        name_match = _NAME_ATTR_RE.search(tag)
        name = (name_match.group(1) or name_match.group(2)) if name_match else None
        if name != COMMIT_META_NAME:
            continue
        content_match = _CONTENT_ATTR_RE.search(tag)
        content = (content_match.group(1) or content_match.group(2) or "").strip() if content_match else ""
        if content:
            values.add(content)
        else:
            tag_with_empty_content = True
    if not values:
        if tag_with_empty_content:
            return None, f'<meta name="{COMMIT_META_NAME}"> is present but its content is empty'
        return None, f'no <meta name="{COMMIT_META_NAME}"> tag in the response'
    if len(values) > 1:
        return None, f'more than one <meta name="{COMMIT_META_NAME}"> tag, disagreeing: {sorted(values)}'
    return next(iter(values)), "found"


def fetch(url: str, timeout: float) -> tuple[int, str]:
    """One GET. Returns (status, body); status 0 means the host never answered.

    Identical shape to check_deployed_sha.py's own fetch() (down to the
    CERTIFICATE_VERIFY_FAILED note — this machine's root certificates, not
    the deployed site, is the likely culprit for that one). Not imported from
    that file on purpose: it is a private helper there, and duplicating six
    lines here is cheaper than making a deploy-audit script for the gateway
    publicly importable by a deploy-audit script for the web.
    """
    req = urllib.request.Request(url, headers={"User-Agent": "deploy-audit-web"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, resp.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as exc:
        try:
            body = exc.read().decode("utf-8", "replace")
        except Exception:  # pragma: no cover - body already consumed
            body = ""
        return exc.code, body
    except Exception as exc:
        return 0, f"{type(exc).__name__}: {exc}"


# ── git-side classification ─────────────────────────────────────────────────


def git_rev_parse(repo_dir: str, ref: str) -> str:
    """The full 40-char sha `ref` names in `repo_dir`. Raises RuntimeError if unresolvable."""
    result = subprocess.run(
        ["git", "-C", repo_dir, "rev-parse", "--verify", f"{ref}^{{commit}}"],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(f"git rev-parse could not resolve {ref!r}: {result.stderr.strip()}")
    return result.stdout.strip()


def commit_known(repo_dir: str, sha: str) -> bool:
    """True when `sha` names a real commit object this checkout has."""
    result = subprocess.run(
        ["git", "-C", repo_dir, "cat-file", "-e", f"{sha}^{{commit}}"],
        capture_output=True,
        text=True,
        check=False,
    )
    return result.returncode == 0


def is_ancestor(repo_dir: str, maybe_ancestor: str, descendant: str) -> bool:
    """True when `maybe_ancestor` is `descendant`, or an ancestor of it.

    `git merge-base --is-ancestor` is reflexive (a commit is its own
    ancestor, per git's own documentation) — that reflexivity is exactly
    what lets FLOOR == running classify as UNCHANGED rather than needing a
    separate equality branch.
    """
    result = subprocess.run(
        ["git", "-C", repo_dir, "merge-base", "--is-ancestor", maybe_ancestor, descendant],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode in (0, 1):
        return result.returncode == 0
    raise RuntimeError(
        f"git merge-base --is-ancestor {maybe_ancestor} {descendant} failed "
        f"(exit {result.returncode}): {result.stderr.strip()}"
    )


def classify_commit(repo_dir: str, reported: str, floor: str, tip: str) -> tuple[str, str]:
    """Where does the reported commit sit relative to [FLOOR, tip(main)]?

    Pure given a git repo to ask (no network, no clock) — every branch here
    is exercised directly by the self-test against a real repo, the same
    "prove the guard reaches the fault" standard resolve_watched_commit.py's
    own docstring holds itself to.
    """
    candidate = reported.strip()
    if len(candidate) < MIN_PREFIX:
        return (
            PAGE_MALFORMED,
            f'"{candidate}" is shorter than {MIN_PREFIX} characters — too short to '
            "identify a revision, so any answer would be a coin flip",
        )
    if not _SHA_RE.fullmatch(candidate):
        return (
            PAGE_MALFORMED,
            f'"{candidate[:60]}" is not a hex commit id of 7-40 characters',
        )
    if not commit_known(repo_dir, candidate):
        return (
            DIVERGENT,
            f"production reports {candidate}, which this checkout has never heard of "
            "(wrong branch, a foreign alias, or a shallow clone missing history)",
        )
    reported_sha = git_rev_parse(repo_dir, candidate)
    if not is_ancestor(repo_dir, reported_sha, tip):
        return (
            DIVERGENT,
            f"production reports {reported_sha}, which is NOT an ancestor of tip(main) "
            f"{tip} — off the branch this check trusts",
        )
    if not is_ancestor(repo_dir, floor, reported_sha):
        return (
            STALE,
            f"production reports {reported_sha}, which predates FLOOR {floor} — the "
            "last commit that should already be live. mudavym.com has not picked up "
            "a web-affecting merge.",
        )
    if reported_sha == tip:
        return MATCH, f"running {reported_sha}, exactly tip(main)"
    if reported_sha == floor:
        return (
            UNCHANGED,
            f"running {reported_sha} (= FLOOR): no web-affecting commit has landed "
            "since this build, so nothing was expected to change",
        )
    return (
        SUPERSEDED,
        f"running {reported_sha}, newer than FLOOR {floor} and at-or-before tip(main) "
        f"{tip} — a later web-affecting merge already redeployed",
    )


# ── polling ──────────────────────────────────────────────────────────────────


def poll(
    url: str,
    floor: str,
    tip: str,
    repo_dir: str,
    timeout_seconds: float,
    poll_seconds: float,
    sleep=time.sleep,
    now=time.monotonic,
    fetcher=fetch,
    refresh_tip=None,
) -> tuple[str, str]:
    """Poll the served page until it reports a build in [FLOOR, tip], or time runs out.

    `refresh_tip`, when given, is called (at most once per attempt) only when a
    served commit classifies DIVERGENT: it returns `(fresh_tip, "")` or
    `(None, why)`. A fresh tip is adopted only if it descends from the current
    one; then the attempt is classified again. This is what keeps a merge that
    lands during the check from turning this check red (see the module
    docstring, "A MAIN THAT MOVES").

    Polling is the point, same reasoning as check_deployed_sha.py: Vercel
    builds and swaps the deployment on its own schedule, so "not yet" and
    "never" look identical at any single instant. STALE, UNKNOWN_MARKER, and
    NETWORK_UNREACHABLE do NOT end the loop — during a build in flight the
    old page answers first, and treating that as final would fail every
    build that just needs a few more seconds. Only PAGE_MALFORMED ends it
    early: a structurally wrong response (the route moved, something else is
    answering) is not a timing condition, and retrying it for ten minutes
    only delays the report.
    """
    deadline = now() + timeout_seconds
    attempt = 0
    last: tuple[str, str] = (NETWORK_UNREACHABLE, f"no response from {url}")
    while True:
        attempt += 1
        status, body = fetcher(url, min(15.0, max(1.0, poll_seconds)))
        if status == 200:
            reported, why = extract_meta_commit(body)
            if reported is None:
                last = (PAGE_MALFORMED, why)
            elif reported == UNKNOWN_COMMIT:
                last = (
                    UNKNOWN_MARKER,
                    f'production reports commit="{UNKNOWN_COMMIT}": a build ran, but no '
                    "build-revision variable reached it",
                )
            else:
                last = classify_commit(repo_dir, reported, floor, tip)
                if last[0] == DIVERGENT and refresh_tip is not None:
                    fresh, why_not = refresh_tip()
                    if fresh is None:
                        last = (DIVERGENT, f"{last[1]} (refreshing tip(main) failed: {why_not})")
                    elif fresh != tip and is_ancestor(repo_dir, tip, fresh):
                        print(f"  tip(main) moved during the check: {tip} -> {fresh}")
                        tip = fresh
                        last = classify_commit(repo_dir, reported, floor, tip)
                    elif fresh != tip:
                        last = (
                            DIVERGENT,
                            f"{last[1]} (fetched tip(main) {fresh} does not descend from {tip}: "
                            "main was rewritten, so the fetched tip is not adopted)",
                        )
        elif status == 0:
            last = (NETWORK_UNREACHABLE, f"{url} did not answer — {body or 'no response'}")
        else:
            last = (NETWORK_UNREACHABLE, f"HTTP {status} from {url}")
        print(f"  attempt {attempt}: {last[0]} — {last[1]}")
        if last[0] in (MATCH, UNCHANGED, SUPERSEDED) or last[0] in TERMINAL_STATES:
            return last
        if now() >= deadline:
            return last
        sleep(poll_seconds)


_REF_NAME_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9._/-]*")


def make_refresher(repo_dir: str, remote: str, branch: str = "main"):
    """A `refresh_tip` for poll(): fetch `branch` from `remote`, return its sha."""
    if not (_REF_NAME_RE.fullmatch(remote) and _REF_NAME_RE.fullmatch(branch)):
        raise ValueError(f"refusing remote/branch names {remote!r}/{branch!r}")
    local_ref = f"refs/remotes/{remote}/{branch}"

    def refresh() -> tuple[str | None, str]:
        result = subprocess.run(
            ["git", "-C", repo_dir, "fetch", "--quiet", "--no-tags", remote, f"+refs/heads/{branch}:{local_ref}"],
            capture_output=True,
            text=True,
            check=False,
        )
        if result.returncode != 0:
            return None, result.stderr.strip() or f"git fetch exited {result.returncode}"
        try:
            return git_rev_parse(repo_dir, local_ref), ""
        except RuntimeError as exc:
            return None, str(exc)

    return refresh


# ── does DEFAULT_PATHS cover everything the web bundle imports? ─────────────

_SOURCE_EXTS = (".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".css")
_RESOLVE_SUFFIXES = ("", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".css", "/index.ts", "/index.tsx", "/index.js")
_REL_IMPORT_RE = re.compile(
    r"""(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*|@import\s*)['"](\.\.?/[^'"\n]+)['"]"""
)


def _is_test_or_tooling(rel_path: str) -> bool:
    """Files `vite build` never bundles: tests, stories, Playwright, Storybook config."""
    parts = rel_path.split("/")
    name = parts[-1]
    return (
        ".test." in name
        or ".spec." in name
        or ".stories." in name
        or "__tests__" in parts
        or "e2e" in parts
        or ".storybook" in parts
        or "node_modules" in parts
        or "dist" in parts
    )


def _covered(rel_path: str, paths: list[str]) -> bool:
    return any(rel_path == p or rel_path.startswith(p.rstrip("/") + "/") for p in paths)


def check_paths(repo_root: str, paths: list[str]) -> tuple[int, list[str], int]:
    """(exit code, problems, files scanned). 0 covered, 1 a gap, 2 cannot check.

    Starts from every non-test source file under IMPORT_ROOTS, follows every
    relative import transitively (so a gateway file the web imports is scanned
    too, and ITS imports are followed), and reports each reached file that no
    entry of `paths` covers. Also reports a listed path that no longer exists,
    since `git log -- <missing path>` would silently watch nothing.
    """
    problems: list[str] = []
    for p in paths:
        if not os.path.exists(os.path.join(repo_root, p)):
            problems.append(f"watched path {p} does not exist")
    queue: list[str] = []
    for root in IMPORT_ROOTS:
        for d, dirs, files in os.walk(os.path.join(repo_root, root)):
            dirs[:] = [x for x in dirs if x not in ("node_modules", "dist", ".turbo")]
            for f in files:
                rel = os.path.relpath(os.path.join(d, f), repo_root).replace(os.sep, "/")
                if f.endswith(_SOURCE_EXTS) and not _is_test_or_tooling(rel):
                    queue.append(rel)
    if not queue:
        return 2, [f"scanned zero source files under {IMPORT_ROOTS} in {repo_root}"], 0
    seen = set(queue)
    scanned = 0
    while queue:
        rel = queue.pop()
        scanned += 1
        try:
            text = open(os.path.join(repo_root, rel), encoding="utf-8", errors="replace").read()
        except OSError as exc:
            problems.append(f"could not read {rel}: {exc}")
            continue
        for spec in _REL_IMPORT_RE.findall(text):
            base = os.path.normpath(os.path.join(os.path.dirname(rel), spec.split("?")[0])).replace(os.sep, "/")
            target = next(
                (base + s for s in _RESOLVE_SUFFIXES if os.path.isfile(os.path.join(repo_root, base + s))),
                None,
            )
            if target is None or target in seen:
                continue
            seen.add(target)
            if not _covered(target, paths):
                problems.append(f"{rel} imports {target}, which no watched path covers")
            if target.endswith(_SOURCE_EXTS):
                queue.append(target)
    return (1 if problems else 0), problems, scanned


def resolve_floor(repo_dir: str, sha: str, paths: list[str]) -> tuple[str | None, str]:
    """FLOOR as a full sha, or (None, why). The one resolution main() and --print-floor share."""
    try:
        raw = resolve_watched_commit.resolve(repo_dir, sha, paths)
        if raw is None:
            return None, (
                f"no commit at or before {sha} touches any of {paths}; the web has never "
                "had a build to compare against"
            )
        return git_rev_parse(repo_dir, raw), ""
    except (RuntimeError, ValueError) as exc:
        return None, f"could not resolve FLOOR: {exc}"


ADVICE = {
    STALE: (
        "mudavym.com has not picked up a web-affecting commit that should already be\n"
        "live. This is the exact shape of the 2026-09-21 defect (#421, #424 refused by\n"
        "Vercel's deployment cap and never retried). Check Vercel deployments for the\n"
        "expected commit BEFORE assuming a slow build — if it is missing entirely,\n"
        "recover with Vercel's dashboard 'Create Deployment' from branch main, never a\n"
        "CLI upload from a checkout (a CLI upload sends the local disk, not the git\n"
        "tree: on 2026-09-21 the root .vercelignore's bare `logs` dropped a tracked page\n"
        "from one, since anchored by #428; see ADR 0219)."
    ),
    PAGE_MALFORMED: (
        "The page answered 200 without a single, readable mudavym:commit tag. Either\n"
        "the served build predates ADR 0219 (a pre-guard build has no tag at all — the\n"
        "same STALE condition wearing a different shape), or something else is\n"
        "answering at this URL. Fetch it by hand and read the <head>."
    ),
    NETWORK_UNREACHABLE: (
        "The host never answered 200 within the deadline. Read the reason on the line\n"
        "above rather than assuming the host is down: a non-200 status means something\n"
        "answered but not with the page; a timeout means nothing answered at all."
    ),
    UNKNOWN_MARKER: (
        'Production is running A build, but it reports commit="unknown": no build\n'
        "variable reached it. Vercel sets VERCEL_GIT_COMMIT_SHA for a git-connected\n"
        "build: check the project was not deployed from a CLI upload, and that the\n"
        "project setting exposing System Environment Variables is on. After the Railway\n"
        "move ADR 0219 names, RAILWAY_GIT_COMMIT_SHA must reach the build step. This is\n"
        "deliberately NOT a pass: an audit that accepts \"unknown\" verifies nothing\n"
        "while reporting success."
    ),
    DIVERGENT: (
        "Production is serving a commit that is not on the branch this check trusts.\n"
        "Common causes: a preview deployment was promoted to production by hand, a\n"
        "duplicate Vercel project's build got aliased to mudavym.com, or this checkout\n"
        "is shallow and never fetched the real history (this workflow's checkout step\n"
        "needs fetch-depth: 0, the same requirement Stage 2 already has for the\n"
        "gateway)."
    ),
    CANNOT_RESOLVE: (
        "FLOOR or tip(main) could not be established before any polling started, so\n"
        "this check does not know what to compare production against. Read the reason\n"
        "on the line above: it is either a git history problem (fetch-depth: 0 needed)\n"
        "or the arguments this script was called with."
    ),
}


# ── CLI ──────────────────────────────────────────────────────────────────────


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--url", default="https://mudavym.com/", help="the served page to read")
    ap.add_argument("--sha", default="", help="the sha this run was invoked for")
    ap.add_argument(
        "--tip",
        default="",
        help="tip(main) if it may have moved since --sha; defaults to --sha",
    )
    ap.add_argument("--paths", nargs="+", default=list(DEFAULT_PATHS))
    ap.add_argument("--repo-dir", default=".", help="git checkout to read (needs full history)")
    ap.add_argument("--timeout-seconds", type=float, default=600.0)
    ap.add_argument("--poll-seconds", type=float, default=15.0)
    ap.add_argument(
        "--refresh-remote",
        default="",
        help="re-fetch main from this remote when a served commit is not an ancestor of tip",
    )
    ap.add_argument("--print-floor", action="store_true", help="print FLOOR for --sha and exit")
    ap.add_argument(
        "--check-paths",
        action="store_true",
        help="exit 1 if the web bundle imports a file --paths does not cover (no network, no git)",
    )
    ap.add_argument("--self-test", action="store_true")
    args = ap.parse_args(argv)

    if args.self_test:
        return _self_test()

    if args.check_paths:
        code, problems, scanned = check_paths(args.repo_dir, args.paths)
        for p in problems:
            print(f"  - {p}")
        if code == 0:
            print(f"PASS — {scanned} files scanned; every import the web bundle reaches is watched.")
        elif code == 1:
            print("FAIL — the watched-path list does not match what the web build reads, so a")
            print("stale build could pass. Update DEFAULT_PATHS in scripts/check_web_deployed_sha.py:")
            print("add each file named above, remove each listed path that no longer exists. (exit 1)")
        else:
            print("CANNOT CHECK — nothing was scanned. (exit 2)")
        return code

    if not args.sha.strip():
        print("FAIL — --sha is empty, so FLOOR cannot be resolved. (exit 5)")
        return 5
    if not args.paths:
        print("FAIL — --paths is empty, so every commit would match. (exit 5)")
        return 5

    sha = args.sha.strip()
    floor, why = resolve_floor(args.repo_dir, sha, args.paths)
    if floor is None:
        print(f"FAIL — {why}. (exit 5)")
        return 5
    if args.print_floor:
        print(floor)
        return 0

    if not args.url.strip():
        print("FAIL — --url is empty, so there is nothing to read. (exit 5)")
        return 5
    try:
        tip = git_rev_parse(args.repo_dir, args.tip.strip() or sha)
        refresher = make_refresher(args.repo_dir, args.refresh_remote) if args.refresh_remote.strip() else None
    except (RuntimeError, ValueError) as exc:
        print(f"FAIL — could not resolve tip(main): {exc} (exit 5)")
        return 5

    try:
        floor_reaches_tip = is_ancestor(args.repo_dir, floor, tip)
    except RuntimeError as exc:
        print(f"FAIL — could not compare FLOOR against tip(main): {exc} (exit 5)")
        return 5
    if not floor_reaches_tip:
        print(
            f"FAIL — FLOOR {floor} is not an ancestor of tip(main) {tip}; refusing to "
            "check against an inconsistent range. If main has moved since --sha, pass "
            "a fresh --tip. (exit 5)"
        )
        return 5

    print(f"== Is {args.url} serving a web build between FLOOR {floor} and tip(main) {tip}?")
    try:
        state, detail = poll(
            args.url, floor, tip, args.repo_dir, args.timeout_seconds, args.poll_seconds, refresh_tip=refresher
        )
    except RuntimeError as exc:
        # A git failure mid-poll must not surface as a traceback's exit 1,
        # which is STALE's code.
        print(f"::error::CANNOT_RESOLVE — git failed while classifying: {exc}")
        print(ADVICE[CANNOT_RESOLVE])
        print("(exit 5)")
        return 5
    code = EXIT_FOR[state]
    if state in (MATCH, UNCHANGED, SUPERSEDED):
        print(f"PASS — {state}: {detail}")
        return 0
    print(f"::error::{state} — {detail}")
    print(ADVICE[state])
    print(f"(exit {code})")
    return code


# ── self-test ────────────────────────────────────────────────────────────────


def _run_cli(args: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, __file__, *args], capture_output=True, text=True, check=False
    )


def _self_test() -> int:  # noqa: C901 - a linear list of scenarios, not real branching complexity
    import tempfile
    import threading
    from http.server import BaseHTTPRequestHandler, HTTPServer

    failures: list[str] = []

    def case(name: str, got, want) -> None:
        ok = got == want
        print(f"  [{'ok' if ok else 'FAIL'}] {name}: got {got!r}, want {want!r}")
        if not ok:
            failures.append(f"{name}: got {got!r}, want {want!r}")

    # ── drift guard: this script's constants vs build-provenance.ts's ──────
    ts_path = os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "..", "apps", "web", "src", "lib", "build-provenance.ts"
    )
    try:
        ts_source = open(ts_path, encoding="utf-8").read()
    except OSError as exc:
        failures.append(f"could not read {ts_path} to check for constant drift: {exc}")
        ts_source = ""
    if ts_source:
        name_match = re.search(r"COMMIT_META_NAME\s*=\s*'([^']+)'", ts_source)
        unknown_match = re.search(r"UNKNOWN_COMMIT\s*=\s*'([^']+)'", ts_source)
        case(
            "COMMIT_META_NAME matches apps/web/src/lib/build-provenance.ts",
            name_match.group(1) if name_match else None,
            COMMIT_META_NAME,
        )
        case(
            "UNKNOWN_COMMIT matches apps/web/src/lib/build-provenance.ts",
            unknown_match.group(1) if unknown_match else None,
            UNKNOWN_COMMIT,
        )

    # ── extract_meta_commit: every reading branch, string-level ────────────
    case(
        "reads a well-formed tag",
        extract_meta_commit('<head><meta name="mudavym:commit" content="abc1234"></head>'),
        ("abc1234", "found"),
    )
    case(
        "attribute order does not matter",
        extract_meta_commit('<meta content="abc1234" name="mudavym:commit">')[0],
        "abc1234",
    )
    case(
        "single quotes are read the same as double",
        extract_meta_commit("<meta name='mudavym:commit' content='abc1234'>")[0],
        "abc1234",
    )
    case("a page with no such tag reads as missing", extract_meta_commit("<head><title>x</title></head>")[0], None)
    case(
        "a tag with empty content reads as missing, not as an empty match",
        extract_meta_commit('<meta name="mudavym:commit" content="">')[0],
        None,
    )
    case(
        "two disagreeing tags read as missing, not a coin flip",
        extract_meta_commit(
            '<meta name="mudavym:commit" content="aaa1111"><meta name="mudavym:commit" content="bbb2222">'
        )[0],
        None,
    )
    case(
        "two AGREEING tags still read as one value",
        extract_meta_commit(
            '<meta name="mudavym:commit" content="aaa1111"><meta name="mudavym:commit" content="aaa1111">'
        )[0],
        "aaa1111",
    )
    case(
        "an unrelated meta tag of the same shape is ignored",
        extract_meta_commit('<meta name="robots" content="noindex">')[0],
        None,
    )

    # ── a real, throwaway git repo — the technique resolve_watched_commit.py
    #    --self-test already uses, extended with a divergent sibling branch ──
    git_env = {
        **os.environ,
        "GIT_AUTHOR_NAME": "t",
        "GIT_AUTHOR_EMAIL": "t@t",
        "GIT_COMMITTER_NAME": "t",
        "GIT_COMMITTER_EMAIL": "t@t",
    }

    def run(repo: str, *args: str) -> subprocess.CompletedProcess:
        return subprocess.run(["git", "-C", repo, *args], capture_output=True, text=True, check=True, env=git_env)

    def commit(repo: str, path: str, message: str) -> str:
        full = os.path.join(repo, path)
        os.makedirs(os.path.dirname(full) or repo, exist_ok=True)
        with open(full, "a") as f:
            f.write(message + "\n")
        run(repo, "add", path)
        run(repo, "commit", "-m", message)
        return run(repo, "rev-parse", "HEAD").stdout.strip()

    print("== check_web_deployed_sha self-test (a real git repo + a real HTTP server)")
    with tempfile.TemporaryDirectory() as scratch_root:
        repo = os.path.join(scratch_root, "repo")
        os.makedirs(repo)
        run(repo, "init", "-q")
        run(repo, "checkout", "-q", "-b", "main")

        c1_old_web = commit(repo, "apps/web/x.ts", "touch web (old)")
        commit(repo, "README.md", "docs only")
        c3_floor = commit(repo, "apps/web/y.ts", "touch web again (this becomes FLOOR)")
        c4_tip = commit(repo, "README.md", "docs only — this is --sha")

        # A commit that is real, but never merged into main: sibling of c4,
        # unreachable from anything on the main line. The DIVERGENT case.
        run(repo, "checkout", "-q", "-b", "side", c4_tip)
        c5_divergent = commit(repo, "apps/web/z.ts", "a web change on a branch nobody merged")
        run(repo, "checkout", "-q", "main")

        c6_superseded_web = commit(repo, "apps/web/w.ts", "a LATER web change, after --sha")
        c7_later_tip = commit(repo, "README.md", "docs only — this is a fresher --tip")

        floor = git_rev_parse(repo, resolve_watched_commit.resolve(repo, c4_tip, ["apps/web"]))
        case("FLOOR resolves to the last web-touching commit at or before --sha", floor, c3_floor)

        # classify_commit: every branch, against the real repo.
        case("MATCH: running is exactly tip(main)", classify_commit(repo, c4_tip, floor, c4_tip)[0], MATCH)
        case(
            "MATCH tolerates an abbreviated sha",
            classify_commit(repo, c4_tip[:10], floor, c4_tip)[0],
            MATCH,
        )
        case("UNCHANGED: running is FLOOR, tip has moved on with no web change", classify_commit(repo, c3_floor, floor, c4_tip)[0], UNCHANGED)
        case(
            "STALE: running predates FLOOR — the 2026-09-21 shape",
            classify_commit(repo, c1_old_web, floor, c4_tip)[0],
            STALE,
        )
        case(
            "DIVERGENT: running is real but not on the trusted branch",
            classify_commit(repo, c5_divergent, floor, c4_tip)[0],
            DIVERGENT,
        )
        case(
            "DIVERGENT: an sha this checkout has never heard of at all",
            classify_commit(repo, "f" * 40, floor, c4_tip)[0],
            DIVERGENT,
        )
        case(
            "PAGE_MALFORMED: an implausibly short value is refused before it reaches git",
            classify_commit(repo, "abc12", floor, c4_tip)[0],
            PAGE_MALFORMED,
        )
        case(
            "PAGE_MALFORMED: an option-shaped value never reaches a git argument list",
            classify_commit(repo, "--output=/tmp/x", floor, c4_tip)[0],
            PAGE_MALFORMED,
        )
        case(
            "PAGE_MALFORMED: a 40-character non-hex value is refused",
            classify_commit(repo, "g" * 40, floor, c4_tip)[0],
            PAGE_MALFORMED,
        )
        # SUPERSEDED needs a FRESHER tip than --sha resolved to, simulating
        # "main moved further while this check was polling".
        case(
            "SUPERSEDED: a later web-affecting merge already redeployed",
            classify_commit(repo, c6_superseded_web, floor, c7_later_tip)[0],
            SUPERSEDED,
        )

        # CLI-level cases, exercising main()'s own argument handling and the
        # FLOOR-not-ancestor-of-tip sanity guard.
        cli_ok = _run_cli(
            ["--sha", c4_tip, "--paths", "apps/web", "--repo-dir", repo, "--url", "http://127.0.0.1:1", "--timeout-seconds", "0", "--poll-seconds", "0"]
        )
        # Port 1 refuses instantly, so this exercises NETWORK_UNREACHABLE end-to-end via the real CLI.
        case("CLI: an unreachable URL is NETWORK_UNREACHABLE, exit 2", cli_ok.returncode, 2)

        cli_no_sha = _run_cli(["--repo-dir", repo])
        case("CLI: an empty --sha is CANNOT_RESOLVE, exit 5, not a silent pass", cli_no_sha.returncode, 5)

        cli_no_paths = _run_cli(["--sha", c4_tip, "--paths", "apps/mobile", "--repo-dir", repo])
        case("CLI: no matching watched path is CANNOT_RESOLVE, exit 5", cli_no_paths.returncode, 5)

        cli_inconsistent = _run_cli(
            ["--sha", c6_superseded_web, "--tip", c5_divergent, "--paths", "apps/web", "--repo-dir", repo]
        )
        case(
            "CLI: a --tip that FLOOR cannot reach is refused as inconsistent, exit 5",
            cli_inconsistent.returncode,
            5,
        )

        cli_floor = _run_cli(["--print-floor", "--sha", c4_tip, "--paths", "apps/web", "--repo-dir", repo])
        case(
            "CLI: --print-floor prints the same FLOOR the check uses, exit 0",
            (cli_floor.returncode, cli_floor.stdout.strip()),
            (0, c3_floor),
        )

        # ── --check-paths, on a synthetic tree (never the enclosing checkout) ──
        tree = os.path.join(scratch_root, "tree")

        def write(rel: str, text: str) -> None:
            full = os.path.join(tree, rel)
            os.makedirs(os.path.dirname(full), exist_ok=True)
            with open(full, "w") as f:
                f.write(text)

        write("apps/web/src/Page.tsx", "import { rung } from '../../api-gateway/src/money/rung'\n")
        write("apps/api-gateway/src/money/rung.ts", "import { iso } from '../common/iso'\nexport const rung = iso\n")
        write("apps/api-gateway/src/common/iso.ts", "export const iso = 1\n")
        write("apps/web/src/Page.test.tsx", "import { x } from '../../api-gateway/src/test-only/x'\n")
        write("apps/api-gateway/src/test-only/x.ts", "export const x = 1\n")
        write("packages/ui/src/index.tsx", "export const Button = 1\n")
        both = ["apps/web", "packages/ui", "apps/api-gateway/src/money/rung.ts", "apps/api-gateway/src/common/iso.ts"]
        case("check_paths: every reached file watched is exit 0", check_paths(tree, both)[0], 0)
        case(
            "check_paths: a transitive import (rung.ts -> iso.ts) left unwatched is exit 1",
            check_paths(tree, both[:3])[0],
            1,
        )
        case(
            "check_paths: a direct import left unwatched is exit 1",
            check_paths(tree, ["apps/web", "packages/ui"])[0],
            1,
        )
        case(
            "check_paths: a test file's import is not part of the bundle",
            any("test-only" in p for p in check_paths(tree, ["apps/web", "packages/ui"])[1]),
            False,
        )
        case(
            "check_paths: a listed path that no longer exists is exit 1",
            check_paths(tree, both + ["apps/api-gateway/src/renamed.ts"])[0],
            1,
        )
        case(
            "check_paths: an empty tree is CANNOT CHECK, exit 2, never a pass",
            check_paths(os.path.join(scratch_root, "empty"), both)[0],
            2,
        )

        # ── a real HTTP server, for the end-to-end poll() path ──────────────
        state_holder = {"body": "", "status": 200}

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):  # noqa: N802 - stdlib naming
                payload = state_holder["body"].encode()
                self.send_response(state_holder["status"])
                self.send_header("Content-Type", "text/html")
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)

            def log_message(self, *_args):  # silence default stderr logging
                pass

        server = HTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        origin = f"http://127.0.0.1:{server.server_address[1]}/"

        def page(commit_value: str) -> str:
            return f'<!doctype html><html><head><meta name="mudavym:commit" content="{commit_value}"></head></html>'

        def poll_once(body: str, status: int, floor_c: str, tip_c: str):
            state_holder["body"] = body
            state_holder["status"] = status
            return poll(origin, floor_c, tip_c, repo, timeout_seconds=0, poll_seconds=0, sleep=lambda _s: None)

        got_state, _ = poll_once(page(c4_tip), 200, floor, c4_tip)
        case("poll(): a served MATCH page ends the loop at exit 0", (got_state, EXIT_FOR[got_state]), (MATCH, 0))

        got_state, _ = poll_once(page(c1_old_web), 200, floor, c4_tip)
        case("poll(): a served STALE page reports exit 1", (got_state, EXIT_FOR[got_state]), (STALE, 1))

        got_state, _ = poll_once("<head><title>moved</title></head>", 200, floor, c4_tip)
        case("poll(): a page with no tag at all is PAGE_MALFORMED, exit 2", (got_state, EXIT_FOR[got_state]), (PAGE_MALFORMED, 2))

        got_state, _ = poll_once("", 502, floor, c4_tip)
        case("poll(): a 502 is NETWORK_UNREACHABLE, exit 2", (got_state, EXIT_FOR[got_state]), (NETWORK_UNREACHABLE, 2))

        got_state, _ = poll_once(page(UNKNOWN_COMMIT), 200, floor, c4_tip)
        case(
            'poll(): commit="unknown" is UNKNOWN_MARKER, exit 3 — never a pass',
            (got_state, EXIT_FOR[got_state]),
            (UNKNOWN_MARKER, 3),
        )

        got_state, _ = poll_once(page(c5_divergent), 200, floor, c4_tip)
        case("poll(): a served DIVERGENT commit reports exit 4", (got_state, EXIT_FOR[got_state]), (DIVERGENT, 4))

        got_state, _ = poll_once(page(c6_superseded_web), 200, floor, c7_later_tip)
        case("poll(): a served SUPERSEDED commit passes, exit 0", (got_state, EXIT_FOR[got_state]), (SUPERSEDED, 0))

        got_state, _ = poll_once(page(c3_floor), 200, floor, c4_tip)
        case("poll(): a served UNCHANGED commit passes, exit 0", (got_state, EXIT_FOR[got_state]), (UNCHANGED, 0))

        # main() end to end, as deploy.yml runs it. The step passes or fails on
        # main()'s exit code, and every case above reads poll()'s or
        # EXIT_FOR's value instead: with only those, main() could report
        # STALE as a pass and this self-test stayed green (mutation-tested
        # at the last call, 2026-09-22).
        for served, want_code, label in (
            (page(c4_tip), 0, "MATCH"),
            (page(c1_old_web), 1, "STALE"),
            ("<head><title>moved</title></head>", 2, "PAGE_MALFORMED"),
            (page(UNKNOWN_COMMIT), 3, "UNKNOWN_MARKER"),
            (page(c5_divergent), 4, "DIVERGENT"),
        ):
            state_holder["body"] = served
            state_holder["status"] = 200
            cli_served = _run_cli(
                ["--sha", c4_tip, "--paths", "apps/web", "--repo-dir", repo, "--url", origin,
                 "--timeout-seconds", "0", "--poll-seconds", "0"]
            )
            case(f"CLI end to end: a served {label} page exits {want_code}", cli_served.returncode, want_code)

        # ── main moves DURING the check: a real clone, a real `git fetch` ──
        # The clone is the CI checkout (tip frozen at c7); a merge then lands
        # on origin (c8) and "Vercel" serves it before the check polls.
        clone = os.path.join(scratch_root, "clone")
        subprocess.run(["git", "clone", "-q", repo, clone], capture_output=True, text=True, check=True, env=git_env)
        c8_landed_late = commit(repo, "README.md", "docs only — merged while the audit was waiting")

        def poll_clone(served: str, refresher):
            state_holder["body"] = page(served)
            state_holder["status"] = 200
            return poll(
                origin, floor, c7_later_tip, clone, timeout_seconds=0, poll_seconds=0,
                sleep=lambda _s: None, refresh_tip=refresher,
            )[0]

        case(
            "moving main, no refresh: a merge newer than the frozen tip reads DIVERGENT",
            poll_clone(c8_landed_late, None),
            DIVERGENT,
        )
        case(
            "moving main, refresh: one git fetch finds the new tip, the audit passes",
            poll_clone(c8_landed_late, make_refresher(clone, "origin", "main")),
            MATCH,
        )
        case(
            "refresh does not launder a commit that is off main after fetching",
            poll_clone(c5_divergent, make_refresher(clone, "origin", "main")),
            DIVERGENT,
        )
        case(
            "a refresh that fails stays DIVERGENT (never a pass)",
            poll_clone(c8_landed_late, lambda: (None, "fetch refused")),
            DIVERGENT,
        )
        case(
            "a fetched tip that does not descend from the old one (main rewritten) is not adopted",
            poll_clone(c5_divergent, lambda: (c5_divergent, "")),
            DIVERGENT,
        )
        try:
            make_refresher(clone, "--upload-pack=x", "main")
            refused = False
        except ValueError:
            refused = True
        case("an option-shaped remote name is refused", refused, True)

        # The self-test must be able to fail — a guard whose own test cannot
        # go red is the same fault one level up (checks-cannot-see-their-own-removal).
        sanity_state, _ = classify_commit(repo, c1_old_web, floor, c4_tip)
        if sanity_state != STALE:
            failures.append("classify_commit() no longer reports STALE for a build older than FLOOR")

        server.shutdown()

    if failures:
        print("\nFAIL — self-test found:")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("\nPASS — every state reachable (MATCH/UNCHANGED/SUPERSEDED/STALE/PAGE_MALFORMED/")
    print("NETWORK_UNREACHABLE/UNKNOWN_MARKER/DIVERGENT/CANNOT_RESOLVE), stale and divergent included.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

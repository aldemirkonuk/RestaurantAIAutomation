#!/usr/bin/env python3
"""Is production running the build that the merge SHOULD have produced?

WHY THIS EXISTS
---------------
`deploy.yml` polled the gateway until it saw a 200 and then reported the deploy
verified. The previous instance answers 200 perfectly, so a green audit during a
FAILED deploy was indistinguishable from a good one. Every "deployed and healthy"
claim in this repository rested on that.

The gateway now names its build (`/api/v1/health/live` -> `commit`, `bootedAt`;
see apps/api-gateway/src/health/build-provenance.ts). This turns that payload
into a verdict: poll until the reported `commit` is the build this service ought
to be running, or fail saying which revision is actually serving.

WHY `running == merged` IS THE WRONG QUESTION (ADR 0101)
-------------------------------------------------------
The first version of this script asked exactly that, and it was red by
construction on ordinary merges.

Railway rebuilds a service only when a push touches that service's
`watchPatterns` (`.railway/railway.ts`). `@wineops/api-gateway` watches
`/apps/api-gateway/**` and the three root workspace files. So a merge that
changes only, say, `.planning/decisions/OPEN-DECISIONS.md` correctly does NOT
rebuild the gateway — and the running build stays at the newest commit that DID
touch a watched path. Measured on 2026-09-03: of the twelve merges since the sha
comparison landed, the three that touched no watched path failed this check and
the nine that did passed. A 3-of-3 false-failure rate on docs-only merges, and
the failing message named the correct running build while calling it a mismatch.

Two shapes produced it, both visible inside one run (#235, run 33704594104):

  attempts  1-16   running 07698dee  -- the newest WATCHED ANCESTOR of the merge
  attempts 17-61   running bc0b1498  -- a later merge that SUPERSEDED it mid-poll

Both are correct production states. Skipping the check for such merges would be
the opposite error and is not what happens here: the question is restated, not
dropped.

THE ASSERTION THIS MAKES INSTEAD
--------------------------------
Let M be the merged sha, TIP the current tip of main, and

    FLOOR = the newest commit in M's first-parent history (M itself included)
            whose diff touches this service's watchPatterns

FLOOR is the build Railway owed us for M. The running build R is accepted when

    FLOOR  <=  R  <=  TIP        (<= meaning "is an ancestor of, or equal to")

- R == M                      -> MATCH        the merged build is serving
- FLOOR <= R  <  M            -> UNCHANGED    M touched nothing this service
                                              watches; R is the build M implies
- M  <  R    <= TIP           -> SUPERSEDED   a later merge won the race
- R  <  FLOOR                 -> MISMATCH     the build for FLOOR did not land.
                                              THE case this file exists for: it
                                              is unchanged by any of the above.
- R not an ancestor of TIP    -> MISMATCH     something not on main is serving

When M itself touches a watched path, FLOOR == M and the window collapses to
"R == M or a descendant" — i.e. the original strict check, for exactly the
merges the original check was right about.

WHAT EACH OUTCOME MEANS
-----------------------
  MATCH / UNCHANGED / SUPERSEDED  the right build is serving.            exit 0
  MISMATCH   something is serving, and it is the WRONG build. The
             deploy did not land, or landed and rolled back.             exit 1
  UNKNOWN    the process is up but cannot say which build it is —
             no revision variable reached it. Not a pass: an audit
             that accepts "unknown" certifies its own blindness.         exit 1
  MALFORMED  the endpoint answered with something that is not the
             provenance payload. The route moved, or a proxy is
             answering in its place.                                     exit 2
  INDETERMINATE  a sha was reported and this check cannot place it —
             shallow clone, missing object, unparseable railway
             config, no watched commit in reach. Never a pass.           exit 2
  UNREACHABLE / bad arguments: the check could not run at all.           exit 2

Exit 2 is reserved for "this guard could not check what it says it checks", and
it blocks exactly like exit 1 — the repo-wide rule. A guard that passes because
it could not run is worse than no guard. Every relaxation above is a relaxation
of the QUESTION, never of the answer: no branch of this file reports success on
something it did not establish.

SELF-TEST
---------
`--self-test` is not a mock exercise. It stands up a real HTTP server on
localhost AND builds a real git repository on disk, then drives the real code
paths through every outcome above — including the mismatch, which is the case
the whole thing exists for and the one that would otherwise never be exercised
until a deploy went wrong. It also asserts the watch patterns it reads out of
the real `.railway/railway.ts`, so a config reshape fails here rather than in
production.

    python3 scripts/check_deployed_sha.py --self-test

USAGE
-----
    python3 scripts/check_deployed_sha.py \
        --url https://gateway.example.com \
        --expect "$MERGED_SHA" \
        --service '@wineops/api-gateway' \
        [--railway-config .railway/railway.ts] [--repo .] \
        [--main-ref origin/main] \
        [--timeout-seconds 600] [--poll-seconds 10]

Omit `--service` for a strict `running == expected` comparison with no git
involved — which is what a rollback wants, because after redeploying a target
the running build IS that target.

`--assume-running <sha>` answers the same question with no network at all,
classifying a sha you already have. That is how the historical false failures
are replayed in `.planning/decisions/CLAIMS.jsonl`.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request

# Accepted: the right build is serving.
MATCH = "MATCH"
UNCHANGED = "UNCHANGED"
SUPERSEDED = "SUPERSEDED"
# Rejected: the wrong build is serving, or nothing could be established.
MISMATCH = "MISMATCH"
UNKNOWN = "UNKNOWN"
MALFORMED = "MALFORMED"
UNREACHABLE = "UNREACHABLE"
INDETERMINATE = "INDETERMINATE"

ACCEPTED = (MATCH, UNCHANGED, SUPERSEDED)

# The literal the gateway reports when no build variable reached it. Must stay in
# step with UNKNOWN_COMMIT in apps/api-gateway/src/health/build-provenance.ts.
UNKNOWN_COMMIT = "unknown"

# Shortest prefix accepted as an identification. Railway reports the full 40
# characters; a runner that reports an abbreviated sha still identifies a
# revision, but seven is where git itself stops calling a prefix ambiguous.
MIN_PREFIX = 7

# How far back the first-parent walk looks for a commit touching the service's
# watched paths. Not finding one inside this window is INDETERMINATE, never a
# pass: it means no expectation could be formed.
DEFAULT_HISTORY_LIMIT = 500


class CannotCheck(Exception):
    """The question could not be answered. Always becomes INDETERMINATE/exit 2.

    Raised, never returned, so that no caller can accidentally treat it as one
    more verdict among the passing ones.
    """


# ── watch patterns: what makes Railway rebuild this service ──────────────────


def translate_pattern(pattern: str) -> tuple[re.Pattern[str], str]:
    """One Railway watchPattern -> (regex over repo-relative paths, literal prefix).

    The supported syntax is the subset this repository actually uses, and
    anything outside it raises rather than being silently reinterpreted:

        leading "/"   repo root, stripped
        "**"          any characters, "/" included
        "*"           any characters except "/"
        "?"           one character except "/"

    A pattern containing no wildcard is additionally treated as a directory
    prefix (`x` matches `x` and `x/...`), which is how Railway reads a bare
    path. That is a SUPERSET — it can only move FLOOR forward, i.e. make this
    check stricter — which is the safe direction for a guess about a platform.
    """
    raw = (pattern or "").strip()
    if not raw:
        raise CannotCheck("an empty string appears in watchPatterns")
    if raw.startswith("!"):
        # Railway supports negation; this translator does not, and a negation
        # read as a positive would silently widen FLOOR the unsafe way.
        raise CannotCheck(
            f"watchPattern {pattern!r} is a negation, which this check cannot "
            "interpret. Teach translate_pattern() about it rather than letting "
            "it be read as an ordinary pattern."
        )
    body = raw.lstrip("/")
    out: list[str] = []
    i = 0
    while i < len(body):
        ch = body[i]
        if ch == "*":
            if body[i + 1 : i + 2] == "*":
                out.append(".*")
                i += 2
            else:
                out.append("[^/]*")
                i += 1
        elif ch == "?":
            out.append("[^/]")
            i += 1
        else:
            out.append(re.escape(ch))
            i += 1
    literal_prefix = "" if any(c in body for c in "*?") else body
    return re.compile("^" + "".join(out) + "$"), literal_prefix


def path_is_watched(path: str, compiled: list[tuple[re.Pattern[str], str]]) -> bool:
    for rx, prefix in compiled:
        if rx.match(path):
            return True
        if prefix and (path == prefix or path.startswith(prefix + "/")):
            return True
    return False


SERVICE_CALL = re.compile(r"""\bservice\(\s*(['"])(?P<name>.+?)\1""")
WATCH_BLOCK = re.compile(r"watchPatterns\s*:\s*\[(?P<body>.*?)\]", re.DOTALL)
ROOT_FIELD = re.compile(r"""\broot\s*:\s*(['"])(?P<path>.*?)\1""")
QUOTED = re.compile(r"""(['"])(?P<value>.*?)\1""")


def read_watch_patterns(config_text: str, service: str) -> tuple[list[str], str]:
    """The patterns that make Railway rebuild `service`, read from railway.ts.

    Parsed rather than duplicated into the workflow on purpose: two copies of a
    deploy trigger drift, and the copy in CI would drift silently toward
    passing. If this file is reshaped so the patterns cannot be found, that is
    CannotCheck — the deploy audit stops rather than inventing an expectation.
    """
    calls = list(SERVICE_CALL.finditer(config_text))
    if not calls:
        raise CannotCheck(
            "no service(...) declarations found in the railway config — "
            "the file's shape changed and the watch patterns cannot be read"
        )
    names = [m.group("name") for m in calls]
    for index, call in enumerate(calls):
        if call.group("name") != service:
            continue
        end = calls[index + 1].start() if index + 1 < len(calls) else len(config_text)
        window = config_text[call.end() : end]
        block = WATCH_BLOCK.search(window)
        if block:
            patterns = [m.group("value") for m in QUOTED.finditer(block.group("body"))]
            if not patterns:
                raise CannotCheck(
                    f"service {service!r} declares an EMPTY watchPatterns list"
                )
            return patterns, "watchPatterns"
        root = ROOT_FIELD.search(window)
        if root and root.group("path").strip("/"):
            # No explicit patterns: Railway watches the service's root directory.
            return [root.group("path").rstrip("/") + "/**"], "root"
        # Neither: Railway rebuilds on every push, so every commit is a
        # candidate build and FLOOR collapses to the merged sha itself.
        return ["**"], "every push"
    raise CannotCheck(
        f"service {service!r} is not declared in the railway config. "
        f"Declared services: {', '.join(sorted(names))}"
    )


# ── git ──────────────────────────────────────────────────────────────────────


class Git:
    """The few history questions this check asks. Shells out; never guesses."""

    def __init__(self, repo: str = "."):
        self.repo = repo

    def run(self, *args: str) -> tuple[int, str]:
        try:
            proc = subprocess.run(
                ["git", "-C", self.repo, *args],
                capture_output=True,
                text=True,
                timeout=120,
            )
        except FileNotFoundError as exc:
            raise CannotCheck(f"git is not on PATH: {exc}") from exc
        except subprocess.TimeoutExpired as exc:
            raise CannotCheck(f"git {' '.join(args)} timed out") from exc
        return proc.returncode, (proc.stdout or "") + (proc.stderr or "")

    def require_usable(self) -> None:
        code, out = self.run("rev-parse", "--is-inside-work-tree")
        if code != 0:
            raise CannotCheck(f"{self.repo} is not a git work tree: {out.strip()}")
        code, out = self.run("rev-parse", "--is-shallow-repository")
        if code == 0 and out.strip() == "true":
            raise CannotCheck(
                "the checkout is SHALLOW, so the first-parent history this check "
                "walks is truncated and any answer would be a guess. Check out "
                "with `fetch-depth: 0`, or run `git fetch --unshallow`."
            )

    def full_sha(self, rev: str) -> str | None:
        code, out = self.run("rev-parse", "--verify", "--quiet", f"{rev}^{{commit}}")
        return out.strip() if code == 0 and out.strip() else None

    def is_ancestor(self, older: str, newer: str) -> bool:
        """True when `older` is an ancestor of `newer`, or IS `newer`."""
        code, _ = self.run("merge-base", "--is-ancestor", older, newer)
        if code in (0, 1):
            return code == 0
        raise CannotCheck(f"git could not compare {older[:12]} with {newer[:12]}")

    def fetch(self, main_ref: str) -> None:
        """Best effort. A failure is not fatal here — the caller re-reads the ref
        it already has and, if that is too old to place the running build, says
        INDETERMINATE rather than passing.

        The refspec is written out in full rather than relying on
        `remote.origin.fetch`: `git fetch origin main` updates FETCH_HEAD only
        when no fetch refspec is configured, and `actions/checkout` given a bare
        sha does not always configure one — which would leave `origin/main`
        resolving to whatever it was at clone time, silently.
        """
        if "/" not in main_ref:
            return
        remote, branch = main_ref.split("/", 1)
        self.run(
            "fetch",
            "--quiet",
            "--no-tags",
            remote,
            f"+refs/heads/{branch}:refs/remotes/{remote}/{branch}",
        )

    def first_parent_files(self, start: str, limit: int) -> list[tuple[str, list[str]]]:
        """[(sha, files changed against its first parent)], newest first.

        One `git log` rather than a `diff-tree` per commit: the walk is bounded
        but usually stops within a handful of commits, and a subprocess per
        commit turns a fast check into a slow one for no extra truth.
        """
        code, out = self.run(
            "log",
            "-m",
            "--first-parent",
            "--name-only",
            "--format=%x00%H",
            f"-n{limit}",
            start,
        )
        if code != 0:
            raise CannotCheck(f"git log failed for {start[:12]}: {out.strip()}")
        order: list[str] = []
        files: dict[str, list[str]] = {}
        current: str | None = None
        for line in out.split("\n"):
            if line.startswith("\0"):
                current = line[1:].strip()
                if current not in files:
                    order.append(current)
                    files[current] = []
                continue
            line = line.strip()
            if line and current:
                files[current].append(line)
        return [(sha, files[sha]) for sha in order]


# ── the expectation ──────────────────────────────────────────────────────────


class Expectation:
    """Which builds are correct for merged sha M, and why.

    `floor` is the build Railway owed us: the newest commit in M's first-parent
    history (M included) that touched a path this service watches. `tip` is the
    newest thing main has become, refreshed while polling because other sessions
    merge during the ten minutes this runs.
    """

    def __init__(
        self,
        git: Git,
        merged: str,
        floor: str,
        floor_touched: str,
        merged_touches: bool,
        main_ref: str,
        tip: str,
        patterns: list[str],
        pattern_source: str,
    ):
        self.git = git
        self.merged = merged
        self.floor = floor
        self.floor_touched = floor_touched
        self.merged_touches = merged_touches
        self.main_ref = main_ref
        self.tip = tip
        self.patterns = patterns
        self.pattern_source = pattern_source
        self._last_refresh = 0.0

    def describe(self) -> str:
        watched = ", ".join(self.patterns)
        if self.merged_touches:
            why = (
                f"{self.merged[:12]} touches a watched path, so Railway owes us a "
                f"build OF IT"
            )
        else:
            why = (
                f"{self.merged[:12]} touches NO watched path, so Railway correctly "
                f"does not rebuild; the build it owes us is {self.floor[:12]} "
                f"({self.floor_touched})"
            )
        return (
            f"  watched ({self.pattern_source}): {watched}\n"
            f"  {why}\n"
            f"  accepting anything from {self.floor[:12]} up to {self.main_ref} "
            f"({self.tip[:12]})"
        )

    def refresh_tip(self, min_interval: float = 30.0, now=time.monotonic) -> None:
        """Re-read main. Rate-limited: main moves during the poll, but not that
        fast, and a fetch every ten seconds is noise in the log."""
        if now() - self._last_refresh < min_interval:
            return
        self._last_refresh = now()
        self.git.fetch(self.main_ref)
        tip = self.git.full_sha(self.main_ref)
        if tip:
            self.tip = tip

    def classify(self, reported: str) -> tuple[str, str]:
        if shas_identify_same_revision(reported, self.merged):
            return MATCH, f"running the merged revision {reported}"
        running = self.git.full_sha(reported)
        if not running:
            raise CannotCheck(
                f"the gateway reports commit {reported}, which is not a commit in "
                f"this checkout — it cannot be placed against main"
            )
        if not self.git.is_ancestor(running, self.tip):
            return (
                MISMATCH,
                f"running {running[:12]}, which is NOT on {self.main_ref} "
                f"(tip {self.tip[:12]}) — something that was never merged is serving",
            )
        if self.git.is_ancestor(self.merged, running):
            return (
                SUPERSEDED,
                f"running {running[:12]}, a LATER merge than {self.merged[:12]} — "
                f"another merge landed while this audit was polling",
            )
        if self.git.is_ancestor(self.floor, running):
            return (
                UNCHANGED,
                f"running {running[:12]}; {self.merged[:12]} touches no path this "
                f"service watches, so this IS the build it owes us "
                f"(floor {self.floor[:12]}, {self.floor_touched})",
            )
        return (
            MISMATCH,
            f"running {running[:12]}, which is OLDER than {self.floor[:12]} — "
            f"the build for {self.floor[:12]} ({self.floor_touched}) never landed",
        )


def build_expectation(
    git: Git,
    merged: str,
    service: str,
    config_path: str,
    main_ref: str,
    history_limit: int = DEFAULT_HISTORY_LIMIT,
) -> Expectation:
    git.require_usable()
    try:
        with open(config_path, "r", encoding="utf-8") as fh:
            config_text = fh.read()
    except OSError as exc:
        raise CannotCheck(f"cannot read the railway config {config_path}: {exc}")
    patterns, source = read_watch_patterns(config_text, service)
    compiled = [translate_pattern(p) for p in patterns]

    merged_sha = git.full_sha(merged)
    if not merged_sha:
        raise CannotCheck(
            f"the merged sha {merged} is not a commit in this checkout — check out "
            "the audited revision with its history (`fetch-depth: 0`)"
        )

    git.fetch(main_ref)
    tip = git.full_sha(main_ref)
    if not tip:
        raise CannotCheck(
            f"{main_ref} does not resolve in this checkout, so 'is the running "
            "build on main?' has no answer here"
        )

    floor = None
    floor_touched = ""
    walked = git.first_parent_files(merged_sha, history_limit)
    for sha, files in walked:
        hit = next((f for f in files if path_is_watched(f, compiled)), None)
        if hit:
            floor, floor_touched = sha, f"it changed {hit}"
            break
    if floor is None:
        raise CannotCheck(
            f"no commit in the last {len(walked)} first-parent commits before "
            f"{merged_sha[:12]} touches any of this service's watched paths "
            f"({', '.join(patterns)}), so no build can be expected of it. Either "
            "the patterns no longer describe the service, or the history walk is "
            "too short."
        )
    return Expectation(
        git=git,
        merged=merged_sha,
        floor=floor,
        floor_touched=floor_touched,
        merged_touches=(floor == merged_sha),
        main_ref=main_ref,
        tip=tip,
        patterns=patterns,
        pattern_source=source,
    )


# ── the verdict ──────────────────────────────────────────────────────────────


def shas_identify_same_revision(reported: str, expected: str) -> bool:
    """True when the two strings name one revision.

    Either may be an abbreviation of the other, so this is a prefix comparison
    rather than equality — but never a prefix shorter than MIN_PREFIX, because
    "a" is a prefix of every sha and would make this check vacuous.
    """
    a = (reported or "").strip().lower()
    b = (expected or "").strip().lower()
    if len(a) < MIN_PREFIX or len(b) < MIN_PREFIX:
        return False
    shorter, longer = (a, b) if len(a) <= len(b) else (b, a)
    return longer.startswith(shorter)


def verdict(body: str, expected: str, expectation: "Expectation | None" = None):
    """Classify one response body against what should be serving.

    With no `expectation` this is the strict `running == expected` test, which
    is what a rollback wants. With one, it is the window described at the top of
    this file. Either way the parse and the "is it even an answer" cases are
    identical, and they are decided here — which is what lets the self-test
    reach all of them without a deploy.
    """
    try:
        payload = json.loads(body)
    except (ValueError, TypeError):
        return MALFORMED, "response body is not JSON"
    if not isinstance(payload, dict):
        return MALFORMED, "response body is not a JSON object"
    if "commit" not in payload:
        # The field being ABSENT is the fault this whole endpoint was added to
        # close, reappearing. It is never "no news".
        return MALFORMED, "payload has no `commit` field"
    reported = payload.get("commit")
    if not isinstance(reported, str) or not reported.strip():
        return MALFORMED, "`commit` is empty or not a string"
    reported = reported.strip()
    if reported == UNKNOWN_COMMIT:
        return (
            UNKNOWN,
            "the gateway is up but cannot say which build it is: no revision "
            "variable reached the process",
        )
    if expectation is None:
        if shas_identify_same_revision(reported, expected):
            return MATCH, f"running {reported}"
        return (
            MISMATCH,
            f"a DIFFERENT build is serving: running {reported}, merged {expected}",
        )
    try:
        return expectation.classify(reported)
    except CannotCheck as exc:
        return INDETERMINATE, str(exc)


def fetch(url: str, timeout: float) -> tuple[int, str]:
    """One GET. Returns (status, body); status 0 means the host never answered.

    On status 0 the body carries the transport error, because "no response" is
    not a diagnosis. Measured while pointing this at real production: a macOS
    python.org interpreter with no root certificates raises
    `CERTIFICATE_VERIFY_FAILED`, and the first version of this function reported
    that as "the host never answered" — which sends the reader to look at the
    gateway when the fault is on the machine running the check. Same shape as
    everything else here: say what actually happened, never a plausible summary.
    """
    req = urllib.request.Request(url, headers={"User-Agent": "deploy-audit"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, resp.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as exc:  # answered, but not 2xx
        try:
            body = exc.read().decode("utf-8", "replace")
        except Exception:  # pragma: no cover - body already consumed
            body = ""
        return exc.code, body
    except Exception as exc:
        return 0, f"{type(exc).__name__}: {exc}"


def poll(
    origin: str,
    expected: str,
    timeout_seconds: float,
    poll_seconds: float,
    sleep=time.sleep,
    now=time.monotonic,
    fetcher=fetch,
    expectation: "Expectation | None" = None,
) -> tuple[str, str]:
    """Poll liveness until the right build is serving, or until time runs out.

    Polling is the point: Railway builds and swaps the instance on its own
    schedule, so "not yet" and "never" look identical at any single instant. Only
    a deadline separates them.

    A MISMATCH does not end the loop — during a rolling deploy the old instance
    answers first, and treating that as final would fail every good deploy.
    Neither does INDETERMINATE, whose commonest cause is a commit newer than the
    last fetch; the tip is re-read between attempts and the next one places it. A
    MALFORMED response does end it: that is not a timing condition, and retrying
    a moved route for ten minutes only delays the report.
    """
    url = origin.rstrip("/") + "/api/v1/health/live"
    deadline = now() + timeout_seconds
    attempt = 0
    last = (UNREACHABLE, f"no response from {url}")
    while True:
        attempt += 1
        status, body = fetcher(url, min(15.0, max(1.0, poll_seconds)))
        if status == 200:
            state, detail = verdict(body, expected, expectation)
            last = (state, detail)
            if state in ACCEPTED or state == MALFORMED:
                print(f"  attempt {attempt}: {state} — {detail}")
                return last
        elif status == 0:
            why = body or "no response"
            last = (UNREACHABLE, f"{url} did not answer — {why}")
        else:
            last = (UNREACHABLE, f"HTTP {status} from {url}")
        print(f"  attempt {attempt}: {last[0]} — {last[1]}")
        if now() >= deadline:
            return last
        # main moves while this runs; re-read it so a build that is newer than
        # the last fetch is placed rather than called a mismatch.
        if expectation is not None and last[0] in (MISMATCH, INDETERMINATE):
            expectation.refresh_tip(now=now)
        sleep(poll_seconds)


EXIT_FOR = {
    MATCH: 0,
    UNCHANGED: 0,
    SUPERSEDED: 0,
    MISMATCH: 1,
    UNKNOWN: 1,
    MALFORMED: 2,
    UNREACHABLE: 2,
    INDETERMINATE: 2,
}

PASS_NOTE = {
    MATCH: "production is running the merged revision",
    UNCHANGED: (
        "production is running the build this merge implies. The merged commit "
        "touches nothing this service watches, so Railway correctly did not "
        "rebuild it — and the running build is the newest commit that did"
    ),
    SUPERSEDED: (
        "production is running a LATER main revision than the one audited. "
        "Another merge landed mid-poll; the merged commit is in what is serving"
    ),
}

ADVICE = {
    MISMATCH: (
        "Production is serving a build that is not the one this merge implies —\n"
        "read the line above for which. Either the Railway deploy failed and the\n"
        "previous instance is still up, or it rolled back, or something not on\n"
        "main is serving. Check the Railway deployment log for the commit named\n"
        "as the floor BEFORE treating main as deployed.\n"
        "\n"
        "This is NOT the 'the merge did not touch this service' case: that one is\n"
        "recognised and passes (UNCHANGED). See ADR 0101."
    ),
    UNKNOWN: (
        "The gateway answered but reported commit=\"unknown\", so no revision\n"
        "variable reached the process and this audit cannot verify anything.\n"
        "Measured 2026-09-02: production DID report a real sha, so the runtime\n"
        "path was live then — if you are seeing this, something removed it.\n"
        "Fix by setting ONE of:\n"
        "  - Railway service variable GIT_COMMIT_SHA=${{RAILWAY_GIT_COMMIT_SHA}}\n"
        "    (passed to the Docker build as an arg and baked into the image by\n"
        "     apps/api-gateway/Dockerfile), or\n"
        "  - confirm RAILWAY_GIT_COMMIT_SHA is present in the service's runtime\n"
        "    environment (it is set for services deployed from GitHub).\n"
        "This is deliberately NOT a pass. An audit that accepts \"unknown\"\n"
        "verifies nothing while reporting success."
    ),
    MALFORMED: (
        "The endpoint answered 200 with something that is not the provenance\n"
        "payload. Either /api/v1/health/live moved, or a proxy/CDN is answering\n"
        "in its place. Both mean this audit is pointed at the wrong thing."
    ),
    INDETERMINATE: (
        "A build identified itself and this check could not place it against\n"
        "main. That is not a pass and not a mismatch — it is the guard saying it\n"
        "could not do its job. Usual causes, in order:\n"
        "  shallow checkout    check out with `fetch-depth: 0`\n"
        "  unknown commit      the running sha is on no branch this clone has\n"
        "  railway config      .railway/railway.ts was reshaped and the service's\n"
        "                      watchPatterns can no longer be read\n"
        "  history limit       no commit within the walk touches a watched path"
    ),
    UNREACHABLE: (
        "The gateway never answered 200 within the deadline. Read the reason on\n"
        "the line above rather than assuming the host is down:\n"
        "  HTTP 404              the route is missing — check the api/v1 prefix\n"
        "  HTTP 502              the process is not up — the NestJS DI failure CI\n"
        "                        structurally cannot see\n"
        "  CERTIFICATE_VERIFY…   THIS machine has no root certificates; the\n"
        "                        gateway is probably fine. Common on a macOS\n"
        "                        python.org interpreter — run its\n"
        "                        `Install Certificates.command`, or point\n"
        "                        SSL_CERT_FILE at a CA bundle.\n"
        "  timed out / refused   nothing answered at that address"
    ),
}


# ── self-test ────────────────────────────────────────────────────────────────


def _git_fixture(root: str) -> dict[str, str]:
    """A REAL repository on disk with the history shape this check reasons about.

    Not a stub of git: the same `git` binary answers the same questions it will
    answer in CI. The shape is the one production actually produces — a watched
    commit, docs-only commits after it, and a commit on a branch that was never
    merged.
    """
    env = dict(
        os.environ,
        GIT_AUTHOR_NAME="t",
        GIT_AUTHOR_EMAIL="t@t",
        GIT_COMMITTER_NAME="t",
        GIT_COMMITTER_EMAIL="t@t",
        GIT_CONFIG_GLOBAL=os.path.join(root, "nonexistent-gitconfig"),
        GIT_CONFIG_SYSTEM=os.path.join(root, "nonexistent-gitconfig"),
    )

    def g(*args: str) -> str:
        proc = subprocess.run(
            ["git", "-C", root, *args], capture_output=True, text=True, env=env
        )
        if proc.returncode != 0:
            raise RuntimeError(f"git {' '.join(args)}: {proc.stderr}")
        return proc.stdout.strip()

    def commit(path: str, message: str) -> str:
        full = os.path.join(root, path)
        os.makedirs(os.path.dirname(full), exist_ok=True)
        with open(full, "a", encoding="utf-8") as fh:
            fh.write(message + "\n")
        g("add", "-A")
        g("commit", "-q", "-m", message)
        return g("rev-parse", "HEAD")

    g("init", "-q", "-b", "main")
    shas = {}
    shas["c1"] = commit("apps/api-gateway/src/main.ts", "seed the gateway")
    shas["c2"] = commit("docs/a.md", "docs only")
    shas["c3"] = commit("apps/api-gateway/src/x.ts", "change the gateway")
    # A commit on a branch that never merged: the "something not on main is
    # serving" case, which no amount of ancestry inside main can produce.
    g("checkout", "-q", "-b", "side")
    shas["side"] = commit("apps/api-gateway/src/side.ts", "gateway change, unmerged")
    g("checkout", "-q", "main")
    shas["c4"] = commit("docs/b.md", "docs only, after the gateway change")
    shas["c5"] = commit("docs/c.md", "more docs only")
    g("update-ref", "refs/remotes/origin/main", shas["c5"])
    with open(os.path.join(root, "railway.ts"), "w", encoding="utf-8") as fh:
        fh.write(
            'const a = service("@fixture/api-gateway", {\n'
            '  build: { watchPatterns: ["/apps/api-gateway/**"] },\n'
            "});\n"
            'const b = service("@fixture/other", { root: "/services/other" });\n'
        )
    return shas


def _self_test() -> int:  # noqa: C901 - a list of cases, read top to bottom
    import shutil
    import tempfile
    import threading
    from http.server import BaseHTTPRequestHandler, HTTPServer

    state = {"body": "", "status": 200}
    failures: list[str] = []

    def check(name: str, ok: bool, detail: str = "") -> None:
        print(f"  [{'ok' if ok else 'FAIL'}] {name}{(' — ' + detail) if detail else ''}")
        if not ok:
            failures.append(name + ((" — " + detail) if detail else ""))

    # ── 1. the watch patterns, read out of the REAL railway config ───────────
    print("== watch patterns (the real .railway/railway.ts)")
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    real_config = os.path.join(here, ".railway", "railway.ts")
    try:
        with open(real_config, "r", encoding="utf-8") as fh:
            real_text = fh.read()
        patterns, source = read_watch_patterns(real_text, "@wineops/api-gateway")
        check(
            "the gateway's patterns are readable and unchanged",
            source == "watchPatterns"
            and patterns
            == [
                "/apps/api-gateway/**",
                "/pnpm-lock.yaml",
                "/pnpm-workspace.yaml",
                "/package.json",
            ],
            f"{source}: {patterns}",
        )
        compiled = [translate_pattern(p) for p in patterns]
        for path, want in [
            ("apps/api-gateway/src/main.ts", True),
            ("apps/api-gateway/Dockerfile", True),
            ("pnpm-lock.yaml", True),
            ("package.json", True),
            ("apps/web/src/main.tsx", False),
            ("apps/web/package.json", False),  # only the ROOT package.json counts
            (".planning/decisions/OPEN-DECISIONS.md", False),
            ("services/agent-orchestrator/config/settings.py", False),
        ]:
            got = path_is_watched(path, compiled)
            check(f"{path} watched={got}", got == want)
        # A service that is not there, and a negation, must RAISE, not default.
        for bad_name in ("@wineops/does-not-exist",):
            try:
                read_watch_patterns(real_text, bad_name)
                check(f"unknown service {bad_name} raises", False, "it returned")
            except CannotCheck:
                check(f"unknown service {bad_name} raises", True)
        try:
            translate_pattern("!/apps/api-gateway/**")
            check("a negated pattern raises rather than being read positively", False)
        except CannotCheck:
            check("a negated pattern raises rather than being read positively", True)
    except CannotCheck as exc:
        check("the gateway's patterns are readable", False, str(exc))

    # ── 2. a real HTTP server, driven through the real polling path ──────────
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):  # noqa: N802 - stdlib naming
            if self.path != "/api/v1/health/live":
                self.send_response(404)
                self.end_headers()
                return
            payload = state["body"].encode()
            self.send_response(state["status"])
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def log_message(self, *_args):  # silence the default stderr logging
            pass

    server = HTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    origin = f"http://127.0.0.1:{server.server_address[1]}"

    def live(commit: str) -> str:
        return json.dumps(
            {"status": "ok", "commit": commit, "bootedAt": "2026-09-02T00:00:00.000Z"}
        )

    def case(
        name: str,
        body: str,
        status: int,
        merged: str,
        expect_state: str,
        expect_exit: int,
        expectation=None,
    ):
        state["body"] = body
        state["status"] = status
        got_state, detail = poll(
            origin,
            merged,
            timeout_seconds=0,
            poll_seconds=0,
            sleep=lambda _s: None,
            expectation=expectation,
        )
        got_exit = EXIT_FOR[got_state]
        check(
            f"{name}: {got_state} (exit {got_exit})",
            got_state == expect_state and got_exit == expect_exit,
            detail
            if got_state == expect_state
            else f"expected {expect_state}/{expect_exit}",
        )

    merged = "77eb7888e201b8154f0aca02d292550319c6ab04"
    old = "8bacb131aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

    print("\n== strict mode (no --service): a real server on localhost")
    case("the merged build is serving", live(merged), 200, merged, MATCH, 0)
    case("an abbreviated sha still identifies it", live(merged[:12]), 200, merged, MATCH, 0)
    # THE case this file exists for. Without it, nothing here is ever exercised
    # against a failed deploy until a deploy fails.
    case("a DIFFERENT build is serving", live(old), 200, merged, MISMATCH, 1)
    case('commit="unknown" is not a pass', live("unknown"), 200, merged, UNKNOWN, 1)
    case("a one-character commit cannot match", live("7"), 200, merged, MISMATCH, 1)
    case("the commit field is missing", '{"status":"ok"}', 200, merged, MALFORMED, 2)
    case("the body is not JSON", "<html>gateway</html>", 200, merged, MALFORMED, 2)
    case("the host answers 502", "", 502, merged, UNREACHABLE, 2)

    # ── 3. expectation mode, against a REAL git repository ───────────────────
    print("\n== expectation mode (--service): a real git repo on disk")
    root = tempfile.mkdtemp(prefix="deployed-sha-selftest-")
    try:
        sha = _git_fixture(root)
        git = Git(root)
        cfg = os.path.join(root, "railway.ts")

        def expect_for(merged_key: str) -> Expectation:
            return build_expectation(
                git, sha[merged_key], "@fixture/api-gateway", cfg, "origin/main"
            )

        e3 = expect_for("c3")  # the merge itself touched the gateway
        e4 = expect_for("c4")  # docs-only merge, one after the gateway change
        e5 = expect_for("c5")  # docs-only merge, two after
        check("a gateway merge floors on itself", e3.floor == sha["c3"], e3.floor[:12])
        check("a docs-only merge floors on the gateway commit", e4.floor == sha["c3"])
        check("...however many docs merges follow it", e5.floor == sha["c3"])

        case("the merged build is serving", live(sha["c3"]), 200, sha["c3"], MATCH, 0, e3)
        # The two shapes that were failing in production, replayed on a history
        # built for the purpose.
        case(
            "the merge touched nothing this service watches",
            live(sha["c3"]),
            200,
            sha["c4"],
            UNCHANGED,
            0,
            e4,
        )
        case(
            "a later merge superseded it mid-poll",
            live(sha["c5"]),
            200,
            sha["c4"],
            SUPERSEDED,
            0,
            e4,
        )
        # ...and the failure that must SURVIVE the relaxation.
        case(
            "the build for a gateway change never landed",
            live(sha["c1"]),
            200,
            sha["c3"],
            MISMATCH,
            1,
            e3,
        )
        case(
            "an older build than the floor, on a docs-only merge",
            live(sha["c1"]),
            200,
            sha["c4"],
            MISMATCH,
            1,
            e4,
        )
        case(
            "a build that is not on main at all",
            live(sha["side"]),
            200,
            sha["c3"],
            MISMATCH,
            1,
            e3,
        )
        case(
            "a sha this checkout has never seen",
            live("6f1a2b3c4d5e6f708192a3b4c5d6e7f809a1b2c3"),
            200,
            sha["c3"],
            INDETERMINATE,
            2,
            e3,
        )
        case(
            'commit="unknown" is still not a pass in expectation mode',
            live("unknown"),
            200,
            sha["c3"],
            UNKNOWN,
            1,
            e3,
        )

        # A shallow clone cannot answer this, and must say so rather than guess.
        shallow = tempfile.mkdtemp(prefix="deployed-sha-shallow-")
        try:
            subprocess.run(
                ["git", "clone", "-q", "--depth", "1", "file://" + root, shallow],
                capture_output=True,
                text=True,
            )
            try:
                build_expectation(
                    Git(shallow), sha["c5"], "@fixture/api-gateway", cfg, "origin/main"
                )
                check("a shallow checkout refuses to answer", False, "it answered")
            except CannotCheck as exc:
                check("a shallow checkout refuses to answer", "SHALLOW" in str(exc))
        finally:
            shutil.rmtree(shallow, ignore_errors=True)

        # A service with `root:` and no watchPatterns falls back to its directory.
        pats, src = read_watch_patterns(open(cfg, encoding="utf-8").read(), "@fixture/other")
        check(
            "root: with no watchPatterns watches that directory",
            (pats, src) == (["/services/other/**"], "root"),
            f"{src}: {pats}",
        )
    finally:
        shutil.rmtree(root, ignore_errors=True)
        server.shutdown()

    # The self-test must be able to fail. A guard whose own test cannot go red is
    # the same fault one level up.
    got_state, _ = verdict(live(old), merged)
    if got_state != MISMATCH:
        failures.append("verdict() no longer reports MISMATCH for a different build")
    if EXIT_FOR[UNCHANGED] != 0 or EXIT_FOR[MISMATCH] != 1 or EXIT_FOR[INDETERMINATE] != 2:
        failures.append("the exit code table no longer says what the docstring says")

    if failures:
        print("\nFAIL — self-test found:")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("\nPASS — every outcome reachable: the two false-failure shapes pass, and")
    print("       a deploy that did not land still fails.")
    return 0


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--url", default="", help="gateway origin, no path")
    ap.add_argument("--expect", default="", help="the sha that was merged")
    ap.add_argument(
        "--service",
        default="",
        help="railway service name; enables the watchPatterns-aware expectation. "
        "Omit for a strict running==expected comparison.",
    )
    ap.add_argument("--railway-config", default=".railway/railway.ts")
    ap.add_argument("--repo", default=".")
    ap.add_argument("--main-ref", default="origin/main")
    ap.add_argument("--history-limit", type=int, default=DEFAULT_HISTORY_LIMIT)
    ap.add_argument(
        "--assume-running",
        default="",
        help="classify this sha instead of asking the gateway (no network)",
    )
    ap.add_argument("--timeout-seconds", type=float, default=600.0)
    ap.add_argument("--poll-seconds", type=float, default=10.0)
    ap.add_argument("--self-test", action="store_true")
    args = ap.parse_args(argv)

    if args.self_test:
        return _self_test()

    # Missing input is "cannot check", never "nothing to check".
    if not args.url.strip() and not args.assume_running.strip():
        print("FAIL — --url is empty, so there is nothing to ask. (exit 2)")
        return 2
    if not args.expect.strip() or len(args.expect.strip()) < MIN_PREFIX:
        print(
            f"FAIL — --expect is empty or shorter than {MIN_PREFIX} characters, so "
            "any answer would match. (exit 2)"
        )
        return 2

    origin = args.url.strip()
    expected = args.expect.strip()

    expectation = None
    if args.service.strip():
        try:
            expectation = build_expectation(
                Git(args.repo),
                expected,
                args.service.strip(),
                args.railway_config,
                args.main_ref,
                args.history_limit,
            )
        except CannotCheck as exc:
            print(f"::error::{INDETERMINATE} — {exc}")
            print(ADVICE[INDETERMINATE])
            print(f"VERDICT={INDETERMINATE}")
            print(f"(exit {EXIT_FOR[INDETERMINATE]})")
            return EXIT_FOR[INDETERMINATE]
        print(f"== What build should {args.service.strip()} be running for {expected}?")
        print(expectation.describe())
    else:
        print(f"== Is {origin} running exactly {expected}?")

    if args.assume_running.strip():
        # No network: place a sha you already have. This is how the historical
        # false failures are replayed as executable claims.
        state, detail = verdict(
            json.dumps({"status": "ok", "commit": args.assume_running.strip()}),
            expected,
            expectation,
        )
    else:
        state, detail = poll(
            origin,
            expected,
            args.timeout_seconds,
            args.poll_seconds,
            expectation=expectation,
        )

    code = EXIT_FOR[state]
    if state in ACCEPTED:
        print(f"PASS — {PASS_NOTE[state]} ({detail}).")
    else:
        print(f"::error::{state} — {detail}")
        print(ADVICE[state])
    # One machine-readable line, on every path including the failures, so the
    # audit record says WHICH verdict rather than inferring one from the exit
    # code — three different exit-1/exit-2 states are not the same event, and a
    # record that flattens them is how ADR 0101's fault stayed invisible.
    print(f"VERDICT={state}")
    if state not in ACCEPTED:
        print(f"(exit {code})")
    return code


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

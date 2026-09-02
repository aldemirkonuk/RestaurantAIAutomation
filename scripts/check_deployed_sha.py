#!/usr/bin/env python3
"""Is production running the revision we merged?

WHY THIS EXISTS
---------------
`deploy.yml` polled the gateway until it saw a 200 and then reported the deploy
verified. The previous instance answers 200 perfectly, so a green audit during a
FAILED deploy was indistinguishable from a good one. Every "deployed and healthy"
claim in this repository rested on that.

The gateway now names its build (`/api/v1/health/live` -> `commit`, `bootedAt`;
see apps/api-gateway/src/health/build-provenance.ts). This turns that payload
into a verdict: poll until the reported `commit` IS the sha that was merged, or
fail saying which revision is actually serving.

That is the difference between proving presence and observing an absence of
complaint.

WHAT EACH OUTCOME MEANS
-----------------------
  MATCH      the running process was built from the sha we merged.       exit 0
  MISMATCH   something is serving, and it is a DIFFERENT build. The
             deploy did not land, or landed and rolled back.             exit 1
  UNKNOWN    the process is up but cannot say which build it is —
             no revision variable reached it. Not a pass: an audit
             that accepts "unknown" certifies its own blindness.         exit 1
  MALFORMED  the endpoint answered with something that is not the
             provenance payload. The route moved, or a proxy is
             answering in its place.                                     exit 2
  UNREACHABLE / bad arguments: the check could not run at all.           exit 2

Exit 2 is reserved for "this guard could not check what it says it checks", and
it blocks exactly like exit 1 — the repo-wide rule. A guard that passes because
it could not run is worse than no guard.

SELF-TEST
---------
`--self-test` is not a mock exercise. It stands up a real HTTP server on
localhost, points the real polling path at it, and asserts every outcome above
INCLUDING the mismatch — which is the case the whole thing exists for and the
one that would otherwise never be exercised until a deploy went wrong.

    python3 scripts/check_deployed_sha.py --self-test

USAGE
-----
    python3 scripts/check_deployed_sha.py \
        --url https://gateway.example.com \
        --expect "$MERGED_SHA" \
        [--timeout-seconds 600] [--poll-seconds 10]
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.request

MATCH = "MATCH"
MISMATCH = "MISMATCH"
UNKNOWN = "UNKNOWN"
MALFORMED = "MALFORMED"
UNREACHABLE = "UNREACHABLE"

# The literal the gateway reports when no build variable reached it. Must stay in
# step with UNKNOWN_COMMIT in apps/api-gateway/src/health/build-provenance.ts.
UNKNOWN_COMMIT = "unknown"

# Shortest prefix accepted as an identification. Railway reports the full 40
# characters; a runner that reports an abbreviated sha still identifies a
# revision, but seven is where git itself stops calling a prefix ambiguous.
MIN_PREFIX = 7


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


def verdict(body: str, expected: str) -> tuple[str, str]:
    """Classify one response body against the sha that was merged.

    Pure: no network, no clock. Every case in the docstring above is decided
    here, which is what makes the self-test able to reach all of them.
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
    if shas_identify_same_revision(reported, expected):
        return MATCH, f"running {reported}"
    return (
        MISMATCH,
        f"a DIFFERENT build is serving: running {reported}, merged {expected}",
    )


def fetch(url: str, timeout: float) -> tuple[int, str]:
    """One GET. Returns (status, body); status 0 means the host never answered."""
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
    except Exception:
        return 0, ""


def poll(
    origin: str,
    expected: str,
    timeout_seconds: float,
    poll_seconds: float,
    sleep=time.sleep,
    now=time.monotonic,
    fetcher=fetch,
) -> tuple[str, str]:
    """Poll liveness until it reports the merged sha, or until time runs out.

    Polling is the point: Railway builds and swaps the instance on its own
    schedule, so "not yet" and "never" look identical at any single instant. Only
    a deadline separates them.

    A MISMATCH does not end the loop — during a rolling deploy the old instance
    answers first, and treating that as final would fail every good deploy. A
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
            state, detail = verdict(body, expected)
            last = (state, detail)
            if state == MATCH:
                print(f"  attempt {attempt}: {state} — {detail}")
                return last
            if state == MALFORMED:
                print(f"  attempt {attempt}: {state} — {detail}")
                return last
        elif status == 0:
            last = (UNREACHABLE, f"no response from {url}")
        else:
            last = (UNREACHABLE, f"HTTP {status} from {url}")
        print(f"  attempt {attempt}: {last[0]} — {last[1]}")
        if now() >= deadline:
            return last
        sleep(poll_seconds)


EXIT_FOR = {
    MATCH: 0,
    MISMATCH: 1,
    UNKNOWN: 1,
    MALFORMED: 2,
    UNREACHABLE: 2,
}

ADVICE = {
    MISMATCH: (
        "Production is serving a build that is not the one merged. Either the\n"
        "Railway deploy failed and the previous instance is still up, or it\n"
        "rolled back. Check the Railway deployment log for this commit BEFORE\n"
        "treating main as deployed."
    ),
    UNKNOWN: (
        "The gateway answered but reported commit=\"unknown\", so no revision\n"
        "variable reached the process and this audit cannot verify anything.\n"
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
    UNREACHABLE: (
        "The gateway never answered 200 within the deadline. A 404 means the\n"
        "route is missing (check the api/v1 prefix); nothing at all means the\n"
        "host is down; a 502 means the process is not up — the NestJS DI failure\n"
        "CI structurally cannot see."
    ),
}


# ── self-test ────────────────────────────────────────────────────────────────


def _self_test() -> int:
    import threading
    from http.server import BaseHTTPRequestHandler, HTTPServer

    state = {"body": "", "status": 200}

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

    merged = "77eb7888e201b8154f0aca02d292550319c6ab04"
    old = "8bacb131aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    failures: list[str] = []

    def case(name: str, body: str, status: int, expect_state: str, expect_exit: int):
        state["body"] = body
        state["status"] = status
        got_state, detail = poll(
            origin, merged, timeout_seconds=0, poll_seconds=0, sleep=lambda _s: None
        )
        got_exit = EXIT_FOR[got_state]
        ok = got_state == expect_state and got_exit == expect_exit
        print(
            f"  [{'ok' if ok else 'FAIL'}] {name}: {got_state} (exit {got_exit}) — {detail}"
        )
        if not ok:
            failures.append(
                f"{name}: expected {expect_state}/exit {expect_exit}, got {got_state}/exit {got_exit}"
            )

    def live(commit: str) -> str:
        return json.dumps(
            {"status": "ok", "commit": commit, "bootedAt": "2026-09-02T00:00:00.000Z"}
        )

    print("== check_deployed_sha self-test (a real server on localhost)")
    case("the merged build is serving", live(merged), 200, MATCH, 0)
    case("an abbreviated sha still identifies it", live(merged[:12]), 200, MATCH, 0)
    # THE case this file exists for. Without it, nothing here is ever exercised
    # against a failed deploy until a deploy fails.
    case("a DIFFERENT build is serving", live(old), 200, MISMATCH, 1)
    case('commit="unknown" is not a pass', live("unknown"), 200, UNKNOWN, 1)
    case("a one-character commit cannot match", live("7"), 200, MISMATCH, 1)
    case("the commit field is missing", '{"status":"ok"}', 200, MALFORMED, 2)
    case("the body is not JSON", "<html>gateway</html>", 200, MALFORMED, 2)
    case("the host answers 502", "", 502, UNREACHABLE, 2)

    server.shutdown()

    # The self-test must be able to fail. A guard whose own test cannot go red is
    # the same fault one level up.
    got_state, _ = verdict(live(old), merged)
    if got_state != MISMATCH:
        failures.append("verdict() no longer reports MISMATCH for a different build")

    if failures:
        print("\nFAIL — self-test found:")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("\nPASS — every outcome reachable, mismatch included.")
    return 0


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--url", default="", help="gateway origin, no path")
    ap.add_argument("--expect", default="", help="the sha that was merged")
    ap.add_argument("--timeout-seconds", type=float, default=600.0)
    ap.add_argument("--poll-seconds", type=float, default=10.0)
    ap.add_argument("--self-test", action="store_true")
    args = ap.parse_args(argv)

    if args.self_test:
        return _self_test()

    # Missing input is "cannot check", never "nothing to check".
    if not args.url.strip():
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
    print(f"== Is {origin} running {expected}?")
    state, detail = poll(origin, expected, args.timeout_seconds, args.poll_seconds)
    code = EXIT_FOR[state]
    if state == MATCH:
        print(f"PASS — production is running the merged revision ({detail}).")
        return 0
    print(f"::error::{state} — {detail}")
    print(ADVICE[state])
    print(f"(exit {code})")
    return code


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

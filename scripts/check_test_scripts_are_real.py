#!/usr/bin/env python3
"""
Guard: a workspace package's `test` script must be able to FAIL.

WHAT HAPPENED
-------------
`apps/mobile` shipped this, and turbo ran it faithfully on every CI run:

    "test": "echo \"(no mobile unit tests configured)\" && exit 0"

CI was green. It had always been green. It would have stayed green through any
defect, because the script cannot report one — and four real defects lived in
that package for exactly as long as the script did: a socket client with no
caller, a connection to the wrong namespace, two subscriptions naming events
that do not exist, and a push handler nobody invoked.

The mobile package was NOT missing from CI, which is what it looked like from
the outside. It was IN CI, running, and reporting success by construction. That
is worse, because the board said the package was covered.

This is the repo's signature defect once more: machinery that structurally
cannot report failure. A spend cap whose join key matched zero rows. A revoke
that returned success on a 404. A test mocking an async method as sync. Each was
found by hand, one at a time. This guard makes one shape of it mechanical.

WHY AN ALLOWLIST, AFTER A BLOCKLIST FAILED
------------------------------------------
The first version of this guard matched *no-op shapes*: `echo`, `true`, `:`,
`exit 0`. An adversarial audit broke it in four lines, and every one of these
passed while doing nothing at all:

    "test": "npm run nothing"     -> indirection the regex never resolves
    "test": "sh -c 'exit 0'"      -> not a builtin at the top level
    "test": "#"                   -> a comment
    "test": "node -e \"\""         -> a real binary running nothing

That is the wrong shape for this problem. Enumerating ways to do nothing is
unbounded; enumerating ways to RUN TESTS is small and known. So the rule
inverted: a declared `test` script must invoke a recognised test runner.

The blocklist version would have shipped looking correct, which is the same
failure it was written to catch — a check that reports success without having
established anything.

WIDENING IS A DELIBERATE EDIT
-----------------------------
A package using a runner not in RUNNERS fails until someone adds it, in a diff,
on purpose. That is the cost of the allowlist and it is the point: the guard
cannot be satisfied by accident.

A package with NO `test` script is fine, and deliberately so: turbo skips it, no
board shows it as covered, and nothing is claimed. The lie is specific to a
script that runs, exits 0, and lets a dashboard say "passed".

Exit codes:  0 pass  |  1 a test script that cannot fail  |  2 cannot check
"""
import json
import os
import re
import sys

WORKSPACE_GLOBS = ("apps", "packages", "services")

#: Every test runner this repo may legitimately use. Matched as a whole word, so
#: `jest` matches `jest --ci` and `npx jest` but not `jestfoo`. Add to this list
#: in a diff, never by loosening the match.
RUNNERS = (
    "jest",
    "vitest",
    "mocha",
    "ava",
    "tap",
    "pytest",
    "playwright",
    "cypress",
    "karma",
    "turbo",       # a workspace root delegating to its packages
    "nest",        # `nest test`
    "tsx",
    "ts-node",
)

#: `node --test` is a runner; a bare `node` is not.
NODE_TEST = re.compile(r"\bnode\b[^&|;]*--test\b")

RUNNER_RE = re.compile(r"\b(?:" + "|".join(RUNNERS) + r")\b")

ALLOW: dict[str, str] = {}


def runs_a_test_runner(script: str) -> bool:
    """True when the script invokes something that can actually fail."""
    return bool(RUNNER_RE.search(script) or NODE_TEST.search(script))


def main() -> int:
    roots = [d for d in WORKSPACE_GLOBS if os.path.isdir(d)]
    if not roots:
        print("CANNOT CHECK — no workspace directories found (run from the repo root)")
        return 2

    checked = 0
    offenders: list[tuple[str, str]] = []
    for root in roots:
        for name in sorted(os.listdir(root)):
            pkg = os.path.join(root, name, "package.json")
            if not os.path.isfile(pkg):
                continue
            try:
                data = json.load(open(pkg, encoding="utf-8"))
            except (OSError, json.JSONDecodeError) as exc:
                print(f"CANNOT CHECK — {pkg} is unreadable: {exc}")
                return 2
            script = (data.get("scripts") or {}).get("test")
            if script is None:
                continue  # declares nothing, claims nothing
            checked += 1
            if os.path.join(root, name) in ALLOW:
                continue
            if not runs_a_test_runner(script):
                offenders.append((os.path.join(root, name), script))

    if checked == 0:
        print("CANNOT CHECK — no package declared a `test` script at all")
        return 2

    print(f"== Test scripts: {checked} package(s) declare one, {len(offenders)} run no known runner")
    if not offenders:
        print("PASS — every declared test script invokes a real test runner.")
        return 0

    print("\n== RUNS NO TEST RUNNER")
    for path, script in offenders:
        print(f"   {path}")
        print(f"      test: {script}")
    print(
        "\nFAIL — a `test` script that invokes no recognised runner reports success\n"
        "   by construction. turbo runs it, the board goes green, and the package\n"
        "   is shown as covered while nothing is exercised. apps/mobile carried\n"
        "   four real defects for as long as it carried such a script.\n"
        "   Either run a real test runner, or DELETE the script — a package with\n"
        "   no `test` key claims nothing, which is honest.\n"
        "   If the runner is legitimate and simply unlisted, add it to RUNNERS —\n"
        "   deliberately, in a diff. The allowlist is the mechanism."
    )
    return 1


if __name__ == "__main__":
    sys.exit(main())

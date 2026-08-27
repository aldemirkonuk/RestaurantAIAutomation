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

WHAT COUNTS AS UNABLE TO FAIL
-----------------------------
A `test` script whose entire body is an echo, a `true`, an `exit 0`, or a
combination — nothing that could ever exercise the package. A script that runs a
real runner (jest, vitest, pytest, node --test) can fail, and is fine.

A package with NO `test` script at all is also fine, and deliberately so: turbo
skips it, no board shows it as covered, and nothing is claimed. The lie is
specific to a script that runs, exits 0, and lets a dashboard say "passed".

Exit codes:  0 pass  |  1 a test script that cannot fail  |  2 cannot check
"""
import json
import os
import re
import sys

WORKSPACE_GLOBS = ("apps", "packages", "services")

#: Scripts that are honestly empty rather than dishonestly green. A package may
#: declare it has no tests — it may not declare that it ran them.
NOOP = re.compile(
    r"^\s*(?:"
    r"echo(?:\s+(?:\"[^\"]*\"|'[^']*'|[^&|;]*))?"
    r"|true"
    r"|:"
    r"|exit\s+0"
    r")\s*(?:&&|;|\|\|)?\s*",
)

ALLOW: dict[str, str] = {}


def is_noop(script: str) -> bool:
    """True when the whole script is echoes and exits — nothing that can fail."""
    remaining = script.strip()
    if not remaining:
        return True
    while remaining:
        m = NOOP.match(remaining)
        if not m or m.end() == 0:
            return False
        remaining = remaining[m.end() :].strip()
    return True


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
            if is_noop(script):
                offenders.append((os.path.join(root, name), script))

    if checked == 0:
        print("CANNOT CHECK — no package declared a `test` script at all")
        return 2

    print(f"== Test scripts: {checked} package(s) declare one, {len(offenders)} cannot fail")
    if not offenders:
        print("PASS — every declared test script runs something that can fail.")
        return 0

    print("\n== CANNOT FAIL")
    for path, script in offenders:
        print(f"   {path}")
        print(f"      test: {script}")
    print(
        "\nFAIL — a `test` script that only echoes and exits 0 reports success by\n"
        "   construction. turbo runs it, the board goes green, and the package is\n"
        "   shown as covered while nothing is exercised. apps/mobile carried four\n"
        "   real defects for as long as it carried such a script.\n"
        "   Either run a real test runner, or DELETE the script — a package with no\n"
        "   `test` key claims nothing, which is honest."
    )
    return 1


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""
Every route the SEO registry knows carries a credential in its PATH is also
redacted from a Sentry event URL.

Added 2026-09-21 (ADR 0040 amendment, PR #427). `error-tracking.ts` defends
`TOKEN_PATH_PREFIXES` in prose: "which routes bear a secret ... is already a
maintained fact in this repo (apps/web/src/lib/seo/routes.ts TOKEN_PREFIXES)".
That sentence is what makes the allow-list safe, and nothing re-read it — the
shape CLAUDE.md §5b exists to stop. This turns it into a command.

Scope, stated honestly: this proves the scrubber covers the SEO registry's
path-bearing routes. It does NOT prove the registry is complete. The gateway's
own public token routes are covered by `check_public_path_params` in
check_sentry_pii_scope.py, which fails the build on an unclassified one.

No node_modules, no network: CLAIMS verifies run in a bare checkout.
"""
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
WEB = REPO / "apps/web/src/lib/error-tracking.ts"
SEO = REPO / "apps/web/src/lib/seo/routes.ts"


class _CannotCheck(Exception):
    """Raised where the guard cannot verify. main() turns it into exit 2 —
    `raise SystemExit("msg")` exits 1, which reads as an ordinary failure."""


def literals(text: str, name: str) -> set[str]:
    """The quoted entries of a TS array literal, with // comments removed first —
    otherwise a trailing comment's text is captured as if it were an entry."""
    m = re.search(rf"{name}[^=]*=\s*\[(.*?)\]", text, re.S)
    if not m:
        print(f"CANNOT CHECK: {name} not found")
        raise _CannotCheck()
    body = re.sub(r"//[^\n]*", "", m.group(1))
    return set(re.findall(r"""['"](/[^'"]*)['"]""", body))


def main() -> int:
  try:
    for f in (WEB, SEO):
        if not f.exists():
            print(f"CANNOT CHECK: {f} is missing")
            return 2
    scrub = literals(WEB.read_text(encoding="utf-8"), "TOKEN_PATH_PREFIXES")
    seo = literals(SEO.read_text(encoding="utf-8"), "TOKEN_PREFIXES")
    if not scrub or not seo:
        print("CANNOT CHECK: one of the lists parsed empty")
        return 2

    # A registry entry ending in "/" takes its credential as the NEXT segment;
    # one without takes it in the query, which is stripped wholesale.
    path_bearing = {p for p in seo if p.endswith("/")}
    # Found by PR #427's compliance audit: dropping the trailing slashes from
    # seo/routes.ts (a plausible "consistency" edit — publicRouteFor already
    # strips them) made this derived set empty, and the guard printed
    # "PASS — 0 path-bearing route(s)" and exited 0 while checking NOTHING.
    # check_decision_claims.sh reads only the exit code, so the CLAIMS row
    # would have stayed green forever. The sibling guard in
    # check_sentry_pii_scope.py gets this right; this one did not.
    if not path_bearing:
        print(
            "CANNOT CHECK: no path-bearing route in TOKEN_PREFIXES — every "
            "entry lost its trailing slash, so this guard would verify nothing"
        )
        raise _CannotCheck()
    missing = sorted(p for p in path_bearing if p not in scrub)
    if missing:
        print("FAIL: a path-token route is not redacted from Sentry event URLs:")
        for p in missing:
            print(f"  {p} is in seo/routes.ts TOKEN_PREFIXES but not in TOKEN_PATH_PREFIXES")
        print("Add it to TOKEN_PATH_PREFIXES in ALL THREE runtimes (ADR 0040).")
        return 1
    print(
        f"PASS — {len(path_bearing)} path-bearing registry route(s) are all "
        f"redacted; {len(scrub)} prefix(es) scrubbed in total."
    )
    return 0
  except _CannotCheck:
    print("Exiting 2 — a guard that cannot verify must not report success.")
    return 2


if __name__ == "__main__":
    sys.exit(main())

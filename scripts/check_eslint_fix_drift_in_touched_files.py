#!/usr/bin/env python3
"""
Guard: a gateway file this change touches must already be what `eslint --fix`
would make it (F-925).

WHAT HAPPENED
-------------
The gateway's `lint` script is `eslint ... --fix`, and CI ran `pnpm run lint`.
So CI's ESLint step did not check the gateway: it REWROTE it, in a throwaway
runner checkout, and reported green. Any fixable error (`prefer-const`, and
every Prettier rule) could not fail a build by construction. By 2026-10-10 the
tree carried 822 gateway files whose formatting `--fix` would change, and no
check had ever said so.

WHAT CI DOES NOW
----------------
  1. `pnpm run lint:check` -- every package's ESLint WITHOUT `--fix`. An error
     fails the step. `lint` stays the local fixer.
  2. This guard -- for the gateway files the change itself adds or modifies,
     `eslint --fix-dry-run` must propose no edit. Prettier drift is a WARNING
     in .eslintrc.cjs, so step 1 alone would let it through silently.

WHY ONLY TOUCHED FILES
----------------------
The 822 drifting files are legacy. Reformatting them in one PR would bury every
real diff under whitespace and break the 15-file PR ceiling. A file is brought
into line the first time a change touches it, so the drift only shrinks and a
reviewer only ever sees whitespace in a file the author already chose to edit.

NEVER VACUOUS
-------------
Before judging anything the guard feeds ESLint one drifting and one clean probe
over stdin (nothing is written to the tree) and requires that the first is
flagged and the second is not. If the Prettier rule is removed, the probe stops
being flagged and the guard exits 2 -- "cannot check" -- rather than passing
every file because nothing is able to drift any more. Exit 2 also covers a git
or ESLint failure. Exit 2 blocks.

    scripts/check_eslint_fix_drift_in_touched_files.py --base origin/main
    scripts/check_eslint_fix_drift_in_touched_files.py --self-test
"""

from __future__ import annotations

import argparse
import json
import pathlib
import re
import subprocess
import sys

REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]
GATEWAY = "apps/api-gateway"
# Mirrors the glob in apps/api-gateway/package.json `lint`:
#   "{src,apps,libs,test}/**/*.ts"
LINT_SCOPE = re.compile(r"^apps/api-gateway/(src|apps|libs|test)/.+\.ts$")
PROBE_NAME = "src/__eslint_fix_drift_probe__.ts"
PROBE_DRIFTING = "export const probe = {a:1,b:2}\n"
PROBE_CLEAN = "export const probe = { a: 1, b: 2 };\n"


class CannotCheck(Exception):
    pass


def in_lint_scope(path: str) -> bool:
    return bool(LINT_SCOPE.match(path))


def drifting(results: list[dict]) -> list[str]:
    """Files ESLint would rewrite. `output` is present only when a fix applies."""
    return [r["filePath"] for r in results if "output" in r]


def _eslint() -> str:
    for base in (REPO_ROOT / GATEWAY, REPO_ROOT):
        exe = base / "node_modules" / ".bin" / "eslint"
        if exe.exists():
            return str(exe)
    raise CannotCheck("no eslint binary under apps/api-gateway or the repo root; run pnpm install")


def _run_eslint(args: list[str], stdin: str | None = None) -> list[dict]:
    proc = subprocess.run(
        [_eslint(), "--fix-dry-run", "--format", "json", *args],
        cwd=REPO_ROOT / GATEWAY,
        input=stdin,
        capture_output=True,
        text=True,
    )
    # 0 = clean, 1 = lint errors remain (still a full report). 2 = ESLint crashed.
    if proc.returncode not in (0, 1):
        raise CannotCheck(f"eslint exited {proc.returncode}: {proc.stderr.strip()[:500]}")
    try:
        return json.loads(proc.stdout)
    except json.JSONDecodeError as exc:
        raise CannotCheck(f"eslint printed no JSON report: {exc}") from exc


def probe() -> None:
    def flagged(text: str) -> bool:
        return bool(drifting(_run_eslint(["--stdin", "--stdin-filename", PROBE_NAME], text)))

    if not flagged(PROBE_DRIFTING):
        raise CannotCheck("the drifting probe was not flagged: ESLint can no longer see formatting drift")
    if flagged(PROBE_CLEAN):
        raise CannotCheck("the clean probe was flagged: the probe no longer matches the gateway's style")


def touched(base: str) -> list[str]:
    proc = subprocess.run(
        ["git", "diff", "--name-only", "--diff-filter=ACMR", f"{base}...HEAD"],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        raise CannotCheck(f"git diff against {base} failed: {proc.stderr.strip()}")
    return [p for p in proc.stdout.splitlines() if in_lint_scope(p)]


def main(base: str) -> int:
    try:
        probe()
        files = touched(base)
        if not files:
            print(f"No gateway file in the lint scope changed against {base}.")
            return 0
        rel = [p[len(GATEWAY) + 1 :] for p in files]
        bad = drifting(_run_eslint(rel))
    except CannotCheck as exc:
        print(f"::error::cannot check: {exc}")
        return 2
    print(f"Checked {len(files)} touched gateway file(s) against {base}.")
    if not bad:
        return 0
    for path in bad:
        shown = pathlib.Path(path).resolve().relative_to(REPO_ROOT)
        print(f"::error file={shown}::eslint --fix would change this file")
    print(
        f"{len(bad)} touched file(s) are not what `eslint --fix` would make them. "
        "Run `pnpm --filter api-gateway lint` and commit the result."
    )
    return 1


def self_test() -> int:
    try:
        probe()
    except CannotCheck as exc:
        print(f"::error::cannot check: {exc}")
        return 2
    print("Self-test: the drifting probe is flagged and the clean probe is not.")
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--base", help="git ref the change is measured against")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        sys.exit(self_test())
    if not args.base:
        parser.error("--base is required")
    sys.exit(main(args.base))

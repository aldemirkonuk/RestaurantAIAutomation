#!/usr/bin/env python3
"""
Guard: a gateway line this change adds or edits must already be what
`eslint --fix` would make it (F-925, narrowed to changed lines by F-960/F-961).

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
     fails the step, wherever it is. `lint` stays the local fixer.
  2. This guard -- on the gateway lines the change itself adds or modifies
     (the `+` side of `git diff -U0 <base>...HEAD`), ESLint must report no
     fixable problem. Prettier drift is a WARNING in .eslintrc.cjs, so step 1
     alone would let it through silently.

WHY ONLY CHANGED LINES (F-960, F-961)
-------------------------------------
The first version judged every touched FILE. On the integrated tree it failed
361 of 537 touched gateway files, because every lane before it was written
while CI silently fixed drift (F-960). Its remedy -- `eslint --fix` the whole
file -- re-wraps legacy lines that line-anchored guards depend on: 35 decision
claims, two flag readBy anchors and the ask-field-class parser broke when it
was tried (F-961). So the guard judges only the author's own lines. New drift
is kept out; legacy drift on lines nobody touched is left alone; a pure
deletion adds no line and passes.

NEVER VACUOUS
-------------
Before judging anything the guard feeds ESLint one drifting and one clean probe
over stdin (nothing is written to the tree) and requires that the first has a
fixable problem on its changed line and the second has none. If the Prettier
rule is removed, the probe stops being flagged and the guard exits 2 -- "cannot
check" -- rather than passing every line because nothing is able to drift any
more. Exit 2 also covers a git or ESLint failure. Exit 2 blocks.

    scripts/check_eslint_fix_drift_in_touched_files.py --base origin/main
    scripts/check_eslint_fix_drift_in_touched_files.py --base origin/main --fix
    scripts/check_eslint_fix_drift_in_touched_files.py --self-test

`--fix` applies ESLint's own fixes for exactly the problems the guard would
report, and no others. A fix can still re-wrap the rest of the statement its
changed line belongs to; it never reformats the file.
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


HUNK = re.compile(r"^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@")


def added_lines(diff: str) -> dict[str, set[int]]:
    """New-side line numbers per file from `git diff -U0` text. A hunk with
    `+n,0` only deletes, so it adds no line."""
    lines: dict[str, set[int]] = {}
    current: set[int] | None = None
    for row in diff.splitlines():
        if row.startswith("+++ "):
            target = row[4:]
            current = lines.setdefault(target[2:], set()) if target.startswith("b/") else None
            continue
        m = HUNK.match(row)
        if m and current is not None:
            start, count = int(m.group(1)), int(m.group(2) or 1)
            current.update(range(start, start + count))
    return {path: nums for path, nums in lines.items() if nums}


def drifting(results: list[dict], changed: dict[str, set[int]]) -> list[tuple[str, int, str, dict]]:
    """Fixable problems that sit on a changed line, as (path, line, message, fix).
    `changed` is keyed by the path relative to the gateway, like the results'
    filePath once resolved. A problem spanning several lines counts if any of
    them changed."""
    found = []
    for r in results:
        rel = _gateway_rel(r["filePath"])
        mine = changed.get(rel, set())
        for msg in r.get("messages", []):
            if "fix" not in msg or "line" not in msg:
                continue
            span = range(msg["line"], msg.get("endLine", msg["line"]) + 1)
            if any(n in mine for n in span):
                found.append((rel, msg["line"], msg.get("message", ""), msg["fix"]))
    return found


def apply_fixes(text: str, fixes: list[dict]) -> str:
    """Apply ESLint `fix` objects ({range: [start, end], text}) to `text`,
    last first so earlier offsets stay valid. An overlapping fix is skipped;
    a second run picks it up. ESLint's offsets count UTF-16 code units after a
    leading BOM, so the text is sliced in that unit."""
    bom = "\ufeff" if text.startswith("\ufeff") else ""
    units = text[len(bom) :].encode("utf-16-le")
    floor = len(units) // 2 + 1
    for fix in sorted(fixes, key=lambda f: f["range"][0], reverse=True):
        start, end = fix["range"]
        if end > floor:
            continue
        units = units[: start * 2] + fix["text"].encode("utf-16-le") + units[end * 2 :]
        floor = start
    return bom + units.decode("utf-16-le")


def _gateway_rel(path: str) -> str:
    resolved = pathlib.Path(path)
    if not resolved.is_absolute():
        return path
    try:
        return str(resolved.resolve().relative_to((REPO_ROOT / GATEWAY).resolve()))
    except ValueError:
        return path


def _eslint() -> str:
    for base in (REPO_ROOT / GATEWAY, REPO_ROOT):
        exe = base / "node_modules" / ".bin" / "eslint"
        if exe.exists():
            return str(exe)
    raise CannotCheck("no eslint binary under apps/api-gateway or the repo root; run pnpm install")


def _run_eslint(args: list[str], stdin: str | None = None) -> list[dict]:
    # No --fix and no --fix-dry-run: a fixable problem keeps its `fix` key and
    # its line, which is what lets it be matched to the change's lines.
    proc = subprocess.run(
        [_eslint(), "--format", "json", *args],
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
        results = _run_eslint(["--stdin", "--stdin-filename", PROBE_NAME], text)
        for r in results:
            r["filePath"] = PROBE_NAME
        return bool(drifting(results, {PROBE_NAME: {1}}))

    if not flagged(PROBE_DRIFTING):
        raise CannotCheck("the drifting probe was not flagged: ESLint can no longer see formatting drift")
    if flagged(PROBE_CLEAN):
        raise CannotCheck("the clean probe was flagged: the probe no longer matches the gateway's style")


def _git(*args: str) -> str:
    proc = subprocess.run(["git", *args], cwd=REPO_ROOT, capture_output=True, text=True)
    if proc.returncode != 0:
        raise CannotCheck(f"git {args[0]} failed: {proc.stderr.strip()}")
    return proc.stdout


def touched(base: str) -> dict[str, set[int]]:
    """Lines the change adds or edits, per gateway file in the lint scope,
    keyed by the path relative to the gateway. Measured from the merge base to
    the WORKING TREE, which is what ESLint reads: in CI that equals HEAD, and
    locally it keeps line numbers right while `--fix` edits are uncommitted."""
    merge_base = _git("merge-base", base, "HEAD").strip()
    diff = _git(
        "diff", "-U0", "--no-color", "--no-ext-diff",
        "--src-prefix=a/", "--dst-prefix=b/", "--diff-filter=ACMR",
        merge_base, "--", GATEWAY,
    )
    return {
        path[len(GATEWAY) + 1 :]: nums
        for path, nums in added_lines(diff).items()
        if in_lint_scope(path)
    }


def main(base: str, fix: bool = False) -> int:
    try:
        probe()
        changed = touched(base)
        if not changed:
            print(f"No gateway line in the lint scope was added or changed against {base}.")
            return 0
        bad = drifting(_run_eslint(sorted(changed)), changed)
    except CannotCheck as exc:
        print(f"::error::cannot check: {exc}")
        return 2
    total = sum(len(v) for v in changed.values())
    print(f"Checked {total} added or changed line(s) in {len(changed)} gateway file(s) against {base}.")
    if not bad:
        return 0
    if fix:
        by_file: dict[str, list[dict]] = {}
        for rel, _line, _message, f in bad:
            by_file.setdefault(rel, []).append(f)
        for rel, fixes in by_file.items():
            path = REPO_ROOT / GATEWAY / rel
            with open(path, encoding="utf-8", newline="") as fh:
                text = fh.read()
            with open(path, "w", encoding="utf-8", newline="") as fh:
                fh.write(apply_fixes(text, fixes))
        print(f"Fixed {len(bad)} problem(s) on your own lines in {len(by_file)} file(s); run again to confirm.")
        return 0
    for rel, line, message, _fix in bad:
        print(f"::error file={GATEWAY}/{rel},line={line}::eslint --fix would change this line: {message}")
    print(
        f"{len(bad)} fixable problem(s) on lines this change adds or edits. Run this script again "
        f"with `--fix --base {base}`: it fixes only those lines. Do not run `eslint --fix` on the "
        "whole file: other guards point at its untouched lines (F-961)."
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
    parser.add_argument("--fix", action="store_true", help="fix only the problems on changed lines")
    args = parser.parse_args()
    if args.self_test:
        sys.exit(self_test())
    if not args.base:
        parser.error("--base is required")
    sys.exit(main(args.base, args.fix))

#!/usr/bin/env python3
"""
Guard: no sanitized (string) value may be fed to a numeric %-format spec.

`sanitize_for_log` returns a str, and a numeric spec cannot format a str. The logger does
NOT raise, though — `logging` formats lazily and traps formatting errors in
`Handler.handleError`:

  * level enabled  -> the intended line is LOST, replaced by a logging-internal traceback
                      on stderr; the call returns normally.
  * level disabled -> nothing happens at all; the fault is invisible.

The live instance was a `logger.debug` in `override_service._maybe_promote_submission`,
i.e. the second case in production. It would have sat silent until someone turned DEBUG on
to investigate something, then eaten the very line they turned it on to read. A crash would
have been kinder, and a crash is what review instinctively looks for — which is why this is
mechanical rather than a review note.

Stdlib only, no third-party imports: this runs in the claims job, which installs nothing.

Exit 0 = clean. Exit 1 = offending call sites (printed). Exit 2 = the guard could not run,
which is a failure, not a skip.
"""

import ast
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SCAN_ROOTS = ["services/agent-orchestrator", "scripts"]

LOG_METHODS = {"debug", "info", "warning", "error", "critical", "exception"}
# Specs demanding a real number. %s / %r accept anything and are fine.
NUMERIC_SPEC = re.compile(r"^%[-+ #0]*[\d.]*[diufFeEgG]$")
ANY_SPEC = re.compile(r"%[-+ #0]*[\d.]*[a-zA-Z]")

SKIP_PARTS = {".venv", "venv", "__pycache__", "node_modules", ".git"}


def offences():
    found = []
    scanned = 0
    for root in SCAN_ROOTS:
        base = ROOT / root
        if not base.exists():
            continue
        for path in base.rglob("*.py"):
            if SKIP_PARTS & set(path.parts):
                continue
            try:
                tree = ast.parse(path.read_text(encoding="utf-8"))
            except (SyntaxError, UnicodeDecodeError):
                continue
            scanned += 1
            for node in ast.walk(tree):
                if not (
                    isinstance(node, ast.Call)
                    and isinstance(node.func, ast.Attribute)
                    and node.func.attr in LOG_METHODS
                ):
                    continue
                if not node.args or not isinstance(node.args[0], ast.Constant):
                    continue
                fmt = node.args[0].value
                if not isinstance(fmt, str):
                    continue
                specs = [s for s in ANY_SPEC.findall(fmt) if s != "%%"]
                for spec, arg in zip(specs, node.args[1:]):
                    sanitized = (
                        isinstance(arg, ast.Call)
                        and isinstance(arg.func, ast.Name)
                        and arg.func.id == "sanitize_for_log"
                    )
                    if sanitized and NUMERIC_SPEC.match(spec):
                        rel = path.relative_to(ROOT)
                        found.append(f"{rel}:{node.lineno} — {spec} fed sanitize_for_log(...)")
    return found, scanned


def main() -> int:
    try:
        found, scanned = offences()
    except Exception as exc:  # noqa: BLE001 — a guard that cannot run is a failure
        print(f"FAIL — the guard could not run: {exc}", file=sys.stderr)
        return 2

    if not scanned:
        print("FAIL — scanned 0 files; the scan roots are wrong.", file=sys.stderr)
        return 2

    if found:
        print(f"== Log sanitizer usage: {len(found)} offending call site(s)\n")
        for f in found:
            print(f"   {f}")
        print(
            "\nFAIL — sanitize_for_log() returns a str. logging will trap the TypeError and\n"
            "       silently drop these lines rather than raise. Use %s, or do not wrap."
        )
        return 1

    print(f"== Log sanitizer usage: {scanned} files scanned, 0 offending call sites")
    print("PASS — no sanitized value reaches a numeric format spec.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

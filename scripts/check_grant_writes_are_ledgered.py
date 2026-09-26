#!/usr/bin/env python3
"""No app code writes a grant, or the security ledger, except through the ledgered functions.

WHY THIS GUARD EXISTS
---------------------
ADR 0112 F12 (founder, 2026-09-05): *"One security ledger. Step-up
verifications, break-glass uses and grant checks write to one tamper-evident
`security_events` chain ... a guard asserts every ceremony writes its row."*
The founder's answer (4) of 2026-09-21 asked for it now: every grant event is
written to that ledger, with the owners told.

The grant functions of `20260926140600_a_grant_waits_for_an_owner_when_its_voucher_goes.sql`
(`authority_grant_issue`, `_revoke`, `_reapprove`, `_delete`,
`_set_owner_only`) change the grant AND append its event in one transaction,
and `append_security_event` (20260926140500) is the chain's only writer. That
holds only while nothing else writes either table: one
`.from("authority_grants").update(...)` in a service is a grant change the
ledger never hears of, and one `.from("security_events").insert(...)` is a row
outside the hash chain. This guard is that rule, executable.

WHAT IT CHECKS
--------------
In app code (`apps/*/src`, `apps/mobile/app`, `services/`, `packages/`; tests
excluded, comments stripped):
  1. `authority_grants` is never written: no `.from("authority_grants")` (or a
     Python `.table("authority_grants")`) chain reaches `.insert(`, `.update(`,
     `.upsert(` or `.delete(` before the statement ends.
  2. `security_events` is never written that way either.
Reads are fine; the register and the gate read both tables.

EXIT CODES
----------
  0  no app code writes either table directly
  1  something does — each finding names the file and the line
  2  CANNOT CHECK: a root is missing, or no source file was found. Never a silent pass.

`--self-test` proves each rule fires on its violation, stays quiet on a read and
on a comment, and that a missing root is exit 2.
"""
from __future__ import annotations

import argparse
import re
import shutil
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

SCAN_ROOTS = (
    "apps/api-gateway/src",
    "apps/web/src",
    "apps/mobile/src",
    "apps/mobile/app",
    "services",
    "packages",
)
EXTENSIONS = {".ts", ".tsx", ".js", ".mjs", ".py"}
SKIP_DIRS = {"node_modules", "dist", "build", ".expo", "__pycache__", "coverage", "venv", ".venv"}
TABLES = ("authority_grants", "security_events")

# `.from("t")` / `.from('t')` / `.table("t")`, then everything up to the end of
# the statement (a `;` for TypeScript, the end of the call chain for Python).
OPEN = re.compile(r"""\.(?:from|table)\(\s*["'](authority_grants|security_events)["']\s*\)""")
WRITE = re.compile(r"""\.(insert|update|upsert|delete)\s*\(""")


class CannotCheck(Exception):
    pass


def is_test(rel: str) -> bool:
    name = rel.rsplit("/", 1)[-1]
    parts = rel.split("/")
    return (
        ".spec." in name
        or ".test." in name
        or "__tests__" in parts
        or "tests" in parts
        or "testing" in parts
        or name.startswith("test_")
        or name.endswith("_test.py")
        or name == "conftest.py"
    )


def strip_comments(src: str, python: bool) -> str:
    out: list[str] = []
    i, n = 0, len(src)
    quote: str | None = None
    while i < n:
        c = src[i]
        if quote:
            out.append(c)
            if c == "\\" and i + 1 < n:
                out.append(src[i + 1])
                i += 2
                continue
            if c == quote:
                quote = None
            i += 1
            continue
        if c in "\"'`":
            quote = c
            out.append(c)
            i += 1
            continue
        if python and c == "#":
            while i < n and src[i] != "\n":
                out.append(" ")
                i += 1
            continue
        if not python and c == "/" and i + 1 < n and src[i + 1] == "/":
            while i < n and src[i] != "\n":
                out.append(" ")
                i += 1
            continue
        if not python and c == "/" and i + 1 < n and src[i + 1] == "*":
            while i < n and not (src[i] == "*" and i + 1 < n and src[i + 1] == "/"):
                out.append("\n" if src[i] == "\n" else " ")
                i += 1
            out.append("  ")
            i += 2
            continue
        out.append(c)
        i += 1
    return "".join(out)


def statement_after(code: str, start: int, python: bool) -> str:
    """The rest of the call chain that begins at `start`."""
    if not python:
        end = code.find(";", start)
        return code[start : end if end >= 0 else len(code)]
    # Python: follow the chain while lines continue it (a leading `.`) or a
    # bracket is still open.
    depth = 0
    i = start
    while i < len(code):
        ch = code[i]
        if ch in "([{":
            depth += 1
        elif ch in ")]}":
            depth -= 1
        elif ch == "\n" and depth <= 0:
            rest = code[i + 1 :].lstrip()
            if not rest.startswith("."):
                break
        i += 1
    return code[start:i]


def run(root: Path) -> tuple[int, list[str], int]:
    findings: list[str] = []
    scanned = 0
    for rel_root in SCAN_ROOTS:
        base = root / rel_root
        if not base.is_dir():
            raise CannotCheck(f"{rel_root} does not exist under {root}")
        for p in sorted(base.rglob("*")):
            if not p.is_file() or p.suffix not in EXTENSIONS:
                continue
            if any(part in SKIP_DIRS for part in p.relative_to(root).parts):
                continue
            rel = p.relative_to(root).as_posix()
            if is_test(rel):
                continue
            try:
                src = p.read_text(encoding="utf-8")
            except (OSError, UnicodeDecodeError) as e:
                raise CannotCheck(f"{rel} is unreadable: {e}") from e
            scanned += 1
            python = rel.endswith(".py")
            code = strip_comments(src, python)
            for m in OPEN.finditer(code):
                chain = statement_after(code, m.end(), python)
                w = WRITE.search(chain)
                if w:
                    line = code.count("\n", 0, m.start()) + 1
                    findings.append(
                        f"{rel}:{line} writes `{m.group(1)}` directly (.{w.group(1)}) — "
                        + (
                            "a grant change goes through its ledgered function (authority_grant_*)"
                            if m.group(1) == "authority_grants"
                            else "the ledger is appended only by append_security_event"
                        )
                    )
    if scanned == 0:
        raise CannotCheck("no app source file was found under any scan root")
    return (1 if findings else 0), findings, scanned


def main_for(root: Path) -> int:
    try:
        code, findings, scanned = run(root)
    except CannotCheck as e:
        print(f"CANNOT CHECK -- {e}")
        return 2
    if findings:
        print(f"FAIL -- {len(findings)} direct write(s) to a grant or to the security ledger (ADR 0112 F12):")
        for f in findings:
            print(f"  - {f}")
        print(
            "Every grant event is written to the security ledger with the grant, in one transaction: "
            "call the authority_grant_* function (organizations/authority-grants.service.ts), never the table."
        )
        return 1
    print(
        f"PASS -- {scanned} app source files; no direct write to authority_grants or security_events "
        "(tests excluded; SQL migrations are not scanned — the functions live there by design)."
    )
    return 0


def _tree(tmp: Path, files: dict[str, str]) -> Path:
    root = tmp / "tree"
    if root.exists():
        shutil.rmtree(root)
    for rel_root in SCAN_ROOTS:
        (root / rel_root).mkdir(parents=True, exist_ok=True)
    (root / "apps/api-gateway/src/ok.ts").write_text("export const ok = 1;\n", encoding="utf-8")
    for rel, body in files.items():
        p = root / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(body, encoding="utf-8")
    return root


def self_test() -> int:
    failures: list[str] = []

    def expect(label: str, files: dict[str, str], want: int) -> None:
        with tempfile.TemporaryDirectory() as d:
            root = _tree(Path(d), files)
            try:
                got = run(root)[0]
            except CannotCheck:
                got = 2
        if got != want:
            failures.append(f"{label}: exit {got}, expected {want}")

    gw = "apps/api-gateway/src/organizations/x.ts"
    expect("a clean tree passes", {}, 0)
    expect("a read of the register passes", {gw: 'await db.from("authority_grants").select("id").eq("id", g);\n'}, 0)
    expect(
        "an update of a grant fires",
        {gw: 'await db\n  .from("authority_grants")\n  .update({ revoked_at: now })\n  .eq("id", g);\n'},
        1,
    )
    expect("an insert of a grant fires", {gw: "await db.from('authority_grants').insert(row);\n"}, 1)
    expect("a delete of a grant fires", {gw: 'await db.from("authority_grants").delete().eq("id", g);\n'}, 1)
    expect("an insert into the ledger fires", {gw: 'await db.from("security_events").insert(row);\n'}, 1)
    expect("a read of the ledger passes", {gw: 'await db.from("security_events").select("*");\n'}, 0)
    expect(
        "a write on the NEXT statement is not this chain's",
        {gw: 'const q = db.from("authority_grants").select("id");\nawait db.from("users").update(x);\n'},
        0,
    )
    expect("a comment does not fire", {gw: '// db.from("authority_grants").update(x)\nexport {};\n'}, 0)
    expect(
        "a python update fires",
        {"services/agent/x.py": 'db.table("authority_grants")\\\n    .update({"x": 1})\\\n    .execute()\n'},
        1,
    )
    expect(
        "a python chain on continued lines fires",
        {"services/agent/y.py": '(\n    db.table("security_events")\n    .insert({"x": 1})\n    .execute()\n)\n'},
        1,
    )
    expect("a spec may write fixtures", {"apps/api-gateway/src/organizations/x.spec.ts": 'db.from("authority_grants").insert(r);\n'}, 0)
    with tempfile.TemporaryDirectory() as d:
        root = _tree(Path(d), {})
        shutil.rmtree(root / "services")
        try:
            run(root)
            failures.append("a missing root: passed, expected CANNOT CHECK")
        except CannotCheck:
            pass

    if failures:
        print("SELF-TEST FAILED:")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("SELF-TEST PASS -- each rule fires on its violation and stays quiet on reads, comments and tests.")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    ap.add_argument("--self-test", action="store_true")
    ap.add_argument("--root", type=Path, default=ROOT)
    args = ap.parse_args()
    if args.self_test:
        return self_test()
    return main_for(args.root)


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""No app code reads or writes `procurement_orders.quantity_received` — ADR 0192.

WHY THIS GUARD EXISTS
---------------------
The founder, 2026-09-21 ("Shelf count from ledger"): "received" for an order
line is what the stock ledger booked onto the shelf for that line — the sum of
`inventory_transactions.quantity_change` for (order, the order's item, live
stock), in the item's stock unit, never rounded — and "the app stops reading
and writing procurement_orders.quantity_received".

The column had four writers that disagreed on its unit (three wrote the order's
own unit, the receiving door wrote bottles), on gross versus net, and on whether
the shelf had actually moved. One live screen read it as the order's unit while
the door wrote bottles: a 5-case order counted at the door pre-filled "60" on the
desk, which submitted unedited is 60 cases — a +660 bottle correction. The
column stays in the schema (dropping it is a later ADR); this guard is what keeps
it dark, because the next screen that "just reads the received count" reopens
exactly that defect.

WHAT IT CHECKS
--------------
  1. The COLUMN. The identifier `quantity_received` must not appear in code —
     comments stripped, strings KEPT, because a `.select("…, quantity_received")`
     is a read and `{ quantity_received: n }` is a write — anywhere under
     `apps/*/src`, `apps/mobile/app`, `services/` or `packages/`.
  2. THE RETIRED WIRE FIELDS, on the clients. `quantityReceived` and
     `quantityReceivedUom` must not appear in code under `apps/web/src`,
     `apps/mobile/src` or `apps/mobile/app`: a client that reads them is reading
     the column through the gateway. (The gateway still DECLARES the request-side
     `quantityReceived` alias on `UpdateOrderDto` so it can refuse it in words,
     and `/deliver` still accepts it as the delivery's own count; neither reads
     the column, and neither is on a client.)

An ALLOWLIST entry excuses one file for one rule, with a reason. It is
shrink-only in the honest sense: an entry that excuses nothing is itself a
finding (exit 2), because an exemption that outlives what it excused is a hole.

WHAT IT DOES NOT COVER, AND CANNOT
----------------------------------
  * Test files (`*.spec.*`, `*.test.*`, `__tests__/`, `tests/`, `test_*.py`,
    `*_test.py`, `conftest.py`). Tests MUST be able to name the column — to
    assert it is not written, and to hold it on a fixture row so a test can
    prove it is ignored. Tests are not app code.
  * `scripts/` and `supabase/`. Guards and migrations name the column by design;
    the schema still has it.
  * `select("*")`. A star read returns the column without naming it. The
    gateway's `mapOrderRow` builds its response from explicit keys and never
    copies it; the jest spec `order-names-its-vendor.spec.ts` proves a row
    carrying 36 in the column reads as nothing received.
  * Python docstrings are strings and are scanned; say "the received column" in
    prose there.

EXIT CODES
----------
  0  no app code names the column or a retired wire field
  1  something does — each finding names the file, the line and the rule
  2  CANNOT CHECK: a root is missing, no source file was found, or an ALLOWLIST
     entry excuses nothing. Never a silent pass.

`--self-test` runs the rules against synthetic trees, including that they FIRE on
a read inside a string after a `//` URL, and do NOT fire on a comment.
"""
from __future__ import annotations

import argparse
import re
import shutil
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

#: (root, rules) — which rule applies under which root.
COLUMN = "column"
WIRE = "wire"
SCAN_ROOTS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("apps/api-gateway/src", (COLUMN,)),
    ("apps/web/src", (COLUMN, WIRE)),
    ("apps/mobile/src", (COLUMN, WIRE)),
    ("apps/mobile/app", (COLUMN, WIRE)),
    ("services", (COLUMN,)),
    ("packages", (COLUMN,)),
)

EXTENSIONS = {".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py"}
SKIP_DIRS = {"node_modules", "dist", "build", ".expo", ".next", "__pycache__", ".turbo", "coverage"}

PATTERNS = {
    COLUMN: re.compile(r"\bquantity_received\b"),
    WIRE: re.compile(r"\bquantityReceived(?:Uom)?\b"),
}

#: (repo-relative path, rule, reason). Empty on landing: nothing in app code
#: needs to name the column. Add an entry only with a reason a reviewer can
#: check, and delete it the moment it excuses nothing.
ALLOWLIST: tuple[tuple[str, str, str], ...] = ()


class CannotCheck(Exception):
    """The guard cannot see what it claims to. Exit 2, never 0."""


def is_test(rel: str) -> bool:
    name = rel.rsplit("/", 1)[-1]
    parts = rel.split("/")
    return (
        ".spec." in name
        or ".test." in name
        or "__tests__" in parts
        or "tests" in parts
        or name.startswith("test_")
        or name.endswith("_test.py")
        or name == "conftest.py"
    )


def strip_ts_comments(src: str) -> str:
    """Blank out // and /* */ comments; keep strings and template literals.

    A state machine, not a regex: `"https://host/" + "quantity_received"` holds
    a `//` inside a string, and a regex that took it for a comment would blank
    the read that follows it.
    """
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
        if c == "/" and i + 1 < n and src[i + 1] == "/":
            while i < n and src[i] != "\n":
                out.append(" ")
                i += 1
            continue
        if c == "/" and i + 1 < n and src[i + 1] == "*":
            out.append("  ")
            i += 2
            while i < n and not (src[i] == "*" and i + 1 < n and src[i + 1] == "/"):
                out.append("\n" if src[i] == "\n" else " ")
                i += 1
            out.append("  ")
            i += 2
            continue
        out.append(c)
        i += 1
    return "".join(out)


def strip_py_comments(src: str) -> str:
    """Blank out `#` comments; keep every string, docstrings included."""
    out: list[str] = []
    i, n = 0, len(src)
    quote: str | None = None
    while i < n:
        c = src[i]
        if quote:
            if src.startswith(quote, i):
                out.append(quote)
                i += len(quote)
                quote = None
                continue
            out.append(c)
            if c == "\\" and i + 1 < n:
                out.append(src[i + 1])
                i += 2
                continue
            i += 1
            continue
        if src.startswith('"""', i) or src.startswith("'''", i):
            quote = src[i : i + 3]
            out.append(quote)
            i += 3
            continue
        if c in "\"'":
            quote = c
            out.append(c)
            i += 1
            continue
        if c == "#":
            while i < n and src[i] != "\n":
                out.append(" ")
                i += 1
            continue
        out.append(c)
        i += 1
    return "".join(out)


def gather(root: Path) -> list[tuple[str, tuple[str, ...], str]]:
    """(relative path, rules, source) for every app source file in scope."""
    found: list[tuple[str, tuple[str, ...], str]] = []
    for rel_root, rules in SCAN_ROOTS:
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
            found.append((rel, rules, src))
    if not found:
        raise CannotCheck("no app source file was found under any scan root")
    return found


def run(root: Path) -> tuple[int, list[str], int]:
    sources = gather(root)
    findings: list[str] = []
    used: set[tuple[str, str]] = set()
    allowed = {(path, rule) for path, rule, _ in ALLOWLIST}
    for rel, rules, src in sources:
        code = strip_py_comments(src) if rel.endswith(".py") else strip_ts_comments(src)
        for rule in rules:
            for m in PATTERNS[rule].finditer(code):
                if (rel, rule) in allowed:
                    used.add((rel, rule))
                    continue
                line = code.count("\n", 0, m.start()) + 1
                findings.append(
                    f"{rel}:{line} names `{m.group(0)}` "
                    + (
                        "(the retired column)"
                        if rule == COLUMN
                        else "(a retired wire field that carried the column)"
                    )
                )
    stale = [f"{p} [{r}]" for p, r, _ in ALLOWLIST if (p, r) not in used]
    if stale:
        raise CannotCheck(
            "ALLOWLIST excuses nothing for: "
            + ", ".join(stale)
            + ". Delete the entry — an exemption that outlives what it excused is a hole."
        )
    return (1 if findings else 0), findings, len(sources)


def main_for(root: Path) -> int:
    try:
        code, findings, scanned = run(root)
    except CannotCheck as e:
        print(f"CANNOT CHECK -- {e}")
        return 2
    if findings:
        print(
            f"FAIL -- {len(findings)} place(s) read or write procurement_orders.quantity_received "
            "or a retired wire field (ADR 0192):"
        )
        for f in findings:
            print(f"  - {f}")
        print(
            "What an order received is the stock ledger's count: read the gateway's `received` "
            "block (apps/api-gateway/src/procurement/shelf-received.ts), never the column."
        )
        return 1
    print(
        f"PASS -- {scanned} app source files; none names procurement_orders.quantity_received, "
        "and no client names quantityReceived / quantityReceivedUom. (Scope: apps, services, "
        "packages, tests excluded; a select(\"*\") is not visible to this guard — see its header.)"
    )
    return 0


# ---------------------------------------------------------------------------
# Self-test
# ---------------------------------------------------------------------------
def _tree(tmp: Path, files: dict[str, str]) -> Path:
    root = tmp / "tree"
    if root.exists():
        shutil.rmtree(root)
    for rel_root, _ in SCAN_ROOTS:
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

    gw = "apps/api-gateway/src/procurement/x.ts"
    expect("a clean tree passes", {}, 0)
    expect(
        "a select naming the column is a read",
        {gw: 'db.from("procurement_orders").select("id, quantity_received");\n'},
        1,
    )
    expect(
        "an update payload naming the column is a write",
        {gw: "update({ status, quantity_received: n });\n"},
        1,
    )
    expect(
        "a read after a // inside a string still fires",
        {gw: 'const u = "https://host/" + "quantity_received";\n'},
        1,
    )
    expect(
        "a template literal naming the column fires",
        {gw: "const cols = `id, ${x}, quantity_received`;\n"},
        1,
    )
    expect("a line comment does not fire", {gw: "// the old quantity_received column\n"}, 0)
    expect(
        "a block comment does not fire",
        {gw: "/*\n * procurement_orders.quantity_received had four writers\n */\nexport {};\n"},
        0,
    )
    expect(
        "a spec may name the column",
        {"apps/api-gateway/src/procurement/x.spec.ts": 'expect(u).not.toHaveProperty("quantity_received");\n'},
        0,
    )
    expect(
        "a python dict key writing the column fires",
        {"services/agent/demo.py": 'row = {"quantity_received": 12}\n'},
        1,
    )
    expect("a python comment does not fire", {"services/agent/demo.py": "# quantity_received\nx = 1\n"}, 0)
    expect(
        "a web client reading the retired wire unit fires",
        {"apps/web/src/pages/x.tsx": "const u = order.quantityReceivedUom;\n"},
        1,
    )
    expect(
        "a phone reading the retired wire count fires",
        {"apps/mobile/src/lib/x.ts": "const n = order?.quantityReceived;\n"},
        1,
    )
    expect(
        "the canonical delivery-count parameter is not the retired field",
        {"apps/web/src/pages/x.tsx": "params: { quantityReceivedInOrderUom: order.quantity },\n"},
        0,
    )
    expect(
        "the gateway may still declare the refused request alias",
        {gw: "  quantityReceived?: number;\n"},
        0,
    )

    # A missing root is CANNOT CHECK, never a pass.
    with tempfile.TemporaryDirectory() as d:
        root = _tree(Path(d), {})
        shutil.rmtree(root / "apps/mobile/app")
        try:
            run(root)
            failures.append("a missing root: passed, expected CANNOT CHECK")
        except CannotCheck:
            pass

    # A stale allow-list entry is CANNOT CHECK.
    global ALLOWLIST
    saved = ALLOWLIST
    ALLOWLIST = (("apps/web/src/gone.ts", COLUMN, "self-test"),)
    try:
        expect("a stale allow-list entry is a finding", {}, 2)
        expect(
            "a live allow-list entry excuses its file",
            {"apps/web/src/gone.ts": 'select("quantity_received")\n'},
            0,
        )
    finally:
        ALLOWLIST = saved

    if failures:
        print("SELF-TEST FAILED:")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("SELF-TEST PASS -- every rule fires on its violation and stays quiet on its non-violation.")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    ap.add_argument("--self-test", action="store_true")
    ap.add_argument("--root", type=Path, default=ROOT, help="repo root to scan (default: this repo)")
    args = ap.parse_args()
    if args.self_test:
        return self_test()
    return main_for(args.root)


if __name__ == "__main__":
    sys.exit(main())

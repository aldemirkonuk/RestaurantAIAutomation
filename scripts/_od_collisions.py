#!/usr/bin/env python3
"""Report OD ids that appear twice within the SAME section of the register.

Helper for scripts/check_decision_claims.sh. Kept as its own file rather than a
heredoc because the shell quoting around a nested python -c is exactly the sort
of thing that breaks silently and turns a guard into a no-op.

Appearing once in Open and once in Resolved is legitimate — OD-25 records a
partial agreement in Resolved and the remainder in Open. Twice in one section is
always a collision.

TWO MORE WAYS AN ID NAMES TWO DECISIONS — added 2026-08-27
----------------------------------------------------------
`check_od_ids_exist.py` already refuses an id that owns a row AND is declared
absorbed into another ("RESOLVES TWO WAYS"), so the reissue of a retired number
is covered there and is deliberately NOT duplicated here. Two neighbours of it
were covered by neither guard. Both measured on `ab5fb48d` first — resolver
silent, this file silent:

  1. ONE ID ABSORBED BY TWO ROWS. Two rows each declaring
     `**Absorbs OD-43 (merged …)**` makes a citation to OD-43 resolve two ways.
     The resolver checks a retired id has *an* absorber, not exactly one, and
     keeps the first — so without this the register could carry a contradiction
     while every guard printed PASS.

     Counted per ROW, not per match. A row that states its own declaration twice
     is ONE row and must not be reported; register bodies restate things
     constantly, and a guard that fails the build over a repeated sentence is a
     guard people switch off.

  2. A NUMBER LIVE ONLY INSIDE A COMBINED CELL. `^\| (OD-\d+) \|` could not
     match `| OD-30/42 |` or `| OD-11a |` AT ALL — fed either it returned
     nothing. So OD-30, OD-42 and OD-11a have been outside collision watch for
     as long as those rows have existed.

ROW AND ABSORBS ARE IMPORTED. ROW IDENTITY IS A DIFFERENT QUESTION.
-------------------------------------------------------------------
`ROW` and `ABSORBS` come from check_od_ids_exist.py — two guards deriving "what
is a row" or "what is a merge declaration" separately is how they start
disagreeing about the same register.

`ids_in_cell` is deliberately NOT reused, and this is not an oversight. That
function answers *"which ids does a citation to this row resolve through"*, and
for that it is right to normalise `| OD-11a |` to OD-11 — a bare `OD-11`
reference should find it. This file answers a different question: *"do two rows
claim the same identity"*. Under the resolver's answer the register's own live
rows `| OD-11a |` (line 115) and `| OD-11 |` (line 125) — two distinct decisions
the suffix exists to separate — read as one id twice and turn CI red. Measured,
not reasoned: reusing `ids_in_cell` here reported `OD-11 appears 2x in the
Resolved section` against the unmodified register.

So identity here is the token AS WRITTEN, with `/` splitting a shared row. Same
row model, same declaration form, different equality — stated out loud because
the next person to "unify" these two will otherwise re-introduce that red build.

Exit 2 if the register cannot be read, has no sections, or the shared parser
cannot be imported: a check that cannot check must not report success.
"""

import collections
import contextlib
import re
import importlib.util
import io
import os
import sys

# Loaded BY PATH with stdout captured, not via `import`. The caller treats any
# stdout from this file as a collision report, so a stray print over there would
# fail the build with someone else's log line. And `except BaseException`, not
# `Exception`: SystemExit is a BaseException, so a module-level `sys.exit()` in
# the imported file — one lost `if __name__ == "__main__"` away — would slip
# past an `except Exception` and terminate THIS guard with that file's status,
# which for exit 0 means the collision check silently never runs.
try:
    _spec = importlib.util.spec_from_file_location(
        "_od_ids_guard",
        os.path.join(
            os.path.dirname(os.path.abspath(__file__)), "check_od_ids_exist.py"
        ),
    )
    _mod = importlib.util.module_from_spec(_spec)
    with contextlib.redirect_stdout(io.StringIO()):
        _spec.loader.exec_module(_mod)
    ROW, ABSORBS = _mod.ROW, _mod.ABSORBS
except BaseException as e:
    print(f"cannot load the shared register parser: {e!r}", file=sys.stderr)
    sys.exit(2)


def row_identities(cell: str) -> list[str]:
    """The identities a row CLAIMS, as written.

    `OD-88`        -> ["OD-88"]
    `OD-30/42`     -> ["OD-30", "OD-42"]   one row, two reconciled forks
    `**OD-88**`    -> ["OD-88"]            bold is presentation
    `OD-11a`       -> ["OD-11a"]           a suffix is part of the identity,
                                           NOT a variant spelling of OD-11
    """
    cell = cell.replace("*", "").strip()
    out = []
    for part in cell.split("/"):
        part = part.strip()
        if not part:
            continue
        m = re.fullmatch(r"(?:OD-)?(\d+[a-z]?)", part)
        if m:
            out.append("OD-" + m.group(1))
    return out


def main() -> int:
    path = sys.argv[1] if len(sys.argv) > 1 else ".planning/decisions/OPEN-DECISIONS.md"
    try:
        txt = open(path, encoding="utf-8").read()
    except OSError as e:
        print(f"cannot read {path}: {e}", file=sys.stderr)
        return 2

    try:
        open_i, res_i = txt.index("## Open"), txt.index("## Resolved")
    except ValueError:
        print(f"{path} has no '## Open' / '## Resolved' sections", file=sys.stderr)
        return 2

    for name, seg in (("Open", txt[open_i:res_i]), ("Resolved", txt[res_i:])):
        counts: collections.Counter = collections.Counter()
        for line in seg.splitlines():
            m = ROW.match(line)
            if m and "OD-" in (m.group(1) or ""):
                counts.update(row_identities(m.group(1) or ""))
        for oid, n in sorted(counts.items()):
            if n > 1:
                print(f"{oid} appears {n}x in the {name} section")

    # Exactly one ROW may claim to have retired a given id. Keyed by LINE NUMBER
    # so a row restating its own declaration counts once.
    absorbers: dict[str, dict[int, str]] = collections.defaultdict(dict)
    for lineno, line in enumerate(txt.splitlines(), 1):
        m = ROW.match(line)
        if not m or "OD-" not in (m.group(1) or ""):
            continue
        ids = row_identities(m.group(1) or "")
        if not ids:
            continue
        for am in ABSORBS.finditer(m.group(2) or ""):
            absorbers["OD-" + am.group(1)][lineno] = ids[0]

    for oid, by_row in sorted(absorbers.items()):
        if len(by_row) > 1:
            where = ", ".join(
                f"{owner} (line {ln})" for ln, owner in sorted(by_row.items())
            )
            print(
                f"{oid} is declared absorbed by {len(by_row)} different rows "
                f"[{where}] — a citation to it resolves that many ways"
            )
    return 0


# ---------------------------------------------------------------------------
# Self-test. Run in CI beside check_od_ids_exist.py's.
# ---------------------------------------------------------------------------
# The commit that added the absorbs check listed five verified cases in its
# message and left them there as prose. That is the failure §5b names — a claim
# written as a sentence is checked once, the day it is written — applied to the
# file that enforces §5b. Every case below is one an adversarial review actually
# broke or nearly broke.
SELF_TEST_HEADER = "## Open\n\n| ID | Q |\n|---|---|\n"


def _run(rows: str, tmpdir: str) -> tuple[int, str]:
    import subprocess

    reg = os.path.join(tmpdir, "R.md")
    with open(reg, "w", encoding="utf-8") as fh:
        fh.write(SELF_TEST_HEADER + rows + "\n## Resolved\n\n| ID | Q |\n|---|---|\n")
    r = subprocess.run(
        [sys.executable, os.path.abspath(__file__), reg], capture_output=True, text=True
    )
    return r.returncode, r.stdout.strip()


def self_test() -> int:
    import tempfile

    ok = True

    def check(label: str, rows: str, want: str) -> None:
        nonlocal ok
        with tempfile.TemporaryDirectory() as d:
            code, out = _run(rows, d)
        good = (want in out) if want else (out == "" and code == 0)
        print(f"   {'ok  ' if good else 'FAIL'} {label}")
        if not good:
            ok = False
            print(f"        wanted {want!r}, got {out!r} (exit {code})")

    A = "**Absorbs OD-43 (merged 2026-08-27)**"

    check("a duplicate id in one section is reported",
          "| OD-26 | one |\n| OD-26 | two |\n", "OD-26 appears 2x")
    check("a bold id is the same identity",
          "| **OD-88** | one |\n| OD-88 | two |\n", "OD-88 appears 2x")
    check("a combined cell puts BOTH halves under watch",
          "| OD-30/42 | pair |\n| OD-42 | new |\n", "OD-42 appears 2x")
    # The false positive that reusing the resolver's ids_in_cell produced against
    # the real register: two live rows, one suffix apart, are NOT a collision.
    check("a suffixed id is its own identity, not a variant of the base",
          "| OD-11a | one |\n| OD-11 | two |\n", "")
    check("a duplicate suffixed id IS a collision",
          "| OD-11a | one |\n| OD-11a | two |\n", "OD-11a appears 2x")
    check("two rows absorbing one id is reported",
          f"| OD-26 | {A} |\n| OD-99 | {A} |\n", "declared absorbed by 2 different rows")
    # Counted per row, not per match — a body restating its own declaration is
    # one row, and failing the build over a repeated sentence turns guards off.
    check("ONE row restating its own declaration is not two rows",
          f"| OD-26 | {A} and again {A} |\n", "")
    check("a clean register is silent", "| OD-26 | one |\n| OD-27 | two |\n", "")

    print("PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    if "--self-test" in sys.argv:
        sys.exit(self_test())
    sys.exit(main())

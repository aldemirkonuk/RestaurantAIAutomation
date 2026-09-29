#!/usr/bin/env python3
"""Is .planning/v3.0-TECH-DEBT.md still frozen, and is tech-debt.d/ well formed?

Helper for scripts/check_decision_claims.sh (ADR 0238, 2026-09-29). Kept as
its own file for the same reason _claims_parse.py and _od_collisions.py are:
a nested heredoc's shell quoting breaks silently, and a guard needs a
self-test that does not depend on the real register.

WHY
---
Many PRs appended a `## ...` entry to the tail of v3.0-TECH-DEBT.md, so two
open PRs conflicted there as soon as one merged, and each conflict fix was a
new head and a new ADR 0090 audit. The register also carries 127 line
citations (`v3.0-TECH-DEBT.md:N`, in 70 files) that no guard checks, so a
careless conflict fix that inserts a line mid-file breaks them in silence.
New entries now go in `.planning/tech-debt.d/<YYYY-MM-DD>-<branch-slug>.md`,
and the old file is frozen:

  * its newline count must equal the pin (`--frozen-lines N`, the constant
    DEBT_FROZEN_LINES in check_decision_claims.sh), and
  * its last `## ` heading must be the `## FROZEN` section.

A heading-only check would miss a "**Fix.**" paragraph added inside a legacy
entry; the line count is what catches that (the adversarial pass on the draft
found this). A legacy entry is still closed IN PLACE by striking its heading
(`~~OPEN~~ CLOSED on ...`), which keeps the count.

tech-debt.d/ holds README.md and files named `YYYY-MM-DD-<slug>.md` (a real
date; a lowercase slug), nothing else and no subdirectories, and each fragment
must carry at least one `## ` entry heading. A file this guard would skip is
an entry nobody reads, so it is an error, not a skip.

    _debt_frozen.py --frozen-lines N [--fragments DIR] PATH
    _debt_frozen.py --self-test

EXITS: 0 ok · 7 FROZEN (pin or heading) · 8 FRAGMENT (name, subdirectory,
empty) · 2 cannot read, or bad usage. 7 outranks 8.
"""

import datetime
import os
import re
import sys

FRAGMENT_NAME = re.compile(r"^(\d{4}-\d{2}-\d{2})-[a-z0-9][a-z0-9.-]*\.md$")
FROZEN_HEADING = "## FROZEN"


def frozen_ok(path: str, frozen_lines: int) -> bool:
    with open(path, encoding="utf-8") as fh:
        data = fh.read()
    ok = True
    count = data.count("\n")
    if count != frozen_lines:
        print(
            f"FROZEN\t{path}\thas {count} lines; it is frozen at {frozen_lines} "
            "(ADR 0238). No line may be added to or removed from it: 127 line "
            "citations point into it. A new entry, or a closing note longer than "
            "a struck heading, goes in .planning/tech-debt.d/<YYYY-MM-DD>-<branch-slug>.md "
            "(cite the legacy entry as v3.0-TECH-DEBT.md:<line> plus its heading).",
            file=sys.stderr,
        )
        ok = False
    headings = [(n, ln) for n, ln in enumerate(data.split("\n"), 1) if ln.startswith("## ")]
    if not headings or not headings[-1][1].startswith(FROZEN_HEADING):
        where = f"{path}:{headings[-1][0]}" if headings else path
        print(
            f"FROZEN\t{where}\tthe last `## ` heading is not the `{FROZEN_HEADING}` "
            "section. Nothing may be filed after it: new entries live in "
            ".planning/tech-debt.d/.",
            file=sys.stderr,
        )
        ok = False
    return ok


def fragments_ok(d: str) -> bool:
    ok = True
    for name in sorted(os.listdir(d)):
        p = os.path.join(d, name)
        if name == "README.md" and os.path.isfile(p):
            continue
        if os.path.isdir(p):
            print(f"FRAGMENT\t{p}\tis a subdirectory; tech-debt.d/ is flat", file=sys.stderr)
            ok = False
            continue
        m = FRAGMENT_NAME.match(name)
        date_ok = False
        if m:
            try:
                datetime.date.fromisoformat(m.group(1))
                date_ok = True
            except ValueError:
                pass
        if not (m and date_ok and os.path.isfile(p)):
            print(
                f"FRAGMENT\t{p}\tis not read: a debt fragment is named "
                "<YYYY-MM-DD>-<branch-slug>.md (a real date, a lowercase slug; "
                "README.md is the only other file allowed). Rename it: an entry "
                "this guard skips is one nobody reads.",
                file=sys.stderr,
            )
            ok = False
            continue
        with open(p, encoding="utf-8") as fh:
            if not any(ln.startswith("## ") for ln in fh):
                print(
                    f"FRAGMENT\t{p}\tholds no `## ` entry heading. Use the register's "
                    "format (`## <title> — STATUS — <date>`), or delete the file.",
                    file=sys.stderr,
                )
                ok = False
    return ok


def main(argv: list) -> int:
    frozen_lines = None
    fragments_dir = None
    paths = []
    args = iter(argv)
    for a in args:
        if a == "--frozen-lines":
            v = next(args, "")
            if not v.isdigit() or int(v) < 1:
                print(f"--frozen-lines needs a positive integer, got {v!r}", file=sys.stderr)
                return 2
            frozen_lines = int(v)
        elif a == "--fragments":
            fragments_dir = next(args, "")
            if not fragments_dir:
                print("--fragments needs a directory", file=sys.stderr)
                return 2
        elif a.startswith("--"):
            print(f"unknown option {a}", file=sys.stderr)
            return 2
        else:
            paths.append(a)
    if frozen_lines is None or len(paths) != 1:
        print("usage: _debt_frozen.py --frozen-lines N [--fragments DIR] PATH", file=sys.stderr)
        return 2
    try:
        frozen = frozen_ok(paths[0], frozen_lines)
        frags = fragments_ok(fragments_dir) if fragments_dir is not None else True
    except OSError as e:
        print(f"cannot read {e.filename or paths[0]}: {e}", file=sys.stderr)
        return 2
    if not frozen:
        return 7
    if not frags:
        return 8
    return 0


def self_test() -> int:
    import contextlib
    import io
    import tempfile

    ok = True
    base = (
        "# register\n\n## An old entry — OPEN — 2026-01-01\n\nBody.\n\n"
        "## FROZEN — new entries live in .planning/tech-debt.d/ (ADR 0238)\n\nPointer.\n"
    )
    good_frag = "## A new entry — OPEN — 2026-01-02\n\nBody.\n"

    def case(label, text, frags, want, want_err="", pin="auto", absent=False, extra=None):
        nonlocal ok
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "v3.0-TECH-DEBT.md")
            with open(p, "w", encoding="utf-8") as fh:
                fh.write(text)
            fd = os.path.join(d, "tech-debt.d")
            if not absent:
                os.mkdir(fd)
            for name, body in frags.items():
                q = os.path.join(fd, name)
                if body is None:
                    os.mkdir(q)
                else:
                    with open(q, "w", encoding="utf-8") as fh:
                        fh.write(body)
            n = base.count("\n") if pin == "auto" else pin
            argv = extra if extra is not None else ["--frozen-lines", str(n), "--fragments", fd, p]
            err = io.StringIO()
            with contextlib.redirect_stderr(err):
                code = main(argv)
        good = code == want and (not want_err or want_err in err.getvalue())
        print(f"   {'ok  ' if good else 'FAIL'} {label}")
        if not good:
            ok = False
            print(f"        wanted {want} ~{want_err!r}, got {code} {err.getvalue()!r}")

    readme = {"README.md": "# tech-debt.d\n"}
    case("the frozen file with a good fragment passes", base, {"2026-01-02-feat-x.md": good_frag, **readme}, 0)
    case("README.md alone passes", base, readme, 0)
    case("a heading appended after FROZEN fails", base + "\n## New — OPEN — 2026-01-02\n", {}, 7, "FROZEN")
    case("a heading after FROZEN fails with the line count kept",
         base.replace("Pointer.\n", "## New — OPEN\n"), {}, 7, "is not the `## FROZEN`")
    case("a paragraph added inside a legacy entry fails (count moved)",
         base.replace("Body.\n", "Body.\n\n**Fix.** More.\n"), {}, 7, "has 11 lines; it is frozen at 9")
    case("a legacy heading struck in place passes (count kept)",
         base.replace("— OPEN —", "— ~~OPEN~~ CLOSED 2026-01-03 —"), {}, 0)
    case("a deleted line fails", base.replace("Body.\n", ""), {}, 7, "has 8 lines; it is frozen at 9")
    case("the FROZEN heading removed fails", base.replace("## FROZEN", "## Frozen"), {}, 7, "FROZEN")
    case("a fragment with no date prefix fails", base, {"notes.md": good_frag}, 8, "notes.md")
    case("a fragment with an impossible date fails", base, {"2026-13-45-feat-x.md": good_frag}, 8, "2026-13-45")
    case("an upper-case slug fails", base, {"2026-01-02-Feat-X.md": good_frag}, 8, "Feat-X")
    case("a subdirectory fails", base, {"sub": None}, 8, "subdirectory")
    case("a fragment with no ## entry fails", base, {"2026-01-02-feat-x.md": "just text\n"}, 8, "no `## `")
    case("FROZEN outranks FRAGMENT (7 > 8)", base + "x\n", {"notes.md": good_frag}, 7, "FRAGMENT")
    case("a missing tech-debt.d is cannot-read (2)", base, {}, 2, "cannot read", absent=True)
    case("no --frozen-lines is usage (2), never an unpinned pass", base, {}, 2, "usage", extra=[os.devnull])
    case("a zero pin is usage (2)", base, {}, 2, "positive", extra=["--frozen-lines", "0", os.devnull])

    print("PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    if "--self-test" in sys.argv:
        sys.exit(self_test())
    sys.exit(main(sys.argv[1:]))
